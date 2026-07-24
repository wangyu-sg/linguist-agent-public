import type { SegmentProposalInput } from "./proposals.js";
import type { QualityAuditReport, QualityFinding } from "./quality_audit.js";

const CONSISTENCY_CODES = new Set<QualityFinding["code"]>([
  "TERM_PREFERRED_MISSING",
  "GLOSSARY_PREFERRED_MISSING",
  "DUPLICATE_TARGET_MISMATCH",
  "VOICE_INCONSISTENCY",
  "REGISTER_MISMATCH",
]);

export interface BatchConsistencyFinding {
  findingId: string;
  segmentId: string;
  code: QualityFinding["code"];
  evidenceSources: string[];
  message: string;
  locked: boolean;
}

export interface BatchConsistencyPass {
  schemaVersion: 1;
  authority: "advisory_finding";
  canCommit: false;
  batchId: string;
  findings: BatchConsistencyFinding[];
}

function changeType(code: QualityFinding["code"]): SegmentProposalInput["changeType"] {
  if (code === "TERM_PREFERRED_MISSING" || code === "GLOSSARY_PREFERRED_MISSING") return "terminology";
  if (code === "DUPLICATE_TARGET_MISMATCH") return "consistency";
  return "style";
}

/** Projects existing deterministic QA findings; it never rechecks or regenerates a Batch. */
export function buildBatchConsistencyPass(input: {
  report: Pick<QualityAuditReport, "batchId" | "findings">;
  lockedSegmentIds: readonly string[];
}): BatchConsistencyPass {
  const locked = new Set(input.lockedSegmentIds);
  return {
    schemaVersion: 1,
    authority: "advisory_finding",
    canCommit: false,
    batchId: input.report.batchId,
    findings: input.report.findings
      .filter((finding) => finding.status === "open" && CONSISTENCY_CODES.has(finding.code))
      .map((finding) => ({
        findingId: finding.id,
        segmentId: finding.segmentId,
        code: finding.code,
        evidenceSources: [...finding.evidenceSources],
        message: finding.message,
        locked: locked.has(finding.segmentId),
      }))
      .sort((left, right) => left.findingId.localeCompare(right.findingId)),
  };
}

/** Converts only explicitly selected, unlocked findings to existing proposal inputs. */
export function targetedRepairProposalInputs(
  pass: BatchConsistencyPass,
  input: { repairs: Array<{ findingId: string; segmentId: string; proposedTarget: string; reason: string }> },
): SegmentProposalInput[] {
  const findings = new Map(pass.findings.map((finding) => [finding.findingId, finding]));
  return input.repairs.map((repair) => {
    const finding = findings.get(repair.findingId);
    if (!finding || finding.segmentId !== repair.segmentId) throw new Error(`Segment ${repair.segmentId} is not a selected repair target.`);
    if (finding.locked) throw new Error(`Segment ${repair.segmentId} is locked and cannot be repaired.`);
    if (!repair.proposedTarget.trim() || !repair.reason.trim()) throw new Error("Targeted repair requires a target and reason.");
    return {
      segmentId: repair.segmentId,
      proposedTarget: repair.proposedTarget.trim(),
      reason: repair.reason.trim(),
      changeType: changeType(finding.code),
      evidenceSources: [...finding.evidenceSources],
    };
  });
}
