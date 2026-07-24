import assert from "node:assert/strict";
import { prepareCatWorkerRuntime } from "../packages/cat-server/src/cat_worker_rpc.js";
import { finalizeCatWorkerSessionPlan } from "../packages/cat-server/src/cat_worker_runtime.js";
import type { RunWorkerApplicationTransport } from "../packages/cat-server/src/run_worker_supervisor.js";

const listeners = new Set<(message: unknown) => void>();
const closeListeners = new Set<(reason: string) => void>();
let serverToolSignal: AbortSignal | undefined;
let serverToolFinished: (() => void) | undefined;
const serverToolDone = new Promise<void>((resolve) => { serverToolFinished = resolve; });

const receive = (message: unknown): void => {
  for (const listener of listeners) listener(message);
};

const transport: RunWorkerApplicationTransport = {
  send(payload) {
    const envelope = payload as Record<string, unknown>;
    if (envelope.type === "request" && envelope.method === "prepare") {
      queueMicrotask(() => receive({
        schemaVersion: 1,
        type: "response",
        requestId: envelope.requestId,
        ok: true,
        result: {
          planHash: plan.planHash,
          sessionId: "session-rpc",
          sessionFile: null,
          systemPrompt: "synthetic",
          requestShape: {
            systemPromptHash: "prompt-hash",
            toolSurfaceHash: "tool-hash",
            resourceIndexHash: "resource-hash",
          },
          tools: [{ name: "read", description: "Read a file", sourceInfo: { source: "builtin" } }],
          state: { isStreaming: false, steering: [], followUp: [] },
        },
      }));
    } else if (envelope.type === "request" && envelope.method === "activate") {
      queueMicrotask(() => receive({
        schemaVersion: 1,
        type: "response",
        requestId: envelope.requestId,
        ok: true,
        result: { activated: true },
      }));
    } else if (envelope.type === "bridge_response") {
      serverToolFinished?.();
    } else if (envelope.type === "request" && envelope.method === "dispose") {
      queueMicrotask(() => receive({
        schemaVersion: 1,
        type: "response",
        requestId: envelope.requestId,
        ok: true,
        result: { disposed: true },
      }));
    }
  },
  onMessage(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  onClose(listener) { closeListeners.add(listener); return () => closeListeners.delete(listener); },
  close(reason) { for (const listener of closeListeners) listener(reason ?? "closed"); },
};

const plan = finalizeCatWorkerSessionPlan({
  schemaVersion: 1,
  profile: "cat",
  runtimeRoot: "/synthetic/runtime",
  workspace: { root: "/synthetic/project", projectId: "synthetic" },
  taskId: "task-rpc",
  runId: "run-rpc",
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
});

const prepared = await prepareCatWorkerRuntime({
  transport,
  plan,
  timeoutMs: 2_000,
  executionIdentity: {
    executionId: "run-rpc.execution.1",
    threadId: "run-rpc.main",
    turnId: "run-rpc",
    runtimeEpochId: "run-rpc.epoch.1",
    configRevision: 1,
    executionProfile: null,
    createdAt: new Date().toISOString(),
  },
  persistExecutionSnapshot: async () => undefined,
  requestPermissionDecision: async () => ({ action: "deny", reason: "not used" }),
  executeServerTool: async (_name, _toolCallId, _input, signal) => {
    serverToolSignal = signal;
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("cancelled by worker");
  },
  requestUi: async () => { throw new Error("not used"); },
  notifyUi: () => undefined,
});
assert.deepEqual(prepared.tools, [{ name: "read", description: "Read a file", sourceInfo: { source: "builtin" } }]);

receive({
  schemaVersion: 1,
  type: "bridge_request",
  requestId: "bridge-tool-1",
  bridge: "server_tool",
  payload: { name: "prepare_team_execution", toolCallId: "tool-call-1", input: { reason: "synthetic" } },
});
receive({ schemaVersion: 1, type: "bridge_cancel", requestId: "bridge-tool-1" });
await serverToolDone;
assert.equal(serverToolSignal?.aborted, true, "worker cancellation must abort the Host-owned tool signal");

await prepared.dispose();

console.log("cat worker RPC tests passed");
