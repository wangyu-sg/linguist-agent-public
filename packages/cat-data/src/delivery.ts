import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  dehydratePhraseTarget,
  mqxliffInlineTagSignatureFromTags,
  mqxliffInlineTagSignatureFromText,
  writeGenericXliffTargets,
  parseMqxliff,
  parsePhraseMxliff,
  parseSdlxliff,
  phraseInlineTagSignature,
  phrasePlaceholderSignature,
  writeTableCsvTargets,
  readSdlxliff,
  sdlxliffInlineTagSignatureFromTags,
  sdlxliffInlineTagSignatureFromText,
  writeMqxliffTargets,
  writeSdlxliffTargets,
  writePhraseBilingualDocxTargets,
  writePhraseMxliffTargetsWithReport,
  type MqxliffTargetWrite,
  type PhraseTargetWrite,
  type SdlxliffConfirmationLevel,
} from "@linguist-agent/cat-formats";
import { readProjectManifest } from "./project_manifest.js";
import { readBatch, type BatchSegment } from "./batch_workspace.js";
import { listProposalSets } from "./proposals.js";
import { createWorkspace, workspacePath } from "./workspace.js";
import { compareFormattingSignatures, stripIcuBranchPlaceholders, type FormattingSignatureMismatch } from "./format_signatures.js";
import { readProjectTagRuleContext, type ProjectTagRuleContext } from "./tag_rules.js";
import { writeXlsxTargets } from "./table_batch.js";
import { acceptedQaWriteRisk } from "./qa_write_gate.js";
import { deliveryRiskFindingId, readDeliveryRiskWaivers, type DeliveryRiskWaiver } from "./delivery_waivers.js";
import { qualityAuditFindingLedgerEvents, runQualityAudit } from "./quality_audit.js";
import { appendQualityDecisionLedgerOnce, authorizeQualityLedgerExport, type QualityDecisionLedgerInput } from "./quality_decision_ledger.js";
import { assertCatGovernanceLegacyAllowed, catGovernancePersistenceFor, readCatGovernanceReadCache } from "./cat_governance_storage.js";

export type DeliverySeverity = "blocker" | "warning" | "waived";

export interface DeliveryIssue {
  severity: DeliverySeverity;
  code: string;
  message: string;
  segmentIds: string[];
  signatures?: Record<string, FormattingSignatureMismatch[]>;
}

export interface DeliveryReport {
  status: "pass" | "warn" | "fail";
  projectId: string;
  batchId: string;
  checkedAt: string;
  rulesDigest: string;
  activeProjectRuleCount: number;
  candidateRuleCount: number;
  blockers: DeliveryIssue[];
  waived: DeliveryIssue[];
  warnings: DeliveryIssue[];
  summary: {
    totalSegments: number;
    lockedSegments: number;
    untranslatedEditable: number;
    unresolvedTagSegments: number;
    tagMismatchSegments: number;
    projectTagMismatchSegments: number;
    richTextMismatchSegments: number;
    underlineMismatchSegments: number;
    nativeTagMismatchSegments: number;
    placeholderSignatureMismatchSegments: number;
    hardNewlineMismatchSegments: number;
    literalNewlineMismatchSegments: number;
    richTextSegments: number;
    underlineSegments: number;
    nativeTagSegments: number;
    placeholderSafetySegments: number;
    duplicateInconsistencyGroups: number;
    unappliedProposalRows: number;
  };
}

export interface ExportResult {
  projectId: string;
  batchId: string;
  format: "phrase_mxliff" | "phrase_bilingual_docx" | "mqxliff" | "sdlxliff" | "xliff" | "csv" | "xlsx";
  outputPath: string;
  updatedSegments: number;
  missingIds: string[];
  delivery: DeliveryReport;
  auditId?: string;
  auditPath?: string;
  authorization?: Awaited<ReturnType<typeof authorizeQualityLedgerExport>>;
}

export interface ExportAuditRecord {
  schemaVersion: 1;
  auditId: string;
  exportedAt: string;
  projectId: string;
  batchId: string;
  format: ExportResult["format"];
  outputPath: string;
  sourceFile: string;
  masterFile?: string;
  updatedSegments: number;
  missingIds: string[];
  deliveryStatus: DeliveryReport["status"];
  rulesDigest: string;
  activeProjectRuleCount: number;
  candidateRuleCount: number;
  blockerCodes: string[];
  warningCodes: string[];
  deliveredTargets: Array<{
    segmentId: string;
    targetSha256: string;
    targetBytes: number;
  }>;
  force: boolean;
  role?: "T" | "E" | "P";
  templateDocxPath?: string;
}

function emptyTarget(segment: BatchSegment): boolean {
  return !segment.target.trim();
}

function shouldCheckTargetSignatures(segment: BatchSegment): boolean {
  return !segment.locked && !emptyTarget(segment);
}

function hasLockedChange(segment: BatchSegment): boolean {
  return segment.locked && segment.target !== segment.rawTarget;
}

function uniqueTargets(segments: BatchSegment[]): string[] {
  return Array.from(new Set(segments.map((segment) => segment.target.trim()).filter(Boolean)));
}

function sameSignature(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasTagSignatureMismatch(segment: BatchSegment, ruleContext: ProjectTagRuleContext): boolean {
  if (!segment.target.trim()) return false;
  const sourceWithoutIcuBranches = stripIcuBranchPlaceholders(segment.source);
  const targetWithoutIcuBranches = stripIcuBranchPlaceholders(segment.target);
  const sourceTags = phraseInlineTagSignature(sourceWithoutIcuBranches);
  const targetTags = phraseInlineTagSignature(targetWithoutIcuBranches);
  if (sourceTags.length || targetTags.length) {
    return !sameSignature(sourceTags, targetTags);
  }
  const sourcePlaceholders = phrasePlaceholderSignature(sourceWithoutIcuBranches);
  const targetPlaceholders = phrasePlaceholderSignature(targetWithoutIcuBranches);
  if (!sameSignature(sourcePlaceholders, targetPlaceholders)) return true;
  return compareFormattingSignatures(segment.source, segment.target, ruleContext, segment.originalTarget ?? segment.rawTarget).mismatches.some(
    (mismatch) => mismatch.code === "PROJECT_TAG_SIGNATURE_MISMATCH",
  );
}

function hasNativeTag(value: string): boolean {
  return /<\/?[a-z][a-z0-9:-]*(?:\s+[^<>]*)?>/i.test(value);
}

function hasRichTextTag(value: string): boolean {
  return /<\/?(?:b|i|u|strong|em|font|color|span)\b/i.test(value);
}

function hasUnderlineTag(value: string): boolean {
  return /<\/?u\b/i.test(value);
}

function touchedTarget(segment: BatchSegment): boolean {
  const importedTarget = segment.originalTarget ?? segment.rawTarget;
  return !segment.locked && Boolean(segment.updatedAt || segment.updateReason || segment.updateChangeType) && segment.target !== importedTarget;
}

function formattingMismatchesByCode(
  segments: BatchSegment[],
  ruleContext: ProjectTagRuleContext,
): Map<string, Array<{ segment: BatchSegment; mismatch: FormattingSignatureMismatch }>> {
  const byCode = new Map<string, Array<{ segment: BatchSegment; mismatch: FormattingSignatureMismatch }>>();
  for (const segment of segments) {
    if (!shouldCheckTargetSignatures(segment)) continue;
    const comparison = compareFormattingSignatures(segment.source, segment.target, ruleContext, segment.originalTarget ?? segment.rawTarget);
    for (const mismatch of comparison.mismatches) {
      const rows = byCode.get(mismatch.code) ?? [];
      rows.push({ segment, mismatch });
      byCode.set(mismatch.code, rows);
    }
  }
  return byCode;
}

function issueSignatures(rows: Array<{ segment: BatchSegment; mismatch: FormattingSignatureMismatch }>): Record<string, FormattingSignatureMismatch[]> {
  const signatures: Record<string, FormattingSignatureMismatch[]> = {};
  for (const row of rows) {
    signatures[row.segment.id] = [...(signatures[row.segment.id] ?? []), row.mismatch];
  }
  return signatures;
}

function issueForSegmentIds(issue: DeliveryIssue, segmentIds: string[], severity = issue.severity): DeliveryIssue {
  const signatures = issue.signatures
    ? Object.fromEntries(segmentIds.flatMap((id) => issue.signatures?.[id] ? [[id, issue.signatures[id]]] : []))
    : undefined;
  return {
    ...issue,
    severity,
    segmentIds,
    signatures: signatures && Object.keys(signatures).length ? signatures : undefined,
  };
}

function isDeliveryRiskWaived(waivers: DeliveryRiskWaiver[], batchId: string, issue: DeliveryIssue, segmentId: string): boolean {
  const acceptedRiskCodes = waivers
    .filter((waiver) => waiver.batchId === batchId && waiver.segmentId === segmentId)
    .map((waiver) => waiver.code);
  return acceptedQaWriteRisk(issue.code, segmentId, acceptedRiskCodes);
}

function applyDeliveryRiskWaivers(
  blockers: DeliveryIssue[],
  batchId: string,
  waivers: DeliveryRiskWaiver[],
): { blockers: DeliveryIssue[]; waived: DeliveryIssue[] } {
  if (!waivers.length) return { blockers, waived: [] };
  const activeBlockers: DeliveryIssue[] = [];
  const waivedIssues: DeliveryIssue[] = [];
  for (const issue of blockers) {
    if (!issue.segmentIds.length) {
      activeBlockers.push(issue);
      continue;
    }
    const waivedSegmentIds = issue.segmentIds.filter((segmentId) => isDeliveryRiskWaived(waivers, batchId, issue, segmentId));
    if (!waivedSegmentIds.length) {
      activeBlockers.push(issue);
      continue;
    }
    waivedIssues.push(issueForSegmentIds(issue, waivedSegmentIds, "waived"));
    const activeSegmentIds = issue.segmentIds.filter((segmentId) => !waivedSegmentIds.includes(segmentId));
    if (activeSegmentIds.length) {
      activeBlockers.push(issueForSegmentIds(issue, activeSegmentIds));
    }
  }
  return { blockers: activeBlockers, waived: waivedIssues };
}

async function sdlxliffTagSignatureMismatches(batch: Awaited<ReturnType<typeof readBatch>>): Promise<BatchSegment[]> {
  if (batch.format !== "sdlxliff") return [];
  const parsed = await readSdlxliff(batch.sourceFile);
  const sourceTagsById = new Map(parsed.segments.map((segment) => [segment.id, segment.sourceTags]));
  return batch.segments.filter((segment) => {
    if (!shouldCheckTargetSignatures(segment)) return false;
    const sourceTags = sourceTagsById.get(segment.id) ?? [];
    if (!sourceTags.length) return false;
    const expected = sdlxliffInlineTagSignatureFromTags(sourceTags);
    const actual = sdlxliffInlineTagSignatureFromText(segment.target, sourceTags);
    return !sameSignature(expected, actual);
  });
}

export async function runDeliveryCheck(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
): Promise<DeliveryReport> {
  const batch = await readBatch(workspaceRoot, projectId, batchId);
  const ruleContext = await readProjectTagRuleContext(workspaceRoot, projectId);
  const blockers: DeliveryIssue[] = [];
  const warnings: DeliveryIssue[] = [];

  const untranslated = batch.segments.filter((segment) => !segment.locked && emptyTarget(segment));
  if (untranslated.length) {
    blockers.push({
      severity: "blocker",
      code: "UNTRANSLATED_EDITABLE",
      message: `${untranslated.length} editable segments have empty targets.`,
      segmentIds: untranslated.map((segment) => segment.id),
    });
  }

  const lockedChanged = batch.segments.filter(hasLockedChange);
  if (lockedChanged.length) {
    blockers.push({
      severity: "blocker",
      code: "LOCKED_TARGET_CHANGED",
      message: `${lockedChanged.length} locked segments differ from the imported target and must not be exported.`,
      segmentIds: lockedChanged.map((segment) => segment.id),
    });
  }

  const unresolvedTags = batch.format === "phrase_mxliff"
    ? batch.segments.filter((segment) => (segment.unresolvedTagPlaceholderCount ?? segment.unresolvedPlaceholderCount) > 0)
    : [];
  if (unresolvedTags.length) {
    blockers.push({
      severity: "blocker",
      code: "UNRESOLVED_PLACEHOLDER",
      message: `${unresolvedTags.length} segments still contain unresolved structural tag placeholder markers after tag rehydration.`,
      segmentIds: unresolvedTags.map((segment) => segment.id),
    });
  }

  const tagMismatches = batch.format === "sdlxliff"
    ? await sdlxliffTagSignatureMismatches(batch)
    : batch.segments.filter((segment) => shouldCheckTargetSignatures(segment) && hasTagSignatureMismatch(segment, ruleContext));
  if (tagMismatches.length) {
    blockers.push({
      severity: "blocker",
      code: "TAG_SIGNATURE_MISMATCH",
      message: `${tagMismatches.length} editable segments have target tag/placeholder signatures that differ from source.`,
      segmentIds: tagMismatches.map((segment) => segment.id),
    });
  }

  const formattingMismatchRows = formattingMismatchesByCode(batch.segments, ruleContext);
  const richTextMismatches = formattingMismatchRows.get("RICH_TEXT_SIGNATURE_MISMATCH") ?? [];
  if (richTextMismatches.length) {
    blockers.push({
      severity: "blocker",
      code: "RICH_TEXT_SIGNATURE_MISMATCH",
      message: `${richTextMismatches.length} editable segments have target rich-text wrapper signatures that differ from source.`,
      segmentIds: richTextMismatches.map((row) => row.segment.id),
      signatures: issueSignatures(richTextMismatches),
    });
  }

  const underlineMismatches = formattingMismatchRows.get("UNDERLINE_SIGNATURE_MISMATCH") ?? [];
  if (underlineMismatches.length) {
    blockers.push({
      severity: "blocker",
      code: "UNDERLINE_SIGNATURE_MISMATCH",
      message: `${underlineMismatches.length} editable segments have target underline signatures that differ from source.`,
      segmentIds: underlineMismatches.map((row) => row.segment.id),
      signatures: issueSignatures(underlineMismatches),
    });
  }

  const nativeTagMismatches = formattingMismatchRows.get("NATIVE_TAG_SIGNATURE_MISMATCH") ?? [];
  if (nativeTagMismatches.length && !blockers.some((issue) => issue.code === "TAG_SIGNATURE_MISMATCH")) {
    blockers.push({
      severity: "blocker",
      code: "NATIVE_TAG_SIGNATURE_MISMATCH",
      message: `${nativeTagMismatches.length} editable segments have native inline tag signatures that differ from source.`,
      segmentIds: nativeTagMismatches.map((row) => row.segment.id),
      signatures: issueSignatures(nativeTagMismatches),
    });
  }

  const placeholderSignatureMismatches = formattingMismatchRows.get("PLACEHOLDER_SIGNATURE_MISMATCH") ?? [];
  if (placeholderSignatureMismatches.length && !blockers.some((issue) => issue.code === "TAG_SIGNATURE_MISMATCH")) {
    blockers.push({
      severity: "blocker",
      code: "PLACEHOLDER_SIGNATURE_MISMATCH",
      message: `${placeholderSignatureMismatches.length} editable segments have placeholder signatures that differ from source.`,
      segmentIds: placeholderSignatureMismatches.map((row) => row.segment.id),
      signatures: issueSignatures(placeholderSignatureMismatches),
    });
  }

  const projectTagMismatches = formattingMismatchRows.get("PROJECT_TAG_SIGNATURE_MISMATCH") ?? [];
  if (projectTagMismatches.length) {
    blockers.push({
      severity: "blocker",
      code: "PROJECT_TAG_SIGNATURE_MISMATCH",
      message: `${projectTagMismatches.length} editable segments have project tag signatures that differ from source.`,
      segmentIds: projectTagMismatches.map((row) => row.segment.id),
      signatures: issueSignatures(projectTagMismatches),
    });
  }

  const hardNewlineMismatches = formattingMismatchRows.get("HARD_NEWLINE_MISMATCH") ?? [];
  if (hardNewlineMismatches.length) {
    blockers.push({
      severity: "blocker",
      code: "HARD_NEWLINE_MISMATCH",
      message: `${hardNewlineMismatches.length} editable segments have hard line-break counts that differ from source.`,
      segmentIds: hardNewlineMismatches.map((row) => row.segment.id),
      signatures: issueSignatures(hardNewlineMismatches),
    });
  }

  const literalNewlineMismatches = formattingMismatchRows.get("LITERAL_NEWLINE_MISMATCH") ?? [];
  if (literalNewlineMismatches.length) {
    blockers.push({
      severity: "blocker",
      code: "LITERAL_NEWLINE_MISMATCH",
      message: `${literalNewlineMismatches.length} editable segments retain literal \\n markers in target instead of platform hard line breaks.`,
      segmentIds: literalNewlineMismatches.map((row) => row.segment.id),
      signatures: issueSignatures(literalNewlineMismatches),
    });
  }

  const icuBranchArityMismatches = formattingMismatchRows.get("ICU_BRANCH_ARITY_MISMATCH") ?? [];
  if (icuBranchArityMismatches.length) {
    warnings.push({
      severity: "warning",
      code: "ICU_BRANCH_ARITY_MISMATCH",
      message: `${icuBranchArityMismatches.length} editable segments have named branch-placeholder arity that differs from source; verify platform plural/branch behavior before delivery.`,
      segmentIds: icuBranchArityMismatches.map((row) => row.segment.id),
      signatures: issueSignatures(icuBranchArityMismatches),
    });
  }

  const richTextSegments = batch.segments.filter((segment) => touchedTarget(segment) && (hasRichTextTag(segment.source) || hasRichTextTag(segment.target)));
  if (richTextSegments.length) {
    warnings.push({
      severity: "warning",
      code: "RICH_TEXT_PRESENT",
      message: `${richTextSegments.length} editable segments contain rich-text inline tags; verify formatting survives platform round-trip.`,
      segmentIds: richTextSegments.map((segment) => segment.id),
    });
  }

  const underlineSegments = batch.segments.filter((segment) => touchedTarget(segment) && (hasUnderlineTag(segment.source) || hasUnderlineTag(segment.target)));
  if (underlineSegments.length) {
    warnings.push({
      severity: "warning",
      code: "UNDERLINE_PRESENT",
      message: `${underlineSegments.length} editable segments contain underline markup; verify formatting and QA disposition before delivery.`,
      segmentIds: underlineSegments.map((segment) => segment.id),
    });
  }

  const nativeTagSegments = batch.segments.filter((segment) => touchedTarget(segment) && (hasNativeTag(segment.source) || hasNativeTag(segment.target)));
  if (nativeTagSegments.length) {
    warnings.push({
      severity: "warning",
      code: "NATIVE_TAG_PRESENT",
      message: `${nativeTagSegments.length} editable segments contain native inline tags; verify tag signatures and rendering context.`,
      segmentIds: nativeTagSegments.map((segment) => segment.id),
    });
  }

  const placeholderSafetySegments = batch.segments.filter(
    (segment) => touchedTarget(segment) && ((segment.placeholderCount ?? 0) > 0 || (segment.unresolvedPlaceholderCount ?? 0) > 0),
  );
  if (placeholderSafetySegments.length) {
    warnings.push({
      severity: "warning",
      code: "PLACEHOLDER_SAFETY_PRESENT",
      message: `${placeholderSafetySegments.length} editable segments contain placeholders or recovered tags; verify delivery safety before export.`,
      segmentIds: placeholderSafetySegments.map((segment) => segment.id),
    });
  }

  let duplicateInconsistencyGroups = 0;
  for (const group of batch.duplicateSourceGroups) {
    const groupSegments = batch.segments.filter((segment) => segment.duplicateKey === group.duplicateKey && !segment.locked);
    const targets = uniqueTargets(groupSegments);
    if (targets.length > 1) {
      duplicateInconsistencyGroups += 1;
      warnings.push({
        severity: "warning",
        code: "DUPLICATE_TARGET_DIVERGENCE",
        message: `Duplicate source group has ${targets.length} different non-empty targets.`,
        segmentIds: groupSegments.map((segment) => segment.id),
      });
    }
  }

  const proposalSets = await listProposalSets(workspaceRoot, projectId, batchId);
  const unappliedProposalRows = proposalSets.reduce((sum, row) => sum + row.proposed, 0);
  if (unappliedProposalRows) {
    warnings.push({
      severity: "warning",
      code: "UNAPPLIED_PROPOSALS",
      message: `${unappliedProposalRows} proposal rows are still proposed and have not been applied or rejected.`,
      segmentIds: [],
    });
  }

  const waivers = await readDeliveryRiskWaivers(workspaceRoot, projectId);
  const deliveryGate = applyDeliveryRiskWaivers(blockers, batchId, waivers);

  return {
    status: deliveryGate.blockers.length ? "fail" : (warnings.length || deliveryGate.waived.length) ? "warn" : "pass",
    projectId,
    batchId,
    checkedAt: new Date().toISOString(),
    rulesDigest: ruleContext.rulesDigest,
    activeProjectRuleCount: ruleContext.activeProjectRules.length,
    candidateRuleCount: ruleContext.candidateRuleCount,
    blockers: deliveryGate.blockers,
    waived: deliveryGate.waived,
    warnings,
    summary: {
      totalSegments: batch.segments.length,
      lockedSegments: batch.segments.filter((segment) => segment.locked).length,
      untranslatedEditable: untranslated.length,
      unresolvedTagSegments: unresolvedTags.length,
      tagMismatchSegments: tagMismatches.length,
      projectTagMismatchSegments: projectTagMismatches.length,
      richTextMismatchSegments: richTextMismatches.length,
      underlineMismatchSegments: underlineMismatches.length,
      nativeTagMismatchSegments: nativeTagMismatches.length,
      placeholderSignatureMismatchSegments: placeholderSignatureMismatches.length,
      hardNewlineMismatchSegments: hardNewlineMismatches.length,
      literalNewlineMismatchSegments: literalNewlineMismatches.length,
      richTextSegments: richTextSegments.length,
      underlineSegments: underlineSegments.length,
      nativeTagSegments: nativeTagSegments.length,
      placeholderSafetySegments: placeholderSafetySegments.length,
      duplicateInconsistencyGroups,
      unappliedProposalRows,
    },
  };
}

async function resolvePath(workspaceRoot: string, projectId: string, value: string): Promise<string> {
  if (isAbsolute(value)) return value;
  const manifest = await readProjectManifest(workspaceRoot, projectId);
  return resolve(manifest.root, value);
}

async function defaultExportPath(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  extension: string,
): Promise<string> {
  const dir = workspacePath(createWorkspace(workspaceRoot, projectId), "exports");
  await mkdir(dir, { recursive: true });
  return join(dir, `${batchId}.${extension}`);
}

async function resolveExportOutputPath(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  extension: string,
  value?: string,
): Promise<string> {
  if (!value?.trim()) return defaultExportPath(workspaceRoot, projectId, batchId, extension);
  const resolved = await resolvePath(workspaceRoot, projectId, value);
  try {
    const target = await stat(resolved);
    if (target.isDirectory()) return join(resolved, `${batchId}.${extension}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolved;
}

function phraseConfirmationForRole(role: "T" | "E" | "P" = "E"): string {
  return role === "T" ? "2" : "3";
}

function phraseModifiedAt(updatedAt?: string): string | undefined {
  if (!updatedAt) return undefined;
  const ms = Date.parse(updatedAt);
  return Number.isFinite(ms) ? String(ms) : undefined;
}

function phraseWrites(segments: BatchSegment[], role: "T" | "E" | "P" = "E"): PhraseTargetWrite[] {
  return segments
    .filter((segment) => !segment.locked && Boolean(segment.updatedAt))
    .map((segment) => {
      const targetChanged = segment.originalTarget === undefined ? true : segment.target !== segment.originalTarget;
      return {
        id: segment.id,
        target: segment.target,
        rawSource: segment.rawSource,
        richSource: segment.source,
        targetChanged,
        nativeConfirmed: segment.status === "confirmed" ? phraseConfirmationForRole(role) : undefined,
        modifiedAt: phraseModifiedAt(segment.updatedAt),
        levelEdited: targetChanged ? "true" : undefined,
      };
    });
}

function docxWrites(segments: BatchSegment[]): Array<{ id: string; target: string }> {
  return segments.filter((segment) => !segment.locked).map((segment) => ({
    id: segment.id,
    target: dehydratePhraseTarget(segment.target, segment.rawSource, segment.source),
  }));
}

function sdlxliffWrites(segments: BatchSegment[]): Array<{ id: string; target: string }> {
  return segments.map((segment) => ({
    id: segment.id,
    target: segment.target,
  }));
}

function mqxliffWrites(segments: BatchSegment[]): MqxliffTargetWrite[] {
  return segments.map((segment) => ({
    id: segment.id,
    target: segment.target,
  }));
}

function plainWrites(segments: BatchSegment[]): Array<{ id: string; target: string }> {
  return segments.map((segment) => ({
    id: segment.id,
    target: segment.target,
  }));
}

function confirmationForRole(role: "T" | "E" | "P" = "T"): SdlxliffConfirmationLevel {
  if (role === "P") return "ApprovedSignOff";
  if (role === "E") return "ApprovedTranslation";
  return "Translated";
}

export function exportAuditPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "exports", "export_audit.jsonl");
}

function targetSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deliveredTargetAuditRows(segments: BatchSegment[]): ExportAuditRecord["deliveredTargets"] {
  return segments.map((segment) => ({
    segmentId: segment.id,
    targetSha256: targetSha256(segment.target),
    targetBytes: Buffer.byteLength(segment.target, "utf8"),
  }));
}

async function appendExportAudit(
  workspaceRoot: string,
  batch: Awaited<ReturnType<typeof readBatch>>,
  result: ExportResult,
  options: { force?: boolean; role?: "T" | "E" | "P"; templateDocxPath?: string } = {},
): Promise<{ auditId: string; path: string }> {
  const exportedAt = new Date().toISOString();
  const auditId = `${exportedAt.replace(/[:.]/g, "-")}_${result.format}_${result.batchId}`;
  const record: ExportAuditRecord = {
    schemaVersion: 1,
    auditId,
    exportedAt,
    projectId: result.projectId,
    batchId: result.batchId,
    format: result.format,
    outputPath: result.outputPath,
    sourceFile: batch.sourceFile,
    masterFile: batch.masterFile,
    updatedSegments: result.updatedSegments,
    missingIds: result.missingIds,
    deliveryStatus: result.delivery.status,
    rulesDigest: result.delivery.rulesDigest,
    activeProjectRuleCount: result.delivery.activeProjectRuleCount,
    candidateRuleCount: result.delivery.candidateRuleCount,
    blockerCodes: result.delivery.blockers.map((issue) => issue.code),
    warningCodes: result.delivery.warnings.map((issue) => issue.code),
    deliveredTargets: deliveredTargetAuditRows(batch.segments),
    force: Boolean(options.force),
    role: options.role,
    templateDocxPath: options.templateDocxPath,
  };
  const path = exportAuditPath(workspaceRoot, result.projectId);
  const persistence = catGovernancePersistenceFor(workspaceRoot);
  if (persistence) await persistence.appendExportAudit(result.projectId, record);
  else {
    await assertCatGovernanceLegacyAllowed(workspaceRoot);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  }
  return { auditId, path };
}

export async function readExportAuditRecords(
  workspaceRoot: string,
  projectId: string,
  batchId?: string,
): Promise<ExportAuditRecord[]> {
  const persistence = catGovernancePersistenceFor(workspaceRoot);
  if (persistence) return persistence.readExportAudits(projectId, batchId);
  const cached = await readCatGovernanceReadCache<ExportAuditRecord[]>(workspaceRoot, "export-audit", projectId);
  if (cached) return (batchId ? cached.filter((record) => record.batchId === batchId) : cached).sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
  await assertCatGovernanceLegacyAllowed(workspaceRoot);
  const path = exportAuditPath(workspaceRoot, projectId);
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: ExportAuditRecord[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as ExportAuditRecord;
      if (!batchId || record.batchId === batchId) records.push(record);
    } catch (error) {
      throw new Error(`Invalid export audit JSONL at ${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return records.sort((a, b) => b.exportedAt.localeCompare(a.exportedAt));
}

// ── H3: post-write round-trip verification ─────────────────────────────────────
// The pre-export delivery gate checks tag signatures against batch.json. These
// helpers re-parse the EMITTED file bytes and confirm each translated segment's
// target inline-tag + placeholder signature still matches its source, catching
// any dehydrate/serialization corruption that batch.json checks cannot see. The
// deliverable is verified BEFORE it is written, so a known-corrupt file is never
// emitted (override only with force=true).

function verifyPhraseMxliffRoundTrip(originalContent: string, outputContent: string): string[] {
  // Post-export STRUCTURAL integrity on the emitted bytes (representation-safe, no master
  // context needed, no false positives): re-parse the original source and the emitted output
  // and confirm serialization did not (a) drop or add a trans-unit, or (b) mutate any source
  // column (we only write targets). Source-vs-target tag equality is NOT asserted — a Phrase
  // translation legitimately reshapes formatting relative to source, and the meaningful
  // tag-signature check already runs pre-export in the delivery gate on the working form.
  const before = parsePhraseMxliff(originalContent);
  const after = parsePhraseMxliff(outputContent);
  const afterById = new Map(after.segments.map((segment) => [segment.id, segment]));
  const mismatches: string[] = [];
  if (before.segments.length !== after.segments.length) {
    mismatches.push(`segment-count ${before.segments.length}->${after.segments.length}`);
  }
  for (const segment of before.segments) {
    const out = afterById.get(segment.id);
    if (!out) {
      mismatches.push(`${segment.id} (dropped)`);
      continue;
    }
    if (out.source !== segment.source) mismatches.push(`${segment.id} (source mutated)`);
  }
  return mismatches;
}

function verifySdlxliffRoundTrip(content: string): string[] {
  const parsed = parseSdlxliff(content);
  const mismatches: string[] = [];
  for (const segment of parsed.segments) {
    if (segment.locked || !segment.target.trim() || !segment.sourceTags.length) continue;
    const expected = sdlxliffInlineTagSignatureFromTags(segment.sourceTags);
    const actual = sdlxliffInlineTagSignatureFromText(segment.target, segment.sourceTags);
    if (!sameSignature(expected, actual)) mismatches.push(segment.id);
  }
  return mismatches;
}

function verifyMqxliffRoundTrip(content: string): string[] {
  const parsed = parseMqxliff(content);
  const mismatches: string[] = [];
  for (const segment of parsed.segments) {
    if (segment.locked || !segment.target.trim() || !segment.sourceTags.length) continue;
    const expected = mqxliffInlineTagSignatureFromTags(segment.sourceTags);
    const actual = mqxliffInlineTagSignatureFromText(segment.target, segment.sourceTags);
    if (!sameSignature(expected, actual)) mismatches.push(segment.id);
  }
  return mismatches;
}

function assertExportRoundTrip(format: string, mismatches: string[], force?: boolean): void {
  if (!mismatches.length || force) return;
  throw new Error(
    `Post-export ${format} round-trip verification failed: ${mismatches.length} emitted segment(s) have target tag/placeholder signatures that differ from source ` +
      `(${mismatches.slice(0, 10).join(", ")}${mismatches.length > 10 ? ", ..." : ""}). The deliverable was NOT written — this indicates serialization/dehydrate corruption. ` +
      `Pass force=true only to override.`,
  );
}

async function assertDeliveryExportAllowed(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  force?: boolean,
): Promise<{ delivery: DeliveryReport; authorization: Awaited<ReturnType<typeof authorizeQualityLedgerExport>> }> {
  const [delivery, quality] = await Promise.all([
    runDeliveryCheck(workspaceRoot, projectId, batchId),
    runQualityAudit(workspaceRoot, projectId, batchId),
  ]);
  const scopedDelivery = [...delivery.blockers, ...delivery.warnings].flatMap((issue) =>
    (issue.segmentIds.length ? issue.segmentIds : [undefined]).map((segmentId) => ({ issue, segmentId, findingId: deliveryRiskFindingId(issue.code, segmentId) }))
  );
  const openQuality = quality.findings.filter((finding) => finding.status === "open");
  // Informational diagnostics remain visible in the canonical ledger, but do
  // not require a waiver to authorize export. Blockers and warnings do.
  const decisionQuality = openQuality.filter((finding) => finding.authority !== "delivery_signature" && finding.severity !== "info");
  const recordedAt = new Date().toISOString();
  const events: Array<QualityDecisionLedgerInput & { logicalEventId: string }> = [
    ...scopedDelivery.map(({ issue, segmentId, findingId }) => ({
      projectId,
      batchId,
      segmentId,
      findingId,
      code: issue.code,
      severity: issue.severity === "blocker" ? "blocker" as const : "warning" as const,
      kind: "delivery_finding" as const,
      decision: "open" as const,
      reason: issue.message,
      evidenceRefs: [`delivery:${issue.code}`],
      actor: "deterministic_delivery_check",
      recordedAt,
      logicalEventId: `delivery-finding:${createHash("sha256").update(JSON.stringify([projectId, batchId, findingId, issue.severity, issue.message])).digest("hex")}`,
    })),
    ...qualityAuditFindingLedgerEvents(quality),
  ];
  await appendQualityDecisionLedgerOnce(workspaceRoot, events);
  const blockerFindingIds = [
    ...scopedDelivery.filter(({ issue }) => issue.severity === "blocker").map(({ findingId }) => findingId),
    ...decisionQuality.filter((finding) => finding.severity === "blocker").map((finding) => finding.id),
  ];
  const unreviewedFindingIds = [...scopedDelivery.map(({ findingId }) => findingId), ...decisionQuality.map((finding) => finding.id)];
  const authorization = await authorizeQualityLedgerExport(workspaceRoot, { projectId, batchId, blockerFindingIds, unreviewedFindingIds });
  if (!authorization.authorized && !force) {
    throw new Error(
      `Quality decision ledger blocked export: ${authorization.blockers.length} blocker(s) and ${authorization.unreviewedFindingIds.length} unreviewed finding(s) remain. ` +
      "Do not retry the same export until every finding is fixed or explicitly reviewed. Pass force=true only for explicit emergency export.",
    );
  }
  return { delivery, authorization };
}

export async function exportPhraseMxliff(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; outputPath?: string; force?: boolean; role?: "T" | "E" | "P" },
): Promise<ExportResult> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  if (batch.format !== "phrase_mxliff") {
    throw new Error(`Batch ${options.batchId} is ${batch.format}; export_phrase_mxliff requires a Phrase MXLIFF batch.`);
  }
  const { delivery, authorization } = await assertDeliveryExportAllowed(workspaceRoot, options.projectId, options.batchId, options.force);

  const outputPath = await resolveExportOutputPath(workspaceRoot, options.projectId, options.batchId, "mxliff", options.outputPath);
  const original = await import("node:fs/promises").then(({ readFile }) => readFile(batch.sourceFile, "utf8"));
  const writes = phraseWrites(batch.segments, options.role ?? "E");
  const result = writePhraseMxliffTargetsWithReport(original, writes);
  if (result.missingIds.length && !options.force) {
    throw new Error(
      `Phrase MXLIFF source is missing ${result.missingIds.length} segment ids from batch ${options.batchId}. Use the original MXLIFF imported for this batch, or pass force=true only if you accept a partial export.`,
    );
  }
  assertExportRoundTrip("Phrase MXLIFF", verifyPhraseMxliffRoundTrip(original, result.content), options.force);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.content, "utf8");
  const exportResult: ExportResult = {
    projectId: options.projectId,
    batchId: options.batchId,
    format: "phrase_mxliff",
    outputPath,
    updatedSegments: result.updatedIds.length,
    missingIds: result.missingIds,
    delivery,
    authorization,
  };
  const audit = await appendExportAudit(workspaceRoot, batch, exportResult, { force: options.force, role: options.role ?? "E" });
  return { ...exportResult, auditId: audit.auditId, auditPath: audit.path };
}

export async function exportPhraseBilingualDocx(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; templateDocxPath: string; outputPath?: string; force?: boolean },
): Promise<ExportResult> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  if (batch.format !== "phrase_mxliff") {
    throw new Error(`Batch ${options.batchId} is ${batch.format}; export_phrase_docx requires a Phrase MXLIFF batch.`);
  }
  const { delivery, authorization } = await assertDeliveryExportAllowed(workspaceRoot, options.projectId, options.batchId, options.force);

  const templatePath = await resolvePath(workspaceRoot, options.projectId, options.templateDocxPath);
  const outputPath = await resolveExportOutputPath(
    workspaceRoot,
    options.projectId,
    options.batchId,
    basename(templatePath).toLowerCase().endsWith(".docx") ? "docx" : "phrase.docx",
    options.outputPath,
  );
  const writes = docxWrites(batch.segments);
  const result = await writePhraseBilingualDocxTargets(templatePath, writes);
  if (result.missingIds.length && !options.force) {
    throw new Error(
      `Phrase DOCX template is missing ${result.missingIds.length} segment ids from batch ${options.batchId}. Use the DOCX exported from the same Phrase batch, or pass force=true only if you accept a partial export.`,
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.buffer);
  const exportResult: ExportResult = {
    projectId: options.projectId,
    batchId: options.batchId,
    format: "phrase_bilingual_docx",
    outputPath,
    updatedSegments: result.updatedIds.length,
    missingIds: result.missingIds,
    delivery,
    authorization,
  };
  const audit = await appendExportAudit(workspaceRoot, batch, exportResult, {
    force: options.force,
    templateDocxPath: templatePath,
  });
  return { ...exportResult, auditId: audit.auditId, auditPath: audit.path };
}

export async function exportMqxliff(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; outputPath?: string; force?: boolean; role?: "T" | "E" | "P" },
): Promise<ExportResult> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  if (batch.format !== "mqxliff") {
    throw new Error(`Batch ${options.batchId} is ${batch.format}; export_mqxliff requires a memoQ MQXLIFF batch.`);
  }
  const { delivery, authorization } = await assertDeliveryExportAllowed(workspaceRoot, options.projectId, options.batchId, options.force);

  const outputPath = await resolveExportOutputPath(workspaceRoot, options.projectId, options.batchId, "mqxliff", options.outputPath);
  const original = await readFile(batch.sourceFile, "utf8");
  const result = writeMqxliffTargets(original, mqxliffWrites(batch.segments));
  if (result.missingIds.length && !options.force) {
    throw new Error(
      `MQXLIFF source is missing ${result.missingIds.length} segment ids from batch ${options.batchId}. Use the original MQXLIFF imported for this batch, or pass force=true only if you accept a partial export.`,
    );
  }
  assertExportRoundTrip("MQXLIFF", verifyMqxliffRoundTrip(result.content), options.force);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.content, "utf8");
  const exportResult: ExportResult = {
    projectId: options.projectId,
    batchId: options.batchId,
    format: "mqxliff",
    outputPath,
    updatedSegments: result.updatedIds.length,
    missingIds: result.missingIds,
    delivery,
    authorization,
  };
  const audit = await appendExportAudit(workspaceRoot, batch, exportResult, { force: options.force, role: options.role });
  return { ...exportResult, auditId: audit.auditId, auditPath: audit.path };
}

export async function exportSdlxliff(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; outputPath?: string; force?: boolean; role?: "T" | "E" | "P" },
): Promise<ExportResult> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  if (batch.format !== "sdlxliff") {
    throw new Error(`Batch ${options.batchId} is ${batch.format}; export_sdlxliff requires an SDLXLIFF batch.`);
  }
  const { delivery, authorization } = await assertDeliveryExportAllowed(workspaceRoot, options.projectId, options.batchId, options.force);

  const outputPath = await resolveExportOutputPath(workspaceRoot, options.projectId, options.batchId, "sdlxliff", options.outputPath);
  const original = await import("node:fs/promises").then(({ readFile }) => readFile(batch.sourceFile, "utf8"));
  const confirmationLevel = confirmationForRole(options.role ?? "T");
  // M6: E/P sign-off may only force-confirm segments LA actually reviewed
  // (an explicit segment write sets updatedAt), never untouched rows that merely
  // already match the source file.
  const reviewedIds = batch.segments.filter((segment) => Boolean(segment.updatedAt)).map((segment) => segment.id);
  const result = writeSdlxliffTargets(original, sdlxliffWrites(batch.segments), {
    confirmationLevel,
    forceConfirmation: options.role === "E" || options.role === "P",
    confirmableIds: reviewedIds,
  });
  if (result.missingIds.length && !options.force) {
    throw new Error(
      `SDLXLIFF source is missing ${result.missingIds.length} segment ids from batch ${options.batchId}. Use the original SDLXLIFF imported for this batch, or pass force=true only if you accept a partial export.`,
    );
  }
  assertExportRoundTrip("SDLXLIFF", verifySdlxliffRoundTrip(result.content), options.force);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.content, "utf8");
  const exportResult: ExportResult = {
    projectId: options.projectId,
    batchId: options.batchId,
    format: "sdlxliff",
    outputPath,
    updatedSegments: result.updatedIds.length + result.forcedConfirmationIds.length,
    missingIds: result.missingIds,
    delivery,
    authorization,
  };
  const audit = await appendExportAudit(workspaceRoot, batch, exportResult, { force: options.force, role: options.role });
  return { ...exportResult, auditId: audit.auditId, auditPath: audit.path };
}

export async function exportGenericXliff(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; outputPath?: string; force?: boolean },
): Promise<ExportResult> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  if (batch.format !== "xliff_1_2" && batch.format !== "xliff_2_0") {
    throw new Error(`Batch ${options.batchId} is ${batch.format}; export_xliff requires a generic XLIFF batch.`);
  }
  const { delivery, authorization } = await assertDeliveryExportAllowed(workspaceRoot, options.projectId, options.batchId, options.force);
  const ext = batch.sourceFile.toLowerCase().endsWith(".xlf") ? "xlf" : "xliff";
  const outputPath = await resolveExportOutputPath(workspaceRoot, options.projectId, options.batchId, ext, options.outputPath);
  const result = writeGenericXliffTargets(await readFile(batch.sourceFile, "utf8"), plainWrites(batch.segments));
  if (result.missingIds.length && !options.force) {
    throw new Error(`Generic XLIFF source is missing ${result.missingIds.length} segment ids from batch ${options.batchId}.`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.content, "utf8");
  const exportResult: ExportResult = {
    projectId: options.projectId,
    batchId: options.batchId,
    format: "xliff",
    outputPath,
    updatedSegments: result.updatedIds.length,
    missingIds: result.missingIds,
    delivery,
    authorization,
  };
  const audit = await appendExportAudit(workspaceRoot, batch, exportResult, { force: options.force });
  return { ...exportResult, auditId: audit.auditId, auditPath: audit.path };
}

export async function exportCsvBatch(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; outputPath?: string; force?: boolean },
): Promise<ExportResult> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  if (batch.format !== "csv_paste") {
    throw new Error(`Batch ${options.batchId} is ${batch.format}; export_csv requires a CSV batch.`);
  }
  const { delivery, authorization } = await assertDeliveryExportAllowed(workspaceRoot, options.projectId, options.batchId, options.force);
  const outputPath = await resolveExportOutputPath(workspaceRoot, options.projectId, options.batchId, "csv", options.outputPath);
  const result = writeTableCsvTargets(await readFile(batch.sourceFile, "utf8"), plainWrites(batch.segments));
  if (result.missingIds.length && !options.force) throw new Error(`CSV source is missing ${result.missingIds.length} segment ids from batch ${options.batchId}.`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.content, "utf8");
  const exportResult: ExportResult = {
    projectId: options.projectId,
    batchId: options.batchId,
    format: "csv",
    outputPath,
    updatedSegments: result.updatedIds.length,
    missingIds: result.missingIds,
    delivery,
    authorization,
  };
  const audit = await appendExportAudit(workspaceRoot, batch, exportResult, { force: options.force });
  return { ...exportResult, auditId: audit.auditId, auditPath: audit.path };
}

export async function exportXlsxBatch(
  workspaceRoot: string,
  options: { projectId: string; batchId: string; outputPath?: string; force?: boolean },
): Promise<ExportResult> {
  const batch = await readBatch(workspaceRoot, options.projectId, options.batchId);
  if (batch.format !== "xlsx_paste") {
    throw new Error(`Batch ${options.batchId} is ${batch.format}; export_xlsx requires an XLSX batch.`);
  }
  const { delivery, authorization } = await assertDeliveryExportAllowed(workspaceRoot, options.projectId, options.batchId, options.force);
  const outputPath = await resolveExportOutputPath(workspaceRoot, options.projectId, options.batchId, "xlsx", options.outputPath);
  const result = await writeXlsxTargets(batch.sourceFile, outputPath, plainWrites(batch.segments));
  if (result.missingIds.length && !options.force) throw new Error(`XLSX source is missing ${result.missingIds.length} segment ids from batch ${options.batchId}.`);
  const exportResult: ExportResult = {
    projectId: options.projectId,
    batchId: options.batchId,
    format: "xlsx",
    outputPath,
    updatedSegments: result.updatedIds.length,
    missingIds: result.missingIds,
    delivery,
    authorization,
  };
  const audit = await appendExportAudit(workspaceRoot, batch, exportResult, { force: options.force });
  return { ...exportResult, auditId: audit.auditId, auditPath: audit.path };
}
