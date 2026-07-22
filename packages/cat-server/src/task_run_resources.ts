import { createHash } from "node:crypto";
import { constants, lstatSync } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
  getAgentDir,
  type PackageManager,
} from "@earendil-works/pi-coding-agent";
import type { TaskRunResourceManifest } from "@linguist-agent/cat-data";
import {
  combineCatRequestShapes,
  NATIVE_CAPABILITY_PACKAGES,
  type CatRequestShapeManifest,
  type CatIsolatedResources,
  type NativeCapabilityPackage,
  type NativeCapabilityPackageId,
} from "@linguist-agent/cat-runtime";
import {
  verifyNativeCapabilityPatch,
  type NativeCapabilityPatchId,
} from "./native_capability_patches.js";

export type TaskRunResourceProfile = "main" | "team";

const SERVER_OWNED_RUN_DENIED_TOOLS = ["subagent", "wait"] as const;

/**
 * Main, Team, and Eval tool surfaces are server-owned profiles. The legacy
 * project value remains readable for backward-compatible decoding, but it is
 * deliberately not merged into a canonical Run.
 */
export function serverOwnedRunDisabledTools(_legacyProjectDisabledTools?: readonly string[]): string[] {
  return [...SERVER_OWNED_RUN_DENIED_TOOLS];
}

export interface TaskRunIntegrityInput {
  packageRoot: string;
  packageName: string;
  version: string;
  integrity: string;
}

export interface TaskRunResourceEnvironment {
  cwd: string;
  agentDir?: string;
  packageManager?: Pick<PackageManager, "getInstalledPath">;
  verifyIntegrity?: (input: TaskRunIntegrityInput) => Promise<boolean>;
  verifyPatch?: (id: NativeCapabilityPatchId, packageRoot: string) => Promise<string>;
  expectedTreeHashes?: Readonly<Record<string, string>>;
}

export interface ResolvedTaskRunResources {
  isolatedResources: CatIsolatedResources;
  manifest: TaskRunResourceManifest;
  /**
   * Absolute Pi CLI path derived from the same verified host-package graph as
   * a Team manifest. Runtime-only: this property is deliberately
   * non-enumerable and must never be persisted in the canonical manifest.
   */
  verifiedPiBinaryPath?: string;
}

export function composeTeamRunResourceManifest(input: {
  packages: TaskRunResourceManifest["packages"];
  supervisor: CatRequestShapeManifest;
  children: CatRequestShapeManifest;
  profileRevision?: number | null;
  profileHash?: string | null;
  resources?: TaskRunResourceManifest["resources"];
  previous?: TaskRunResourceManifest;
}): TaskRunResourceManifest {
  const mainSurface = input.previous?.profile === "main" || input.previous?.profile === "main+team"
    ? input.previous.mainSurface
    : undefined;
  if ((input.previous?.profile === "main" || input.previous?.profile === "main+team") && !mainSurface) {
    throw new Error("A legacy Main Run without mainSurface cannot be promoted to Team; retry in a new Run.");
  }
  const packageByName = new Map<string, TaskRunResourceManifest["packages"][number]>();
  for (const entry of [...(input.previous?.packages ?? []), ...input.packages]) {
    const existing = packageByName.get(entry.name);
    if (existing && (existing.source !== entry.source || existing.version !== entry.version || existing.integrity !== entry.integrity)) {
      throw new Error(`Run Package ${entry.name} changed during Main to Team promotion.`);
    }
    packageByName.set(entry.name, entry);
  }
  const shape = combineCatRequestShapes({
    scope: mainSurface ? "main-team-run-v1" : "team-run-v1",
    surfaces: [
      ...(mainSurface ? [{ id: "main", manifest: mainSurface.requestShape }] : []),
      { id: "supervisor", manifest: input.supervisor },
      { id: "children", manifest: input.children },
    ],
  });
  const profileRevision = input.profileRevision !== undefined ? input.profileRevision : input.previous?.profileRevision;
  const profileHash = input.profileHash !== undefined ? input.profileHash : input.previous?.profileHash;
  const resources = input.resources !== undefined ? input.resources : input.previous?.resources;
  return {
    profile: mainSurface ? "main+team" : "team",
    packages: [...packageByName.values()],
    activeToolNames: shape.activeToolNames,
    ...(profileRevision !== undefined ? { profileRevision } : {}),
    ...(profileHash !== undefined ? { profileHash } : {}),
    ...(resources !== undefined ? { resources } : {}),
    requestShapeHash: shape.requestShapeHash,
    systemPromptHash: shape.systemPromptHash,
    toolSurfaceHash: shape.toolSurfaceHash,
    resourceIndexHash: shape.resourceIndexHash,
    requestShape: {
      schemaVersion: shape.schemaVersion,
      systemPromptChars: shape.systemPromptChars,
      activeToolCount: shape.activeToolCount,
      resourceCount: shape.resourceCount,
    },
    ...(mainSurface ? { mainSurface } : {}),
  };
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// These hashes cover each Package's complete installed file tree plus its
// actually-installed dependency closure. Platform packages make the closure
// target-specific; add a separately verified row before supporting another
// native build target.
const APPROVED_TREE_HASHES_BY_TARGET: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "darwin-arm64": {
    subagents: "sha256-yM82TagnusQiMtgXXnUrSddHQg94nldVSN2e1w42JAY=",
    docparser: "sha256-uV1rTZQZDFShETpj8eKMOzE/t74PhBveBnS/Fx4NPD8=",
    ask: "sha256-+wpitMuppb0GPbpG2+8aJbr2veEJohqBFA+pixZUkTo=",
    research: "sha256-uJkQB4CPOIF3NXH1ygz1YNQbSZDPBuenZIfn1fx8720=",
  },
};

interface PackageLockEntry {
  version?: unknown;
  integrity?: unknown;
  dependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
}

interface PackageLockDocument {
  packages?: Record<string, PackageLockEntry>;
}

const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent" as const;

const AUDITED_PI_HOST_PEERS = [
  PI_CODING_AGENT_PACKAGE,
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
  "typebox",
] as const;

type AuditedPiHostPeer = typeof AUDITED_PI_HOST_PEERS[number];

interface PiHostPeerRequirement {
  packageName: AuditedPiHostPeer;
  requestedBy: string;
  requestedByVersion: string;
  range: string;
}

interface ResolvedNativeCapabilityPackage {
  extensionPath: string;
  manifest: TaskRunResourceManifest["packages"][number];
  peerRequirements: PiHostPeerRequirement[];
}

type VerificationHashChunk = string | Buffer;

interface TaskRunVerificationGraph {
  pathStates: Map<string, string>;
  fileBytes: Map<string, Buffer>;
  packageTreeChunks: Map<string, VerificationHashChunk[]>;
}

interface VerifiedTaskRunResourceCacheEntry {
  result: ResolvedTaskRunResources;
  pathStates: ReadonlyMap<string, string>;
}

const verifiedTaskRunResourceCache = new Map<string, VerifiedTaskRunResourceCacheEntry>();
const taskRunResourceResolutions = new Map<string, Promise<ResolvedTaskRunResources>>();
const cacheIdentityIds = new WeakMap<object, number>();
let nextCacheIdentityId = 1;
let taskRunResourceCacheGeneration = 0;

function cacheIdentity(value: object | undefined, fallback: string): string {
  if (!value) return fallback;
  let id = cacheIdentityIds.get(value);
  if (!id) {
    id = nextCacheIdentityId++;
    cacheIdentityIds.set(value, id);
  }
  return String(id);
}

function newVerificationGraph(): TaskRunVerificationGraph {
  return {
    pathStates: new Map(),
    fileBytes: new Map(),
    packageTreeChunks: new Map(),
  };
}

function pathStateSignature(info: Awaited<ReturnType<typeof lstat>>): string {
  const kind = info.isFile() ? "file" : info.isDirectory() ? "directory" : info.isSymbolicLink() ? "symlink" : "other";
  return [kind, info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeMs, info.ctimeMs].join(":");
}

function recordPathState(graph: TaskRunVerificationGraph, path: string, state: string): void {
  const normalized = resolve(path);
  const previous = graph.pathStates.get(normalized);
  if (previous !== undefined && previous !== state) {
    throw new Error(`Task Run resource changed during verification: ${normalized}`);
  }
  graph.pathStates.set(normalized, state);
}

async function readStableFile(path: string, graph: TaskRunVerificationGraph): Promise<Buffer> {
  const normalized = resolve(path);
  const cached = graph.fileBytes.get(normalized);
  if (cached) return cached;
  const before = await lstat(normalized);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Task Run verification input is not a regular file: ${normalized}`);
  const bytes = await readFile(normalized);
  const after = await lstat(normalized);
  const beforeState = pathStateSignature(before);
  const afterState = pathStateSignature(after);
  if (beforeState !== afterState) throw new Error(`Task Run resource changed while it was read: ${normalized}`);
  recordPathState(graph, normalized, afterState);
  graph.fileBytes.set(normalized, bytes);
  return bytes;
}

async function verificationStateMatches(states: ReadonlyMap<string, string>): Promise<boolean> {
  for (const [path, expected] of states) {
    try {
      if (pathStateSignature(lstatSync(path)) !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function cloneResolvedTaskRunResources(value: ResolvedTaskRunResources): ResolvedTaskRunResources {
  return resolvedTaskRunResources({
    isolatedResources: {
      ...value.isolatedResources,
      extensionPaths: [...(value.isolatedResources.extensionPaths ?? [])],
    },
    manifest: {
      ...value.manifest,
      packages: value.manifest.packages.map((entry) => ({ ...entry })),
      activeToolNames: [...value.manifest.activeToolNames],
    },
  }, value.verifiedPiBinaryPath);
}

function resolvedTaskRunResources(
  value: Omit<ResolvedTaskRunResources, "verifiedPiBinaryPath">,
  verifiedPiBinaryPath?: string,
): ResolvedTaskRunResources {
  if (verifiedPiBinaryPath) {
    Object.defineProperty(value, "verifiedPiBinaryPath", {
      value: verifiedPiBinaryPath,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return value;
}

/** Clear all process-local verified resource entries after a controlled Package mutation. */
export function invalidateTaskRunResourceCache(): void {
  taskRunResourceCacheGeneration += 1;
  verifiedTaskRunResourceCache.clear();
  taskRunResourceResolutions.clear();
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function optionalPeerNames(value: unknown): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Set();
  return new Set(Object.entries(value).flatMap(([name, metadata]) => (
    metadata && typeof metadata === "object" && !Array.isArray(metadata) && (metadata as { optional?: unknown }).optional === true
      ? [name]
      : []
  )));
}

function hostPeerRequirements(
  packageJson: Record<string, unknown>,
  packageName: string,
  packageVersion: string,
): PiHostPeerRequirement[] {
  const peers = stringRecord(packageJson.peerDependencies);
  const optional = optionalPeerNames(packageJson.peerDependenciesMeta);
  const audited = new Set<string>(AUDITED_PI_HOST_PEERS);
  for (const name of Object.keys(peers)) {
    if (!audited.has(name) && !optional.has(name)) {
      throw new Error(`Native capability Package declares an unaudited required host peer: ${packageName} -> ${name}`);
    }
  }
  return AUDITED_PI_HOST_PEERS.flatMap((name) => {
    const range = peers[name];
    return range === undefined ? [] : [{ packageName: name, requestedBy: packageName, requestedByVersion: packageVersion, range }];
  });
}

function packageInstallRoot(packageRoot: string, packageName: string): string {
  let nodeModules = resolve(packageRoot);
  for (const _ of packageName.split("/")) nodeModules = dirname(nodeModules);
  if (basename(nodeModules) !== "node_modules") throw new Error(`Native capability package is not under node_modules: ${packageName}`);
  return dirname(nodeModules);
}

async function hashPackageDirectory(
  hash: ReturnType<typeof createHash>,
  packagePath: string,
  packageKey: string,
  graph: TaskRunVerificationGraph,
): Promise<void> {
  const treeKey = `${resolve(packagePath)}\0${packageKey}`;
  const cached = graph.packageTreeChunks.get(treeKey);
  if (cached) {
    for (const chunk of cached) hash.update(chunk);
    return;
  }
  const chunks: VerificationHashChunk[] = [];
  const walk = async (directory: string, relativePath = ""): Promise<void> => {
    const beforeDirectory = await lstat(directory);
    if (!beforeDirectory.isDirectory() || beforeDirectory.isSymbolicLink()) {
      throw new Error(`Native capability package tree contains an unsupported directory: ${packageKey}/${relativePath}`);
    }
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!relativePath && entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Native capability package tree contains a symlink: ${packageKey}/${child}`);
      if (info.isDirectory()) {
        chunks.push(`D\0${packageKey}/${child}\0`);
        await walk(path, child);
      } else if (info.isFile()) {
        chunks.push(`F\0${packageKey}/${child}\0${info.size}\0`);
        chunks.push(await readStableFile(path, graph));
        chunks.push("\0");
      } else {
        throw new Error(`Native capability package tree contains an unsupported entry: ${packageKey}/${child}`);
      }
    }
    const afterDirectory = await lstat(directory);
    const beforeState = pathStateSignature(beforeDirectory);
    const afterState = pathStateSignature(afterDirectory);
    if (beforeState !== afterState) throw new Error(`Native capability package tree changed during verification: ${packageKey}/${relativePath}`);
    recordPathState(graph, directory, afterState);
  };
  await walk(packagePath);
  graph.packageTreeChunks.set(treeKey, chunks);
  for (const chunk of chunks) hash.update(chunk);
}

function resolveDependencyKey(
  packageKey: string,
  dependencyName: string,
  packages: Record<string, PackageLockEntry>,
): string | undefined {
  let owner = packageKey;
  for (;;) {
    const nested = `${owner}/node_modules/${dependencyName}`;
    if (packages[nested]) return nested;
    const marker = owner.lastIndexOf("/node_modules/");
    if (marker < 0) break;
    owner = owner.slice(0, marker);
  }
  const root = `node_modules/${dependencyName}`;
  return packages[root] ? root : undefined;
}

async function installedPackageDirectory(installRoot: string, packageKey: string): Promise<boolean> {
  const packagePath = resolve(installRoot, ...packageKey.split("/"));
  try {
    const info = await lstat(packagePath);
    if (info.isSymbolicLink()) {
      throw new Error(`Native capability dependency is a symlink: ${packageKey}`);
    }
    if (!info.isDirectory()) {
      throw new Error(`Native capability dependency is not a directory: ${packageKey}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function computeLockedPackageClosureIntegrity(input: {
  installRoot: string;
  rootKey: string;
  verificationGraph?: TaskRunVerificationGraph;
}): Promise<string> {
  const installRoot = resolve(input.installRoot);
  const graph = input.verificationGraph ?? newVerificationGraph();
  const lock = JSON.parse((await readStableFile(join(installRoot, "package-lock.json"), graph)).toString("utf8")) as PackageLockDocument;
  const packages = lock.packages ?? {};
  const rootKey = input.rootKey.split("\\").join("/");
  if (!rootKey.startsWith("node_modules/") || !packages[rootKey]) {
    throw new Error(`Native capability package is missing from package-lock.json: ${rootKey}`);
  }
  const closure = new Set<string>();
  const queue = [rootKey];
  while (queue.length) {
    const key = queue.shift()!;
    if (closure.has(key)) continue;
    const entry = packages[key];
    if (!entry) throw new Error(`Native capability dependency is missing from package-lock.json: ${key}`);
    closure.add(key);
    const required = Object.keys(entry.dependencies ?? {});
    const optional = Object.keys(entry.optionalDependencies ?? {});
    for (const dependencyName of required) {
      const dependencyKey = resolveDependencyKey(key, dependencyName, packages);
      if (!dependencyKey) {
        throw new Error(`Native capability dependency is not installed: ${key} -> ${dependencyName}`);
      }
      if (!await installedPackageDirectory(installRoot, dependencyKey)) {
        throw new Error(`Native capability dependency is not installed: ${key} -> ${dependencyName}`);
      }
      queue.push(dependencyKey);
    }
    for (const dependencyName of optional) {
      const dependencyKey = resolveDependencyKey(key, dependencyName, packages);
      if (dependencyKey && await installedPackageDirectory(installRoot, dependencyKey)) queue.push(dependencyKey);
    }
  }

  const hash = createHash("sha256");
  for (const key of [...closure].sort()) {
    const packagePath = resolve(installRoot, ...key.split("/"));
    if (!inside(resolve(installRoot, "node_modules"), packagePath)) {
      throw new Error(`Native capability dependency escapes node_modules: ${key}`);
    }
    const entry = packages[key]!;
    hash.update(`P\0${key}\0${String(entry.version ?? "")}\0${String(entry.integrity ?? "")}\0`);
    await hashPackageDirectory(hash, packagePath, key, graph);
  }
  return `sha256-${hash.digest("base64")}`;
}

export async function computeInstalledPackageClosureIntegrity(input: {
  packageRoot: string;
  packageName: string;
  verificationGraph?: TaskRunVerificationGraph;
}): Promise<string> {
  return computeLockedPackageClosureIntegrity({
    installRoot: packageInstallRoot(input.packageRoot, input.packageName),
    rootKey: `node_modules/${input.packageName}`,
    verificationGraph: input.verificationGraph,
  });
}

async function verifyPackageLockIntegrity(input: TaskRunIntegrityInput, graph: TaskRunVerificationGraph): Promise<boolean> {
  const installRoot = packageInstallRoot(input.packageRoot, input.packageName);
  const nodeModules = join(installRoot, "node_modules");
  if (resolve(input.packageRoot) !== resolve(nodeModules, ...input.packageName.split("/"))) return false;
  try {
    const lock = JSON.parse((await readStableFile(join(installRoot, "package-lock.json"), graph)).toString("utf8")) as {
      packages?: Record<string, { version?: unknown; integrity?: unknown }>;
    };
    const entry = lock.packages?.[`node_modules/${input.packageName}`];
    return entry?.version === input.version && entry.integrity === input.integrity;
  } catch {
    return false;
  }
}

async function resolveExtensionPath(packageRoot: string, extensionPath: string): Promise<string> {
  const candidate = resolve(packageRoot, extensionPath);
  if (!inside(packageRoot, candidate)) throw new Error(`Native capability extension escapes package root: ${extensionPath}`);
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new Error(`Native capability extension is missing: ${extensionPath}`);
  }
  if (!inside(packageRoot, resolved)) throw new Error(`Native capability extension escapes package root: ${extensionPath}`);
  if (!(await stat(resolved)).isFile()) throw new Error(`Native capability extension is not a file: ${extensionPath}`);
  return resolved;
}

async function resolveManagedPackageRoot(
  entry: NativeCapabilityPackage,
  installedPath: string,
  agentDir: string,
): Promise<string> {
  const packageParts = entry.packageName.split("/");
  const expectedPath = resolve(agentDir, "npm", "node_modules", ...packageParts);
  if (resolve(installedPath) !== expectedPath) {
    throw new Error(`Native capability package is outside the managed npm install root: ${entry.source}`);
  }

  let nodeModulesRoot: string;
  let packageRoot: string;
  try {
    nodeModulesRoot = await realpath(resolve(agentDir, "npm", "node_modules"));
    packageRoot = await realpath(installedPath);
  } catch {
    throw new Error(`Required native capability package is not installed: ${entry.source}`);
  }
  const expectedRealPath = resolve(nodeModulesRoot, ...packageParts);
  if (packageRoot !== expectedRealPath || !inside(nodeModulesRoot, packageRoot)) {
    throw new Error(`Native capability package root was replaced or escaped managed npm: ${entry.source}`);
  }
  return packageRoot;
}

async function readPackageIdentity(packageRoot: string, graph: TaskRunVerificationGraph): Promise<{
  document: Record<string, unknown>;
  name: string;
  version: string;
}> {
  const bytes = await readStableFile(join(packageRoot, "package.json"), graph);
  const document = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (typeof document.name !== "string" || typeof document.version !== "string") {
    throw new Error(`Package identity is incomplete: ${packageRoot}`);
  }
  return { document, name: document.name, version: document.version };
}

async function existingRealDirectory(path: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(path);
    return (await stat(resolved)).isDirectory() ? resolved : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function packageLockKey(cwd: string, packageRoot: string): string {
  return relative(cwd, packageRoot).split("\\").join("/");
}

function declaredPiBinaryPath(document: Record<string, unknown>): string {
  const bin = document.bin;
  if (typeof bin === "string" && bin.trim()) return bin.trim();
  if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    const pi = (bin as Record<string, unknown>).pi;
    if (typeof pi === "string" && pi.trim()) return pi.trim();
  }
  throw new Error(`Verified Pi host package does not declare a pi executable: ${PI_CODING_AGENT_PACKAGE}`);
}

async function resolvePiBinaryFromVerifiedHost(
  packageRoot: string,
  document: Record<string, unknown>,
  graph: TaskRunVerificationGraph,
): Promise<string> {
  const declared = declaredPiBinaryPath(document);
  if (isAbsolute(declared)) {
    throw new Error(`Verified Pi host package declares an absolute pi executable: ${declared}`);
  }
  let binaryPath: string;
  try {
    binaryPath = await realpath(resolve(packageRoot, declared));
  } catch {
    throw new Error(`Verified Pi executable is missing: ${declared}`);
  }
  if (!inside(packageRoot, binaryPath)) {
    throw new Error(`Pi executable escapes the verified Pi host package: ${binaryPath}`);
  }
  const info = await lstat(binaryPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Verified Pi executable is not a regular file: ${binaryPath}`);
  }
  if ((info.mode & (constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH)) === 0) {
    throw new Error(`Verified Pi executable is not executable: ${binaryPath}`);
  }
  recordPathState(graph, binaryPath, pathStateSignature(info));
  return binaryPath;
}

interface ResolvedPiHostPeers {
  manifests: TaskRunResourceManifest["packages"];
  verifiedPiBinaryPath?: string;
}

async function resolvePiHostPeerManifests(
  cwd: string,
  requirements: PiHostPeerRequirement[],
  graph: TaskRunVerificationGraph,
  requirePiBinary: boolean,
): Promise<ResolvedPiHostPeers> {
  const requirementsByName = new Map<AuditedPiHostPeer, PiHostPeerRequirement[]>();
  for (const requirement of requirements) {
    const rows = requirementsByName.get(requirement.packageName) ?? [];
    rows.push(requirement);
    requirementsByName.set(requirement.packageName, rows);
  }
  if (!requirementsByName.size) {
    if (requirePiBinary) throw new Error(`Team Run is missing its verified Pi host peer: ${PI_CODING_AGENT_PACKAGE}`);
    return { manifests: [] };
  }

  const realCwd = await realpath(cwd);
  const nodeModulesRoot = await realpath(join(realCwd, "node_modules"));
  const codingAgentRoot = await existingRealDirectory(join(nodeModulesRoot, "@earendil-works", "pi-coding-agent"));
  if (!codingAgentRoot) throw new Error("The active Pi host package is not installed: @earendil-works/pi-coding-agent");
  const lock = JSON.parse((await readStableFile(join(realCwd, "package-lock.json"), graph)).toString("utf8")) as PackageLockDocument;
  const lockPackages = lock.packages ?? {};
  const manifests: TaskRunResourceManifest["packages"] = [];
  let verifiedPiBinaryPath: string | undefined;

  for (const packageName of [...requirementsByName.keys()].sort()) {
    const packageParts = packageName.split("/");
    const candidates = packageName === "@earendil-works/pi-coding-agent"
      ? [join(nodeModulesRoot, ...packageParts)]
      : [join(codingAgentRoot, "node_modules", ...packageParts), join(nodeModulesRoot, ...packageParts)];
    let packageRoot: string | undefined;
    for (const candidate of candidates) {
      packageRoot = await existingRealDirectory(candidate);
      if (packageRoot) break;
    }
    if (!packageRoot || !inside(nodeModulesRoot, packageRoot)) {
      throw new Error(`Required Pi host peer is not installed inside the active host: ${packageName}`);
    }
    const identity = await readPackageIdentity(packageRoot, graph);
    if (identity.name !== packageName) {
      throw new Error(`Pi host peer identity mismatch: expected ${packageName}, found ${identity.name}`);
    }
    const lockEntry = lockPackages[packageLockKey(realCwd, packageRoot)];
    if (!lockEntry || lockEntry.version !== identity.version) {
      throw new Error(`Pi host peer lock mismatch: ${packageName}@${identity.version}`);
    }
    const packageKey = packageLockKey(realCwd, packageRoot);
    const integrity = await computeLockedPackageClosureIntegrity({
      installRoot: realCwd,
      rootKey: packageKey,
      verificationGraph: graph,
    });
    manifests.push({
      name: packageName,
      source: `npm:${packageName}@${identity.version}`,
      version: identity.version,
      integrity,
    });
    if (requirePiBinary && packageName === PI_CODING_AGENT_PACKAGE) {
      verifiedPiBinaryPath = await resolvePiBinaryFromVerifiedHost(packageRoot, identity.document, graph);
    }
  }
  if (requirePiBinary && !verifiedPiBinaryPath) {
    throw new Error(`Team Run is missing its verified Pi host peer: ${PI_CODING_AGENT_PACKAGE}`);
  }
  return { manifests, verifiedPiBinaryPath };
}

function expectedTreeHash(
  entry: NativeCapabilityPackage,
  env: Pick<TaskRunResourceEnvironment, "expectedTreeHashes">,
): string {
  const target = `${process.platform}-${process.arch}`;
  const expected = env.expectedTreeHashes?.[entry.id]
    ?? APPROVED_TREE_HASHES_BY_TARGET[target]?.[entry.id];
  if (!expected || !/^sha256-[A-Za-z0-9+/]{43}=$/.test(expected)) {
    throw new Error(`No approved package-tree SHA256 is configured for native capability ${entry.id}`);
  }
  return expected;
}

async function resolvePackage(
  entry: NativeCapabilityPackage,
  installedPath: string | undefined,
  verifyIntegrity: (input: TaskRunIntegrityInput) => Promise<boolean>,
  agentDir: string,
  hashEnvironment: Pick<TaskRunResourceEnvironment, "expectedTreeHashes">,
  verifyPatch: (id: NativeCapabilityPatchId, packageRoot: string) => Promise<string>,
  graph: TaskRunVerificationGraph,
): Promise<ResolvedNativeCapabilityPackage> {
  if (!installedPath) throw new Error(`Required native capability package is not installed: ${entry.source}`);
  const packageRoot = await resolveManagedPackageRoot(entry, installedPath, agentDir);
  const identity = await readPackageIdentity(packageRoot, graph);
  if (identity.name !== entry.packageName || identity.version !== entry.version) {
    throw new Error(`Native capability package identity mismatch: expected ${entry.packageName}@${entry.version}`);
  }
  if (!await verifyIntegrity({
    packageRoot,
    packageName: entry.packageName,
    version: entry.version,
    integrity: entry.integrity,
  })) {
    throw new Error(`Native capability package integrity mismatch: ${entry.source}`);
  }
  const extensionPath = await resolveExtensionPath(packageRoot, entry.extensionPath);
  if (entry.patch) await verifyPatch(entry.patch as NativeCapabilityPatchId, packageRoot);
  const treeIntegrity = await computeInstalledPackageClosureIntegrity({
    packageRoot,
    packageName: entry.packageName,
    verificationGraph: graph,
  });
  if (treeIntegrity !== expectedTreeHash(entry, hashEnvironment)) {
    throw new Error(`Native capability package tree integrity mismatch: ${entry.source}`);
  }
  return {
    extensionPath,
    manifest: {
      name: entry.packageName,
      source: entry.source,
      version: entry.version,
      integrity: treeIntegrity,
    },
    peerRequirements: hostPeerRequirements(identity.document, entry.packageName, entry.version),
  };
}

async function defaultVerifyPatch(id: NativeCapabilityPatchId, packageRoot: string): Promise<string> {
  return (await verifyNativeCapabilityPatch(id, packageRoot)).integrity;
}

function taskRunResourceCacheKey(input: {
  profile: TaskRunResourceProfile;
  env: TaskRunResourceEnvironment;
  agentDir: string;
  selected: NativeCapabilityPackage[];
  installedPaths: ReadonlyMap<string, string | undefined>;
}): string {
  return JSON.stringify({
    profile: input.profile,
    cwd: resolve(input.env.cwd),
    agentDir: resolve(input.agentDir),
    target: `${process.platform}-${process.arch}`,
    packages: input.selected.map((entry) => ({
      id: entry.id,
      source: entry.source,
      packageName: entry.packageName,
      version: entry.version,
      integrity: entry.integrity,
      extensionPath: entry.extensionPath,
      patch: "patch" in entry ? entry.patch : null,
      installedPath: input.installedPaths.get(entry.source) ?? null,
      expectedTreeHash: expectedTreeHash(entry, input.env),
    })),
    verifyIntegrity: cacheIdentity(input.env.verifyIntegrity, "default-lock-integrity"),
    verifyPatch: cacheIdentity(input.env.verifyPatch, "default-native-patch"),
  });
}

async function resolveTaskRunResourcesUncached(input: {
  profile: TaskRunResourceProfile;
  env: TaskRunResourceEnvironment;
  agentDir: string;
  selected: NativeCapabilityPackage[];
  installedPaths: ReadonlyMap<string, string | undefined>;
  graph: TaskRunVerificationGraph;
}): Promise<ResolvedTaskRunResources> {
  const verifyIntegrity = input.env.verifyIntegrity ?? ((integrityInput: TaskRunIntegrityInput) => (
    verifyPackageLockIntegrity(integrityInput, input.graph)
  ));
  const verifyPatch = input.env.verifyPatch ?? defaultVerifyPatch;
  const resolved = await Promise.all(input.selected.map((entry) => resolvePackage(
    entry,
    input.installedPaths.get(entry.source),
    verifyIntegrity,
    input.agentDir,
    input.env,
    verifyPatch,
    input.graph,
  )));
  const hostPeers = await resolvePiHostPeerManifests(
    input.env.cwd,
    resolved.flatMap(({ peerRequirements }) => peerRequirements),
    input.graph,
    input.profile === "team",
  );
  return resolvedTaskRunResources({
    isolatedResources: {
      extensionPaths: resolved.map(({ extensionPath }) => extensionPath),
    },
    manifest: {
      profile: input.profile,
      packages: [...resolved.map(({ manifest }) => manifest), ...hostPeers.manifests],
      activeToolNames: [],
    },
  }, hostPeers.verifiedPiBinaryPath);
}

export async function resolveTaskRunResources(
  profile: TaskRunResourceProfile,
  env: TaskRunResourceEnvironment,
  requestedCapabilityIds: readonly NativeCapabilityPackageId[] = [],
): Promise<ResolvedTaskRunResources> {
  if (profile !== "main" && profile !== "team") throw new Error(`Unsupported Task Run resource profile: ${profile}`);
  if (profile === "team" && requestedCapabilityIds.length) {
    throw new Error("On-demand capabilities belong to the Main Run surface and cannot be added to the Team supervisor profile.");
  }
  const requestedIds = new Set(requestedCapabilityIds);
  for (const id of requestedIds) {
    const entry = NATIVE_CAPABILITY_PACKAGES.find((candidate) => candidate.id === id);
    if (!entry || (entry.activation !== "on-demand" && entry.activation !== "experimental")) {
      throw new Error(`Unsupported on-demand native capability: ${id}`);
    }
    if (entry.runtimeReadiness !== "ready") {
      throw new Error(`Native capability ${id} requires setup before it can be enabled for a Run.`);
    }
  }
  const agentDir = env.agentDir ?? process.env.LA_NATIVE_CAPABILITY_AGENT_DIR ?? getAgentDir();
  if (profile === "team") {
    try {
      await lstat(join(agentDir, "extensions", "subagent", "config.json"));
      throw new Error("Team Run cannot inherit the user-global pi-subagents config; remove it or migrate the needed setting into the server-owned Team profile.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const packageManager = env.packageManager ?? new DefaultPackageManager({
    cwd: env.cwd,
    agentDir,
    settingsManager: SettingsManager.create(env.cwd, agentDir),
  });
  const selected = NATIVE_CAPABILITY_PACKAGES.filter((entry) => (
    profile === "team"
      ? entry.id === "subagents"
      : entry.activation === "core" || entry.activation === "main" || requestedIds.has(entry.id)
  ));
  const installedPaths = new Map(selected.map((entry) => [
    entry.source,
    packageManager.getInstalledPath(entry.source, "user"),
  ]));
  const cacheKey = taskRunResourceCacheKey({ profile, env, agentDir, selected, installedPaths });
  const generation = taskRunResourceCacheGeneration;
  const resolutionKey = `${generation}\0${cacheKey}`;
  const current = taskRunResourceResolutions.get(resolutionKey);
  if (current) return cloneResolvedTaskRunResources(await current);

  const resolution = (async (): Promise<ResolvedTaskRunResources> => {
    const cached = verifiedTaskRunResourceCache.get(cacheKey);
    if (cached) {
      if (await verificationStateMatches(cached.pathStates)) return cached.result;
      verifiedTaskRunResourceCache.delete(cacheKey);
    }
    const graph = newVerificationGraph();
    const result = await resolveTaskRunResourcesUncached({
      profile,
      env,
      agentDir,
      selected,
      installedPaths,
      graph,
    });
    if (!await verificationStateMatches(graph.pathStates)) {
      throw new Error("Task Run resources changed before verification could be committed.");
    }
    if (generation === taskRunResourceCacheGeneration) {
      verifiedTaskRunResourceCache.set(cacheKey, {
        result: cloneResolvedTaskRunResources(result),
        pathStates: new Map(graph.pathStates),
      });
    }
    return result;
  })();
  taskRunResourceResolutions.set(resolutionKey, resolution);
  try {
    return cloneResolvedTaskRunResources(await resolution);
  } finally {
    if (taskRunResourceResolutions.get(resolutionKey) === resolution) {
      taskRunResourceResolutions.delete(resolutionKey);
    }
  }
}
