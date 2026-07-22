import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskWorkspace, defaultSubagentAsyncRoot, readCatWorkflowRun, type TeamRoleId } from "@linguist-agent/cat-data";
import { runPrivateEvalCanonicalTeam } from "../packages/cat-server/src/private_eval_canonical_team.js";

const root = await mkdtemp(join(tmpdir(), "la-canonical-eval-team-"));
const asyncRoot = defaultSubagentAsyncRoot();
await mkdir(asyncRoot, { recursive: true });
const asyncDirs: string[] = [];
const calls: Array<{ roleId: TeamRoleId; task: string; model?: string }> = [];
const lifecycle: string[] = [];
let projectionChecked = false;
const outputs = (roleId: TeamRoleId) => {
  if (roleId === "producer") return { roleId, summary: "Brief ready.", brief: { projectGoal: "Translate UI", scope: ["s1", "s2"], knownAssets: [], missingInputs: [], risks: [], handoffNotes: [] } };
  if (roleId === "lead_linguist_setup") return { roleId, summary: "Strategy ready.", strategy: { authorityOrder: [], voiceRules: [], genreRules: [], uiRules: ["Use conventional verbs"], termRules: [], queryRules: [], mustNotDo: [] } };
  if (roleId === "translator") return {
    roleId,
    summary: "Candidates ready.",
    candidates: [
      { segmentId: "eval-0001", target: "Start", evidenceRefs: ["TM: Start"], function: "ui" },
      { segmentId: "eval-0002", target: "Continue", evidenceRefs: [], function: "ui" },
    ],
  };
  if (roleId === "lead_linguist_final") return {
    roleId,
    summary: "Final candidates ready.",
    candidateTargets: [
      { segmentId: "eval-0001", target: "Start", notes: "Conventional UI wording.", evidenceRefs: ["TM: Start"] },
      { segmentId: "eval-0002", target: "Continue", notes: "Conventional UI wording.", evidenceRefs: [] },
    ],
  };
  return { roleId, summary: "No material issue.", noIssues: true, findings: [], queries: [] };
};

const result = await runPrivateEvalCanonicalTeam({
  repoRoot: root,
  parentRunId: "eval-run",
  evalSetId: "set",
  sourceLocale: "zh-CN",
  targetLocale: "en-US",
  modelRoutes: { default: "opencode-go/deepseek-v4-flash" },
  thinkingLevel: "medium",
  segments: [
    { segmentId: "原始项目:Sheet1:一", source: "开始", tags: ["ui"], riskTypes: ["ui"], tmRefs: ["TM: Start"], termRefs: [] },
    { segmentId: "原始项目:Sheet1:二", source: "继续", tags: ["ui"], riskTypes: ["ui"], tmRefs: [], termRefs: [] },
  ],
  onRoleEvent: (event) => { lifecycle.push(`${event.roleId}:${event.type}`); },
  workflowDeps: {
    repoRoot: root,
    json: () => undefined,
    readBody: async () => ({}),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    spawnSubagentRun: async (projectId, workflowId, roleId, request) => {
      calls.push({ roleId, task: request.params.task, model: request.params.model });
      const workflow = await readCatWorkflowRun(root, projectId, workflowId);
      assert.ok(workflow.taskId);
      const snapshot = await createTaskWorkspace(root).open({ projectId, taskId: workflow.taskId });
      assert.ok(snapshot.runs.some((run) => run.id === workflowId), "canonical Team Eval must project its Run before spawning a child");
      projectionChecked = true;
      const runId = `canonical-eval-${roleId}-${Date.now()}-${calls.length}`;
      const asyncDir = join(asyncRoot, runId);
      asyncDirs.push(asyncDir);
      await mkdir(asyncDir, { recursive: true });
      const outputFile = join(asyncDir, "output.log");
      await writeFile(outputFile, JSON.stringify(outputs(roleId)), "utf8");
      await writeFile(join(asyncDir, "status.json"), JSON.stringify({
        lifecycleArtifactVersion: 1,
        runId,
        mode: "single",
        state: "complete",
        agent: `la-team-${roleId.replaceAll("_", "-")}`,
        startedAt: Date.now(),
        endedAt: Date.now() + 1,
        outputFile,
        totalTokens: { input: 10, output: 5, total: 15 },
        totalCost: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
        steps: [{ agent: `la-team-${roleId.replaceAll("_", "-")}`, model: "opencode-go/deepseek-v4-flash" }],
      }), "utf8");
      return { details: { asyncDir } };
    },
  },
});

assert.equal(result.get("原始项目:Sheet1:一")?.target, "Start");
assert.equal(result.get("原始项目:Sheet1:二")?.target, "Continue");
const manifest = result.get("原始项目:Sheet1:一")?.executionManifest;
assert.equal(manifest?.adapter, "canonical_team_workflow");
assert.equal(manifest?.actualCalls, calls.length);
assert.equal(manifest?.referenceIncluded, false);
assert.equal(manifest?.writeMode, "none");
assert.equal(manifest?.thinkingLevel, "medium");
assert.equal(manifest?.segmentIdMode, "eval_alias_v1");
assert.ok(manifest?.rolePromptHashes.every((row) => /^[0-9a-f]{64}$/.test(row.promptHash)));
assert.equal(manifest?.roleContextManifests?.length, calls.length);
assert.ok(manifest?.roleContextManifests?.every((row) => row.manifest.promptHash === manifest.rolePromptHashes.find((hash) => hash.roleId === row.roleId)?.promptHash));
assert.ok(manifest?.roleContextManifests?.every((row) => row.manifest.referenceIncluded === false && row.manifest.hardConstraintsPreserved));
assert.ok(manifest?.roleContextManifests?.every((row) => /^[0-9a-f]{64}$/.test(row.manifest.contextHash)));
assert.ok(calls.length < 10, "batch roles must run once, not once per segment");
assert.equal(new Set(calls.map((call) => call.roleId)).size, calls.length);
assert.ok(calls.every((call) => !call.task.includes("batch_read")), "the exact Eval segment scope should be inline instead of forcing a redundant batch read");
assert.ok(calls.every((call) => call.task.includes("Scoped segment packet:")));
assert.ok(calls.every((call) => call.task.includes("[eval-0001]") && !call.task.includes("原始项目:Sheet1")));
assert.ok(calls.every((call) => call.task.includes("Locale: zh-CN -> en-US")), "isolated Team prompts must inherit the canonical batch locale");
assert.ok(calls.every((call) => !call.task.includes("tm_lookup")), "blind Eval must use only its replayable scoped packet");
assert.ok(calls.every((call) => call.task.includes("Callable CAT evidence tools: none")));
assert.ok(calls.every((call) => call.task.includes("No artifact-read tool is available") && !call.task.includes("Use team_artifact_read")));
assert.ok(calls.every((call) => call.model === "opencode-go/deepseek-v4-flash:medium"));
assert.ok(calls.every((call) => !call.task.includes("WITHHELD")));
assert.ok(lifecycle.includes("translator:started"));
assert.ok(lifecycle.includes("translator:completed"));
assert.equal(projectionChecked, true);
assert.deepEqual((await readdir(join(root, "data", "projects"))).filter((row) => row.startsWith("private-eval-")), []);

await Promise.all(asyncDirs.map((dir) => rm(dir, { recursive: true, force: true })));
await rm(root, { recursive: true, force: true });
console.log("canonical private Eval Team tests passed");
