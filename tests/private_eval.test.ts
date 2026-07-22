import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  createPrivateEvalSet,
  createPrivateEvalBlindReview,
  createPrivateEvalRun,
  EVAL_DIMENSIONS,
  evaluatePrivateEvalMechanicalQa,
  executePrivateEvalRun,
  listPrivateEvalRuns,
  listPrivateEvalSets,
  listPrivateEvalBlindReviews,
  readPrivateEvalRun,
  readPrivateEvalBlindReview,
  readPrivateEvalRunOutputs,
  readPrivateEvalSet,
  readHumanScorecard,
  seedPrivateEvalRunFromCheckpoint,
  updatePrivateEvalRun,
  writeHumanScorecard,
  writePrivateEvalBlindJudgments,
  renderPrivateEvalComparison,
} from "@linguist-agent/cat-data";

const emptyTagRuleContext = {
  mode: "legacy_builtin" as const,
  rulesDigest: "",
  activeProjectRules: [],
  disabledBuiltinIds: [],
  candidateRuleCount: 0,
  disabledRuleCount: 0,
  trace: [],
};
assert.deepEqual(
  evaluatePrivateEvalMechanicalQa("获得 {0} 金币", "Gain Gold", emptyTagRuleContext),
  { safe: false, blockerCodes: ["PLACEHOLDER_SIGNATURE_MISMATCH"], warningCodes: [] },
);
assert.deepEqual(
  evaluatePrivateEvalMechanicalQa("持续 30 秒", "Lasts 20 seconds", emptyTagRuleContext),
  { safe: true, blockerCodes: [], warningCodes: ["NUMBER_MISMATCH"] },
);
assert.deepEqual(
  evaluatePrivateEvalMechanicalQa("2026年7月3日04:00至2026年7月5日23:59", "July 3, 2026 04:00 – July 5, 2026 23:59", emptyTagRuleContext),
  { safe: true, blockerCodes: [], warningCodes: [] },
);
assert.deepEqual(
  evaluatePrivateEvalMechanicalQa("每晚18点~22点，礼盒*1", "Every night from 18:00 to 22:00, Gift Box*1", emptyTagRuleContext),
  { safe: true, blockerCodes: [], warningCodes: [] },
);
assert.deepEqual(
  evaluatePrivateEvalMechanicalQa("每日21点00分结算", "Settled daily at 21:00", emptyTagRuleContext),
  { safe: true, blockerCodes: [], warningCodes: [] },
);
assert.deepEqual(
  evaluatePrivateEvalMechanicalQa("{gender:He|She}", "{gender:They}", emptyTagRuleContext),
  { safe: false, blockerCodes: ["ICU_BRANCH_ARITY_MISMATCH"], warningCodes: [] },
);
assert.deepEqual(
  evaluatePrivateEvalMechanicalQa("打开敦煌之门", "Open teh Dunhuang gate", emptyTagRuleContext, {
    targetLocale: "en-US",
    allowedTerms: ["Dunhuang"],
  }),
  {
    safe: true,
    blockerCodes: [],
    warningCodes: ["SPELLING_UNKNOWN_WORD"],
    spelling: {
      status: "checked",
      requestedLocale: "en-US",
      dictionaryId: "dictionary-en",
      dictionaryVersion: "4.0.0",
      dictionaryLocale: "en-US",
      supplementId: "word-list",
      supplementVersion: "4.1.0",
      domainDictionaryId: "la-game-localization",
      domainDictionaryVersion: "1",
      checkedWordCount: 4,
      unknownWordCount: 1,
    },
  },
);
assert.deepEqual(
  evaluatePrivateEvalMechanicalQa("开始", "開始", emptyTagRuleContext, { targetLocale: "zh-TW" }),
  {
    safe: true,
    blockerCodes: [],
    warningCodes: [],
    spelling: {
      status: "unsupported",
      requestedLocale: "zh-TW",
      checkedWordCount: 0,
      unknownWordCount: 0,
      reason: "unsupported_target_locale",
    },
  },
);

async function writeMinimalXlsx(path: string, headers: string[], rows: string[][]): Promise<void> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.folder("xl")?.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  const allRows = [headers, ...rows].map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const col = String.fromCharCode(65 + colIndex);
      return `<c r="${col}${rowIndex + 1}" t="inlineStr"><is><t>${value}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  zip.folder("xl")?.folder("worksheets")?.file("sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${allRows}</sheetData></worksheet>`);
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

const root = await mkdtemp(join(tmpdir(), "la-private-eval-"));
await assert.rejects(readPrivateEvalSet(root, "../escaped"), /path-free identifier/);
await assert.rejects(readPrivateEvalRun(root, "synthetic-eval-v1", "../escaped"), /path-free identifier/);
await assert.rejects(readPrivateEvalRun(root, "synthetic-eval-v1", " run-with-spaces "), /path-free identifier/);
const sourceRoot = join(root, "synthetic-rpg");
await mkdir(sourceRoot, { recursive: true });
await writeFile(join(sourceRoot, "LA-onboarding-2026-06-27.md"), "Style: concise fantasy RPG.\nUse terms consistently.", "utf8");
await writeFile(join(sourceRoot, "segments.json"), JSON.stringify([
  { segmentId: "ui-start", source: "开始", referenceTarget: "Start", tags: ["ui"] },
  { segmentId: "flavor-1", source: "诸神沉默了。", reviewedTarget: "The gods fell silent.", tags: ["flavor"] },
  { segmentId: "term-1", source: "神格", referenceTarget: "Divinity", tags: ["术语"] },
  { segmentId: "placeholder-1", source: "获得 {0} 个金币", referenceTarget: "Gain {0} Gold.", tags: ["ui"] },
  { segmentId: "style-1", source: "[b]觉醒[/b] 需要 3 个碎片", referenceTarget: "[b]Awakening[/b] requires 3 shards.", tags: ["style"] },
], null, 2), "utf8");
await mkdir(join(sourceRoot, "已完成", "客户审校返回"), { recursive: true });
await mkdir(join(sourceRoot, "TM"), { recursive: true });
await mkdir(join(sourceRoot, "术语"), { recursive: true });
await writeMinimalXlsx(join(sourceRoot, "已完成", "done.xlsx"), ["CN", "EN"], [["开始", "Begin"]]);
await writeMinimalXlsx(join(sourceRoot, "已完成", "客户审校返回", "returned.xlsx"), ["CN", "EN"], [["开始", "Start"]]);
await writeMinimalXlsx(join(sourceRoot, "TM", "LocalizationText.xlsx"), ["开始", "Start"], [["退出", "Exit"]]);
await writeMinimalXlsx(join(sourceRoot, "术语", "terms.xlsx"), ["CN", "EN"], [["神格", "Divinity"]]);

const created = await createPrivateEvalSet(root, {
  evalSetId: "synthetic-eval-v1",
  label: "Synthetic Game Eval v1",
  sourceRoot,
  sampleSize: 4,
});

assert.equal(created.evalSet.evalSetId, "synthetic-eval-v1");
assert.equal(created.segments.length, 4);
assert.equal(created.segments.some((segment) => segment.riskTypes.includes("ui")), true);
assert.equal(created.segments.some((segment) => segment.riskTypes.includes("placeholder")), true);
assert.equal(created.segments.some((segment) => segment.riskTypes.includes("tag")), true);
assert.equal(created.segments.some((segment) => segment.riskTypes.includes("terminology")), true);
assert.equal(created.segments.find((segment) => segment.segmentId === "ui-start")?.reviewedTarget, "Begin");
assert.equal(created.segments.find((segment) => segment.segmentId === "ui-start")?.customerReturnTarget, "Start");
assert.equal(created.segments.find((segment) => segment.segmentId === "ui-start")?.tmRefs.some((ref) => ref.includes("Start")), true);
assert.equal(created.segments.find((segment) => segment.segmentId === "ui-start")?.tmRefs.some((ref) => ref.includes(":Sheet1:1")), true, "headerless bilingual workbooks must retain their first row");
assert.deepEqual(created.segments.find((segment) => segment.segmentId === "ui-start")?.termRefs, [], "absolute temp paths must not misclassify TM/review files as termbase evidence");
assert.equal(created.segments.find((segment) => segment.segmentId === "term-1")?.termRefs.some((ref) => ref.includes("神格=Divinity")), true);
assert.equal(created.evalSet.assetPaths.some((path) => path.endsWith("LA-onboarding-2026-06-27.md")), true);
assert.deepEqual((await listPrivateEvalSets(root)).map((evalSet) => evalSet.evalSetId), ["synthetic-eval-v1"]);

const readBack = await readPrivateEvalSet(root, "synthetic-eval-v1");
assert.equal(readBack.segments.length, 4);

await mkdir(join(root, "data", "evals", "private", "legacy-set"), { recursive: true });
await writeFile(join(root, "data", "evals", "private", "legacy-set", "segments.jsonl"), JSON.stringify({
  evalSetId: "legacy-set",
  segmentId: "legacy-1",
  source: "开始",
}) + "\n", "utf8");
const legacy = await readPrivateEvalSet(root, "legacy-set");
assert.deepEqual(legacy.segments[0], {
  evalSetId: "legacy-set",
  segmentId: "legacy-1",
  source: "开始",
  tags: [],
  riskTypes: [],
  assetRefs: [],
  tmRefs: [],
  termRefs: [],
});

await createPrivateEvalRun(root, "synthetic-eval-v1", {
  runId: "run-single",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  projectId: "project-a",
  taskId: "eval-task-a",
  segmentCount: 2,
});
await createPrivateEvalRun(root, "synthetic-eval-v1", {
  runId: "run-team",
  mode: "team_workflow",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  projectId: "project-a",
  taskId: "eval-task-a",
});
const runs = await listPrivateEvalRuns(root, "synthetic-eval-v1");
assert.deepEqual(runs.map((run) => run.runId).sort(), ["run-single", "run-team"]);
assert.equal(runs.find((run) => run.runId === "run-team")?.modelRoutes.default, "deepseek/deepseek-v4-flash");
assert.equal(runs.find((run) => run.runId === "run-team")?.thinkingLevel, "medium");
await assert.rejects(
  createPrivateEvalRun(root, "synthetic-eval-v1", {
    runId: "run-team",
    mode: "team_workflow",
    modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  }),
  /already exists/,
);
await executePrivateEvalRun(root, "synthetic-eval-v1", "run-single", async ({ segment }) => ({
  target: `EN:${segment.source}`,
  notes: "fixture runner",
  rawResponse: JSON.stringify({ segmentId: segment.segmentId, target: `EN:${segment.source}` }),
  usage: { inputTokens: 10, cacheReadTokens: 40, cacheWriteTokens: 2, outputTokens: 5, totalTokens: 15, costUsd: 0.01 },
  executionManifest: {
    adapter: "single_pi",
    roleIds: [],
    estimatedCalls: 1,
    actualCalls: 1,
    rolePromptHashes: [],
    referenceIncluded: false,
    writeMode: "none",
  },
}), { segmentLimit: 2 });
const completedSingle = await readPrivateEvalRun(root, "synthetic-eval-v1", "run-single");
assert.equal(completedSingle.status, "completed");
assert.deepEqual(completedSingle.usage, { inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 4, outputTokens: 10, totalTokens: 30, costUsd: 0.02, modelCalls: 2 });
await updatePrivateEvalRun(root, {
  ...(await readPrivateEvalRun(root, "synthetic-eval-v1", "run-single")),
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:05.000Z",
  usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, costUsd: 0.0456 },
});
const outputs = await readPrivateEvalRunOutputs(root, "synthetic-eval-v1", "run-single");
assert.equal(outputs.length, 2);
assert.equal(outputs[0].status, "completed");
assert.match(outputs[0].target ?? "", /^EN:/);
assert.deepEqual(outputs[0].usage, { inputTokens: 10, cacheReadTokens: 40, cacheWriteTokens: 2, outputTokens: 5, totalTokens: 15, costUsd: 0.01 });

await executePrivateEvalRun(root, "synthetic-eval-v1", "run-team", async ({ segment }) => ({
  target: `TEAM:${segment.source}`,
  rawResponse: JSON.stringify({ segmentId: segment.segmentId, target: `TEAM:${segment.source}` }),
  executionManifest: {
    adapter: "canonical_team_workflow",
    roleIds: ["translator"],
    estimatedCalls: 1,
    actualCalls: 1,
    rolePromptHashes: [],
    referenceIncluded: false,
    writeMode: "none",
  },
}), { segmentLimit: 2 });
const blind = await createPrivateEvalBlindReview(root, "synthetic-eval-v1", {
  runIds: ["run-single", "run-team"],
  seed: "fixed-seed-60",
  sampleSize: 2,
});
assert.equal(blind.total, 2);
assert.equal(blind.judged, 0);
assert.equal(blind.complete, false);
assert.equal(blind.revealedRuns, undefined);
assert.equal(blind.pairs.every((pair) => pair.candidateARunId === undefined && pair.candidateBRunId === undefined), true);
assert.doesNotMatch(JSON.stringify(blind), /run-single|run-team|single_agent|team_workflow/);
assert.deepEqual((await readPrivateEvalBlindReview(root, "synthetic-eval-v1", blind.reviewId)).pairs, blind.pairs);
const firstJudgment = {
  pairId: blind.pairs[0].pairId,
  preference: "a" as const,
  issueTierA: "OK" as const,
  issueTierB: "B" as const,
  issueCategoriesA: [],
  issueCategoriesB: ["terminology"],
};
const partialBlind = await writePrivateEvalBlindJudgments(root, "synthetic-eval-v1", blind.reviewId, [firstJudgment]);
assert.equal(partialBlind.judged, 1);
assert.equal(partialBlind.complete, false);
assert.equal(partialBlind.revealedRuns, undefined);
assert.deepEqual(
  (await listPrivateEvalBlindReviews(root, "synthetic-eval-v1"))
    .map(({ reviewId, total, judged, complete }) => ({ reviewId, total, judged, complete })),
  [{ reviewId: blind.reviewId, total: 2, judged: 1, complete: false }],
);
const completedBlind = await writePrivateEvalBlindJudgments(root, "synthetic-eval-v1", blind.reviewId, [{
  pairId: blind.pairs[1].pairId,
  preference: "tie",
  issueTierA: "OK",
  issueTierB: "OK",
  issueCategoriesA: [],
  issueCategoriesB: [],
}]);
assert.equal(completedBlind.complete, true);
assert.equal(completedBlind.revealedRuns?.length, 2);
assert.equal(completedBlind.revealedRuns?.reduce((sum, run) => sum + run.wins, 0), 1);
assert.equal(completedBlind.pairs.every((pair) => Boolean(pair.candidateARunId && pair.candidateBRunId)), true);
const concurrentBlind = await createPrivateEvalBlindReview(root, "synthetic-eval-v1", {
  runIds: ["run-single", "run-team"],
  seed: "concurrent-seed",
  sampleSize: 2,
  reviewId: "blind-concurrent",
});
await Promise.all(concurrentBlind.pairs.map((pair, index) => writePrivateEvalBlindJudgments(root, "synthetic-eval-v1", concurrentBlind.reviewId, [{
  pairId: pair.pairId,
  preference: index === 0 ? "a" : "b",
  issueTierA: "OK",
  issueTierB: "OK",
  issueCategoriesA: [],
  issueCategoriesB: [],
}])));
assert.equal((await readPrivateEvalBlindReview(root, "synthetic-eval-v1", concurrentBlind.reviewId)).judged, 2, "concurrent judgments must not overwrite each other");
await assert.rejects(
  writePrivateEvalBlindJudgments(root, "synthetic-eval-v1", blind.reviewId, [null] as never),
  /requires a pairId/,
);
const blindReviewSummaries = await listPrivateEvalBlindReviews(root, "synthetic-eval-v1");
assert.deepEqual(
  blindReviewSummaries.map(({ reviewId, total, judged, complete }) => ({ reviewId, total, judged, complete })),
  [
    { reviewId: concurrentBlind.reviewId, total: 2, judged: 2, complete: true },
    { reviewId: blind.reviewId, total: 2, judged: 2, complete: true },
  ],
);
await assert.rejects(
  createPrivateEvalBlindReview(root, "synthetic-eval-v1", {
    runIds: ["run-single", "run-team"],
    seed: "fixed-seed-60",
    sampleSize: 2,
    reviewId: "../escape",
  }),
  /path-free identifier/,
);
await createPrivateEvalRun(root, "synthetic-eval-v1", {
  runId: "run-single-copy",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  projectId: "project-a",
  taskId: "eval-task-a",
});
await executePrivateEvalRun(root, "synthetic-eval-v1", "run-single-copy", async ({ segment }) => ({ target: `COPY:${segment.source}` }), { segmentLimit: 1 });
await assert.rejects(
  createPrivateEvalBlindReview(root, "synthetic-eval-v1", {
    runIds: ["run-single", "run-single-copy"],
    seed: "same-mode",
    sampleSize: 1,
  }),
  /one Single run and one Team run/,
);
const scopedSingle = await readPrivateEvalRun(root, "synthetic-eval-v1", "run-single");
const scopedTeam = await readPrivateEvalRun(root, "synthetic-eval-v1", "run-team");
await updatePrivateEvalRun(root, { ...scopedSingle, projectId: "project-a", taskId: "eval-task-a" });
await updatePrivateEvalRun(root, { ...scopedTeam, projectId: "project-b", taskId: "eval-task-b" });
await assert.rejects(
  createPrivateEvalBlindReview(root, "synthetic-eval-v1", {
    runIds: ["run-single", "run-team"],
    seed: "scope-mismatch",
    sampleSize: 2,
  }),
  /same canonical project and Eval Task scope/,
);
await updatePrivateEvalRun(root, scopedSingle);
await updatePrivateEvalRun(root, scopedTeam);
await assert.rejects(
  writePrivateEvalBlindJudgments(root, "synthetic-eval-v1", blind.reviewId, [{ ...firstJudgment, pairId: "missing" }]),
  /Unknown blind review pair/,
);

await createPrivateEvalRun(root, "synthetic-eval-v1", {
  runId: "run-stop",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
});
let shouldStop = false;
await executePrivateEvalRun(root, "synthetic-eval-v1", "run-stop", async ({ segment }) => {
  shouldStop = true;
  return {
    target: `STOP:${segment.source}`,
    rawResponse: JSON.stringify({ segmentId: segment.segmentId, target: `STOP:${segment.source}` }),
  };
}, { segmentLimit: 3, shouldStop: () => shouldStop });
assert.equal((await readPrivateEvalRun(root, "synthetic-eval-v1", "run-stop")).status, "stopped");
assert.equal((await readPrivateEvalRunOutputs(root, "synthetic-eval-v1", "run-stop")).length, 0, "an in-flight result must not be accepted after Stop");

await createPrivateEvalRun(root, "synthetic-eval-v1", {
  runId: "run-resume",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
});
let resumeCalls = 0;
await assert.rejects(executePrivateEvalRun(root, "synthetic-eval-v1", "run-resume", async ({ segment }) => {
  resumeCalls += 1;
  if (resumeCalls === 2) throw new Error("Connection error.");
  return { target: `RESUME:${segment.source}`, rawResponse: "ok" };
}, { segmentLimit: 2 }), /Connection error/);
assert.equal((await readPrivateEvalRunOutputs(root, "synthetic-eval-v1", "run-resume")).length, 1);
await executePrivateEvalRun(root, "synthetic-eval-v1", "run-resume", async ({ segment }) => {
  resumeCalls += 1;
  return { target: `RESUME:${segment.source}`, rawResponse: "ok" };
}, { segmentLimit: 2 });
assert.equal(resumeCalls, 3, "resume must skip the already persisted segment instead of paying for it again");
assert.equal((await readPrivateEvalRunOutputs(root, "synthetic-eval-v1", "run-resume")).length, 2);
assert.equal((await readPrivateEvalRun(root, "synthetic-eval-v1", "run-resume")).status, "completed");

await createPrivateEvalRun(root, "synthetic-eval-v1", {
  runId: "run-checkpoint-source",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  projectId: "project-a",
  taskId: "eval-task-a",
  segmentCount: 2,
});
let checkpointCalls = 0;
await assert.rejects(executePrivateEvalRun(root, "synthetic-eval-v1", "run-checkpoint-source", async ({ segment }) => {
  checkpointCalls += 1;
  if (checkpointCalls === 2) throw new Error("provider interrupted");
  return { target: `CHECKPOINT:${segment.source}`, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
}, { segmentLimit: 2 }), /provider interrupted/);
await createPrivateEvalRun(root, "synthetic-eval-v1", {
  runId: "run-checkpoint-resumed",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  projectId: "project-a",
  taskId: "eval-task-a",
  segmentCount: 2,
  resumedFromRunId: "run-checkpoint-source",
});
const seeded = await seedPrivateEvalRunFromCheckpoint(root, "synthetic-eval-v1", "run-checkpoint-resumed", "run-checkpoint-source");
assert.equal(seeded.length, 1);
assert.equal(seeded[0].runId, "run-checkpoint-resumed");
await executePrivateEvalRun(root, "synthetic-eval-v1", "run-checkpoint-resumed", async ({ segment }) => {
  checkpointCalls += 1;
  return { target: `CHECKPOINT:${segment.source}`, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } };
}, { segmentLimit: 2 });
assert.equal(checkpointCalls, 3, "a new attempt must pay only for the missing checkpoint row");
assert.equal((await readPrivateEvalRunOutputs(root, "synthetic-eval-v1", "run-checkpoint-resumed")).length, 2);
assert.deepEqual((await readPrivateEvalRun(root, "synthetic-eval-v1", "run-checkpoint-resumed")).usage, {
  inputTokens: 6,
  outputTokens: 4,
  totalTokens: 10,
  modelCalls: 2,
});

const sourceOnlyRoot = join(root, "source-only");
await mkdir(join(sourceOnlyRoot, "待翻译文本"), { recursive: true });
await writeMinimalXlsx(join(sourceOnlyRoot, "待翻译文本", "source-only.xlsx"), ["CN"], [["领取奖励"], ["神格提升到 3 级"]]);
const sourceOnly = await createPrivateEvalSet(root, {
  evalSetId: "source-only-v1",
  label: "Source only v1",
  sourceRoot: sourceOnlyRoot,
  sampleSize: 2,
});
assert.equal(sourceOnly.segments.length, 2);
assert.equal(sourceOnly.segments[0].source, "领取奖励");
assert.equal(sourceOnly.segments[0].segmentId.includes("source-only:Sheet1:"), true);

await writeHumanScorecard(root, "synthetic-eval-v1", "run-team", [
  {
    runId: "run-team",
    segmentId: "ui-start",
    dimension: "function_strategy_fit",
    score: 5,
    judge: "human:reviewer",
    issueTier: "OK",
    issueCategories: [],
  },
]);
const scoreRows = await readHumanScorecard(root, "synthetic-eval-v1", "run-team");
assert.equal(scoreRows.length, 1);
assert.equal(scoreRows[0].dimension, "function_strategy_fit");
await writeHumanScorecard(root, "synthetic-eval-v1", "run-team", [{ ...scoreRows[0], score: 2, issueTier: "B" }]);
const revisedScoreRows = await readHumanScorecard(root, "synthetic-eval-v1", "run-team");
assert.equal(revisedScoreRows.length, 1);
assert.equal(revisedScoreRows[0].score, 2);
await assert.rejects(
  writeHumanScorecard(root, "synthetic-eval-v1", "run-team", [{ ...scoreRows[0], runId: "another-run" }]),
  /runId does not match/,
);
await writeHumanScorecard(root, "synthetic-eval-v1", "run-single", EVAL_DIMENSIONS.map((dimension) => ({
  runId: "run-single",
  segmentId: outputs[0].segmentId,
  dimension,
  score: 4,
  judge: "human:reviewer",
  issueTier: "OK",
  issueCategories: dimension === "genre_voice_fit" ? ["voice"] : [],
  accepted: true,
})));
const comparison = await renderPrivateEvalComparison(root, "synthetic-eval-v1", "cmp-1");
assert.match(comparison.markdown, /Synthetic Game Eval v1/);
assert.match(comparison.markdown, /## Evidence Coverage/);
assert.match(comparison.markdown, /TM ref segments: 1\/4/);
assert.match(comparison.markdown, /Term ref segments: 1\/4/);
assert.match(comparison.markdown, /## Overall Dimension Averages/);
assert.match(comparison.markdown, /### single_agent - run-single/);
assert.match(comparison.markdown, /Execution adapter: single_pi:2/);
assert.match(comparison.markdown, /Recorded model calls: 2/);
assert.match(comparison.markdown, /Duration: 1m 5s/);
assert.match(comparison.markdown, /Token\/cost: 1500 tokens, \$0\.0456/);
assert.match(comparison.markdown, /Outputs: 2\/4/);
assert.match(comparison.markdown, /Output success: 2\/2 completed, 0 failed/);
assert.match(comparison.markdown, /Evidence output coverage: TM 1\/1, Term 0\/1/);
assert.match(comparison.markdown, /Fully scored outputs: 1\/2/);
assert.match(comparison.markdown, /Human OK outputs: 1\/1 fully scored/);
assert.match(comparison.markdown, /Human accepted outputs: 1\/1/);
assert.match(comparison.markdown, /Issue categories: voice:1/);
assert.doesNotMatch(comparison.markdown, /prompt-based team-standards simulation/);
assert.match(comparison.markdown, /function_strategy_fit/);
assert.match(await readFile(comparison.reportPath, "utf8"), /run-team/);

console.log("private_eval tests passed");
