import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendQualityDecisionLedger,
  createTaskQueuedMessage,
  createTaskWorkspace,
  qualityDecisionLedgerPath,
  taskWorkspaceDirectory,
  updateTaskMessageQueue,
} from "../packages/cat-data/src/index.js";
import {
  importLegacyTaskSideState,
  importLegacyTaskWorkspace,
  legacyTaskSideStreamIds,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";
import {
  readTaskPackageProfile,
  taskPackageProfileHash,
} from "../packages/cat-server/src/task_package_profile.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-task-side-import-"));

try {
  const authority = { assertOwned: async () => undefined };
  const legacyRoot = join(root, "legacy");
  const locator = { kind: "project", projectId: "project-1", taskId: "task-1" } as const;
  const workspace = createTaskWorkspace(legacyRoot, {
    now: () => "2026-07-23T12:00:00.000Z",
  });
  const created = await workspace.create({
    projectId: locator.projectId,
    taskId: locator.taskId,
    title: "Task-side state",
    intent: "Prove Decision, queue, and resource profile parity.",
    kind: "review",
    initialMessage: "Review the synthetic batch.",
  });
  const run = created.runs[0]!;
  const thread = created.agentThreads[0]!;
  await workspace.appendGenerated({
    ...locator,
    runId: run.id,
    events: [{
      type: "decision_upsert",
      agentThreadId: thread.id,
      decision: {
        id: "decision-1",
        taskId: locator.taskId,
        runId: run.id,
        requestedByThreadId: thread.id,
        kind: "approval",
        status: "required",
        prompt: "Approve the synthetic operation?",
        options: [{
          id: "approve",
          label: "Approve",
          action: "approve",
          destructive: false,
        }],
        reason: null,
        scope: {
          kind: "project",
          batchId: "batch-1",
          segmentIds: ["segment-1"],
        },
        createdAt: "2026-07-23T12:00:01.000Z",
        decidedAt: null,
      },
    }],
  });

  const first = createTaskQueuedMessage({
    taskId: locator.taskId,
    runId: run.id,
    id: "message-1",
    text: "First",
    now: "2026-07-23T12:00:02.000Z",
  });
  const second = createTaskQueuedMessage({
    taskId: locator.taskId,
    runId: run.id,
    id: "message-2",
    text: "Second",
    now: "2026-07-23T12:00:03.000Z",
  });
  await updateTaskMessageQueue(legacyRoot, locator, (current) => ({
    ...current,
    messages: [second, first],
    updatedAt: "2026-07-23T12:00:04.000Z",
  }));

  await appendQualityDecisionLedger(legacyRoot, {
    projectId: locator.projectId,
    batchId: "batch-1",
    findingId: "finding-1",
    kind: "quality_finding",
    decision: "open",
    severity: "major",
    evidenceRefs: ["evidence:1"],
    recordedAt: "2026-07-23T12:00:05.000Z",
    logicalEventId: "quality-1",
  });
  await appendQualityDecisionLedger(legacyRoot, {
    projectId: locator.projectId,
    batchId: "batch-1",
    findingId: "finding-1",
    kind: "quality_waiver",
    decision: "accepted_risk",
    reason: "Synthetic waiver.",
    recordedAt: "2026-07-23T12:00:06.000Z",
    logicalEventId: "quality-2",
  });

  const taskDirectory = taskWorkspaceDirectory(legacyRoot, locator);
  const resourceProfile = {
    schemaVersion: 1,
    taskId: locator.taskId,
    revision: 3,
    selections: [
      {
        packageSource: "npm:fixture@1.0.0",
        resourceType: "skill",
        resourceId: "skills/review",
        enabled: true,
      },
      {
        packageSource: "npm:fixture@1.0.0",
        resourceType: "prompt",
        resourceId: "prompts/review.md",
        enabled: false,
      },
    ],
    executableApprovals: [{
      packageSource: "npm:fixture@1.0.0",
      version: "1.0.0",
      integrity: "sha256-fixture",
      approvedAt: "2026-07-23T12:00:07.000Z",
    }],
    updatedAt: "2026-07-23T12:00:08.000Z",
  };
  await writeFile(
    join(taskDirectory, "resource-profile.json"),
    `${JSON.stringify(resourceProfile, null, 2)}\n`,
  );
  const canonicalResourceProfile = await readTaskPackageProfile({
    repoRoot: legacyRoot,
    projectId: locator.projectId,
    taskId: locator.taskId,
  });

  const store = new SqliteEventProjectionStore(join(root, "imports.sqlite"));
  await importLegacyTaskWorkspace({
    store,
    authority,
    sourceDirectory: taskDirectory,
    locator,
    backupDirectory: join(root, "backups", "task"),
  });
  const report = await importLegacyTaskSideState({
    store,
    authority,
    locator,
    taskSourceDirectory: taskDirectory,
    qualityDecisionLedgerPath: qualityDecisionLedgerPath(legacyRoot, locator.projectId),
    backupDirectory: join(root, "backups", "task-side"),
  });

  assert.equal(report.taskDecisionCount, 1);
  assert.equal(report.qualityDecisionCount, 2);
  assert.equal(report.queueMessageCount, 2);
  assert.deepEqual(report.queueMessageIds, ["message-2", "message-1"]);
  assert.equal(report.resourceProfileRevision, 3);
  assert.equal(report.resourceProfileHash, taskPackageProfileHash(canonicalResourceProfile));
  assert.equal(report.projectionParity, true);
  assert.equal(report.sourceDigest.length, 64);
  const backupManifest = JSON.parse(
    await readFile(join(root, "backups", "task-side", "manifest-v1.json"), "utf8"),
  ) as { sourceDigest: string; files: Array<{ name: string }> };
  assert.equal(backupManifest.sourceDigest, report.sourceDigest);
  assert.deepEqual(backupManifest.files.map(({ name }) => name), [
    "snapshot.json",
    "message_queue.json",
    "resource-profile.json",
    "quality_decision_ledger.jsonl",
  ]);

  const streamIds = legacyTaskSideStreamIds(locator);
  assert.equal(
    streamIds.qualityDecisions,
    legacyTaskSideStreamIds({
      kind: "project",
      projectId: locator.projectId,
      taskId: "another-task-in-the-same-project",
    }).qualityDecisions,
  );
  assert.notEqual(
    streamIds.messageQueue,
    legacyTaskSideStreamIds({
      kind: "project",
      projectId: locator.projectId,
      taskId: "another-task-in-the-same-project",
    }).messageQueue,
  );
  assert.deepEqual(
    store.readEvents(streamIds.qualityDecisions).map(({ sequence }) => sequence),
    [1, 2],
  );
  assert.deepEqual(
    store.readProjection(streamIds.messageQueue)?.value.messages,
    [second, first].map((message) => JSON.parse(JSON.stringify(message))),
  );
  assert.deepEqual(
    store.readProjection(streamIds.resourceProfile)?.value,
    JSON.parse(JSON.stringify(canonicalResourceProfile)),
  );
  const repeated = await importLegacyTaskSideState({
    store,
    authority,
    locator,
    taskSourceDirectory: taskDirectory,
    qualityDecisionLedgerPath: qualityDecisionLedgerPath(legacyRoot, locator.projectId),
    backupDirectory: join(root, "backups", "task-side-repeat"),
  });
  assert.equal(repeated.commandIds.join(","), report.commandIds.join(","));
  assert.equal(store.readEvents(streamIds.qualityDecisions).length, 2);

  const orphanStore = new SqliteEventProjectionStore(join(root, "orphan.sqlite"));
  await assert.rejects(
    importLegacyTaskSideState({
      store: orphanStore,
      authority,
      locator,
      taskSourceDirectory: taskDirectory,
      qualityDecisionLedgerPath: qualityDecisionLedgerPath(legacyRoot, locator.projectId),
      backupDirectory: join(root, "backups", "orphan"),
    }),
    /Task aggregate.*must be imported first/,
  );
  orphanStore.close();

  const invalidDirectory = join(root, "invalid-task");
  await mkdir(invalidDirectory, { recursive: true });
  await writeFile(
    join(invalidDirectory, "snapshot.json"),
    await readFile(join(taskDirectory, "snapshot.json"), "utf8"),
  );
  await writeFile(
    join(invalidDirectory, "message_queue.json"),
    `${JSON.stringify({
      ...(JSON.parse(await readFile(join(taskDirectory, "message_queue.json"), "utf8")) as object),
      inventedAuthority: true,
    })}\n`,
  );
  await writeFile(
    join(invalidDirectory, "resource-profile.json"),
    await readFile(join(taskDirectory, "resource-profile.json"), "utf8"),
  );
  const invalidStore = new SqliteEventProjectionStore(join(root, "invalid.sqlite"));
  await importLegacyTaskWorkspace({
    store: invalidStore,
    authority,
    sourceDirectory: taskDirectory,
    locator,
    backupDirectory: join(root, "backups", "invalid-task"),
  });
  await assert.rejects(
    importLegacyTaskSideState({
      store: invalidStore,
      authority,
      locator,
      taskSourceDirectory: invalidDirectory,
      qualityDecisionLedgerPath: qualityDecisionLedgerPath(legacyRoot, locator.projectId),
      backupDirectory: join(root, "backups", "invalid-side"),
    }),
    /unmapped field: inventedAuthority/,
  );
  assert.equal(invalidStore.readProjection(legacyTaskSideStreamIds(locator).messageQueue), null);
  assert.equal(
    JSON.parse(await readFile(join(invalidDirectory, "message_queue.json"), "utf8")).inventedAuthority,
    true,
  );
  invalidStore.close();

  const authorityStore = new SqliteEventProjectionStore(join(root, "authority.sqlite"));
  await importLegacyTaskWorkspace({
    store: authorityStore,
    authority,
    sourceDirectory: taskDirectory,
    locator,
    backupDirectory: join(root, "backups", "authority-task"),
  });
  let authorityChecks = 0;
  await assert.rejects(
    importLegacyTaskSideState({
      store: authorityStore,
      authority: {
        assertOwned: async () => {
          authorityChecks += 1;
          if (authorityChecks > 1) throw new Error("storage authority was lost");
        },
      },
      locator,
      taskSourceDirectory: taskDirectory,
      qualityDecisionLedgerPath: qualityDecisionLedgerPath(legacyRoot, locator.projectId),
      backupDirectory: join(root, "backups", "authority-side"),
    }),
    /authority was lost/,
  );
  const authorityStreams = legacyTaskSideStreamIds(locator);
  assert.equal(authorityStore.readProjection(authorityStreams.qualityDecisions), null);
  assert.equal(authorityStore.readProjection(authorityStreams.messageQueue), null);
  assert.equal(authorityStore.readProjection(authorityStreams.resourceProfile), null);
  authorityStore.close();
  store.close();
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("sqlite_storage_task_side_importer.test.ts passed");
