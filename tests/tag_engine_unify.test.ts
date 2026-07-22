import assert from "node:assert/strict";
import { detectTags, validateTags } from "../packages/cat-data/src/tag_tokens.js";
import { compareFormattingSignatures } from "../packages/cat-data/src/format_signatures.js";
import { GAME_COLOR_PROJECT_PATTERN, deriveProjectTagRuleContext, type TagRule, type TagRuleDocument } from "../packages/cat-data/src/tag_rules_core.js";

function doc(rules: TagRule[], disabledBuiltinIds: string[] = []): TagRuleDocument {
  return {
    schemaVersion: 1,
    projectId: "p",
    generatedAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    rulesDigest: "sha256:test",
    rules,
    disabledBuiltinIds,
    trace: [],
  };
}

function activeRule(id: string, pattern: string, className: TagRule["class"] = "structural"): TagRule {
  return {
    id,
    class: className,
    pattern,
    flags: "g",
    origin: "llm",
    status: "active",
    confidence: 0.99,
    occurrences: 1,
    segmentCoverage: 1,
    examples: [],
  };
}

// ① An active project rule reaches the SAME deterministic resolver chips/validation use.
// `[[hero]]` is not covered by any builtin, so it is invisible without a project rule
// and becomes a first-class protected tag once a rule is active — this is the exact
// "confirm candidate → chip changes" path that was previously broken.
{
  const text = "Greet [[hero]] now";
  assert.equal(detectTags(text).length, 0, "double-bracket token is not a builtin tag");

  const ctx = deriveProjectTagRuleContext(doc([activeRule("dbl-bracket", "\\[\\[[^\\]]+\\]\\]")]));
  const detected = detectTags(text, ctx);
  assert.equal(detected.length, 1, "active project rule must surface the token to detectTags");
  assert.equal(detected[0].kind, "project-tag");
  assert.equal(detected[0].literal, "[[hero]]", "project tag chip must show the complete literal");
  assert.equal(detected[0].id, "dbl-bracket");

  assert.equal(validateTags(text, "Greet now", ctx).blocked, true, "dropping a project tag must block");
  assert.equal(validateTags(text, "Greet [[hero]] now", ctx).blocked, false, "preserved project tag passes");
}

// ② An ACTIVE project rule supersedes a builtin without a hard delete (no regression): the
// builtin is skipped, but the token stays protected — now by the project rule. Critically,
// disabledBuiltinIds is DERIVED from the active rule set, so it can never strand a builtin.
{
  const text = "Color #ff0000 here";
  assert.equal(detectTags(text).length, 1, "#rrggbb is a builtin game-color tag by default");

  const ctx = deriveProjectTagRuleContext(doc([activeRule("proj-game-color", GAME_COLOR_PROJECT_PATTERN)]));
  assert.deepEqual(ctx.disabledBuiltinIds, ["builtin:game-color"], "an active superseding rule disables its builtin");
  const detected = detectTags(text, ctx);
  assert.equal(detected.length, 1, "the color token is still protected — now by the project rule, not the builtin");
  assert.equal(detected[0].id, "proj-game-color");

  // Staleness guard (HARD CONSTRAINT: color must never be missed): a document whose stored
  // disabledBuiltinIds names a builtin with NO active rule to replace it must NOT skip the
  // builtin — the safety net is restored, never left stranded by a stale only-grows field.
  const stale = deriveProjectTagRuleContext(doc([], ["builtin:game-color"]));
  assert.deepEqual(stale.disabledBuiltinIds, [], "stale disabledBuiltinIds without an active superseding rule is ignored");
  assert.equal(detectTags(text, stale).length, 1, "builtin protection is restored when no active rule supersedes it");
}

// ③ Engine B (write/delivery gate) derives its project-tag signature from the same resolver.
{
  const ctx = deriveProjectTagRuleContext(doc([activeRule("dbl-bracket", "\\[\\[[^\\]]+\\]\\]")]));
  const cmp = compareFormattingSignatures("Greet [[hero]] now", "Greet now", ctx);
  assert.equal(cmp.source.projectTags.join("|"), "dbl-bracket:[[hero]]", "gate signature uses ruleId:literal");
  assert.equal(
    cmp.mismatches.some((m) => m.code === "PROJECT_TAG_SIGNATURE_MISMATCH"),
    true,
    "gate must flag the dropped project tag exactly as the chips do",
  );
}

// ④ Existing bad active data is dropped at context derivation: a paired project rule
// must not protect the translated body inside matching delimiters as the tag literal.
{
  const ctx = deriveProjectTagRuleContext(doc([activeRule("bad-phrase-span", "\\{u>.*?<u\\}", "paired")]));
  assert.deepEqual(ctx.activeProjectRules, [], "paired rules that wildcard across body text must be disabled in the hot path");
  assert.ok(ctx.trace.some((row) => row.includes("translatable body")));
}

// ⑤ The game's <a^visible text^a> dialect carries translatable link text.
// Protect placeholders inside it, never the source-language payload itself.
{
  const ctx = deriveProjectTagRuleContext(doc([activeRule("bad-caret-link", "<a\\^点击前往\\^a>")]));
  assert.deepEqual(ctx.activeProjectRules, [], "exact caret-link payload must not become an immutable project tag");
  assert.ok(ctx.trace.some((row) => row.includes("translatable body")));
}

// ⑥ Imported target-only styling is legitimate format evidence. Preserve it
// during review, but reject an edit that drops the inherited wrapper.
{
  const ctx = deriveProjectTagRuleContext(doc([]));
  const inherited = compareFormattingSignatures("正片", "{g0}Main{/g0}", ctx, "{g0}Main{/g0}");
  assert.equal(inherited.mismatches.some((row) => row.code === "NATIVE_TAG_SIGNATURE_MISMATCH"), false);
  const dropped = compareFormattingSignatures("正片", "Main", ctx, "{g0}Main{/g0}");
  assert.equal(dropped.mismatches.some((row) => row.code === "NATIVE_TAG_SIGNATURE_MISMATCH"), true);
}

console.log("tag_engine_unify tests passed");
