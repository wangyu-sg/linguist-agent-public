import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileTaskMessageQueuePersistence,
  createFileTaskWorkspacePersistence,
  createTaskQueuedMessage,
  createTaskWorkspace,
  installTaskAggregateStorageBackend,
  readTaskMessageQueue,
  taskWorkspaceDirectory,
  updateTaskMessageQueue,
} from "../packages/cat-data/src/index.js";
import {
  createFileTaskPackageProfilePersistence,
  installTaskPackageProfilePersistence,
  readTaskPackageProfile,
} from "../packages/cat-server/src/task_package_profile.js";

const root = await mkdtemp(join(tmpdir(), "la-task-storage-dispatch-"));

try {
  const canonicalRoot = join(root, "canonical-root");
  const backendRoot = join(root, "backend-root");
  const otherRoot = join(root, "other-root");
  const locator = { kind: "project", projectId: "project-1", taskId: "task-1" } as const;

  installTaskAggregateStorageBackend({
    root: canonicalRoot,
    workspace: createFileTaskWorkspacePersistence(backendRoot),
    messageQueue: createFileTaskMessageQueuePersistence(backendRoot),
  });
  installTaskPackageProfilePersistence({
    root: canonicalRoot,
    persistence: createFileTaskPackageProfilePersistence(backendRoot),
  });

  await createTaskWorkspace(canonicalRoot, {
    now: () => "2026-07-23T14:00:00.000Z",
  }).create({
    projectId: locator.projectId,
    taskId: locator.taskId,
    title: "Dispatched Task",
    intent: "Prove the install-once storage seam.",
    kind: "general",
  });
  assert.equal(
    JSON.parse(await readFile(join(taskWorkspaceDirectory(backendRoot, locator), "snapshot.json"), "utf8")).task.id,
    locator.taskId,
  );
  await assert.rejects(
    readFile(join(taskWorkspaceDirectory(canonicalRoot, locator), "snapshot.json"), "utf8"),
    /ENOENT/,
  );

  const message = createTaskQueuedMessage({
    taskId: locator.taskId,
    runId: "run-1",
    id: "message-1",
    text: "Queued through the canonical backend.",
    now: "2026-07-23T14:00:01.000Z",
  });
  await updateTaskMessageQueue(canonicalRoot, locator, (queue) => ({
    ...queue,
    messages: [message],
    updatedAt: "2026-07-23T14:00:02.000Z",
  }));
  assert.deepEqual((await readTaskMessageQueue(canonicalRoot, locator)).messages, [message]);
  assert.deepEqual(
    JSON.parse(await readFile(join(taskWorkspaceDirectory(backendRoot, locator), "message_queue.json"), "utf8")).messages,
    [message],
  );

  assert.equal((await readTaskPackageProfile({
    repoRoot: canonicalRoot,
    projectId: locator.projectId,
    taskId: locator.taskId,
  })).taskId, locator.taskId);

  assert.throws(
    () => installTaskAggregateStorageBackend({
      root: canonicalRoot,
      workspace: createFileTaskWorkspacePersistence(backendRoot),
      messageQueue: createFileTaskMessageQueuePersistence(backendRoot),
    }),
    /already installed/,
  );
  assert.throws(
    () => createTaskWorkspace(otherRoot),
    /canonical Task aggregate storage is installed for another root/,
  );
  await assert.rejects(
    readTaskPackageProfile({
      repoRoot: otherRoot,
      projectId: locator.projectId,
      taskId: locator.taskId,
    }),
    /canonical Task Package profile storage is installed for another root/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("task_aggregate_storage_dispatch.test.ts passed");
