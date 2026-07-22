import { compileTagRule, type ProjectTagRuleContext, type TagRule } from "./tag_rules_core.js";

// Re-export the pure context model from the runtime-safe subpath so non-Node
// consumers can derive ProjectTagRuleContext without importing fs-bound helpers.
export { deriveProjectTagRuleContext } from "./tag_rules_core.js";
export type { ProjectTagRuleContext, TagRule, TagRuleDocument } from "./tag_rules_core.js";

export type TagTone = "fmt" | "num" | "named" | "newline";

export interface DetectedTag {
  literal: string;
  kind:
    | "xliff"
    | "phrase-format"
    | "game-format"
    | "placeholder-num"
    | "placeholder-named"
    | "escape"
    | "project-tag";
  id: string | null;
  index: number;
  pairKey: string;
  tone: TagTone;
  label: string;
}

export interface RenderTokenText {
  kind: "text";
  value: string;
}

export interface RenderTokenTag {
  kind: "tag";
  tag: DetectedTag;
}

export type RenderToken = RenderTokenText | RenderTokenTag;

export interface TagValidationResult {
  sourceTags: DetectedTag[];
  targetTags: DetectedTag[];
  missing: DetectedTag[];
  extra: DetectedTag[];
  missingKeys: Set<string>;
  extraKeys: Set<string>;
  blocked: boolean;
}

export interface SourceTagChipRow {
  tag: DetectedTag;
  needed: number;
  present: number;
}

interface PatternRule {
  /** Stable id so a project rule can supersede a builtin via `disabledBuiltinIds`. */
  id: string;
  priority: number;
  regex: RegExp;
  kind: DetectedTag["kind"];
  tone: TagTone;
  idOf?: (match: RegExpExecArray) => string | null;
  labelOf?: (literal: string, id: string | null) => string;
}

// Builtin baseline: format-defined, project-independent markup (the CAT-industry
// equivalent of an import filter's inline tags). Game-specific patterns
// (BBCode, @#hex/#rnt color codes) carry stable ids so a project can supersede
// them with discovered rules via `disabledBuiltinIds` — never hard-deleted, so
// there is no coverage regression when a project has no rules yet.
const RULES: PatternRule[] = [
  {
    id: "builtin:xliff-paired",
    priority: 10,
    regex: /<(bpt|ept|ph|it|mrk|g|x|bx|ex)\b[^>]*>[\s\S]*?<\/\1>/gi,
    kind: "xliff",
    tone: "fmt",
    idOf: (m) => /\bid\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? null,
  },
  {
    id: "builtin:xliff-empty",
    priority: 12,
    regex: /<(x|bx|ex)\b[^>]*?\/>/gi,
    kind: "xliff",
    tone: "fmt",
    idOf: (m) => /\bid\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? null,
  },
  {
    id: "builtin:phrase-format",
    priority: 15,
    regex: /\{[A-Za-z][A-Za-z0-9_]*>|<[A-Za-z][A-Za-z0-9_]*\}/g,
    kind: "phrase-format",
    tone: "fmt",
  },
  {
    // Inline game/markup tag: any <tag ...> or </tag> with no nested angle brackets.
    // This intentionally accepts no-space attrs such as <color=#ffffff>.
    id: "builtin:html-angle",
    priority: 20,
    regex: /<\/?[a-zA-Z][^<>]*>/g,
    kind: "game-format",
    tone: "fmt",
  },
  {
    // BBCode-style game markup used by some source assets, e.g. [color=#78dd54]...[/color].
    id: "builtin:bbcode",
    priority: 22,
    regex: /\[\/?(?:color|size|b|i|u)(?:=[^\]]+)?\]/gi,
    kind: "game-format",
    tone: "fmt",
  },
  {
    id: "builtin:escape-control",
    priority: 25,
    regex: /\\[ntr]/g,
    kind: "escape",
    tone: "newline",
    labelOf: (literal) => (literal === "\\n" ? "↵" : literal),
  },
  {
    id: "builtin:placeholder-paren",
    priority: 30,
    regex: /\{\([^)]+\)(?:\*[^}]+)?\}/g,
    kind: "placeholder-named",
    tone: "named",
    idOf: (m) => m[0].slice(1, -1),
  },
  {
    id: "builtin:placeholder-dollar",
    priority: 32,
    regex: /\{\$[^}]+\}/g,
    kind: "placeholder-named",
    tone: "named",
    idOf: (m) => m[0].slice(2, -1),
  },
  {
    id: "builtin:placeholder-percent",
    priority: 34,
    regex: /\{%\}/g,
    kind: "placeholder-named",
    tone: "named",
    idOf: () => "%",
  },
  {
    id: "builtin:placeholder-caret",
    priority: 36,
    regex: /\{\^[^}]+\}/g,
    kind: "placeholder-named",
    tone: "named",
    idOf: (m) => m[0].slice(2, -1),
  },
  {
    id: "builtin:placeholder-num",
    priority: 40,
    regex: /\{(\d+)(?:[:,][^}]+)?\}/g,
    kind: "placeholder-num",
    tone: "num",
    idOf: (m) => m[1],
  },
  {
    id: "builtin:placeholder-named",
    priority: 50,
    regex: /\{([A-Za-z_][\w]*)(?::[^}]+)?\}/g,
    kind: "placeholder-named",
    tone: "named",
    idOf: (m) => m[1],
  },
  {
    id: "builtin:printf",
    priority: 55,
    regex: /%[sdifuxX]|%%/g,
    kind: "escape",
    tone: "named",
  },
  {
    id: "builtin:game-color",
    priority: 60,
    regex: /@#[0-9a-fA-F]{3,8}|@\d(?!\d)|#[rnt]|#[0-9a-fA-F]{3,8}/g,
    kind: "game-format",
    tone: "fmt",
  },
];

// Project rules win every overlap against builtins: they sort strictly before
// the lowest builtin priority (10). Among themselves, document/array order is
// honored via the stable sort, so discovery can order more-specific first.
const PROJECT_RULE_PRIORITY = -1;

// Compiling a project regex per render would put work on the hot path; memoize
// by pattern+flags. detectTags resets `lastIndex` before every scan, so sharing
// a RegExp object across calls is safe (JS is single-threaded, scans are sync).
const projectRuleRegexCache = new Map<string, RegExp | null>();

function compileProjectRuleRegex(rule: Pick<TagRule, "pattern" | "flags">): RegExp | null {
  const key = `${rule.pattern} ${rule.flags ?? ""}`;
  if (projectRuleRegexCache.has(key)) return projectRuleRegexCache.get(key) ?? null;
  const compiled = compileTagRule(rule);
  const regex = compiled.regex
    ? new RegExp(compiled.regex.source, compiled.regex.flags.includes("g") ? compiled.regex.flags : `${compiled.regex.flags}g`)
    : null;
  projectRuleRegexCache.set(key, regex);
  return regex;
}

function effectiveRules(ruleContext?: ProjectTagRuleContext): PatternRule[] {
  if (!ruleContext) return RULES;
  const disabled = new Set(ruleContext.disabledBuiltinIds);
  const projectRules: PatternRule[] = [];
  for (const rule of ruleContext.activeProjectRules) {
    const regex = compileProjectRuleRegex(rule);
    if (!regex) continue;
    projectRules.push({
      id: rule.id,
      priority: PROJECT_RULE_PRIORITY,
      regex,
      kind: "project-tag",
      tone: "fmt",
      idOf: () => rule.id,
    });
  }
  const builtins = disabled.size ? RULES.filter((rule) => !disabled.has(rule.id)) : RULES;
  return projectRules.length ? [...projectRules, ...builtins] : builtins;
}

interface ClaimedRange {
  start: number;
  end: number;
}

function overlaps(ranges: ClaimedRange[], start: number, end: number): boolean {
  return ranges.some((range) => !(end <= range.start || start >= range.end));
}

function makePairKey(kind: DetectedTag["kind"], literal: string, id: string | null): string {
  // Project tags are validated literal-exact (matching Engine B's
  // `${ruleId}:${literal}` signature), so two different literals matched by the
  // same rule stay distinct chips and never satisfy each other's count.
  if (kind === "project-tag") return `project-tag:${id ?? "literal"}:${literal}`;
  if (id) return `${kind}:${id}:${literal.startsWith("</") || literal.startsWith("<ept") || literal.startsWith("<ex") ? "close" : "tag"}`;
  return `${kind}:literal:${literal}`;
}

function makeLabel(literal: string): string {
  if (literal === "\\n") return "↵";
  return literal;
}

/**
 * The single deterministic tag resolver. When a `ruleContext` is supplied the
 * project's active rules are injected at the highest precedence into the same
 * priority-sorted, overlap-claiming scan as the builtins, and any builtin in
 * `disabledBuiltinIds` is skipped — so chips, validation and the write/delivery
 * gates all see the exact same project-aware truth. Without a context it falls
 * back to the builtin baseline (backward compatible).
 */
export function detectTags(text: string, ruleContext?: ProjectTagRuleContext): DetectedTag[] {
  if (!text) return [];
  const claimed: ClaimedRange[] = [];
  const tags: DetectedTag[] = [];
  for (const rule of [...effectiveRules(ruleContext)].sort((a, b) => a.priority - b.priority)) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text)) !== null) {
      const literal = match[0];
      if (!literal) {
        rule.regex.lastIndex += 1;
        continue;
      }
      const start = match.index;
      const end = start + literal.length;
      if (overlaps(claimed, start, end)) continue;
      claimed.push({ start, end });
      const id = rule.idOf?.(match) ?? null;
      tags.push({
        literal,
        kind: rule.kind,
        id,
        index: start,
        pairKey: makePairKey(rule.kind, literal, id),
        tone: rule.tone,
        label: rule.labelOf?.(literal, id) ?? makeLabel(literal),
      });
    }
  }
  return tags.sort((a, b) => a.index - b.index);
}

export function tokenizeTags(text: string, ruleContext?: ProjectTagRuleContext): RenderToken[] {
  const tags = detectTags(text, ruleContext);
  const tokens: RenderToken[] = [];
  let offset = 0;
  for (const tag of tags) {
    if (tag.index > offset) tokens.push({ kind: "text", value: text.slice(offset, tag.index) });
    tokens.push({ kind: "tag", tag });
    offset = tag.index + tag.literal.length;
  }
  if (offset < text.length) tokens.push({ kind: "text", value: text.slice(offset) });
  return tokens;
}

function countByKey(tags: DetectedTag[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of tags) counts.set(tag.pairKey, (counts.get(tag.pairKey) ?? 0) + 1);
  return counts;
}

export function validateTags(source: string, target: string, ruleContext?: ProjectTagRuleContext): TagValidationResult {
  const sourceTags = detectTags(source, ruleContext);
  const targetTags = detectTags(target, ruleContext);
  const sourceCounts = countByKey(sourceTags);
  const targetCounts = countByKey(targetTags);
  const missing: DetectedTag[] = [];
  const extra: DetectedTag[] = [];
  for (const [key, count] of sourceCounts) {
    const targetCount = targetCounts.get(key) ?? 0;
    if (targetCount < count) {
      const sample = sourceTags.find((tag) => tag.pairKey === key);
      if (sample) for (let i = 0; i < count - targetCount; i += 1) missing.push(sample);
    }
  }
  for (const [key, count] of targetCounts) {
    const sourceCount = sourceCounts.get(key) ?? 0;
    if (count > sourceCount) {
      const sample = targetTags.find((tag) => tag.pairKey === key);
      if (sample) for (let i = 0; i < count - sourceCount; i += 1) extra.push(sample);
    }
  }
  return {
    sourceTags,
    targetTags,
    missing,
    extra,
    missingKeys: new Set(missing.map((tag) => tag.pairKey)),
    extraKeys: new Set(extra.map((tag) => tag.pairKey)),
    blocked: missing.length > 0,
  };
}

export function tagCount(text: string, ruleContext?: ProjectTagRuleContext): number {
  return detectTags(text, ruleContext).length;
}

export function stripTagsForCount(value: string, ruleContext?: ProjectTagRuleContext): string {
  return tokenizeTags(value, ruleContext)
    .filter((token) => token.kind === "text")
    .map((token) => (token as RenderTokenText).value)
    .join("");
}

export function sourceTagChipRows(source: string, target: string, ruleContext?: ProjectTagRuleContext): SourceTagChipRow[] {
  const sourceTags = detectTags(source, ruleContext);
  const targetCounts = countByKey(detectTags(target, ruleContext));
  const rows = new Map<string, SourceTagChipRow>();
  for (const tag of sourceTags) {
    const row = rows.get(tag.pairKey) ?? { tag, needed: 0, present: targetCounts.get(tag.pairKey) ?? 0 };
    row.needed += 1;
    rows.set(tag.pairKey, row);
  }
  return [...rows.values()];
}
