import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary } from "../src/renderer/data/workspace-client.ts";
import {
  parseRememberedWorkspaceScope,
  resolveRememberedWorkspaceScope,
  serializeRememberedWorkspaceScope,
} from "../src/renderer/workspace/workspace-scope-memory.ts";
import { restoreRememberedWorkspaceScope } from "../src/renderer/workspace/useWorkspaceScopeMemory.ts";

const project: ProjectSummary = {
  projectId: "project-one",
  name: "Project One",
  root: "/explicit/project",
  updatedAt: "2026-07-16T00:00:00.000Z",
  assetCount: 2,
  batches: [{
    schemaVersion: 1,
    projectId: "project-one",
    batchId: "batch-one",
    format: "xliff_2_0",
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    segments: 10,
    confirmed: 0,
    draft: 0,
    new: 10,
    locked: 0,
    updatedAt: "2026-07-16T00:00:00.000Z",
  }],
};

test("remembered scope parsing rejects malformed or projectless local state", () => {
  assert.equal(parseRememberedWorkspaceScope(null), null);
  assert.equal(parseRememberedWorkspaceScope("not json"), null);
  assert.equal(parseRememberedWorkspaceScope('{"batchId":"batch-one"}'), null);
  assert.deepEqual(parseRememberedWorkspaceScope('{"projectId":" project-one ","batchId":" batch-one ","taskId":" task-one "}'), {
    projectId: "project-one",
    batchId: "batch-one",
    taskId: "task-one",
  });
});

test("remembered scope serialization stores only product IDs", () => {
  assert.equal(serializeRememberedWorkspaceScope({ projectId: "", batchId: null, taskId: null }), null);
  assert.equal(
    serializeRememberedWorkspaceScope({ projectId: "project-one", batchId: "batch-one", taskId: "task-one" }),
    '{"projectId":"project-one","batchId":"batch-one","taskId":"task-one"}',
  );
});

test("scope restoration accepts canonical Task scope and ignores stale remembered Batch", () => {
  assert.deepEqual(resolveRememberedWorkspaceScope(
    { projectId: "project-one", batchId: "removed-batch", taskId: "task-one" },
    [project],
    [{ id: "task-one", projectId: "project-one", batchId: "batch-one" }],
  ), { projectId: "project-one", batchId: "batch-one", taskId: "task-one" });
});

test("missing children fall back to the nearest valid parent without fabricating state", () => {
  assert.deepEqual(resolveRememberedWorkspaceScope(
    { projectId: "project-one", batchId: "batch-one", taskId: "removed-task" },
    [project],
    [],
  ), { projectId: "project-one", batchId: "batch-one", taskId: null });
  assert.deepEqual(resolveRememberedWorkspaceScope(
    { projectId: "project-one", batchId: "removed-batch", taskId: "removed-task" },
    [project],
    [],
  ), { projectId: "project-one", batchId: null, taskId: null });
  assert.equal(resolveRememberedWorkspaceScope(
    { projectId: "removed-project", batchId: "batch-one", taskId: "task-one" },
    [project],
    [],
  ), null);
});

test("a Task whose canonical Batch disappeared is not restored", () => {
  assert.deepEqual(resolveRememberedWorkspaceScope(
    { projectId: "project-one", taskId: "task-one" },
    [project],
    [{ id: "task-one", projectId: "project-one", batchId: "removed-batch" }],
  ), { projectId: "project-one", batchId: null, taskId: null });
});

test("restoration loads the Project catalog before opening its canonical Task", async () => {
  const calls: string[] = [];
  const state = {
    projectId: null as string | null,
    batchId: null as string | null,
    taskId: null as string | null,
    tasks: [] as Array<{
      id: string;
      owner: { kind: "project"; projectId: string };
      scope: { kind: "project"; batchId?: string; segmentIds: string[] };
      title: string;
      intent: string;
      kind: "general";
      status: "draft";
      createdAt: string;
      updatedAt: string;
    }>,
  };
  await restoreRememberedWorkspaceScope({
    getState: () => state,
    selectProject: async (projectId) => {
      calls.push(`project:${projectId}`);
      state.projectId = projectId;
      state.tasks = [{
        id: "task-one",
        owner: { kind: "project", projectId },
        scope: { kind: "project", batchId: "batch-one", segmentIds: [] },
        title: "Task one",
        intent: "Restore scope",
        kind: "general",
        status: "draft",
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      }];
    },
    openBatch: async (projectId, batchId) => { calls.push(`batch:${projectId}:${batchId}`); },
    openTask: async (projectId, taskId) => { calls.push(`task:${projectId}:${taskId}`); },
  }, [project], { projectId: "project-one", batchId: "batch-one", taskId: "task-one" });
  assert.deepEqual(calls, ["project:project-one", "task:project-one:task-one"]);
});

test("restoration falls back to a valid Batch when the remembered Task is gone", async () => {
  const calls: string[] = [];
  const state = { projectId: null as string | null, batchId: null as string | null, taskId: null as string | null, tasks: [] };
  await restoreRememberedWorkspaceScope({
    getState: () => state,
    selectProject: async (projectId) => { calls.push(`project:${projectId}`); state.projectId = projectId; },
    openBatch: async (projectId, batchId) => { calls.push(`batch:${projectId}:${batchId}`); },
    openTask: async (projectId, taskId) => { calls.push(`task:${projectId}:${taskId}`); },
  }, [project], { projectId: "project-one", batchId: "batch-one", taskId: "removed-task" });
  assert.deepEqual(calls, ["project:project-one", "batch:project-one:batch-one"]);
});

test("an explicit user scope is never replaced by remembered convenience state", async () => {
  const calls: string[] = [];
  const state = { projectId: "manual-project", batchId: null, taskId: null, tasks: [] };
  await restoreRememberedWorkspaceScope({
    getState: () => state,
    selectProject: async (projectId) => { calls.push(`project:${projectId}`); },
    openBatch: async (projectId, batchId) => { calls.push(`batch:${projectId}:${batchId}`); },
    openTask: async (projectId, taskId) => { calls.push(`task:${projectId}:${taskId}`); },
  }, [project], { projectId: "project-one", batchId: "batch-one", taskId: "task-one" });
  assert.deepEqual(calls, []);
});

test("a user selection racing project restoration wins before a remembered child opens", async () => {
  const calls: string[] = [];
  const state = { projectId: null as string | null, batchId: null as string | null, taskId: null as string | null, tasks: [] };
  await restoreRememberedWorkspaceScope({
    getState: () => state,
    selectProject: async (projectId) => {
      calls.push(`project:${projectId}`);
      state.projectId = "manual-project";
    },
    openBatch: async (projectId, batchId) => { calls.push(`batch:${projectId}:${batchId}`); },
    openTask: async (projectId, taskId) => { calls.push(`task:${projectId}:${taskId}`); },
  }, [project], { projectId: "project-one", batchId: "batch-one", taskId: "task-one" });
  assert.deepEqual(calls, ["project:project-one"]);
});
