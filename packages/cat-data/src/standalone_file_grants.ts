import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createTaskWorkspace } from "./task_workspace.js";
import { readJsonFile, writeJsonFile } from "./workspace.js";

export interface FileGrantV1 {
  id: string;
  taskId: string;
  kind: "file" | "directory";
  realPath: string;
  access: "read" | "read_write";
  recursive: boolean;
  createdAt: string;
  revokedAt?: string;
  fingerprint: string;
}

interface FileGrantDocumentV1 {
  schemaVersion: 1;
  grants: FileGrantV1[];
}

const grantQueues = new Map<string, Promise<void>>();
const PROTECTED_GRANT_PATHS = [
  join(homedir(), ".ssh"),
  join(homedir(), ".aws"),
  join(homedir(), ".agent-reach"),
  join(homedir(), ".pi", "agent", "auth.json"),
  join(homedir(), ".codex", "auth.json"),
] as const;

function pathContains(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertGrantPathIsNotProtected(path: string): void {
  const conflict = PROTECTED_GRANT_PATHS.find((protectedPath) =>
    pathContains(path, protectedPath) || pathContains(protectedPath, path));
  if (conflict) throw new Error(`File grants cannot include protected credential path ${conflict}.`);
}

function safeTaskId(taskId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(taskId)) throw new Error("taskId must be a safe identifier.");
  return taskId;
}

export function standaloneTaskRoot(runtimeRoot: string, taskId: string): string {
  return join(resolve(runtimeRoot), "data", "assistant", "tasks", safeTaskId(taskId));
}

export function standaloneTaskWorkspaceRoot(runtimeRoot: string, taskId: string): string {
  return join(standaloneTaskRoot(runtimeRoot, taskId), "workspace");
}

export function standaloneTaskSessionRoot(runtimeRoot: string, taskId: string): string {
  return join(standaloneTaskRoot(runtimeRoot, taskId), "_pi_sessions");
}

function grantsPath(runtimeRoot: string, taskId: string): string {
  return join(standaloneTaskRoot(runtimeRoot, taskId), "file_grants.json");
}

function parseGrant(value: unknown, label: string): FileGrantV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) throw new Error(`${label}.id is required.`);
  if (typeof row.taskId !== "string" || !row.taskId) throw new Error(`${label}.taskId is required.`);
  if (row.kind !== "file" && row.kind !== "directory") throw new Error(`${label}.kind is invalid.`);
  if (typeof row.realPath !== "string" || !row.realPath) throw new Error(`${label}.realPath is required.`);
  if (row.access !== "read" && row.access !== "read_write") throw new Error(`${label}.access is invalid.`);
  if (typeof row.recursive !== "boolean") throw new Error(`${label}.recursive is required.`);
  if (typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) throw new Error(`${label}.createdAt is invalid.`);
  if (row.revokedAt !== undefined && (typeof row.revokedAt !== "string" || !Number.isFinite(Date.parse(row.revokedAt)))) {
    throw new Error(`${label}.revokedAt is invalid.`);
  }
  if (typeof row.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(row.fingerprint)) throw new Error(`${label}.fingerprint is invalid.`);
  return row as unknown as FileGrantV1;
}

async function readDocument(runtimeRoot: string, taskId: string): Promise<FileGrantDocumentV1> {
  const value = await readJsonFile<unknown>(grantsPath(runtimeRoot, taskId), { schemaVersion: 1, grants: [] });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("File grant document must be an object.");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || !Array.isArray(row.grants)) throw new Error("File grant document schema is invalid.");
  const grants = row.grants.map((grant, index) => parseGrant(grant, `fileGrants[${index}]`));
  if (new Set(grants.map((grant) => grant.id)).size !== grants.length) throw new Error("File grant ids must be unique.");
  return { schemaVersion: 1, grants };
}

async function queued<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = grantQueues.get(path) ?? Promise.resolve();
  let result!: T;
  const next = previous.then(async () => { result = await work(); });
  const settled = next.catch(() => undefined);
  grantQueues.set(path, settled);
  try { await next; }
  finally { if (grantQueues.get(path) === settled) grantQueues.delete(path); }
  return result;
}

async function fingerprint(path: string): Promise<string> {
  const info = await stat(path);
  return createHash("sha256")
    .update(path).update("\0")
    .update(String(info.dev)).update("\0")
    .update(String(info.ino))
    .digest("hex");
}

export async function listStandaloneFileGrants(
  runtimeRoot: string,
  taskId: string,
  options: { includeRevoked?: boolean } = {},
): Promise<FileGrantV1[]> {
  const task = await createTaskWorkspace(runtimeRoot).open({ kind: "standalone", taskId });
  if (task.task.scope.kind !== "standalone") throw new Error(`Task ${taskId} is not standalone.`);
  const document = await readDocument(runtimeRoot, taskId);
  const referenced = new Set(task.task.scope.fileGrantIds);
  return document.grants.filter((grant) => referenced.has(grant.id) && (options.includeRevoked || !grant.revokedAt));
}

export async function createStandaloneFileGrant(runtimeRoot: string, input: {
  taskId: string;
  path: string;
  kind: "file" | "directory";
  access: "read" | "read_write";
  recursive?: boolean;
  now?: () => string;
}): Promise<{ grant: FileGrantV1; grants: FileGrantV1[] }> {
  const taskId = safeTaskId(input.taskId);
  const path = grantsPath(runtimeRoot, taskId);
  return queued(path, async () => {
    const workspace = createTaskWorkspace(runtimeRoot);
    const task = await workspace.open({ kind: "standalone", taskId });
    if (task.task.scope.kind !== "standalone") throw new Error(`Task ${taskId} is not standalone.`);
    const canonicalPath = await realpath(resolve(input.path));
    assertGrantPathIsNotProtected(canonicalPath);
    const info = await stat(canonicalPath);
    if (input.kind === "file" && !info.isFile()) throw new Error("File grant path is not a file.");
    if (input.kind === "directory" && !info.isDirectory()) throw new Error("Directory grant path is not a directory.");
    const document = await readDocument(runtimeRoot, taskId);
    const duplicate = document.grants.find((grant) => !grant.revokedAt
      && grant.realPath === canonicalPath
      && grant.kind === input.kind
      && grant.access === input.access);
    if (duplicate) return { grant: duplicate, grants: document.grants.filter((grant) => !grant.revokedAt) };
    const createdAt = input.now?.() ?? new Date().toISOString();
    const grant: FileGrantV1 = {
      id: `grant_${randomUUID()}`,
      taskId,
      kind: input.kind,
      realPath: canonicalPath,
      access: input.access,
      recursive: input.kind === "directory" ? input.recursive !== false : false,
      createdAt,
      fingerprint: await fingerprint(canonicalPath),
    };
    const next: FileGrantDocumentV1 = { schemaVersion: 1, grants: [...document.grants, grant] };
    await mkdir(dirname(path), { recursive: true });
    await writeJsonFile(path, next);
    try {
      await workspace.updateStandaloneScope({
        kind: "standalone",
        taskId,
        workingDirectoryGrantId: task.task.scope.workingDirectoryGrantId,
        fileGrantIds: [...task.task.scope.fileGrantIds, grant.id],
      });
    } catch (error) {
      await writeJsonFile(path, document);
      throw error;
    }
    return { grant, grants: next.grants.filter((entry) => !entry.revokedAt) };
  });
}

export async function setStandaloneWorkingDirectory(runtimeRoot: string, input: {
  taskId: string;
  grantId: string;
}): Promise<void> {
  const workspace = createTaskWorkspace(runtimeRoot);
  const task = await workspace.open({ kind: "standalone", taskId: input.taskId });
  if (task.task.scope.kind !== "standalone") throw new Error(`Task ${input.taskId} is not standalone.`);
  const grant = (await listStandaloneFileGrants(runtimeRoot, input.taskId)).find((candidate) => candidate.id === input.grantId);
  if (!grant || grant.kind !== "directory") throw new Error("Working directory requires an active directory grant.");
  await workspace.updateStandaloneScope({
    kind: "standalone",
    taskId: input.taskId,
    workingDirectoryGrantId: grant.id,
    fileGrantIds: task.task.scope.fileGrantIds,
  });
}

export async function resolveStandaloneFileGrantAccess(runtimeRoot: string, taskId: string): Promise<{
  workspaceRoot: string;
  workingDirectory: string;
  grants: FileGrantV1[];
}> {
  const workspace = createTaskWorkspace(runtimeRoot);
  const task = await workspace.open({ kind: "standalone", taskId });
  if (task.task.scope.kind !== "standalone") throw new Error(`Task ${taskId} is not standalone.`);
  const taskScope = task.task.scope;
  const grants = await listStandaloneFileGrants(runtimeRoot, taskId);
  for (const grant of grants) {
    const currentPath = await realpath(grant.realPath).catch(() => undefined);
    if (!currentPath || currentPath !== grant.realPath || await fingerprint(currentPath) !== grant.fingerprint) {
      throw new Error(`File grant ${grant.id} no longer matches its approved filesystem object.`);
    }
  }
  const workspaceRoot = standaloneTaskWorkspaceRoot(runtimeRoot, taskId);
  await mkdir(join(workspaceRoot, "attachments"), { recursive: true });
  const workingGrant = taskScope.workingDirectoryGrantId
    ? grants.find((grant) => grant.id === taskScope.workingDirectoryGrantId)
    : undefined;
  if (taskScope.workingDirectoryGrantId && (!workingGrant || workingGrant.kind !== "directory")) {
    throw new Error(`Working directory grant ${taskScope.workingDirectoryGrantId} is unavailable.`);
  }
  return {
    workspaceRoot,
    workingDirectory: workingGrant?.realPath ?? workspaceRoot,
    grants,
  };
}

export async function revokeStandaloneFileGrant(runtimeRoot: string, input: {
  taskId: string;
  grantId: string;
  now?: () => string;
}): Promise<{ grant: FileGrantV1; grants: FileGrantV1[] }> {
  const taskId = safeTaskId(input.taskId);
  const path = grantsPath(runtimeRoot, taskId);
  return queued(path, async () => {
    const workspace = createTaskWorkspace(runtimeRoot);
    const task = await workspace.open({ kind: "standalone", taskId });
    if (task.task.scope.kind !== "standalone") throw new Error(`Task ${taskId} is not standalone.`);
    const document = await readDocument(runtimeRoot, taskId);
    const index = document.grants.findIndex((grant) => grant.id === input.grantId);
    if (index < 0) throw new Error(`File grant ${input.grantId} was not found.`);
    const existing = document.grants[index]!;
    if (existing.revokedAt) return { grant: existing, grants: document.grants.filter((grant) => !grant.revokedAt) };
    const revoked = { ...existing, revokedAt: input.now?.() ?? new Date().toISOString() };
    const next: FileGrantDocumentV1 = {
      schemaVersion: 1,
      grants: document.grants.map((grant, grantIndex) => grantIndex === index ? revoked : grant),
    };
    await writeJsonFile(path, next);
    try {
      await workspace.updateStandaloneScope({
        kind: "standalone",
        taskId,
        workingDirectoryGrantId: task.task.scope.workingDirectoryGrantId === input.grantId
          ? undefined
          : task.task.scope.workingDirectoryGrantId,
        fileGrantIds: task.task.scope.fileGrantIds.filter((grantId) => grantId !== input.grantId),
      });
    } catch (error) {
      await writeJsonFile(path, document);
      throw error;
    }
    return { grant: revoked, grants: next.grants.filter((grant) => !grant.revokedAt) };
  });
}
