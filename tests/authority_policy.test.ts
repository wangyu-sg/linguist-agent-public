import assert from "node:assert/strict";
import {
  authorityDecisionRequiresPlatformCheck,
  authorityPriority,
  resolveAuthorityDecision,
  type AuthorityEvidence,
} from "@linguist-agent/cat-data";

assert.equal(authorityPriority("phrase_final_stage"), 100);
assert.equal(authorityPriority("style_guide"), 90);
assert.equal(authorityPriority("exact_compound_term"), 80);
assert.equal(authorityPriority("base_term"), 20);
assert.throws(() => authorityPriority("semantic_recall" as never), /Unknown authority tier/);

const phraseVsLocal = resolveAuthorityDecision([
  {
    id: "local-proposal-1",
    tier: "local_proposal",
    label: "Local proposal",
    target: "Gain 1 War Wraith Fragment.",
  },
  {
    id: "phrase-readback-1",
    tier: "phrase_final_stage",
    label: "Phrase CAT readback",
    target: "Gain 1 Wraithfall Fragment.",
  },
]);
assert.ok(phraseVsLocal);
assert.equal(phraseVsLocal.winner.tier, "phrase_final_stage");
assert.equal(phraseVsLocal.winner.target, "Gain 1 Wraithfall Fragment.");
assert.equal(authorityDecisionRequiresPlatformCheck(phraseVsLocal), false);

const styleVsBase = resolveAuthorityDecision([
  {
    id: "base-gain",
    tier: "base_term",
    label: "Imported termbase row",
    source: "获得",
    target: "Get",
  },
  {
    id: "style-guide-gain",
    tier: "style_guide",
    label: "Style Guide: item acquisition wording",
    source: "获得",
    target: "Gain",
    detail: "Use Gain for item acquisition strings.",
  },
]);
assert.ok(styleVsBase);
assert.equal(styleVsBase.winner.tier, "style_guide");
assert.equal(styleVsBase.winner.target, "Gain");
assert.equal(styleVsBase.rejected[0].tier, "base_term");

const exactCompoundVsBase = resolveAuthorityDecision([
  {
    id: "base-wraith",
    tier: "base_term",
    label: "Base term",
    source: "星火降临",
    target: "War Wraith Descent",
  },
  {
    id: "exact-wraith-fragment",
    tier: "exact_compound_term",
    label: "Exact compound term",
    source: "星火降临残卡",
    target: "Wraithfall Fragment",
  },
]);
assert.ok(exactCompoundVsBase);
assert.equal(exactCompoundVsBase.winner.tier, "exact_compound_term");
assert.equal(exactCompoundVsBase.winner.source, "星火降临残卡");
assert.equal(exactCompoundVsBase.winner.target, "Wraithfall Fragment");

const deterministicTieInput: AuthorityEvidence[] = [
  { id: "z-style", tier: "style_guide", label: "Later style row", target: "A" },
  { id: "a-style", tier: "style_guide", label: "Earlier style row", target: "B" },
];
const deterministicTie = resolveAuthorityDecision(deterministicTieInput);
assert.ok(deterministicTie);
assert.equal(deterministicTie.winner.id, "a-style");

console.log("authority_policy tests passed");
