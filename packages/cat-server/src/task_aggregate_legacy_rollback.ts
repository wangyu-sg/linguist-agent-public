import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  createFileTaskMessageQueuePersistence,
  createFileTaskWorkspacePersistence,
  parseTaskRunEvent,
  parseTaskWorkspaceSnapshot,
  syncParentDirectory,
  TASK_WORKSPACE_SCHEMA_VERSION,
  taskWorkspaceDirectory,
  writeDurableFileAtomic,
  writeJsonFile,
  type TaskLocator,
} from "@linguist-agent/cat-data";
import {
  exportSqliteAuditJsonl,
  legacyTaskSideStreamIds,
  legacyTaskStreamId,
  SqliteEventProjectionStore,
  verifySqliteAuditJsonl,
  type SqliteJsonObject,
  type SqliteStorageAuthority,
} from "@linguist-agent/storage-sqlite";
import {
  readTaskAggregateAuthorityMarker,
  taskAggregateInventoryHash,
  type TaskAggregateLegacyAuthorityMarkerV1,
  type TaskAggregateSqliteAuthorityMarkerV1,
} from "./task_aggregate_sqlite_cutover.js";

export interface RollbackTaskAggregateToLegacyInput {
  repoRoot: string;
  authority: SqliteStorageAuthority;
  activeRunCount: number;
  now?: () => Date;
}

export interface TaskAggregateLegacyRollbackReportV1 {
  schemaVersion: 1;
  rolledBackAt: string;
  sourceDatabaseRelativePath: string;
  rollbackRootRelativePath: string;
  taskCount: number;
  projectionParity: true;
  audit: {
    relativePath: string;
    sha256: string;
    eventCount: number;
    projectionCount: number;
    recordCount: number;
  };
  excludes: ["project-quality-ledger"];
}

export interface TaskAggregateLegacyRollbackResult {
  marker: TaskAggregateLegacyAuthorityMarkerV1;
  report: TaskAggregateLegacyRollbackReportV1;
}

interface RenderedTask {
  locator: TaskLocator;
  snapshot: SqliteJsonObject;
  events: SqliteJsonObject[];
  snapshotBytes: string;
  eventsBytes: string;
  queueBytes: string | null;
  profileBytes: string | null;
  workspaceSourceDigest: string;
  sideStateSourceDigest: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function relativeWithin(root: string, path: string, label: string): string {
  const value = relative(root, path);
  if (!value || value.startsWith("..") || isAbsolute(value)) {
    throw new Error(`${label} must be within the repository root.`);
  }
  return value;
}

function isAbsent(value: SqliteJsonObject): boolean {
  return Object.keys(value).length === 1 && value.present === false;
}

function canonicalEvent(payload: SqliteJsonObject, index: number): SqliteJsonObject {
  const raw = payload.taskEvent ?? payload.legacyEvent;
  const parsed = parseTaskRunEvent(raw, `SQLite Task rollback event[${index}]`);
  return JSON.parse(JSON.stringify(parsed)) as SqliteJsonObject;
}

function locatorForSnapshot(value: SqliteJsonObject): TaskLocator {
  const snapshot = parseTaskWorkspaceSnapshot(value);
  return snapshot.task.owner.kind === "standalone"
    ? { kind: "standalone", taskId: snapshot.task.id }
    : {
        kind: "project",
        projectId: snapshot.task.owner.projectId,
        taskId: snapshot.task.id,
      };
}

function digestWorkspace(snapshotBytes: string, eventsBytes: string): string {
  return sha256(JSON.stringify([
    { relativePath: "snapshot.json", sha256: sha256(snapshotBytes), bytes: Buffer.byteLength(snapshotBytes) },
    { relativePath: "events.jsonl", sha256: sha256(eventsBytes), bytes: Buffer.byteLength(eventsBytes) },
  ]));
}

function digestSideState(
  snapshotBytes: string,
  queueBytes: string | null,
  profileBytes: string | null,
): string {
  const hash = createHash("sha256");
  const files = [
    { name: "snapshot.json", bytes: snapshotBytes },
    ...(queueBytes === null ? [] : [{ name: "message_queue.json", bytes: queueBytes }]),
    ...(profileBytes === null ? [] : [{ name: "resource-profile.json", bytes: profileBytes }]),
  ];
  for (const file of files) hash.update(file.name).update("\0").update(file.bytes).update("\0");
  return hash.digest("hex");
}

function renderTask(store: SqliteEventProjectionStore, projection: {
  streamId: string;
  value: SqliteJsonObject;
}): RenderedTask {
  const snapshot = parseTaskWorkspaceSnapshot(projection.value);
  const snapshotJson = JSON.parse(JSON.stringify(snapshot)) as SqliteJsonObject;
  const locator = locatorForSnapshot(snapshotJson);
  if (projection.streamId !== legacyTaskStreamId(locator)) {
    throw new Error("SQLite Task rollback projection id does not match its canonical locator.");
  }
  const events = store.readEvents(projection.streamId).map((event, index) =>
    canonicalEvent(event.payload, index));
  const sideIds = legacyTaskSideStreamIds(locator);
  const queue = store.readProjection(sideIds.messageQueue)?.value ?? { present: false };
  const profile = store.readProjection(sideIds.resourceProfile)?.value ?? { present: false };
  const snapshotBytes = `${JSON.stringify(snapshotJson, null, 2)}\n`;
  const eventsBytes = events.length
    ? `${JSON.stringify({
        recordType: "task_run_event_page_v1",
        page: {
          schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
          taskId: snapshot.task.id,
          runId: events[0]!.runId,
          afterCursor: `${snapshot.task.id}:0`,
          nextCursor: events.at(-1)!.cursor,
          hasMore: false,
          events,
        },
      })}\n`
    : "";
  const queueBytes = isAbsent(queue) ? null : `${JSON.stringify(queue, null, 2)}\n`;
  const profileBytes = isAbsent(profile) ? null : `${JSON.stringify(profile, null, 2)}\n`;
  return {
    locator,
    snapshot: snapshotJson,
    events,
    snapshotBytes,
    eventsBytes,
    queueBytes,
    profileBytes,
    workspaceSourceDigest: digestWorkspace(snapshotBytes, eventsBytes),
    sideStateSourceDigest: digestSideState(snapshotBytes, queueBytes, profileBytes),
  };
}

async function writeOptional(path: string, bytes: string | null): Promise<void> {
  if (bytes !== null) {
    await writeDurableFileAtomic(path, bytes);
    return;
  }
  await rm(path, { force: true });
  await syncParentDirectory(path);
}

async function publishTask(root: string, task: RenderedTask): Promise<void> {
  const directory = taskWorkspaceDirectory(root, task.locator);
  await mkdir(directory, { recursive: true });
  await writeDurableFileAtomic(join(directory, "snapshot.json"), task.snapshotBytes);
  await writeDurableFileAtomic(join(directory, "events.jsonl"), task.eventsBytes);
  await writeOptional(join(directory, "message_queue.json"), task.queueBytes);
  await writeOptional(join(directory, "resource-profile.json"), task.profileBytes);
}

async function verifyPublishedTask(root: string, task: RenderedTask): Promise<void> {
  const workspace = createFileTaskWorkspacePersistence(root);
  const snapshot = await workspace.readSnapshot(task.locator);
  const events = await workspace.readEvents(task.locator);
  if (JSON.stringify(snapshot) !== JSON.stringify(task.snapshot)
    || JSON.stringify(events) !== JSON.stringify(task.events)) {
    throw new Error("Legacy Task workspace rollback parity failed.");
  }
  const queue = await createFileTaskMessageQueuePersistence(root).read(task.locator);
  const expectedQueue = task.queueBytes === null
    ? { schemaVersion: 1, taskId: task.locator.taskId, messages: [], updatedAt: null }
    : JSON.parse(task.queueBytes) as unknown;
  if (JSON.stringify(queue) !== JSON.stringify(expectedQueue)) {
    throw new Error("Legacy Task message queue rollback parity failed.");
  }
  const directory = taskWorkspaceDirectory(root, task.locator);
  const actualProfile = await readFile(join(directory, "resource-profile.json"), "utf8")
    .then((value) => JSON.parse(value) as unknown, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  const expectedProfile = task.profileBytes === null ? null : JSON.parse(task.profileBytes) as unknown;
  if (JSON.stringify(actualProfile) !== JSON.stringify(expectedProfile)) {
    throw new Error("Legacy Task resource profile rollback parity failed.");
  }
}

/**
 * Exports the complete current SQLite Task aggregate before switching the
 * authority marker. The pre-cutover backup alone is intentionally insufficient:
 * it cannot contain Tasks or events created after SQLite became canonical.
 */
export async function rollbackTaskAggregateToLegacy(
  input: RollbackTaskAggregateToLegacyInput,
): Promise<TaskAggregateLegacyRollbackResult> {
  if (!Number.isSafeInteger(input.activeRunCount) || input.activeRunCount < 0) {
    throw new Error("activeRunCount must be a non-negative integer.");
  }
  if (input.activeRunCount !== 0) {
    throw new Error("Task aggregate legacy rollback is blocked while Agent Runs are active.");
  }
  const repoRoot = resolve(input.repoRoot);
  const storageRoot = join(repoRoot, "data", "runtime", "task-aggregate-sqlite-v1");
  const markerPath = join(storageRoot, "authority-v1.json");
  await input.authority.assertOwned();
  const sourceMarker = await readTaskAggregateAuthorityMarker(markerPath, repoRoot);
  if (!sourceMarker || sourceMarker.authority !== "sqlite") {
    throw new Error("Task aggregate legacy rollback requires active SQLite authority.");
  }
  const sourceDatabasePath = resolve(repoRoot, sourceMarker.databaseRelativePath);
  const store = new SqliteEventProjectionStore(sourceDatabasePath, { readOnly: true });
  try {
    if (store.quickCheck() !== "ok") throw new Error("Task aggregate rollback SQLite quick_check failed.");
    const projections = store.listProjections();
    if (projections.some(({ streamId }) => streamId.startsWith("legacy-quality-"))) {
      throw new Error("Task aggregate rollback source contains a forbidden Project quality ledger.");
    }
    const tasks = projections
      .filter(({ streamId }) => streamId.startsWith("legacy-task-"))
      .map((projection) => renderTask(store, projection))
      .sort((left, right) => JSON.stringify(left.locator).localeCompare(JSON.stringify(right.locator)));
    const rolledBackAt = (input.now?.() ?? new Date()).toISOString();
    const rollbackRoot = join(
      repoRoot,
      "data",
      "backups",
      "task-aggregate-rollback-v1",
      `rollback-${rolledBackAt.replaceAll(":", "-")}-${randomUUID()}`,
    );
    await mkdir(rollbackRoot, { recursive: true });
    for (const task of tasks) {
      const backupDirectory = join(
        rollbackRoot,
        "legacy-export",
        sha256(JSON.stringify(task.locator)).slice(0, 32),
      );
      await publishTask(backupDirectory, task);
    }
    const auditPath = join(rollbackRoot, "sqlite-audit-v1.jsonl");
    const audit = await exportSqliteAuditJsonl({ store, destinationPath: auditPath });
    await verifySqliteAuditJsonl({ store, auditPath });

    for (const task of tasks) await publishTask(repoRoot, task);
    for (const task of tasks) await verifyPublishedTask(repoRoot, task);
    const markerTasks: TaskAggregateSqliteAuthorityMarkerV1["tasks"] = tasks.map((task) => ({
      locator: task.locator,
      workspaceSourceDigest: task.workspaceSourceDigest,
      sideStateSourceDigest: task.sideStateSourceDigest,
    }));
    const report: TaskAggregateLegacyRollbackReportV1 = {
      schemaVersion: 1,
      rolledBackAt,
      sourceDatabaseRelativePath: sourceMarker.databaseRelativePath,
      rollbackRootRelativePath: relativeWithin(repoRoot, rollbackRoot, "Task aggregate rollback root"),
      taskCount: tasks.length,
      projectionParity: true,
      audit: {
        relativePath: relativeWithin(repoRoot, auditPath, "Task aggregate rollback audit path"),
        sha256: audit.sha256,
        eventCount: audit.eventCount,
        projectionCount: audit.projectionCount,
        recordCount: audit.recordCount,
      },
      excludes: ["project-quality-ledger"],
    };
    await writeJsonFile(join(rollbackRoot, "rollback-report-v1.json"), report, {
      durability: "critical",
    });
    const marker: TaskAggregateLegacyAuthorityMarkerV1 = {
      schemaVersion: 1,
      authority: "legacy",
      rolledBackAt,
      sourceSqliteDatabaseRelativePath: sourceMarker.databaseRelativePath,
      rollbackRootRelativePath: report.rollbackRootRelativePath,
      auditRelativePath: report.audit.relativePath,
      auditSha256: report.audit.sha256,
      inventoryHash: taskAggregateInventoryHash(tasks.map(({ locator }) => locator)),
      tasks: markerTasks,
      excludes: ["project-quality-ledger"],
    };
    await input.authority.assertOwned();
    await writeJsonFile(markerPath, marker, { durability: "critical" });
    await input.authority.assertOwned();
    return { marker, report };
  } finally {
    store.close();
  }
}
