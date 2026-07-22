import { compareFormattingSignatures, type FormattingSignatureMismatch } from "./format_signatures.js";
import type { ProjectTagRuleContext } from "./tag_rules.js";
import type { BatchSegment } from "./batch_workspace.js";

export const QA_WRITE_BLOCKER_CODES = new Set([
  "NATIVE_TAG_SIGNATURE_MISMATCH",
  "PROJECT_TAG_SIGNATURE_MISMATCH",
  "RICH_TEXT_SIGNATURE_MISMATCH",
  "UNDERLINE_SIGNATURE_MISMATCH",
  "PLACEHOLDER_SIGNATURE_MISMATCH",
  "ICU_BRANCH_ARITY_MISMATCH",
  "HARD_NEWLINE_MISMATCH",
  "LITERAL_NEWLINE_MISMATCH",
]);

export interface QaWriteGateResult {
  ok: boolean;
  blockers: FormattingSignatureMismatch[];
  warnings: FormattingSignatureMismatch[];
}

export function acceptedQaWriteRisk(code: string, segmentId: string, acceptedRiskCodes: string[] = []): boolean {
  return acceptedRiskCodes.includes(code) || acceptedRiskCodes.includes(`${segmentId}:${code}`);
}

export function runQaWriteGate(
  segment: Pick<BatchSegment, "id" | "source"> & Partial<Pick<BatchSegment, "originalTarget" | "rawTarget">>,
  target: string,
  ruleContext: ProjectTagRuleContext,
  acceptedRiskCodes: string[] = [],
): QaWriteGateResult {
  const comparison = compareFormattingSignatures(segment.source, target, ruleContext, segment.originalTarget ?? segment.rawTarget);
  const blockers = comparison.mismatches.filter(
    (item) => QA_WRITE_BLOCKER_CODES.has(item.code) && !acceptedQaWriteRisk(item.code, segment.id, acceptedRiskCodes),
  );
  const blockerKeys = new Set(blockers.map((item) => item.code));
  const warnings = comparison.mismatches.filter((item) => !blockerKeys.has(item.code));
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function formatQaWriteGateBlockers(segmentId: string, blockers: FormattingSignatureMismatch[]): string {
  return `QA write-blocking gate rejected segment ${segmentId}: ${blockers.map((item) => item.code).join(", ")}`;
}
