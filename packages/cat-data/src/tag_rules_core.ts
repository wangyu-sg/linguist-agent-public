// Pure, filesystem-free core of the project tag-rule model.
//
// This module is imported by the browser-bundled tag tokenizer
// ([tag_tokens.ts](./tag_tokens.ts), exposed via the `./tag-tokens` package
// subpath). It MUST NOT import anything that pulls in Node-only filesystem/crypto
// or the bundle breaks. The filesystem-bound document I/O lives in
// [tag_rules.ts](./tag_rules.ts), which re-exports everything here so existing
// importers keep working.

export type TagRuleClass = "paired" | "singleton" | "formatting" | "structural" | "placeholder";
export type TagRuleOrigin = "llm" | "manual" | "imported" | "discovered";
export type TagRuleStatus = "active" | "candidate" | "disabled";

// Onboarding gate for project tag discovery. A project starts "pending": the user
// has not yet decided what project-specific tag rules apply. There are exactly two
// honest exits: confirm at least one rule ("confirmed"), or explicitly declare the
// project has no extra tag rules ("declared_none"). Either way the UI stops nagging,
// but it NEVER pretends coverage exists that doesn't — a pending/declared_none project
// is plainly shown as running on builtin safety rules only.
export type TagRuleOnboardingStatus = "pending" | "confirmed" | "declared_none";

export interface TagRuleOnboarding {
  status: TagRuleOnboardingStatus;
  updatedAt?: string;
}

export interface TagRuleExample {
  batchId?: string;
  segmentId: string;
  text: string;
}

export interface TagRule {
  id: string;
  class: TagRuleClass;
  pattern: string;
  flags?: string;
  priority?: number;
  origin: TagRuleOrigin;
  status: TagRuleStatus;
  confidence: number;
  occurrences: number;
  segmentCoverage: number;
  examples: TagRuleExample[];
  firstSeen?: string;
  lastSeen?: string;
  note?: string;
  trace?: string[];
}

export interface TagRuleDocument {
  schemaVersion: 1;
  projectId: string;
  generatedAt: string;
  updatedAt: string;
  rulesDigest: string;
  rules: TagRule[];
  disabledBuiltinIds: string[];
  onboarding: TagRuleOnboarding;
  trace: string[];
}

/**
 * Resolve the onboarding status honestly from the stored marker AND the live rule
 * set. Like `disabledBuiltinIds`, this is DERIVED on every read so it can never lie:
 * a project with ≥1 active rule is definitionally onboarded ("confirmed"), no matter
 * what was stored; otherwise an explicit user decision ("declared_none" or a prior
 * "confirmed") is preserved; a fresh project stays "pending" so the required step is
 * surfaced. We never downgrade an explicit decision back to "pending".
 */
export function resolveOnboardingStatus(
  stored: TagRuleOnboardingStatus | undefined,
  rules: Array<Pick<TagRule, "status">>,
): TagRuleOnboardingStatus {
  if (rules.some((rule) => rule.status === "active")) return "confirmed";
  if (stored === "declared_none") return "declared_none";
  if (stored === "confirmed") return "confirmed";
  return "pending";
}

export interface ProjectTagRuleContext {
  mode: "legacy_builtin" | "project";
  rulesDigest: string;
  activeProjectRules: TagRule[];
  /** Builtin tokenizer rule ids the project has superseded; the deterministic engine skips them. */
  disabledBuiltinIds: string[];
  candidateRuleCount: number;
  disabledRuleCount: number;
  trace: string[];
}

export const SUPERSEDABLE_BUILTIN_RULE_IDS = ["builtin:bbcode", "builtin:game-color"] as const;

// Generalized project-rule patterns the deterministic discovery bootstrap emits for
// the two supersedable builtins. Single-sourced HERE (the pure core) so the discovery
// generator and the supersede mapping below cannot drift out of string-equality — they
// import these instead of re-typing the literal.
export const BBCODE_PROJECT_PATTERN = "\\[\\/?(?:color|size|b|i|u)(?:=[^\\]]+)?\\]";
export const GAME_COLOR_PROJECT_PATTERN = "@#[0-9a-fA-F]{3,8}|@\\d(?!\\d)|#[rnt]|#[0-9a-fA-F]{3,8}";
export const BRACKET_COLOR_PROJECT_PATTERN = "\\[(?:[0-9a-fA-F]{3,8}|-)\\]";

export function builtinIdsSupersededByRule(rule: Pick<TagRule, "pattern">): string[] {
  const ids: string[] = [];
  if (rule.pattern === BBCODE_PROJECT_PATTERN) ids.push("builtin:bbcode");
  if (rule.pattern === GAME_COLOR_PROJECT_PATTERN) ids.push("builtin:game-color");
  return ids;
}

/**
 * Builtin tokenizer ids the given (already-active) project rules supersede. A pure
 * function of the active rule set — never read from stored state. Confirming a
 * generalized rule disables its builtin; disabling that rule restores the builtin.
 * This is what kills the staleness hole: `disabledBuiltinIds` can only grow as long
 * as a superseding rule is active, so it can never strand a color tag unprotected.
 */
export function deriveDisabledBuiltinIds(activeRules: Array<Pick<TagRule, "pattern">>): string[] {
  const ids = new Set<string>();
  for (const rule of activeRules) {
    for (const id of builtinIdsSupersededByRule(rule)) ids.add(id);
  }
  return [...ids];
}

export function tagRuleConsumesVariableBody(rule: Pick<TagRule, "class" | "pattern">): boolean {
  // ponytail: project "paired" rules are token rules, not span parsers; split open/close tokens if body-aware pairing is needed.
  if (rule.class === "paired" && /\.[*+][?+]?/.test(rule.pattern)) return true;
  // Some games encode a clickable link as <a^visible copy^a>. Discovery can
  // observe one literal instance and mistake the whole span for an immutable
  // tag. The wrapper is structural, but its body is player-facing text.
  return /^<a\\\^.+\\\^a>$/i.test(rule.pattern);
}

export function compileTagRule(rule: Pick<TagRule, "pattern" | "flags">): { regex?: RegExp; error?: string } {
  try {
    // ponytail: heuristic ReDoS lint; replace with a regex parser if untrusted user regex becomes common.
    if (rule.pattern.length > 240 || /\([^)]*[*+][^)]*\)\s*[*+{]/.test(rule.pattern)) return { error: "regex failed safety lint" };
    const rawFlags = rule.flags ?? "g";
    if (/[^dgimsuvy]/.test(rawFlags)) return { error: "regex flags contain unsupported characters" };
    const flags = Array.from(new Set(rawFlags.split(""))).join("") || "g";
    const regex = new RegExp(rule.pattern, flags);
    if (new RegExp(rule.pattern, flags.replace("g", "")).test("")) return { error: "regex matches empty string" };
    return { regex };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Derive the deterministic rule context the tokenizer/gates consume from a tag
 * rule document. Pure — no filesystem; safe for the browser bundle. Active
 * rules that fail to compile are dropped (and noted in `trace`) so a bad regex
 * can never crash the hot path.
 */
export function deriveProjectTagRuleContext(doc: TagRuleDocument): ProjectTagRuleContext {
  const trace = [...doc.trace];
  const activeProjectRules = doc.rules.filter((rule) => {
    if (rule.status !== "active") return false;
    if (tagRuleConsumesVariableBody(rule)) {
      trace.push(`Rule ${rule.id} disabled for context: pattern appears to include translatable body text`);
      return false;
    }
    const compiled = compileTagRule(rule);
    if (!compiled.regex) {
      trace.push(`Rule ${rule.id} disabled for context: ${compiled.error ?? "regex compile failed"}`);
      return false;
    }
    return true;
  });
  return {
    mode: doc.rules.length ? "project" : "legacy_builtin",
    rulesDigest: doc.rulesDigest,
    activeProjectRules,
    // Derive from the COMPILED active rules, not the stored field: a disabled/removed
    // superseding rule restores its builtin, and a broken active regex never strands a
    // builtin (its rule was already dropped from activeProjectRules above).
    disabledBuiltinIds: deriveDisabledBuiltinIds(activeProjectRules),
    candidateRuleCount: doc.rules.filter((rule) => rule.status === "candidate").length,
    disabledRuleCount: doc.rules.filter((rule) => rule.status === "disabled").length,
    trace,
  };
}
