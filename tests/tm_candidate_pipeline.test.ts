import assert from "node:assert/strict";
import {
  CandidatePipelineCache,
  planTmFirstCandidatePipeline,
  proposalInputFromCandidatePlan,
  type CandidatePipelineInput,
} from "../packages/cat-data/src/index.js";

const hash = (character: string): string => character.repeat(64);

const baseInput: CandidatePipelineInput = {
  schemaVersion: 1,
  segment: {
    segmentId: "42",
    sourceHash: hash("a"),
    revision: 7,
  },
  context: { graphHash: hash("b") },
  constraints: { snapshotHash: hash("c"), reuseSafety: "verified" },
  assets: { snapshotHash: hash("d") },
  model: { provider: "fixture", modelId: "balanced-model", executionProfileHash: hash("e") },
  prompt: { promptHash: hash("f") },
  tmMatches: [
    {
      id: "reviewed-exact",
      source: "Open the gate",
      target: "Open the Gate",
      srcLang: "en-US",
      tgtLang: "zh-CN",
      origin: "reviewed",
      sourceKind: "manual",
      score: 1,
      matchType: "exact",
      effectiveAuthority: "reviewed_tm",
    },
  ],
};

const inputBefore = JSON.parse(JSON.stringify(baseInput));
const exact = planTmFirstCandidatePipeline(baseInput);
assert.equal(exact.authority, "candidate_only", "candidate planning must not become CAT authority");
assert.equal(exact.canCommit, false, "candidate planning cannot write a segment or Decision");
assert.equal(exact.route, "exact_tm");
assert.equal(exact.modelInvocation, "skip_expensive_generation");
assert.equal(exact.candidate?.target, "Open the Gate");
assert.equal(exact.candidate?.status, "ready_for_proposal");
assert.deepEqual(exact.candidate?.evidenceSources, ["tm:reviewed-exact"]);
assert.match(exact.cacheKey, /^[a-f0-9]{64}$/u);
assert.equal(Object.isFrozen(exact), true);
assert.deepEqual(baseInput, inputBefore, "candidate planning must not mutate TM or context inputs");

const proposalInput = proposalInputFromCandidatePlan(exact);
assert.deepEqual(proposalInput, {
  segmentId: "42",
  proposedTarget: "Open the Gate",
  reason: "Safe exact reviewed TM reuse; expensive generation skipped.",
  changeType: "translation",
  evidenceSources: ["tm:reviewed-exact"],
});

const cache = new CandidatePipelineCache();
const cachedFirst = planTmFirstCandidatePipeline(baseInput, { cache });
const cachedSecond = planTmFirstCandidatePipeline(baseInput, { cache });
assert.equal(cachedFirst.cacheHit, false);
assert.equal(cachedSecond.cacheHit, true, "same complete content address may reuse only its immutable plan");

for (const [label, changed] of [
  ["source", { ...baseInput, segment: { ...baseInput.segment, sourceHash: hash("1") } }],
  ["context", { ...baseInput, context: { graphHash: hash("2") } }],
  ["constraints", { ...baseInput, constraints: { ...baseInput.constraints, snapshotHash: hash("3") } }],
  ["assets", { ...baseInput, assets: { snapshotHash: hash("4") } }],
  ["model", { ...baseInput, model: { ...baseInput.model, modelId: "best-model", executionProfileHash: hash("5") } }],
  ["prompt", { ...baseInput, prompt: { promptHash: hash("6") } }],
] as const) {
  const plan = planTmFirstCandidatePipeline(changed, { cache });
  assert.equal(plan.cacheHit, false, `${label} change must invalidate the content-addressed candidate plan`);
  assert.notEqual(plan.cacheKey, exact.cacheKey, `${label} must be represented in the cache key`);
}

const repetition = planTmFirstCandidatePipeline({
  ...baseInput,
  tmMatches: [],
  repetitions: [{
    sourceHash: baseInput.segment.sourceHash,
    sourceRevision: baseInput.segment.revision,
    target: "Open the Gate",
    status: "confirmed",
    evidenceSource: "segment:b1:11",
  }],
});
assert.equal(repetition.route, "repetition");
assert.equal(repetition.modelInvocation, "skip_expensive_generation");
assert.equal(repetition.candidate?.source, "repetition");

const fuzzyRepair = planTmFirstCandidatePipeline({
  ...baseInput,
  tmMatches: [{
    ...baseInput.tmMatches[0]!,
    id: "reviewed-fuzzy",
    source: "Open the heavy gate",
    target: "Open the Heavy Gate",
    score: 0.93,
    matchType: "fuzzy",
  }],
});
assert.equal(fuzzyRepair.route, "fuzzy_diff_repair");
assert.equal(fuzzyRepair.modelInvocation, "diff_repair");
assert.equal(fuzzyRepair.candidate?.status, "requires_diff_repair");
assert.throws(() => proposalInputFromCandidatePlan(fuzzyRepair), /ready proposal candidate/);

const unsafeExact = planTmFirstCandidatePipeline({
  ...baseInput,
  constraints: { ...baseInput.constraints, reuseSafety: "unknown" },
});
assert.equal(unsafeExact.route, "full_generation");
assert.equal(unsafeExact.modelInvocation, "full_generation");
assert.equal(unsafeExact.candidate, undefined);

const conflictingExact = planTmFirstCandidatePipeline({
  ...baseInput,
  tmMatches: [
    baseInput.tmMatches[0]!,
    { ...baseInput.tmMatches[0]!, id: "reviewed-exact-conflict", target: "Unlock the Gate" },
  ],
});
assert.equal(conflictingExact.route, "full_generation", "conflicting exact evidence cannot skip model work");

const advisoryExact = planTmFirstCandidatePipeline({
  ...baseInput,
  tmMatches: [{ ...baseInput.tmMatches[0]!, origin: "client_tm", sourceKind: "client_import", effectiveAuthority: "client_tm" }],
});
assert.equal(advisoryExact.route, "full_generation", "unreviewed client TM must remain evidence, not safe automatic reuse");

assert.throws(
  () => planTmFirstCandidatePipeline({ ...baseInput, context: { graphHash: "not-a-digest" } }),
  /graphHash/,
);

console.log("TM-first candidate pipeline tests passed");
