import {
  phraseInlineTagSignature,
  phrasePlaceholderSignature,
} from "@linguist-agent/cat-formats";
import { stripIcuBranchPlaceholders } from "./format_signatures.js";
import { formatQaWriteGateBlockers, runQaWriteGate } from "./qa_write_gate.js";
import type { ProjectTagRuleContext } from "./tag_rules.js";
import type { BatchSegment, CatBatch, SegmentChangeType } from "./batch_workspace.js";

// External evidence is mandatory only when the change claims project term
// authority. Accuracy and consistency can be established directly from the
// typed source/target/context or deterministic duplicate checks; forcing an
// arbitrary string into evidenceSources encouraged invented citations.
const EVIDENCE_REQUIRED_CHANGE_TYPES = new Set<SegmentChangeType>(["term", "terminology"]);

const AUDIT_ONLY_EVIDENCE_PATTERNS = [
  /^tool[_\s:-]*trace\b/i,
  /^tool[_\s:-]*call\b/i,
  /^trace\b/i,
  /^agent[_\s:-]*events?\b/i,
  /^pi[_\s:-]*event\b/i,
  /^runtime[_\s:-]*validation\b/i,
];

export interface SegmentWritePolicyInput {
  batch: Pick<CatBatch, "format">;
  segment: Pick<BatchSegment, "id" | "source" | "locked">;
  target: string;
  reason: string;
  changeType: SegmentChangeType;
  evidenceSources?: string[];
  acceptedRiskCodes?: string[];
  ruleContext: ProjectTagRuleContext;
}

export interface ChangeEvidencePolicyInput {
  reason: string;
  changeType: SegmentChangeType;
  evidenceSources?: string[];
}

export interface SegmentWritePolicyResult {
  evidenceSources: string[];
}

function sameSignature(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function normalizeEvidenceSources(value?: string[]): string[] {
  return (value ?? []).map((source) => source.trim()).filter(Boolean);
}

export function isAuditOnlyEvidenceSource(value: string): boolean {
  return AUDIT_ONLY_EVIDENCE_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

export function isCitableEvidenceSource(value: string): boolean {
  return Boolean(value.trim()) && !isAuditOnlyEvidenceSource(value);
}

export function assertChangeEvidenceAllowed(options: ChangeEvidencePolicyInput): string[] {
  const reason = options.reason.trim();
  if (!reason) {
    throw new Error("Segment write requires a non-empty reason.");
  }
  const evidenceSources = normalizeEvidenceSources(options.evidenceSources);
  if (!EVIDENCE_REQUIRED_CHANGE_TYPES.has(options.changeType)) {
    return evidenceSources;
  }

  const auditOnly = evidenceSources.filter(isAuditOnlyEvidenceSource);
  const citable = evidenceSources.filter(isCitableEvidenceSource);
  if (auditOnly.length) {
    throw new Error(
      `Segment write changeType=${options.changeType} cites audit-only evidence (${auditOnly.join(", ")}). Tool trace is audit data, not evidence.`,
    );
  }
  if (!citable.length) {
    throw new Error(
      `Segment write changeType=${options.changeType} requires citable evidenceSources. Tool trace alone is not evidence.`,
    );
  }
  return citable;
}

function genericInlineFragments(value: string): string[] {
  return Array.from(value.matchAll(/\{[^{}\s]+\}|\{\d+>\}|<\d+\}/g)).map((match) => match[0]);
}

export function segmentTagSignatureMismatch(
  segment: Pick<BatchSegment, "source">,
  target: string,
  format: CatBatch["format"],
): string | undefined {
  const sourceWithoutIcuBranches = stripIcuBranchPlaceholders(segment.source);
  const targetWithoutIcuBranches = stripIcuBranchPlaceholders(target);
  const sourceRichTags = phraseInlineTagSignature(sourceWithoutIcuBranches);
  const targetRichTags = phraseInlineTagSignature(targetWithoutIcuBranches);
  if (sourceRichTags.length || targetRichTags.length) {
    return sameSignature(sourceRichTags, targetRichTags)
      ? undefined
      : `target inline tag signature differs from source (${sourceRichTags.join(" ")} != ${targetRichTags.join(" ")})`;
  }

  const sourcePlaceholders = phrasePlaceholderSignature(sourceWithoutIcuBranches);
  const targetPlaceholders = phrasePlaceholderSignature(targetWithoutIcuBranches);
  if (sourcePlaceholders.length || targetPlaceholders.length) {
    return sameSignature(sourcePlaceholders, targetPlaceholders)
      ? undefined
      : `target placeholder signature differs from source (${sourcePlaceholders.join(" ")} != ${targetPlaceholders.join(" ")})`;
  }

  if (format === "sdlxliff") {
    const sourceFragments = genericInlineFragments(segment.source);
    const targetFragments = genericInlineFragments(target);
    if (sourceFragments.length || targetFragments.length) {
      return sameSignature(sourceFragments, targetFragments)
        ? undefined
        : `target SDLXLIFF inline fragment signature differs from source (${sourceFragments.join(" ")} != ${targetFragments.join(" ")})`;
    }
  }
  return undefined;
}

export function assertSegmentWritePolicyAllowed(input: SegmentWritePolicyInput): SegmentWritePolicyResult {
  if (input.segment.locked) {
    throw new Error(`Segment ${input.segment.id} is locked and cannot be written.`);
  }
  const evidenceSources = assertChangeEvidenceAllowed(input);
  const tagMismatch = segmentTagSignatureMismatch(input.segment, input.target, input.batch.format);
  if (tagMismatch) {
    throw new Error(`Segment ${input.segment.id} violates tag signature policy: ${tagMismatch}`);
  }
  const gate = runQaWriteGate(input.segment, input.target, input.ruleContext, input.acceptedRiskCodes);
  if (!gate.ok) {
    throw new Error(formatQaWriteGateBlockers(input.segment.id, gate.blockers));
  }
  return { evidenceSources };
}

export function writePolicyEvidenceViolations(params: unknown): string[] {
  const violations: string[] = [];
  function visit(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const changeType = obj.changeType;
    if (typeof changeType === "string" && EVIDENCE_REQUIRED_CHANGE_TYPES.has(changeType as SegmentChangeType)) {
      const evidenceSources = normalizeEvidenceSources(
        Array.isArray(obj.evidenceSources) ? obj.evidenceSources.filter((entry): entry is string => typeof entry === "string") : [],
      );
      const auditOnly = evidenceSources.filter(isAuditOnlyEvidenceSource);
      const citable = evidenceSources.filter(isCitableEvidenceSource);
      if (auditOnly.length) {
        violations.push(`${path || "params"} changeType=${changeType} cites audit-only evidence (${auditOnly.join(", ")})`);
      }
      if (!citable.length) {
        violations.push(`${path || "params"} changeType=${changeType} requires citable evidenceSources`);
      }
    }
    for (const [key, nested] of Object.entries(obj)) {
      if (key === "evidenceSources") continue;
      if (Array.isArray(nested) || (nested && typeof nested === "object")) visit(nested, path ? `${path}.${key}` : key);
    }
  }
  visit(params, "");
  return violations;
}
