import assert from "node:assert/strict";
import {
  buildRuntimeCompactionHandoff,
  assertRuntimeCompactionTarget,
  renderRuntimeCompactionInstructions,
} from "../packages/cat-runtime/src/index.js";

const digest = (character: string) => character.repeat(64);
const handoff = buildRuntimeCompactionHandoff({
  handoffId: "handoff-1",
  taskId: "task-1",
  runId: "run-1",
  threadId: "run-1.main",
  sessionId: "session-1",
  taskGoal: "Translate the selected chapter.",
  openDecisionIds: ["decision-b", "decision-a", "decision-a"],
  pendingArtifactIds: ["artifact-b", "artifact-a"],
  execution: {
    executionId: "execution-1",
    runtimeEpochId: "epoch-1",
    configRevision: 2,
    promptHash: digest("a"),
    toolManifestHash: digest("b"),
    resourceSnapshotHash: digest("c"),
    capabilityGrantHash: digest("d"),
    contextInputHash: digest("e"),
  },
  resourceManifestHash: digest("f"),
  requestedFocus: "Keep decisions.",
  createdAt: "2026-07-22T20:00:00.000Z",
});

assert.equal(handoff.schemaVersion, 1);
assert.deepEqual(handoff.openDecisionIds, ["decision-a", "decision-b"]);
assert.deepEqual(handoff.pendingArtifactIds, ["artifact-a", "artifact-b"]);
assert.equal(handoff.policyHash, digest("d"));
assert.match(renderRuntimeCompactionInstructions(handoff), /Open decisions: decision-a, decision-b/);
assert.match(renderRuntimeCompactionInstructions(handoff), /Resource snapshot SHA-256: c{64}/);
assert.throws(() => assertRuntimeCompactionTarget({
  threadId: "run-1.main",
  expectedSessionId: "session-1",
  expectedSessionFile: "/tmp/session-1.jsonl",
  actualSessionId: "session-2",
  actualSessionFile: "/tmp/session-1.jsonl",
}), /session identity does not match/);
assert.throws(() => assertRuntimeCompactionTarget({
  threadId: "run-1.main",
  expectedSessionId: "session-1",
  expectedSessionFile: "/tmp/session-1.jsonl",
  actualSessionId: "session-1",
  actualSessionFile: "/tmp/session-2.jsonl",
}), /session file does not match/);

assert.throws(() => buildRuntimeCompactionHandoff({
  ...handoff,
  execution: { ...handoff.execution, promptHash: "unknown" },
}), /promptHash must be a SHA-256 digest/);

console.log("runtime compaction handoff tests passed");
