import { createHash } from "node:crypto";
import { glob, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  DefaultPackageManager,
  loadProjectContextFiles,
  SettingsManager,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";

export type GeneralResourceType = "extension" | "skill" | "prompt" | "theme" | "context" | "system" | "append_system";
export type GeneralResourceScope = "user" | "project" | "temporary";

export interface GeneralResourceSnapshotEntry {
  type: GeneralResourceType;
  /** Display/load path selected by Pi resource precedence. */
  path: string;
  /** Canonical path used for approval and change detection. */
  resolvedPath: string;
  source: string;
  scope: GeneralResourceScope;
  origin: "package" | "top-level";
  sha256: string;
  sizeBytes: number;
}

export interface GeneralResourceSnapshot {
  entries: GeneralResourceSnapshotEntry[];
  extensionPaths: string[];
  skillPaths: string[];
  promptPaths: string[];
  themePaths: string[];
  contextFiles: Array<{ path: string; content: string }>;
  systemPrompt?: string;
  appendSystemPrompt: string[];
  resourceSetHash: string;
}

export interface AuthorizedExtensionStage {
  originalResolvedPath: string;
  sourceSha256: string;
  stagedPath: string;
  stagedSha256: string;
  sizeBytes: number;
}

export interface GeneralManagedResourcePaths {
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
}

const MANAGED_PATTERNS: Record<Exclude<GeneralResourceType, "context" | "system" | "append_system">, string> = {
  extension: "**/*.{ts,js}",
  skill: "**/SKILL.md",
  prompt: "**/*.md",
  theme: "**/*.json",
};

function inside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function hasGlob(path: string): boolean {
  return /[*?[{]/.test(path);
}

async function expandManagedPaths(paths: string[], type: keyof typeof MANAGED_PATTERNS): Promise<string[]> {
  const expanded: string[] = [];
  for (const input of paths) {
    if (hasGlob(input)) {
      for await (const match of glob(input, { exclude: (path) => path.includes("/node_modules/") })) expanded.push(resolve(match));
      continue;
    }
    const info = await stat(input).catch(() => undefined);
    if (!info) throw new Error(`Approved managed ${type} resource is unavailable: ${input}`);
    if (info.isFile()) {
      expanded.push(resolve(input));
      continue;
    }
    if (!info.isDirectory()) throw new Error(`Approved managed ${type} resource is not a file or directory: ${input}`);
    for await (const match of glob(join(resolve(input), MANAGED_PATTERNS[type]), {
      exclude: (path) => path.includes("/node_modules/"),
    })) expanded.push(resolve(match));
  }
  return [...new Set(expanded)].sort();
}

function enabled(resources: ResolvedResource[]): ResolvedResource[] {
  return resources.filter((resource) => resource.enabled);
}

async function snapshotEntry(
  type: GeneralResourceType,
  path: string,
  metadata: { source: string; scope: GeneralResourceScope; origin: "package" | "top-level" },
): Promise<GeneralResourceSnapshotEntry> {
  const [bytes, resolvedPath] = await Promise.all([readFile(path), realpath(path)]);
  return {
    type,
    path,
    resolvedPath,
    ...metadata,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
  };
}

function mergeByCanonicalPath(primary: ResolvedResource[], secondary: ResolvedResource[]): ResolvedResource[] {
  const seen = new Set<string>();
  const merged: ResolvedResource[] = [];
  for (const resource of [...primary, ...secondary]) {
    const key = resolve(resource.path);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(resource);
  }
  return merged;
}

async function managedResources(paths: GeneralManagedResourcePaths): Promise<{
  extensions: ResolvedResource[];
  skills: ResolvedResource[];
  prompts: ResolvedResource[];
  themes: ResolvedResource[];
}> {
  const metadata = { source: "la-managed", scope: "temporary" as const, origin: "package" as const };
  const [extensions, skills, prompts, themes] = await Promise.all([
    expandManagedPaths(paths.extensions, "extension"),
    expandManagedPaths(paths.skills, "skill"),
    expandManagedPaths(paths.prompts, "prompt"),
    expandManagedPaths(paths.themes, "theme"),
  ]);
  const rows = (values: string[]) => values.map((path) => ({ path, enabled: true, metadata }));
  return { extensions: rows(extensions), skills: rows(skills), prompts: rows(prompts), themes: rows(themes) };
}

function stableResourceSetHash(entries: GeneralResourceSnapshotEntry[]): string {
  const shape = entries.map((entry) => ({
    type: entry.type,
    path: entry.resolvedPath,
    source: entry.source,
    scope: entry.scope,
    origin: entry.origin,
    sha256: entry.sha256,
  }));
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}

/**
 * Replace discovered executable paths with the exact content-addressed bytes
 * approved by the host. A loader must never receive the original path after
 * authorization because that would reopen a verify/load race.
 */
export function useAuthorizedExtensionStages(
  snapshot: GeneralResourceSnapshot,
  authorizations: AuthorizedExtensionStage[],
): GeneralResourceSnapshot {
  const bySource = new Map(authorizations.map((entry) => [entry.originalResolvedPath, entry]));
  const entries = snapshot.entries.map((entry): GeneralResourceSnapshotEntry => {
    if (entry.type !== "extension") return entry;
    const authorization = bySource.get(entry.resolvedPath);
    if (!authorization || authorization.sourceSha256 !== entry.sha256) {
      throw new Error(`Pi Extension has no exact staged-byte authorization: ${entry.path}`);
    }
    return {
      ...entry,
      path: authorization.stagedPath,
      resolvedPath: authorization.stagedPath,
      sha256: authorization.stagedSha256,
      sizeBytes: authorization.sizeBytes,
    };
  });
  return {
    ...snapshot,
    entries,
    extensionPaths: entries.filter((entry) => entry.type === "extension").map((entry) => entry.path),
    resourceSetHash: stableResourceSetHash(entries),
  };
}

/**
 * Resolve Pi resources without evaluating Extension modules, then freeze their
 * exact files/content for one canonical Run. Missing configured packages are
 * never installed as a side effect of General Chat startup.
 */
export async function buildGeneralResourceSnapshot(input: {
  cwd: string;
  agentDir: string;
  settingsManager: SettingsManager;
  projectTrusted: boolean;
  includeExecutableExtensions?: boolean;
  managedResources?: GeneralManagedResourcePaths;
}): Promise<GeneralResourceSnapshot> {
  const packageManager = new DefaultPackageManager({
    cwd: input.cwd,
    agentDir: input.agentDir,
    settingsManager: input.settingsManager,
  });
  const inherited = await packageManager.resolve(async (source) => {
    throw new Error(`Configured Pi package ${source} is missing. Install and approve it before starting a General Run.`);
  });
  const managed = await managedResources(input.managedResources ?? { extensions: [], skills: [], prompts: [], themes: [] });
  const groups: Array<[GeneralResourceType, ResolvedResource[]]> = [
    ["extension", input.includeExecutableExtensions === false ? [] : mergeByCanonicalPath(managed.extensions, enabled(inherited.extensions))],
    ["skill", mergeByCanonicalPath(managed.skills, enabled(inherited.skills))],
    ["prompt", mergeByCanonicalPath(managed.prompts, enabled(inherited.prompts))],
    ["theme", mergeByCanonicalPath(managed.themes, enabled(inherited.themes))],
  ];
  const entries: GeneralResourceSnapshotEntry[] = [];
  for (const [type, resources] of groups) {
    for (const resource of resources) entries.push(await snapshotEntry(type, resource.path, resource.metadata));
  }

  const contextFiles = loadProjectContextFiles({ cwd: input.cwd, agentDir: input.agentDir })
    .filter((file) => input.projectTrusted || inside(input.agentDir, file.path));
  for (const file of contextFiles) {
    entries.push(await snapshotEntry("context", file.path, {
      source: "local",
      scope: inside(input.agentDir, file.path) ? "user" : "project",
      origin: "top-level",
    }));
  }

  const projectSystemPath = join(input.cwd, ".pi", "SYSTEM.md");
  const globalSystemPath = join(input.agentDir, "SYSTEM.md");
  const systemPath = input.projectTrusted && await stat(projectSystemPath).then((value) => value.isFile(), () => false)
    ? projectSystemPath
    : await stat(globalSystemPath).then((value) => value.isFile(), () => false) ? globalSystemPath : undefined;
  const projectAppendPath = join(input.cwd, ".pi", "APPEND_SYSTEM.md");
  const globalAppendPath = join(input.agentDir, "APPEND_SYSTEM.md");
  const appendPath = input.projectTrusted && await stat(projectAppendPath).then((value) => value.isFile(), () => false)
    ? projectAppendPath
    : await stat(globalAppendPath).then((value) => value.isFile(), () => false) ? globalAppendPath : undefined;
  let systemPrompt: string | undefined;
  if (systemPath) {
    systemPrompt = await readFile(systemPath, "utf8");
    entries.push(await snapshotEntry("system", systemPath, {
      source: "local",
      scope: inside(input.agentDir, systemPath) ? "user" : "project",
      origin: "top-level",
    }));
  }
  const appendSystemPrompt: string[] = [];
  if (appendPath) {
    appendSystemPrompt.push(await readFile(appendPath, "utf8"));
    entries.push(await snapshotEntry("append_system", appendPath, {
      source: "local",
      scope: inside(input.agentDir, appendPath) ? "user" : "project",
      origin: "top-level",
    }));
  }

  return {
    entries,
    extensionPaths: groups[0]![1].map((resource) => resource.path),
    skillPaths: groups[1]![1].map((resource) => resource.path),
    promptPaths: groups[2]![1].map((resource) => resource.path),
    themePaths: groups[3]![1].map((resource) => resource.path),
    contextFiles,
    systemPrompt,
    appendSystemPrompt,
    resourceSetHash: stableResourceSetHash(entries),
  };
}

export async function verifyGeneralResourceSnapshot(snapshot: GeneralResourceSnapshot): Promise<void> {
  for (const entry of snapshot.entries) {
    const [bytes, resolvedPath] = await Promise.all([
      readFile(entry.path).catch(() => undefined),
      realpath(entry.path).catch(() => undefined),
    ]);
    const sha256 = bytes ? createHash("sha256").update(bytes).digest("hex") : undefined;
    if (!bytes || resolvedPath !== entry.resolvedPath || sha256 !== entry.sha256) {
      throw new Error(`Pi resource changed after the Run snapshot was fixed: ${entry.path}`);
    }
  }
}
