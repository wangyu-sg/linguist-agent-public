import { createHash, randomUUID } from "node:crypto";
import { readBatch, type BatchSegment } from "./batch_workspace.js";
import { glossaryPath, type GlossaryEntry } from "./glossary.js";
import { readPreferredTermbaseEntries } from "./termbase.js";
import { readJsonFile, workspacePath, writeJsonFile, createWorkspace } from "./workspace.js";
import { appendQualityDecisionLedgerOnce, type QualityDecisionLedgerInput } from "./quality_decision_ledger.js";
import { findMechanicalTextQaIssues, type MechanicalTextQaCode, type MechanicalTextQaOptions } from "./mechanical_text_qa.js";
import { findQualityChecklistIssues, readQualityChecklist, type QualityChecklistDocument } from "./quality_checklist.js";
import { compareFormattingSignatures } from "./format_signatures.js";
import { readProjectTagRuleContext } from "./tag_rules.js";
import type { ProjectTagRuleContext } from "./tag_rules_core.js";
import { numberQaTokens } from "./number_qa.js";
import { checkSpelling, type SpellingQaCoverage } from "./spelling_qa.js";
import { createTmStore, effectiveTmAuthority } from "./tm.js";

export interface DeliveryQaSegment {
  id: string;
  source: string;
  target: string;
  originalTarget?: string;
  rawTarget?: string;
  locked?: boolean;
}

export interface DeliveryQaReport {
  reportId: string;
  projectId: string;
  batchId?: string;
  workflowId?: string;
  generatedAt: string;
  spelling?: SpellingQaCoverage;
  findings: DeliveryQaFinding[];
  summary: { blockers: number; warnings: number; advisories: number };
}

export interface DeliveryQaFinding {
  id: string;
  type: string;
  severity: "blocker" | "warning" | "advisory";
  segmentId?: string;
  source?: string;
  target?: string;
  message: string;
  evidence: string[];
  relatedSegmentIds?: string[];
}

export interface DeliveryQaPreferredTerm {
  source: string;
  target: string;
  srcLang?: string;
  tgtLang?: string;
  authority: "termbase" | "glossary";
  evidenceSource?: string;
}

export interface ReviewedDeliveryQaFinding extends DeliveryQaFinding {
  reviewDecision: "fix_required" | "ignore_with_reason" | "query" | "accepted_risk";
  reviewReason: string;
  reviewedBy: "lead_linguist" | "user";
}

export interface ReviewedDeliveryQaReport {
  reportId: string;
  reviewedAt: string;
  rawReport: DeliveryQaReport;
  findings: ReviewedDeliveryQaFinding[];
}

export interface DeliveryQaReviewDecision {
  findingId: string;
  reviewDecision: ReviewedDeliveryQaFinding["reviewDecision"];
  reviewReason: string;
  reviewedBy: ReviewedDeliveryQaFinding["reviewedBy"];
}

const DELIVERY_QA_REVIEW_DECISIONS: ReadonlySet<ReviewedDeliveryQaFinding["reviewDecision"]> = new Set([
  "fix_required",
  "ignore_with_reason",
  "query",
  "accepted_risk",
]);

const DELIVERY_QA_REVIEWERS: ReadonlySet<ReviewedDeliveryQaFinding["reviewedBy"]> = new Set([
  "lead_linguist",
  "user",
]);

export function parseDeliveryQaReviewDecisions(value: unknown): DeliveryQaReviewDecision[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("decisions must be an array.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`decisions[${index}] must be an object.`);
    const raw = item as Record<string, unknown>;
    if (typeof raw.findingId !== "string" || !raw.findingId.trim()) throw new Error(`decisions[${index}].findingId is required.`);
    if (typeof raw.reviewDecision !== "string" || !DELIVERY_QA_REVIEW_DECISIONS.has(raw.reviewDecision as ReviewedDeliveryQaFinding["reviewDecision"])) {
      throw new Error(`decisions[${index}].reviewDecision is invalid.`);
    }
    if (typeof raw.reviewReason !== "string" || !raw.reviewReason.trim()) throw new Error(`decisions[${index}].reviewReason is required.`);
    if (typeof raw.reviewedBy !== "string" || !DELIVERY_QA_REVIEWERS.has(raw.reviewedBy as ReviewedDeliveryQaFinding["reviewedBy"])) {
      throw new Error(`decisions[${index}].reviewedBy is invalid.`);
    }
    return {
      findingId: raw.findingId,
      reviewDecision: raw.reviewDecision as ReviewedDeliveryQaFinding["reviewDecision"],
      reviewReason: raw.reviewReason,
      reviewedBy: raw.reviewedBy as ReviewedDeliveryQaFinding["reviewedBy"],
    };
  });
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizeStrict(value: string): string {
  return normalizeText(value).normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "");
}

function emails(value: string): string[] {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
}

function urls(value: string): string[] {
  return value.match(/https?:\/\/[^\s)]+/gi) ?? [];
}

function alphanumericTokens(value: string): string[] {
  return value.match(/[A-Za-z]+[A-Za-z0-9_-]*\d+[A-Za-z0-9_-]*|\d+[A-Za-z][A-Za-z0-9_-]*/g) ?? [];
}

function splitTopLevel(value: string, delimiter: string, limit: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (char === delimiter && depth === 0 && out.length < limit - 1) {
      out.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out;
}

function matchingBrace(value: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === "{") depth += 1;
    if (value[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function icuBranchBodies(body: string): Array<{ key: string; value: string }> {
  const rows: Array<{ key: string; value: string }> = [];
  let index = 0;
  while (index < body.length) {
    while (/\s/.test(body[index] ?? "")) index += 1;
    const keyStart = index;
    while (index < body.length && !/[\s{]/.test(body[index])) index += 1;
    const key = body.slice(keyStart, index).trim().toLowerCase();
    while (/\s/.test(body[index] ?? "")) index += 1;
    if (!key || body[index] !== "{") {
      index += 1;
      continue;
    }
    const close = matchingBrace(body, index);
    if (close < 0) break;
    rows.push({ key, value: body.slice(index + 1, close) });
    index = close + 1;
  }
  return rows;
}

function icuSignatures(value: string): string[] {
  const signatures: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "{") continue;
    const close = matchingBrace(value, index);
    if (close < 0) break;
    const content = value.slice(index + 1, close);
    const [argument, rawType, body] = splitTopLevel(content, ",", 3);
    const type = rawType?.trim().toLowerCase();
    if (argument && type && body && ["plural", "select", "selectordinal"].includes(type)) {
      const branches = icuBranchBodies(body);
      signatures.push(`${argument.trim()}:${type}:${branches.map((branch) => branch.key).join("|")}`);
      for (const branch of branches) signatures.push(...icuSignatures(branch.value).map((signature) => `${argument.trim()}/${branch.key}/${signature}`));
    }
    index = close;
  }
  return signatures;
}

function hasFullwidthPunctuation(value: string): boolean {
  // Bracket-like glyphs such as 【Activate】 are often deliberate game UI
  // wrappers. Prose punctuation is the high-signal zh->en leakage check.
  return /[，。！？；：、（）]/u.test(value);
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameMultiset(left: string[], right: string[]): boolean {
  return sameList([...left].sort(), [...right].sort());
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function localeBase(value: string | undefined): string | undefined {
  return value?.trim().toLocaleLowerCase().split("-", 1)[0] || undefined;
}

function langCompatible(value: string | undefined, expected: string | undefined): boolean {
  if (!value || !expected) return true;
  return value.toLocaleLowerCase().split("-", 1)[0] === expected.toLocaleLowerCase().split("-", 1)[0];
}

function sourceContainsTerm(source: string, term: string): boolean {
  const normalizedSource = normalizeStrict(source);
  const normalizedTerm = normalizeStrict(term);
  return Boolean(normalizedSource && normalizedTerm.length > 1 && normalizedSource.includes(normalizedTerm));
}

function targetContainsTerm(target: string, expected: string): boolean {
  const normalizedTarget = normalizeText(target);
  const normalizedExpected = normalizeText(expected);
  return Boolean(normalizedTarget && normalizedExpected && normalizedTarget.includes(normalizedExpected));
}

function fingerprint(parts: string[]): string {
  return createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 10);
}

function finding(input: Omit<DeliveryQaFinding, "id">): DeliveryQaFinding {
  return {
    ...input,
    id: `dqa:${input.segmentId ?? "batch"}:${input.type}:${fingerprint([input.source ?? "", input.target ?? "", input.message])}`,
  };
}

function addListMismatch(
  out: DeliveryQaFinding[],
  type: string,
  label: string,
  sourceList: string[],
  targetList: string[],
  segment: DeliveryQaSegment,
  severity: DeliveryQaFinding["severity"] = "blocker",
  orderSensitive = true,
): void {
  if ((orderSensitive ? sameList : sameMultiset)(sourceList, targetList)) return;
  out.push(finding({
    type,
    severity,
    segmentId: segment.id,
    source: segment.source,
    target: segment.target,
    message: `${label} mismatch: source=[${sourceList.join(", ")}] target=[${targetList.join(", ")}].`,
    evidence: [`source:${sourceList.join("|")}`, `target:${targetList.join("|")}`],
  }));
}

export function runDeliveryQaOnSegments(input: {
  projectId: string;
  batchId?: string;
  workflowId?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: DeliveryQaSegment[];
  preferredTerms?: DeliveryQaPreferredTerm[];
  spellingAllowedTerms?: readonly string[];
  mechanicalOptions?: MechanicalTextQaOptions;
  qualityChecklist?: QualityChecklistDocument;
  ruleContext?: ProjectTagRuleContext;
  checkSuspiciousLengthRatio?: boolean;
}): DeliveryQaReport {
  const findings: DeliveryQaFinding[] = [];
  const preferredTerms = input.preferredTerms?.filter((entry) => entry.source.trim() && entry.target.trim()) ?? [];
  const sourceLocale = localeBase(input.sourceLanguage);
  const targetLocale = localeBase(input.targetLanguage);
  const checksCjkLeakage = sourceLocale === "zh" && targetLocale === "en";
  const ruleContext: ProjectTagRuleContext = input.ruleContext ?? {
    mode: "legacy_builtin",
    rulesDigest: "builtin",
    activeProjectRules: [],
    disabledBuiltinIds: [],
    candidateRuleCount: 0,
    disabledRuleCount: 0,
    trace: [],
  };

  for (const segment of input.segments) {
    if (segment.locked) continue;
    const source = segment.source.trim();
    const target = segment.target.trim();
    if (!target) {
      findings.push(finding({
        type: "missing_target",
        severity: "blocker",
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
        message: "Editable segment has no target.",
        evidence: ["target is empty"],
      }));
      continue;
    }
    if (checksCjkLeakage && hasCjk(target)) {
      findings.push(finding({
        type: "residual_cjk",
        severity: "warning",
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
        message: "Target still contains CJK characters.",
        evidence: ["target contains CJK"],
      }));
    }
    const formatting = compareFormattingSignatures(segment.source, segment.target, ruleContext, segment.originalTarget ?? segment.rawTarget);
    const placeholderMismatches = formatting.mismatches.filter((mismatch) => mismatch.kind === "placeholder");
    if (placeholderMismatches.length) {
      findings.push(finding({
        type: "placeholder_mismatch",
        severity: "blocker",
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
        message: "Placeholder signature differs between source and target.",
        evidence: placeholderMismatches.map((mismatch) => `${mismatch.code}:${JSON.stringify(mismatch.source)}->${JSON.stringify(mismatch.target)}`),
      }));
    }
    const tagMismatches = formatting.mismatches.filter((mismatch) => ["native_tag", "project_tag", "rich_text", "underline"].includes(mismatch.kind));
    if (tagMismatches.length) {
      findings.push(finding({
        type: "tag_mismatch",
        severity: "blocker",
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
        message: "Tag or rich-text signature differs between source and target.",
        evidence: tagMismatches.map((mismatch) => `${mismatch.code}:${JSON.stringify(mismatch.source)}->${JSON.stringify(mismatch.target)}`),
      }));
    }
    const sourceNumbers = numberQaTokens(segment.source);
    const sourceEmails = emails(segment.source);
    const sourceUrls = urls(segment.source);
    const sourceAlphanumeric = alphanumericTokens(segment.source);
    if (sourceNumbers.length) addListMismatch(findings, "number_mismatch", "Number", sourceNumbers, numberQaTokens(segment.target), segment, "warning", false);
    if (sourceEmails.length) addListMismatch(findings, "email_mismatch", "Email", sourceEmails, emails(segment.target), segment, "warning", false);
    if (sourceUrls.length) addListMismatch(findings, "url_mismatch", "URL", sourceUrls, urls(segment.target), segment, "warning", false);
    // Source-side identifiers are immutable evidence. Target-localized notation
    // such as “x1” or “2nd” is not a defect when the source had no identifier;
    // its numeric value is checked separately by the shared number signature.
    if (sourceAlphanumeric.length) addListMismatch(findings, "alphanumeric_mismatch", "Alphanumeric token", sourceAlphanumeric, alphanumericTokens(segment.target), segment, "warning", false);
    addListMismatch(findings, "icu_branch_mismatch", "ICU signature", icuSignatures(segment.source), icuSignatures(segment.target), segment);
    const newlineMismatches = formatting.mismatches.filter((mismatch) => mismatch.kind === "hard_newline" || mismatch.kind === "literal_newline");
    if (newlineMismatches.length) {
      findings.push(finding({
        type: "newline_mismatch",
        severity: "warning",
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
        message: "Source and target newline presence differs.",
        evidence: newlineMismatches.map((mismatch) => `${mismatch.code}:${JSON.stringify(mismatch.source)}->${JSON.stringify(mismatch.target)}`),
      }));
    }
    if (checksCjkLeakage && hasFullwidthPunctuation(segment.target)) {
      findings.push(finding({
        type: "fullwidth_punctuation",
        severity: "warning",
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
        message: "Target contains Chinese/fullwidth punctuation.",
        evidence: ["target contains Chinese/fullwidth punctuation"],
      }));
    }
    if (input.checkSuspiciousLengthRatio && source.length >= 10 && (target.length / source.length > 3 || target.length / source.length < 0.25)) {
      findings.push(finding({
        type: "suspicious_length_ratio",
        severity: "advisory",
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
        message: `Suspicious target length ratio: ${target.length}/${source.length}.`,
        evidence: [`sourceLength:${source.length}`, `targetLength:${target.length}`],
      }));
    }
    for (const term of preferredTerms) {
      if (!langCompatible(term.srcLang, input.sourceLanguage) || !langCompatible(term.tgtLang, input.targetLanguage)) continue;
      if (!sourceContainsTerm(segment.source, term.source) || targetContainsTerm(segment.target, term.target)) continue;
      findings.push(finding({
        type: term.authority === "glossary" ? "glossary_mismatch" : "terminology_mismatch",
        severity: term.authority === "glossary" ? "warning" : "blocker",
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
        message: `Source uses ${term.authority} entry "${term.source}" but target is missing "${term.target}".`,
        evidence: [term.evidenceSource ?? `${term.authority}:${term.source}->${term.target}`],
      }));
    }
  }

  const segmentsById = new Map(input.segments.map((segment) => [segment.id, segment]));
  const mechanicalType = (code: MechanicalTextQaCode): string => ({
    SOURCE_EQUALS_TARGET: "source_equals_target",
    SOURCE_TARGET_INCONSISTENCY: "inconsistent_target",
    TARGET_SOURCE_INCONSISTENCY: "duplicated_target",
    UNPAIRED_SYMBOL: "unpaired_symbol",
    UNPAIRED_QUOTE: "unpaired_quote",
    REPEATED_WORD: "repeated_word",
    DOUBLE_SPACE: "double_space",
    EDGE_WHITESPACE: "edge_whitespace",
    UPPERCASE_TOKEN_MISMATCH: "uppercase_token_mismatch",
    CAMELCASE_TOKEN_MISMATCH: "camelcase_token_mismatch",
  })[code];
  for (const issue of findMechanicalTextQaIssues(input.segments, input.mechanicalOptions)) {
    const segment = segmentsById.get(issue.segmentId)!;
    const severity: DeliveryQaFinding["severity"] = issue.code === "SOURCE_EQUALS_TARGET"
      ? checksCjkLeakage && hasCjk(segment.source) ? "blocker" : "warning"
      : ["TARGET_SOURCE_INCONSISTENCY", "UPPERCASE_TOKEN_MISMATCH", "CAMELCASE_TOKEN_MISMATCH", "EDGE_WHITESPACE"].includes(issue.code)
        ? "advisory"
        : "warning";
    findings.push(finding({
      type: mechanicalType(issue.code),
      severity,
      segmentId: issue.segmentId,
      source: segment.source,
      target: segment.target,
      message: issue.message,
      evidence: issue.evidence,
      relatedSegmentIds: issue.relatedSegmentIds,
    }));
  }
  if (input.qualityChecklist) {
    for (const issue of findQualityChecklistIssues(input.qualityChecklist, input.segments)) {
      const segment = segmentsById.get(issue.segmentId)!;
      findings.push(finding({
        type: "project_checklist",
        severity: issue.severity === "info" ? "advisory" : issue.severity,
        segmentId: issue.segmentId,
        source: segment.source,
        target: segment.target,
        message: issue.message,
        evidence: issue.evidence,
      }));
    }
  }

  const spelling = checkSpelling(input.segments, input.targetLanguage, [
    ...preferredTerms.map((term) => term.target),
    ...(input.spellingAllowedTerms ?? []),
  ]);
  for (const issue of spelling.issues) {
    const segment = segmentsById.get(issue.segmentId)!;
    findings.push(finding({
      type: "spelling",
      severity: "warning",
      segmentId: issue.segmentId,
      source: segment.source,
      target: segment.target,
      message: issue.message,
      evidence: issue.evidence,
    }));
  }

  return {
    reportId: `delivery-qa-${randomUUID()}`,
    projectId: input.projectId,
    batchId: input.batchId,
    workflowId: input.workflowId,
    generatedAt: new Date().toISOString(),
    spelling: spelling.coverage,
    findings,
    summary: {
      blockers: findings.filter((item) => item.severity === "blocker").length,
      warnings: findings.filter((item) => item.severity === "warning").length,
      advisories: findings.filter((item) => item.severity === "advisory").length,
    },
  };
}

export async function runDeliveryQaForScope(
  workspaceRoot: string,
  input: { projectId: string; batchId: string; workflowId?: string; segmentIds?: readonly string[] },
): Promise<DeliveryQaReport> {
  const [batch, termbaseTerms, glossaryEntries, qualityChecklist, ruleContext, tmEntries] = await Promise.all([
    readBatch(workspaceRoot, input.projectId, input.batchId),
    readPreferredTermbaseEntries(workspaceRoot, input.projectId),
    readJsonFile<GlossaryEntry[]>(glossaryPath(workspaceRoot, input.projectId), []),
    readQualityChecklist(workspaceRoot, input.projectId),
    readProjectTagRuleContext(workspaceRoot, input.projectId),
    createTmStore(createWorkspace(workspaceRoot, input.projectId)).list(),
  ]);
  const requested = input.segmentIds ? new Set(input.segmentIds) : undefined;
  const missing = requested ? [...requested].filter((segmentId) => !batch.segments.some((segment) => segment.id === segmentId)) : [];
  if (missing.length) throw new Error(`Delivery QA segment scope is stale: ${missing.join(", ")}.`);
  const segments = requested ? batch.segments.filter((segment) => requested.has(segment.id)) : batch.segments;
  const report = runDeliveryQaOnSegments({
    projectId: input.projectId,
    batchId: input.batchId,
    workflowId: input.workflowId,
    sourceLanguage: batch.sourceLanguage,
    targetLanguage: batch.targetLanguage,
    segments: segments.map((segment: BatchSegment) => ({
      id: segment.id,
      source: segment.source,
      target: segment.target,
      originalTarget: segment.originalTarget,
      rawTarget: segment.rawTarget,
      locked: segment.locked,
    })),
    preferredTerms: [
      ...termbaseTerms.map((term) => ({ ...term, authority: "termbase" as const, evidenceSource: `termbase:${term.source}->${term.target}` })),
      ...glossaryEntries.map((entry) => ({ source: entry.source, target: entry.target, authority: "glossary" as const, evidenceSource: `glossary:${entry.id}` })),
    ],
    spellingAllowedTerms: tmEntries
      .filter((entry) => effectiveTmAuthority(entry) === "reviewed_tm")
      .map((entry) => entry.target),
    mechanicalOptions: qualityChecklist.mechanicalOptions,
    qualityChecklist,
    ruleContext,
  });
  await writeJsonFile(workspacePath(createWorkspace(workspaceRoot, input.projectId), "delivery_qa", `${report.reportId}.json`), report);
  await appendQualityDecisionLedgerOnce(workspaceRoot, deliveryQaFindingLedgerEvents(report));
  return report;
}

export async function runDeliveryQa(workspaceRoot: string, projectId: string, batchId: string, workflowId?: string): Promise<DeliveryQaReport> {
  return runDeliveryQaForScope(workspaceRoot, { projectId, batchId, workflowId });
}

export async function readSavedDeliveryQaReport(workspaceRoot: string, projectId: string, reportId: string): Promise<DeliveryQaReport> {
  const workspace = createWorkspace(workspaceRoot, projectId);
  const report = await readJsonFile<DeliveryQaReport | null>(workspacePath(workspace, "delivery_qa", `${reportId}.json`), null);
  if (!report) throw new Error(`Delivery QA report ${reportId} not found.`);
  if (report.projectId !== projectId) throw new Error(`Delivery QA report ${reportId} project scope does not match ${projectId}.`);
  return report;
}

export function reviewDeliveryQaReport(report: DeliveryQaReport, decisions: DeliveryQaReviewDecision[]): ReviewedDeliveryQaReport {
  if (!decisions.length) throw new Error("Delivery QA review requires at least one decision.");
  const findings = new Map(report.findings.map((finding) => [finding.id, finding]));
  const seen = new Set<string>();
  const reviewedFindings = decisions.map((decision) => {
    if (!decision.reviewReason.trim()) throw new Error(`Delivery QA review decision ${decision.findingId} requires reviewReason.`);
    const finding = findings.get(decision.findingId);
    if (!finding) throw new Error(`Delivery QA review references unknown finding ${decision.findingId}.`);
    if (seen.has(decision.findingId)) throw new Error(`Delivery QA review repeats finding ${decision.findingId}.`);
    seen.add(decision.findingId);
    return {
      ...finding,
      reviewDecision: decision.reviewDecision,
      reviewReason: decision.reviewReason.trim(),
      reviewedBy: decision.reviewedBy,
    };
  });
  return {
    reportId: `${report.reportId}:reviewed`,
    reviewedAt: new Date().toISOString(),
    rawReport: report,
    findings: reviewedFindings,
  };
}

function deliveryQaLogicalEventId(kind: string, identity: unknown): string {
  return `${kind}:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function deliveryQaFindingLedgerEvents(report: DeliveryQaReport): Array<QualityDecisionLedgerInput & { logicalEventId: string }> {
  return report.findings.map((finding) => ({
    projectId: report.projectId,
    batchId: report.batchId,
    workflowId: report.workflowId,
    segmentId: finding.segmentId,
    findingId: finding.id,
    code: finding.type,
    severity: finding.severity,
    kind: "delivery_finding",
    decision: "open",
    reason: finding.message,
    evidenceRefs: finding.evidence,
    actor: "deterministic_delivery_qa",
    recordedAt: report.generatedAt,
    logicalEventId: deliveryQaLogicalEventId("delivery-finding", [report.projectId, report.batchId, report.workflowId, finding.id]),
  }));
}

export async function reviewSavedDeliveryQaReport(
  workspaceRoot: string,
  projectId: string,
  reportId: string,
  decisions: DeliveryQaReviewDecision[],
): Promise<ReviewedDeliveryQaReport> {
  const report = await readSavedDeliveryQaReport(workspaceRoot, projectId, reportId);
  const reviewed = reviewDeliveryQaReport(report, decisions);
  const events = deliveryQaFindingLedgerEvents(report);
  for (const finding of reviewed.findings) {
    events.push({
      projectId,
      batchId: report.batchId,
      workflowId: report.workflowId,
      segmentId: finding.segmentId,
      findingId: finding.id,
      kind: ["ignore_with_reason", "accepted_risk"].includes(finding.reviewDecision) ? "delivery_waiver" : "team_decision",
      decision: finding.reviewDecision,
      reason: finding.reviewReason,
      evidenceRefs: finding.evidence,
      actor: finding.reviewedBy,
      recordedAt: reviewed.reviewedAt,
      logicalEventId: deliveryQaLogicalEventId("delivery-qa-decision", [projectId, report.batchId, report.workflowId, report.reportId, finding.id, finding.reviewDecision, finding.reviewReason, finding.reviewedBy]),
    });
  }
  await appendQualityDecisionLedgerOnce(workspaceRoot, events);
  return reviewed;
}
