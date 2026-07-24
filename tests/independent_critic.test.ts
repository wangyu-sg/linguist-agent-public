import assert from "node:assert/strict";
import {
  createIndependentCriticArtifact,
  parseIndependentCriticArtifact,
  planIndependentCritic,
  targetedRepairScopeFromCriticArtifact,
} from "../packages/cat-data/src/index.js";

const hash = (character: string): string => character.repeat(64);

const request = {
  schemaVersion: 1 as const,
  subject: {
    segmentId: "42",
    risk: "high" as const,
    candidateId: "candidate-42",
    candidateHash: hash("a"),
    candidateExecutionId: "generation-run-42",
    candidateProducerId: "translator-agent",
  },
  critic: {
    criticId: "fidelity-critic",
    executionId: "critic-run-42",
    profileHash: hash("b"),
  },
  findings: [
    {
      category: "fidelity" as const,
      severity: "blocking" as const,
      evidenceRefs: ["tm:reviewed-42", "segment:42@7"],
      explanation: "The candidate drops a required action verb.",
      suggestedRepair: "Restore the action verb while preserving terminology.",
    },
  ],
};

const artifact = createIndependentCriticArtifact(request);
assert.equal(artifact.authority, "advisory_finding", "critic output must never become CAT authority");
assert.equal(artifact.canCommit, false, "critic output cannot write a target or Decision");
assert.equal(artifact.subject.segmentId, "42");
assert.equal(artifact.findings.length, 1);
assert.equal(artifact.findings[0]?.criticId, "fidelity-critic");
assert.match(artifact.artifactHash, /^[a-f0-9]{64}$/u);
assert.deepEqual(parseIndependentCriticArtifact(JSON.parse(JSON.stringify(artifact))), artifact, "the versioned finding artifact crosses a strict JSON boundary");
assert.throws(() => parseIndependentCriticArtifact({ ...artifact, unknown: true }), /unknown field/);
assert.throws(() => parseIndependentCriticArtifact({ ...artifact, artifactHash: hash("0") }), /artifactHash/);

const scope = targetedRepairScopeFromCriticArtifact(artifact, { findingIds: [artifact.findings[0]!.findingId] });
assert.deepEqual(scope, {
  authority: "advisory_finding",
  canCommit: false,
  segmentIds: ["42"],
  findingIds: [artifact.findings[0]!.findingId],
});
assert.throws(() => targetedRepairScopeFromCriticArtifact(artifact, { findingIds: ["not-in-artifact"] }), /not found/);

assert.deepEqual(planIndependentCritic({ risk: "low" }), { kind: "not_required", reason: "Independent Critic is reserved for high-risk segments." });
assert.deepEqual(planIndependentCritic({ risk: "high" }), { kind: "required", requiredRoles: ["fidelity", "naturalness", "terminology", "voice"] });
assert.throws(
  () => createIndependentCriticArtifact({ ...request, critic: { ...request.critic, executionId: request.subject.candidateExecutionId } }),
  /different execution/,
);
assert.throws(
  () => createIndependentCriticArtifact({ ...request, critic: { ...request.critic, criticId: request.subject.candidateProducerId } }),
  /different actor/,
);
assert.throws(
  () => createIndependentCriticArtifact({ ...request, subject: { ...request.subject, risk: "medium" } }),
  /high-risk/,
);
assert.throws(
  () => createIndependentCriticArtifact({ ...request, findings: [{ ...request.findings[0]!, evidenceRefs: [] }] }),
  /evidenceRefs/,
);

console.log("independent critic tests passed");
