import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDeliveryReadinessReport,
  createProjectManifest,
  createTmStore,
  createWorkspace,
  exportCsvBatch,
  formatQualityAuditMarkdown,
  glossaryPath,
  importCsvBatch,
  readQualityDecisionLedger,
  runQualityAudit,
  upsertQualityFindingWaiver,
  workspacePath,
  writeJsonFile,
  type GlossaryEntry,
  type TermbaseEntry,
} from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-quality-audit-"));
const customerRoot = join(root, "customer");
await mkdir(customerRoot, { recursive: true });
const csvPath = join(customerRoot, "batch.csv");
await writeFile(
  csvPath,
  [
    "SegmentID,Source,Target,Status",
    "s1,小虎表情秀,Little Tiger Emote Show,draft",
    "s2,天星引,Star Lead,draft",
    "s3,宿,Inn,draft",
    "s4,巅峰对决,Peak Duel ,draft",
    "s5,助战NPC进队,Support NPC joins,draft",
    "s6,点击{0}开始,Click Start,draft",
    "s7,获得10个宝石,Gain gems,draft",
    "s8,重复文本,First target,draft",
    "s9,重复文本,Second target,draft",
    "s10,战旗,Battle Flag,draft",
    "s11,暗影徽记,Shadow Emblem,draft",
    "s12,打开城门,Open teh gate,draft",
  ].join("\n"),
  "utf8",
);

await createProjectManifest(root, customerRoot, {
  projectId: "quality",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importCsvBatch(root, {
  projectId: "quality",
  csvPath,
  batchId: "b1",
});

const workspace = createWorkspace(root, "quality");
const termbaseEntries: TermbaseEntry[] = [
  { id: "tb-1", source: "小虎表情秀", target: "Cubby Emote Show", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb.xlsx", rowNo: 1, origin: "table" },
  { id: "tb-2", source: "天", target: "Heaven", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb.xlsx", rowNo: 2, origin: "table" },
  { id: "tb-3", source: "天星引", target: "Star Lead", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb.xlsx", rowNo: 3, origin: "table" },
  { id: "tb-4", source: "宿", target: "Lodging", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb.xlsx", rowNo: 4, origin: "table" },
  { id: "tb-5", source: "助战", target: "Cheer", srcLang: "zh-CN", tgtLang: "en-US", sourceFile: "tb.xlsx", rowNo: 5, origin: "table" },
];
await writeJsonFile(workspacePath(workspace, "termbase.json"), termbaseEntries);
await writeJsonFile<GlossaryEntry[]>(glossaryPath(root, "quality"), [
  { id: "gl-1", source: "战旗", target: "War Banner", sourceFile: "glossary.xlsx", rowNo: 12 },
  { id: "gl-2", source: "暗影徽记", target: "Shadow Emblem", sourceFile: "glossary.xlsx", rowNo: 13 },
]);
await createTmStore(workspace).seed([
  {
    id: "tm-peak",
    source: "巅峰对决",
    target: "The Pinnacle",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    origin: "reviewed",
    quality: 100,
  },
  {
    id: "tm-client-lodging",
    source: "宿",
    target: "Hostel",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    origin: "client_tm",
    quality: 100,
  },
  {
    id: "tm-assassin-legacy",
    source: "暗影徽记",
    target: "Shadow Emblem",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    origin: "client_tm",
    quality: 100,
  },
]);
await createTmStore(workspace).upsertReviewed({
  id: "tm-working-support",
  source: "助战NPC进队",
  target: "Support NPC joins the team",
  srcLang: "zh-CN",
  tgtLang: "en-US",
  origin: "reviewed",
  sourceKind: "batch_confirm",
  sourceBatchId: "b1",
  sourceSegmentId: "s5",
});
await createTmStore(workspace).upsertReviewed({
  id: "tm-working-typo",
  source: "打开城门",
  target: "Open teh gate",
  srcLang: "zh-CN",
  tgtLang: "en-US",
  origin: "reviewed",
  sourceKind: "batch_confirm",
  sourceBatchId: "b1",
  sourceSegmentId: "s12",
});

let quality = await runQualityAudit(root, "quality", "b1");
assert.equal(quality.status, "fail");
assert.equal(quality.summary.openBlockers, 4);
assert.equal(quality.summary.openWarnings, 7);
assert.equal(quality.spelling.status, "checked");
assert.equal(quality.spelling.dictionaryId, "dictionary-en");
assert.equal(quality.spelling.dictionaryVersion, "4.0.0");
assert.equal(quality.summary.spellingUnknownWords, 1);
assert.equal(quality.findings.some((finding) => finding.segmentId === "s5" && finding.code === "SPELLING_UNKNOWN_WORD"), false);
assert.equal(quality.findings.some((finding) => finding.segmentId === "s12" && finding.code === "SPELLING_UNKNOWN_WORD"), true, "same-batch working TM must not bless a typo as project vocabulary");
assert.match(formatQualityAuditMarkdown(quality), /Spelling: checked \d+ word\(s\), 1 unknown · en-US · dictionary-en@4\.0\.0 \+ word-list@4\.1\.0 \+ la-game-localization@1/);
assert.equal(quality.findings.some((finding) => finding.segmentId === "s2" && finding.sourceTerm === "天"), false, "single-character term must not fire inside a longer confirmed term");
assert.equal(quality.findings.some((finding) => finding.segmentId === "s3" && finding.sourceTerm === "宿" && finding.severity === "blocker"), true, "single-character exact source term should still block");
assert.equal(quality.findings.some((finding) => finding.segmentId === "s3" && finding.code === "TM_EXACT_TARGET_MISMATCH"), false, "an imported client TM row is advisory until explicitly reviewed/promoted");
assert.equal(quality.findings.some((finding) => finding.segmentId === "s4" && finding.code === "TM_EXACT_TARGET_MISMATCH"), true);
assert.equal(quality.findings.some((finding) => finding.segmentId === "s4" && finding.code === "EDGE_WHITESPACE"), true, "edge whitespace must reach formal Quality Audit and export authorization");
assert.equal(quality.findings.some((finding) => finding.segmentId === "s5" && finding.code === "TM_EXACT_TARGET_MISMATCH"), false, "same-batch confirmed working TM must not become a hard exact-TM blocker");
assert.equal(quality.findings.some((finding) => finding.segmentId === "s11" && finding.code === "TM_EXACT_TARGET_MISMATCH"), false, "preferred glossary target must outrank a conflicting exact TM target");
assert.equal(quality.findings.some((finding) => finding.segmentId === "s6" && finding.code === "PLACEHOLDER_SIGNATURE_MISMATCH"), true);
assert.equal(quality.findings.some((finding) => finding.segmentId === "s7" && finding.code === "NUMBER_MISMATCH"), true);
assert.equal(quality.findings.some((finding) => finding.segmentId === "s8" && finding.code === "DUPLICATE_TARGET_MISMATCH"), true);
assert.equal(quality.findings.some((finding) => finding.segmentId === "s10" && finding.code === "GLOSSARY_PREFERRED_MISSING"), true);
assert.equal(quality.summary.glossaryPreferredMissing, 1);
assert.equal(quality.summary.formattingSignatureMismatches >= 1, true);
assert.equal(quality.summary.numberMismatches, 1);
assert.equal(quality.summary.duplicateTargetMismatches, 2);
let ledger = await readQualityDecisionLedger(root, "quality");
assert.equal(ledger.filter((event) => event.kind === "quality_finding").length, quality.findings.filter((finding) => finding.status === "open").length);

let readiness = await buildDeliveryReadinessReport(root, "quality", "b1");
assert.equal(readiness.status, "fail");
assert.match(readiness.nextActions.join("\n"), /quality blocker/);
ledger = await readQualityDecisionLedger(root, "quality");
assert.equal(ledger.filter((event) => event.kind === "quality_finding").length, quality.findings.filter((finding) => finding.status === "open").length, "repeated audits must not duplicate ledger findings");
await assert.rejects(
  () => exportCsvBatch(root, { projectId: "quality", batchId: "b1" }),
  /Quality decision ledger blocked export/,
  "export must reject open quality blockers",
);

const tmFinding = quality.findings.find((finding) => finding.segmentId === "s4" && finding.code === "TM_EXACT_TARGET_MISMATCH");
assert.ok(tmFinding);
await upsertQualityFindingWaiver(root, "quality", {
  batchId: "b1",
  segmentId: "s4",
  findingId: tmFinding.id,
  code: tmFinding.code,
  reason: "Customer accepted this event title for the current handoff.",
});
quality = await runQualityAudit(root, "quality", "b1");
assert.equal(quality.summary.ignored, 1);
assert.equal(quality.summary.openBlockers, 3);
assert.equal(quality.findings.find((finding) => finding.id === tmFinding.id)?.status, "ignored");

const forced = await exportCsvBatch(root, { projectId: "quality", batchId: "b1", force: true });
assert.ok(forced.outputPath, "force=true should remain an explicit emergency export override");
readiness = await buildDeliveryReadinessReport(root, "quality", "b1");
assert.equal(readiness.quality.summary.ignored, 1);

console.log("quality_audit tests passed");
