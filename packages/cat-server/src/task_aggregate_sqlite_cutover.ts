import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  installLegacyTaskFileWriterBlock,
  installTaskAggregateStorageBackend,
  taskWorkspaceDirectory,
  writeJsonFile,
  type TaskLocator,
} from "@linguist-agent/cat-data";
import {
  createSqliteTaskAggregateBackend,
  importLegacyTaskSideState,
  importLegacyTaskWorkspace,
  legacyTaskSideStreamIds,
  legacyTaskStreamId,
  SqliteEventProjectionStore,
  type SqliteStorageAuthority,
  type SqliteTaskAggregateBackend,
} from "@linguist-agent/storage-sqlite";
import { installTaskPackageProfilePersistence } from "./task_package_profile.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface TaskAggregateSqliteAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "sqlite";
  databaseRelativePath: string;
  backupRootRelativePath: string;
  cutoverAt: string;
  inventoryHash: string;
  tasks: Array<{
    locator: TaskLocator;
    workspaceSourceDigest: string;
    sideStateSourceDigest: string;
  }>;
  excludes: ["project-quality-ledger"];
}

export interface TaskAggregateLegacyAuthorityMarkerV1 {
  schemaVersion: 1;
  authority: "legacy";
  rolledBackAt: string;
  sourceSqliteDatabaseRelativePath: string;
  rollbackRootRelativePath: string;
  auditRelativePath: string;
  auditSha256: string;
  inventoryHash: string;
  tasks: TaskAggregateSqliteAuthorityMarkerV1["tasks"];
  excludes: ["project-quality-ledger"];
}

export type TaskAggregateAuthorityMarkerV1 =
  | TaskAggregateSqliteAuthorityMarkerV1
  | TaskAggregateLegacyAuthorityMarkerV1;

export interface PrepareTaskAggregateSqliteCutoverInput {
  repoRoot: string;
  authority: SqliteStorageAuthority;
  activeRunCount: number;
  now?: () => Date;
}

export type PreparedTaskAggregateSqliteCutover =
  | {
      status: "cutover" | "already-sqlite";
      marker: TaskAggregateSqliteAuthorityMarkerV1;
      store: SqliteEventProjectionStore;
      backend: SqliteTaskAggregateBackend;
      close(): void;
    }
  | {
      status: "legacy-rollback";
      marker: TaskAggregateLegacyAuthorityMarkerV1;
      close(): void;
    };

export function activateTaskAggregateSqliteCutover(
  prepared: PreparedTaskAggregateSqliteCutover,
): void {
  if (prepared.status === "legacy-rollback") return;
  installLegacyTaskFileWriterBlock(prepared.backend.root);
  installTaskAggregateStorageBackend(prepared.backend);
  installTaskPackageProfilePersistence({
    root: prepared.backend.root,
    persistence: prepared.backend.taskPackageProfile,
  });
}

function safeId(value: string, label: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`${label} must be a safe identifier.`);
  return value;
}

function markerId(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return safeId(value, label);
}

function exactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields are invalid.`);
  }
}

function parseLocator(value: unknown, index: number): TaskLocator {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Task aggregate marker locator ${index} must be an object.`);
  }
  const row = value as Record<string, unknown>;
  if (row.kind === "standalone") {
    exactKeys(row, ["kind", "taskId"], `Task aggregate marker locator ${index}`);
    return {
      kind: "standalone",
      taskId: markerId(row.taskId, `Task aggregate marker locator ${index}.taskId`),
    };
  }
  if (row.kind === "project") {
    exactKeys(row, ["kind", "projectId", "taskId"], `Task aggregate marker locator ${index}`);
    return {
      kind: "project",
      projectId: markerId(row.projectId, `Task aggregate marker locator ${index}.projectId`),
      taskId: markerId(row.taskId, `Task aggregate marker locator ${index}.taskId`),
    };
  }
  throw new Error(`Task aggregate marker locator ${index}.kind is invalid.`);
}

function relativeWithin(root: string, path: string, label: string): string {
  const value = relative(root, path);
  if (!value || value.startsWith("..") || isAbsolute(value)) {
    throw new Error(`${label} must be within the repository root.`);
  }
  return value;
}

function sortedLocators(locators: readonly TaskLocator[]): TaskLocator[] {
  return [...locators].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function taskAggregateInventoryHash(locators: readonly TaskLocator[]): string {
  return createHash("sha256").update(JSON.stringify(sortedLocators(locators))).digest("hex");
}

function parseSqliteMarker(value: unknown, repoRoot: string): TaskAggregateSqliteAuthorityMarkerV1 {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "databaseRelativePath",
    "backupRootRelativePath",
    "cutoverAt",
    "inventoryHash",
    "tasks",
    "excludes",
  ], "Task aggregate SQLite authority marker");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || row.authority !== "sqlite") {
    throw new Error("Task aggregate SQLite authority marker version or authority is invalid.");
  }
  if (typeof row.databaseRelativePath !== "string"
    || typeof row.backupRootRelativePath !== "string"
    || typeof row.cutoverAt !== "string"
    || typeof row.inventoryHash !== "string"
    || !Array.isArray(row.tasks)
    || !Array.isArray(row.excludes)) {
    throw new Error("Task aggregate SQLite authority marker value types are invalid.");
  }
  const timestamp = new Date(row.cutoverAt);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== row.cutoverAt) {
    throw new Error("Task aggregate SQLite authority marker timestamp is invalid.");
  }
  if (!/^[a-f0-9]{64}$/u.test(row.inventoryHash)) {
    throw new Error("Task aggregate SQLite authority marker inventory hash is invalid.");
  }
  if (JSON.stringify(row.excludes) !== JSON.stringify(["project-quality-ledger"])) {
    throw new Error("Task aggregate SQLite authority marker must exclude the Project quality ledger.");
  }
  const tasks = row.tasks.map((value, index) => {
    exactKeys(
      value,
      ["locator", "workspaceSourceDigest", "sideStateSourceDigest"],
      `Task aggregate marker task ${index}`,
    );
    const task = value as Record<string, unknown>;
    if (typeof task.workspaceSourceDigest !== "string"
      || typeof task.sideStateSourceDigest !== "string"
      || !/^[a-f0-9]{64}$/u.test(task.workspaceSourceDigest)
      || !/^[a-f0-9]{64}$/u.test(task.sideStateSourceDigest)) {
      throw new Error(`Task aggregate marker task ${index} source digests are invalid.`);
    }
    return {
      locator: parseLocator(task.locator, index),
      workspaceSourceDigest: task.workspaceSourceDigest,
      sideStateSourceDigest: task.sideStateSourceDigest,
    };
  }).sort((left, right) => JSON.stringify(left.locator).localeCompare(JSON.stringify(right.locator)));
  const taskLocators = tasks.map(({ locator }) => locator);
  if (new Set(taskLocators.map((locator) => JSON.stringify(locator))).size !== taskLocators.length
    || taskAggregateInventoryHash(taskLocators) !== row.inventoryHash) {
    throw new Error("Task aggregate SQLite authority marker inventory is inconsistent.");
  }
  const databaseRelativePath = relativeWithin(
    repoRoot,
    resolve(repoRoot, row.databaseRelativePath),
    "Task aggregate SQLite database path",
  );
  const backupRootRelativePath = relativeWithin(
    repoRoot,
    resolve(repoRoot, row.backupRootRelativePath),
    "Task aggregate SQLite backup root",
  );
  return {
    schemaVersion: 1,
    authority: "sqlite",
    databaseRelativePath,
    backupRootRelativePath,
    cutoverAt: row.cutoverAt,
    inventoryHash: row.inventoryHash,
    tasks,
    excludes: ["project-quality-ledger"],
  };
}

function parseLegacyMarker(
  value: unknown,
  repoRoot: string,
): TaskAggregateLegacyAuthorityMarkerV1 {
  exactKeys(value, [
    "schemaVersion",
    "authority",
    "rolledBackAt",
    "sourceSqliteDatabaseRelativePath",
    "rollbackRootRelativePath",
    "auditRelativePath",
    "auditSha256",
    "inventoryHash",
    "tasks",
    "excludes",
  ], "Task aggregate legacy authority marker");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== 1 || row.authority !== "legacy") {
    throw new Error("Task aggregate legacy authority marker version or authority is invalid.");
  }
  if (typeof row.rolledBackAt !== "string"
    || typeof row.sourceSqliteDatabaseRelativePath !== "string"
    || typeof row.rollbackRootRelativePath !== "string"
    || typeof row.auditRelativePath !== "string"
    || typeof row.auditSha256 !== "string"
    || typeof row.inventoryHash !== "string"
    || !Array.isArray(row.tasks)
    || !Array.isArray(row.excludes)) {
    throw new Error("Task aggregate legacy authority marker value types are invalid.");
  }
  const timestamp = new Date(row.rolledBackAt);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== row.rolledBackAt) {
    throw new Error("Task aggregate legacy authority marker timestamp is invalid.");
  }
  if (!/^[a-f0-9]{64}$/u.test(row.auditSha256)
    || !/^[a-f0-9]{64}$/u.test(row.inventoryHash)) {
    throw new Error("Task aggregate legacy authority marker digest is invalid.");
  }
  if (JSON.stringify(row.excludes) !== JSON.stringify(["project-quality-ledger"])) {
    throw new Error("Task aggregate legacy authority marker must exclude the Project quality ledger.");
  }
  const tasks = row.tasks.map((taskValue, index) => {
    exactKeys(
      taskValue,
      ["locator", "workspaceSourceDigest", "sideStateSourceDigest"],
      `Task aggregate legacy marker task ${index}`,
    );
    const task = taskValue as Record<string, unknown>;
    if (typeof task.workspaceSourceDigest !== "string"
      || typeof task.sideStateSourceDigest !== "string"
      || !/^[a-f0-9]{64}$/u.test(task.workspaceSourceDigest)
      || !/^[a-f0-9]{64}$/u.test(task.sideStateSourceDigest)) {
      throw new Error(`Task aggregate legacy marker task ${index} source digests are invalid.`);
    }
    return {
      locator: parseLocator(task.locator, index),
      workspaceSourceDigest: task.workspaceSourceDigest,
      sideStateSourceDigest: task.sideStateSourceDigest,
    };
  }).sort((left, right) => JSON.stringify(left.locator).localeCompare(JSON.stringify(right.locator)));
  const locators = tasks.map(({ locator }) => locator);
  if (new Set(locators.map((locator) => JSON.stringify(locator))).size !== locators.length
    || taskAggregateInventoryHash(locators) !== row.inventoryHash) {
    throw new Error("Task aggregate legacy authority marker inventory is inconsistent.");
  }
  return {
    schemaVersion: 1,
    authority: "legacy",
    rolledBackAt: row.rolledBackAt,
    sourceSqliteDatabaseRelativePath: relativeWithin(
      repoRoot,
      resolve(repoRoot, row.sourceSqliteDatabaseRelativePath),
      "Task aggregate legacy source database path",
    ),
    rollbackRootRelativePath: relativeWithin(
      repoRoot,
      resolve(repoRoot, row.rollbackRootRelativePath),
      "Task aggregate rollback root",
    ),
    auditRelativePath: relativeWithin(
      repoRoot,
      resolve(repoRoot, row.auditRelativePath),
      "Task aggregate rollback audit path",
    ),
    auditSha256: row.auditSha256,
    inventoryHash: row.inventoryHash,
    tasks,
    excludes: ["project-quality-ledger"],
  };
}

export function parseTaskAggregateAuthorityMarker(
  value: unknown,
  repoRoot: string,
): TaskAggregateAuthorityMarkerV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Task aggregate authority marker must be an object.");
  }
  return (value as Record<string, unknown>).authority === "legacy"
    ? parseLegacyMarker(value, repoRoot)
    : parseSqliteMarker(value, repoRoot);
}

export async function readTaskAggregateAuthorityMarker(
  path: string,
  repoRoot: string,
): Promise<TaskAggregateAuthorityMarkerV1 | null> {
  try {
    return parseTaskAggregateAuthorityMarker(
      JSON.parse(await readFile(path, "utf8")) as unknown,
      repoRoot,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function childDirectories(path: string, label: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => safeId(entry.name, `${label} directory`))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function inventoryLegacyTaskLocators(repoRoot: string): Promise<TaskLocator[]> {
  const root = resolve(repoRoot);
  const locators: TaskLocator[] = [];
  for (const taskId of await childDirectories(
    join(root, "data", "assistant", "tasks"),
    "standalone Task",
  )) {
    locators.push({ kind: "standalone", taskId });
  }
  for (const projectId of await childDirectories(
    join(root, "data", "projects"),
    "Project",
  )) {
    for (const taskId of await childDirectories(
      join(root, "data", "projects", projectId, "task_workspace", "tasks"),
      "Project Task",
    )) {
      locators.push({ kind: "project", projectId, taskId });
    }
  }
  return sortedLocators(locators);
}

function backupTaskDirectory(backupRoot: string, locator: TaskLocator): string {
  const digest = createHash("sha256").update(JSON.stringify(locator)).digest("hex").slice(0, 32);
  return join(backupRoot, `${locator.kind}-${digest}`);
}

function expectedProjectionIds(locators: readonly TaskLocator[]): string[] {
  return locators.flatMap((locator) => {
    const side = legacyTaskSideStreamIds(locator);
    return [
      legacyTaskStreamId(locator),
      side.messageQueue,
      side.resourceProfile,
    ];
  }).sort();
}

function verifyCutoverStore(
  store: SqliteEventProjectionStore,
  marker: TaskAggregateSqliteAuthorityMarkerV1,
  exactBaseline: boolean,
): void {
  if (store.quickCheck() !== "ok") throw new Error("Task aggregate SQLite quick_check failed.");
  const actual = store.listProjections().map(({ streamId }) => streamId).sort();
  const expected = expectedProjectionIds(marker.tasks.map(({ locator }) => locator));
  if (expected.some((streamId) => !actual.includes(streamId))
    || (exactBaseline && JSON.stringify(actual) !== JSON.stringify(expected))) {
    throw new Error("Task aggregate SQLite projection inventory does not match the authority marker.");
  }
  if (actual.some((streamId) => streamId.startsWith("legacy-quality-"))) {
    throw new Error("Task aggregate SQLite contains a forbidden Project quality-ledger projection.");
  }
  const unknown = actual.find((streamId) =>
    !streamId.startsWith("legacy-task-")
    && !streamId.startsWith("legacy-queue-")
    && !streamId.startsWith("legacy-resource-"));
  if (unknown) throw new Error(`Task aggregate SQLite contains unknown stream ${unknown}.`);
  for (const { locator } of marker.tasks) {
    if (store.readProjection(legacyTaskSideStreamIds(locator).qualityDecisions)) {
      throw new Error("Task aggregate SQLite contains a forbidden Project quality-ledger projection.");
    }
  }
}

interface VerifiedBackupFile {
  name: string;
  bytes: Buffer;
  expectedBytes: number;
  expectedSha256: string;
}

async function verifyBackupManifest(
  directory: string,
  label: string,
  kind: "workspace" | "side-state",
): Promise<string> {
  const value: unknown = JSON.parse(await readFile(join(directory, "manifest-v1.json"), "utf8"));
  const manifestKeys = kind === "workspace"
    ? ["schemaVersion", "createdAt", "sourceDigest", "files"]
    : ["schemaVersion", "sourceDigest", "files"];
  exactKeys(value, manifestKeys, `${label} manifest`);
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== 1
    || typeof manifest.sourceDigest !== "string"
    || !/^[a-f0-9]{64}$/u.test(manifest.sourceDigest)
    || !Array.isArray(manifest.files)) {
    throw new Error(`${label} manifest values are invalid.`);
  }
  if (kind === "workspace") {
    if (typeof manifest.createdAt !== "string"
      || !Number.isFinite(Date.parse(manifest.createdAt))) {
      throw new Error(`${label} manifest createdAt is invalid.`);
    }
  }
  const allowed = kind === "workspace"
    ? new Set(["snapshot.json", "events.jsonl"])
    : new Set(["snapshot.json", "message_queue.json", "resource-profile.json"]);
  const files: VerifiedBackupFile[] = [];
  for (const [index, value] of manifest.files.entries()) {
    const nameKey = kind === "workspace" ? "relativePath" : "name";
    exactKeys(value, [nameKey, "bytes", "sha256"], `${label} manifest file ${index}`);
    const row = value as Record<string, unknown>;
    const name = row[nameKey];
    if (typeof name !== "string" || !allowed.has(name)
      || !Number.isSafeInteger(row.bytes) || (row.bytes as number) < 0
      || typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.sha256)) {
      throw new Error(`${label} manifest file ${index} values are invalid.`);
    }
    const path = join(directory, name);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${label} backup file ${name} must be a regular file.`);
    }
    const bytes = await readFile(path);
    if (bytes.byteLength !== row.bytes) {
      throw new Error(`${label} backup file ${name} size does not match its manifest.`);
    }
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== row.sha256) {
      throw new Error(`${label} backup file ${name} hash does not match its manifest.`);
    }
    files.push({
      name,
      bytes,
      expectedBytes: row.bytes as number,
      expectedSha256: row.sha256,
    });
  }
  if (new Set(files.map(({ name }) => name)).size !== files.length
    || (kind === "workspace" && files.length !== 2)
    || !files.some(({ name }) => name === "snapshot.json")) {
    throw new Error(`${label} manifest file inventory is invalid.`);
  }
  const actualDirectoryEntries = (await readdir(directory)).sort();
  const expectedDirectoryEntries = ["manifest-v1.json", ...files.map(({ name }) => name)].sort();
  if (JSON.stringify(actualDirectoryEntries) !== JSON.stringify(expectedDirectoryEntries)) {
    throw new Error(`${label} backup directory inventory is invalid.`);
  }
  const computedSourceDigest = kind === "workspace"
    ? createHash("sha256").update(JSON.stringify(files.map((file) => ({
      relativePath: file.name,
      sha256: file.expectedSha256,
      bytes: file.expectedBytes,
    })))).digest("hex")
    : (() => {
      const hash = createHash("sha256");
      for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
        hash.update(file.name).update("\0").update(file.bytes).update("\0");
      }
      return hash.digest("hex");
    })();
  if (computedSourceDigest !== manifest.sourceDigest) {
    throw new Error(`${label} manifest source digest does not match its backup files.`);
  }
  return manifest.sourceDigest;
}

async function verifyCutoverBackups(
  repoRoot: string,
  marker: TaskAggregateSqliteAuthorityMarkerV1,
): Promise<void> {
  const backupRoot = resolve(repoRoot, marker.backupRootRelativePath);
  for (const task of marker.tasks) {
    const directory = backupTaskDirectory(backupRoot, task.locator);
    const workspaceDigest = await verifyBackupManifest(
      join(directory, "workspace"),
      "Task workspace backup",
      "workspace",
    );
    const sideStateDigest = await verifyBackupManifest(
      join(directory, "side-state"),
      "Task side-state backup",
      "side-state",
    );
    if (workspaceDigest !== task.workspaceSourceDigest
      || sideStateDigest !== task.sideStateSourceDigest) {
      throw new Error("Task aggregate backup digest does not match the authority marker.");
    }
  }
}

/**
 * Performs one startup-only authority transition. The legacy sources remain
 * untouched; the marker is published only after backup, strict import and
 * projection parity have completed under the data-root writer lease.
 */
export async function prepareTaskAggregateSqliteCutover(
  input: PrepareTaskAggregateSqliteCutoverInput,
): Promise<PreparedTaskAggregateSqliteCutover> {
  if (!Number.isSafeInteger(input.activeRunCount) || input.activeRunCount < 0) {
    throw new Error("activeRunCount must be a non-negative integer.");
  }
  if (input.activeRunCount !== 0) {
    throw new Error("Task aggregate SQLite cutover is blocked while Agent Runs are active.");
  }
  const repoRoot = resolve(input.repoRoot);
  const storageRoot = join(repoRoot, "data", "runtime", "task-aggregate-sqlite-v1");
  const markerPath = join(storageRoot, "authority-v1.json");
  await input.authority.assertOwned();

  const existingMarker = await readTaskAggregateAuthorityMarker(markerPath, repoRoot);
  if (existingMarker?.authority === "legacy") {
    return {
      status: "legacy-rollback",
      marker: existingMarker,
      close: () => undefined,
    };
  }
  const databasePath = existingMarker
    ? resolve(repoRoot, existingMarker.databaseRelativePath)
    : join(storageRoot, "task-aggregate.sqlite");
  const databaseRelativeToStorage = relative(storageRoot, databasePath);
  if (!databaseRelativeToStorage
    || databaseRelativeToStorage.startsWith("..")
    || isAbsolute(databaseRelativeToStorage)
    || !/^task-aggregate(?:-recutover-[A-Za-z0-9-]+)?\.sqlite$/u.test(databaseRelativeToStorage)) {
    throw new Error("Task aggregate SQLite authority marker database path is not canonical.");
  }
  const store = new SqliteEventProjectionStore(databasePath);
  try {
    if (existingMarker) {
      verifyCutoverStore(store, existingMarker, false);
      await verifyCutoverBackups(repoRoot, existingMarker);
      await input.authority.assertOwned();
      return {
        status: "already-sqlite",
        marker: existingMarker,
        store,
        backend: createSqliteTaskAggregateBackend({ root: repoRoot, store, authority: input.authority }),
        close: () => store.close(),
      };
    }

    const taskLocators = await inventoryLegacyTaskLocators(repoRoot);
    const hash = taskAggregateInventoryHash(taskLocators);
    const backupRoot = join(repoRoot, "data", "backups", "task-aggregate-cutover-v1");
    const successfulAttemptBackupRoot = join(backupRoot, hash, `attempt-${randomUUID()}`);
    const tasks: TaskAggregateSqliteAuthorityMarkerV1["tasks"] = [];
    for (const locator of taskLocators) {
      const taskBackupRoot = backupTaskDirectory(successfulAttemptBackupRoot, locator);
      const taskSourceDirectory = taskWorkspaceDirectory(repoRoot, locator);
      const workspaceReport = await importLegacyTaskWorkspace({
        store,
        authority: input.authority,
        sourceDirectory: taskSourceDirectory,
        locator,
        backupDirectory: join(taskBackupRoot, "workspace"),
        ...(input.now ? { now: input.now } : {}),
      });
      const sideStateReport = await importLegacyTaskSideState({
        store,
        authority: input.authority,
        locator,
        taskSourceDirectory,
        backupDirectory: join(taskBackupRoot, "side-state"),
      });
      tasks.push({
        locator,
        workspaceSourceDigest: workspaceReport.sourceDigest,
        sideStateSourceDigest: sideStateReport.sourceDigest,
      });
    }
    const cutoverAt = (input.now?.() ?? new Date()).toISOString();
    const marker: TaskAggregateSqliteAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath: relativeWithin(repoRoot, databasePath, "Task aggregate SQLite database path"),
      backupRootRelativePath: relativeWithin(repoRoot, successfulAttemptBackupRoot, "Task aggregate SQLite backup root"),
      cutoverAt,
      inventoryHash: hash,
      tasks,
      excludes: ["project-quality-ledger"],
    };
    verifyCutoverStore(store, marker, true);
    await verifyCutoverBackups(repoRoot, marker);
    await input.authority.assertOwned();
    await writeJsonFile(markerPath, marker, { durability: "critical" });
    await input.authority.assertOwned();
    return {
      status: "cutover",
      marker,
      store,
      backend: createSqliteTaskAggregateBackend({ root: repoRoot, store, authority: input.authority }),
      close: () => store.close(),
    };
  } catch (error) {
    store.close();
    throw error;
  }
}

/**
 * Explicitly leaves a previously selected legacy rollback epoch. Normal startup
 * never calls this path, so a user-requested rollback cannot silently re-enable
 * SQLite.
 */
export async function recutoverTaskAggregateToSqlite(
  input: PrepareTaskAggregateSqliteCutoverInput,
): Promise<Exclude<PreparedTaskAggregateSqliteCutover, { status: "legacy-rollback" }>> {
  if (!Number.isSafeInteger(input.activeRunCount) || input.activeRunCount < 0) {
    throw new Error("activeRunCount must be a non-negative integer.");
  }
  if (input.activeRunCount !== 0) {
    throw new Error("Task aggregate SQLite re-cutover is blocked while Agent Runs are active.");
  }
  const repoRoot = resolve(input.repoRoot);
  const storageRoot = join(repoRoot, "data", "runtime", "task-aggregate-sqlite-v1");
  const markerPath = join(storageRoot, "authority-v1.json");
  await input.authority.assertOwned();
  const current = await readTaskAggregateAuthorityMarker(markerPath, repoRoot);
  if (!current || current.authority !== "legacy") {
    throw new Error("Task aggregate SQLite re-cutover requires an active legacy rollback authority.");
  }

  const databasePath = join(storageRoot, `task-aggregate-recutover-${randomUUID()}.sqlite`);
  const store = new SqliteEventProjectionStore(databasePath);
  try {
    const taskLocators = await inventoryLegacyTaskLocators(repoRoot);
    const hash = taskAggregateInventoryHash(taskLocators);
    const backupRoot = join(
      repoRoot,
      "data",
      "backups",
      "task-aggregate-recutover-v1",
      hash,
      `attempt-${randomUUID()}`,
    );
    const tasks: TaskAggregateSqliteAuthorityMarkerV1["tasks"] = [];
    for (const locator of taskLocators) {
      const taskBackupRoot = backupTaskDirectory(backupRoot, locator);
      const taskSourceDirectory = taskWorkspaceDirectory(repoRoot, locator);
      const workspaceReport = await importLegacyTaskWorkspace({
        store,
        authority: input.authority,
        sourceDirectory: taskSourceDirectory,
        locator,
        backupDirectory: join(taskBackupRoot, "workspace"),
        ...(input.now ? { now: input.now } : {}),
      });
      const sideStateReport = await importLegacyTaskSideState({
        store,
        authority: input.authority,
        locator,
        taskSourceDirectory,
        backupDirectory: join(taskBackupRoot, "side-state"),
      });
      tasks.push({
        locator,
        workspaceSourceDigest: workspaceReport.sourceDigest,
        sideStateSourceDigest: sideStateReport.sourceDigest,
      });
    }
    const marker: TaskAggregateSqliteAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "sqlite",
      databaseRelativePath: relativeWithin(repoRoot, databasePath, "Task aggregate SQLite database path"),
      backupRootRelativePath: relativeWithin(repoRoot, backupRoot, "Task aggregate SQLite backup root"),
      cutoverAt: (input.now?.() ?? new Date()).toISOString(),
      inventoryHash: hash,
      tasks,
      excludes: ["project-quality-ledger"],
    };
    verifyCutoverStore(store, marker, true);
    await verifyCutoverBackups(repoRoot, marker);
    await input.authority.assertOwned();
    await writeJsonFile(markerPath, marker, { durability: "critical" });
    await input.authority.assertOwned();
    return {
      status: "cutover",
      marker,
      store,
      backend: createSqliteTaskAggregateBackend({ root: repoRoot, store, authority: input.authority }),
      close: () => store.close(),
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
