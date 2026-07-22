import assert from "node:assert/strict";
import {
  classifyCatRuntimeRecovery,
  createCatSelfHealingRetryState,
  markCatSelfHealingCompacted,
  planCatSelfHealingRetry,
} from "@linguist-agent/cat-runtime";

const promptTooLong = classifyCatRuntimeRecovery({ message: "context_length_exceeded: prompt too long for this context window" });
assert.equal(promptTooLong.kind, "prompt_too_long");
assert.equal(promptTooLong.action, "compact_and_retry_once");
assert.equal(promptTooLong.retryable, true);

const cutoff = classifyCatRuntimeRecovery({ message: "finish_reason=length; response truncated" });
assert.equal(cutoff.kind, "output_cutoff");
assert.equal(cutoff.action, "continue_generation");
assert.equal(cutoff.retryable, true);

const reconnect = classifyCatRuntimeRecovery({ message: "ECONNRESET socket hang up while streaming" });
assert.equal(reconnect.kind, "timeout_reconnect");
assert.equal(reconnect.action, "reconnect_and_retry");
assert.equal(reconnect.retryable, true);

const provider = classifyCatRuntimeRecovery({ message: "429 rate limit: temporary overloaded, try again" });
assert.equal(provider.kind, "retryable_provider");
assert.equal(provider.action, "pi_provider_retry");
assert.equal(provider.retryable, true);

const toolFailure = classifyCatRuntimeRecovery({
  toolName: "tm_lookup",
  isToolError: true,
  validationErrors: ["tm_lookup returned an empty textual result"],
});
assert.equal(toolFailure.kind, "tool_failure");
assert.equal(toolFailure.action, "surface_tool_failure");
assert.equal(toolFailure.retryable, false);
assert.match(toolFailure.correctiveInstruction, /Do not silently continue/);

// Retry planner: prompt_too_long compacts first and the budget is one-shot.
const state = createCatSelfHealingRetryState();
const compactionPlan = planCatSelfHealingRetry(promptTooLong, state);
assert.ok(compactionPlan);
assert.equal(compactionPlan.piEventType, "self_healing_compaction_retry");
assert.equal(compactionPlan.compactFirst, true);
assert.equal(compactionPlan.preserveStreamState, false);
assert.equal(planCatSelfHealingRetry(promptTooLong, state), undefined, "compaction retry budget is one-shot");

const alreadyCompacted = createCatSelfHealingRetryState();
markCatSelfHealingCompacted(alreadyCompacted);
const retryAfterPiCompaction = planCatSelfHealingRetry(promptTooLong, alreadyCompacted);
assert.ok(retryAfterPiCompaction);
assert.equal(retryAfterPiCompaction.compactFirst, false, "do not compact again after Pi already compacted this turn");

// output_cutoff continues generation and keeps streamed state.
const continuationPlan = planCatSelfHealingRetry(cutoff, state);
assert.ok(continuationPlan);
assert.equal(continuationPlan.piEventType, "self_healing_continuation_retry");
assert.equal(continuationPlan.compactFirst, false);
assert.equal(continuationPlan.preserveStreamState, true);
assert.equal(planCatSelfHealingRetry(cutoff, state), undefined, "continuation retry budget is one-shot");

// timeout/provider classes back off and share a single transient budget.
const transientPlan = planCatSelfHealingRetry(reconnect, state);
assert.ok(transientPlan);
assert.equal(transientPlan.piEventType, "self_healing_transient_retry");
assert.equal(transientPlan.delayMs, 2000);
assert.equal(planCatSelfHealingRetry(provider, state), undefined, "timeout/provider classes share one transient budget");

// Non-retryable classes surface instead of retrying.
assert.equal(planCatSelfHealingRetry(toolFailure, createCatSelfHealingRetryState()), undefined);

// Each enacted class is recorded for retry_end trace emission, in order.
assert.deepEqual(
  state.used.map((entry) => `${entry.kind}:${entry.action}`),
  ["prompt_too_long:compact_and_retry_once", "output_cutoff:continue_generation", "timeout_reconnect:reconnect_and_retry"],
);

console.log("cat_self_healing tests passed");
