import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createProjectManifest,
  createTmStore,
  createTaskWorkspace,
  createWorkspace,
  importCsvBatch,
  parseDeliveryQaReviewDecisions,
  readQualityDecisionLedger,
  runDeliveryQa,
  runDeliveryQaOnSegments,
  runQualityAudit,
  reviewDeliveryQaReport,
  reviewSavedDeliveryQaReport,
  glossaryPath,
  termbasePath,
  writeQualityChecklist,
  readQualityChecklist,
  parseQualityChecklistEntries,
  parseMechanicalTextQaOptions,
} from "@linguist-agent/cat-data";
import { createDeliveryQaTool } from "@linguist-agent/cat-tools";
import { handleBatchRoute } from "../packages/cat-server/src/routes/batch_routes.js";
import { handleQualityChecklistRoute } from "../packages/cat-server/src/routes/quality_checklist_routes.js";

const report = runDeliveryQaOnSegments({
  projectId: "proj",
  batchId: "b1",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  segments: [
    { id: "1", source: "Start {0}", target: "Start", locked: false },
    { id: "2", source: "HP 100", target: "HP 200", locked: false },
    { id: "3", source: "你好", target: "你好", locked: false },
    { id: "4", source: "Line\\nBreak", target: "Line Break", locked: false },
    { id: "5", source: "Sword", target: "", locked: false },
    { id: "6", source: "<b>Power</b>", target: "Power", locked: false },
    { id: "7", source: "Email support@example.com", target: "Email help@example.com", locked: false },
    { id: "8", source: "Enter CODE-9", target: "Enter CODE", locked: false },
    { id: "9", source: "{count, plural, one {Gem} other {Gems}}", target: "{count, plural, one {Gem}}", locked: false },
    { id: "10", source: "Open the event menu", target: "Open the event menu。", locked: false },
    { id: "11", source: "This is a reasonably long source line", target: "Short", locked: false },
    { id: "12", source: "获得神石", target: "Get the stone", locked: false },
    { id: "13", source: "打开背包", target: "Open bag", locked: false },
    { id: "14", source: "{gender, select, male {He} female {She} other {They}} wins", target: "{gender, plural, male {He} female {She} other {They}} wins", locked: false },
    { id: "15", source: "{count, plural, one {{gender, select, male {Hero} female {Heroine} other {Hero}}} other {Heroes}}", target: "{count, plural, one {{gender, select, male {Hero} other {Hero}}} other {Heroes}}", locked: false },
    { id: "16", source: "Confirm the reward", target: "Confirm the the reward", locked: false },
    { id: "17", source: "Open panel", target: "Open  panel", locked: false },
    { id: "18", source: "Equip item", target: "Equip (item", locked: false },
    { id: "19", source: "Hero says", target: "Hero says “Hello", locked: false },
    { id: "20", source: "Shared source", target: "First target", locked: false },
    { id: "21", source: "shared source", target: "Second target", locked: false },
    { id: "22", source: "First source", target: "Common target", locked: false },
    { id: "23", source: "Second source", target: "common target", locked: false },
    { id: "24", source: "Trim me", target: "Trim me ", locked: false },
  ],
  preferredTerms: [
    { source: "神石", target: "Divine Stone", authority: "termbase" },
    { source: "背包", target: "Inventory", authority: "glossary" },
  ],
  checkSuspiciousLengthRatio: true,
});

const types = new Set(report.findings.map((finding) => finding.type));
assert.equal(types.has("placeholder_mismatch"), true);
assert.equal(types.has("number_mismatch"), true);
assert.equal(types.has("source_equals_target"), true);
assert.equal(types.has("newline_mismatch"), true);
assert.equal(types.has("missing_target"), true);
assert.equal(types.has("tag_mismatch"), true);
assert.equal(types.has("email_mismatch"), true);
assert.equal(types.has("alphanumeric_mismatch"), true);
assert.equal(types.has("icu_branch_mismatch"), true);
assert.equal(types.has("fullwidth_punctuation"), true);
assert.equal(types.has("suspicious_length_ratio"), true);
assert.equal(types.has("terminology_mismatch"), true);
assert.equal(types.has("glossary_mismatch"), true);
assert.equal(types.has("repeated_word"), true);
assert.equal(types.has("double_space"), true);
assert.equal(types.has("edge_whitespace"), true);
assert.equal(types.has("unpaired_symbol"), true);
assert.equal(types.has("unpaired_quote"), true);
assert.equal(types.has("inconsistent_target"), true);
assert.equal(types.has("duplicated_target"), true);
assert.deepEqual(
  report.findings.filter((finding) => finding.type === "inconsistent_target").map((finding) => finding.segmentId).sort(),
  ["20", "21"],
  "every inconsistent segment must be directly navigable instead of collapsing into a batch-only finding",
);
assert.equal(report.findings.filter((finding) => finding.type === "duplicated_target").every((finding) => (finding.relatedSegmentIds?.length ?? 0) > 0), true);
assert.equal(report.findings.filter((finding) => finding.type === "icu_branch_mismatch").length >= 2, true);
assert.equal(report.findings.some((finding) => finding.type === "icu_branch_mismatch" && finding.evidence.some((item) => item.includes("gender:select"))), true);
assert.equal(report.summary.blockers > 0, true);

const sameLocaleReport = runDeliveryQaOnSegments({
  projectId: "proj",
  batchId: "zh-b1",
  sourceLanguage: "zh-CN",
  targetLanguage: "zh-TW",
  segments: [{ id: "zh-1", source: "活動開始", target: "活動開始。", locked: false }],
});
assert.equal(sameLocaleReport.findings.some((finding) => finding.type === "residual_cjk"), false, "CJK target text is not leakage for a CJK target locale");
assert.equal(sameLocaleReport.findings.some((finding) => finding.type === "fullwidth_punctuation"), false, "CJK punctuation is not an English-target warning outside zh-to-en coverage");
assert.deepEqual(sameLocaleReport.spelling, {
  status: "unsupported",
  requestedLocale: "zh-TW",
  checkedWordCount: 0,
  unknownWordCount: 0,
  reason: "unsupported_target_locale",
});

const spellingReport = runDeliveryQaOnSegments({
  projectId: "proj",
  batchId: "spelling-b1",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  segments: [
    { id: "typo", source: "打开大门", target: "Open teh gate", locked: false },
    { id: "proper-name", source: "敦煌英雄", target: "Dunhuang hero", locked: false },
  ],
  preferredTerms: [
    { source: "敦煌", target: "Dunhuang", authority: "termbase" },
  ],
});
const catDataPackage = JSON.parse(await readFile(join(process.cwd(), "packages", "cat-data", "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
assert.deepEqual(spellingReport.spelling, {
  status: "checked",
  requestedLocale: "en-US",
  dictionaryId: "dictionary-en",
  dictionaryVersion: "4.0.0",
  dictionaryLocale: "en-US",
  supplementId: "word-list",
  supplementVersion: "4.1.0",
  domainDictionaryId: "la-game-localization",
  domainDictionaryVersion: "1",
  checkedWordCount: 5,
  unknownWordCount: 1,
});
assert.equal(spellingReport.spelling?.status === "checked" && spellingReport.spelling.dictionaryVersion, catDataPackage.dependencies["dictionary-en"], "reported dictionary version must match the exact package pin");
assert.equal(spellingReport.spelling?.status === "checked" && spellingReport.spelling.supplementVersion, catDataPackage.dependencies["word-list"], "reported supplement version must match the exact package pin");
assert.deepEqual(
  spellingReport.findings.filter((finding) => finding.type === "spelling").map((finding) => [finding.segmentId, finding.evidence]),
  [["typo", ["word:teh", "dictionary:dictionary-en@4.0.0", "supplement:word-list@4.1.0", "domain:la-game-localization@1", "locale:en-US"]]],
  "spelling QA should flag a real typo while allowing typed project terminology",
);

const falsePositiveReport = runDeliveryQaOnSegments({
  projectId: "proj",
  sourceLanguage: "en-US",
  targetLanguage: "en-US",
  segments: [
    { id: "apostrophe", source: "The hero is ready", target: "The hero’s ready", locked: false },
    { id: "number-order", source: "Use 10 or 20 gems", target: "With 20 or 10 gems", locked: false },
    { id: "translatable-wrapper", source: "Open <a^点击前往^a>", target: "Open <a^Click here^a>", locked: false },
    { id: "preserved-punctuation", source: "点击【激活】", target: "Click 【Activate】", locked: false },
    { id: "localized-number", source: "消耗1000金币", target: "Spend 1,000 Gold", locked: false },
    { id: "localized-date", source: "7月3日18点00分", target: "July 3 at 18:00", locked: false },
    { id: "file-path", source: "使用配置文件", target: "Use CODE_9 in ui/menu.json", locked: false },
    { id: "markup-entities", source: "使用富文本", target: "Use &nbsp; [b]bold[/b] text", locked: false },
    { id: "percent-copy", source: "概率提升", target: "Has a 20% chance and 30% higher Health.", locked: false },
    { id: "broad-english", source: "游戏术语", target: "A sorcerous Dreamscape leaderboard cooldown for an equippable, dispellable NPC playstyle in PvE, PvP, and Lv. prefill leyline UI.", locked: false },
  ],
});
assert.equal(falsePositiveReport.findings.some((finding) => finding.segmentId === "apostrophe" && finding.type === "unpaired_quote"), false);
assert.equal(falsePositiveReport.findings.some((finding) => finding.segmentId === "number-order" && finding.type === "number_mismatch"), false);
assert.equal(falsePositiveReport.findings.some((finding) => finding.segmentId === "translatable-wrapper" && finding.type === "tag_mismatch"), false);
assert.equal(falsePositiveReport.findings.some((finding) => finding.segmentId === "preserved-punctuation" && finding.type === "fullwidth_punctuation"), false);
assert.equal(falsePositiveReport.findings.some((finding) => ["localized-number", "localized-date"].includes(finding.segmentId ?? "") && finding.type === "number_mismatch"), false);
assert.equal(falsePositiveReport.findings.some((finding) => finding.segmentId === "file-path" && finding.type === "spelling"), false, "file paths and identifiers are not prose words");
assert.equal(falsePositiveReport.findings.some((finding) => finding.segmentId === "markup-entities" && finding.type === "spelling"), false, "HTML entities and BBCode control tags are formatting, not prose words");
assert.equal(falsePositiveReport.findings.some((finding) => finding.segmentId === "percent-copy" && finding.type === "spelling"), false, "a percentage followed by prose must not be consumed as a printf placeholder");
assert.equal(falsePositiveReport.findings.some((finding) => finding.segmentId === "broad-english" && finding.type === "spelling"), false, "the production lexicon must cover ordinary modern game prose beyond the small Hunspell base");

const reviewed = reviewDeliveryQaReport(report, [
  { findingId: report.findings[0].id, reviewDecision: "ignore_with_reason", reviewReason: "Known false positive.", reviewedBy: "lead_linguist" },
]);
assert.equal(reviewed.findings[0].reviewDecision, "ignore_with_reason");
assert.equal(reviewed.findings[0].reviewReason, "Known false positive.");
assert.equal(reviewed.findings.length, 1, "unsubmitted findings must remain unreviewed");
assert.equal(reviewed.rawReport.findings.length, report.findings.length);
assert.throws(() => reviewDeliveryQaReport(report, []), /at least one decision/);
assert.throws(() => reviewDeliveryQaReport(report, [
  { findingId: report.findings[0].id, reviewDecision: "ignore_with_reason", reviewReason: "", reviewedBy: "lead_linguist" },
]), /requires reviewReason/);
assert.throws(() => reviewDeliveryQaReport(report, [
  { findingId: "missing", reviewDecision: "query", reviewReason: "Check.", reviewedBy: "user" },
]), /unknown finding/);
assert.throws(() => reviewDeliveryQaReport(report, [
  { findingId: report.findings[0].id, reviewDecision: "query", reviewReason: "First.", reviewedBy: "user" },
  { findingId: report.findings[0].id, reviewDecision: "query", reviewReason: "Second.", reviewedBy: "user" },
]), /repeats finding/);
assert.throws(() => parseDeliveryQaReviewDecisions([
  { findingId: report.findings[0].id, reviewDecision: "ignore_with_reason", reviewReason: "", reviewedBy: "lead_linguist" },
]), /reviewReason is required/);
assert.deepEqual(parseDeliveryQaReviewDecisions([
  { findingId: report.findings[0].id, reviewDecision: "query", reviewReason: "Needs client confirmation.", reviewedBy: "user" },
]), [
  { findingId: report.findings[0].id, reviewDecision: "query", reviewReason: "Needs client confirmation.", reviewedBy: "user" },
]);

const root = await mkdtemp(join(tmpdir(), "la-delivery-qa-"));
await createTaskWorkspace(root).create({
  projectId: "proj",
  taskId: "delivery-review-task",
  title: "Review Delivery QA",
  intent: "Record a Delivery QA decision.",
  kind: "delivery",
  scope: { batchId: "b1" },
});
const rawPath = join(root, "data", "projects", "proj", "delivery_qa", `${report.reportId}.json`);
await mkdir(dirname(rawPath), { recursive: true });
await writeFile(rawPath, JSON.stringify(report, null, 2), "utf8");
const routeDecision = { findingId: report.findings[0].id, reviewDecision: "query", reviewReason: "Needs client confirmation.", reviewedBy: "user" };
const routeResponses: Array<{ status: number; data: unknown }> = [];
const routeDeps = {
  repoRoot: root,
  json: (_res: unknown, status: number, data: unknown) => routeResponses.push({ status, data }),
  readBody: async () => ({ taskId: "delivery-review-task", reportId: report.reportId, decisions: [routeDecision] }),
  requireString: (value: unknown, label: string) => {
    if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
    return value;
  },
  optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
  optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
  optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
};
assert.equal(await handleBatchRoute({ method: "POST" } as never, {} as never, new URL("http://x/api/projects/proj/batches/b1/delivery-qa-review"), [
  "api",
  "projects",
  "proj",
  "batches",
  "b1",
  "delivery-qa-review",
], "proj", {
  ...routeDeps,
  markdown: () => undefined,
}), true);
assert.equal(routeResponses.at(-1)?.status, 200);
assert.equal((routeResponses.at(-1)?.data as { rawReport: { reportId: string } }).rawReport.reportId, report.reportId);
const ledgerAfterRouteReview = await readQualityDecisionLedger(root, "proj");
assert.equal(ledgerAfterRouteReview.some((event) => event.findingId === report.findings[0].id && event.decision === "open"), true);
assert.equal(ledgerAfterRouteReview.some((event) => event.findingId === report.findings[0].id && event.decision === "query"), true);
const savedReviewed = await reviewSavedDeliveryQaReport(root, "proj", report.reportId, [
  { findingId: report.findings[0].id, reviewDecision: "ignore_with_reason", reviewReason: "Known false positive.", reviewedBy: "lead_linguist" },
]);
assert.equal(savedReviewed.rawReport.reportId, report.reportId);
assert.equal(savedReviewed.findings.length, 1);
await assert.rejects(access(join(root, "data", "projects", "proj", "delivery_qa", `${report.reportId}.reviewed.json`)), { code: "ENOENT" });
const { spelling: _legacySpelling, ...legacyReport } = report;
await writeFile(join(root, "data", "projects", "proj", "delivery_qa", "legacy-report.json"), JSON.stringify({ ...legacyReport, reportId: "legacy-report" }), "utf8");
const legacyTool = createDeliveryQaTool(createWorkspace(root, "proj"));
const legacyPage = await legacyTool.execute("legacy-page", { batchId: "b1", reportId: "legacy-report" });
assert.match(legacyPage.content[0].text, /Spelling: unavailable · historical report without coverage metadata/);

const toolRoot = await mkdtemp(join(tmpdir(), "la-delivery-qa-tool-"));
const customerRoot = join(toolRoot, "customer");
await mkdir(customerRoot, { recursive: true });
const csvPath = join(customerRoot, "batch.csv");
await writeFile(csvPath, [
  "SegmentID,Source,Target,Status",
  "s1,Start {0},Start,draft",
  "s2,获得神石,Get the stone,draft",
  "s3,打开背包,Open bag,draft",
  "s4,进入合成峡谷,Enter Synthetic Realm,draft",
  "s5,打开城门,Open typoo gate,draft",
  "s6,使用PLAYER_HP,Use Player_HP,draft",
  "s7,打开面板,OpenPanel,draft",
].join("\n"), "utf8");
await createProjectManifest(toolRoot, customerRoot, {
  projectId: "tool-proj",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importCsvBatch(toolRoot, { projectId: "tool-proj", csvPath, batchId: "b1" });
await createTmStore(createWorkspace(toolRoot, "tool-proj")).upsertReviewed({
  id: "tm-synthetic-realm",
  source: "进入合成峡谷",
  target: "Enter Synthetic Realm",
  srcLang: "zh-CN",
  tgtLang: "en-US",
  origin: "reviewed",
});
await createTmStore(createWorkspace(toolRoot, "tool-proj")).upsertReviewed({
  id: "tm-working-typoo",
  source: "打开城门",
  target: "Open typoo gate",
  srcLang: "zh-CN",
  tgtLang: "en-US",
  origin: "reviewed",
  sourceKind: "batch_confirm",
  sourceBatchId: "b1",
  sourceSegmentId: "s5",
});
await writeQualityChecklist(toolRoot, "tool-proj", [{
  id: "banned-get",
  name: "Client forbids generic Get",
  scope: "target",
  pattern: "\\bGet\\b",
  flags: "iu",
  severity: "warning",
  status: "active",
  message: "Use the client-approved acquisition verb instead of generic Get.",
}], {
  checkUppercaseTokens: true,
  checkCamelCaseTokens: true,
});
const checklistRouteResponses: Array<{ status: number; data: unknown }> = [];
const checklistRouteDeps = {
  repoRoot: toolRoot,
  json: (_res: unknown, status: number, data: unknown) => checklistRouteResponses.push({ status, data }),
  readBody: async () => ({ entries: [{
    id: "banned-get",
    name: "Client forbids generic Get",
    scope: "target",
    pattern: "\\bGet\\b",
    flags: "iu",
    severity: "warning",
    status: "active",
  }] }),
  readQualityChecklist,
  parseQualityChecklistEntries,
  parseMechanicalTextQaOptions,
  writeQualityChecklist,
};
assert.equal(await handleQualityChecklistRoute({ method: "PUT" } as never, {} as never, ["api", "projects", "tool-proj", "quality-checklist"], "tool-proj", checklistRouteDeps), true);
assert.equal(checklistRouteResponses.at(-1)?.status, 200);
assert.equal(await handleQualityChecklistRoute({ method: "GET" } as never, {} as never, ["api", "projects", "tool-proj", "quality-checklist"], "tool-proj", checklistRouteDeps), true);
assert.equal(((checklistRouteResponses.at(-1)?.data as { entries: unknown[] }).entries).length, 1);
assert.deepEqual((checklistRouteResponses.at(-1)?.data as { mechanicalOptions: unknown }).mechanicalOptions, {
  checkUppercaseTokens: true,
  checkCamelCaseTokens: true,
}, "an entries-only update from an older client must preserve project mechanical QA policy");
assert.equal(await handleQualityChecklistRoute({ method: "PUT" } as never, {} as never, ["api", "projects", "tool-proj", "quality-checklist"], "tool-proj", {
  ...checklistRouteDeps,
  readBody: async () => ({ entries: [{ id: "unsafe-route", name: "Unsafe", scope: "target", pattern: "(a+)+$", severity: "warning", status: "active" }] }),
}), true);
assert.equal(checklistRouteResponses.at(-1)?.status, 400);
assert.equal((await readQualityChecklist(toolRoot, "tool-proj")).entries[0]?.id, "banned-get", "an invalid checklist replacement must not mutate the prior document");
assert.equal(await handleQualityChecklistRoute({ method: "PUT" } as never, {} as never, ["api", "projects", "tool-proj", "quality-checklist"], "tool-proj", {
  ...checklistRouteDeps,
  readBody: async () => ({ entries: [], mechanicalOptions: { checkUppercaseTokens: "yes" } }),
}), true);
assert.equal(checklistRouteResponses.at(-1)?.status, 400);
assert.equal((await readQualityChecklist(toolRoot, "tool-proj")).mechanicalOptions.checkUppercaseTokens, true, "an invalid policy update must not mutate the prior document");
await assert.rejects(
  writeQualityChecklist(toolRoot, "tool-proj", [{
    id: "unsafe",
    name: "Unsafe expression",
    scope: "target",
    pattern: "(a+)+$",
    severity: "warning",
    status: "active",
  }]),
  /safety lint/,
);
await writeFile(termbasePath(toolRoot, "tool-proj"), JSON.stringify([{
  id: "tb-1",
  source: "神石",
  target: "Divine Stone",
  srcLang: "zh-CN",
  tgtLang: "en-US",
  sourceFile: "fixture",
  rowNo: 1,
  origin: "manual",
}], null, 2), "utf8");
await writeFile(glossaryPath(toolRoot, "tool-proj"), JSON.stringify([{
  id: "gl-1",
  source: "背包",
  target: "Inventory",
  sourceFile: "fixture",
  rowNo: 1,
}], null, 2), "utf8");
const tool = createDeliveryQaTool(createWorkspace(toolRoot, "tool-proj"));
const toolResult = await tool.execute("tool-call", { batchId: "b1", workflowId: "workflow-qa" });
assert.match(toolResult.content[0].text, /Delivery QA/);
assert.match(toolResult.content[0].text, /Spelling: checked .* · en-US · dictionary-en@4\.0\.0 \+ word-list@4\.1\.0 \+ la-game-localization@1/);
assert.equal(toolResult.details.workflowId, "workflow-qa");
assert.equal(toolResult.details.summary.blockers > 0, true);
assert.match(await readFile(join(toolRoot, "data", "projects", "tool-proj", "delivery_qa", `${toolResult.details.reportId}.json`), "utf8"), /placeholder_mismatch/);
const firstQaPage = await tool.execute("tool-page-1", { batchId: "b1", reportId: toolResult.details.reportId, start: 1, limit: 1 });
assert.equal(firstQaPage.details.reportId, toolResult.details.reportId);
assert.equal(firstQaPage.details.returned, 1);
assert.equal(firstQaPage.details.nextStart, 2);
const secondQaPage = await tool.execute("tool-page-2", { batchId: "b1", reportId: toolResult.details.reportId, start: 2, limit: 1 });
assert.equal(secondQaPage.details.reportId, toolResult.details.reportId, "paging must read the same persisted raw report instead of rerunning QA");
assert.match(firstQaPage.content[0].text, /Next start: 2/);
const persistedToolReport = await runDeliveryQa(toolRoot, "tool-proj", "b1", "workflow-qa-2");
assert.equal(persistedToolReport.findings.some((finding) => finding.type === "terminology_mismatch"), true);
assert.equal(persistedToolReport.findings.some((finding) => finding.type === "glossary_mismatch"), true);
assert.equal(persistedToolReport.findings.some((finding) => finding.type === "project_checklist" && finding.segmentId === "s2"), true);
assert.equal(persistedToolReport.findings.some((finding) => finding.type === "camelcase_token_mismatch" && finding.segmentId === "s7"), true);
assert.equal(persistedToolReport.findings.some((finding) => finding.type === "uppercase_token_mismatch" && finding.segmentId === "s6"), true);
assert.equal(persistedToolReport.findings.some((finding) => finding.type === "spelling" && finding.segmentId === "s4"), false, "confirmed project vocabulary must use the same spelling allowlist in Delivery and Quality");
assert.equal(persistedToolReport.findings.some((finding) => finding.type === "spelling" && finding.segmentId === "s5"), true, "same-batch working TM must not suppress a spelling warning");
const checklistQuality = await runQualityAudit(toolRoot, "tool-proj", "b1");
assert.equal(checklistQuality.findings.some((finding) => finding.code === "PROJECT_CHECKLIST" && finding.segmentId === "s2"), true);
assert.equal(checklistQuality.findings.some((finding) => finding.code === "CAMELCASE_TOKEN_MISMATCH" && finding.segmentId === "s7"), true);
assert.equal(checklistQuality.findings.some((finding) => finding.code === "UPPERCASE_TOKEN_MISMATCH" && finding.segmentId === "s6"), true);
assert.equal(checklistQuality.findings.some((finding) => finding.code === "SPELLING_UNKNOWN_WORD" && finding.segmentId === "s4"), false);
assert.equal(checklistQuality.findings.some((finding) => finding.code === "SPELLING_UNKNOWN_WORD" && finding.segmentId === "s5"), true);

console.log("delivery_qa tests passed");
