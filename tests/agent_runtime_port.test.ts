import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPiAgentRuntimePort,
  buildAgentPermissionContract,
  type AgentRuntimePort,
  type AgentRuntimeSession,
} from "../packages/cat-runtime/src/index.js";

assert.equal(typeof createPiAgentRuntimePort, "function");

const fakeSession: AgentRuntimeSession = {
  sessionId: "fake-session",
  sessionFile: "/tmp/fake-session.jsonl",
  systemPrompt: "fixture",
  isStreaming: false,
  subscribe: () => () => undefined,
  prompt: async () => undefined,
  waitForIdle: async () => undefined,
  steer: async () => undefined,
  followUp: async () => undefined,
  clearQueue: () => ({ steering: [], followUp: [] }),
  getSteeringMessages: () => [],
  getFollowUpMessages: () => [],
  compact: async () => ({ summary: "fixture" }),
  abort: async () => undefined,
  leafEntryId: () => "entry-1",
  hasEntry: (entryId) => entryId === "entry-1",
};
const fakePort: AgentRuntimePort = {
  supportsInput: async () => true,
  createGeneralSession: async () => ({
    session: fakeSession,
    runtimeVersion: "fixture",
    access: { workspaceRoot: "/tmp", workingDirectory: "/tmp", grants: [] },
    resources: {
      extensions: [],
      skills: [],
      prompts: [],
      contextFiles: [],
      activeToolNames: [],
      entries: [],
      conflicts: [],
      resourceSetHash: "0".repeat(64),
    },
    dispose: async () => undefined,
  }),
};
assert.equal((await fakePort.createGeneralSession({
  runtimeRoot: "/tmp",
  taskId: "task",
  permissionContract: buildAgentPermissionContract({ mode: "ask" }),
})).session.sessionId, "fake-session");

const coordinatorSource = await readFile(new URL("../packages/cat-server/src/general_agent_runs.ts", import.meta.url), "utf8");
assert.doesNotMatch(coordinatorSource, /@earendil-works\/pi-(?:coding-agent|ai)/u);
assert.doesNotMatch(coordinatorSource, /\b(?:AgentSession|AgentSessionRuntime|ModelRuntime)\b/u);
assert.match(coordinatorSource, /AgentRuntimePort/u);

process.stdout.write("Agent runtime port tests passed\n");
