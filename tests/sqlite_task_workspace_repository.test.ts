import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskWorkspace,
  taskWorkspaceDirectory,
  type TaskWorkspaceSnapshot,
} from "../packages/cat-data/src/index.js";
import {
  createSqliteTaskWorkspacePersistence,
  createSqliteTaskWorkspaceRepository,
  importLegacyTaskWorkspace,
  legacyTaskStreamId,
  SqliteEventProjectionStore,
  SQLITE_TASK_WORKSPACE_REPOSITORY_READINESS,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-task-repository-"));
const nonAuthoritativeStorageHelpers = [
  join(process.cwd(), "packages", "cat-server", "src", "cross_domain_sqlite_backup.ts"),
] as const;

assert.deepEqual(
  [...nonAuthoritativeStorageHelpers],
  [join(process.cwd(), "packages", "cat-server", "src", "cross_domain_sqlite_backup.ts")],
  "only the named LA-100 aggregate backup/recovery helper may use storage primitives without being a domain cutover owner",
);

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:[cm]?[jt]sx?|json)$/u.test(entry.name)) files.push(path);
  }
  return files;
}

try {
  assert.deepEqual(SQLITE_TASK_WORKSPACE_REPOSITORY_READINESS, {
    schemaVersion: 1,
    authority: "unconnected",
    productionCutoverOwner: "LA-089",
  });
  const databasePath = join(root, "tasks.sqlite");
  const authority = { assertOwned: async () => undefined };
  const store = new SqliteEventProjectionStore(databasePath);
  const workspace = createSqliteTaskWorkspaceRepository({
    store,
    authority,
    options: { now: () => "2026-07-23T10:00:00.000Z" },
  });

  await workspace.create({
    owner: { kind: "standalone" },
    taskId: "zero-event-task",
    title: "Revision zero",
    intent: "Prove the first event can follow a projection-only Task creation.",
    kind: "general",
  });

  const appended = await workspace.append({
    kind: "standalone",
    taskId: "zero-event-task",
    page: {
      schemaVersion: 2,
      taskId: "zero-event-task",
      runId: "run-1",
      afterCursor: "zero-event-task:0",
      nextCursor: "zero-event-task:2",
      hasMore: false,
      events: [
        {
          id: "event-run-1",
          cursor: "zero-event-task:1",
          seq: 1,
          taskId: "zero-event-task",
          runId: "run-1",
          agentThreadId: "thread-1",
          type: "run_upsert",
          occurredAt: "2026-07-23T10:00:01.000Z",
          run: {
            id: "run-1",
            taskId: "zero-event-task",
            mode: "single",
            status: "active",
            rootAgentThreadId: "thread-1",
            updatedAt: "2026-07-23T10:00:01.000Z",
            stopAvailable: true,
            resumeAvailable: false,
          },
        },
        {
          id: "event-thread-1",
          cursor: "zero-event-task:2",
          seq: 2,
          taskId: "zero-event-task",
          runId: "run-1",
          agentThreadId: "thread-1",
          type: "thread_upsert",
          occurredAt: "2026-07-23T10:00:01.000Z",
          thread: {
            id: "thread-1",
            taskId: "zero-event-task",
            runId: "run-1",
            parentThreadId: null,
            identity: {
              kind: "main",
              roleId: "linguist-agent",
              displayName: "Linguist Agent",
              roleLabel: "Main Agent",
              disclosureLabel: "Agent",
            },
            status: "active",
            canReceiveUserMessage: true,
            childThreadIds: [],
            createdAt: "2026-07-23T10:00:01.000Z",
            updatedAt: "2026-07-23T10:00:01.000Z",
          },
        },
      ],
    },
  });

  assert.equal(appended.eventCursor, "zero-event-task:2");
  assert.equal(store.currentRevision(legacyTaskStreamId({
    kind: "standalone",
    taskId: "zero-event-task",
  })), 2);

  const persistence = createSqliteTaskWorkspacePersistence(store, authority);
  const locator = { kind: "standalone", taskId: "zero-event-task" } as const;
  const stale = await persistence.readSnapshot(locator);
  assert.ok(stale);
  const firstTitle: TaskWorkspaceSnapshot = {
    ...stale,
    task: { ...stale.task, title: "First contender" },
  };
  const secondTitle: TaskWorkspaceSnapshot = {
    ...stale,
    task: { ...stale.task, title: "Second contender" },
  };
  const contenders = await Promise.allSettled([
    persistence.replaceProjection(locator, stale, firstTitle),
    persistence.replaceProjection(locator, stale, secondTitle),
  ]);
  assert.equal(contenders.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(contenders.filter(({ status }) => status === "rejected").length, 1);

  store.close();

  const reopenedStore = new SqliteEventProjectionStore(databasePath);
  const reopened = createSqliteTaskWorkspaceRepository({ store: reopenedStore, authority });
  assert.deepEqual(
    (await reopened.eventsAfter({
      kind: "standalone",
      taskId: "zero-event-task",
    })).events.map(({ id }) => id),
    ["event-run-1", "event-thread-1"],
  );
  assert.equal(
    (await reopened.open({ kind: "standalone", taskId: "zero-event-task" })).activeRunId,
    "run-1",
  );

  const denied = createSqliteTaskWorkspaceRepository({
    store: reopenedStore,
    authority: {
      assertOwned: async () => {
        throw new Error("storage authority is not owned");
      },
    },
  });
  await assert.rejects(
    denied.updateTitle({
      kind: "standalone",
      taskId: "zero-event-task",
      expectedTitle: (await reopened.open(locator)).task.title,
      title: "Must not commit",
    }),
    /authority is not owned/,
  );
  assert.notEqual((await reopened.open(locator)).task.title, "Must not commit");
  reopenedStore.close();

  const legacyRoot = join(root, "legacy");
  const legacy = createTaskWorkspace(legacyRoot, {
    now: () => "2026-07-23T11:00:00.000Z",
  });
  await legacy.create({
    projectId: "project-1",
    taskId: "imported-task",
    title: "Legacy title",
    intent: "Prove an imported aggregate remains writable through the new repository.",
    kind: "review",
    initialMessage: "Review the synthetic project.",
  });
  const importedStore = new SqliteEventProjectionStore(join(root, "imported.sqlite"));
  await importLegacyTaskWorkspace({
    store: importedStore,
    authority,
    sourceDirectory: taskWorkspaceDirectory(legacyRoot, {
      kind: "project",
      projectId: "project-1",
      taskId: "imported-task",
    }),
    locator: { kind: "project", projectId: "project-1", taskId: "imported-task" },
    backupDirectory: join(root, "backups", "imported-task"),
  });
  const imported = createSqliteTaskWorkspaceRepository({ store: importedStore, authority });
  assert.equal((await imported.open({
    projectId: "project-1",
    taskId: "imported-task",
  })).task.title, "Legacy title");
  assert.equal((await imported.updateTitle({
    projectId: "project-1",
    taskId: "imported-task",
    expectedTitle: "Legacy title",
    title: "SQLite title",
  }))?.task.title, "SQLite title");
  importedStore.close();

  const productionRoots = [
    join(process.cwd(), "packages", "cat-server"),
    join(process.cwd(), "packages", "cat-runtime"),
    join(process.cwd(), "packages", "cat-data"),
    join(process.cwd(), "apps", "desktop"),
  ];
  for (const productionRoot of productionRoots) {
    for (const path of await sourceFiles(productionRoot)) {
      const isLa089CutoverOwner = path.endsWith("/packages/cat-server/src/task_aggregate_sqlite_cutover.ts")
        || path.endsWith("/packages/cat-server/src/task_aggregate_legacy_rollback.ts")
        || path.endsWith("/packages/cat-server/src/settings_grants_trust_sqlite_cutover.ts")
        || path.endsWith("/packages/cat-server/src/lapkg_sqlite_cutover.ts")
        || path.endsWith("/packages/cat-server/src/assistant_memory_sqlite_cutover.ts")
        || path.endsWith("/packages/cat-server/src/assistant_library_sqlite_cutover.ts")
        || path.endsWith("/packages/cat-server/src/cat_core_sqlite_cutover.ts")
        || path.endsWith("/packages/cat-server/src/cat_governance_sqlite_cutover.ts")
        || path.endsWith("/packages/cat-server/src/workflow_eval_sqlite_cutover.ts")
        || path.endsWith("/packages/cat-server/package.json");
      const isNonAuthoritativeStorageHelper = nonAuthoritativeStorageHelpers.includes(path as typeof nonAuthoritativeStorageHelpers[number]);
      if (isLa089CutoverOwner || isNonAuthoritativeStorageHelper) continue;
      assert.doesNotMatch(
        await readFile(path, "utf8"),
        /@linguist-agent\/storage-sqlite|packages\/storage-sqlite/u,
        `${path} must not bypass its domain-specific SQLite cutover owner`,
      );
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("sqlite_task_workspace_repository.test.ts passed");
