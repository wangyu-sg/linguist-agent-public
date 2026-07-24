import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskWorkspace, taskWorkspaceDirectory } from "../packages/cat-data/src/index.js";
import {
  importLegacyTaskWorkspace,
  legacyTaskStreamId,
  SqliteEventProjectionStore,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-task-importer-"));

try {
  const authority = { assertOwned: async () => undefined };
  const legacyRoot = join(root, "legacy");
  const workspace = createTaskWorkspace(legacyRoot, {
    now: (() => {
      let tick = 0;
      return () => `2026-07-23T02:00:${String(tick++).padStart(2, "0")}.000Z`;
    })(),
  });
  const project = await workspace.create({
    projectId: "project-1",
    taskId: "project-task",
    title: "Project synthetic",
    intent: "Prove project parity",
    kind: "translation",
    initialMessage: "Translate the synthetic project.",
    scope: {
      batchId: "batch-1",
      segmentIds: ["segment-1"],
      sourceLocale: "en",
      targetLocale: "zh-CN",
    },
  });
  const standalone = await workspace.create({
    owner: { kind: "standalone" },
    taskId: "standalone-task",
    title: "Standalone synthetic",
    intent: "Prove standalone parity",
    kind: "general",
    initialMessage: "Inspect the synthetic workspace.",
    scope: { fileGrantIds: ["grant-1"] },
  });
  await workspace.create({
    owner: { kind: "standalone" },
    taskId: "empty-task",
    title: "Empty synthetic",
    intent: "Prove revision zero import",
    kind: "general",
  });
  await workspace.create({
    owner: { kind: "standalone" },
    taskId: "source-race-task",
    title: "Source race synthetic",
    intent: "Prove backup source immutability",
    kind: "general",
    initialMessage: "Detect a source change after backup.",
  });
  await workspace.create({
    owner: { kind: "standalone" },
    taskId: "authority-loss-task",
    title: "Authority loss synthetic",
    intent: "Prove authority is held through commit",
    kind: "general",
    initialMessage: "Refuse a commit after authority loss.",
  });

  const store = new SqliteEventProjectionStore(join(root, "imports.sqlite"));
  const projectReport = await importLegacyTaskWorkspace({
    store,
    authority,
    sourceDirectory: taskWorkspaceDirectory(legacyRoot, {
      kind: "project",
      projectId: "project-1",
      taskId: "project-task",
    }),
    locator: { kind: "project", projectId: "project-1", taskId: "project-task" },
    backupDirectory: join(root, "backups", "project-task"),
  });
  assert.equal(projectReport.sourceDigest.length, 64);
  assert.equal(projectReport.taskId, project.task.id);
  assert.equal(projectReport.eventCount > 0, true);
  assert.equal(projectReport.lastSequence, projectReport.eventCount);
  assert.equal(projectReport.nextCursor, project.eventCursor);
  assert.equal(projectReport.projectionParity, true);
  assert.equal(projectReport.tornTrailingRecordIgnored, false);
  assert.equal(store.currentRevision(projectReport.streamId), projectReport.eventCount);
  const projectBackupManifest = JSON.parse(
    await readFile(join(root, "backups", "project-task", "manifest-v1.json"), "utf8"),
  ) as { sourceDigest: string; files: Array<{ relativePath: string; sha256: string }> };
  assert.equal(projectBackupManifest.sourceDigest, projectReport.sourceDigest);
  assert.deepEqual(projectBackupManifest.files.map(({ relativePath }) => relativePath), [
    "snapshot.json",
    "events.jsonl",
  ]);
  const legacyProjectEvents = (await workspace.eventsAfter({
    projectId: "project-1",
    taskId: "project-task",
  })).events;
  assert.deepEqual(
    store.readEvents(projectReport.streamId).map(({ sequence, payload }) => ({
      sequence,
      legacyEvent: payload.legacyEvent,
    })),
    legacyProjectEvents.map((legacyEvent, index) => ({
      sequence: index + 1,
      legacyEvent: JSON.parse(JSON.stringify(legacyEvent)),
    })),
  );
  assert.deepEqual(store.readProjection(projectReport.streamId)?.value, projectReport.projection);

  const repeated = await importLegacyTaskWorkspace({
    store,
    authority,
    sourceDirectory: taskWorkspaceDirectory(legacyRoot, {
      kind: "project",
      projectId: "project-1",
      taskId: "project-task",
    }),
    locator: { kind: "project", projectId: "project-1", taskId: "project-task" },
    backupDirectory: join(root, "backups", "project-task-repeat"),
  });
  assert.equal(repeated.commandId, projectReport.commandId);
  assert.equal(store.readEvents(projectReport.streamId).length, projectReport.eventCount);

  const standaloneReport = await importLegacyTaskWorkspace({
    store,
    authority,
    sourceDirectory: taskWorkspaceDirectory(legacyRoot, {
      kind: "standalone",
      taskId: "standalone-task",
    }),
    locator: { kind: "standalone", taskId: "standalone-task" },
    backupDirectory: join(root, "backups", "standalone-task"),
  });
  assert.equal(standaloneReport.taskId, standalone.task.id);
  assert.equal(standaloneReport.projection.task.owner.kind, "standalone");
  assert.equal(standaloneReport.projectionParity, true);
  const emptyReport = await importLegacyTaskWorkspace({
    store,
    authority,
    sourceDirectory: taskWorkspaceDirectory(legacyRoot, {
      kind: "standalone",
      taskId: "empty-task",
    }),
    locator: { kind: "standalone", taskId: "empty-task" },
    backupDirectory: join(root, "backups", "empty-task"),
  });
  assert.equal(emptyReport.eventCount, 0);
  assert.equal(store.currentRevision(emptyReport.streamId), 0);
  assert.equal(store.readProjection(emptyReport.streamId)?.value.task.id, "empty-task");
  store.close();

  const reopened = new SqliteEventProjectionStore(join(root, "imports.sqlite"));
  assert.equal(reopened.currentRevision(projectReport.streamId), projectReport.eventCount);
  assert.equal(reopened.readProjection(standaloneReport.streamId)?.value.task.id, "standalone-task");
  reopened.close();

  const tornDirectory = taskWorkspaceDirectory(legacyRoot, {
    kind: "standalone",
    taskId: "standalone-task",
  });
  const eventPath = join(tornDirectory, "events.jsonl");
  const validEvents = await readFile(eventPath, "utf8");
  await writeFile(eventPath, `${validEvents}{"recordType":"task_run_event_page_v1"`, "utf8");
  const tornStore = new SqliteEventProjectionStore(join(root, "torn.sqlite"));
  const tornReport = await importLegacyTaskWorkspace({
    store: tornStore,
    authority,
    sourceDirectory: tornDirectory,
    locator: { kind: "standalone", taskId: "standalone-task" },
    backupDirectory: join(root, "backups", "torn"),
  });
  assert.equal(tornReport.tornTrailingRecordIgnored, true);
  assert.equal(tornReport.eventCount, standaloneReport.eventCount);
  tornStore.close();

  const sourceRaceDirectory = taskWorkspaceDirectory(legacyRoot, {
    kind: "standalone",
    taskId: "source-race-task",
  });
  const sourceRaceStore = new SqliteEventProjectionStore(join(root, "source-race.sqlite"));
  let sourceRaceAuthorityChecks = 0;
  await assert.rejects(
    importLegacyTaskWorkspace({
      store: sourceRaceStore,
      authority: {
        assertOwned: async () => {
          sourceRaceAuthorityChecks += 1;
          if (sourceRaceAuthorityChecks === 2) {
            const snapshotPath = join(sourceRaceDirectory, "snapshot.json");
            await writeFile(snapshotPath, `${await readFile(snapshotPath, "utf8")}\n`, "utf8");
          }
        },
      },
      sourceDirectory: sourceRaceDirectory,
      locator: { kind: "standalone", taskId: "source-race-task" },
      backupDirectory: join(root, "backups", "source-race"),
    }),
    /legacy Task source changed after backup/,
  );
  assert.equal(sourceRaceAuthorityChecks, 2);
  assert.equal(
    sourceRaceStore.currentRevision(legacyTaskStreamId({
      kind: "standalone",
      taskId: "source-race-task",
    })),
    0,
  );
  assert.equal(
    JSON.parse(await readFile(join(root, "backups", "source-race", "manifest-v1.json"), "utf8")).schemaVersion,
    1,
  );
  sourceRaceStore.close();

  const authorityLossDirectory = taskWorkspaceDirectory(legacyRoot, {
    kind: "standalone",
    taskId: "authority-loss-task",
  });
  const authorityLossStore = new SqliteEventProjectionStore(join(root, "authority-loss.sqlite"));
  let authorityLossChecks = 0;
  await assert.rejects(
    importLegacyTaskWorkspace({
      store: authorityLossStore,
      authority: {
        assertOwned: async () => {
          authorityLossChecks += 1;
          if (authorityLossChecks === 3) throw new Error("synthetic storage authority lost");
        },
      },
      sourceDirectory: authorityLossDirectory,
      locator: { kind: "standalone", taskId: "authority-loss-task" },
      backupDirectory: join(root, "backups", "authority-loss"),
    }),
    /synthetic storage authority lost/,
  );
  assert.equal(authorityLossChecks, 3);
  assert.equal(
    authorityLossStore.currentRevision(legacyTaskStreamId({
      kind: "standalone",
      taskId: "authority-loss-task",
    })),
    0,
  );
  authorityLossStore.close();

  const corruptDirectory = taskWorkspaceDirectory(legacyRoot, {
    kind: "project",
    projectId: "project-1",
    taskId: "project-task",
  });
  const validProjectEvents = await readFile(join(corruptDirectory, "events.jsonl"), "utf8");
  await writeFile(
    join(corruptDirectory, "events.jsonl"),
    `${validProjectEvents.trimEnd()}\n{"broken":\n${validProjectEvents}`,
    "utf8",
  );
  const corruptStore = new SqliteEventProjectionStore(join(root, "corrupt.sqlite"));
  await assert.rejects(
    importLegacyTaskWorkspace({
      store: corruptStore,
      authority,
      sourceDirectory: corruptDirectory,
      locator: { kind: "project", projectId: "project-1", taskId: "project-task" },
      backupDirectory: join(root, "backups", "corrupt"),
    }),
    /Invalid legacy Task JSONL at line 2/,
  );
  assert.equal(
    JSON.parse(await readFile(join(root, "backups", "corrupt", "manifest-v1.json"), "utf8")).schemaVersion,
    1,
    "source backup must be durable before corrupt input is classified",
  );
  assert.equal(corruptStore.currentRevision(legacyTaskStreamId({
    kind: "project",
    projectId: "project-1",
    taskId: "project-task",
  })), 0);
  corruptStore.close();
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("SQLite legacy Task importer tests passed");
