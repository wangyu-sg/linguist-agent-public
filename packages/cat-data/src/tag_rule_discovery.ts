import { createHash } from "node:crypto";
import { BBCODE_PROJECT_PATTERN, BRACKET_COLOR_PROJECT_PATTERN, GAME_COLOR_PROJECT_PATTERN, compileTagRule, tagRuleConsumesVariableBody, type TagRule, type TagRuleClass, type TagRuleExample } from "./tag_rules.js";

export interface TagRuleDiscoverySegment {
  batchId?: string;
  segmentId: string;
  source: string;
  target: string;
}

export interface TagRuleDiscoveryEvidence {
  schemaVersion: 1;
  segments: TagRuleDiscoverySegment[];
  coverage?: {
    totalSegments: number;
    promptSegmentLimit: number;
  };
  observedTokens: Array<{
    token: string;
    segmentIds: string[];
    sourceHits: number;
    targetHits: number;
  }>;
  suspectSpans: Array<{
    text: string;
    segmentIds: string[];
    sourceHits: number;
    targetHits: number;
  }>;
}

export type AskTagRuleModel = (input: { prompt: string; evidence: TagRuleDiscoveryEvidence }) => Promise<string>;

export interface RejectedTagRule {
  id: string;
  reason: string;
}

// A suspect span the Filter agent judged "protect" but that cannot be safely
// generalized into a regex (genuinely context-specific — the same word may be
// translatable elsewhere). It is surfaced for a human to decide, and is NEVER a
// rule: it does not enter the deterministic hot path until a person acts on it.
export interface HumanReviewSpan {
  span: string;
  reason: string;
  segmentIds: string[];
}

export interface TagRuleDiscoveryResult {
  assistantStatus: "not_configured" | "ready" | "error";
  candidates: TagRule[];
  rejected: RejectedTagRule[];
  // Filter-agent flags: protect verdicts that could not be generalized safely.
  humanReviewSpans: HumanReviewSpan[];
  promptPreview: string;
  trace: string[];
  error?: string;
}

const TOKEN_PATTERN = /<[^<>]+>|\[\/?(?:color|size|b|i|u)(?:=[^\]]+)?\]|\[(?:[0-9a-fA-F]{3,8}|-)\]|\{[^{}\s]+\}|\\[ntr]|#[rnt]|@#[0-9a-fA-F]{3,8}|@[0-9](?!\d)|#[0-9a-fA-F]{3,8}/g;
const SUSPECT_DNT_PATTERN = /\b(?:https?:\/\/[^\s]+|[A-Z][A-Z0-9_]{2,}|[A-Za-z][A-Za-z0-9_]*\.[A-Za-z0-9_.]+|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)\b/g;
const TAG_CLASSES: TagRuleClass[] = ["paired", "singleton", "formatting", "structural", "placeholder"];

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function countMatches(value: string, regex: RegExp): number {
  const copy = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = copy.exec(value)) !== null) {
    if (!match[0]) copy.lastIndex += 1;
    else count += 1;
  }
  return count;
}

function matchLiterals(value: string, regex: RegExp): string[] {
  const copy = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = copy.exec(value)) !== null) {
    if (!match[0]) copy.lastIndex += 1;
    else out.push(match[0]);
  }
  return out;
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  let index = 0;
  const max = Math.min(left.length, right.length) - prefixLength;
  while (index < max && left[left.length - 1 - index] === right[right.length - 1 - index]) index += 1;
  return index;
}

function swallowsTranslatedBody(sourceMatch: string, targetMatch: string): boolean {
  if (sourceMatch === targetMatch) return false;
  const prefix = commonPrefixLength(sourceMatch, targetMatch);
  const suffix = commonSuffixLength(sourceMatch, targetMatch, prefix);
  if (prefix < 2 || suffix < 2) return false;
  const sourceBody = sourceMatch.slice(prefix, sourceMatch.length - suffix).trim();
  const targetBody = targetMatch.slice(prefix, targetMatch.length - suffix).trim();
  // ponytail: heuristic guard; replace with parsed open/close token spans if tag grammars expand.
  return Boolean(sourceBody && targetBody && /[\p{L}\p{N}]/u.test(sourceBody) && /[\p{L}\p{N}]/u.test(targetBody));
}

function regexHits(value: string, rule: Pick<TagRule, "pattern" | "flags">): boolean {
  const compiled = compileTagRule({ pattern: rule.pattern, flags: (rule.flags ?? "").replace("g", "") });
  return Boolean(compiled.regex?.test(value));
}

function sanitizeRuleId(value: unknown, pattern: string): string {
  const raw = typeof value === "string" ? value : "";
  const slug = raw
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (slug) return slug;
  return `rule-${createHash("sha1").update(pattern).digest("hex").slice(0, 10)}`;
}

export function buildProjectTagRuleEvidence(
  segments: TagRuleDiscoverySegment[],
  options: { maxSegments?: number } = {},
): TagRuleDiscoveryEvidence {
  const promptSegmentLimit = Math.max(1, options.maxSegments ?? 80);
  const tokens = new Map<string, { segmentIds: Set<string>; sourceHits: number; targetHits: number }>();
  const suspectSpans = new Map<string, { segmentIds: Set<string>; sourceHits: number; targetHits: number }>();
  // Deterministic discovery is safety coverage and must inspect the complete
  // supplied scope. The limit applies only to provider-visible examples below.
  for (const segment of segments) {
    for (const side of ["source", "target"] as const) {
      const matches = segment[side].matchAll(TOKEN_PATTERN);
      for (const match of matches) {
        const row = tokens.get(match[0]) ?? { segmentIds: new Set<string>(), sourceHits: 0, targetHits: 0 };
        row.segmentIds.add(segment.segmentId);
        if (side === "source") row.sourceHits += 1;
        else row.targetHits += 1;
        tokens.set(match[0], row);
      }
      for (const match of segment[side].matchAll(SUSPECT_DNT_PATTERN)) {
        const row = suspectSpans.get(match[0]) ?? { segmentIds: new Set<string>(), sourceHits: 0, targetHits: 0 };
        row.segmentIds.add(segment.segmentId);
        if (side === "source") row.sourceHits += 1;
        else row.targetHits += 1;
        suspectSpans.set(match[0], row);
      }
    }
  }
  return {
    schemaVersion: 1,
    segments,
    coverage: { totalSegments: segments.length, promptSegmentLimit },
    observedTokens: Array.from(tokens.entries()).map(([token, row]) => ({
      token,
      segmentIds: Array.from(row.segmentIds),
      sourceHits: row.sourceHits,
      targetHits: row.targetHits,
    })),
    suspectSpans: Array.from(suspectSpans.entries()).map(([text, row]) => ({
      text,
      segmentIds: Array.from(row.segmentIds),
      sourceHits: row.sourceHits,
      targetHits: row.targetHits,
    })),
  };
}

function buildDiscoveryPrompt(evidence: TagRuleDiscoveryEvidence): string {
  const coverage = evidence.coverage ?? { totalSegments: evidence.segments.length, promptSegmentLimit: 80 };
  const promptEvidence = {
    ...evidence,
    segments: evidence.segments.slice(0, coverage.promptSegmentLimit),
    coverage: {
      ...coverage,
      visibleSegments: Math.min(coverage.promptSegmentLimit, evidence.segments.length),
      note: "Deterministic token discovery scanned the complete scope; this provider prompt contains only the disclosed segment preview.",
    },
  };
  return [
    "Infer project-specific tag, placeholder, formatting, or structural token rules from the bilingual CAT evidence.",
    "Return strict JSON only: {\"rules\":[{\"id\":\"...\",\"class\":\"paired|singleton|formatting|structural|placeholder\",\"pattern\":\"regex source\",\"flags\":\"g\",\"confidence\":0.0,\"examples\":[{\"batchId\":\"...\",\"segmentId\":\"...\",\"text\":\"...\"}],\"note\":\"...\"}]}",
    "Rules are candidates only. Prefer rules that occur in both source and target for the same segment. Do not return ordinary translated words.",
    "Also classify every suspectSpan. Add \"spanVerdicts\":[{\"span\":\"...\",\"verdict\":\"translatable|protect\",\"generalization\":\"regex source covering the whole class — OMIT it when no single regex is safe\",\"reason\":\"...\"}].",
    "Use verdict \"protect\" only for do-not-translate tokens (identifiers, codes, URLs, placeholders) that appear copied through into the target unchanged; use \"translatable\" for ordinary words. Provide \"generalization\" ONLY when one regex safely covers the entire class; omit it for one-off, context-specific spans so they are flagged for human review instead of being auto-protected. The Filter agent complements the deterministic protection table — it never replaces it.",
    JSON.stringify(promptEvidence, null, 2),
  ].join("\n\n");
}

function rowsFromModel(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.rules)) return obj.rules;
  if (Array.isArray(obj.candidates)) return obj.candidates;
  return [];
}

function examplesFrom(value: unknown): TagRuleExample[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): TagRuleExample[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.segmentId !== "string" || typeof row.text !== "string") return [];
    return [{
      batchId: typeof row.batchId === "string" ? row.batchId : undefined,
      segmentId: row.segmentId,
      text: row.text,
    }];
  });
}

function validateExample(example: TagRuleExample, evidence: TagRuleDiscoveryEvidence, rule: Pick<TagRule, "pattern" | "flags">): boolean {
  const segment = evidence.segments.find((row) =>
    row.segmentId === example.segmentId && (!example.batchId || row.batchId === example.batchId),
  );
  if (!segment) return false;
  if (!segment.source.includes(example.text) && !segment.target.includes(example.text)) return false;
  return regexHits(example.text, rule);
}

function validateModelRule(row: unknown, evidence: TagRuleDiscoveryEvidence): { candidate?: TagRule; rejected?: RejectedTagRule } {
  if (!row || typeof row !== "object") return { rejected: { id: "unknown", reason: "rule is not an object" } };
  const obj = row as Record<string, unknown>;
  if (typeof obj.pattern !== "string" || !obj.pattern.trim()) {
    return { rejected: { id: String(obj.id ?? "unknown"), reason: "missing pattern" } };
  }
  const pattern = obj.pattern;
  const id = sanitizeRuleId(obj.id, pattern);
  const className = typeof obj.class === "string" && TAG_CLASSES.includes(obj.class as TagRuleClass)
    ? obj.class as TagRuleClass
    : "formatting";
  const flags = typeof obj.flags === "string" ? obj.flags : "g";
  if (tagRuleConsumesVariableBody({ class: className, pattern })) {
    return { rejected: { id, reason: "pattern appears to include translatable body text" } };
  }
  const compiled = compileTagRule({ pattern, flags });
  if (!compiled.regex) return { rejected: { id, reason: `regex rejected: ${compiled.error ?? "compile failed"}` } };

  const examples = examplesFrom(obj.examples);
  if (!examples.length || examples.some((example) => !validateExample(example, evidence, { pattern, flags }))) {
    return { rejected: { id, reason: "examples are missing or not backed by evidence" } };
  }

  let occurrences = 0;
  let segmentCoverage = 0;
  let cooccurringSegments = 0;
  for (const segment of evidence.segments) {
    const sourceHits = countMatches(segment.source, compiled.regex);
    const targetHits = countMatches(segment.target, compiled.regex);
    if (sourceHits || targetHits) segmentCoverage += 1;
    if (sourceHits && targetHits) cooccurringSegments += 1;
    occurrences += sourceHits + targetHits;
    const sourceMatches = sourceHits ? matchLiterals(segment.source, compiled.regex) : [];
    const targetMatches = targetHits ? matchLiterals(segment.target, compiled.regex) : [];
    const pairedCount = Math.min(sourceMatches.length, targetMatches.length);
    for (let index = 0; index < pairedCount; index += 1) {
      if (swallowsTranslatedBody(sourceMatches[index], targetMatches[index])) {
        return { rejected: { id, reason: "pattern appears to include translatable body text" } };
      }
    }
  }
  if (cooccurringSegments < 1) return { rejected: { id, reason: "pattern has no source-target co-occurrence" } };
  if (segmentCoverage < 1 || occurrences < 2) return { rejected: { id, reason: "pattern coverage is too low" } };

  return {
    candidate: {
      id,
      class: className,
      pattern,
      flags,
      origin: "llm",
      status: "candidate",
      confidence: typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.7,
      occurrences,
      segmentCoverage,
      examples,
      note: typeof obj.note === "string" ? obj.note : undefined,
    },
  };
}

function verdictsFromModel(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  return Array.isArray(obj.spanVerdicts) ? obj.spanVerdicts : [];
}

// E2/E3 — materialize the Filter agent's span verdicts. Conservation: a "protect"
// span only ever becomes a *candidate* (still requires human confirm to enter the
// hot path) when it carries a regex generalization that passes the SAME evidence
// bar as model rules; a "protect" span with no safe generalization is flagged for
// human review and protects nothing automatically; "translatable" produces no
// artifact at all (the deterministic table is complemented, never overridden).
function materializeSpanVerdicts(
  rows: unknown[],
  evidence: TagRuleDiscoveryEvidence,
): { candidates: TagRule[]; humanReview: HumanReviewSpan[] } {
  const candidates: TagRule[] = [];
  const humanReview: HumanReviewSpan[] = [];
  const seenReview = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    const span = typeof obj.span === "string" ? obj.span.trim() : "";
    if (!span || obj.verdict !== "protect") continue;
    const suspect = evidence.suspectSpans.find((item) => item.text === span);
    const segmentIds = suspect ? suspect.segmentIds : [];
    const generalization = typeof obj.generalization === "string" && obj.generalization.trim()
      ? obj.generalization.trim()
      : undefined;
    if (generalization) {
      const exampleSegment = evidence.segments.find(
        (segment) =>
          (segmentIds.length === 0 || segmentIds.includes(segment.segmentId)) &&
          (segment.source.includes(span) || segment.target.includes(span)),
      );
      const result = exampleSegment
        ? validateModelRule({
            id: typeof obj.id === "string" && obj.id.trim() ? obj.id : `protect-${span}`,
            class: typeof obj.class === "string" ? obj.class : "structural",
            pattern: generalization,
            flags: "g",
            confidence: typeof obj.confidence === "number" ? obj.confidence : 0.7,
            examples: [{ batchId: exampleSegment.batchId, segmentId: exampleSegment.segmentId, text: span }],
            note: typeof obj.reason === "string" ? obj.reason : "Filter-agent protected span.",
          }, evidence)
        : { rejected: { id: span, reason: "no evidence segment for span" } };
      if (result.candidate) {
        candidates.push(result.candidate);
        continue;
      }
      // generalization failed the evidence bar — fall through to human review
    }
    if (seenReview.has(span)) continue;
    seenReview.add(span);
    humanReview.push({
      span,
      reason: typeof obj.reason === "string" && obj.reason.trim()
        ? obj.reason.trim()
        : "Flagged do-not-translate but no safe generalization — confirm per occurrence.",
      segmentIds,
    });
  }
  return { candidates, humanReview };
}

// Models routinely wrap JSON in ```code fences``` or chat around it. A single
// JSON.parse on that whole blob throws and used to scrap the entire batch, so we
// degrade gracefully: try the raw string, then strip a fence, then carve out the
// first balanced {...} (respecting string literals so braces inside strings don't
// fool the scanner).
function stripCodeFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1] : raw;
}

function extractFirstJsonObject(raw: string): string | undefined {
  const start = raw.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return undefined;
}

function parseModelJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const candidate = extractFirstJsonObject(stripCodeFence(raw)) ?? extractFirstJsonObject(raw);
    if (candidate === undefined) throw new Error("model returned no parseable JSON object");
    return JSON.parse(candidate);
  }
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyBootstrapToken(token: string): TagRuleClass {
  if (/^\{.*\}$/.test(token)) return "placeholder";
  if (/^@#?\d/.test(token)) return "placeholder";
  return "formatting";
}

function unsafeSourcePreflightToken(token: string): boolean {
  return /^\{[A-Za-z][A-Za-z0-9_]*>[\s\S]*<[A-Za-z][A-Za-z0-9_]*\}$/.test(token);
}

const BOOTSTRAP_LIMIT = 12;
// BBCODE_PROJECT_PATTERN / GAME_COLOR_PROJECT_PATTERN are single-sourced in tag_rules_core
// so builtinIdsSupersededByRule maps these exact strings back to their builtins.

const BOOTSTRAP_GENERALIZATIONS: Array<{
  id: string;
  pattern: string;
  tokenRegex: RegExp;
  note: string;
  sourceOnly?: boolean;
}> = [
  {
    id: "discovered-bbcode",
    pattern: BBCODE_PROJECT_PATTERN,
    tokenRegex: /^\[\/?(?:color|size|b|i|u)(?:=[^\]]+)?\]$/i,
    note: "Auto-detected BBCode-style formatting tags from co-occurring source/target markup.",
  },
  {
    id: "discovered-game-color",
    pattern: GAME_COLOR_PROJECT_PATTERN,
    tokenRegex: /^(?:@#[0-9a-fA-F]{3,8}|@[0-9]|#[rnt]|#[0-9a-fA-F]{3,8})$/,
    note: "Auto-detected game color/control codes from co-occurring source/target markup.",
  },
  {
    id: "discovered-bracket-color",
    pattern: BRACKET_COLOR_PROJECT_PATTERN,
    tokenRegex: /^\[(?:[0-9a-fA-F]{3,8}|-)\]$/,
    note: "Auto-detected bracket color/control codes from source preflight.",
    sourceOnly: true,
  },
];

// Deterministic safety net. Co-occurring source/target tokens still pass the
// strict validation bar; source-only preflight tokens become confirmable
// candidates only, so an untranslated batch can be prepared without weakening
// write/delivery signature checks.
function bootstrapCandidatesFromEvidence(evidence: TagRuleDiscoveryEvidence, options: { sourceOnlyPreflight?: boolean; includeCooccurring?: boolean } = {}): TagRule[] {
  const includeCooccurring = options.includeCooccurring ?? true;
  const rows = evidence.observedTokens
    .filter((row) => includeCooccurring && row.sourceHits > 0 && row.targetHits > 0)
    .sort((a, b) =>
      b.segmentIds.length - a.segmentIds.length ||
      (b.sourceHits + b.targetHits) - (a.sourceHits + a.targetHits) ||
      (a.token < b.token ? -1 : a.token > b.token ? 1 : 0),
    );
  const sourceRows = options.sourceOnlyPreflight
    ? evidence.observedTokens
      .filter((row) => row.sourceHits > 0 && (includeCooccurring || row.targetHits === 0) && !unsafeSourcePreflightToken(row.token))
      .sort((a, b) =>
        b.segmentIds.length - a.segmentIds.length ||
        b.sourceHits - a.sourceHits ||
        (a.token < b.token ? -1 : a.token > b.token ? 1 : 0),
      )
    : rows;
  const out: TagRule[] = [];
  const seen = new Set<string>();
  const generalizedTokenPatterns: RegExp[] = [];
  for (const generalization of BOOTSTRAP_GENERALIZATIONS) {
    const pool = generalization.sourceOnly ? sourceRows : rows;
    const row = pool.find((item) => generalization.tokenRegex.test(item.token));
    if (!row) continue;
    const exampleSegment = evidence.segments.find(
      (segment) =>
        row.segmentIds.includes(segment.segmentId) &&
        (segment.source.includes(row.token) || segment.target.includes(row.token)),
    );
    if (!exampleSegment) continue;
    const result = validateModelRule({
      id: generalization.id,
      class: "formatting",
      pattern: generalization.pattern,
      flags: "g",
      confidence: 0.65,
      examples: [{ batchId: exampleSegment.batchId, segmentId: exampleSegment.segmentId, text: row.token }],
      note: generalization.note,
    }, evidence);
    if (result.candidate) {
      out.push({ ...result.candidate, origin: "discovered" });
      seen.add(generalization.pattern);
      generalizedTokenPatterns.push(generalization.tokenRegex);
      continue;
    }
    if (generalization.sourceOnly && options.sourceOnlyPreflight) {
      out.push({
        id: generalization.id,
        class: "formatting",
        pattern: generalization.pattern,
        flags: "g",
        origin: "discovered",
        status: "candidate",
        confidence: 0.55,
        occurrences: row.sourceHits,
        segmentCoverage: row.segmentIds.length,
        examples: [{ batchId: exampleSegment.batchId, segmentId: exampleSegment.segmentId, text: row.token }],
        note: generalization.note,
      });
      seen.add(generalization.pattern);
      generalizedTokenPatterns.push(generalization.tokenRegex);
    }
  }
  for (const row of options.sourceOnlyPreflight ? sourceRows : rows) {
    if (out.length >= BOOTSTRAP_LIMIT) break;
    if (generalizedTokenPatterns.some((regex) => regex.test(row.token))) continue;
    const pattern = escapeRegexLiteral(row.token);
    if (seen.has(pattern)) continue;
    const exampleSegment = evidence.segments.find(
      (segment) =>
        row.segmentIds.includes(segment.segmentId) &&
        (segment.source.includes(row.token) || segment.target.includes(row.token)),
    );
    if (!exampleSegment) continue;
    const synthetic = {
      id: `discovered-${createHash("sha1").update(pattern).digest("hex").slice(0, 8)}`,
      class: classifyBootstrapToken(row.token),
      pattern,
      flags: "g",
      confidence: 0.5,
      examples: [{ batchId: exampleSegment.batchId, segmentId: exampleSegment.segmentId, text: row.token }],
      note: "Auto-detected from co-occurring source/target markup.",
    };
    const result = validateModelRule(synthetic, evidence);
    if (result.candidate) {
      seen.add(pattern);
      out.push({ ...result.candidate, origin: "discovered" });
      continue;
    }
    if (options.sourceOnlyPreflight && row.sourceHits > 0) {
      seen.add(pattern);
      out.push({
        ...synthetic,
        origin: "discovered",
        status: "candidate",
        occurrences: row.sourceHits,
        segmentCoverage: row.segmentIds.length,
        note: "Auto-detected from source preflight; confirm before it enters write/delivery gates.",
      });
    }
  }
  return out;
}

function appendDiscoveredCandidates(candidates: TagRule[], discovered: TagRule[]): TagRule[] {
  const seen = new Set(candidates.map((candidate) => candidate.pattern));
  const out = [...candidates];
  for (const candidate of discovered) {
    if (seen.has(candidate.pattern)) continue;
    seen.add(candidate.pattern);
    out.push(candidate);
  }
  return out;
}

export async function discoverTagRulesFromEvidence(
  evidence: TagRuleDiscoveryEvidence,
  askModel?: AskTagRuleModel,
): Promise<TagRuleDiscoveryResult> {
  const prompt = buildDiscoveryPrompt(evidence);
  const coverage = evidence.coverage ?? { totalSegments: evidence.segments.length, promptSegmentLimit: 80 };
  const evidenceTrace = `evidence: deterministic scan ${coverage.totalSegments}/${coverage.totalSegments} segment(s), provider preview ${Math.min(coverage.promptSegmentLimit, coverage.totalSegments)}/${coverage.totalSegments}, ${evidence.observedTokens.length} observed token(s), ${evidence.suspectSpans.length} suspect span(s)`;
  if (!askModel) {
    // No model wired: status stays honest ("not_configured") but the deterministic
    // bootstrap still fills the panel so clear markup is never silently dropped.
    const bootstrap = bootstrapCandidatesFromEvidence(evidence, { sourceOnlyPreflight: true });
    return {
      assistantStatus: "not_configured",
      candidates: bootstrap,
      rejected: [],
      humanReviewSpans: [],
      promptPreview: prompt.slice(0, 4000),
      trace: [
        evidenceTrace,
        "assistant: global provider not configured or unavailable",
        `validation: deterministic bootstrap produced ${bootstrap.length} candidate(s), including source-only preflight candidates where target text is empty`,
      ],
    };
  }
  try {
    const raw = await askModel({ prompt, evidence });
    const parsed = parseModelJson(raw);
    const modelRows = rowsFromModel(parsed);
    const verdictRows = verdictsFromModel(parsed);
    const rejected: RejectedTagRule[] = [];
    const candidates: TagRule[] = [];
    for (const row of modelRows) {
      const result = validateModelRule(row, evidence);
      if (result.candidate) candidates.push(result.candidate);
      if (result.rejected) rejected.push(result.rejected);
    }
    const byId = new Map<string, TagRule>();
    for (const candidate of candidates) byId.set(candidate.id, candidate);
    // Filter agent (E2/E3): generalizable protect spans join the candidates;
    // non-generalizable ones surface as human-review flags, never auto-protected.
    const { candidates: protectCandidates, humanReview } = materializeSpanVerdicts(verdictRows, evidence);
    for (const candidate of protectCandidates) byId.set(candidate.id, candidate);
    const dedupRejected = unique(rejected.map((row) => `${row.id}\0${row.reason}`)).map((key) => {
      const [id, reason] = key.split("\0");
      return { id, reason };
    });
    const discovered = bootstrapCandidatesFromEvidence(evidence, { sourceOnlyPreflight: true, includeCooccurring: false });
    const resolved = appendDiscoveredCandidates(Array.from(byId.values()), discovered);
    const bootstrapCount = resolved.length - byId.size;
    return {
      assistantStatus: "ready",
      candidates: resolved,
      rejected: dedupRejected,
      humanReviewSpans: humanReview,
      promptPreview: prompt.slice(0, 4000),
      trace: [
        evidenceTrace,
        `assistant: ready; model returned ${modelRows.length} rule row(s) and ${verdictRows.length} span verdict(s)`,
        `validation: accepted ${byId.size} model candidate(s), added ${bootstrapCount} deterministic preflight candidate(s), rejected ${dedupRejected.length}, human-review ${humanReview.length}`,
      ],
    };
  } catch (error) {
    // Model errored or returned unparseable output: surface the error AND still
    // serve deterministic candidates so the failure is diagnosable, not a silent 0.
    const message = error instanceof Error ? error.message : String(error);
    const bootstrap = bootstrapCandidatesFromEvidence(evidence, { sourceOnlyPreflight: true });
    return {
      assistantStatus: "error",
      candidates: bootstrap,
      rejected: [],
      humanReviewSpans: [],
      promptPreview: prompt.slice(0, 4000),
      trace: [
        evidenceTrace,
        `assistant: error; ${message}`,
        `validation: deterministic bootstrap produced ${bootstrap.length} candidate(s) after model failure`,
      ],
      error: message,
    };
  }
}
