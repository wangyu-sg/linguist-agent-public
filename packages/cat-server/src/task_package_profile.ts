import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  assertLegacyTaskFileWriteAllowed,
  readJsonFile,
  writeJsonFile,
  type TaskRunResourceManifest,
} from "@linguist-agent/cat-data";
import type { CatIsolatedResources } from "@linguist-agent/cat-runtime";
import type { PiPackageResourceEntry, PiPackagesCatalog } from "./pi_packages.js";
import { resolveTeamChildPackageExecution } from "./team_child_rpc_adapter.js";
import { hashTaskPackageResource } from "./task_package_resource_integrity.js";

export const TASK_PACKAGE_PROFILE_SCHEMA_VERSION = 1 as const;
export type TaskPackageResourceType = "extension" | "skill" | "prompt";

export interface TaskPackageSelection {
  packageSource: string;
  resourceType: TaskPackageResourceType;
  resourceId: string;
  enabled: boolean;
}

export interface TaskPackageExecutableApproval {
  packageSource: string;
  version: string;
  integrity: string;
  approvedAt: string;
}

export interface TaskPackageProfile {
  schemaVersion: typeof TASK_PACKAGE_PROFILE_SCHEMA_VERSION;
  taskId: string;
  revision: number;
  selections: TaskPackageSelection[];
  executableApprovals: TaskPackageExecutableApproval[];
  updatedAt: string;
}

export interface TaskPackageResolvedResource {
  packageSource: string;
  resourceType: TaskPackageResourceType;
  resourceId: string;
  path: string;
  version: string;
  integrity: string;
  packageName: string;
  enabledByPi: boolean;
  executable: boolean;
  origin: PiPackageResourceEntry["origin"];
  scope: PiPackageResourceEntry["scope"];
}

export interface TaskPackageProfileConflict {
  code: "unknown_resource" | "resource_disabled" | "project_not_trusted" | "executable_approval_required" | "resource_unreadable";
  packageSource: string;
  resourceType: TaskPackageResourceType;
  resourceId: string;
  message: string;
}

export interface TaskPackageProfilePreview {
  schemaVersion: typeof TASK_PACKAGE_PROFILE_SCHEMA_VERSION;
  taskId: string;
  currentRevision: number;
  desiredSelections: TaskPackageSelection[];
  executableApprovals: TaskPackageExecutableApproval[];
  resolvedResources: TaskPackageResolvedResource[];
  conflicts: TaskPackageProfileConflict[];
  planHash: string;
}

export interface TaskPackageRunResources {
  profileRevision: number;
  profileHash: string;
  selections: TaskPackageSelection[];
  resolvedResources: TaskPackageResolvedResource[];
  isolatedResources: CatIsolatedResources;
  packages: TaskRunResourceManifest["packages"];
}

/** Resolve the same fail-closed child transport decision used at execution. */
export async function teamPackagePreflightBlockers(
  resources: readonly TaskPackageResolvedResource[],
): Promise<string[]> {
  return (await resolveTeamChildPackageExecution(resources)).blockers;
}

const profileWriteQueues = new Map<string, Promise<void>>();

async function withProfileWriteLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = profileWriteQueues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const queued = previous.then(() => gate, () => gate);
  profileWriteQueues.set(path, queued);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (profileWriteQueues.get(path) === queued) profileWriteQueues.delete(path);
  }
}

export class TaskPackageProfileError extends Error {
  readonly status: 400 | 409;
  readonly code: string;

  constructor(status: 400 | 409, code: string, message: string) {
    super(message);
    this.name = "TaskPackageProfileError";
    this.status = status;
    this.code = code;
  }
}

export interface TaskPackageProfileStoreInput {
  repoRoot: string;
  projectId: string;
  taskId: string;
}

export interface TaskPackageProfilePersistence {
  key(input: TaskPackageProfileStoreInput): string;
  read(input: TaskPackageProfileStoreInput): Promise<unknown | null>;
  write(
    input: TaskPackageProfileStoreInput,
    expected: TaskPackageProfile,
    next: TaskPackageProfile,
  ): Promise<void>;
}

function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`${label} must be a safe identifier.`);
  return value;
}

function profilePath(input: TaskPackageProfileStoreInput): string {
  return resolve(input.repoRoot, "data", "projects", safeId(input.projectId, "projectId"), "task_workspace", "tasks", safeId(input.taskId, "taskId"), "resource-profile.json");
}

let installedProfilePersistence: {
  root: string;
  persistence: TaskPackageProfilePersistence;
} | null = null;

export function createFileTaskPackageProfilePersistence(repoRoot: string): TaskPackageProfilePersistence {
  const root = resolve(repoRoot);
  return {
    key: (input) => profilePath({ ...input, repoRoot: root }),
    read: (input) => readJsonFile<unknown | null>(profilePath({ ...input, repoRoot: root }), null),
    async write(input, _expected, next) {
      assertLegacyTaskFileWriteAllowed(root);
      await writeJsonFile(profilePath({ ...input, repoRoot: root }), next, { durability: "critical" });
    },
  };
}

export function installTaskPackageProfilePersistence(input: {
  root: string;
  persistence: TaskPackageProfilePersistence;
}): void {
  if (installedProfilePersistence) {
    throw new Error("canonical Task Package profile storage is already installed.");
  }
  installedProfilePersistence = Object.freeze({
    root: resolve(input.root),
    persistence: input.persistence,
  });
}

function resolveTaskPackageProfilePersistence(input: TaskPackageProfileStoreInput): TaskPackageProfilePersistence {
  if (!installedProfilePersistence) return createFileTaskPackageProfilePersistence(input.repoRoot);
  if (installedProfilePersistence.root !== resolve(input.repoRoot)) {
    throw new Error("canonical Task Package profile storage is installed for another root.");
  }
  return installedProfilePersistence.persistence;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TaskPackageProfileError(400, "invalid_profile", `${label} must be a non-empty string.`);
  return value.trim();
}

function resourceType(value: unknown, label: string): TaskPackageResourceType {
  if (value === "extension" || value === "skill" || value === "prompt") return value;
  throw new TaskPackageProfileError(400, "invalid_profile", `${label} must be extension, skill, or prompt.`);
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new TaskPackageProfileError(400, "invalid_profile", `${label} must be a non-negative integer.`);
  return value as number;
}

function timestamp(value: unknown, label: string): string {
  const text = nonEmpty(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new TaskPackageProfileError(400, "invalid_profile", `${label} must be an ISO timestamp.`);
  return text;
}

function parseSelection(value: unknown, label: string): TaskPackageSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskPackageProfileError(400, "invalid_profile", `${label} must be an object.`);
  const row = value as Record<string, unknown>;
  return {
    packageSource: nonEmpty(row.packageSource, `${label}.packageSource`),
    resourceType: resourceType(row.resourceType, `${label}.resourceType`),
    resourceId: nonEmpty(row.resourceId, `${label}.resourceId`),
    enabled: row.enabled === true,
  };
}

function parseApproval(value: unknown, label: string): TaskPackageExecutableApproval {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskPackageProfileError(400, "invalid_profile", `${label} must be an object.`);
  const row = value as Record<string, unknown>;
  return {
    packageSource: nonEmpty(row.packageSource, `${label}.packageSource`),
    version: nonEmpty(row.version, `${label}.version`),
    integrity: nonEmpty(row.integrity, `${label}.integrity`),
    approvedAt: timestamp(row.approvedAt, `${label}.approvedAt`),
  };
}

function sortSelections(rows: TaskPackageSelection[]): TaskPackageSelection[] {
  return [...rows].sort((left, right) => [left.packageSource, left.resourceType, left.resourceId].join("\u0000").localeCompare([right.packageSource, right.resourceType, right.resourceId].join("\u0000")));
}

function sortApprovals(rows: TaskPackageExecutableApproval[]): TaskPackageExecutableApproval[] {
  return [...rows].sort((left, right) => [left.packageSource, left.version, left.integrity].join("\u0000").localeCompare([right.packageSource, right.version, right.integrity].join("\u0000")));
}

function dedupeSelections(rows: TaskPackageSelection[]): TaskPackageSelection[] {
  const map = new Map<string, TaskPackageSelection>();
  for (const row of rows) map.set(`${row.packageSource}\u0000${row.resourceType}\u0000${row.resourceId}`, row);
  return sortSelections([...map.values()]);
}

function dedupeApprovals(rows: TaskPackageExecutableApproval[]): TaskPackageExecutableApproval[] {
  const map = new Map<string, TaskPackageExecutableApproval>();
  for (const row of rows) map.set(`${row.packageSource}\u0000${row.version}\u0000${row.integrity}`, row);
  return sortApprovals([...map.values()]);
}

function parseProfile(value: unknown, taskId: string): TaskPackageProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskPackageProfileError(400, "invalid_profile", "Task Package profile must be an object.");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== TASK_PACKAGE_PROFILE_SCHEMA_VERSION) throw new TaskPackageProfileError(400, "invalid_profile", `Task Package profile schemaVersion must be ${TASK_PACKAGE_PROFILE_SCHEMA_VERSION}.`);
  const storedTaskId = nonEmpty(row.taskId, "profile.taskId");
  if (storedTaskId !== taskId) throw new TaskPackageProfileError(400, "invalid_profile", `Task Package profile belongs to ${storedTaskId}, not ${taskId}.`);
  if (!Array.isArray(row.selections) || !Array.isArray(row.executableApprovals)) throw new TaskPackageProfileError(400, "invalid_profile", "Task Package profile selections and executableApprovals must be arrays.");
  return {
    schemaVersion: TASK_PACKAGE_PROFILE_SCHEMA_VERSION,
    taskId,
    revision: integer(row.revision, "profile.revision"),
    selections: dedupeSelections(row.selections.map((entry, index) => parseSelection(entry, `profile.selections[${index}]`))),
    executableApprovals: dedupeApprovals(row.executableApprovals.map((entry, index) => parseApproval(entry, `profile.executableApprovals[${index}]`))),
    updatedAt: timestamp(row.updatedAt, "profile.updatedAt"),
  };
}

function emptyProfile(taskId: string): TaskPackageProfile {
  return {
    schemaVersion: TASK_PACKAGE_PROFILE_SCHEMA_VERSION,
    taskId,
    revision: 0,
    selections: [],
    executableApprovals: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export async function readTaskPackageProfile(input: TaskPackageProfileStoreInput): Promise<TaskPackageProfile> {
  const value = await resolveTaskPackageProfilePersistence(input).read(input);
  return value === null ? emptyProfile(input.taskId) : parseProfile(value, input.taskId);
}

function canonicalProfileValue(profile: Pick<TaskPackageProfile, "schemaVersion" | "taskId" | "revision" | "selections" | "executableApprovals">): string {
  return JSON.stringify({
    schemaVersion: profile.schemaVersion,
    taskId: profile.taskId,
    revision: profile.revision,
    selections: sortSelections(profile.selections),
    executableApprovals: sortApprovals(profile.executableApprovals),
  });
}

export function taskPackageProfileHash(profile: TaskPackageProfile): string {
  return `sha256-${createHash("sha256").update(canonicalProfileValue(profile)).digest("base64")}`;
}

function toSingularType(type: PiPackageResourceEntry["type"]): TaskPackageResourceType | undefined {
  if (type === "extensions") return "extension";
  if (type === "skills") return "skill";
  if (type === "prompts") return "prompt";
  return undefined;
}

function resourceId(entry: PiPackageResourceEntry): string {
  const base = entry.baseDir ? resolve(entry.baseDir) : dirname(resolve(entry.path));
  const candidate = relative(base, resolve(entry.path)).split(sep).join("/");
  const clean = candidate && candidate !== "." && !candidate.startsWith("../") && candidate !== ".." && !isAbsolute(candidate)
    ? candidate
    : basename(entry.path);
  return clean || basename(entry.path) || "resource";
}

interface PackageIdentity {
  name: string;
  version: string;
}

async function packageIdentity(entry: PiPackageResourceEntry): Promise<PackageIdentity> {
  const sourceVersion = entry.source.match(/^npm:.+@([^@/]+)$/)?.[1];
  let current = entry.baseDir ? resolve(entry.baseDir) : dirname(resolve(entry.path));
  for (let index = 0; index < 5; index += 1) {
    try {
      const document = JSON.parse(await readFile(resolve(current, "package.json"), "utf8")) as Record<string, unknown>;
      return {
        name: typeof document.name === "string" && document.name.trim() ? document.name : entry.source,
        version: typeof document.version === "string" && document.version.trim() ? document.version : sourceVersion ?? "unknown",
      };
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return { name: entry.source, version: sourceVersion ?? "unknown" };
}

async function catalogResources(catalog: PiPackagesCatalog): Promise<TaskPackageResolvedResource[]> {
  const result: TaskPackageResolvedResource[] = [];
  for (const entry of catalog.resources.entries) {
    const type = toSingularType(entry.type);
    if (!type) continue;
    const id = resourceId(entry);
    const identity = await packageIdentity(entry);
    let integrity: string;
    try {
      integrity = await hashTaskPackageResource(entry.path);
    } catch (error) {
      throw new TaskPackageProfileError(409, "resource_unreadable", `Cannot fingerprint Pi resource ${entry.source}/${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    result.push({
      packageSource: entry.source,
      resourceType: type,
      resourceId: id,
      path: resolve(entry.path),
      version: identity.version,
      integrity,
      packageName: identity.name,
      enabledByPi: entry.enabled,
      executable: type === "extension" && entry.origin === "package",
      origin: entry.origin,
      scope: entry.scope,
    });
  }
  return result.sort((left, right) => [left.packageSource, left.resourceType, left.resourceId].join("\u0000").localeCompare([right.packageSource, right.resourceType, right.resourceId].join("\u0000")));
}

function approvalMatches(approvals: TaskPackageExecutableApproval[], resource: TaskPackageResolvedResource): boolean {
  return approvals.some((approval) => approval.packageSource === resource.packageSource && approval.version === resource.version && approval.integrity === resource.integrity);
}

function planHash(input: Pick<TaskPackageProfilePreview, "taskId" | "currentRevision" | "desiredSelections" | "executableApprovals" | "resolvedResources" | "conflicts">): string {
  const normalized = {
    schemaVersion: TASK_PACKAGE_PROFILE_SCHEMA_VERSION,
    taskId: input.taskId,
    currentRevision: input.currentRevision,
    desiredSelections: sortSelections(input.desiredSelections),
    executableApprovals: sortApprovals(input.executableApprovals),
    resolvedResources: input.resolvedResources.map((resource) => ({
      packageSource: resource.packageSource,
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      version: resource.version,
      integrity: resource.integrity,
      packageName: resource.packageName,
      enabledByPi: resource.enabledByPi,
      executable: resource.executable,
      origin: resource.origin,
      scope: resource.scope,
    })),
    conflicts: input.conflicts,
  };
  return `sha256-${createHash("sha256").update(JSON.stringify(normalized)).digest("base64")}`;
}

export async function previewTaskPackageProfile(input: {
  profile: TaskPackageProfile;
  catalog: PiPackagesCatalog;
  desiredSelections: TaskPackageSelection[];
  executableApprovals?: TaskPackageExecutableApproval[];
}): Promise<TaskPackageProfilePreview> {
  const desiredSelections = dedupeSelections(input.desiredSelections);
  const executableApprovals = dedupeApprovals(input.executableApprovals ?? input.profile.executableApprovals);
  const resources = await catalogResources(input.catalog);
  const byKey = new Map(resources.map((resource) => [`${resource.packageSource}\u0000${resource.resourceType}\u0000${resource.resourceId}`, resource]));
  const conflicts: TaskPackageProfileConflict[] = [];
  const resolvedResources: TaskPackageResolvedResource[] = [];
  for (const selection of desiredSelections.filter((row) => row.enabled)) {
    const key = `${selection.packageSource}\u0000${selection.resourceType}\u0000${selection.resourceId}`;
    const resource = byKey.get(key);
    if (!resource) {
      conflicts.push({ code: "unknown_resource", ...selection, message: `Pi resource ${selection.packageSource}/${selection.resourceId} is not installed or no longer visible.` });
      continue;
    }
    if (!resource.enabledByPi) {
      conflicts.push({ code: "resource_disabled", ...selection, message: `Pi resource ${selection.packageSource}/${selection.resourceId} is disabled by the current Pi package settings.` });
    }
    if (resource.executable && !input.catalog.resources.projectTrusted) {
      conflicts.push({ code: "project_not_trusted", ...selection, message: "The project is not trusted for executable Package resources." });
    }
    if (resource.executable && !approvalMatches(executableApprovals, resource)) {
      conflicts.push({ code: "executable_approval_required", ...selection, message: `Executable Package ${resource.packageName}@${resource.version} requires an approval matching its current integrity.` });
    }
    resolvedResources.push(resource);
  }
  const result: TaskPackageProfilePreview = {
    schemaVersion: TASK_PACKAGE_PROFILE_SCHEMA_VERSION,
    taskId: input.profile.taskId,
    currentRevision: input.profile.revision,
    desiredSelections,
    executableApprovals,
    resolvedResources,
    conflicts,
    planHash: "",
  };
  result.planHash = planHash(result);
  return result;
}

export async function applyTaskPackageProfile(input: {
  store: TaskPackageProfileStoreInput;
  catalog: PiPackagesCatalog;
  expectedRevision: number;
  planHash: string;
  selections: TaskPackageSelection[];
  executableApprovals?: TaskPackageExecutableApproval[];
}): Promise<TaskPackageProfile> {
  const persistence = resolveTaskPackageProfilePersistence(input.store);
  return withProfileWriteLock(persistence.key(input.store), async () => {
    const stored = await persistence.read(input.store);
    const current = stored === null ? emptyProfile(input.store.taskId) : parseProfile(stored, input.store.taskId);
    if (current.revision !== input.expectedRevision) throw new TaskPackageProfileError(409, "revision_conflict", `Task Package profile revision ${current.revision} does not match expected ${input.expectedRevision}.`);
    const preview = await previewTaskPackageProfile({
      profile: current,
      catalog: input.catalog,
      desiredSelections: input.selections,
      executableApprovals: input.executableApprovals,
    });
    if (preview.planHash !== input.planHash) throw new TaskPackageProfileError(409, "plan_conflict", "Task Package profile changed; refresh the preview before applying it.");
    if (preview.conflicts.length) throw new TaskPackageProfileError(409, "profile_conflict", preview.conflicts.map((conflict) => conflict.message).join(" "));
    const next: TaskPackageProfile = {
      schemaVersion: TASK_PACKAGE_PROFILE_SCHEMA_VERSION,
      taskId: input.store.taskId,
      revision: current.revision + 1,
      selections: preview.desiredSelections,
      executableApprovals: preview.executableApprovals,
      updatedAt: new Date().toISOString(),
    };
    await persistence.write(input.store, current, next);
    return next;
  });
}

export async function resolveTaskPackageRunResources(input: {
  profile: TaskPackageProfile;
  catalog: PiPackagesCatalog;
}): Promise<TaskPackageRunResources> {
  const preview = await previewTaskPackageProfile({
    profile: input.profile,
    catalog: input.catalog,
    desiredSelections: input.profile.selections,
    executableApprovals: input.profile.executableApprovals,
  });
  if (preview.conflicts.length) throw new TaskPackageProfileError(409, "profile_conflict", preview.conflicts.map((conflict) => conflict.message).join(" "));
  const selected = preview.resolvedResources;
  return {
    profileRevision: input.profile.revision,
    profileHash: taskPackageProfileHash(input.profile),
    selections: input.profile.selections,
    resolvedResources: selected,
    isolatedResources: {
      extensionPaths: selected.filter((resource) => resource.resourceType === "extension").map((resource) => resource.path),
      skillPaths: selected.filter((resource) => resource.resourceType === "skill").map((resource) => resource.path),
      promptTemplatePaths: selected.filter((resource) => resource.resourceType === "prompt").map((resource) => resource.path),
    },
    packages: Array.from(new Map(selected.map((resource) => [resource.packageName, {
      name: resource.packageName,
      source: resource.packageSource,
      version: resource.version,
      integrity: resource.integrity,
    }])).values()).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function mergeTaskPackageIsolatedResources(base: CatIsolatedResources, extra: CatIsolatedResources): CatIsolatedResources {
  const merge = (left: string[] | undefined, right: string[] | undefined): string[] | undefined => {
    const values = [...(left ?? []), ...(right ?? [])];
    return values.length ? [...new Set(values)] : undefined;
  };
  return {
    extensionPaths: merge(base.extensionPaths, extra.extensionPaths),
    skillPaths: merge(base.skillPaths, extra.skillPaths),
    promptTemplatePaths: merge(base.promptTemplatePaths, extra.promptTemplatePaths),
    themePaths: merge(base.themePaths, extra.themePaths),
  };
}
