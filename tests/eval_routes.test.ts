import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActiveAgentRunRegistry } from "../packages/cat-server/src/active_agent_runs.js";
import { handleEvalRoute } from "../packages/cat-server/src/routes/eval_routes.js";
import { createPrivateEvalRun, createPrivateEvalSet, createProjectManifest, createTaskWorkspace, executePrivateEvalRun, importCsvBatch, listPrivateEvalRuns, readPrivateEvalRun, readPrivateEvalRunOutputs } from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-eval-route-"));
const sourceRoot = join(root, "source");
await mkdir(sourceRoot, { recursive: true });
await writeFile(join(sourceRoot, "segments.json"), JSON.stringify([
  { segmentId: "seg-1", source: "开始", tags: ["ui"] },
  { segmentId: "seg-2", source: "继续", tags: ["ui"] },
]), "utf8");
await createPrivateEvalSet(root, {
  evalSetId: "route-set",
  label: "Route Set",
  sourceRoot,
  sampleSize: 2,
});
await createProjectManifest(root, sourceRoot, { projectId: "project-1", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
const batchCsv = join(sourceRoot, "batch.csv");
await writeFile(batchCsv, "SegmentID,Source,Target\nseg-1,开始,\nseg-2,继续,\n", "utf8");
await importCsvBatch(root, { projectId: "project-1", csvPath: batchCsv, batchId: "batch-1" });
await createTaskWorkspace(root).create({ projectId: "project-1", taskId: "eval-task-1", title: "Route eval", intent: "Test canonical eval projection.", kind: "eval", scope: { batchId: "batch-1" } });
await writeFile(join(root, "data", "evals", "private", "route-set", "segments.jsonl"), [
  JSON.stringify({
    evalSetId: "route-set",
    segmentId: "seg-1",
    source: "开始",
    referenceTarget: "Reference Start",
    reviewedTarget: "Reviewed Start",
    customerReturnTarget: "Customer Start",
    tags: ["ui"],
    riskTypes: ["ui"],
    assetRefs: [],
    tmRefs: ["TM/LocalizationText.xlsx:Sheet1:2 => Start"],
    termRefs: ["术语/terms.xlsx:Sheet1:2 => 开始=Start"],
  }),
  JSON.stringify({
    evalSetId: "route-set",
    segmentId: "seg-2",
    source: "继续",
    tags: ["ui"],
    riskTypes: ["ui"],
    assetRefs: [],
    tmRefs: [],
    termRefs: [],
  }),
].join("\n") + "\n", "utf8");

const activeRuns = new ActiveAgentRunRegistry();
const bodies: Array<Record<string, unknown>> = [
  {
    execute: true,
    background: true,
    mode: "team_workflow",
    projectId: "project-1",
    batchId: "batch-1",
    taskId: "eval-task-1",
    segmentLimit: 2,
    modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  },
  { reason: "test stop" },
];
const responses: Array<{ status: number; data: unknown }> = [];
let releaseAgent!: () => void;
let agentStarted!: () => void;
const generationPackets: string[] = [];
const generationPrompts: string[] = [];
const teamLocalePackets: string[] = [];
const teamThinkingLevels: unknown[] = [];
const singleRunOptions: Array<Record<string, unknown>> = [];
let childAborts = 0;
let childDisposals = 0;
const agentGate = new Promise<void>((resolve) => {
  releaseAgent = resolve;
});
const agentStartedGate = new Promise<void>((resolve) => {
  agentStarted = resolve;
});
const deps = {
  repoRoot: root,
  json: (_res: ServerResponse, status: number, data: unknown) => responses.push({ status, data }),
  readBody: async () => bodies.shift() ?? {},
  requireString: (value: unknown, label: string) => {
    if (typeof value !== "string") throw new Error(`${label} is required`);
    return value;
  },
  optionalString: (value: unknown) => typeof value === "string" ? value : undefined,
  activeRuns,
  runSingleGeneration: async (input: { prompt: string } & Record<string, unknown>) => {
    generationPrompts.push(input.prompt);
    singleRunOptions.push(input);
    const aliases = [...new Set([...input.prompt.matchAll(/\"segmentId\":\"(eval-\d+)\"/g)].map((match) => match[1]))];
    return {
      text: JSON.stringify({ candidates: aliases.map((segmentId) => ({ segmentId, target: "Start", notes: "canonical batch" })) }),
      usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18, costUsd: 0.002, modelCalls: 1 },
    };
  },
  runTeamWorkflow: async (request: { parentRunId: string; sourceLocale: string; targetLocale: string; segments: Array<{ segmentId: string; source: string }>; onRoleEvent?: (event: Record<string, unknown>) => Promise<void> }) => {
    generationPackets.push(JSON.stringify(request.segments));
    teamLocalePackets.push(`${request.sourceLocale}->${request.targetLocale}`);
    teamThinkingLevels.push((request as { thinkingLevel?: unknown }).thinkingLevel);
    await request.onRoleEvent?.({ type: "started", segmentId: "batch", roleId: "translator", callIndex: 1, roleAttempt: 1, modelRoute: "deepseek/deepseek-v4-flash", promptHash: "a".repeat(64) });
    activeRuns.register({
      turnId: "eval-child-turn",
      scope: "workflow_role",
      projectId: "project-1",
      parentRunId: request.parentRunId,
      session: {
        abort: async () => {
          childAborts += 1;
          releaseAgent();
        },
        dispose: () => { childDisposals += 1; },
      },
    });
    agentStarted();
    try {
      await agentGate;
    } finally {
      activeRuns.unregister("eval-child-turn");
    }
    await request.onRoleEvent?.({ type: "completed", segmentId: "batch", roleId: "translator", callIndex: 1, roleAttempt: 1, modelRoute: "deepseek/deepseek-v4-flash", promptHash: "a".repeat(64) });
    return new Map(request.segments.map((segment, index) => [segment.segmentId, {
      target: index ? "Continue" : "Start",
      executionManifest: { adapter: "canonical_team_workflow", roleIds: ["translator"], estimatedCalls: 1, actualCalls: 1, rolePromptHashes: [{ roleId: "translator", promptHash: "a".repeat(64), modelRoute: "deepseek/deepseek-v4-flash" }], referenceIncluded: false, writeMode: "none" },
      usage: index ? undefined : { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001, modelCalls: 1 },
    }]));
  },
};

assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs"], deps), true);
assert.equal(responses[0].status, 202);
const runId = (responses[0].data as { run: { runId: string } }).run.runId;
const canonicalTaskId = (responses[0].data as { run: { taskId?: string } }).run.taskId;
assert.ok(canonicalTaskId);
assert.notEqual(canonicalTaskId, "eval-task-1", "client-authored Eval taskId must not select the canonical Task");
const visibleAtAccepted = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: canonicalTaskId });
assert.equal(visibleAtAccepted.runs.find((run) => run.id === runId)?.status, "active", "202 must not race the canonical Task Run projection");
assert.equal(activeRuns.isStoppingOrStopped(runId), false);
assert.equal(await handleEvalRoute({ method: "GET" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs"], deps), true);
const liveRow = (responses.at(-1)?.data as { rows: Array<{ runId: string; status: string }> }).rows.find((row) => row.runId === runId);
assert.equal(liveRow?.status, "running", "same-process active Eval must not be reconciled as a restart orphan");
await agentStartedGate;
assert.equal(generationPackets.length, 1);
assert.deepEqual(teamLocalePackets, ["zh-CN->en-US"]);
assert.deepEqual(teamThinkingLevels, ["medium"]);
assert.doesNotMatch(generationPackets[0], /referenceTarget|reviewedTarget|customerReturnTarget/);
assert.doesNotMatch(generationPackets[0], /Reference Start|Reviewed Start|Customer Start/);
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs", runId, "stop"], deps), true);
assert.equal((responses.at(-1)?.data as { stopped: number }).stopped, 1);
for (let attempt = 0; attempt < 100 && activeRuns.list().length; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(childAborts, 1);
assert.equal(childDisposals, 1);
assert.equal(activeRuns.list().length, 0, "stopped Eval parent and child runs must leave no active registry entries");
const stoppedRun = await readPrivateEvalRun(root, "route-set", runId);
assert.equal(stoppedRun.status, "stopped");
assert.equal(stoppedRun.usage, undefined);
const evalOutputs = await readPrivateEvalRunOutputs(root, "route-set", runId);
assert.equal(evalOutputs.length, 0);
const taskSnapshot = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: canonicalTaskId });
assert.equal(taskSnapshot.runs[0]?.status, "stopped");
assert.equal(taskSnapshot.artifacts.some((artifact) => artifact.type === "eval_output"), false);

const runCountBeforeCreateOnly = (await listPrivateEvalRuns(root, "route-set")).length;
bodies.push({ runId: "create-only-must-not-exist", mode: "single_agent" });
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs"], deps), true);
assert.equal(responses.at(-1)?.status, 400);
assert.equal((await listPrivateEvalRuns(root, "route-set")).length, runCountBeforeCreateOnly, "create-only requests must not persist false-running Eval records");
bodies.push({ execute: true, runId: "client-owned-run-id" });
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs"], deps), true);
assert.equal(responses.at(-1)?.status, 400);
assert.match((responses.at(-1)?.data as { error: string }).error, /server-owned/);
bodies.push({ execute: true, thinkingLevel: "turbo" });
await assert.rejects(
  handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs"], deps),
  /thinkingLevel must be one of/,
);

bodies.push({ runId, rows: [{
  runId,
  segmentId: "seg-1",
  dimension: "adequacy",
  score: 5,
  judge: "human:reviewer",
  issueTier: "OK",
  issueCategories: [],
}] });
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "scorecards"], deps), true);
assert.equal(await handleEvalRoute({ method: "GET" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "scorecards", runId], deps), true);
assert.equal((responses.at(-1)!.data as { rows: Array<{ dimension: string }> }).rows[0].dimension, "adequacy");
const reviewedTask = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: canonicalTaskId });
assert.deepEqual(reviewedTask.artifacts.map((artifact) => artifact.type).sort(), ["eval_comparison", "eval_scorecard"]);

await createTaskWorkspace(root).create({ projectId: "project-1", taskId: "eval-task-recovery", title: "Recovered eval", intent: "Recover a stale run after restart.", kind: "eval" });
await createPrivateEvalRun(root, "route-set", {
  runId: "eval-run-recovery",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  projectId: "project-1",
  taskId: "eval-task-recovery",
  segmentCount: 1,
});
bodies.push({ reason: "recover stale run" });
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs", "eval-run-recovery", "stop"], deps), true);
assert.equal((responses.at(-1)!.data as { stopped: number }).stopped, 1);
const recoveredTask = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: "eval-task-recovery" });
assert.equal(recoveredTask.runs[0]?.status, "stopped");

await createTaskWorkspace(root).create({ projectId: "project-1", taskId: "eval-task-orphan", title: "Interrupted eval", intent: "Recover an orphaned running record.", kind: "eval" });
await createPrivateEvalRun(root, "route-set", {
  runId: "eval-run-orphan",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  projectId: "project-1",
  taskId: "eval-task-orphan",
  segmentCount: 1,
});
assert.equal(await handleEvalRoute({ method: "GET" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs"], deps), true);
const reconciledRows = (responses.at(-1)?.data as { rows: Array<{ runId: string; status: string; error?: string }> }).rows;
const reconciledRun = reconciledRows.find((row) => row.runId === "eval-run-orphan");
assert.equal(reconciledRun?.status, "failed");
assert.match(reconciledRun?.error ?? "", /runtime execution is no longer active/);
const reconciledTask = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: "eval-task-orphan" });
assert.equal(reconciledTask.runs[0]?.status, "failed");
assert.equal(reconciledTask.activities.filter((activity) => activity.id === "eval-run-orphan.failed").length, 1);

bodies.push({
  execute: true,
  background: false,
  mode: "single_agent",
  projectId: "project-1",
  batchId: "batch-1",
  segmentLimit: 1,
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
});
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs"], deps), true);
assert.deepEqual(singleRunOptions[0]?.runOptions, {
  noTools: "all",
  noSession: true,
  noContextFiles: true,
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
});
assert.equal(singleRunOptions[0]?.thinkingLevel, "medium");
assert.equal((responses.at(-1)!.data as { run: { thinkingLevel?: string } }).run.thinkingLevel, "medium");
assert.match(generationPrompts.at(-1) ?? "", /\"source\":\"zh-CN\",\"target\":\"en-US\"/);
const singleEvalOutput = (responses.at(-1)!.data as { outputs: Array<{ executionManifest?: { adapter?: string }; mechanicalQa?: { spelling?: { dictionaryId?: string; dictionaryVersion?: string } } }> }).outputs[0];
assert.equal(singleEvalOutput?.executionManifest?.adapter, "canonical_single_batch");
assert.deepEqual(singleEvalOutput?.mechanicalQa?.spelling, {
  status: "checked",
  requestedLocale: "en-US",
  dictionaryId: "dictionary-en",
  dictionaryVersion: "4.0.0",
  dictionaryLocale: "en-US",
  supplementId: "word-list",
  supplementVersion: "4.1.0",
  domainDictionaryId: "la-game-localization",
  domainDictionaryVersion: "1",
  checkedWordCount: 1,
  unknownWordCount: 0,
});
assert.deepEqual((responses.at(-1)!.data as { run: { usage?: unknown } }).run.usage, {
  inputTokens: 12,
  outputTokens: 6,
  totalTokens: 18,
  costUsd: 0.002,
  modelCalls: 1,
});
assert.equal((responses.at(-1)!.data as { run: { taskId?: string } }).run.taskId, canonicalTaskId);
const pairedTask = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: canonicalTaskId });
assert.equal(pairedTask.runs.length, 2);
assert.equal(pairedTask.artifacts.find((artifact) => artifact.type === "eval_comparison")?.version, 3);
assert.equal(pairedTask.artifacts.find((artifact) => artifact.type === "eval_comparison")?.summary, "2 runs compared");

await createPrivateEvalRun(root, "route-set", {
  runId: "eval-run-checkpoint-source",
  mode: "single_agent",
  modelRoutes: { default: "deepseek/deepseek-v4-flash" },
  projectId: "project-1",
  taskId: canonicalTaskId,
  segmentCount: 2,
  thinkingLevel: "medium",
});
let checkpointCalls = 0;
await assert.rejects(executePrivateEvalRun(root, "route-set", "eval-run-checkpoint-source", async ({ segment }) => {
  checkpointCalls += 1;
  if (checkpointCalls === 2) throw new Error("provider disconnected");
  return { target: `Checkpoint:${segment.source}`, usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } };
}, { segmentLimit: 2 }), /provider disconnected/);
const generationCountBeforeResume = singleRunOptions.length;
bodies.push({
  execute: true,
  background: false,
  resumedFromRunId: "eval-run-checkpoint-source",
  projectId: "project-1",
  batchId: "batch-1",
});
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "runs"], deps), true);
const resumedResult = responses.at(-1)!.data as { run: { runId: string; resumedFromRunId?: string; checkpointOutputCount?: number; checkpointUsage?: { modelCalls?: number }; usage?: { modelCalls?: number } }; outputs: Array<{ runId: string }> };
assert.notEqual(resumedResult.run.runId, "eval-run-checkpoint-source", "resume must create a new server-owned attempt");
assert.equal(resumedResult.run.resumedFromRunId, "eval-run-checkpoint-source");
assert.equal(resumedResult.run.checkpointOutputCount, 1);
assert.equal(resumedResult.run.checkpointUsage?.modelCalls, 1, "reused checkpoint cost must remain distinguishable from calls made by this attempt");
assert.equal(resumedResult.outputs.length, 2);
assert.ok(resumedResult.outputs.every((output) => output.runId === resumedResult.run.runId));
assert.equal(resumedResult.run.usage?.modelCalls, 2, "the resumed attempt owns checkpoint and new-call usage as one complete comparison run");
assert.equal(singleRunOptions.length - generationCountBeforeResume, 1, "the route resume must call the provider only for the missing row");
const resumedTask = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: canonicalTaskId });
assert.equal(resumedTask.runs.find((row) => row.id === resumedResult.run.runId)?.status, "complete");
assert.equal(resumedTask.artifacts.filter((artifact) => artifact.runId === resumedResult.run.runId && artifact.type === "eval_output").length, 2);

for (const [runId, mode, prefix] of [["blind-single", "single_agent", "S"], ["blind-team", "team_workflow", "T"]] as const) {
  await createPrivateEvalRun(root, "route-set", {
    runId,
    mode,
    modelRoutes: { default: "test/model" },
    segmentCount: 1,
    projectId: "project-1",
    taskId: canonicalTaskId,
  });
  await executePrivateEvalRun(root, "route-set", runId, async ({ segment }) => ({ target: `${prefix}:${segment.source}` }), { segmentLimit: 2 });
}
bodies.push({ runIds: ["blind-single", "blind-team"], seed: "fixed", sampleSize: 2, reviewId: "blind-route" });
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "blind-reviews"], deps), true);
const blindResponse = responses.at(-1)!.data as { complete: boolean; pairs: Array<{ pairId: string }> };
assert.equal(blindResponse.complete, false);
assert.doesNotMatch(JSON.stringify(blindResponse), /blind-single|blind-team|single_agent|team_workflow/);
assert.equal(await handleEvalRoute({ method: "GET" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "blind-reviews"], deps), true);
const blindIndex = responses.at(-1)!.data as { rows: Array<{ reviewId: string; evalSetId: string; createdAt: string; total: number; judged: number; complete: boolean }> };
assert.deepEqual(blindIndex.rows, [{ reviewId: "blind-route", evalSetId: "route-set", createdAt: blindIndex.rows[0].createdAt, total: 2, judged: 0, complete: false }]);
assert.doesNotMatch(JSON.stringify(blindIndex), /blind-single|blind-team|single_agent|team_workflow/);
bodies.push({ rows: [{ pairId: blindResponse.pairs[0].pairId, preference: "a", issueTierA: "OK", issueTierB: "B", issueCategoriesA: [], issueCategoriesB: [] }] });
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "blind-reviews", "blind-route", "judgments"], deps), true);
assert.equal((responses.at(-1)!.data as { complete: boolean }).complete, false);
const partialTask = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: canonicalTaskId });
assert.equal(partialTask.artifacts.find((artifact) => artifact.id.endsWith(".blind.blind-route"))?.status, "reviewable");
bodies.push({ rows: [{ pairId: blindResponse.pairs[1].pairId, preference: "b", issueTierA: "B", issueTierB: "OK", issueCategoriesA: [], issueCategoriesB: [] }] });
assert.equal(await handleEvalRoute({ method: "POST" } as IncomingMessage, {} as ServerResponse, ["api", "evals", "private", "route-set", "blind-reviews", "blind-route", "judgments"], deps), true);
assert.equal((responses.at(-1)!.data as { complete: boolean }).complete, true);
const completeTask = await createTaskWorkspace(root).open({ projectId: "project-1", taskId: canonicalTaskId });
assert.equal(completeTask.artifacts.find((artifact) => artifact.id.endsWith(".blind.blind-route"))?.status, "final");

console.log("eval_routes tests passed");
