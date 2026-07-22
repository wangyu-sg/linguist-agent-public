import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  catAgentProjectSessionId,
  catAgentSessionDir,
  normalizeAndGuardCatToolCall,
  registerCatRuntimeHooks,
  validateCatToolResult,
} from "@linguist-agent/cat-runtime";
import { assertChangeEvidenceAllowed, createWorkspace, parseKnownRisksMarkdown } from "@linguist-agent/cat-data";

// M9 regression: the v1.0 completion gate now derives its implementation checks from real
// BEHAVIOR (hook registration, result validation, session-id shape, evidence blocking) and
// its P0/P1 check cross-checks a register that must not be empty. This test locks in those
// behavioral primitives so the gate's evidence-gathering cannot silently rot to a no-op.

const workspace = createWorkspace(await mkdtemp(join(tmpdir(), "la-gate-evidence-")), "proj");

// runtime_hooks evidence: the three native Pi hooks must actually register.
const events = new Set<string>();
const probePi = {
  on: (event: string) => {
    events.add(event);
  },
  registerCommand: () => {},
  registerTool: () => {},
} as unknown as ExtensionAPI;
registerCatRuntimeHooks(probePi, workspace);
for (const event of ["before_agent_start", "tool_call", "tool_result"]) {
  assert.ok(events.has(event), `registerCatRuntimeHooks must wire the native ${event} hook`);
}

// trace_no_silent_fallback evidence: an empty CAT tool result is flipped to isError.
const empty = validateCatToolResult({ toolName: "tm_lookup", content: [], details: {}, isError: false });
assert.equal(empty?.isError, true, "empty CAT tool result must be surfaced as an error, not silently passed");

// session_workspace_isolation evidence: deterministic project session id + dir shape.
assert.match(catAgentProjectSessionId(workspace), /^la-.+-[0-9a-f]{10}$/);
assert.ok(catAgentSessionDir(workspace).endsWith("_pi_sessions"));

// evidence-gate behavior: a term write missing cited evidence is blocked at the tool_call hook.
const blocked = normalizeAndGuardCatToolCall({
  toolName: "segment_set_target",
  input: { changeType: "terminology", target: "x", reason: "r" },
});
assert.equal(blocked?.block, true, "term/terminology write without evidenceSources must be blocked");
assert.deepEqual(
  assertChangeEvidenceAllowed({ changeType: "accuracy", reason: "Source and target express opposite actions." }),
  [],
  "ordinary bilingual accuracy must not require a fabricated external citation",
);

// P0/P1 evidence: an empty risk register parses to zero rows (so the gate's empty-register
// guard has something real to react to, rather than trusting a hand-authored table blindly).
assert.equal(parseKnownRisksMarkdown("# no table here\n").length, 0);

console.log("gate_evidence tests passed");
