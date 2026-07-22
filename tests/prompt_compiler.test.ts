import assert from "node:assert/strict";
import {
  compilePrompt,
  estimatePromptTokens,
  PromptCompileError,
} from "@linguist-agent/cat-data";

const base = {
  surface: "team_role" as const,
  taskRecipe: "# Role\ntranslator\n\n# Workflow\nwf-1",
  roleRecipe: "Classify function before wording; return the role JSON artifact only.",
  constitution: "CAT constitution: preserve immutable delivery constraints; use project evidence before model judgment.",
  context: {
    artifactRefs: ["constraint_pack:b1"],
    hardConstraints: ["Keep {0}", "Do not change locked rows"],
    evidence: ["TB: 神格 = Divinity"],
    styleGuidance: ["Use concise heroic fantasy voice."],
    priorFindings: ["f1: candidate may be too literal"],
  },
  toolProfile: {
    allowedTools: ["tm_lookup", "termbase_lookup"],
    blockedTools: ["segment_set_target", "bash"],
    writeMode: "proposal_only" as const,
    profileId: "team:translator:v1",
  },
};

const first = compilePrompt(base);
const second = compilePrompt({ ...base, context: { ...base.context, evidence: ["TB: 神格 = Divinity"] } });
assert.equal(first.manifest.promptHash, second.manifest.promptHash, "hashes should be stable for equivalent packets");
assert.equal(first.manifest.hardConstraintsPreserved, true);
assert.equal(first.manifest.referenceIncluded, false);
assert.equal(first.manifest.omittedSections.includes("transcript"), false, "no transcript is present in the typed packet");
assert.match(first.effectivePrompt, /Keep \{0\}/);
assert.match(first.effectivePrompt, /TB: 神格 = Divinity/);
assert.match(first.effectivePrompt, /constraint_pack:b1/, "declared artifact refs must be provider-visible, not manifest-only metadata");
assert.equal(first.manifest.toolProfile.writeMode, "proposal_only");
assert.match(first.manifest.promptHash, /^[0-9a-f]{64}$/);
assert.match(first.manifest.policyHash, /^[0-9a-f]{64}$/);
assert.equal(first.manifest.tokenBudget, undefined, "the compiler must not invent a default prompt ceiling");
assert.equal(first.manifest.overBudget, undefined, "no supplied budget means there is no pass/fail label");
assert.equal(first.manifest.estimateScope, "compiled_business_prompt", "the preflight estimate must not masquerade as complete provider input");

const tiny = compilePrompt({
  ...base,
  tokenBudget: 4,
  context: { ...base.context, evidence: Array.from({ length: 20 }, (_, index) => `optional evidence ${index}`) },
});
assert.equal(tiny.manifest.hardConstraintsPreserved, true);
assert.equal(tiny.manifest.overBudget, true);
assert.ok(tiny.manifest.truncationReason);
assert.ok(tiny.manifest.omittedSections.length > 0);

const evalGeneration = compilePrompt({
  surface: "eval_generate",
  taskRecipe: "Generate one candidate for the provided source segment.",
  context: { task: "source=开始; tmRefs=TM:Start", hardConstraints: ["Preserve placeholders"] },
  toolProfile: { allowedTools: [], blockedTools: ["reference_vault", "write_file"], writeMode: "none" },
});
assert.equal(evalGeneration.manifest.referenceIncluded, false);
assert.doesNotMatch(evalGeneration.effectivePrompt, /referenceTarget|reviewedTarget|customerReturnTarget/);
assert.throws(
  () => compilePrompt({ ...evalGenerationInput(), context: { task: "source", reference: ["withheld answer"] } }),
  (error: unknown) => error instanceof PromptCompileError && error.code === "reference_not_allowed",
);

assert.equal(estimatePromptTokens("1234"), 1);
assert.equal(estimatePromptTokens("开始"), 2, "multibyte scripts must not be estimated as if they were ASCII");
const longSystem = compilePrompt({ ...base, roleRecipe: "x".repeat(30_000), constitution: "y".repeat(20_000) });
assert.equal(longSystem.manifest.overBudget, undefined, "length is measured without inventing a pass/fail threshold");
assert.match(longSystem.systemPrompt, /^y{20000}/);
const diagnosticOnly = compilePrompt({
  ...base,
  context: { ...base.context, evidence: ["evidence:" + "z".repeat(60_000)] },
});
assert.equal(diagnosticOnly.manifest.overBudget, undefined);
assert.deepEqual(diagnosticOnly.manifest.omittedSections, [], "an absent caller limit must not silently discard evidence");
assert.match(diagnosticOnly.effectivePrompt, /evidence:z{100}/);
assert.throws(
  () => compilePrompt({ ...base, taskRecipe: "" }),
  (error: unknown) => error instanceof PromptCompileError && error.code === "empty_recipe",
);

console.log("prompt compiler tests passed");

function evalGenerationInput() {
  return {
    surface: "eval_generate" as const,
    taskRecipe: "Generate one candidate.",
    context: { task: "source" },
    toolProfile: { allowedTools: [], blockedTools: ["reference_vault"], writeMode: "none" as const },
  };
}
