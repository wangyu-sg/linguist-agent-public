import assert from "node:assert/strict";
import {
  ModelContextRegistry,
  executionProfileSwitchCompatibility,
  parseExecutionProfilePlan,
  planExecutionProfile,
  type PromptRequestBudget,
} from "../packages/cat-data/src/index.js";

const registry = new ModelContextRegistry([
  { provider: "fixture", modelId: "fast-model", contextWindow: 32_000, outputReserveTokens: 2_000 },
  { provider: "fixture", modelId: "balanced-model", contextWindow: 64_000, outputReserveTokens: 4_000 },
  { provider: "fixture", modelId: "best-model", contextWindow: 128_000, outputReserveTokens: 8_000 },
  { provider: "fixture", modelId: "explicit-model", contextWindow: 48_000, outputReserveTokens: 4_000 },
  { provider: "fixture", modelId: "replacement-model", contextWindow: 48_000, outputReserveTokens: 4_000 },
]);

function budget(modelId: string): PromptRequestBudget {
  return {
    registry,
    provider: "fixture",
    modelId,
    toolSchemaTokens: 120,
    historyTokens: 240,
    providerFramingTokens: 80,
    safetyMarginTokens: 60,
    compactionReserveTokens: 400,
  };
}

const qualityRoutes = {
  fast: { provider: "fixture", modelId: "fast-model", thinkingLevel: "minimal" as const },
  balanced: { provider: "fixture", modelId: "balanced-model", thinkingLevel: "medium" as const },
  best: { provider: "fixture", modelId: "best-model", thinkingLevel: "high" as const },
};

const balanced = planExecutionProfile({
  requestedProfile: "balanced",
  qualityRoutes,
  requestBudget: budget("balanced-model"),
});
assert.equal(balanced.profile, "balanced");
assert.equal(balanced.selection, "quality_route");
assert.deepEqual(balanced.model, qualityRoutes.balanced);
assert.deepEqual(balanced.budget, {
  contextWindow: 64_000,
  outputReserveTokens: 4_000,
  toolSchemaTokens: 120,
  historyTokens: 240,
  providerFramingTokens: 80,
  safetyMarginTokens: 60,
  compactionReserveTokens: 400,
});
assert.match(balanced.profileHash, /^[a-f0-9]{64}$/u);
assert.equal(Object.hasOwn(balanced, "capabilities"), false, "the router must not invent model/tool capabilities");
assert.deepEqual(parseExecutionProfilePlan(JSON.parse(JSON.stringify(balanced))), balanced, "the immutable profile plan crosses a strict JSON boundary");
assert.throws(
  () => parseExecutionProfilePlan({ ...balanced, profileHash: "0".repeat(64) }),
  /profileHash changed/,
);
assert.throws(
  () => parseExecutionProfilePlan({ ...balanced, unknown: true }),
  /unknown field/,
);

const explicit = planExecutionProfile({
  explicitModel: { provider: "fixture", modelId: "explicit-model", thinkingLevel: "low" },
  qualityRoutes,
  requestBudget: budget("explicit-model"),
});
assert.equal(explicit.profile, "custom", "legacy direct model selection remains explicit rather than guessed quality");
assert.equal(explicit.selection, "explicit_model");

assert.throws(
  () => planExecutionProfile({
    requestedProfile: "fast",
    qualityRoutes: { balanced: qualityRoutes.balanced },
    requestBudget: budget("balanced-model"),
  }),
  /Fast ExecutionProfile is not configured/,
);
assert.throws(
  () => planExecutionProfile({
    requestedProfile: "best",
    qualityRoutes,
    requestBudget: budget("balanced-model"),
  }),
  /does not match the selected model route/,
);

const replacement = planExecutionProfile({
  explicitModel: { provider: "fixture", modelId: "replacement-model", thinkingLevel: "low" },
  qualityRoutes,
  requestBudget: budget("replacement-model"),
});
assert.deepEqual(executionProfileSwitchCompatibility(explicit, replacement), {
  effectiveFrom: "new_runtime_epoch",
  compatibility: "requires_runtime_restart",
});
assert.deepEqual(executionProfileSwitchCompatibility(explicit, explicit), {
  effectiveFrom: "next_turn",
  compatibility: "compatible",
});

process.stdout.write("execution profile tests passed\n");
