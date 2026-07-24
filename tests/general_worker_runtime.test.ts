import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTaskWorkspace } from "@linguist-agent/cat-data";
import { buildAgentPermissionContract, prepareGeneralAgentSessionPlan } from "@linguist-agent/cat-runtime";
import { SupervisorGeneralWorkerSessionAuthority } from "../packages/cat-server/src/general_worker_runtime.js";
import { NodeJsonlRunWorkerProcessAdapter, RunWorkerSupervisor } from "../packages/cat-server/src/run_worker_supervisor.js";

const root = await mkdtemp(join(tmpdir(), "la-general-worker-runtime-"));
const agentDir = await mkdtemp(join(tmpdir(), "la-general-worker-agent-"));
try {
  await createTaskWorkspace(root).create({
    owner: { kind: "standalone" },
    taskId: "worker-runtime-chat",
    title: "Worker Runtime Chat",
    intent: "Verify the production General worker authority boundary.",
    kind: "general",
  });
  const plan = await prepareGeneralAgentSessionPlan({
    runtimeRoot: root,
    taskId: "worker-runtime-chat",
    runId: "worker-runtime-run",
    rootAgentThreadId: "worker-runtime-run.main",
    agentDir,
    modelProvider: "fixture",
    modelId: "fixture-model",
    permissionContract: buildAgentPermissionContract({ mode: "ask" }),
    delegationEnabled: true,
    managedResources: { extensions: [], skills: [], prompts: [], themes: [] },
  });
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const authority = new SupervisorGeneralWorkerSessionAuthority(new RunWorkerSupervisor(
    new NodeJsonlRunWorkerProcessAdapter({
      entryPath: join(testDirectory, "../packages/cat-server/src/general_run_worker_entry.ts"),
      cwd: join(testDirectory, ".."),
      env: process.env,
      nodeArgs: ["--import", "tsx"],
    }),
    { readyTimeoutMs: 20_000, heartbeatTimeoutMs: 10_000, cancelGraceMs: 2_000 },
  ), 20_000);
  const persisted: string[] = [];
  const created = await authority.createGeneralSession({
    plan,
    executionIdentity: {
      executionId: "worker-runtime-run.execution.1",
      threadId: "worker-runtime-run.main",
      turnId: "worker-runtime-run",
      runtimeEpochId: "worker-runtime-run.epoch.1",
      configRevision: 1,
      executionProfile: null,
      createdAt: "2026-07-23T03:00:00.000Z",
    },
    persistExecutionSnapshot: async (snapshot) => {
      persisted.push(snapshot.executionId);
    },
    requestPermissionDecision: async () => ({ action: "deny" }),
    delegate: async () => ({ agentThreadId: "never", role: "Research Agent", summary: "never" }),
  });
  assert.deepEqual(persisted, ["worker-runtime-run.execution.1"]);
  assert.match(created.workerId, /^general-/u);
  assert.equal(created.runtimeEpochId, "worker-runtime-run.epoch.1");
  assert.equal(created.executionSnapshot.promptHash, created.attestation.systemPromptHash);
  await created.dispose();
  assert.equal((await created.terminal).kind, "stopped");
  process.stdout.write("general worker runtime tests passed\n");
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
}
