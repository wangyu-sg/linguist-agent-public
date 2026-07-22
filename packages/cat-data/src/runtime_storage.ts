import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, relative, sep } from "node:path";

export const RUNTIME_STORAGE_POLICY_VERSION = 2;

export type RuntimeStorageClass = "state" | "source-copy" | "index" | "cache" | "audit" | "output" | "log" | "other";
export type RuntimeStorageLifecycle = "durable" | "rebuildable" | "rotatable" | "discardable";
export type RuntimeStorageRootKind = "data" | "cache" | "log";
export type RuntimeStorageCleanupAction =
  | "pruneCaches"
  | "rotateLogs"
  | "deleteProjectCache"
  | "deleteOldReports"
  | "pruneLegacyCache"
  | "migrateLegacyCache";

export interface RuntimeStorageRoots {
  runtimeRoot: string;
  dataRoot: string;
  cacheRoot: string;
  logRoot: string;
  legacyDataRoot: string;
}

export interface RuntimeStorageArtifact {
  storageClass: RuntimeStorageClass;
  lifecycle: RuntimeStorageLifecycle;
  owner: "project" | "runtime" | "assistant";
  removable: boolean;
}

export interface RuntimeStorageEntry {
  path: string;
  relPath: string;
  rootKind: RuntimeStorageRootKind;
  sizeBytes: number;
  storageClass: RuntimeStorageClass;
  lifecycle: RuntimeStorageLifecycle;
  projectId?: string;
  removable: boolean;
}

export interface RuntimeStorageBucket {
  storageClass: RuntimeStorageClass;
  sizeBytes: number;
  files: number;
  removableBytes: number;
}

export interface RuntimeStorageProject {
  projectId: string;
  sizeBytes: number;
  files: number;
  removableBytes: number;
}

export interface RuntimeStorageSummary {
  policyVersion: number;
  runtimeRoot: string;
  dataRoot: string;
  roots: RuntimeStorageRoots;
  totalBytes: number;
  removableBytes: number;
  buckets: RuntimeStorageBucket[];
  projects: RuntimeStorageProject[];
  largest: RuntimeStorageEntry[];
  legacyCandidates: RuntimeStorageEntry[];
}

export interface RuntimeStorageActionInput {
  action: RuntimeStorageCleanupAction;
  projectId?: string;
  keepNewestReports?: number;
  logMaxBytes?: number;
  logKeep?: number;
}

export interface RuntimeStorageExecuteInput extends RuntimeStorageActionInput {
  planHash: string;
}

export interface RuntimeStorageCleanupPlan {
  mode: "preview";
  action: RuntimeStorageCleanupAction;
  projectId?: string;
  planHash: string;
  bytes: number;
  files: number;
  paths: string[];
  warnings: string[];
}

export interface RuntimeStorageCleanupResult {
  mode: "execute";
  action: RuntimeStorageCleanupAction;
  deletedBytes: number;
  deletedFiles: number;
  deletedPaths: string[];
  skippedPaths: string[];
  planHash: string;
}

const CLASS_ORDER: RuntimeStorageClass[] = ["state", "source-copy", "index", "cache", "audit", "output", "log", "other"];
const STATE_FILES = new Set([
  "project.json",
  "batch.json",
  "tm.json",
  "termbase.json",
  "glossary.json",
  "tag_rules.json",
  "agent_settings.json",
  "agent_decisions.json",
  "agent_jobs.json",
]);
const INDEX_FILES = new Set(["asset_blocks.jsonl", "asset_vectors.jsonl", "asset_typed_index.json", "source_context_index.json"]);
const AUDIT_FILES = new Set(["agent_events.jsonl", "chat.json", "agent_selected_session.json", "memory_audit.jsonl", "tm_audit.jsonl", "export_audit.jsonl", "pi_settings_audit.jsonl"]);

function defaultCacheRoot(): string {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Caches", "Linguist Agent", "runtime")
    : join(homedir(), ".cache", "linguist-agent", "runtime");
}

function defaultLogRoot(): string {
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Logs", "Linguist Agent")
    : join(homedir(), ".local", "state", "linguist-agent", "logs");
}

export function resolveRuntimeStorageRoots(runtimeRoot: string): RuntimeStorageRoots {
  return {
    runtimeRoot,
    dataRoot: join(runtimeRoot, "data"),
    cacheRoot: process.env.LA_RUNTIME_CACHE_ROOT || defaultCacheRoot(),
    logRoot: process.env.LA_RUNTIME_LOG_ROOT || defaultLogRoot(),
    legacyDataRoot: join(runtimeRoot, "data"),
  };
}

export function runtimeProjectCachePath(runtimeRoot: string, projectId: string, ...parts: string[]): string {
  return join(resolveRuntimeStorageRoots(runtimeRoot).cacheRoot, "projects", projectId, ...parts);
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return Boolean(rel) && !rel.startsWith("..") && !rel.includes(`..${sep}`);
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(path);
    }
  }
  await walk(root);
  return out;
}

export function classifyRuntimeStoragePath(relPath: string): { storageClass: RuntimeStorageClass; projectId?: string; removable: boolean; lifecycle: RuntimeStorageLifecycle } {
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  const name = parts.at(-1) ?? "";
  const ext = extname(name).toLocaleLowerCase();
  const inProject = parts[0] === "projects" && typeof parts[1] === "string";
  const projectId = inProject ? parts[1] : undefined;
  const projectSubdir = inProject ? parts[2] : undefined;

  if (parts[0] === "logs" || name.endsWith(".log") || name.endsWith(".pid") || relPath === "server_diagnostics.jsonl") {
    return { storageClass: "log", projectId, removable: true, lifecycle: "rotatable" };
  }
  if (parts[0] === "generated" || parts[0] === "reports" || projectSubdir === "exports") {
    return { storageClass: "output", projectId, removable: true, lifecycle: "discardable" };
  }
  if (projectSubdir === "asset_parse") {
    return { storageClass: "cache", projectId, removable: true, lifecycle: "rebuildable" };
  }
  if (projectSubdir === "uploads") {
    return { storageClass: "source-copy", projectId, removable: false, lifecycle: "durable" };
  }
  if (projectSubdir === "_pi_sessions" || parts[0] === "assistant" || AUDIT_FILES.has(name)) {
    return { storageClass: "audit", projectId, removable: false, lifecycle: "durable" };
  }
  if (projectSubdir === "workflows" || STATE_FILES.has(name)) {
    return { storageClass: "state", projectId, removable: false, lifecycle: "durable" };
  }
  if (INDEX_FILES.has(name)) {
    return { storageClass: "index", projectId, removable: false, lifecycle: "durable" };
  }
  if (ext === ".tmp" || name === ".DS_Store") {
    return { storageClass: "cache", projectId, removable: true, lifecycle: "rebuildable" };
  }
  return { storageClass: "other", projectId, removable: false, lifecycle: "durable" };
}

function classifyRootEntry(rootKind: RuntimeStorageRootKind, relPath: string) {
  if (rootKind === "cache") {
    const parts = relPath.split(/[\\/]+/).filter(Boolean);
    return { storageClass: "cache" as const, projectId: parts[0] === "projects" ? parts[1] : undefined, removable: true, lifecycle: "rebuildable" as const };
  }
  if (rootKind === "log") return { storageClass: "log" as const, projectId: undefined, removable: true, lifecycle: "rotatable" as const };
  return classifyRuntimeStoragePath(relPath);
}

async function entriesForRoot(root: string, rootKind: RuntimeStorageRootKind): Promise<RuntimeStorageEntry[]> {
  const files = await walkFiles(root);
  const entries: RuntimeStorageEntry[] = [];
  for (const path of files) {
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) continue;
    const relPath = relative(root, path);
    const classified = classifyRootEntry(rootKind, relPath);
    entries.push({
      path,
      relPath,
      rootKind,
      sizeBytes: info.size,
      storageClass: classified.storageClass,
      lifecycle: classified.lifecycle,
      projectId: classified.projectId,
      removable: classified.removable,
    });
  }
  return entries;
}

export async function runtimeStorageEntries(runtimeRoot: string): Promise<RuntimeStorageEntry[]> {
  const roots = resolveRuntimeStorageRoots(runtimeRoot);
  return [
    ...(await entriesForRoot(roots.dataRoot, "data")),
    ...(await entriesForRoot(roots.cacheRoot, "cache")),
    ...(await entriesForRoot(roots.logRoot, "log")),
  ];
}

export async function runtimeStorageSummary(runtimeRoot: string): Promise<RuntimeStorageSummary> {
  const roots = resolveRuntimeStorageRoots(runtimeRoot);
  const entries = await runtimeStorageEntries(runtimeRoot);
  const buckets = new Map<RuntimeStorageClass, RuntimeStorageBucket>();
  const projects = new Map<string, RuntimeStorageProject>();
  for (const storageClass of CLASS_ORDER) {
    buckets.set(storageClass, { storageClass, sizeBytes: 0, files: 0, removableBytes: 0 });
  }
  for (const entry of entries) {
    const bucket = buckets.get(entry.storageClass)!;
    bucket.sizeBytes += entry.sizeBytes;
    bucket.files += 1;
    if (entry.removable) bucket.removableBytes += entry.sizeBytes;
    if (entry.projectId) {
      const project = projects.get(entry.projectId) ?? { projectId: entry.projectId, sizeBytes: 0, files: 0, removableBytes: 0 };
      project.sizeBytes += entry.sizeBytes;
      project.files += 1;
      if (entry.removable) project.removableBytes += entry.sizeBytes;
      projects.set(entry.projectId, project);
    }
  }
  const legacyCandidates = entries
    .filter((entry) => entry.rootKind === "data" && entry.storageClass === "cache")
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, 25);
  return {
    policyVersion: RUNTIME_STORAGE_POLICY_VERSION,
    runtimeRoot,
    dataRoot: roots.dataRoot,
    roots,
    totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    removableBytes: entries.filter((entry) => entry.removable).reduce((sum, entry) => sum + entry.sizeBytes, 0),
    buckets: Array.from(buckets.values()).filter((bucket) => bucket.files > 0 || bucket.sizeBytes > 0),
    projects: Array.from(projects.values()).sort((a, b) => b.sizeBytes - a.sizeBytes),
    largest: entries.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 25),
    legacyCandidates,
  };
}

async function dirSize(path: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const file of await walkFiles(path)) {
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) continue;
    bytes += info.size;
    files += 1;
  }
  return { bytes, files };
}

async function removeDir(root: string, path: string, deletedPaths: string[]): Promise<{ bytes: number; files: number }> {
  if (!isInside(root, path)) return { bytes: 0, files: 0 };
  const info = await stat(path).catch(() => undefined);
  if (!info?.isDirectory()) return { bytes: 0, files: 0 };
  const size = await dirSize(path);
  await rm(path, { recursive: true, force: true });
  deletedPaths.push(path);
  return size;
}

async function rotateLog(path: string, maxBytes: number, keep: number): Promise<boolean> {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile() || info.size <= maxBytes) return false;
  for (let i = keep - 1; i >= 1; i -= 1) {
    await rm(`${path}.${i + 1}`, { force: true }).catch(() => undefined);
    await rename(`${path}.${i}`, `${path}.${i + 1}`).catch(() => undefined);
  }
  await rename(path, `${path}.1`);
  await writeFile(path, "", "utf8");
  return true;
}

async function pathSize(path: string): Promise<{ bytes: number; files: number }> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return { bytes: 0, files: 0 };
  if (info.isDirectory()) return dirSize(path);
  return info.isFile() ? { bytes: info.size, files: 1 } : { bytes: 0, files: 0 };
}

async function projectIds(root: string): Promise<string[]> {
  const entries = await readdir(join(root, "projects"), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function cleanupCandidatePaths(runtimeRoot: string, input: RuntimeStorageActionInput): Promise<string[]> {
  const roots = resolveRuntimeStorageRoots(runtimeRoot);
  if (input.action === "deleteProjectCache") {
    if (!input.projectId) return [];
    return [
      join(roots.dataRoot, "projects", input.projectId, "asset_parse"),
      join(roots.cacheRoot, "projects", input.projectId, "asset_parse"),
    ];
  }
  if (input.action === "pruneLegacyCache") {
    return (await projectIds(roots.dataRoot)).map((projectId) => join(roots.dataRoot, "projects", projectId, "asset_parse"));
  }
  if (input.action === "pruneCaches" || input.action === "migrateLegacyCache") {
    const ids = Array.from(new Set([...(await projectIds(roots.dataRoot)), ...(await projectIds(roots.cacheRoot))]));
    if (input.action === "migrateLegacyCache") {
      return ids.map((projectId) => join(roots.dataRoot, "projects", projectId, "asset_parse"));
    }
    return [
      join(roots.dataRoot, "generated"),
      ...ids.flatMap((projectId) => [
        join(roots.dataRoot, "projects", projectId, "asset_parse"),
        join(roots.cacheRoot, "projects", projectId, "asset_parse"),
      ]),
    ];
  }
  if (input.action === "rotateLogs") {
    const maxBytes = input.logMaxBytes ?? 10 * 1024 * 1024;
    return (await runtimeStorageEntries(runtimeRoot))
      .filter((entry) => entry.storageClass === "log" && entry.sizeBytes > maxBytes)
      .map((entry) => entry.path);
  }
  const reportEntries = (await runtimeStorageEntries(runtimeRoot)).filter((entry) =>
    entry.rootKind === "data" &&
    entry.storageClass === "output" &&
    (entry.relPath.startsWith("reports/") || entry.relPath.startsWith("generated/"))
  );
  const rows = await Promise.all(reportEntries.map(async (entry) => ({ entry, mtimeMs: (await stat(entry.path)).mtimeMs })));
  return rows
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(input.keepNewestReports ?? 20)
    .map((row) => row.entry.path);
}

function planHash(input: RuntimeStorageActionInput, paths: string[], bytes: number, files: number): string {
  return createHash("sha256")
    .update(JSON.stringify({
      version: RUNTIME_STORAGE_POLICY_VERSION,
      action: input.action,
      projectId: input.projectId ?? null,
      keepNewestReports: input.keepNewestReports ?? null,
      logMaxBytes: input.logMaxBytes ?? null,
      logKeep: input.logKeep ?? null,
      bytes,
      files,
      paths,
    }))
    .digest("hex");
}

export async function previewRuntimeStorageAction(runtimeRoot: string, input: RuntimeStorageActionInput): Promise<RuntimeStorageCleanupPlan> {
  const paths = [...new Set(await cleanupCandidatePaths(runtimeRoot, input))].sort();
  const sizes = await Promise.all(paths.map(pathSize));
  const bytes = sizes.reduce((sum, size) => sum + size.bytes, 0);
  const files = sizes.reduce((sum, size) => sum + size.files, 0);
  const warnings = input.action === "migrateLegacyCache"
    ? ["Migration moves legacy data/projects/*/asset_parse cache into the active cache root only after execute confirmation."]
    : [];
  return {
    mode: "preview",
    action: input.action,
    projectId: input.projectId,
    planHash: planHash(input, paths, bytes, files),
    bytes,
    files,
    paths,
    warnings,
  };
}

async function migrateLegacyCache(runtimeRoot: string, paths: string[], skippedPaths: string[]): Promise<{ bytes: number; files: number; paths: string[] }> {
  const roots = resolveRuntimeStorageRoots(runtimeRoot);
  let bytes = 0;
  let files = 0;
  const movedPaths: string[] = [];
  for (const source of paths) {
    if (!isInside(roots.dataRoot, source)) continue;
    const rel = relative(roots.dataRoot, source);
    const target = join(roots.cacheRoot, rel);
    const existing = await stat(source).catch(() => undefined);
    if (!existing?.isDirectory()) continue;
    const size = await dirSize(source);
    await mkdir(join(target, ".."), { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(source, target).catch(async () => {
      skippedPaths.push(source);
    });
    if (skippedPaths.at(-1) === source) continue;
    bytes += size.bytes;
    files += size.files;
    movedPaths.push(source);
  }
  return { bytes, files, paths: movedPaths };
}

export async function executeRuntimeStorageAction(runtimeRoot: string, input: RuntimeStorageExecuteInput): Promise<RuntimeStorageCleanupResult> {
  const preview = await previewRuntimeStorageAction(runtimeRoot, input);
  if (preview.planHash !== input.planHash) {
    throw new Error("Storage cleanup plan changed; preview again before executing.");
  }
  const roots = resolveRuntimeStorageRoots(runtimeRoot);
  await mkdir(roots.dataRoot, { recursive: true });
  await mkdir(roots.cacheRoot, { recursive: true });
  await mkdir(roots.logRoot, { recursive: true });
  const deletedPaths: string[] = [];
  const skippedPaths: string[] = [];
  let deletedBytes = 0;
  let deletedFiles = 0;

  if (input.action === "rotateLogs") {
    for (const path of preview.paths) {
      const rotated = await rotateLog(path, input.logMaxBytes ?? 10 * 1024 * 1024, input.logKeep ?? 5).catch(() => false);
      if (rotated) {
        deletedFiles += 1;
        deletedPaths.push(path);
      } else {
        skippedPaths.push(path);
      }
    }
    return { mode: "execute", action: input.action, deletedBytes, deletedFiles, deletedPaths, skippedPaths, planHash: input.planHash };
  }

  if (input.action === "migrateLegacyCache") {
    const moved = await migrateLegacyCache(runtimeRoot, preview.paths, skippedPaths);
    return { mode: "execute", action: input.action, deletedBytes: moved.bytes, deletedFiles: moved.files, deletedPaths: moved.paths, skippedPaths, planHash: input.planHash };
  }

  for (const path of preview.paths) {
    const root = isInside(roots.cacheRoot, path) ? roots.cacheRoot : roots.dataRoot;
    const size = await removeDir(root, path, deletedPaths).catch(() => {
      skippedPaths.push(path);
      return { bytes: 0, files: 0 };
    });
    if (size.files === 0) {
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile() && isInside(root, path)) {
        await rm(path, { force: true });
        deletedPaths.push(path);
        deletedBytes += info.size;
        deletedFiles += 1;
        continue;
      }
    }
    deletedBytes += size.bytes;
    deletedFiles += size.files;
  }
  return { mode: "execute", action: input.action, deletedBytes, deletedFiles, deletedPaths, skippedPaths, planHash: input.planHash };
}

export async function cleanupRuntimeStorage(runtimeRoot: string, input: RuntimeStorageActionInput): Promise<RuntimeStorageCleanupResult> {
  const preview = await previewRuntimeStorageAction(runtimeRoot, input);
  return executeRuntimeStorageAction(runtimeRoot, { ...input, planHash: preview.planHash });
}

export function runtimeCacheManifestPath(outputDir: string): string {
  return join(outputDir, "la-cache.json");
}

export async function writeRuntimeCacheManifest(outputDir: string, value: unknown): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(runtimeCacheManifestPath(outputDir), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readRuntimeCacheManifest<T>(outputDir: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(runtimeCacheManifestPath(outputDir), "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function assetCacheDirName(assetPath: string, key: string): string {
  return `${basename(assetPath).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset"}-${key}`;
}
