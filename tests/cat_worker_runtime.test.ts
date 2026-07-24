import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SupervisorCatWorkerSessionAuthority,
  finalizeCatWorkerSessionPlan,
  type CatWorkerSessionPlanV1,
} from "../packages/cat-server/src/cat_worker_runtime.js";
import {
  NodeJsonlRunWorkerProcessAdapter,
  RunWorkerSupervisor,
} from "../packages/cat-server/src/run_worker_supervisor.js";

const root = await mkdtemp(join(tmpdir(), "la-cat-worker-runtime-"));
const workspaceRoot = join(root, "projects", "synthetic");
await mkdir(workspaceRoot, { recursive: true });
const entryPath = join(process.cwd(), "packages", "cat-server", "src", "cat_run_worker_entry.ts");
const supervisor = new RunWorkerSupervisor(new NodeJsonlRunWorkerProcessAdapter({
  entryPath,
  cwd: process.cwd(),
  env: process.env,
  nodeArgs: ["--import", "tsx"],
}), { readyTimeoutMs: 20_000, heartbeatTimeoutMs: 5_000, cancelGraceMs: 2_000 });
const authority = new SupervisorCatWorkerSessionAuthority(supervisor, 20_000);

const plan: CatWorkerSessionPlanV1 = finalizeCatWorkerSessionPlan({
  schemaVersion: 1,
  profile: "private_eval",
  runtimeRoot: root,
  workspace: { root: workspaceRoot, projectId: "synthetic" },
  taskId: "task-eval",
  runId: "run-eval",
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  sessionMode: "memory",
  sessionId: null,
  branchEntryId: null,
  preset: "eval",
  disabledTools: [],
  runOptions: null,
  isolatedResources: {},
  runtimeExtension: false,
  permissionContract: null,
  serverTools: [],
  extensionBinding: false,
});

await assert.rejects(
  authority.createSession({
    plan: { ...plan, runId: "tampered-after-hash" },
    executionIdentity: {
      executionId: "tampered.execution.1",
      threadId: "tampered.main",
      turnId: "tampered",
      runtimeEpochId: "tampered.epoch.1",
      configRevision: 1,
      executionProfile: null,
      createdAt: new Date().toISOString(),
    },
    persistExecutionSnapshot: async () => undefined,
    requestPermissionDecision: async () => ({ action: "deny", reason: "not used" }),
    executeServerTool: async () => { throw new Error("not used"); },
    requestUi: async () => { throw new Error("not used"); },
    notifyUi: () => undefined,
  }),
  /digest mismatch/u,
);

const created = await authority.createSession({
  plan,
  executionIdentity: {
    executionId: "run-eval.execution.1",
    threadId: "run-eval.main",
    turnId: "run-eval",
    runtimeEpochId: "run-eval.epoch.1",
    configRevision: 1,
    executionProfile: null,
    createdAt: new Date().toISOString(),
  },
  persistExecutionSnapshot: async () => undefined,
  requestPermissionDecision: async () => ({ action: "deny", reason: "not used" }),
  executeServerTool: async () => { throw new Error("not used"); },
  requestUi: async () => { throw new Error("not used"); },
  notifyUi: () => undefined,
});

assert.equal(created.requestShape.activeToolCount, 0);
assert.equal(created.executionSnapshot.runId, "run-eval");
assert.equal(created.workerId.startsWith("private_eval-"), true);
assert.equal(created.runtimeEpochId, "run-eval.epoch.1");
const events: unknown[] = [];
const unsubscribe = created.session.subscribe((event) => events.push(event));
await created.session.abort();
unsubscribe();
await created.dispose();
assert.equal((await created.terminal).kind, "stopped");
assert.deepEqual(events, []);

let seed = 0x5eed072;
const random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x1_0000_0000;
};
const randomizedProjectIds = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]
  .map((projectId) => ({ projectId, order: random() }))
  .sort((left, right) => left.order - right.order)
  .map(({ projectId }) => projectId);
const catCreations = await Promise.all(randomizedProjectIds.map(async (projectId) => {
  const projectRoot = join(root, "projects", projectId);
  await mkdir(projectRoot, { recursive: true });
  const runId = `run-${projectId}`;
  return authority.createSession({
    plan: finalizeCatWorkerSessionPlan({
      schemaVersion: 1,
      profile: "cat",
      runtimeRoot: root,
      workspace: { root: projectRoot, projectId },
      taskId: `task-${projectId}`,
      runId,
      modelProvider: null,
      modelId: null,
      thinkingLevel: null,
      sessionMode: "memory",
      sessionId: null,
      branchEntryId: null,
      preset: "cat",
      disabledTools: [],
      runOptions: null,
      isolatedResources: {},
      runtimeExtension: true,
      permissionContract: null,
      serverTools: [],
      extensionBinding: false,
    }),
    executionIdentity: {
      executionId: `${runId}.execution.1`,
      threadId: `${runId}.main`,
      turnId: runId,
      runtimeEpochId: `${runId}.epoch.1`,
      configRevision: 1,
      executionProfile: null,
      createdAt: new Date().toISOString(),
    },
    persistExecutionSnapshot: async () => undefined,
    requestPermissionDecision: async () => ({ action: "deny", reason: "not used" }),
    executeServerTool: async () => { throw new Error("not used"); },
    requestUi: async () => { throw new Error("not used"); },
    notifyUi: () => undefined,
  });
}));
assert.equal(new Set(catCreations.map((creation) => creation.workerId)).size, randomizedProjectIds.length);
assert.equal(catCreations.every((creation) => creation.requestShape.activeToolNames.includes("proposal_apply")), true);
assert.deepEqual(
  catCreations.map((creation) => creation.executionSnapshot.runId),
  randomizedProjectIds.map((projectId) => `run-${projectId}`),
  "concurrent randomized cross-root workers must retain their exact Run identity",
);
assert.deepEqual(
  catCreations.map((creation) => creation.runtimeEpochId),
  randomizedProjectIds.map((projectId) => `run-${projectId}.epoch.1`),
  "concurrent randomized cross-root workers must retain their exact runtime epoch",
);
await Promise.all(catCreations.map((creation) => creation.dispose()));
assert.deepEqual(
  await Promise.all(catCreations.map((creation) => creation.terminal)),
  randomizedProjectIds.map(() => ({ kind: "stopped" })),
);

const teamCreation = await authority.createSession({
  plan: finalizeCatWorkerSessionPlan({
    schemaVersion: 1,
    profile: "team",
    runtimeRoot: root,
    workspace: { root: workspaceRoot, projectId: "synthetic" },
    taskId: "task-team",
    runId: "run-team",
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    sessionMode: "memory",
    sessionId: null,
    branchEntryId: null,
    preset: "scratch",
    disabledTools: [],
    runOptions: null,
    isolatedResources: {},
    runtimeExtension: true,
    permissionContract: null,
    serverTools: [],
    extensionBinding: false,
  }),
  executionIdentity: {
    executionId: "run-team.execution.1",
    threadId: "run-team.main",
    turnId: "run-team.producer",
    runtimeEpochId: "run-team.epoch.1",
    configRevision: 1,
    executionProfile: null,
    createdAt: new Date().toISOString(),
  },
  persistExecutionSnapshot: async () => undefined,
  requestPermissionDecision: async () => ({ action: "deny", reason: "Team child is read-only" }),
  executeServerTool: async () => { throw new Error("Team supervisor has no Host server tools"); },
  requestUi: async () => { throw new Error("not used"); },
  notifyUi: () => undefined,
});
assert.equal(teamCreation.workerId.startsWith("team-"), true);
assert.deepEqual(teamCreation.requestShape.activeToolNames, []);
await teamCreation.dispose();
assert.deepEqual(await teamCreation.terminal, { kind: "stopped" });

console.log("cat worker runtime tests passed");
