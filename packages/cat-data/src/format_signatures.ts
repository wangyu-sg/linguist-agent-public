import { phraseInlineTagSignature, phrasePlaceholderSignature } from "@linguist-agent/cat-formats";
import { detectTags } from "./tag_tokens.js";
import { type ProjectTagRuleContext } from "./tag_rules_core.js";

export type FormattingSignatureKind =
  | "native_tag"
  | "project_tag"
  | "rich_text"
  | "underline"
  | "placeholder"
  | "icu_branch"
  | "hard_newline"
  | "literal_newline";

export interface FormattingSignature {
  nativeTags: string[];
  projectTags: string[];
  richTextTags: string[];
  underlineTags: string[];
  placeholders: string[];
  icuBranches: string[];
  hardNewlines: number;
  literalNewlines: number;
  requiredTargetHardNewlines: number;
}

export interface FormattingSignatureMismatch {
  kind: FormattingSignatureKind;
  code: string;
  source: string[] | number;
  target: string[] | number;
}

export interface FormattingSignatureComparison {
  source: FormattingSignature;
  target: FormattingSignature;
  mismatches: FormattingSignatureMismatch[];
}

function tagNames(value: string, names: string[]): string[] {
  const allowed = new Set(names.map((name) => name.toLowerCase()));
  const matches = value.matchAll(/<\/?\s*([a-z][a-z0-9:-]*)(?:\s+[^<>]*)?>/gi);
  return Array.from(matches)
    .map((match) => match[1].toLowerCase())
    .filter((name) => allowed.has(name));
}

function countHardNewlines(value: string): number {
  return (value.match(/\r\n|\r|\n/g) ?? []).length;
}

function countLiteralNewlines(value: string): number {
  return (value.match(/\\n/g) ?? []).length;
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function projectTagSignature(value: string, ruleContext: ProjectTagRuleContext): string[] {
  // Derive from the single unified resolver so the write/delivery gate and the
  // translator-facing chips are bit-for-bit the same truth. Project rules win
  // every overlap (highest precedence in detectTags), so each "project-tag"
  // detection's `${id}:${literal}` reproduces the legacy `${ruleId}:${match}`.
  return detectTags(value, ruleContext)
    .filter((tag) => tag.kind === "project-tag")
    .map((tag) => `${tag.id}:${tag.literal}`);
}

function namedPlaceholderName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

interface NamedColonPlaceholder {
  name: string;
  arity: number;
  start: number;
  end: number;
}

function scanNamedColonPlaceholders(value: string): NamedColonPlaceholder[] {
  const placeholders: NamedColonPlaceholder[] = [];
  let index = 0;
  while (index < value.length) {
    const open = value.indexOf("{", index);
    if (open === -1) break;
    let cursor = open + 1;
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;

    const nameStart = cursor;
    while (/[A-Za-z0-9_]/.test(value[cursor] ?? "")) cursor += 1;
    const name = value.slice(nameStart, cursor);
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;

    if (!namedPlaceholderName(name) || value[cursor] !== ":") {
      index = open + 1;
      continue;
    }

    cursor += 1;
    let depth = 1;
    let pipeCount = 0;
    let closedAt = -1;
    for (; cursor < value.length; cursor += 1) {
      const char = value[cursor];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          closedAt = cursor;
          break;
        }
      } else if (char === "|" && depth === 1) {
        pipeCount += 1;
      }
    }

    if (closedAt === -1) {
      index = open + 1;
      continue;
    }

    placeholders.push({
      name,
      arity: pipeCount + 1,
      start: open,
      end: closedAt + 1,
    });
    index = closedAt + 1;
  }
  return placeholders;
}

export function stripIcuBranchPlaceholders(value: string): string {
  const placeholders = scanNamedColonPlaceholders(value);
  if (!placeholders.length) return value;
  let stripped = "";
  let cursor = 0;
  for (const placeholder of placeholders) {
    stripped += value.slice(cursor, placeholder.start);
    cursor = placeholder.end;
  }
  return stripped + value.slice(cursor);
}

export function extractIcuBranchAritySignature(value: string): string[] {
  return scanNamedColonPlaceholders(value).map((placeholder) => `${placeholder.name}:${placeholder.arity}`);
}

function mismatch(kind: FormattingSignatureKind, code: string, source: string[] | number, target: string[] | number): FormattingSignatureMismatch | undefined {
  if (typeof source === "number" && typeof target === "number") {
    return source === target ? undefined : { kind, code, source, target };
  }
  if (Array.isArray(source) && Array.isArray(target)) {
    return sameList(source, target) ? undefined : { kind, code, source, target };
  }
  return { kind, code, source, target };
}

export function extractFormattingSignature(value: string, ruleContext: ProjectTagRuleContext): FormattingSignature {
  const hardNewlines = countHardNewlines(value);
  const literalNewlines = countLiteralNewlines(value);
  const structuralValue = stripIcuBranchPlaceholders(value);
  return {
    nativeTags: phraseInlineTagSignature(structuralValue),
    projectTags: projectTagSignature(structuralValue, ruleContext),
    richTextTags: tagNames(structuralValue, ["b", "i", "u", "strong", "em", "font", "color", "span"]),
    underlineTags: tagNames(structuralValue, ["u"]),
    placeholders: phrasePlaceholderSignature(structuralValue),
    icuBranches: extractIcuBranchAritySignature(value),
    hardNewlines,
    literalNewlines,
    requiredTargetHardNewlines: hardNewlines + literalNewlines,
  };
}

export function compareFormattingSignatures(
  sourceText: string,
  targetText: string,
  ruleContext: ProjectTagRuleContext,
  inheritedTargetText?: string,
): FormattingSignatureComparison {
  const source = extractFormattingSignature(sourceText, ruleContext);
  const target = extractFormattingSignature(targetText, ruleContext);
  const inheritedTarget = inheritedTargetText ? extractFormattingSignature(inheritedTargetText, ruleContext) : undefined;
  // Some bilingual formats legitimately carry target-only styling. Once
  // imported, that target signature becomes structural truth: preserve it,
  // but never let it replace a non-empty source signature.
  const nativeTags = source.nativeTags.length ? source.nativeTags : inheritedTarget?.nativeTags ?? source.nativeTags;
  const projectTags = source.projectTags.length ? source.projectTags : inheritedTarget?.projectTags ?? source.projectTags;
  const richTextTags = source.richTextTags.length ? source.richTextTags : inheritedTarget?.richTextTags ?? source.richTextTags;
  const underlineTags = source.underlineTags.length ? source.underlineTags : inheritedTarget?.underlineTags ?? source.underlineTags;
  const candidates = [
    mismatch("native_tag", "NATIVE_TAG_SIGNATURE_MISMATCH", nativeTags, target.nativeTags),
    mismatch("project_tag", "PROJECT_TAG_SIGNATURE_MISMATCH", projectTags, target.projectTags),
    mismatch("rich_text", "RICH_TEXT_SIGNATURE_MISMATCH", richTextTags, target.richTextTags),
    mismatch("underline", "UNDERLINE_SIGNATURE_MISMATCH", underlineTags, target.underlineTags),
    mismatch("placeholder", "PLACEHOLDER_SIGNATURE_MISMATCH", source.placeholders, target.placeholders),
    mismatch("icu_branch", "ICU_BRANCH_ARITY_MISMATCH", source.icuBranches, target.icuBranches),
    mismatch("hard_newline", "HARD_NEWLINE_MISMATCH", source.requiredTargetHardNewlines, target.hardNewlines),
    target.literalNewlines > 0
      ? mismatch("literal_newline", "LITERAL_NEWLINE_MISMATCH", 0, target.literalNewlines)
      : undefined,
  ];
  return {
    source,
    target,
    mismatches: candidates.filter((item): item is FormattingSignatureMismatch => Boolean(item)),
  };
}

export function hasFormattingEvidence(value: string, ruleContext: ProjectTagRuleContext): boolean {
  const signature = extractFormattingSignature(value, ruleContext);
  return Boolean(
    signature.nativeTags.length ||
    signature.projectTags.length ||
    signature.richTextTags.length ||
    signature.underlineTags.length ||
    signature.placeholders.length ||
    signature.icuBranches.length ||
    signature.hardNewlines ||
    signature.literalNewlines,
  );
}
