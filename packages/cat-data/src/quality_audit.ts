import { createHash } from "node:crypto";
import { readBatch, type BatchSegment } from "./batch_workspace.js";
import { compareFormattingSignatures, type FormattingSignatureComparison } from "./format_signatures.js";
import { readPreferredGlossaryEntries } from "./glossary.js";
import { readPreferredTermbaseEntries } from "./termbase.js";
import { createTmStore, effectiveTmAuthority, isHardExactTmAuthority, type TmEntry } from "./tm.js";
import { createWorkspace } from "./workspace.js";
import { readQualityFindingWaivers, upsertQualityFindingWaiver, type QualityFindingWaiver, type QualityFindingWaiverInput } from "./quality_waivers.js";
import { readProjectTagRuleContext } from "./tag_rules.js";
import type { ProjectTagRuleContext } from "./tag_rules_core.js";
import { readVoiceProfile, type VoiceProfile } from "./voice_profile.js";
import { appendQualityDecisionLedgerOnce, type QualityDecisionLedgerInput } from "./quality_decision_ledger.js";
import { findMechanicalTextQaIssues, type MechanicalTextQaCode, type MechanicalTextQaOptions } from "./mechanical_text_qa.js";
import { findQualityChecklistIssues, readQualityChecklist, type QualityChecklistDocument } from "./quality_checklist.js";
import { numberQaTokens } from "./number_qa.js";
import { checkSpelling, describeSpellingQaCoverage, type SpellingQaCoverage } from "./spelling_qa.js";

export type QualityAuditStatus = "pass" | "warn" | "fail";
export type QualityFindingSeverity = "blocker" | "warning" | "info";
export type QualityFindingCategory = "terminology" | "consistency" | "accuracy" | "style" | "formatting";
export type QualityFindingAuthority =
  | "termbase"
  | "glossary"
  | "reviewed_tm"
  | "working_tm"
  | "client_tm"
  | "imported_tm"
  | "batch_consistency"
  | "delivery_signature"
  | "spelling_dictionary";
export type QualityFindingConfidence = "high" | "medium" | "low";
export type QualityFindingStatus = "open" | "ignored";

export interface QualityFinding {
  id: string;
  batchId: string;
  segmentId: string;
  code:
    | "TERM_PREFERRED_MISSING"
    | "GLOSSARY_PREFERRED_MISSING"
    | "TM_EXACT_TARGET_MISMATCH"
    | "TM_EXACT_TARGET_CONFLICT"
    | "NATIVE_TAG_SIGNATURE_MISMATCH"
    | "PROJECT_TAG_SIGNATURE_MISMATCH"
    | "RICH_TEXT_SIGNATURE_MISMATCH"
    | "UNDERLINE_SIGNATURE_MISMATCH"
    | "PLACEHOLDER_SIGNATURE_MISMATCH"
    | "ICU_BRANCH_ARITY_MISMATCH"
    | "HARD_NEWLINE_MISMATCH"
    | "LITERAL_NEWLINE_MISMATCH"
    | "NUMBER_MISMATCH"
    | "DUPLICATE_TARGET_MISMATCH"
    | "TARGET_SOURCE_INCONSISTENCY"
    | "SOURCE_EQUALS_TARGET"
    | "UNPAIRED_SYMBOL"
    | "UNPAIRED_QUOTE"
    | "REPEATED_WORD"
    | "DOUBLE_SPACE"
    | "EDGE_WHITESPACE"
    | "UPPERCASE_TOKEN_MISMATCH"
    | "CAMELCASE_TOKEN_MISMATCH"
    | "PROJECT_CHECKLIST"
    | "SPELLING_UNKNOWN_WORD"
    | "TRANSLATIONESE_PATTERN"
    | "VOICE_INCONSISTENCY"
    | "REGISTER_MISMATCH";
  category: QualityFindingCategory;
  severity: QualityFindingSeverity;
  confidence: QualityFindingConfidence;
  authority: QualityFindingAuthority;
  status: QualityFindingStatus;
  source: string;
  target: string;
  message: string;
  expectedTarget?: string;
  sourceTerm?: string;
  evidenceSources: string[];
  ignoredReason?: string;
  ignoredAt?: string;
}

export interface QualityAuditSummary {
  checkedSegments: number;
  openBlockers: number;
  openWarnings: number;
  ignored: number;
  termbasePreferredMissing: number;
  glossaryPreferredMissing: number;
  tmExactTargetMismatches: number;
  tmExactTargetConflicts: number;
  formattingSignatureMismatches: number;
  numberMismatches: number;
  duplicateTargetMismatches: number;
  spellingUnknownWords: number;
  translationesePatterns: number;
  voiceInconsistencies: number;
  registerMismatches: number;
}

export interface QualityAuditReport {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  checkedAt: string;
  status: QualityAuditStatus;
  spelling: SpellingQaCoverage;
  summary: QualityAuditSummary;
  findings: QualityFinding[];
}

export function qualityAuditFindingLedgerEvents(report: QualityAuditReport): Array<QualityDecisionLedgerInput & { logicalEventId: string }> {
  return report.findings
    .filter((finding) => finding.status === "open")
    .map((finding) => ({
      projectId: report.projectId,
      batchId: report.batchId,
      segmentId: finding.segmentId,
      findingId: finding.id,
      code: finding.code,
      severity: finding.severity,
      kind: "quality_finding",
      decision: "open",
      reason: finding.message,
      evidenceRefs: finding.evidenceSources,
      actor: "deterministic_quality_audit",
      recordedAt: report.checkedAt,
      logicalEventId: `quality-finding:${createHash("sha256").update(JSON.stringify([report.projectId, report.batchId, finding.id, finding.severity, finding.message])).digest("hex")}`,
    }));
}

interface PreferredTerm {
  source: string;
  target: string;
  srcLang?: string;
  tgtLang?: string;
  note?: string;
  authority?: "termbase" | "glossary";
  evidenceSource?: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizeStrict(value: string): string {
  return normalizeText(value).replace(/[。！？、，；：,.;:!?'"“”‘’()[\]{}<>《》【】\s-]+/gu, "");
}

function stableFindingId(parts: string[]): string {
  const digest = createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 12);
  return `${parts[0]}:${parts[1]}:${digest}`;
}

function graphemeLength(value: string): number {
  return Array.from(value.trim()).length;
}

function termMatchConfidence(segmentSource: string, term: string): QualityFindingConfidence | undefined {
  const source = normalizeStrict(segmentSource);
  const normalizedTerm = normalizeStrict(term);
  if (!source || !normalizedTerm) return undefined;
  if (source === normalizedTerm) return "high";
  if (!source.includes(normalizedTerm)) return undefined;
  const length = graphemeLength(normalizedTerm);
  if (length <= 1) return undefined;
  if (length === 2) return "medium";
  return "high";
}

function termSeverity(confidence: QualityFindingConfidence): QualityFindingSeverity {
  return confidence === "high" ? "blocker" : "warning";
}

function targetContainsTerm(target: string, expected: string): boolean {
  const normalizedTarget = normalizeText(target);
  const normalizedExpected = normalizeText(expected);
  return Boolean(normalizedTarget && normalizedExpected && normalizedTarget.includes(normalizedExpected));
}

function targetEqualsExpected(target: string, expected: string): boolean {
  return normalizeText(target) === normalizeText(expected);
}

function langCompatible(value: string | undefined, expected: string | undefined): boolean {
  if (!value || !expected) return true;
  return value.toLocaleLowerCase().split("-", 1)[0] === expected.toLocaleLowerCase().split("-", 1)[0];
}

function evidenceForTerm(term: PreferredTerm): string {
  return term.evidenceSource ?? `${term.authority ?? "termbase"}:${term.source}->${term.target}`;
}

function tmAuthority(entry: TmEntry): QualityFindingAuthority {
  const authority = effectiveTmAuthority(entry);
  if (authority === "reviewed_tm" || authority === "working_tm" || authority === "client_tm" || authority === "imported_tm") return authority;
  return "imported_tm";
}

function tmAuthorityRank(entry: TmEntry): number {
  const authority = effectiveTmAuthority(entry);
  if (authority === "reviewed_tm") return 4;
  if (authority === "client_tm") return 3;
  if (authority === "imported_tm") return 2;
  if (entry.origin === "unknown") return 1;
  return 0;
}

function applyWaivers(findings: QualityFinding[], waivers: QualityFindingWaiver[]): QualityFinding[] {
  const byFindingId = new Map(waivers.map((waiver) => [`${waiver.batchId}:${waiver.findingId}`, waiver]));
  return findings.map((finding) => {
    const waiver = byFindingId.get(`${finding.batchId}:${finding.id}`);
    if (!waiver) return finding;
    return {
      ...finding,
      status: "ignored",
      ignoredReason: waiver.reason,
      ignoredAt: waiver.acceptedAt,
    };
  });
}

export function findQualityIssues(options: {
  batchId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: BatchSegment[];
  preferredTerms: PreferredTerm[];
  tmEntries: TmEntry[];
}): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const terms = options.preferredTerms.filter((entry) => entry.source.trim() && entry.target.trim());
  const usableTm = options.tmEntries.filter(
    (entry) => entry.source.trim() && entry.target.trim() && isHardExactTmAuthority(entry),
  );
  const exactTmBySource = new Map<string, TmEntry[]>();
  for (const entry of usableTm) {
    const key = normalizeText(entry.source);
    const bucket = exactTmBySource.get(key) ?? [];
    bucket.push(entry);
    exactTmBySource.set(key, bucket);
  }

  for (const segment of options.segments) {
    const target = segment.target ?? "";
    if (!target.trim()) continue;

    const matchedTerms = terms
      .map((term) => ({ term, normalized: normalizeStrict(term.source), confidence: termMatchConfidence(segment.source, term.source) }))
      .filter((item): item is { term: PreferredTerm; normalized: string; confidence: QualityFindingConfidence } => Boolean(item.confidence));
    const longestSpanMatches = matchedTerms.filter(
      (item) => !matchedTerms.some((other) => other.normalized.length > item.normalized.length && other.normalized.includes(item.normalized)),
    );
    for (const { term, confidence } of longestSpanMatches) {
      if (!langCompatible(term.srcLang, options.sourceLanguage) || !langCompatible(term.tgtLang, options.targetLanguage)) continue;
      if (targetContainsTerm(target, term.target)) continue;
      const severity = termSeverity(confidence);
      const authority = term.authority ?? "termbase";
      findings.push({
        id: stableFindingId([authority === "glossary" ? "GLOSSARY_PREFERRED_MISSING" : "TERM_PREFERRED_MISSING", segment.id, term.source, term.target]),
        batchId: options.batchId,
        segmentId: segment.id,
        code: authority === "glossary" ? "GLOSSARY_PREFERRED_MISSING" : "TERM_PREFERRED_MISSING",
        category: "terminology",
        severity,
        confidence,
        authority,
        status: "open",
        source: segment.source,
        target,
        sourceTerm: term.source,
        expectedTarget: term.target,
        message: `Source uses ${authority} entry "${term.source}" but target is missing preferred target "${term.target}".`,
        evidenceSources: [evidenceForTerm(term)],
      });
    }
    const satisfiedPreferredTerms = longestSpanMatches
      .map((item) => item.term)
      .filter(
        (term) =>
          langCompatible(term.srcLang, options.sourceLanguage) &&
          langCompatible(term.tgtLang, options.targetLanguage) &&
          targetContainsTerm(target, term.target),
      );

    const exactTm = (exactTmBySource.get(normalizeText(segment.source)) ?? [])
      .filter((entry) => langCompatible(entry.srcLang, options.sourceLanguage) && langCompatible(entry.tgtLang, options.targetLanguage))
      .sort((a, b) => tmAuthorityRank(b) - tmAuthorityRank(a) || (b.quality ?? 0) - (a.quality ?? 0));
    if (!exactTm.length) continue;
    const topRank = tmAuthorityRank(exactTm[0]);
    const authoritative = exactTm.filter((entry) => tmAuthorityRank(entry) === topRank);
    const distinctTargets = Array.from(new Map(authoritative.map((entry) => [normalizeText(entry.target), entry])).values());
    if (distinctTargets.length === 1) {
      const expected = distinctTargets[0];
      const overriddenByPreferredTerm = satisfiedPreferredTerms.some((term) => !targetContainsTerm(expected.target, term.target));
      if (!targetEqualsExpected(target, expected.target) && !overriddenByPreferredTerm) {
        findings.push({
          id: stableFindingId(["TM_EXACT_TARGET_MISMATCH", segment.id, expected.id, expected.target]),
          batchId: options.batchId,
          segmentId: segment.id,
          code: "TM_EXACT_TARGET_MISMATCH",
          category: "consistency",
          severity: "blocker",
          confidence: "high",
          authority: tmAuthority(expected),
          status: "open",
          source: segment.source,
          target,
          expectedTarget: expected.target,
          message: `Exact ${expected.origin} TM expects "${expected.target}" but target is "${target}".`,
          evidenceSources: [`tm:${expected.id}`],
        });
      }
    } else if (!distinctTargets.some((entry) => targetEqualsExpected(target, entry.target))) {
      const overriddenByPreferredTerm = satisfiedPreferredTerms.some(
        (term) => !distinctTargets.some((entry) => targetContainsTerm(entry.target, term.target)),
      );
      if (overriddenByPreferredTerm) continue;
      findings.push({
        id: stableFindingId(["TM_EXACT_TARGET_CONFLICT", segment.id, ...distinctTargets.map((entry) => entry.id)]),
        batchId: options.batchId,
        segmentId: segment.id,
        code: "TM_EXACT_TARGET_CONFLICT",
        category: "consistency",
        severity: "warning",
        confidence: "medium",
        authority: tmAuthority(distinctTargets[0]),
        status: "open",
        source: segment.source,
        target,
        message: `Exact TM has conflicting authoritative targets (${distinctTargets.map((entry) => `"${entry.target}"`).join(", ")}); current target matches none.`,
        evidenceSources: distinctTargets.map((entry) => `tm:${entry.id}`),
      });
    }
  }

  return findings;
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameMultiset(left: string[], right: string[]): boolean {
  return sameList([...left].sort(), [...right].sort());
}

function formattingSeverity(code: QualityFinding["code"]): QualityFindingSeverity {
  void code;
  // Delivery owns hard enforcement for tags/placeholders/ICU/newlines. Quality
  // mirrors the finding as a visible QA warning so the user sees one issue list
  // without requiring a second waiver for the same delivery risk.
  return "warning";
}

function formattingMessage(mismatch: FormattingSignatureComparison["mismatches"][number]): string {
  return `${mismatch.kind} signature mismatch: source=${JSON.stringify(mismatch.source)} target=${JSON.stringify(mismatch.target)}.`;
}

export function findMechanicalQualityIssues(options: {
  batchId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: BatchSegment[];
  ruleContext: ProjectTagRuleContext;
  qualityChecklist?: QualityChecklistDocument;
  mechanicalOptions?: MechanicalTextQaOptions;
}): QualityFinding[] {
  const findings: QualityFinding[] = [];
  for (const segment of options.segments) {
    const target = segment.target ?? "";
    if (!target.trim()) continue;

    const comparison = compareFormattingSignatures(segment.source, target, options.ruleContext, segment.originalTarget ?? segment.rawTarget);
    for (const mismatch of comparison.mismatches) {
      const code = mismatch.code as QualityFinding["code"];
      findings.push({
        id: stableFindingId([mismatch.code, segment.id, JSON.stringify(mismatch.source), JSON.stringify(mismatch.target)]),
        batchId: options.batchId,
        segmentId: segment.id,
        code,
        category: "formatting",
        severity: formattingSeverity(code),
        confidence: "high",
        authority: "delivery_signature",
        status: "open",
        source: segment.source,
        target,
        message: formattingMessage(mismatch),
        expectedTarget: JSON.stringify(mismatch.source),
        evidenceSources: [`format_signature:${mismatch.kind}`],
      });
    }

    const sourceNumbers = numberQaTokens(segment.source);
    const targetNumbers = numberQaTokens(target);
    if (sourceNumbers.length && !sameMultiset(sourceNumbers, targetNumbers)) {
      findings.push({
        id: stableFindingId(["NUMBER_MISMATCH", segment.id, sourceNumbers.join(","), targetNumbers.join(",")]),
        batchId: options.batchId,
        segmentId: segment.id,
        code: "NUMBER_MISMATCH",
        category: "accuracy",
        severity: "warning",
        confidence: "high",
        authority: "batch_consistency",
        status: "open",
        source: segment.source,
        target,
        message: `Number mismatch: source has ${sourceNumbers.join(", ")} but target has ${targetNumbers.join(", ") || "none"}.`,
        expectedTarget: sourceNumbers.join(", "),
        evidenceSources: ["number_signature"],
      });
    }
  }

  const segmentById = new Map(options.segments.map((segment) => [segment.id, segment]));
  const isZhToEn = options.sourceLanguage?.toLocaleLowerCase().startsWith("zh") && options.targetLanguage?.toLocaleLowerCase().startsWith("en");
  const codeFor = (code: MechanicalTextQaCode): QualityFinding["code"] => code === "SOURCE_TARGET_INCONSISTENCY"
    ? "DUPLICATE_TARGET_MISMATCH"
    : code;
  for (const issue of findMechanicalTextQaIssues(options.segments, options.mechanicalOptions)) {
    const segment = segmentById.get(issue.segmentId)!;
    const code = codeFor(issue.code);
    const category: QualityFindingCategory = ["SOURCE_TARGET_INCONSISTENCY", "TARGET_SOURCE_INCONSISTENCY"].includes(issue.code)
      ? "consistency"
      : ["UNPAIRED_SYMBOL", "UNPAIRED_QUOTE", "DOUBLE_SPACE", "EDGE_WHITESPACE", "UPPERCASE_TOKEN_MISMATCH", "CAMELCASE_TOKEN_MISMATCH"].includes(issue.code)
        ? "formatting"
        : "accuracy";
    const severity: QualityFindingSeverity = issue.code === "SOURCE_EQUALS_TARGET" && isZhToEn && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(segment.source)
      ? "blocker"
      : issue.code === "TARGET_SOURCE_INCONSISTENCY"
        ? "info"
        : "warning";
    findings.push({
      id: stableFindingId([code, segment.id, ...issue.relatedSegmentIds, ...issue.evidence]),
      batchId: options.batchId,
      segmentId: segment.id,
      code,
      category,
      severity,
      confidence: issue.code === "TARGET_SOURCE_INCONSISTENCY" ? "medium" : "high",
      authority: "batch_consistency",
      status: "open",
      source: segment.source,
      target: segment.target,
      message: issue.message,
      evidenceSources: issue.evidence,
    });
  }
  if (options.qualityChecklist) {
    for (const issue of findQualityChecklistIssues(options.qualityChecklist, options.segments)) {
      const segment = segmentById.get(issue.segmentId)!;
      findings.push({
        id: stableFindingId(["PROJECT_CHECKLIST", issue.checklistId, segment.id, issue.scope, issue.match]),
        batchId: options.batchId,
        segmentId: segment.id,
        code: "PROJECT_CHECKLIST",
        category: "accuracy",
        severity: issue.severity,
        confidence: "high",
        authority: "batch_consistency",
        status: "open",
        source: segment.source,
        target: segment.target,
        message: issue.message,
        evidenceSources: issue.evidence,
      });
    }
  }

  return findings;
}

/**
 * Expressive-layer findings: rule-based translationese plus confirmed
 * voice-profile constraints. These are advisory warnings by default — they do
 * not block delivery unless a project tunes the severity threshold.
 */
export function findExpressiveIssues(options: {
  batchId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  segments: BatchSegment[];
  voiceProfile?: VoiceProfile | null;
}): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const isZhToEn =
    options.sourceLanguage?.toLocaleLowerCase().startsWith("zh") &&
    options.targetLanguage?.toLocaleLowerCase().startsWith("en");
  for (const segment of options.segments) {
    const target = segment.target ?? "";
    if (!target.trim()) continue;
    if (isZhToEn) {
      for (const pattern of translationesePatterns(segment.source, target)) {
        findings.push({
          id: stableFindingId(["TRANSLATIONESE_PATTERN", segment.id, pattern.code]),
          batchId: options.batchId,
          segmentId: segment.id,
          code: "TRANSLATIONESE_PATTERN",
          category: "style",
          severity: "warning",
          confidence: "medium",
          authority: "batch_consistency",
          status: "open",
          source: segment.source,
          target,
          message: pattern.message,
          evidenceSources: [`translationese:${pattern.code}`],
        });
      }
    }
    for (const issue of voiceProfileIssues(segment, target, options.voiceProfile)) {
      findings.push({
        id: stableFindingId([issue.code, segment.id, issue.reason]),
        batchId: options.batchId,
        segmentId: segment.id,
        code: issue.code,
        category: "style",
        severity: "warning",
        confidence: issue.confidence,
        authority: "batch_consistency",
        status: "open",
        source: segment.source,
        target,
        message: issue.message,
        evidenceSources: [`voice_profile:${issue.entryId}`],
      });
    }
  }
  return findings;
}

interface TranslationesePattern {
  code: string;
  message: string;
}

/**
 * Conservative rule-based translationese detectors for zh-CN -> en-US. Each
 * rule targets a high-confidence calque pattern with low false-positive risk.
 * Adding rules here is cheap, but each must stay conservative — these are
 * warnings, never blockers, and a false positive erodes trust in the QA bench.
 */
function translationesePatterns(source: string, target: string): TranslationesePattern[] {
  const patterns: TranslationesePattern[] = [];
  // Obvious source-script leakage in an English target is a localization QA
  // smell, not a style preference. It stays warning-level because some projects
  // intentionally preserve source-script names, but it must be visible.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(target)) {
    patterns.push({
      code: "residual_cjk_script",
      message: "English target still contains CJK script — verify this is an intentional retained name, not untranslated source text.",
    });
  }
  // Chinese/fullwidth punctuation in en-US targets is one of the cheapest
  // high-signal machine-translation artifacts to catch after writing.
  if (/[，。！？；：、【】《》「」『』（）]/u.test(target)) {
    patterns.push({
      code: "cjk_punctuation",
      message: "English target contains Chinese/fullwidth punctuation — use target-locale punctuation unless the project explicitly requires otherwise.",
    });
  }
  // Nested "of ... of ..." chain: almost always a calque of stacked 的-modifiers
  // (e.g. "the gate of the heaven of the east" for "东方天界的门"). Prefer a
  // possessive or a verbalized rendering.
  if (/\bof\b[^.!?]*\bof\b[^.!?]*\bof\b/i.test(target)) {
    patterns.push({
      code: "nested_of_chain",
      message: "Nested 'of' chain (3+ levels) — likely a calque of stacked 的-modifiers; prefer a possessive or a verbalized rendering.",
    });
  }
  // Mechanical "make/conduct/carry out/perform + (a/an) + noun" calque of
  // 进行/作出/实施 + noun, where a single verb is idiomatic.
  if (/[进進][行行]|[作][出]|[实實][施]/.test(source)) {
    if (/\b(make|conduct|carry\s+out|perform|carry\s+on)\s+(?:a|an)?\s+[a-z]+/i.test(target)) {
      patterns.push({
        code: "mechanical_light_verb",
        message: "Mechanical light-verb + noun ('make/conduct/carry out/perform + noun') for 进行/作出/实施 — prefer a single strong verb.",
      });
    }
  }
  return patterns;
}

interface VoiceIssue {
  code: "VOICE_INCONSISTENCY" | "REGISTER_MISMATCH";
  entryId: string;
  reason: string;
  message: string;
  confidence: QualityFindingConfidence;
}

function voiceProfileIssues(segment: BatchSegment, target: string, voiceProfile: VoiceProfile | null | undefined): VoiceIssue[] {
  if (!voiceProfile || voiceProfile.status !== "confirmed" || !voiceProfile.entries.length) return [];
  const entry = voiceEntryForSegment(segment, voiceProfile);
  if (!entry) return [];
  const issues: VoiceIssue[] = [];
  const normalizedTarget = normalizeText(target);
  for (const taboo of entry.taboos ?? []) {
    const normalizedTaboo = normalizeText(taboo);
    if (normalizedTaboo && normalizedTarget.includes(normalizedTaboo)) {
      issues.push({
        code: "VOICE_INCONSISTENCY",
        entryId: entry.id,
        reason: `taboo:${normalizedTaboo}`,
        message: `Confirmed voice profile forbids "${taboo}", but the target uses it.`,
        confidence: "high",
      });
    }
  }
  if (/no|avoid|none/i.test(entry.contractionLevel ?? "") && /\b\w+['’](?:re|ve|ll|d|m|s|t)\b/i.test(target)) {
    issues.push({
      code: "REGISTER_MISMATCH",
      entryId: entry.id,
      reason: "contractions-forbidden",
      message: "Confirmed voice profile forbids contractions, but the target uses one.",
      confidence: "high",
    });
  }
  if (/\b(formal|elevated|solemn|archaic)\b/i.test(entry.register) && /\b(gonna|wanna|gotta|yeah|yep|nope|ok|okay|guys)\b/i.test(target)) {
    issues.push({
      code: "REGISTER_MISMATCH",
      entryId: entry.id,
      reason: "casual-in-formal-register",
      message: `Target uses casual diction against confirmed "${entry.register}" voice profile.`,
      confidence: "medium",
    });
  }
  if (/\b(casual|colloquial|plain|modern)\b/i.test(entry.register) && /\b(hereby|therefore|thus|shall|commence|utilize)\b/i.test(target)) {
    issues.push({
      code: "REGISTER_MISMATCH",
      entryId: entry.id,
      reason: "stiff-in-casual-register",
      message: `Target uses stiff/formal diction against confirmed "${entry.register}" voice profile.`,
      confidence: "medium",
    });
  }
  return issues;
}

function voiceEntryForSegment(segment: BatchSegment, voiceProfile: VoiceProfile): VoiceProfile["entries"][number] | null {
  const speaker = (segment as { speaker?: string | null }).speaker ?? null;
  const textType = inferVoiceTextType(segment.source);
  return (
    voiceProfile.entries.find((entry) => (entry.speaker ?? null) === speaker && entry.textType === textType) ??
    voiceProfile.entries.find((entry) => (entry.speaker ?? null) === speaker) ??
    voiceProfile.entries.find((entry) => entry.speaker == null && entry.textType === textType) ??
    voiceProfile.entries.find((entry) => entry.speaker == null) ??
    null
  );
}

function inferVoiceTextType(source: string): VoiceProfile["entries"][number]["textType"] {
  const text = source.trim();
  if (text.length <= 16 && !/[。！？.!?]/.test(text)) return "ui";
  return "system";
}

function summarize(segments: BatchSegment[], findings: QualityFinding[]): QualityAuditSummary {
  return {
    checkedSegments: segments.filter((segment) => segment.target.trim()).length,
    openBlockers: findings.filter((finding) => finding.status === "open" && finding.severity === "blocker").length,
    openWarnings: findings.filter((finding) => finding.status === "open" && finding.severity === "warning").length,
    ignored: findings.filter((finding) => finding.status === "ignored").length,
    termbasePreferredMissing: findings.filter((finding) => finding.code === "TERM_PREFERRED_MISSING").length,
    glossaryPreferredMissing: findings.filter((finding) => finding.code === "GLOSSARY_PREFERRED_MISSING").length,
    tmExactTargetMismatches: findings.filter((finding) => finding.code === "TM_EXACT_TARGET_MISMATCH").length,
    tmExactTargetConflicts: findings.filter((finding) => finding.code === "TM_EXACT_TARGET_CONFLICT").length,
    formattingSignatureMismatches: findings.filter((finding) => finding.category === "formatting").length,
    numberMismatches: findings.filter((finding) => finding.code === "NUMBER_MISMATCH").length,
    duplicateTargetMismatches: findings.filter((finding) => finding.code === "DUPLICATE_TARGET_MISMATCH").length,
    spellingUnknownWords: findings.filter((finding) => finding.code === "SPELLING_UNKNOWN_WORD").length,
    translationesePatterns: findings.filter((finding) => finding.code === "TRANSLATIONESE_PATTERN").length,
    voiceInconsistencies: findings.filter((finding) => finding.code === "VOICE_INCONSISTENCY").length,
    registerMismatches: findings.filter((finding) => finding.code === "REGISTER_MISMATCH").length,
  };
}

function deriveStatus(summary: QualityAuditSummary): QualityAuditStatus {
  if (summary.openBlockers > 0) return "fail";
  if (summary.openWarnings > 0) return "warn";
  return "pass";
}

export async function runQualityAudit(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
): Promise<QualityAuditReport> {
  const batch = await readBatch(workspaceRoot, projectId, batchId);
  const preferredTerms = await readPreferredTermbaseEntries(workspaceRoot, projectId);
  const glossaryEntries = await readPreferredGlossaryEntries(workspaceRoot, projectId);
  const glossaryTerms: PreferredTerm[] = glossaryEntries.map((entry) => ({
    source: entry.source,
    target: entry.target,
    authority: "glossary",
    note: entry.note,
    evidenceSource: `glossary:${entry.sourceFile}:${entry.rowNo}`,
  }));
  const tmEntries = await createTmStore(createWorkspace(workspaceRoot, projectId)).list();
  const [waivers, qualityChecklist] = await Promise.all([
    readQualityFindingWaivers(workspaceRoot, projectId),
    readQualityChecklist(workspaceRoot, projectId),
  ]);
  const ruleContext = await readProjectTagRuleContext(workspaceRoot, projectId);
  // Voice profile is optional; if it does not exist or the batch is missing,
  // readVoiceProfile returns a not_started profile and expressive voice checks
  // return no findings rather than throw.
  let voiceProfile: VoiceProfile | null = null;
  try {
    voiceProfile = await readVoiceProfile(workspaceRoot, projectId, batchId);
  } catch {
    voiceProfile = null;
  }
  const spelling = checkSpelling(
    batch.segments,
    batch.targetLanguage,
    [
      ...preferredTerms.map((entry) => entry.target),
      ...glossaryTerms.map((entry) => entry.target),
      ...tmEntries
        .filter((entry) => effectiveTmAuthority(entry) === "reviewed_tm")
        .map((entry) => entry.target),
    ],
  );
  const spellingSegmentsById = new Map(batch.segments.map((segment) => [segment.id, segment]));
  const spellingFindings: QualityFinding[] = spelling.issues.map((issue) => {
    const segment = spellingSegmentsById.get(issue.segmentId)!;
    return {
      id: stableFindingId([
        "SPELLING_UNKNOWN_WORD",
        issue.segmentId,
        issue.word.toLocaleLowerCase(),
        ...issue.evidence,
      ]),
      batchId,
      segmentId: issue.segmentId,
      code: "SPELLING_UNKNOWN_WORD",
      category: "accuracy",
      severity: "warning",
      confidence: "high",
      authority: "spelling_dictionary",
      status: "open",
      source: segment.source,
      target: segment.target,
      message: issue.message,
      evidenceSources: issue.evidence,
    };
  });
  const findings = applyWaivers(
    [
      ...findQualityIssues({
        batchId,
        sourceLanguage: batch.sourceLanguage,
        targetLanguage: batch.targetLanguage,
        segments: batch.segments,
        preferredTerms: [...preferredTerms, ...glossaryTerms],
        tmEntries,
      }),
      ...findMechanicalQualityIssues({
        batchId,
        sourceLanguage: batch.sourceLanguage,
        targetLanguage: batch.targetLanguage,
        segments: batch.segments,
        ruleContext,
        qualityChecklist,
        mechanicalOptions: qualityChecklist.mechanicalOptions,
      }),
      ...findExpressiveIssues({
        batchId,
        sourceLanguage: batch.sourceLanguage,
        targetLanguage: batch.targetLanguage,
        segments: batch.segments,
        voiceProfile,
      }),
      ...spellingFindings,
    ],
    waivers,
  );
  const summary = summarize(batch.segments, findings);
  const report: QualityAuditReport = {
    schemaVersion: 1,
    projectId,
    batchId,
    checkedAt: new Date().toISOString(),
    status: deriveStatus(summary),
    spelling: spelling.coverage,
    summary,
    findings,
  };
  await appendQualityDecisionLedgerOnce(workspaceRoot, qualityAuditFindingLedgerEvents(report));
  return report;
}

/**
 * Validate a quality-finding waiver against the current audit before persisting it.
 * Runs the audit, confirms the finding exists and that its segmentId + code match
 * the waiver target, then writes the waiver and returns a fresh post-upsert report.
 * This prevents a mismatched segmentId/code from silently ignoring the wrong finding.
 */
export async function recordQualityFindingWaiver(
  workspaceRoot: string,
  projectId: string,
  input: QualityFindingWaiverInput,
): Promise<{ waivers: QualityFindingWaiver[]; report: QualityAuditReport }> {
  const preAudit = await runQualityAudit(workspaceRoot, projectId, input.batchId);
  const finding = preAudit.findings.find((candidate) => candidate.id === input.findingId);
  if (!finding) {
    throw new Error(
      `quality_waiver: finding "${input.findingId}" not found in batch ${input.batchId}. Run quality_audit and use the exact finding id.`,
    );
  }
  if (finding.segmentId !== input.segmentId) {
    throw new Error(
      `quality_waiver: segmentId mismatch for finding "${input.findingId}". The finding belongs to segment "${finding.segmentId}", but the waiver targets "${input.segmentId}".`,
    );
  }
  if (finding.code !== input.code) {
    throw new Error(
      `quality_waiver: code mismatch for finding "${input.findingId}". The finding has code "${finding.code}", but the waiver targets "${input.code}".`,
    );
  }
  const waivers = await upsertQualityFindingWaiver(workspaceRoot, projectId, input);
  const report = await runQualityAudit(workspaceRoot, projectId, input.batchId);
  return { waivers, report };
}

export function formatQualityAuditMarkdown(report: QualityAuditReport): string {
  const lines = [
    `# Quality Audit · ${report.batchId}`,
    "",
    `Status: ${report.status}`,
    `Checked segments: ${report.summary.checkedSegments}`,
    `Open blockers: ${report.summary.openBlockers}`,
    `Open warnings: ${report.summary.openWarnings}`,
    `Ignored: ${report.summary.ignored}`,
    describeSpellingQaCoverage(report.spelling),
    "",
    "## Findings",
  ];
  const rows = report.findings.filter((finding) => finding.status === "open");
  if (!rows.length) {
    lines.push("", "No open quality findings.");
  } else {
    for (const finding of rows) {
      lines.push(
        "",
        `- ${finding.segmentId} · ${finding.code} · ${finding.severity}`,
        `  - ${finding.message}`,
        `  - evidence: ${finding.evidenceSources.join(", ")}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
