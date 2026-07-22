import assert from "node:assert/strict";
import { auditTermbaseConflicts, findQualityIssues, resolvePreferredTermbaseEntries } from "@linguist-agent/cat-data";

// v1.9 terminology-consistency QA: flag a segment whose source contains a termbase term but
// whose target is missing the preferred translation.
const entries = [
  { source: "宝石", target: "Gem" },
  { source: "怒火斩", target: "Wrath Strike" },
];

const segments = [
  { id: "s1", source: "勇者宝石", target: "Hero Stone" }, // uses 宝石 but target says Stone, not Gem → finding
  { id: "s2", source: "勇者宝石", target: "Hero Gem" }, // correct → no finding
  { id: "s3", source: "怒火斩造成伤害", target: "Wrath Strike deals damage" }, // correct
  { id: "s4", source: "无关文本", target: "Unrelated text" }, // no term → no finding
  { id: "s5", source: "怒火斩很强", target: "" }, // untranslated → skipped (gate's job)
];

function findTermQualityIssues(
  testSegments: Parameters<typeof findQualityIssues>[0]["segments"],
  preferredTerms: Parameters<typeof findQualityIssues>[0]["preferredTerms"],
) {
  return findQualityIssues({
    batchId: "qa-terminology-test",
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    segments: testSegments,
    preferredTerms,
    tmEntries: [],
  });
}

const findings = findTermQualityIssues(segments, entries);
assert.equal(findings.length, 1, `expected exactly one terminology finding, got ${findings.length}`);
assert.equal(findings[0].segmentId, "s1");
assert.equal(findings[0].sourceTerm, "宝石");
assert.equal(findings[0].expectedTarget, "Gem");
assert.equal(findings[0].code, "TERM_PREFERRED_MISSING");

// Empty termbase → no findings (matches the synthetic empty-termbase case: no termbase imported yet).
assert.equal(findTermQualityIssues(segments, []).length, 0);

// Conflicting imported targets must not become independent "preferred target missing"
// warnings. This reproduces the synthetic conflict regression: the current target can match one
// valid/customer target while a stale imported row claims another target is preferred.
const conflictingEntries = [
  { source: "赤焰擂台", target: "Crimson Arena", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "terms.xlsx", rowNo: 562, origin: "table" as const },
  { source: "赤焰擂台", target: "Crimson Ring", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "terms.xlsx", rowNo: 659, origin: "table" as const },
];
const conflictAudit = auditTermbaseConflicts(conflictingEntries);
assert.equal(conflictAudit.length, 1);
assert.deepEqual(conflictAudit[0].targets.sort(), ["Crimson Arena", "Crimson Ring"].sort());
const conflictAuditWithHistory = auditTermbaseConflicts(conflictingEntries, [], {
  rows: [],
  decisions: [
    {
      source: "赤焰擂台",
      status: "current",
      target: "Crimson Ring",
      reason: "Approved Term Change Log target.",
      evidenceRows: [{ id: "history-1", sourceFile: "terms.xlsx", sheetName: "Term Change Log", rowNo: 659, oldTarget: "Crimson Arena", newTarget: "Crimson Ring", finalConfirm: "Approved", updateDate: "2026-05-31", updatedBy: "Reviewer A", category: "arena" }],
    },
    {
      source: "赤焰擂台",
      status: "deprecated",
      target: "Crimson Arena",
      reason: "Old target differs from approved current target.",
      evidenceRows: [{ id: "history-1", sourceFile: "terms.xlsx", sheetName: "Term Change Log", rowNo: 659, oldTarget: "Crimson Arena", newTarget: "Crimson Ring", finalConfirm: "Approved", updateDate: "2026-05-31", updatedBy: "Reviewer A", category: "arena" }],
    },
  ],
});
const tigerRingEntry = conflictAuditWithHistory[0].entries.find((entry) => entry.target === "Crimson Ring");
assert.equal(tigerRingEntry?.historyStatus, "current");
assert.equal(tigerRingEntry?.authorityTier, "term_history_current");
assert.equal(tigerRingEntry?.historyRows?.[0]?.rowNo, 659);
assert.equal(tigerRingEntry?.historyRows?.[0]?.category, "arena");
assert.equal(tigerRingEntry?.historyRows?.[0]?.updatedBy, "Reviewer A");
const tigerArenaEntry = conflictAuditWithHistory[0].entries.find((entry) => entry.target === "Crimson Arena");
assert.equal(tigerArenaEntry?.historyStatus, "deprecated");
assert.equal(tigerArenaEntry?.authorityTier, "term_history_deprecated");
assert.equal(
  findTermQualityIssues([{ id: "s6", source: "获得1个赤焰擂台。", target: "Gain 1 Crimson Ring." }], resolvePreferredTermbaseEntries(conflictingEntries)).length,
  0,
);

// Once the customer/session override exists, QA should use only that preferred target.
const preferredWithOverride = resolvePreferredTermbaseEntries(conflictingEntries, [
  { source: "赤焰擂台", target: "Crimson Ring", srcLang: "zh-CN", tgtLang: "en-US", reason: "Customer confirmed after Phrase QA" },
]);
assert.equal(preferredWithOverride.length, 1);
assert.equal(preferredWithOverride[0].target, "Crimson Ring");
const overrideFindings = findTermQualityIssues([{ id: "s7", source: "获得1个赤焰擂台。", target: "Gain 1 Crimson Arena." }], preferredWithOverride);
assert.equal(overrideFindings.length, 1);
assert.equal(overrideFindings[0].expectedTarget, "Crimson Ring");

// Exact compound terms must suppress their shorter base terms within the same source span.
// synthetic compound example: 星火降临残卡 is Starfall Fragment, not a composition from 星火降临.
const compoundEntries = [
  { source: "星火降临", target: "Starfall Descent" },
  { source: "星火降临残卡", target: "Starfall Fragment" },
];
assert.equal(
  findTermQualityIssues([{ id: "s8", source: "获得1张星火降临残卡。", target: "Gain 1 Starfall Fragment." }], compoundEntries).length,
  0,
);
const compoundFindings = findTermQualityIssues([{ id: "s9", source: "获得1张星火降临残卡。", target: "Gain 1 Star Descent Fragment." }], compoundEntries);
assert.equal(compoundFindings.length, 1);
assert.equal(compoundFindings[0].sourceTerm, "星火降临残卡");
assert.equal(compoundFindings[0].expectedTarget, "Starfall Fragment");

// Overrides for terms missing from imported assets must still enter the preferred
// term set, otherwise the imported base term can keep firing.
const preferredMissingExact = resolvePreferredTermbaseEntries([{ source: "星火降临", target: "Starfall Descent" }], [
  { source: "星火降临残卡", target: "Starfall Fragment", srcLang: "zh-CN", tgtLang: "en-US", reason: "Customer exact term" },
]);
assert.equal(
  findTermQualityIssues([{ id: "s10", source: "星火降临残卡", target: "Starfall Fragment" }], preferredMissingExact).length,
  0,
);

console.log("qa_terminology tests passed");
