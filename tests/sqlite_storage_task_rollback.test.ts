import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileTaskMessageQueuePersistence,
  createFileTaskWorkspacePersistence,
  createTaskQueuedMessage,
  createTaskWorkspaceFromPersistence,
  taskWorkspaceDirectory,
} from "../packages/cat-data/src/index.js";
import {
  prepareTaskAggregateSqliteCutover,
  recutoverTaskAggregateToSqlite,
} from "../packages/cat-server/src/task_aggregate_sqlite_cutover.js";
import {
  rollbackTaskAggregateToLegacy,
} from "../packages/cat-server/src/task_aggregate_legacy_rollback.js";
import {
  verifySqliteAuditJsonl,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-task-aggregate-rollback-"));
const authority = { assertOwned: async () => undefined };

try {
  const fileWorkspace = createTaskWorkspaceFromPersistence(
    createFileTaskWorkspacePersistence(root),
    { now: () => "2026-07-23T22:00:00.000Z" },
  );
  const initial = await fileWorkspace.create({
    owner: { kind: "standalone" },
    taskId: "task-before-cutover",
    title: "Before cutover",
    intent: "Prove whole-domain rollback.",
    kind: "general",
    initialMessage: "Keep the complete event history.",
  });
  const initialLocator = { kind: "standalone", taskId: initial.task.id } as const;
  const fileQueue = createFileTaskMessageQueuePersistence(root);
  await fileQueue.update(initialLocator, (current) => ({
    ...current,
    messages: [createTaskQueuedMessage({
      taskId: initial.task.id,
      runId: initial.runs[0]!.id,
      id: "queued-before-cutover",
      text: "Persist through both authority changes.",
      now: "2026-07-23T22:00:01.000Z",
    })],
    updatedAt: "2026-07-23T22:00:01.000Z",
  }));

  const firstCutover = await prepareTaskAggregateSqliteCutover({
    repoRoot: root,
    authority,
    activeRunCount: 0,
    now: () => new Date("2026-07-23T22:00:02.000Z"),
  });
  assert.notEqual(firstCutover.status, "legacy-rollback");
  if (firstCutover.status === "legacy-rollback") throw new Error("unexpected legacy authority");
  const firstDatabasePath = join(root, firstCutover.marker.databaseRelativePath);
  const sqliteWorkspace = createTaskWorkspaceFromPersistence(
    firstCutover.backend.workspace,
    { now: () => "2026-07-23T22:00:03.000Z" },
  );
  const afterCutover = await sqliteWorkspace.create({
    owner: { kind: "standalone" },
    taskId: "task-after-cutover",
    title: "After cutover",
    intent: "This Task exists only in canonical SQLite before rollback.",
    kind: "general",
    initialMessage: "Rollback must not lose me.",
  });
  await firstCutover.backend.messageQueue.update(
    { kind: "standalone", taskId: afterCutover.task.id },
    (current) => ({
      ...current,
      messages: [createTaskQueuedMessage({
        taskId: afterCutover.task.id,
        runId: afterCutover.runs[0]!.id,
        id: "queued-after-cutover",
        text: "SQLite-only queue message.",
        now: "2026-07-23T22:00:04.000Z",
      })],
      updatedAt: "2026-07-23T22:00:04.000Z",
    }),
  );
  firstCutover.close();

  const rollback = await rollbackTaskAggregateToLegacy({
    repoRoot: root,
    authority,
    activeRunCount: 0,
    now: () => new Date("2026-07-23T22:00:05.000Z"),
  });
  assert.equal(rollback.marker.authority, "legacy");
  assert.deepEqual(
    rollback.marker.tasks.map(({ locator }) => locator.taskId).sort(),
    ["task-after-cutover", "task-before-cutover"],
  );
  assert.equal(rollback.report.projectionParity, true);
  assert.equal(rollback.report.audit.sha256.length, 64);
  const originalReadOnlyStore = new SqliteEventProjectionStore(firstDatabasePath, { readOnly: true });
  assert.equal(
    (await verifySqliteAuditJsonl({
      store: originalReadOnlyStore,
      auditPath: join(root, rollback.report.audit.relativePath),
    })).valid,
    true,
  );
  originalReadOnlyStore.close();

  const legacyStartup = await prepareTaskAggregateSqliteCutover({
    repoRoot: root,
    authority,
    activeRunCount: 0,
  });
  assert.equal(legacyStartup.status, "legacy-rollback");
  legacyStartup.close();
  const restoredWorkspace = createTaskWorkspaceFromPersistence(
    createFileTaskWorkspacePersistence(root),
    { now: () => "2026-07-23T22:00:06.000Z" },
  );
  assert.equal(
    (await restoredWorkspace.open({ kind: "standalone", taskId: "task-after-cutover" })).task.title,
    "After cutover",
  );
  assert.deepEqual(
    (await fileQueue.read({ kind: "standalone", taskId: "task-after-cutover" }))
      .messages.map(({ id }) => id),
    ["queued-after-cutover"],
  );
  await restoredWorkspace.create({
    owner: { kind: "standalone" },
    taskId: "task-during-rollback",
    title: "During rollback",
    intent: "Prove re-cutover imports the current whole legacy domain.",
    kind: "general",
  });

  const recutover = await recutoverTaskAggregateToSqlite({
    repoRoot: root,
    authority,
    activeRunCount: 0,
    now: () => new Date("2026-07-23T22:00:07.000Z"),
  });
  assert.equal(recutover.status, "cutover");
  assert.notEqual(
    join(root, recutover.marker.databaseRelativePath),
    firstDatabasePath,
    "re-cutover must build a fresh candidate instead of mutating the rolled-back SQLite database",
  );
  assert.deepEqual(
    (await recutover.backend.workspace.listLocators({ kind: "standalone" }))
      .map(({ taskId }) => taskId)
      .sort(),
    ["task-after-cutover", "task-before-cutover", "task-during-rollback"],
  );
  recutover.close();

  const restarted = await prepareTaskAggregateSqliteCutover({
    repoRoot: root,
    authority,
    activeRunCount: 0,
  });
  assert.equal(restarted.status, "already-sqlite");
  if (restarted.status === "legacy-rollback") throw new Error("unexpected legacy authority");
  assert.equal(
    (await restarted.backend.workspace.readSnapshot({
      kind: "standalone",
      taskId: "task-during-rollback",
    }))?.task.title,
    "During rollback",
  );
  restarted.close();

  await assert.rejects(
    rollbackTaskAggregateToLegacy({
      repoRoot: root,
      authority,
      activeRunCount: 1,
    }),
    /blocked while Agent Runs are active/,
  );
  await assert.rejects(
    recutoverTaskAggregateToSqlite({
      repoRoot: root,
      authority,
      activeRunCount: 1,
    }),
    /blocked while Agent Runs are active/,
  );

  const taskAggregateStorageSource = await readFile(
    join(process.cwd(), "packages", "cat-data", "src", "task_aggregate_storage.ts"),
    "utf8",
  );
  assert.match(taskAggregateStorageSource, /assertLegacyTaskFileWriteAllowed/u);
  for (const path of [
    "packages/cat-data/src/task_workspace.ts",
    "packages/cat-data/src/task_message_queue.ts",
    "packages/cat-server/src/task_package_profile.ts",
  ]) {
    assert.match(
      await readFile(join(process.cwd(), path), "utf8"),
      /assertLegacyTaskFileWriteAllowed/u,
      `${path} must retain the read-only compatibility guard`,
    );
  }
  assert.equal(
    (await readFile(
      join(taskWorkspaceDirectory(root, { kind: "standalone", taskId: "task-after-cutover" }), "snapshot.json"),
      "utf8",
    )).includes("After cutover"),
    true,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("sqlite_storage_task_rollback.test.ts passed");
