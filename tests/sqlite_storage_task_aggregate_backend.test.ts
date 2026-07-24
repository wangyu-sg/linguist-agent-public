import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskQueuedMessage,
  emptyTaskMessageQueue,
  installTaskAggregateStorageBackend,
  parseTaskMessageQueue,
  readTaskMessageQueue,
  type TaskMessageQueue,
} from "../packages/cat-data/src/index.js";
import {
  installTaskPackageProfilePersistence,
  readTaskPackageProfile,
  taskPackageProfileHash,
} from "../packages/cat-server/src/task_package_profile.js";
import {
  createSqliteTaskAggregateBackend,
  legacyTaskSideStreamIds,
  SqliteEventProjectionStore,
  SQLITE_TASK_AGGREGATE_BACKEND_READINESS,
  type SqliteJsonObject,
} from "../packages/storage-sqlite/src/index.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-task-aggregate-backend-"));

function jsonObject(value: unknown): SqliteJsonObject {
  return JSON.parse(JSON.stringify(value)) as SqliteJsonObject;
}

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
  const databasePath = join(root, "task-aggregate.sqlite");
  const locator = {
    kind: "project",
    projectId: "project-1",
    taskId: "task-1",
  } as const;
  const streamIds = legacyTaskSideStreamIds(locator);
  const queue = parseTaskMessageQueue({
    ...emptyTaskMessageQueue(locator.taskId, "2026-07-23T18:00:00.000Z"),
    messages: [
      createTaskQueuedMessage({
        taskId: locator.taskId,
        runId: "run-1",
        id: "message-2",
        text: "Second",
        now: "2026-07-23T18:00:02.000Z",
      }),
      createTaskQueuedMessage({
        taskId: locator.taskId,
        runId: "run-1",
        id: "message-1",
        text: "First",
        now: "2026-07-23T18:00:01.000Z",
      }),
    ],
  }, locator.taskId);
  const profile = {
    schemaVersion: 1 as const,
    taskId: locator.taskId,
    revision: 4,
    selections: [],
    executableApprovals: [],
    updatedAt: "2026-07-23T18:00:03.000Z",
  };
  const store = new SqliteEventProjectionStore(databasePath);
  store.initializeProjection({
    commandId: "fixture-message-queue",
    streamId: streamIds.messageQueue,
    projection: jsonObject(queue),
  });
  store.initializeProjection({
    commandId: "fixture-resource-profile",
    streamId: streamIds.resourceProfile,
    projection: profile,
  });

  assert.deepEqual(SQLITE_TASK_AGGREGATE_BACKEND_READINESS, {
    schemaVersion: 1,
    authority: "unconnected",
    productionCutoverOwner: "LA-089",
    excludes: ["project-quality-ledger"],
  });
  const backend = createSqliteTaskAggregateBackend({
    root,
    store,
    authority: { assertOwned: async () => undefined },
  });
  installTaskAggregateStorageBackend(backend);
  installTaskPackageProfilePersistence({
    root,
    persistence: backend.taskPackageProfile,
  });
  assert.deepEqual(await readTaskMessageQueue(root, locator), queue);
  const installedProfile = await readTaskPackageProfile({
    repoRoot: root,
    projectId: locator.projectId,
    taskId: locator.taskId,
  });
  assert.equal(installedProfile.revision, profile.revision);
  assert.equal(
    taskPackageProfileHash(installedProfile),
    taskPackageProfileHash(profile),
  );
  assert.deepEqual(await backend.messageQueue.read(locator), queue);
  assert.deepEqual(await backend.taskPackageProfile.read({
    repoRoot: root,
    projectId: locator.projectId,
    taskId: locator.taskId,
  }), profile);

  const third = createTaskQueuedMessage({
    taskId: locator.taskId,
    runId: "run-1",
    id: "message-3",
    text: "Third",
    now: "2026-07-23T18:00:04.000Z",
  });
  const updatedQueue = await backend.messageQueue.update(locator, (current): TaskMessageQueue => ({
    ...current,
    messages: [...current.messages, third],
    updatedAt: "2026-07-23T18:00:05.000Z",
  }));
  assert.deepEqual(updatedQueue.messages.map(({ id }) => id), [
    "message-2",
    "message-1",
    "message-3",
  ]);
  const nextProfile = {
    ...profile,
    revision: 5,
    updatedAt: "2026-07-23T18:00:06.000Z",
  };
  await backend.taskPackageProfile.write({
    repoRoot: root,
    projectId: locator.projectId,
    taskId: locator.taskId,
  }, profile, nextProfile);
  store.close();

  const reopenedStore = new SqliteEventProjectionStore(databasePath);
  const reopened = createSqliteTaskAggregateBackend({
    root,
    store: reopenedStore,
    authority: { assertOwned: async () => undefined },
  });
  assert.deepEqual(
    (await reopened.messageQueue.read(locator)).messages.map(({ id }) => id),
    ["message-2", "message-1", "message-3"],
  );
  assert.deepEqual(await reopened.taskPackageProfile.read({
    repoRoot: root,
    projectId: locator.projectId,
    taskId: locator.taskId,
  }), nextProfile);
  reopenedStore.close();

  const casStore = new SqliteEventProjectionStore(join(root, "cas.sqlite"));
  casStore.initializeProjection({
    commandId: "cas-message-queue",
    streamId: streamIds.messageQueue,
    projection: jsonObject(queue),
  });
  casStore.initializeProjection({
    commandId: "cas-resource-profile",
    streamId: streamIds.resourceProfile,
    projection: profile,
  });
  const casBackend = createSqliteTaskAggregateBackend({
    root,
    store: casStore,
    authority: { assertOwned: async () => undefined },
  });
  let queueMutationsReady = 0;
  let releaseQueueMutations!: () => void;
  const queueMutationBarrier = new Promise<void>((resolve) => {
    releaseQueueMutations = resolve;
  });
  const queueContenders = await Promise.allSettled([
    casBackend.messageQueue.update(locator, async (current) => {
      queueMutationsReady += 1;
      if (queueMutationsReady === 2) releaseQueueMutations();
      await queueMutationBarrier;
      return {
        ...current,
        messages: [...current.messages, third],
        updatedAt: "2026-07-23T18:01:00.000Z",
      };
    }),
    casBackend.messageQueue.update(locator, async (current) => {
      queueMutationsReady += 1;
      if (queueMutationsReady === 2) releaseQueueMutations();
      await queueMutationBarrier;
      return {
        ...current,
        messages: current.messages.slice(1),
        updatedAt: "2026-07-23T18:01:01.000Z",
      };
    }),
  ]);
  assert.equal(queueContenders.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(queueContenders.filter(({ status }) => status === "rejected").length, 1);

  const profileContenders = await Promise.allSettled([
    casBackend.taskPackageProfile.write(
      { repoRoot: root, projectId: locator.projectId, taskId: locator.taskId },
      profile,
      { ...profile, revision: 5, updatedAt: "2026-07-23T18:01:02.000Z" },
    ),
    casBackend.taskPackageProfile.write(
      { repoRoot: root, projectId: locator.projectId, taskId: locator.taskId },
      profile,
      { ...profile, revision: 5, updatedAt: "2026-07-23T18:01:03.000Z" },
    ),
  ]);
  assert.equal(profileContenders.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(profileContenders.filter(({ status }) => status === "rejected").length, 1);
  casStore.close();

  const emptyStore = new SqliteEventProjectionStore(join(root, "empty.sqlite"));
  const emptyLocator = {
    kind: "project",
    projectId: "project-2",
    taskId: "task-2",
  } as const;
  const emptyBackend = createSqliteTaskAggregateBackend({
    root,
    store: emptyStore,
    authority: { assertOwned: async () => undefined },
  });
  const firstMessage = createTaskQueuedMessage({
    taskId: emptyLocator.taskId,
    runId: "run-2",
    id: "message-first",
    text: "Initialize the missing queue.",
    now: "2026-07-23T18:02:00.000Z",
  });
  await emptyBackend.messageQueue.update(emptyLocator, (current) => ({
    ...current,
    messages: [firstMessage],
    updatedAt: "2026-07-23T18:02:01.000Z",
  }));
  assert.deepEqual((await emptyBackend.messageQueue.read(emptyLocator)).messages, [firstMessage]);
  const firstProfile = {
    schemaVersion: 1,
    taskId: emptyLocator.taskId,
    revision: 1,
    selections: [],
    executableApprovals: [],
    updatedAt: "2026-07-23T18:02:02.000Z",
  };
  await emptyBackend.taskPackageProfile.write(
    { repoRoot: root, projectId: emptyLocator.projectId, taskId: emptyLocator.taskId },
    {
      schemaVersion: 1,
      taskId: emptyLocator.taskId,
      revision: 0,
      selections: [],
      executableApprovals: [],
      updatedAt: new Date(0).toISOString(),
    },
    firstProfile,
  );
  assert.deepEqual(await emptyBackend.taskPackageProfile.read({
    repoRoot: root,
    projectId: emptyLocator.projectId,
    taskId: emptyLocator.taskId,
  }), firstProfile);
  emptyStore.close();

  const authorityStore = new SqliteEventProjectionStore(join(root, "authority.sqlite"));
  authorityStore.initializeProjection({
    commandId: "authority-message-queue",
    streamId: streamIds.messageQueue,
    projection: jsonObject(queue),
  });
  let authorityChecks = 0;
  const authorityBackend = createSqliteTaskAggregateBackend({
    root,
    store: authorityStore,
    authority: {
      assertOwned: async () => {
        authorityChecks += 1;
        if (authorityChecks > 1) throw new Error("storage authority was lost");
      },
    },
  });
  await assert.rejects(
    authorityBackend.messageQueue.update(locator, (current) => ({
      ...current,
      messages: [...current.messages, third],
      updatedAt: "2026-07-23T18:03:00.000Z",
    })),
    /authority was lost/,
  );
  assert.deepEqual(
    authorityStore.readProjection(streamIds.messageQueue)?.value,
    jsonObject(queue),
  );
  authorityStore.initializeProjection({
    commandId: "authority-resource-profile",
    streamId: streamIds.resourceProfile,
    projection: profile,
  });
  authorityChecks = 0;
  await assert.rejects(
    authorityBackend.taskPackageProfile.write(
      { repoRoot: root, projectId: locator.projectId, taskId: locator.taskId },
      profile,
      { ...profile, revision: 5, updatedAt: "2026-07-23T18:03:01.000Z" },
    ),
    /authority was lost/,
  );
  assert.deepEqual(
    authorityStore.readProjection(streamIds.resourceProfile)?.value,
    profile,
  );
  authorityStore.close();

  const invalidStore = new SqliteEventProjectionStore(join(root, "invalid.sqlite"));
  invalidStore.initializeProjection({
    commandId: "invalid-message-queue",
    streamId: streamIds.messageQueue,
    projection: {
      ...jsonObject(queue),
      inventedAuthority: true,
    },
  });
  invalidStore.initializeProjection({
    commandId: "invalid-resource-profile",
    streamId: streamIds.resourceProfile,
    projection: {
      ...profile,
      inventedAuthority: true,
    },
  });
  const invalidBackend = createSqliteTaskAggregateBackend({
    root,
    store: invalidStore,
    authority: { assertOwned: async () => undefined },
  });
  await assert.rejects(
    invalidBackend.messageQueue.read(locator),
    /unknown inventedAuthority/,
  );
  await assert.rejects(
    invalidBackend.taskPackageProfile.read({
      repoRoot: root,
      projectId: locator.projectId,
      taskId: locator.taskId,
    }),
    /unknown inventedAuthority/,
  );
  invalidStore.close();

  const productionRoots = [
    join(process.cwd(), "packages", "cat-server"),
    join(process.cwd(), "packages", "cat-runtime"),
    join(process.cwd(), "packages", "cat-data"),
    join(process.cwd(), "apps", "desktop"),
  ];
  for (const productionRoot of productionRoots) {
    for (const path of await sourceFiles(productionRoot)) {
      if (path.endsWith("/packages/cat-server/src/task_aggregate_sqlite_cutover.ts")) continue;
      assert.doesNotMatch(
        await readFile(path, "utf8"),
        /createSqliteTaskAggregateBackend/u,
        `${path} must not bypass the LA-089 Task aggregate cutover owner`,
      );
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("sqlite_storage_task_aggregate_backend.test.ts passed");
