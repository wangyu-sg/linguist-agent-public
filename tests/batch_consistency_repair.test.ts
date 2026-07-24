import assert from "node:assert/strict";
import {
  buildBatchConsistencyPass,
  targetedRepairProposalInputs,
  type QualityFinding,
} from "../packages/cat-data/src/index.js";

function finding(overrides: Partial<QualityFinding> & Pick<QualityFinding, "id" | "segmentId" | "code">): QualityFinding {
  return {
    id: overrides.id,
    batchId: "b1",
    segmentId: overrides.segmentId,
    code: overrides.code,
    category: overrides.category ?? "consistency",
    severity: overrides.severity ?? "warning",
    confidence: overrides.confidence ?? "high",
    authority: overrides.authority ?? "batch_consistency",
    status: overrides.status ?? "open",
    source: overrides.source ?? "source",
    target: overrides.target ?? "target",
    message: overrides.message ?? "QA finding",
    evidenceSources: overrides.evidenceSources ?? ["qa:fixture"],
  };
}

const pass = buildBatchConsistencyPass({
  report: {
    batchId: "b1",
    findings: [
      finding({ id: "term-2", segmentId: "2", code: "TERM_PREFERRED_MISSING", evidenceSources: ["glossary:heroes:2"] }),
      finding({ id: "repeat-1", segmentId: "1", code: "DUPLICATE_TARGET_MISMATCH", evidenceSources: ["qa:duplicate:group-1"] }),
      finding({ id: "voice-3", segmentId: "3", code: "VOICE_INCONSISTENCY", evidenceSources: ["voice:hero"] }),
      finding({ id: "ignored", segmentId: "4", code: "REGISTER_MISMATCH", status: "ignored" }),
    ],
  },
  lockedSegmentIds: ["3"],
});

assert.equal(pass.authority, "advisory_finding");
assert.equal(pass.canCommit, false);
assert.deepEqual(pass.findings.map((row) => row.findingId), ["repeat-1", "term-2", "voice-3"]);
assert.equal(pass.findings.find((row) => row.findingId === "voice-3")?.locked, true);

assert.deepEqual(targetedRepairProposalInputs(pass, {
  repairs: [{ findingId: "term-2", segmentId: "2", proposedTarget: "Hero Emblem", reason: "Apply the confirmed glossary term." }],
}), [{
  segmentId: "2",
  proposedTarget: "Hero Emblem",
  reason: "Apply the confirmed glossary term.",
  changeType: "terminology",
  evidenceSources: ["glossary:heroes:2"],
}]);
assert.throws(
  () => targetedRepairProposalInputs(pass, { repairs: [{ findingId: "term-2", segmentId: "1", proposedTarget: "Hero Emblem", reason: "Unrelated row." }] }),
  /not a selected repair target/,
);
assert.throws(
  () => targetedRepairProposalInputs(pass, { repairs: [{ findingId: "voice-3", segmentId: "3", proposedTarget: "Hero Emblem", reason: "Locked row." }] }),
  /locked/,
);
assert.deepEqual(targetedRepairProposalInputs(pass, { repairs: [] }), [], "consistency pass defaults to findings only");

console.log("batch consistency repair tests passed");
