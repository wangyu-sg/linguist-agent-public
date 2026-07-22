import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProjectTagRuleEvidence,
  confirmProjectTagRule,
  disableProjectTagRule,
  discoverTagRulesFromEvidence,
  readProjectTagRuleContext,
  readProjectTagRules,
  writeProjectTagRuleCandidates,
  type TagRule,
} from "@linguist-agent/cat-data";

const evidence = buildProjectTagRuleEvidence([
  {
    batchId: "b1",
    segmentId: "s1",
    source: "<color=red>暴击</color>造成{damage}点伤害",
    target: "<color=red>Crit</color> deals {damage} damage",
  },
  {
    batchId: "b1",
    segmentId: "s2",
    source: "获得<color=blue>护盾</color>",
    target: "Gain <color=blue>Shield</color>",
  },
]);
const dntEvidence = buildProjectTagRuleEvidence([
  { batchId: "b0", segmentId: "s0", source: "Keep PLAYER_ID and hero.name", target: "保留 PLAYER_ID 和 hero.name" },
]);
assert.ok(dntEvidence.suspectSpans.some((row) => row.text === "PLAYER_ID"), "filter-agent evidence should include all-caps DNT-like spans");
assert.ok(dntEvidence.suspectSpans.some((row) => row.text === "hero.name"), "filter-agent evidence should include code-ish DNT-like spans");

const longEvidence = buildProjectTagRuleEvidence([
  ...Array.from({ length: 80 }, (_, index) => ({
    batchId: "long",
    segmentId: `s${index + 1}`,
    source: `ordinary source ${index + 1}`,
    target: `ordinary target ${index + 1}`,
  })),
  { batchId: "long", segmentId: "s81", source: "Late {critical_token}", target: "末尾 {critical_token}" },
]);
assert.equal(longEvidence.coverage?.totalSegments, 81);
assert.ok(
  longEvidence.observedTokens.some((row) => row.token === "{critical_token}" && row.segmentIds.includes("s81")),
  "deterministic safety discovery must scan beyond the provider prompt preview",
);
const longDiscovery = await discoverTagRulesFromEvidence(longEvidence);
assert.ok(longDiscovery.trace.some((row) => row.includes("deterministic scan 81/81") && row.includes("provider preview 80/81")));
assert.ok(longDiscovery.candidates.some((row) => row.pattern === "\\{critical_token\\}"));

// No model wired: status stays honest, but the deterministic bootstrap still
// surfaces the co-occurring markup (</color>, <color=...>, {damage}) so an
// obviously-tagged batch never shows an empty panel.
const notConfigured = await discoverTagRulesFromEvidence(evidence);
assert.equal(notConfigured.assistantStatus, "not_configured");
assert.ok(notConfigured.candidates.length > 0, "bootstrap should synthesize candidates from co-occurring markup");
assert.ok(notConfigured.candidates.every((row) => row.origin === "discovered"));
assert.ok(notConfigured.candidates.every((row) => row.status === "candidate"));
assert.ok(notConfigured.trace.some((row) => row.includes("global provider not configured")));
assert.ok(notConfigured.trace.some((row) => row.includes("deterministic bootstrap")));
// Highest source/target coverage token surfaces first; literals are regex-escaped.
assert.equal(notConfigured.candidates[0].pattern, "</color>");
assert.ok(notConfigured.candidates.some((row) => row.pattern === "\\{damage\\}"));

const bbcodeEvidence = buildProjectTagRuleEvidence([
  {
    batchId: "b2",
    segmentId: "s1",
    source: "Use [color=#78dd54]{num} diamonds[/color]",
    target: "使用 [color=#78dd54]{num} 钻石[/color]",
  },
]);
const bbcodeBootstrap = await discoverTagRulesFromEvidence(bbcodeEvidence);
assert.ok(
  bbcodeBootstrap.candidates.some((row) => row.id === "discovered-bbcode" && row.pattern === "\\[\\/?(?:color|size|b|i|u)(?:=[^\\]]+)?\\]"),
  "bootstrap must surface BBCode color tags as a project-level generalized candidate",
);

const gameColorBootstrap = await discoverTagRulesFromEvidence(buildProjectTagRuleEvidence([
  { batchId: "b3", segmentId: "s1", source: "Use @#f80 and #r", target: "使用 @#f80 和 #r" },
]));
assert.ok(
  gameColorBootstrap.candidates.some((row) => row.id === "discovered-game-color"),
  "bootstrap must surface game color/control codes as a project-level generalized candidate",
);

const sourcePreflightEvidence = buildProjectTagRuleEvidence([
  {
    batchId: "b4",
    segmentId: "s1",
    source: "[27CA28]{0}[-] <a^点击前往^a>",
    target: "",
  },
]);
const sourcePreflight = await discoverTagRulesFromEvidence(sourcePreflightEvidence, async () => JSON.stringify({
  rules: [
    {
      id: "bad-source-body",
      class: "formatting",
      pattern: "点击前往",
      flags: "g",
      confidence: 0.9,
      examples: [{ batchId: "b4", segmentId: "s1", text: "点击前往" }],
    },
  ],
}));
assert.equal(sourcePreflight.assistantStatus, "ready");
assert.ok(
  sourcePreflight.candidates.some((row) => row.id === "discovered-bracket-color"),
  "source-only preflight must surface bracket color/reset tokens before targets exist",
);
assert.ok(
  sourcePreflight.candidates.some((row) => row.pattern === "\\{0\\}"),
  "source-only preflight must surface placeholder tokens before targets exist",
);
assert.ok(
  sourcePreflight.candidates.some((row) => row.pattern === "<a\\^点击前往\\^a>"),
  "source-only preflight must surface literal angle control tags before targets exist",
);
assert.ok(
  sourcePreflight.rejected.some((row) => row.id === "bad-source-body" && row.reason === "pattern has no source-target co-occurrence"),
  "model-proposed ordinary source text must still be rejected instead of becoming a lock rule",
);

const induced = await discoverTagRulesFromEvidence(evidence, async () => JSON.stringify({
  rules: [
    {
      id: "color-tags",
      class: "formatting",
      pattern: "<\\/?color(?:=[^>]+)?>",
      flags: "g",
      confidence: 0.96,
      examples: [{ batchId: "b1", segmentId: "s1", text: "<color=red>" }],
      note: "Color markup should be preserved.",
      status: "active",
    },
    {
      id: "bad-regex",
      class: "formatting",
      pattern: "(<color=+",
      confidence: 0.95,
      examples: [{ batchId: "b1", segmentId: "s1", text: "<color=red>" }],
    },
    {
      id: "missing-example",
      class: "placeholder",
      pattern: "\\{missing\\}",
      confidence: 0.95,
      examples: [{ batchId: "b1", segmentId: "s404", text: "{missing}" }],
    },
    {
      id: "source-only",
      class: "placeholder",
      pattern: "暴击",
      confidence: 0.95,
      examples: [{ batchId: "b1", segmentId: "s1", text: "暴击" }],
    },
  ],
}));

assert.equal(induced.assistantStatus, "ready");
assert.equal(induced.candidates.length, 1);
assert.equal(induced.candidates[0].id, "color-tags");
assert.equal(induced.candidates[0].status, "candidate");
assert.equal(induced.candidates[0].origin, "llm");
assert.equal(induced.candidates[0].segmentCoverage, 2);
assert.equal(induced.rejected.length, 3);
assert.ok(induced.trace.some((row) => row.includes("model returned 4 rule row")));
assert.ok(induced.trace.some((row) => row.includes("accepted 1 model candidate")));
assert.deepEqual(
  induced.rejected.map((row) => row.id).sort(),
  ["bad-regex", "missing-example", "source-only"],
);

const phraseSpanEvidence = buildProjectTagRuleEvidence([
  {
    batchId: "mxliff",
    segmentId: "s6339",
    source: "{u>点击打开数据统计界面<u}",
    target: "{u>Tap to open the Stats Interface<u}",
  },
]);
const phraseSpan = await discoverTagRulesFromEvidence(phraseSpanEvidence, async () => JSON.stringify({
  rules: [
    {
      id: "phrase-span",
      class: "paired",
      pattern: "\\{u>.*?<u\\}",
      flags: "g",
      confidence: 0.95,
      examples: [{ batchId: "mxliff", segmentId: "s6339", text: "{u>点击打开数据统计界面<u}" }],
      note: "Bad model output: this swallows translatable text.",
    },
  ],
}));
assert.equal(phraseSpan.candidates.length, 0, "rules that swallow translated body text must not become candidates");
assert.ok(phraseSpan.rejected.some((row) => row.id === "phrase-span" && row.reason.includes("translatable body")));

// E (Filter agent E2/E3): the model classifies each suspect DNT span. A "protect"
// verdict WITH a safe regex generalization becomes a confirmable candidate (still
// requires confirm to enter the hot path); a "protect" verdict that cannot be
// generalized is flagged for human review and protects NOTHING automatically; a
// "translatable" verdict yields no artifact. The Filter agent complements the
// deterministic table — it never silently auto-protects a context-specific word.
const filtered = await discoverTagRulesFromEvidence(dntEvidence, async () => JSON.stringify({
  rules: [],
  spanVerdicts: [
    { span: "PLAYER_ID", verdict: "protect", generalization: "[A-Z][A-Z0-9_]{2,}", reason: "All-caps identifier copied through untranslated." },
    { span: "hero.name", verdict: "protect", reason: "Field path here, but the same words can be translatable elsewhere — cannot generalize safely." },
    { span: "Keep", verdict: "translatable", reason: "Ordinary imperative verb." },
  ],
}));

assert.equal(filtered.assistantStatus, "ready");
// Generalizable protect → candidate on the regex, origin llm, status candidate (not yet active).
const protectCandidate = filtered.candidates.find((row) => row.pattern === "[A-Z][A-Z0-9_]{2,}");
assert.ok(protectCandidate, "generalizable protect span must become a confirmable candidate");
assert.equal(protectCandidate?.status, "candidate");
assert.equal(protectCandidate?.origin, "llm");
// Non-generalizable protect → human-review flag, and ABSENT from candidates (never auto-protected, never in the hot path).
assert.ok(
  filtered.humanReviewSpans.some((row) => row.span === "hero.name"),
  "non-generalizable protect span must be flagged for human review",
);
assert.ok(
  !filtered.candidates.some((row) => row.pattern.includes("hero") || row.id.includes("hero")),
  "human-review span must never leak into candidates / the deterministic hot path",
);
// Translatable verdict → no artifact at all (neither candidate nor human-review flag).
assert.ok(!filtered.humanReviewSpans.some((row) => row.span === "Keep"), "translatable span must not be flagged");
assert.ok(
  !filtered.candidates.some((row) => row.id.includes("Keep") || row.pattern.includes("Keep")),
  "translatable span must not become a candidate",
);

const root = await mkdtemp(join(tmpdir(), "la-tag-rules-"));
try {
  assert.deepEqual((await readProjectTagRules(root, "proj")).rules, []);
  assert.deepEqual((await readProjectTagRuleContext(root, "proj")).activeProjectRules, []);

  const legacyDir = join(root, "data", "projects", "legacy");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "tag_rules.json"), JSON.stringify({
    schemaVersion: 1,
    projectId: "legacy",
    generatedAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    rulesDigest: "sha256:legacy",
    rules: [{
      id: "legacy-bad-span",
      class: "paired",
      pattern: "\\{u>.*?<u\\}",
      flags: "g",
      origin: "llm",
      status: "active",
      confidence: 0.95,
      occurrences: 2,
      segmentCoverage: 1,
      examples: [],
    }],
    disabledBuiltinIds: [],
    onboarding: { status: "confirmed" },
    trace: [],
  }, null, 2));
  const normalizedLegacy = await readProjectTagRules(root, "legacy");
  assert.equal(normalizedLegacy.rules[0].status, "disabled", "legacy active rules that swallow body text must self-heal to disabled");
  assert.ok(normalizedLegacy.trace.some((row) => row.includes("legacy-bad-span") && row.includes("translatable body")));

  const written = await writeProjectTagRuleCandidates(root, "proj", induced.candidates);
  assert.equal(written.rules.length, 1);
  assert.equal(written.rules[0].status, "candidate");

  const discoveredWritten = await writeProjectTagRuleCandidates(root, "proj", bbcodeBootstrap.candidates);
  assert.ok(
    discoveredWritten.rules.some((row: TagRule) => row.origin === "discovered"),
    "deterministic bootstrap candidates must keep origin=discovered when written",
  );
  const confirmedBbcode = await confirmProjectTagRule(root, "proj", "discovered-bbcode");
  assert.ok(confirmedBbcode.disabledBuiltinIds.includes("builtin:bbcode"), "confirming generalized BBCode project rule must supersede builtin BBCode");
  await writeProjectTagRuleCandidates(root, "proj", gameColorBootstrap.candidates);
  const confirmedGameColor = await confirmProjectTagRule(root, "proj", "discovered-game-color");
  assert.ok(confirmedGameColor.disabledBuiltinIds.includes("builtin:game-color"), "confirming generalized game-color project rule must supersede builtin game-color");

  const confirmed = await confirmProjectTagRule(root, "proj", "color-tags");
  assert.equal(confirmed.rules.find((rule: TagRule) => rule.id === "color-tags")?.status, "active");
  const context = await readProjectTagRuleContext(root, "proj");
  assert.deepEqual(context.activeProjectRules.map((row) => row.id).sort(), ["color-tags", "discovered-bbcode", "discovered-game-color"]);

  const disabled = await disableProjectTagRule(root, "proj", "color-tags");
  assert.equal(disabled.rules.find((rule: TagRule) => rule.id === "color-tags")?.status, "disabled");
  assert.deepEqual((await readProjectTagRuleContext(root, "proj")).activeProjectRules.map((row) => row.id).sort(), ["discovered-bbcode", "discovered-game-color"]);

  // Regression (staleness hole): disabling a superseding project rule must RESTORE its
  // builtin safety net. disabledBuiltinIds is derived from the active rule set — never
  // a stale only-grows field — so a confirm→disable cycle can't strand color tags.
  const supersededCtx = await readProjectTagRuleContext(root, "proj");
  assert.deepEqual(supersededCtx.disabledBuiltinIds.slice().sort(), ["builtin:bbcode", "builtin:game-color"]);
  await disableProjectTagRule(root, "proj", "discovered-bbcode");
  assert.deepEqual(
    (await readProjectTagRuleContext(root, "proj")).disabledBuiltinIds,
    ["builtin:game-color"],
    "disabling the BBCode project rule must bring builtin:bbcode protection back",
  );
  await disableProjectTagRule(root, "proj", "discovered-game-color");
  const fullyDisabledCtx = await readProjectTagRuleContext(root, "proj");
  assert.deepEqual(fullyDisabledCtx.activeProjectRules, []);
  assert.deepEqual(fullyDisabledCtx.disabledBuiltinIds, [], "no active superseding rule → no builtin is suppressed");
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("tag_rules_discovery tests passed");
