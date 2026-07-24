import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileTaskMessageQueuePersistence,
  createFileTaskWorkspacePersistence,
  createTaskQueuedMessage,
  createTaskWorkspace,
  taskWorkspaceDirectory,
  updateTaskMessageQueue,
} from "../packages/cat-data/src/index.js";
import {
  activateTaskAggregateSqliteCutover,
  prepareTaskAggregateSqliteCutover,
} from "../packages/cat-server/src/task_aggregate_sqlite_cutover.js";
import {
  createFileTaskPackageProfilePersistence,
} from "../packages/cat-server/src/task_package_profile.js";
import {
  reconcileInterruptedTaskExtensionInteractions,
} from "../packages/cat-server/src/task_extension_reconciliation.js";
import {
  importLegacyTaskWorkspace,
  legacyTaskSideStreamIds,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-task-cutover-"));

try {
  const locator = {
    kind: "project",
    projectId: "project-1",
    taskId: "task-1",
  } as const;
  const workspace = createTaskWorkspace(root, {
    now: () => "2026-07-23T20:00:00.000Z",
  });
  const created = await workspace.create({
    projectId: locator.projectId,
    taskId: locator.taskId,
    title: "Cutover fixture",
    intent: "Prove one atomic Task aggregate authority cutover.",
    kind: "review",
    initialMessage: "Review the synthetic source.",
  });
  await updateTaskMessageQueue(root, locator, (current) => ({
    ...current,
    messages: [createTaskQueuedMessage({
      taskId: locator.taskId,
      runId: created.runs[0]!.id,
      id: "message-1",
      text: "Continue after cutover.",
      now: "2026-07-23T20:00:01.000Z",
    })],
    updatedAt: "2026-07-23T20:00:01.000Z",
  }));
  await writeFile(
    join(taskWorkspaceDirectory(root, locator), "resource-profile.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      taskId: locator.taskId,
      revision: 1,
      selections: [],
      executableApprovals: [],
      updatedAt: "2026-07-23T20:00:02.000Z",
    })}\n`,
  );
  const legacySnapshot = await readFile(
    join(taskWorkspaceDirectory(root, locator), "snapshot.json"),
  );

  const authority = { assertOwned: async () => undefined };
  const cutover = await prepareTaskAggregateSqliteCutover({
    repoRoot: root,
    authority,
    activeRunCount: 0,
    now: () => new Date("2026-07-23T20:00:03.000Z"),
  });
  assert.equal(cutover.status, "cutover");
  assert.equal(cutover.marker.authority, "sqlite");
  assert.deepEqual(cutover.marker.excludes, ["project-quality-ledger"]);
  assert.deepEqual(cutover.marker.tasks.map(({ locator: taskLocator }) => taskLocator), [locator]);
  assert.deepEqual(await cutover.backend.workspace.readSnapshot(locator), created);
  assert.deepEqual(
    (await cutover.backend.messageQueue.read(locator)).messages.map(({ id }) => id),
    ["message-1"],
  );
  assert.equal(
    (await cutover.backend.taskPackageProfile.read({
      repoRoot: root,
      projectId: locator.projectId,
      taskId: locator.taskId,
    }))?.revision,
    1,
  );
  assert.equal(
    cutover.store.readProjection(legacyTaskSideStreamIds(locator).qualityDecisions),
    null,
    "LA-089 must not create a shadow Project quality-ledger projection",
  );
  assert.deepEqual(
    await readFile(join(taskWorkspaceDirectory(root, locator), "snapshot.json")),
    legacySnapshot,
    "cutover must not rewrite legacy source bytes",
  );
  cutover.close();

  const reloaded = await prepareTaskAggregateSqliteCutover({
    repoRoot: root,
    authority,
    activeRunCount: 0,
    now: () => new Date("2026-07-23T20:01:00.000Z"),
  });
  assert.equal(reloaded.status, "already-sqlite");
  assert.deepEqual(reloaded.marker, cutover.marker);
  assert.deepEqual(
    (await reloaded.backend.messageQueue.read(locator)).messages.map(({ id }) => id),
    ["message-1"],
    "pending queue state must recover from canonical SQLite",
  );

  const activeRoot = join(root, "active-run-block");
  await assert.rejects(
    prepareTaskAggregateSqliteCutover({
      repoRoot: activeRoot,
      authority,
      activeRunCount: 1,
    }),
    /blocked while Agent Runs are active/,
  );
  await assert.rejects(
    readFile(join(activeRoot, "data", "runtime", "task-aggregate-sqlite-v1", "authority-v1.json")),
    /ENOENT/,
  );

  const partialRoot = join(root, "partial-cutover");
  const partialLocator = {
    kind: "standalone",
    taskId: "standalone-1",
  } as const;
  const partialWorkspace = createTaskWorkspace(partialRoot, {
    now: () => "2026-07-23T20:02:00.000Z",
  });
  await partialWorkspace.create({
    owner: { kind: "standalone" },
    taskId: partialLocator.taskId,
    title: "Partial cutover",
    intent: "Recover a database written before marker publication.",
    kind: "general",
    initialMessage: "Recover me.",
  });
  const partialDatabasePath = join(
    partialRoot,
    "data",
    "runtime",
    "task-aggregate-sqlite-v1",
    "task-aggregate.sqlite",
  );
  const partialStore = new SqliteEventProjectionStore(partialDatabasePath);
  await importLegacyTaskWorkspace({
    store: partialStore,
    authority,
    sourceDirectory: taskWorkspaceDirectory(partialRoot, partialLocator),
    locator: partialLocator,
    backupDirectory: join(partialRoot, "manual-pre-marker-backup"),
    now: () => new Date("2026-07-23T20:02:01.000Z"),
  });
  partialStore.close();
  const recovered = await prepareTaskAggregateSqliteCutover({
    repoRoot: partialRoot,
    authority,
    activeRunCount: 0,
    now: () => new Date("2026-07-23T20:02:02.000Z"),
  });
  assert.equal(recovered.status, "cutover");
  assert.deepEqual(recovered.marker.tasks.map(({ locator: taskLocator }) => taskLocator), [partialLocator]);
  assert.ok(await recovered.backend.workspace.readSnapshot(partialLocator));
  recovered.close();
  const recoveredBackupRoot = join(partialRoot, recovered.marker.backupRootRelativePath);
  const recoveredBackupEntries = await readdir(recoveredBackupRoot);
  assert.equal(recoveredBackupEntries.length, 1);
  const recoveredWorkspaceBackup = join(
    recoveredBackupRoot,
    recoveredBackupEntries[0]!,
    "workspace",
    "snapshot.json",
  );
  const recoveredWorkspaceBackupBytes = await readFile(recoveredWorkspaceBackup);
  await writeFile(recoveredWorkspaceBackup, "{\"corrupted\":true}\n");
  await assert.rejects(
    prepareTaskAggregateSqliteCutover({
      repoRoot: partialRoot,
      authority,
      activeRunCount: 0,
    }),
    /backup file .* (hash|size) does not match/u,
    "a published marker with corrupted pre-cutover backup bytes must fail closed",
  );
  await writeFile(recoveredWorkspaceBackup, recoveredWorkspaceBackupBytes);
  await rm(join(
    recoveredBackupRoot,
    recoveredBackupEntries[0]!,
    "side-state",
    "manifest-v1.json",
  ));
  await assert.rejects(
    prepareTaskAggregateSqliteCutover({
      repoRoot: partialRoot,
      authority,
      activeRunCount: 0,
    }),
    /ENOENT/,
    "a published marker without its complete pre-cutover backup must fail closed",
  );

  const invalidRoot = join(root, "invalid-source");
  const invalidLocator = {
    kind: "standalone",
    taskId: "broken-task",
  } as const;
  await mkdir(taskWorkspaceDirectory(invalidRoot, invalidLocator), { recursive: true });
  await writeFile(
    join(taskWorkspaceDirectory(invalidRoot, invalidLocator), "snapshot.json"),
    "{\"schemaVersion\":2,\"inventedAuthority\":true}\n",
  );
  await assert.rejects(
    prepareTaskAggregateSqliteCutover({
      repoRoot: invalidRoot,
      authority,
      activeRunCount: 0,
    }),
  );
  await assert.rejects(
    readFile(join(invalidRoot, "data", "runtime", "task-aggregate-sqlite-v1", "authority-v1.json")),
    /ENOENT/,
  );

  activateTaskAggregateSqliteCutover(reloaded);
  await assert.rejects(
    createFileTaskWorkspacePersistence(root).replaceProjection(locator, created, created),
    /read-only after SQLite authority cutover/,
  );
  await assert.rejects(
    createFileTaskMessageQueuePersistence(root).update(locator, (current) => current),
    /read-only after SQLite authority cutover/,
  );
  await assert.rejects(
    createFileTaskPackageProfilePersistence(root).write(
      { repoRoot: root, projectId: locator.projectId, taskId: locator.taskId },
      null,
      null,
    ),
    /read-only after SQLite authority cutover/,
  );
  const postCutoverWorkspace = createTaskWorkspace(root, {
    now: () => "2026-07-23T20:03:00.000Z",
  });
  await postCutoverWorkspace.create({
    owner: { kind: "standalone" },
    taskId: "post-cutover-task",
    title: "SQLite-only Task",
    intent: "Prove new production writes use the canonical SQLite backend.",
    kind: "general",
  });
  assert.ok(await postCutoverWorkspace.open({
    kind: "standalone",
    taskId: "post-cutover-task",
  }));
  await assert.rejects(
    readFile(join(
      taskWorkspaceDirectory(root, { kind: "standalone", taskId: "post-cutover-task" }),
      "snapshot.json",
    )),
    /ENOENT/,
    "canonical post-cutover writes must not recreate the legacy Task files",
  );
  const recoveryTask = await postCutoverWorkspace.create({
    projectId: locator.projectId,
    taskId: "post-cutover-recovery",
    title: "SQLite recovery Task",
    intent: "Prove startup recovery reads canonical SQLite state.",
    kind: "general",
    initialMessage: "Start a recoverable Run.",
  });
  const recoveryRun = recoveryTask.runs[0]!;
  await postCutoverWorkspace.appendGenerated({
    projectId: locator.projectId,
    taskId: recoveryTask.task.id,
    runId: recoveryRun.id,
    events: [{
      type: "run_upsert",
      agentThreadId: recoveryRun.rootAgentThreadId,
      run: {
        ...recoveryRun,
        status: "active",
        startedAt: "2026-07-23T20:03:01.000Z",
        updatedAt: "2026-07-23T20:03:01.000Z",
        stopAvailable: true,
        resumeAvailable: false,
      },
    }],
  });
  const reconciled = await reconcileInterruptedTaskExtensionInteractions({
    repoRoot: root,
    failedAt: "2026-07-23T20:03:02.000Z",
  });
  assert.deepEqual(reconciled.runIds, [recoveryRun.id]);
  assert.equal(
    (await postCutoverWorkspace.open({
      projectId: locator.projectId,
      taskId: recoveryTask.task.id,
    })).runs[0]?.status,
    "failed",
  );
  reloaded.close();
  const postMutationReload = await prepareTaskAggregateSqliteCutover({
    repoRoot: root,
    authority,
    activeRunCount: 0,
  });
  assert.equal(postMutationReload.status, "already-sqlite");
  assert.ok(await postMutationReload.backend.workspace.readSnapshot({
    kind: "standalone",
    taskId: "post-cutover-task",
  }));
  postMutationReload.close();
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("sqlite_storage_task_cutover.test.ts passed");
