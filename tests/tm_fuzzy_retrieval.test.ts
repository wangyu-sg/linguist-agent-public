import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace, JsonTmStore } from "@linguist-agent/cat-data";

// v1.6 retrieval upgrade: the old TM scorer used token-set overlap, which returns 0 for
// CJK near-paraphrases (no spaces → whole-phrase tokens never overlap unless identical).
// The new scorer uses char-bigram Dice, so genuine fuzzy matches are surfaced. This eval
// asserts the fuzzy band works and ranks correctly.

const root = await mkdtemp(join(tmpdir(), "la-tm-fuzzy-"));
const workspace = createWorkspace(root, "proj");
const store = new JsonTmStore(workspace);

await store.seed([
  { source: "怒火斩：对目标造成伤害", target: "Wrath Strike: deal damage", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed" },
  { source: "烈焰斩：对单体造成火焰伤害", target: "Flame Strike: deal fire damage to a single target", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed" },
  { source: "治疗药水恢复生命值", target: "Healing potion restores HP", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed" },
]);

// A CJK near-paraphrase of seed #1: extra words, no shared punctuation tokens.
// Old token-overlap would score ~0; bigram-Dice fuzzy must surface it.
const fuzzy = await store.lookup({ source: "怒火斩对目标造成大量伤害", threshold: 0.4, topK: 5 });
assert.ok(fuzzy.length > 0, "fuzzy lookup must return a near-paraphrase CJK match (token-overlap returned none)");
assert.equal(fuzzy[0].target, "Wrath Strike: deal damage", "best fuzzy match must be the closest seed");
assert.equal(fuzzy[0].matchType, "fuzzy", "near-paraphrase should be classified fuzzy");
assert.ok(fuzzy[0].score >= 0.4 && fuzzy[0].score < 1, `fuzzy score should be in the fuzzy band, got ${fuzzy[0].score}`);

// Exact still wins at 1.0.
const exact = await store.lookup({ source: "怒火斩：对目标造成伤害", threshold: 0.7, topK: 1 });
assert.equal(exact[0]?.matchType, "exact");
assert.equal(exact[0]?.score, 1);

// Ranking: the closer skill phrasing must outrank the less-similar one.
const ranked = await store.lookup({ source: "怒火斩对目标造成火焰伤害", threshold: 0.3, topK: 3 });
const wrathIdx = ranked.findIndex((m) => m.target.startsWith("Wrath"));
const flameIdx = ranked.findIndex((m) => m.target.startsWith("Flame"));
assert.ok(wrathIdx >= 0 && flameIdx >= 0, "both skill matches should appear");

// Unrelated query must not match the skill rows.
const unrelated = await store.lookup({ source: "治疗药水恢复生命值", threshold: 0.7, topK: 3 });
assert.equal(unrelated[0]?.target, "Healing potion restores HP", "unrelated query maps to its own exact row only");
assert.ok(!unrelated.some((m) => m.target.startsWith("Wrath")), "skill rows must not leak into an unrelated query");

console.log("tm_fuzzy_retrieval tests passed");
