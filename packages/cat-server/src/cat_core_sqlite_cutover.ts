import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  catCoreAuthorityMarkerPath,
  installCatCorePersistence,
  projectManifestPath,
  batchPath,
  createWorkspace,
  type CatBatch,
  type CatCoreSourceRef,
  type ProjectManifest,
  type TermbaseEntry,
  type TermbaseOverride,
  type TmEntry,
} from "@linguist-agent/cat-data";
import {
  ContentBlobStore,
  SqliteCatCoreRepository,
  SqliteEventProjectionStore,
  type SqliteStorageAuthority,
} from "@linguist-agent/storage-sqlite";

export type CatCoreSqliteAuthority = SqliteStorageAuthority;

export interface CatCoreSqliteProjectReportV1 {
  projectId: string;
  manifestBytes: number;
  manifestSha256: string;
  batchCount: number;
  segmentCount: number;
  tmCount: number;
  termbaseCount: number;
  overrideCount: number;
  sourceRefCount: number;
  status: "valid";
}

export interface CatCoreSqliteAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "sqlite";
  databaseRelativePath: string;
  blobRootRelativePath: string;
  backupRootRelativePath: string;
  cutoverAt: string;
  projects: CatCoreSqliteProjectReportV1[];
  sourceRefs: number;
  excludes: ["asset-blocks", "asset-typed-index", "asset-vectors", "source-context-index", "read-cache"];
}

export interface PreparedCatCoreSqliteCutover {
  status: "cutover" | "already-sqlite";
  root: string;
  marker: CatCoreSqliteAuthorityMarkerV1;
  markerPath: string;
  repository: SqliteCatCoreRepository;
  store: SqliteEventProjectionStore;
  blobStore: ContentBlobStore;
  close(): void;
}

const EXCLUDES: CatCoreSqliteAuthorityMarkerV1["excludes"] = ["asset-blocks", "asset-typed-index", "asset-vectors", "source-context-index", "read-cache"];
const SHA256 = /^[a-f0-9]{64}$/u;

function digestBytes(raw: Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}

function safeRelativePath(root: string, path: string, label: string): string {
  const value = relative(resolve(root), resolve(path));
  if (!value || value.startsWith("..") || isAbsolute(value)) throw new Error(`${label} must remain inside the runtime root.`);
  return value.split("\\").join("/");
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await syncFile(temporary);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function copyExact(source: string, target: string): Promise<void> {
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`CAT-core migration source must be a regular file: ${source}`);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await syncFile(target);
}

async function readOptional(path: string): Promise<Buffer | null> {
  try { return await readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function databasePath(root: string): string {
  return join(root, "data", "runtime", "cat-core-sqlite-v1", "cat-core.sqlite");
}

function blobRoot(root: string): string {
  return join(root, "data", "runtime", "cat-core-sqlite-v1", "blob-store");
}

function backupRoot(root: string): string {
  return join(root, "data", "backups", "cat-core-cutover-v1", `attempt-${Date.now()}-${process.pid}`);
}

function projectRoot(root: string, projectId: string): string {
  return join(root, "data", "projects", projectId);
}

function sourceWithinProject(manifest: ProjectManifest, sourcePath: string): boolean {
  const root = resolve(manifest.root);
  const path = resolve(sourcePath);
  const rel = relative(root, path);
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}

async function sourceRef(
  repository: SqliteCatCoreRepository,
  manifest: ProjectManifest,
  projectId: string,
  ownerKind: CatCoreSourceRef["ownerKind"],
  ownerId: string,
  sourcePath: string,
): Promise<CatCoreSourceRef> {
  if (!sourceWithinProject(manifest, sourcePath)) throw new Error(`CAT-core source ${sourcePath} escapes Project root.`);
  const metadata = await lstat(sourcePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`CAT-core source must be a regular file: ${sourcePath}`);
  const bytes = await readFile(sourcePath);
  return repository.publishSourceRef({
    projectId,
    ownerKind,
    ownerId,
    path: sourcePath,
    bytes,
    expectedSha256: digestBytes(bytes),
  });
}

async function discoverProjects(root: string): Promise<string[]> {
  const projectsPath = join(root, "data", "projects");
  const entries = await readdir(projectsPath, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const projects: string[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    if (await readOptional(projectManifestPath(root, entry.name))) projects.push(entry.name);
  }
  return projects;
}

function parseManifest(value: unknown, projectId: string): ProjectManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Project ${projectId} manifest is invalid.`);
  const manifest = value as ProjectManifest;
  if (manifest.schemaVersion !== 1 || manifest.projectId !== projectId || typeof manifest.root !== "string" || !manifest.scan || !Array.isArray(manifest.scan.assets)) {
    throw new Error(`Project ${projectId} manifest is invalid.`);
  }
  return manifest;
}

async function backupProject(root: string, attempt: string, projectId: string, manifest: ProjectManifest, files: string[]): Promise<void> {
  const target = join(attempt, "projects", projectId);
  for (const file of files) {
    await copyExact(file, join(target, "workspace", safeRelativePath(projectRoot(root, projectId), file, "CAT-core backup path")));
  }
  const sourceRoot = resolve(manifest.root);
  for (const source of manifest.scan.assets.map((asset) => asset.path)) {
    const resolvedSource = resolve(sourceRoot, source);
    const rel = relative(sourceRoot, resolvedSource);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
    if (await readOptional(resolvedSource)) await copyExact(resolvedSource, join(target, "sources", rel));
  }
}

async function parseLegacyProject(root: string, projectId: string): Promise<{
  manifest: ProjectManifest;
  manifestRaw: Buffer;
  batches: CatBatch[];
  batchFiles: string[];
  tm: TmEntry[];
  termbase: TermbaseEntry[];
  overrides: TermbaseOverride[];
  files: string[];
}> {
  const projectPath = projectRoot(root, projectId);
  const manifestFile = projectManifestPath(root, projectId);
  const manifestRaw = await readFile(manifestFile);
  const manifest = parseManifest(JSON.parse(manifestRaw.toString("utf8")) as unknown, projectId);
  const batchRoot = join(projectPath, "batches");
  const batchDirectories = await readdir(batchRoot, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const batchFiles: string[] = [];
  const batches: CatBatch[] = [];
  for (const entry of batchDirectories.filter((candidate) => candidate.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = batchPath(createWorkspace(root, projectId), entry.name);
    const raw = await readFile(path);
    const batch = JSON.parse(raw.toString("utf8")) as CatBatch;
    if (batch.schemaVersion !== 1 || batch.projectId !== projectId || batch.batchId !== entry.name || !Array.isArray(batch.segments)) throw new Error(`CAT-core batch ${projectId}/${entry.name} is invalid.`);
    batches.push(batch);
    batchFiles.push(path);
  }
  const tmPath = join(projectPath, "tm.json");
  const termbasePath = join(projectPath, "termbase.json");
  const overridesPath = join(projectPath, "termbase_overrides.json");
  const tm = JSON.parse((await readOptional(tmPath))?.toString("utf8") ?? "[]") as TmEntry[];
  const termbase = JSON.parse((await readOptional(termbasePath))?.toString("utf8") ?? "[]") as TermbaseEntry[];
  const overrides = JSON.parse((await readOptional(overridesPath))?.toString("utf8") ?? "[]") as TermbaseOverride[];
  const files = [manifestFile, ...batchFiles, ...(await readOptional(tmPath) ? [tmPath] : []), ...(await readOptional(termbasePath) ? [termbasePath] : []), ...(await readOptional(overridesPath) ? [overridesPath] : [])];
  return { manifest, manifestRaw, batches, batchFiles, tm, termbase, overrides, files };
}

async function readMarker(root: string): Promise<CatCoreSqliteAuthorityMarkerV1 | null> {
  try {
    const value = JSON.parse(await readFile(catCoreAuthorityMarkerPath(root), "utf8")) as CatCoreSqliteAuthorityMarkerV1;
    if (value.schemaVersion !== 1 || value.authority !== "sqlite" || JSON.stringify(value.excludes) !== JSON.stringify(EXCLUDES) || !Array.isArray(value.projects) || value.projects.some((project) => !project || !SHA256.test(project.manifestSha256))) throw new Error("SQLite CAT-core authority marker is invalid.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function prepareCatCoreSqliteCutover(input: {
  root: string;
  authority: CatCoreSqliteAuthority;
  activeRunCount: number;
  now?: () => Date;
}): Promise<PreparedCatCoreSqliteCutover> {
  if (!Number.isSafeInteger(input.activeRunCount) || input.activeRunCount < 0) throw new Error("activeRunCount must be non-negative.");
  if (input.activeRunCount !== 0) throw new Error("CAT-core cutover is blocked while Agent Runs are active.");
  const root = resolve(input.root);
  await input.authority.assertOwned();
  const existing = await readMarker(root);
  const database = existing ? resolve(root, existing.databaseRelativePath) : databasePath(root);
  const blobs = existing ? resolve(root, existing.blobRootRelativePath) : blobRoot(root);
  const store = new SqliteEventProjectionStore(database);
  const blobStore = new ContentBlobStore(blobs, { authority: input.authority });
  const repository = new SqliteCatCoreRepository({ root, store, blobStore, authority: input.authority });
  if (existing) return { status: "already-sqlite", root, marker: existing, markerPath: catCoreAuthorityMarkerPath(root), repository, store, blobStore, close: () => store.close() };

  const attempt = backupRoot(root);
  let markerPublished = false;
  const reports: CatCoreSqliteProjectReportV1[] = [];
  let sourceRefCount = 0;
  try {
    await mkdir(attempt, { recursive: true, mode: 0o700 });
    for (const projectId of await discoverProjects(root)) {
      const legacy = await parseLegacyProject(root, projectId);
      let projectSourceRefs = 0;
      await backupProject(root, attempt, projectId, legacy.manifest, legacy.files);
      await repository.writeProjectManifest(projectId, legacy.manifest, null);
      for (const batch of legacy.batches) {
        await repository.writeBatch(projectId, batch.batchId, batch, null);
        const refs: CatCoreSourceRef[] = [];
        for (const sourcePath of [batch.sourceFile, batch.masterFile].filter((path): path is string => Boolean(path))) {
          refs.push(await sourceRef(repository, legacy.manifest, projectId, "batch", batch.batchId, sourcePath));
        }
        if (refs.length) {
          sourceRefCount += refs.length;
          projectSourceRefs += refs.length;
        }
      }
      await repository.writeTm(projectId, legacy.tm, null);
      await repository.writeTermbase(projectId, { entries: legacy.termbase, overrides: legacy.overrides }, null);
      for (const asset of legacy.manifest.scan.assets) {
        const resolvedSource = resolve(legacy.manifest.root, asset.path);
        await sourceRef(repository, legacy.manifest, projectId, "asset", asset.relPath, resolvedSource);
        sourceRefCount += 1;
        projectSourceRefs += 1;
      }
      const roundManifest = await repository.readProjectManifest(projectId);
      const roundBatches = await repository.listBatches(projectId);
      const roundTm = await repository.readTm(projectId);
      const roundTermbase = await repository.readTermbase(projectId);
      if (!roundManifest || stableJson(roundManifest) !== stableJson(legacy.manifest) || roundBatches.length !== legacy.batches.length || stableJson(roundTm) !== stableJson(legacy.tm) || stableJson(roundTermbase.entries) !== stableJson(legacy.termbase) || stableJson(roundTermbase.overrides) !== stableJson(legacy.overrides)) {
        throw new Error(`CAT-core SQLite parity failed for Project ${projectId}.`);
      }
      reports.push({
        projectId,
        manifestBytes: legacy.manifestRaw.byteLength,
        manifestSha256: digestBytes(legacy.manifestRaw),
        batchCount: legacy.batches.length,
        segmentCount: legacy.batches.reduce((total, batch) => total + batch.segments.length, 0),
        tmCount: legacy.tm.length,
        termbaseCount: legacy.termbase.length,
        overrideCount: legacy.overrides.length,
        sourceRefCount: projectSourceRefs,
        status: "valid",
      });
    }
    const databaseRelativePath = safeRelativePath(root, database, "SQLite CAT-core database path");
    const blobRootRelativePath = safeRelativePath(root, blobs, "SQLite CAT-core blob root");
    const backupRootRelativePath = safeRelativePath(root, attempt, "SQLite CAT-core backup root");
    await writeAtomicJson(join(attempt, "import-report-v1.json"), { schemaVersion: 1, valid: reports, invalid: [] });
    const marker: CatCoreSqliteAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath,
      blobRootRelativePath,
      backupRootRelativePath,
      cutoverAt: (input.now?.() ?? new Date()).toISOString(),
      projects: reports,
      sourceRefs: sourceRefCount,
      excludes: EXCLUDES,
    };
    await input.authority.assertOwned();
    await writeAtomicJson(catCoreAuthorityMarkerPath(root), marker);
    markerPublished = true;
    return { status: "cutover", root, marker, markerPath: catCoreAuthorityMarkerPath(root), repository, store, blobStore, close: () => store.close() };
  } catch (error) {
    store.close();
    if (!markerPublished) {
      await Promise.all([
        rm(database, { force: true }),
        rm(`${database}-wal`, { force: true }),
        rm(`${database}-shm`, { force: true }),
        rm(blobs, { recursive: true, force: true }),
        rm(join(root, "data", "runtime", "cat-core-sqlite-v1", "read-cache"), { recursive: true, force: true }),
        rm(attempt, { recursive: true, force: true }),
      ]);
    }
    throw error;
  }
}

export function activateCatCoreSqliteCutover(prepared: PreparedCatCoreSqliteCutover): void {
  installCatCorePersistence(prepared.root, prepared.repository);
}
