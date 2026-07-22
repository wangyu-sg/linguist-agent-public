import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBatchConstraintPack,
  buildSegmentConstraintPackSnapshot,
  confirmProjectTagRule,
  createManualProjectTagRuleCandidate,
  createProjectManifest,
  createTmStore,
  createWorkspace,
  importCsvBatch,
  upsertVoiceProfile,
  workspacePath,
  writeJsonFile,
  type TermbaseEntry,
} from "@linguist-agent/cat-data";
import { buildCatTools } from "@linguist-agent/cat-tools";

const root = await mkdtemp(join(tmpdir(), "la-constraint-pack-"));
const customerRoot = join(root, "customer");
await mkdir(customerRoot, { recursive: true });
const csvPath = join(customerRoot, "batch.csv");
await writeFile(
  csvPath,
  [
    "SegmentID,Source,Target,Status",
    // s1: termbase term + exact TM match + tag signature + duplicate of s2
    "s1,<color=red>天关</color>开启,<color=red>Celestial Gate</color> opens,draft",
    "s2,<color=red>天关</color>开启,<color=red>Celestial Gate</color> opens,draft",
    // s3: number constraint, no term
    "s3,获得500金币,Gain 500 gold,draft",
  ].join("\n"),
  "utf8",
);

await createProjectManifest(root, customerRoot, { projectId: "cp", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
await importCsvBatch(root, { projectId: "cp", csvPath, batchId: "b1" });

const workspace = createWorkspace(root, "cp");
await writeJsonFile(workspacePath(workspace, "termbase.json"), [
  { id: "tb-1", source: "天关", target: "Celestial Gate", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb.xlsx", rowNo: 1, origin: "table" } as TermbaseEntry,
]);
await writeJsonFile(workspacePath(workspace, "glossary.json"), [
  { id: "gl-1", source: "开启", target: "opens", sourceFile: "glossary.csv", rowNo: 2 },
]);
await writeJsonFile(workspacePath(workspace, "termbase.json"), [
  { id: "tb-wrong-locale", source: "天关", target: "Tenkan", srcLang: "ja-JP", tgtLang: "en-US", sourceFile: "ja-tb.xlsx", rowNo: 1, origin: "table" } as TermbaseEntry,
]);
const wrongLocalePack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s1" });
assert.equal(wrongLocalePack.constraints.some((constraint) => constraint.kind === "terminology" && constraint.requiredTarget === "Tenkan"), false, "a different locale pair cannot become binding fallback authority");
await createTmStore(workspace).seed([
  { id: "tm-wrong-locale", source: "<color=red>天关</color>开启", target: "Falsche Sprache", srcLang: "zh-CN", tgtLang: "de-DE", origin: "reviewed", quality: 100 },
]);
const wrongLocaleTmPack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s1" });
assert.equal(wrongLocaleTmPack.constraints.some((constraint) => constraint.kind === "exact_tm"), false, "a different TM locale pair cannot become binding fallback authority");
await writeJsonFile(workspacePath(workspace, "termbase.json"), [
  { id: "tb-1", source: "天关", target: "Celestial Gate", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb.xlsx", rowNo: 1, origin: "table" } as TermbaseEntry,
]);
await createTmStore(workspace).seed([
  { id: "tm-1", source: "<color=red>天关</color>开启", target: "<color=red>Celestial Gate</color> opens", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed", quality: 100 },
  { id: "tm-fuzzy-1", source: "获得500金", target: "Gain 500 gold", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed", quality: 100 },
]);

// --- per-segment constraint pack: s1 has term + exact TM + tag + duplicate ---
const s1Pack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s1" });
assert.equal(s1Pack.segmentId, "s1");
const kinds = s1Pack.constraints.map((constraint) => constraint.kind);
assert.ok(kinds.includes("terminology"), "s1 should have a terminology constraint for 天关");
assert.ok(kinds.includes("exact_tm"), "s1 should have an exact_tm constraint");
assert.ok(kinds.includes("tag_signature"), "s1 should have a tag_signature constraint");
assert.ok(kinds.includes("duplicate_group"), "s1 should have a duplicate_group constraint (s2 is a sibling)");
const termConstraint = s1Pack.constraints.find((constraint) => constraint.kind === "terminology");
assert.equal(termConstraint?.severity, "blocker");
assert.equal(termConstraint?.requiredTarget, "Celestial Gate");
assert.equal(termConstraint?.sourceTerm, "天关");
assert.equal(termConstraint?.authority, "termbase");
const glossaryConstraint = s1Pack.constraints.find((constraint) => constraint.kind === "terminology" && constraint.authority === "glossary");
assert.equal(glossaryConstraint?.severity, "blocker");
assert.equal(glossaryConstraint?.sourceTerm, "开启");
assert.equal(glossaryConstraint?.requiredTarget, "opens");
const exactTm = s1Pack.constraints.find((constraint) => constraint.kind === "exact_tm");
assert.equal(exactTm?.severity, "blocker");
assert.equal(exactTm?.authority, "reviewed_tm");
const dup = s1Pack.constraints.find((constraint) => constraint.kind === "duplicate_group");
assert.deepEqual(dup?.siblingSegmentIds, ["s2"]);
assert.ok(s1Pack.summary.blockerConstraints >= 3, "term + exact_tm + tag_signature are blockers");

// --- duplicate sibling is bidirectional: s2 lists s1 ---
const s2Pack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s2" });
const s2Dup = s2Pack.constraints.find((constraint) => constraint.kind === "duplicate_group");
assert.deepEqual(s2Dup?.siblingSegmentIds, ["s1"], "duplicate grouping must be bidirectional");

// --- unresolved/replaced terminology is evidence, not binding authority ---
await writeJsonFile(workspacePath(workspace, "termbase.json"), [
  { id: "tb-conflict-1", source: "天关", target: "Celestial Gate", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb-a.xlsx", rowNo: 1, origin: "table" } as TermbaseEntry,
  { id: "tb-conflict-2", source: "天关", target: "Sky Pass", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb-b.xlsx", rowNo: 1, origin: "table" } as TermbaseEntry,
]);
const conflictedPack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s1" });
assert.equal(
  conflictedPack.constraints.some((constraint) => constraint.kind === "terminology" && constraint.authority === "termbase"),
  false,
  "unresolved termbase conflicts must not become competing blockers",
);
await writeJsonFile(workspacePath(workspace, "termbase_overrides.json"), [{ source: "天关", target: "Heavenly Gate", srcLang: "zh-CN", tgtLang: "en-US", reason: "approved" }]);
const overriddenPack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s1" });
const overriddenTerms = overriddenPack.constraints.filter((constraint) => constraint.kind === "terminology" && constraint.authority === "termbase");
assert.deepEqual(overriddenTerms.map((constraint) => constraint.requiredTarget), ["Heavenly Gate"], "only the explicit override may bind");
await writeJsonFile(workspacePath(workspace, "termbase.json"), [
  { id: "tb-1", source: "天关", target: "Celestial Gate", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb.xlsx", rowNo: 1, origin: "table" } as TermbaseEntry,
]);
await writeJsonFile(workspacePath(workspace, "termbase_overrides.json"), []);
await writeJsonFile(workspacePath(workspace, "glossary.json"), [
  { id: "gl-conflict-1", source: "开启", target: "opens", sourceFile: "glossary-a.csv", rowNo: 2 },
  { id: "gl-conflict-2", source: "开启", target: "unlocks", sourceFile: "glossary-b.csv", rowNo: 2 },
]);
const glossaryConflictPack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s1" });
assert.equal(
  glossaryConflictPack.constraints.some((constraint) => constraint.kind === "terminology" && constraint.authority === "glossary"),
  false,
  "conflicting glossary targets remain evidence and must not become competing blockers",
);
await writeJsonFile(workspacePath(workspace, "glossary.json"), [
  { id: "gl-1", source: "开启", target: "opens", sourceFile: "glossary.csv", rowNo: 2 },
]);

// --- s3 has a number constraint, no term ---
const s3Pack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s3" });
assert.ok(s3Pack.constraints.some((constraint) => constraint.kind === "number"), "s3 should have a number constraint for 500");
assert.equal(s3Pack.constraints.some((constraint) => constraint.kind === "terminology"), false, "s3 has no termbase term");
assert.ok(s3Pack.constraints.some((constraint) => constraint.kind === "fuzzy_tm"), "single-segment snapshots should still surface fuzzy TM evidence");

// --- batch constraint pack with onlyFlagged covers all non-empty segments ---
const batchPack = await buildBatchConstraintPack(root, { projectId: "cp", batchId: "b1", onlyFlagged: false });
assert.equal(batchPack.summary.totalSegments, 3);
assert.ok(batchPack.summary.segmentsWithConstraints >= 2, "s1 and s2 have constraints; s3 has number constraint");
assert.ok(batchPack.summary.blockerConstraints >= 6, "s1+s2 each have term+exact_tm+tag blockers");
// Batch pack segments are the per-segment packs.
assert.ok(batchPack.segments.some((segment) => segment.segmentId === "s1"));
assert.equal(
  batchPack.segments.some((segment) => segment.constraints.some((constraint) => constraint.kind === "fuzzy_tm")),
  false,
  "batch constraint packs intentionally avoid fuzzy TM full-scan; fuzzy TM stays in segment evidence/snapshot views",
);

// --- onlyFlagged=true still returns all non-empty segments (all are flagged) ---
const flaggedPack = await buildBatchConstraintPack(root, { projectId: "cp", batchId: "b1", onlyFlagged: true });
assert.ok(flaggedPack.summary.totalSegments >= 1, "onlyFlagged should still return flagged segments");

// --- voice constraint only appears when a confirmed voice profile governs the segment ---
await upsertVoiceProfile(root, "cp", "b1", {
  status: "confirmed",
  updatedBy: "test",
  replaceEntries: true,
  entries: [{ id: "vp-1", textType: "dialogue", speaker: null, register: "neutral" }],
});
const s1WithVoice = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s1" });
// BatchSegment has no speaker metadata, so the null-speaker profile entry governs.
assert.ok(s1WithVoice.constraints.some((constraint) => constraint.kind === "voice"), "a confirmed voice profile should add an advisory voice constraint");
assert.equal(s1WithVoice.voiceProfileEntryId, "vp-1");
const voiceConstraint = s1WithVoice.constraints.find((constraint) => constraint.kind === "voice");
assert.equal(voiceConstraint?.severity, "advisory", "voice constraints are advisory, not blockers");
const voiceBatchPack = await buildBatchConstraintPack(root, { projectId: "cp", batchId: "b1", onlyFlagged: false });
assert.ok(voiceBatchPack.summary.advisoryConstraints >= 1, "batch summary should count advisory voice constraints");

// --- same-batch confirmed TM is working TM, not an exact blocker ---
const workingTm = await createTmStore(workspace).upsertReviewed({
  source: "获得500金币",
  target: "Earn 500 Coins",
  srcLang: "zh-CN",
  tgtLang: "en-US",
  origin: "reviewed",
  sourceKind: "batch_confirm",
  sourceBatchId: "b1",
  sourceSegmentId: "s3",
});
const s3WorkingTmPack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s3" });
assert.equal(
  s3WorkingTmPack.constraints.some((constraint) => constraint.kind === "exact_tm" && constraint.authority === "working_tm" && constraint.severity === "blocker"),
  false,
  "batch_confirm TM must not become an exact TM blocker until promoted",
);
assert.equal(
  s3WorkingTmPack.constraints.some((constraint) => constraint.kind === "exact_tm" && constraint.authority === "working_tm" && constraint.severity === "advisory"),
  true,
  "batch_confirm exact TM remains visible as advisory evidence",
);
const promoted = await createTmStore(workspace).promoteReviewed(workingTm.entry.id);
assert.equal(promoted.entry.sourceKind, "manual");
const s3PromotedPack = await buildSegmentConstraintPackSnapshot(root, { projectId: "cp", batchId: "b1", segmentId: "s3" });
assert.equal(
  s3PromotedPack.constraints.some((constraint) => constraint.kind === "exact_tm" && constraint.authority === "reviewed_tm"),
  true,
  "explicit promotion should restore hard reviewed exact TM authority",
);

// --- CAT tool: constraint_pack is registered and works in batch + segment mode ---
const tools = buildCatTools(workspace);
const constraintPackTool = tools.find((tool) => tool.name === "constraint_pack");
assert.ok(constraintPackTool, "constraint_pack tool must be registered");
const segmentResult = await constraintPackTool.execute("tool-call", { batchId: "b1", segmentId: "s1" });
assert.match(segmentResult.content[0].text, /Constraint pack/);
assert.match(segmentResult.content[0].text, /terminology/);
const batchResult = await constraintPackTool.execute("tool-call", { batchId: "b1" });
assert.match(batchResult.content[0].text, /segment\(s\) with constraints/);
assert.match(batchResult.content[0].text, /advisory/, "batch constraint_pack tool output must surface advisory counts");
const batchPage = await constraintPackTool.execute("tool-page", { batchId: "b1", start: 1, limit: 1 });
assert.equal(batchPage.details.returned, 1);
assert.equal(batchPage.details.nextStart, 2);
assert.match(batchPage.content[0].text, /Showing 1\/3 constrained segment/);

// --- constraint_pack is visible in translate mode ---
const { renderCatToolCatalog } = await import("@linguist-agent/cat-tools");
const translateCatalog = renderCatToolCatalog({ mode: "translate", includeWriteTools: true });
assert.match(translateCatalog, /constraint_pack/, "constraint_pack must be selectable in translate mode");

// --- placeholder constraint: {0} runtime placeholders are surfaced to the model ---
{
  const phRoot = await mkdtemp(join(tmpdir(), "la-cp-ph-"));
  const phCustomer = join(phRoot, "customer");
  await mkdir(phCustomer, { recursive: true });
  const phCsv = join(phCustomer, "batch.csv");
  await writeFile(phCsv, ["SegmentID,Source,Target,Status", "s1,点击 {0} 开始,Click {0} to start,draft"].join("\n"), "utf8");
  await createProjectManifest(phRoot, phCustomer, { projectId: "ph", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  await importCsvBatch(phRoot, { projectId: "ph", csvPath: phCsv, batchId: "b1" });
  const phPack = await buildSegmentConstraintPackSnapshot(phRoot, { projectId: "ph", batchId: "b1", segmentId: "s1" });
  const placeholderConstraint = phPack.constraints.find((constraint) => constraint.kind === "placeholder");
  assert.ok(placeholderConstraint, "a source with {0} must produce a placeholder constraint");
  assert.equal(placeholderConstraint?.severity, "blocker");
  assert.ok(placeholderConstraint?.requiredSignature?.includes("{0}"), "placeholder signature must include {0}");
}

// --- onlyFlagged is evidence-derived: plain prose is skipped, but length never hides real terms ---
{
  const flaggedPack = await buildBatchConstraintPack(root, { projectId: "cp", batchId: "b1", onlyFlagged: true });
  // s1/s2 have tags + duplicate group -> flagged. s3 ("获得500金币") is short (<=24) -> flagged.
  // Add a long-prose control to confirm it is dropped.
  const longRoot = await mkdtemp(join(tmpdir(), "la-cp-long-"));
  const longCustomer = join(longRoot, "customer");
  await mkdir(longCustomer, { recursive: true });
  const longCsv = join(longCustomer, "batch.csv");
  const longSource = "这是一段很长的没有任何标签占位符也不是重复组的纯文字叙事句段用来验证onlyFlagged确实会把它过滤掉";
  await writeFile(longCsv, ["SegmentID,Source,Target,Status", `s1,${longSource},Some long translation,draft`].join("\n"), "utf8");
  await createProjectManifest(longRoot, longCustomer, { projectId: "long", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  await importCsvBatch(longRoot, { projectId: "long", csvPath: longCsv, batchId: "b1" });
  const longFlagged = await buildBatchConstraintPack(longRoot, { projectId: "long", batchId: "b1", onlyFlagged: true });
  assert.equal(longFlagged.summary.totalSegments, 0, "a long prose segment with no tags/dups must be filtered out by onlyFlagged");
  const longAll = await buildBatchConstraintPack(longRoot, { projectId: "long", batchId: "b1", onlyFlagged: false });
  assert.equal(longAll.summary.totalSegments, 1, "onlyFlagged=false must still include it");
  const longWorkspace = createWorkspace(longRoot, "long");
  const bindingTerms = ["很长", "标签", "占位符", "重复组", "纯文字", "叙事句段", "验证"];
  await writeJsonFile(workspacePath(longWorkspace, "termbase.json"), bindingTerms.map((source, index) => ({
    id: `long-term-${index + 1}`,
    source,
    target: `Term ${index + 1}`,
    srcLang: "zh-CN",
    tgtLang: "en-US",
    sourceFile: "long-terms.xlsx",
    rowNo: index + 1,
    origin: "table",
  } as TermbaseEntry)));
  const termFlagged = await buildBatchConstraintPack(longRoot, { projectId: "long", batchId: "b1", onlyFlagged: true });
  assert.equal(termFlagged.summary.totalSegments, 1, "a real binding term must include long prose regardless of source length");
  const termConstraints = termFlagged.segments[0]?.constraints.filter((constraint) => constraint.kind === "terminology" && constraint.authority === "termbase") ?? [];
  assert.equal(termConstraints.length, bindingTerms.length, "constraint packs must not silently keep only the first five binding terms");
  void flaggedPack;
}

// --- conflicting top-authority exact TM rows are review evidence, not simultaneous blockers ---
{
  const conflictRoot = await mkdtemp(join(tmpdir(), "la-cp-tm-conflict-"));
  const conflictCustomer = join(conflictRoot, "customer");
  await mkdir(conflictCustomer, { recursive: true });
  const conflictCsv = join(conflictCustomer, "batch.csv");
  await writeFile(conflictCsv, ["SegmentID,Source,Target,Status", "s1,天关开启,The gate opens,draft"].join("\n"), "utf8");
  await createProjectManifest(conflictRoot, conflictCustomer, { projectId: "tm-conflict", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  await importCsvBatch(conflictRoot, { projectId: "tm-conflict", csvPath: conflictCsv, batchId: "b1" });
  await createTmStore(createWorkspace(conflictRoot, "tm-conflict")).seed([
    { id: "reviewed-a", source: "天关开启", target: "Celestial Gate opens", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed", quality: 100 },
    { id: "reviewed-b", source: "天关开启", target: "celestial Gate opens", srcLang: "zh-CN", tgtLang: "en-US", origin: "reviewed", quality: 100 },
  ]);
  const conflictPack = await buildSegmentConstraintPackSnapshot(conflictRoot, { projectId: "tm-conflict", batchId: "b1", segmentId: "s1" });
  const exactConstraints = conflictPack.constraints.filter((constraint) => constraint.kind === "exact_tm");
  assert.equal(exactConstraints.some((constraint) => constraint.severity === "blocker"), false, "conflicting top-authority exact TM targets cannot all bind");
  assert.equal(exactConstraints.some((constraint) => constraint.severity === "warning" && /conflicting/.test(constraint.message ?? "")), true, "the exact TM conflict must remain visible for resolution");
}

// --- BBCode bracket tags are NOT fabricated: [color]...[-] yields no tag_signature ---
{
  const bbRoot = await mkdtemp(join(tmpdir(), "la-cp-bb-"));
  const bbCustomer = join(bbRoot, "customer");
  await mkdir(bbCustomer, { recursive: true });
  const bbCsv = join(bbCustomer, "batch.csv");
  await writeFile(bbCsv, ["SegmentID,Source,Target,Status", "s1,[27CA28]{0}秒后[-]#r助战NPC进队,After {0}s support NPC joins,draft"].join("\n"), "utf8");
  await createProjectManifest(bbRoot, bbCustomer, { projectId: "bb", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  await importCsvBatch(bbRoot, { projectId: "bb", csvPath: bbCsv, batchId: "b1" });
  const bbPack = await buildSegmentConstraintPackSnapshot(bbRoot, { projectId: "bb", batchId: "b1", segmentId: "s1" });
  assert.equal(bbPack.constraints.some((constraint) => constraint.kind === "tag_signature"), false, "BBCode bracket tags must not be fabricated as a tag_signature; they are project-tag-rule governed");
  // {0} placeholder IS recognized and surfaced.
  assert.ok(bbPack.constraints.some((constraint) => constraint.kind === "placeholder"), "{0} placeholder must still be surfaced");
}

// --- confirmed project tag rules become blocker tag_signature constraints ---
{
  const ruleRoot = await mkdtemp(join(tmpdir(), "la-cp-rule-"));
  const ruleCustomer = join(ruleRoot, "customer");
  await mkdir(ruleCustomer, { recursive: true });
  const ruleCsv = join(ruleCustomer, "batch.csv");
  await writeFile(ruleCsv, ["SegmentID,Source,Target,Status", "s1,[27CA28]{0}秒后[-]#r助战NPC进队,After {0}s support NPC joins,draft"].join("\n"), "utf8");
  await createProjectManifest(ruleRoot, ruleCustomer, { projectId: "rule", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  await importCsvBatch(ruleRoot, { projectId: "rule", csvPath: ruleCsv, batchId: "b1" });
  await createManualProjectTagRuleCandidate(ruleRoot, "rule", {
    id: "synthetic-bracket-color",
    pattern: "\\[(?:[0-9a-fA-F]{3,8}|-)\\]",
    flags: "g",
    note: "Synthetic project bracket color/close token.",
  });
  await confirmProjectTagRule(ruleRoot, "rule", "synthetic-bracket-color");
  await createManualProjectTagRuleCandidate(ruleRoot, "rule", {
    id: "synthetic-hash-control",
    pattern: "#[rnt]",
    flags: "g",
    note: "Synthetic project hash control token.",
  });
  await confirmProjectTagRule(ruleRoot, "rule", "synthetic-hash-control");

  const rulePack = await buildSegmentConstraintPackSnapshot(ruleRoot, { projectId: "rule", batchId: "b1", segmentId: "s1" });
  const projectTagConstraint = rulePack.constraints.find((constraint) => constraint.kind === "tag_signature" && constraint.authority === "project_tag_rule");
  assert.ok(projectTagConstraint, "confirmed project tags must become generation-time constraints");
  assert.equal(projectTagConstraint?.severity, "blocker");
  assert.deepEqual(projectTagConstraint?.requiredSignature, ["[27CA28]", "[-]", "#r"]);
  const ruleFlagged = await buildBatchConstraintPack(ruleRoot, { projectId: "rule", batchId: "b1", onlyFlagged: true });
  assert.equal(ruleFlagged.summary.totalSegments, 1, "confirmed project tags must count as flagged segments");
}

console.log("constraint pack tests passed");
