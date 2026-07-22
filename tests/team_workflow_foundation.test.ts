import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEAM_ROLE_IDS,
  type TeamRolePass,
  type TeamRoleSettings,
  buildCatWorkflowPlan,
  buildTeamRoleContext,
  completeCatWorkflowStep,
  createCatWorkflowRun,
  createTaskWorkspace,
  defaultSubagentAsyncRoot,
  defaultTeamRoleProfiles,
  readCatWorkflowRun,
  readQualityDecisionLedger,
  readTeamRoleSettings,
  readSubagentAsyncStatus,
  waitForSubagentAsyncStatus,
  readWorkflowArtifacts,
  stopCatWorkflowRun,
  teamRoleOutputContract,
  upsertTeamRolePass,
  validateTeamRoleOutputPresence,
  writeWorkflowArtifacts,
  writeTeamRoleSettings,
} from "@linguist-agent/cat-data";
import { continueTeamWorkflowUntilPause, handleWorkflowRoute, preflightTeamWorkflowRun, startSpecialistFollowUp } from "../packages/cat-server/src/routes/workflow_routes.js";
import { handleTaskWorkspaceRoute } from "../packages/cat-server/src/routes/task_workspace_routes.js";
import {
  bindSubagentResultDeliveryAcknowledgement,
  buildSubagentSpawnRequest,
  callSubagentRpc,
  spawnSubagentViaRpc,
  teamRoleAgentName,
  teamRoleModelSpecifier,
} from "../packages/cat-server/src/subagent_team_adapter.js";

assert.equal(new Set(TEAM_ROLE_IDS).size, TEAM_ROLE_IDS.length);

const plan = buildCatWorkflowPlan({ projectId: "proj", batchId: "b1", intent: "game_localization_team_run" });
assert.deepEqual(plan.steps.map((step) => step.id), TEAM_ROLE_IDS);

const workspaceRoot = await mkdtemp(join(tmpdir(), "la-team-workflow-"));
process.env.LA_RUNTIME_CACHE_ROOT = join(workspaceRoot, "cache");
async function writeTeamFixtureBatch(projectId: string, batchId: string): Promise<void> {
  const dir = join(workspaceRoot, "data", "projects", projectId, "batches", batchId);
  const sourceFile = join(dir, "fixture.csv");
  await mkdir(dir, { recursive: true });
  await writeFile(sourceFile, "SegmentID,Source,Target\n1,测试文本,\n", "utf8");
  await writeFile(join(dir, "batch.json"), `${JSON.stringify({
    schemaVersion: 1,
    format: "csv_paste",
    projectId,
    batchId,
    sourceFile,
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    tagReport: { totalSegments: 1, placeholderSegments: 0, masterMatchedSegments: 1, masterUnmatchedSegments: 0, replacedPlaceholders: 0, unresolvedPlaceholders: 0, unresolvedRuntimePlaceholders: 0, unresolvedTagPlaceholders: 0, tagCountMismatches: 0 },
    duplicateSourceGroups: [],
    segments: [{ index: 1, id: "1", source: "测试文本", target: "", rawSource: "测试文本", rawTarget: "", locked: false, status: "new", duplicateKey: "测试文本", placeholderCount: 0, unresolvedPlaceholderCount: 0 }],
  })}\n`, "utf8");
}
await writeTeamFixtureBatch("proj", "b1");
async function currentPlanHash(workflowId: string, forceAllRoles = false): Promise<string> {
  return (await preflightTeamWorkflowRun({
    projectId: "proj",
    workflowId,
    forceAllRoles,
    project: false,
    deps: {
      repoRoot: workspaceRoot,
      json: () => undefined,
      readBody: async () => ({}),
      requireString: (value, label) => {
        if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
        return value;
      },
      optionalString: (value) => typeof value === "string" && value ? value : undefined,
      optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
      optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    },
  })).planHash;
}
const { run } = await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-smoke",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
assert.equal(run.status, "ready");

await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-smoke",
  roleId: "translator",
  status: "completed",
  sessionId: "la-team-team-smoke-translator",
  inputArtifactRefs: ["constraint_pack:b1"],
  outputArtifactRefs: ["candidate:1"],
  summary: "Translated candidates.",
  transcriptRef: "session:la-team-team-smoke-translator",
});
const artifacts = await readWorkflowArtifacts(workspaceRoot, "proj");
assert.equal(artifacts.teamRolePasses.length, 1);
assert.equal(artifacts.teamRolePasses[0].roleId, "translator");

const context = buildTeamRoleContext({
  roleId: "editor",
  workflowId: "team-smoke",
  hardConstraints: ["Keep {0}", "Do not change locked rows"],
  evidence: ["TB: 诸神 = Gods"],
  styleGuideRules: ["Use concise heroic fantasy voice."],
  priorFindings: [{ id: "f1", message: "Translator may have missed UI tone." }],
  transcript: "Very long chat that should not be included by default.",
});
assert.match(context.prompt, /Keep \{0\}/);
assert.match(context.prompt, /TB: 诸神 = Gods/);
assert.match(context.prompt, /Use concise heroic fantasy voice/);
assert.doesNotMatch(context.prompt, /Very long chat/);
assert.equal(context.manifest.omittedArtifactIds.includes("transcript"), true);
assert.equal(context.manifest.includedArtifactIds.includes("style_guide"), true);
assert.equal(context.manifest.hardConstraintsPreserved, true);

const tinyContext = buildTeamRoleContext({
  roleId: "editor",
  workflowId: "team-smoke",
  hardConstraints: ["Keep {0}", "Do not change locked rows"],
  evidence: ["This can be truncated."],
  tokenBudget: 4,
});
assert.match(tinyContext.prompt, /Keep \{0\}/);
assert.match(tinyContext.prompt, /Do not change locked rows/);
assert.equal(tinyContext.manifest.hardConstraintsPreserved, true);
assert.ok(tinyContext.manifest.truncationReason);

assert.equal(defaultTeamRoleProfiles().length, TEAM_ROLE_IDS.length);
assert.equal(defaultTeamRoleProfiles().every((profile) => profile.thinking === undefined), true, "role thinking inherits the active Pi/model route unless explicitly overridden");
await writeTeamRoleSettings(workspaceRoot, {
  profiles: [{ roleId: "translator", enabled: true, provider: "deepseek", modelId: "deepseek-v4-pro" }],
});
assert.equal((await readTeamRoleSettings(workspaceRoot)).profiles.find((profile) => profile.roleId === "translator")?.modelId, "deepseek-v4-pro");
assert.equal((await readTeamRoleSettings(workspaceRoot)).profiles.find((profile) => profile.roleId === "translator")?.thinking, undefined);
{
  const responses: Array<{ status: number; data: unknown }> = [];
  let projectAgentSettings: { teamRoleSettings?: TeamRoleSettings } = {};
  const deps = {
    repoRoot: workspaceRoot,
    json: (_res: unknown, status: number, data: unknown) => responses.push({ status, data }),
    readBody: async () => ({ profiles: [{ roleId: "proofreader", enabled: false, provider: "deepseek", modelId: "deepseek-v4-flash" }] }),
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
    readProjectAgentSettings: async () => projectAgentSettings,
    writeProjectAgentSettings: async (_projectId: string, patch: { teamRoleSettings?: TeamRoleSettings }) => {
      projectAgentSettings = { ...projectAgentSettings, ...patch };
    },
  };
  assert.equal(await handleWorkflowRoute({ method: "PUT" } as never, {} as never, ["api", "projects", "proj", "workflows", "team-role-settings"], "proj", deps), true);
  assert.equal(projectAgentSettings.teamRoleSettings?.profiles.length, 1);
  const saved = responses.at(-1)?.data as { profiles: Array<{ roleId: string; enabled: boolean; modelId?: string }>; source?: { scope?: string }; profileSources?: Record<string, string> };
  assert.equal(saved.profiles.find((profile) => profile.roleId === "translator")?.modelId, "deepseek-v4-pro");
  assert.equal(saved.profiles.find((profile) => profile.roleId === "proofreader")?.enabled, false);
  assert.equal(saved.source?.scope, "project");
  assert.equal(saved.profileSources?.proofreader, "project");
  assert.equal(saved.profileSources?.translator, "global");
}
assert.equal(teamRoleAgentName("loc_engineer_gate"), "la-team-loc-engineer-gate");
assert.equal(teamRoleModelSpecifier({ modelProvider: "deepseek", modelId: "deepseek-v4-flash" }), "deepseek/deepseek-v4-flash");
assert.equal(teamRoleModelSpecifier({ modelProvider: "deepseek", modelId: "deepseek-v4-flash", thinking: "medium" }), "deepseek/deepseek-v4-flash:medium");
assert.equal(teamRoleModelSpecifier({ modelProvider: "deepseek", modelId: "deepseek-v4-flash:high", thinking: "medium" }), "deepseek/deepseek-v4-flash:medium");
assert.equal(buildSubagentSpawnRequest({
  workflowId: "team-smoke",
  roleId: "translator",
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  thinking: "medium",
}).params.model, "deepseek/deepseek-v4-flash:medium");
assert.equal(buildSubagentSpawnRequest({ workflowId: "team-smoke", roleId: "translator" }).params.output, "data/team-role-outputs/la-team-team-smoke-translator.json");
assert.equal(buildSubagentSpawnRequest({ workflowId: "team-smoke", roleId: "translator" }).params.agentScope, "project");
assert.deepEqual(buildSubagentSpawnRequest({ workflowId: "team-smoke", roleId: "producer" }).params.acceptance, {
  level: "none",
  reason: "LA validates localization role output through typed artifacts and CAT gates.",
});
assert.deepEqual(buildSubagentSpawnRequest({
  workflowId: "eval-run",
  roleId: "translator",
  output: "data/evals/private/_team_role_outputs/result.json",
  toolBudget: { hard: 1, block: "*" },
}).params, {
  agent: "la-team-translator",
  task: "Run la-team-translator for LA workflow eval-run.\nUse only the provided LA workflow artifacts and CAT evidence.\nReturn the role JSON artifact required by the agent prompt.",
  context: "fresh",
  agentScope: "project",
  async: true,
  clarify: false,
  artifacts: true,
  acceptance: {
    level: "none",
    reason: "LA validates localization role output through typed artifacts and CAT gates.",
  },
  output: "data/evals/private/_team_role_outputs/result.json",
  outputMode: "file-only",
  toolBudget: { hard: 1, block: "*" },
});
assert.equal(teamRoleOutputContract("translator").requiredAnyOf.includes("candidateTargets"), true);
assert.equal(teamRoleOutputContract("translator").requiredAnyOf.includes("queries"), true);
assert.equal(validateTeamRoleOutputPresence("translator", {
  objectKeys: [],
  arrayKeys: ["queries"],
  hasSummary: true,
  findingCount: 0,
  queryCount: 1,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, true);
assert.equal(validateTeamRoleOutputPresence("producer", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, false);
assert.equal(validateTeamRoleOutputPresence("producer", {
  objectKeys: ["brief"],
  arrayKeys: [],
  hasSummary: false,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, true);
assert.equal(validateTeamRoleOutputPresence("editor", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, false);
assert.equal(validateTeamRoleOutputPresence("editor", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: true,
  findingCount: 1,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, true);
assert.equal(validateTeamRoleOutputPresence("editor", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: true,
}).ok, true);
assert.equal(validateTeamRoleOutputPresence("pre_lqa_reviewer", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, false);
assert.equal(validateTeamRoleOutputPresence("pre_lqa_reviewer", {
  objectKeys: [],
  arrayKeys: ["preLqaRisks"],
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, true);
assert.equal(validateTeamRoleOutputPresence("pre_lqa_reviewer", {
  objectKeys: [],
  arrayKeys: ["preLqaRisks"],
  preLqaRiskCount: 0,
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, false);
assert.equal(validateTeamRoleOutputPresence("pre_lqa_reviewer", {
  objectKeys: [],
  arrayKeys: ["preLqaRisks"],
  preLqaRiskCount: 1,
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, true);
assert.equal(validateTeamRoleOutputPresence("pre_lqa_reviewer", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: true,
}).ok, true);
assert.equal(teamRoleOutputContract("delivery_manager").outputSignals.includes("deliveryQa"), false);
assert.equal(validateTeamRoleOutputPresence("delivery_manager", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: true,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: true,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, false);
assert.equal(validateTeamRoleOutputPresence("delivery_manager", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: true,
  findingCount: 1,
  candidateCount: 0,
  decisionCount: 0,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, true);
assert.equal(validateTeamRoleOutputPresence("lead_linguist_final", {
  objectKeys: [],
  arrayKeys: [],
  hasSummary: false,
  findingCount: 0,
  candidateCount: 0,
  decisionCount: 1,
  hasDeliveryQa: false,
  hasReviewedDeliveryQa: false,
  hasNoIssues: false,
}).ok, true);

{
  const handlers = new Map<string, (data: unknown) => void>();
  const deliveries: unknown[] = [];
  const eventBus = {
    on: (event: string, handler: (data: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    emit: (event: string, data: unknown) => {
      if (event === "subagent:result-intercom-delivery") deliveries.push(data);
      handlers.get(event)?.(data);
    },
  };
  const unbind = bindSubagentResultDeliveryAcknowledgement(eventBus as never);
  eventBus.emit("subagent:result-intercom", {
    source: "async",
    requestId: "delivery-1",
    runId: "subagent-run-1",
    children: [{ agent: "la-team-translator", status: "completed" }],
  });
  assert.deepEqual(deliveries, [{
    requestId: "delivery-1",
    delivered: true,
    consumer: "linguist-agent-canonical-team-bridge",
  }]);
  eventBus.emit("subagent:result-intercom", { source: "foreground", requestId: "not-owned", runId: "run", children: [] });
  assert.equal(deliveries.length, 1, "LA must acknowledge only its async canonical bridge");
  unbind();
  eventBus.emit("subagent:result-intercom", {
    source: "async",
    requestId: "delivery-2",
    runId: "subagent-run-2",
    children: [],
  });
  assert.equal(deliveries.length, 1, "the acknowledgement handler must release with its Session");
}

{
  const request = buildSubagentSpawnRequest({ workflowId: "team-smoke", roleId: "producer" });
  let emitted: unknown;
  const handlers = new Map<string, (data: unknown) => void>();
  const reply = await spawnSubagentViaRpc({
    on: (event, handler) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    emit: (event, data) => {
      emitted = data;
      if (event === "subagents:rpc:v1:request") {
        const requestId = (data as { requestId: string }).requestId;
        handlers.get(`subagents:rpc:v1:reply:${requestId}`)?.({
          version: 1,
          requestId,
          method: "spawn",
          success: true,
          data: { text: "spawned", details: { asyncDir: "/tmp/run" } },
        });
      }
    },
  }, request, 1_000);
  assert.equal((emitted as { method: string }).method, "spawn");
  assert.equal((emitted as { params: { agent: string } }).params.agent, "la-team-producer");
  assert.equal(reply.success, true);
}

{
  const request = buildSubagentSpawnRequest({ workflowId: "team-timeout-recovery", roleId: "producer" });
  const handlers = new Map<string, (data: unknown) => void>();
  const reply = await (spawnSubagentViaRpc as any)({
    on: (event: string, handler: (data: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    emit: () => undefined,
  }, request, 5, async () => "/tmp/pi-subagents/async-subagent-runs/recovered-run");
  assert.equal(reply.success, true);
  assert.equal(reply.data.details.asyncDir, "/tmp/pi-subagents/async-subagent-runs/recovered-run");
  assert.equal(reply.data.details.recoveredAfterRpcTimeout, true);
}

{
  let emitted: unknown;
  const handlers = new Map<string, (data: unknown) => void>();
  const reply = await callSubagentRpc({
    on: (event, handler) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    emit: (event, data) => {
      emitted = data;
      if (event === "subagents:rpc:v1:request") {
        const requestId = (data as { requestId: string }).requestId;
        handlers.get(`subagents:rpc:v1:reply:${requestId}`)?.({
          version: 1,
          requestId,
          method: "stop",
          success: true,
          data: { runId: "run-1", state: "stopping" },
        });
      }
    },
  }, "stop", { id: "run-1" }, 1_000);
  assert.equal((emitted as { method: string }).method, "stop");
  assert.equal((emitted as { params: { id: string } }).params.id, "run-1");
  assert.equal(reply.success, true);
}

{
  const responses: Array<{ status: number; data: unknown }> = [];
  let body: Record<string, unknown> = { roleId: "editor", modelProvider: "deepseek", modelId: "deepseek-v4-flash" };
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-smoke",
    "run-role",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => body,
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  assert.equal(responses.at(-1)?.status, 202);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.roleId === "editor");
  assert.equal(editorPass?.status, "waiting");
  assert.equal(editorPass?.completedAt, undefined);
  assert.equal(editorPass?.subagentRunId, undefined);
  assert.equal(editorPass?.subagentSpawnRequest?.params.agent, "la-team-editor");
  assert.equal(editorPass?.subagentSpawnRequest?.params.model, "deepseek/deepseek-v4-flash");
  assert.match(editorPass?.contextManifestRef ?? "", /^team-evidence-policy:[0-9a-f]{64}$/);
  assert.ok(editorPass?.subagentSpawnRequest?.params.sessionDir?.startsWith(join(workspaceRoot, "cache", "team-role-sessions")));
  assert.equal(typeof editorPass?.contextManifest?.tokenEstimate, "number");
  assert.equal(editorPass?.summary.includes("has not executed the role yet"), true);
}

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const deps = {
    repoRoot: workspaceRoot,
    json: (_res: unknown, status: number, data: unknown) => responses.push({ status, data }),
    readBody: async () => ({
      profiles: [{ roleId: "proofreader", enabled: true, provider: "deepseek", modelId: "deepseek-v4-flash", thinking: "medium" }],
    }),
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  };
  assert.equal(await handleWorkflowRoute({ method: "PUT" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-role-settings",
  ], "proj", deps), true);
  assert.equal(responses.at(-1)?.status, 200);
  assert.equal((responses.at(-1)?.data as { profiles: Array<{ roleId: string; modelId?: string }> }).profiles.find((row) => row.roleId === "proofreader")?.modelId, "deepseek-v4-flash");
  assert.equal(await handleWorkflowRoute({ method: "GET" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-role-settings",
  ], "proj", deps), true);
  assert.equal((responses.at(-1)?.data as { profiles: Array<{ roleId: string; provider?: string }> }).profiles.find((row) => row.roleId === "proofreader")?.provider, "deepseek");
}

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-smoke",
    "run-role",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "proofreader" }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as {
    teamRolePasses: TeamRolePass[];
    teamCandidateTargets: Array<{ workflowId?: string; segmentId: string; target: string; function?: string; evidenceRefs: string[] }>;
  };
  const proofreaderPass = routeArtifacts.teamRolePasses.find((row) => row.roleId === "proofreader");
  assert.equal(proofreaderPass?.subagentSpawnRequest?.params.model, "deepseek/deepseek-v4-flash:medium");
  assert.equal(proofreaderPass?.thinking, "medium");
}

const { run: orchRun } = await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-orch",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
assert.equal(orchRun.currentStepId, "producer");

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-orch",
    "start",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ execute: false, forceAllRoles: true, planHash: await currentPlanHash("team-orch", true) }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  assert.equal(responses.at(-1)?.status, 202);
  assert.equal((responses.at(-1)?.data as { roleId: string }).roleId, "producer");
}

await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-orch",
  roleId: "producer",
  status: "completed",
  sessionId: "la-team-team-orch-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: ["brief:team-orch"],
  summary: "Producer completed.",
  transcriptRef: "session:producer",
});

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-orch",
    "resume",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ execute: false, forceAllRoles: true, planHash: await currentPlanHash("team-orch", true) }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  assert.equal((responses.at(-1)?.data as { roleId: string }).roleId, "loc_engineer_gate");
}

const locRunId = `la-orch-loc-${Date.now()}`;
const locAsyncDir = join(defaultSubagentAsyncRoot(), locRunId);
await mkdir(locAsyncDir, { recursive: true });
await writeFile(join(locAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: locRunId,
  mode: "single",
  state: "running",
  agent: "la-team-loc-engineer-gate",
  startedAt: Date.UTC(2026, 0, 2),
  outputFile: join(locAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-loc-engineer-gate", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-orch",
  roleId: "loc_engineer_gate",
  status: "running",
  sessionId: "la-team-team-orch-loc-engineer-gate",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: locRunId,
  subagentAsyncDir: locAsyncDir,
  summary: "Loc engineer is running.",
  transcriptRef: "session:loc",
});

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-orch",
    "start",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ execute: false, forceAllRoles: true, planHash: await currentPlanHash("team-orch", true) }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  assert.equal(responses.at(-1)?.status, 200);
  assert.match((responses.at(-1)?.data as { message: string }).message, /already be running/);
}

await writeFile(join(locAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: locRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-loc-engineer-gate",
  startedAt: Date.UTC(2026, 0, 2),
  endedAt: Date.UTC(2026, 0, 2, 0, 1),
  outputFile: join(locAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-loc-engineer-gate", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(locAsyncDir, "output-0.log"), JSON.stringify({
  findings: [{
    id: "loc-finding-1",
    severity: "minor",
    type: "format",
    message: "Placeholder check passed with advisory note.",
    evidenceRefs: ["constraint:1"],
  }],
}), "utf8");

const completedActiveRoleRuns: Array<{ projectId: string; workflowId: string; roleId?: string; subagentRunId?: string }> = [];
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-orch",
    "resume",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ execute: false, forceAllRoles: true, planHash: await currentPlanHash("team-orch", true) }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    completeActiveRuns: (input) => {
      completedActiveRoleRuns.push(input);
      return 1;
    },
  });
  assert.equal(handled, true);
  assert.equal((responses.at(-1)?.data as { roleId: string }).roleId, "lead_linguist_setup");
  const routeArtifacts = (responses.at(-1)?.data as { artifacts: { teamFindings: Array<{ id: string }> } }).artifacts;
  assert.equal(routeArtifacts.teamFindings.some((row) => row.id === "loc-finding-1"), true);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-orch")).completedStepIds.includes("loc_engineer_gate"), true);
  assert.deepEqual(completedActiveRoleRuns, [{
    projectId: "proj",
    workflowId: "team-orch",
    roleId: "loc_engineer_gate",
    subagentRunId: locRunId,
  }]);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-schema",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const summaryOnlyProducerRunId = `la-summary-producer-${Date.now()}`;
const summaryOnlyProducerAsyncDir = join(defaultSubagentAsyncRoot(), summaryOnlyProducerRunId);
await mkdir(summaryOnlyProducerAsyncDir, { recursive: true });
await writeFile(join(summaryOnlyProducerAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: summaryOnlyProducerRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-producer",
  startedAt: Date.UTC(2026, 0, 4),
  endedAt: Date.UTC(2026, 0, 4, 0, 1),
  outputFile: join(summaryOnlyProducerAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-producer", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(summaryOnlyProducerAsyncDir, "output-0.log"), JSON.stringify({ summary: "Looks fine." }), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-schema",
  roleId: "producer",
  status: "running",
  sessionId: "la-team-team-schema-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: summaryOnlyProducerRunId,
  subagentAsyncDir: summaryOnlyProducerAsyncDir,
  summary: "Producer is running.",
  transcriptRef: "session:producer-schema",
});

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-schema",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "producer", subagentRunId: summaryOnlyProducerRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const producerPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-schema" && row.roleId === "producer");
  assert.equal(producerPass?.status, "failed");
  assert.match(producerPass?.summary ?? "", /producer output requires brief, findings, or queries/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-schema")).completedStepIds.includes("producer"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-summary-type",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidSummaryTypeRunId = `la-invalid-summary-type-${Date.now()}`;
const invalidSummaryTypeAsyncDir = join(defaultSubagentAsyncRoot(), invalidSummaryTypeRunId);
await mkdir(invalidSummaryTypeAsyncDir, { recursive: true });
await writeFile(join(invalidSummaryTypeAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidSummaryTypeRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-producer",
  outputFile: join(invalidSummaryTypeAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-producer", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidSummaryTypeAsyncDir, "output-0.log"), JSON.stringify({
  summary: { text: "Brief ready." },
  brief: {
    projectGoal: "Smoke workflow",
    scope: ["Smoke scope"],
    knownAssets: ["fixture"],
    missingInputs: [],
    risks: [{ category: "linguistic", severity: "warning", description: "UI context is missing.", segmentId: "seg-1" }],
    handoffNotes: ["UI", "terms"],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-summary-type",
  roleId: "producer",
  status: "running",
  sessionId: "la-team-team-invalid-summary-type-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidSummaryTypeRunId,
  subagentAsyncDir: invalidSummaryTypeAsyncDir,
  summary: "Producer is running.",
  transcriptRef: "session:producer-invalid-summary-type",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-summary-type",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "producer", subagentRunId: invalidSummaryTypeRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const producerPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-summary-type" && row.roleId === "producer");
  assert.equal(producerPass?.status, "failed");
  assert.match(producerPass?.summary ?? "", /Role output rejected: summary must be a string/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-summary-type")).completedStepIds.includes("producer"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-artifacts",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const producerBriefRunId = `la-brief-producer-${Date.now()}`;
const producerBriefAsyncDir = join(defaultSubagentAsyncRoot(), producerBriefRunId);
await mkdir(producerBriefAsyncDir, { recursive: true });
await writeFile(join(producerBriefAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: producerBriefRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-producer",
  startedAt: Date.UTC(2026, 0, 4),
  endedAt: Date.UTC(2026, 0, 4, 0, 1),
  outputFile: join(producerBriefAsyncDir, "output-0.log"),
  totalTokens: { input: 100, output: 40, total: 140 },
  totalCost: { inputTokens: 100, outputTokens: 40, costUsd: 0.0123 },
  steps: [{ agent: "la-team-producer", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(producerBriefAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Brief ready.",
  brief: {
    projectGoal: "Smoke workflow",
    scope: ["Smoke scope"],
    knownAssets: ["fixture"],
    missingInputs: [],
    risks: [{ category: "linguistic", severity: "warning", description: "UI context is missing.", segmentId: "seg-1" }],
    handoffNotes: ["UI", "terms"],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-artifacts",
  roleId: "producer",
  status: "running",
  sessionId: "la-team-team-artifacts-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: producerBriefRunId,
  subagentAsyncDir: producerBriefAsyncDir,
  summary: "Producer is running.",
  transcriptRef: "session:producer-brief",
});

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-artifacts",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "producer", subagentRunId: producerBriefRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as {
    teamRolePasses: TeamRolePass[];
    teamRoleArtifacts: Array<{ workflowId: string; roleId: string; type: string; data: { scope?: string[] } }>;
  };
  const producerPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-artifacts" && row.roleId === "producer");
  assert.equal(producerPass?.status, "completed");
  assert.deepEqual(routeArtifacts.teamRoleArtifacts.find((row) => row.workflowId === "team-artifacts" && row.type === "brief")?.data.scope, ["Smoke scope"]);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-artifacts")).completedStepIds.includes("producer"), true);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-brief",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const badBriefRunId = `la-bad-brief-${Date.now()}`;
const badBriefAsyncDir = join(defaultSubagentAsyncRoot(), badBriefRunId);
await mkdir(badBriefAsyncDir, { recursive: true });
await writeFile(join(badBriefAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: badBriefRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-producer",
  outputFile: join(badBriefAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-producer", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(badBriefAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Brief ready.",
  brief: {
    scope: ["missing project goal"],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-bad-brief",
  roleId: "producer",
  status: "running",
  sessionId: "la-team-team-bad-brief-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: badBriefRunId,
  subagentAsyncDir: badBriefAsyncDir,
  summary: "Producer is running.",
  transcriptRef: "session:producer-bad-brief",
});

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-brief",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "producer", subagentRunId: badBriefRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const producerPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-brief" && row.roleId === "producer");
  assert.equal(producerPass?.status, "failed");
  assert.match(producerPass?.summary ?? "", /brief\.projectGoal is required/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-brief-array",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const badBriefArrayRunId = `la-bad-brief-array-${Date.now()}`;
const badBriefArrayAsyncDir = join(defaultSubagentAsyncRoot(), badBriefArrayRunId);
await mkdir(badBriefArrayAsyncDir, { recursive: true });
await writeFile(join(badBriefArrayAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: badBriefArrayRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-producer",
  outputFile: join(badBriefArrayAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-producer", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(badBriefArrayAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Brief ready.",
  brief: {
    projectGoal: "Smoke workflow",
    scope: ["Smoke scope"],
    knownAssets: ["fixture", 42],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-bad-brief-array",
  roleId: "producer",
  status: "running",
  sessionId: "la-team-team-bad-brief-array-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: badBriefArrayRunId,
  subagentAsyncDir: badBriefArrayAsyncDir,
  summary: "Producer is running.",
  transcriptRef: "session:producer-bad-brief-array",
});

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-brief-array",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "producer", subagentRunId: badBriefArrayRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const producerPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-brief-array" && row.roleId === "producer");
  assert.equal(producerPass?.status, "failed");
  assert.match(producerPass?.summary ?? "", /brief\.knownAssets\[1\] must be a non-empty string or object/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-strategy",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const badStrategyRunId = `la-bad-strategy-${Date.now()}`;
const badStrategyAsyncDir = join(defaultSubagentAsyncRoot(), badStrategyRunId);
await mkdir(badStrategyAsyncDir, { recursive: true });
await writeFile(join(badStrategyAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: badStrategyRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-lead-linguist-setup",
  outputFile: join(badStrategyAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-lead-linguist-setup", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(badStrategyAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Strategy ready.",
  strategy: {
    authorityOrder: ["locks", "termbase"],
    voiceRules: [],
    genreRules: [],
    uiRules: [],
    termRules: [],
    queryRules: [],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-bad-strategy",
  roleId: "lead_linguist_setup",
  status: "running",
  sessionId: "la-team-team-bad-strategy-lead-linguist-setup",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: badStrategyRunId,
  subagentAsyncDir: badStrategyAsyncDir,
  summary: "Lead Linguist Setup is running.",
  transcriptRef: "session:lead-linguist-setup-bad-strategy",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-strategy",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_setup", subagentRunId: badStrategyRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const setupPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-strategy" && row.roleId === "lead_linguist_setup");
  assert.equal(setupPass?.status, "failed");
  assert.match(setupPass?.summary ?? "", /Role output rejected: strategy\.mustNotDo must be an array/);
}

{
  const batchDir = join(workspaceRoot, "data", "projects", "proj", "batches", "b1");
  const fixturePath = join(batchDir, "fixture.xlsx");
  await mkdir(batchDir, { recursive: true });
  await writeFile(fixturePath, "fixture", "utf8");
  await writeFile(join(batchDir, "batch.json"), JSON.stringify({
    schemaVersion: 1,
    format: "xlsx_paste",
    projectId: "proj",
    batchId: "b1",
    sourceFile: fixturePath,
    sourceLanguage: "zh-CN",
    targetLanguage: "en-US",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    tagReport: {},
    duplicateSourceGroups: [],
    segments: [{
      index: 0,
      id: "seg-1",
      source: "活动时间",
      target: "Event time",
      originalTarget: "Old event time",
      rawSource: "活动时间",
      rawTarget: "Event time",
      locked: false,
      status: "draft",
      duplicateKey: "活动时间",
      placeholderCount: 0,
      unresolvedPlaceholderCount: 0,
    }],
  }), "utf8");

  const currentArtifacts = await readWorkflowArtifacts(workspaceRoot, "proj");
  await writeWorkflowArtifacts(workspaceRoot, "proj", {
    ...currentArtifacts,
    teamCandidateTargets: [
      ...currentArtifacts.teamCandidateTargets,
      {
        id: "candidate-team-artifacts-1",
        workflowId: "team-artifacts",
        roleId: "translator",
        segmentId: "seg-1",
        target: "Event Time",
        evidenceRefs: ["tb:event-time"],
        function: "ui",
        notes: "Conventional UI label.",
      },
    ],
    teamFindings: [
      ...currentArtifacts.teamFindings,
      {
        id: "finding-team-artifacts-1",
        workflowId: "team-artifacts",
        roleId: "editor",
        segmentId: "seg-1",
        severity: "major",
        type: "accuracy",
        message: "Meaning drift.",
        proposedTarget: "Event Time",
        evidenceRefs: ["tm:1"],
      },
    ],
    teamDecisions: [
      ...currentArtifacts.teamDecisions,
      {
        id: "decision-team-artifacts-1",
        workflowId: "team-artifacts",
        segmentId: "seg-1",
        decision: "accept",
        reason: "Accept editor correction.",
        findingIds: ["finding-team-artifacts-1"],
        evidenceRefs: ["tm:1"],
        decidedBy: "lead_linguist",
      },
      {
        id: "decision-team-artifacts-2",
        workflowId: "team-artifacts",
        segmentId: "seg-1",
        decision: "reject",
        reason: "QA blocker must be fixed.",
        findingIds: ["qa-finding-1"],
        decidedBy: "lead_linguist",
      },
    ],
    deliveryQaReports: [{
      reportId: "qa-team-artifacts",
      projectId: "proj",
      batchId: "b1",
      workflowId: "team-artifacts",
      generatedAt: new Date(0).toISOString(),
      summary: { blockers: 1, warnings: 1, advisories: 0 },
      findings: [{
        id: "qa-finding-1",
        type: "placeholder_mismatch",
        severity: "blocker",
        segmentId: "seg-1",
        message: "Placeholder mismatch.",
        evidence: ["{0}"],
      }],
    }],
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "GET" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-artifacts",
    "report",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({}),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, false, "legacy report reads must stay deleted after Task archive migration");
  assert.equal(responses.length, 0);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid",
  roleId: "producer",
  status: "completed",
  sessionId: "la-team-team-invalid-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: ["brief:team-invalid"],
  summary: "Producer completed.",
  transcriptRef: "session:producer-invalid",
});
const invalidLocRunId = `la-invalid-loc-${Date.now()}`;
const invalidLocAsyncDir = join(defaultSubagentAsyncRoot(), invalidLocRunId);
await mkdir(invalidLocAsyncDir, { recursive: true });
await writeFile(join(invalidLocAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidLocRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-loc-engineer-gate",
  startedAt: Date.UTC(2026, 0, 3),
  endedAt: Date.UTC(2026, 0, 3, 0, 1),
  outputFile: join(invalidLocAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-loc-engineer-gate", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidLocAsyncDir, "output-0.log"), "not json", "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid",
  roleId: "loc_engineer_gate",
  status: "running",
  sessionId: "la-team-team-invalid-loc-engineer-gate",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidLocRunId,
  subagentAsyncDir: invalidLocAsyncDir,
  summary: "Loc engineer is running.",
  transcriptRef: "session:loc-invalid",
});

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "loc_engineer_gate", subagentRunId: invalidLocRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const locPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid" && row.roleId === "loc_engineer_gate");
  assert.equal(locPass?.status, "failed");
  assert.match(locPass?.summary ?? "", /Role output rejected: missing or invalid JSON/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid")).completedStepIds.includes("loc_engineer_gate"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-engineering-gate-ready",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const badEngineeringGateReadyRunId = `la-bad-engineering-gate-ready-${Date.now()}`;
const badEngineeringGateReadyAsyncDir = join(defaultSubagentAsyncRoot(), badEngineeringGateReadyRunId);
await mkdir(badEngineeringGateReadyAsyncDir, { recursive: true });
await writeFile(join(badEngineeringGateReadyAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: badEngineeringGateReadyRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-loc-engineer-gate",
  outputFile: join(badEngineeringGateReadyAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-loc-engineer-gate", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(badEngineeringGateReadyAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "loc_engineer_gate",
  summary: "Gate is blocked but no blocker is named.",
  engineeringGate: {
    ready: false,
    blockers: [],
    warnings: [],
    formatRules: [],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-bad-engineering-gate-ready",
  roleId: "loc_engineer_gate",
  status: "running",
  sessionId: "la-team-team-bad-engineering-gate-ready-loc-engineer-gate",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: badEngineeringGateReadyRunId,
  subagentAsyncDir: badEngineeringGateReadyAsyncDir,
  summary: "Loc engineer is running.",
  transcriptRef: "session:loc-bad-engineering-gate-ready",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-engineering-gate-ready",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "loc_engineer_gate", subagentRunId: badEngineeringGateReadyRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const locPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-engineering-gate-ready" && row.roleId === "loc_engineer_gate");
  assert.equal(locPass?.status, "failed");
  assert.match(locPass?.summary ?? "", /Role output rejected: engineeringGate\.blockers must include at least one blocker when ready is false/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-bad-engineering-gate-ready")).completedStepIds.includes("loc_engineer_gate"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-blocked-engineering-gate",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-blocked-engineering-gate",
  roleId: "producer",
  status: "completed",
  sessionId: "la-team-team-blocked-engineering-gate-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: ["brief:team-blocked-engineering-gate"],
  summary: "Producer completed.",
  transcriptRef: "session:producer-blocked-engineering-gate",
});
await completeCatWorkflowStep(workspaceRoot, "proj", "team-blocked-engineering-gate", "producer", "Producer completed.");
const blockedEngineeringGateRunId = `la-blocked-engineering-gate-${Date.now()}`;
const blockedEngineeringGateAsyncDir = join(defaultSubagentAsyncRoot(), blockedEngineeringGateRunId);
await mkdir(blockedEngineeringGateAsyncDir, { recursive: true });
await writeFile(join(blockedEngineeringGateAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: blockedEngineeringGateRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-loc-engineer-gate",
  outputFile: join(blockedEngineeringGateAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-loc-engineer-gate", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(blockedEngineeringGateAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "loc_engineer_gate",
  summary: "Gate found missing context.",
  engineeringGate: {
    ready: false,
    blockers: ["Missing source workbook."],
    warnings: [],
    formatRules: [],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-blocked-engineering-gate",
  roleId: "loc_engineer_gate",
  status: "running",
  sessionId: "la-team-team-blocked-engineering-gate-loc-engineer-gate",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: blockedEngineeringGateRunId,
  subagentAsyncDir: blockedEngineeringGateAsyncDir,
  summary: "Loc engineer is running.",
  transcriptRef: "session:loc-blocked-engineering-gate",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-blocked-engineering-gate",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "loc_engineer_gate", subagentRunId: blockedEngineeringGateRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[]; teamRoleArtifacts: Array<{ type: string }> };
  const locPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-blocked-engineering-gate" && row.roleId === "loc_engineer_gate");
  assert.equal(locPass?.status, "waiting");
  assert.match(locPass?.summary ?? "", /Engineering gate blocked: Missing source workbook/);
  assert.equal(routeArtifacts.teamRoleArtifacts.some((row) => row.type === "engineering_gate"), true);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-blocked-engineering-gate")).completedStepIds.includes("loc_engineer_gate"), false);
}
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-blocked-engineering-gate",
    "resume",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ execute: false, planHash: await currentPlanHash("team-blocked-engineering-gate") }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  assert.equal((responses.at(-1)?.data as { roleId: string }).roleId, "loc_engineer_gate");
}

const invalidFieldRunId = `la-invalid-field-${Date.now()}`;
const invalidFieldAsyncDir = join(defaultSubagentAsyncRoot(), invalidFieldRunId);
await mkdir(invalidFieldAsyncDir, { recursive: true });
await writeFile(join(invalidFieldAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidFieldRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-editor",
  startedAt: Date.UTC(2026, 0, 3),
  endedAt: Date.UTC(2026, 0, 3, 0, 2),
  outputFile: join(invalidFieldAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidFieldAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Editor completed.",
  candidateTargets: [{ segmentId: "seg-1", evidenceRefs: ["tm:1"] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid",
  roleId: "editor",
  status: "running",
  sessionId: "la-team-team-invalid-editor",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidFieldRunId,
  subagentAsyncDir: invalidFieldAsyncDir,
  summary: "Editor is running.",
  transcriptRef: "session:editor-invalid",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: invalidFieldRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid" && row.roleId === "editor");
  assert.equal(editorPass?.status, "failed");
  assert.match(editorPass?.summary ?? "", /Role output rejected: candidateTargets\[0\]\.target is required/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid")).completedStepIds.includes("editor"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-reviewer-candidate-notes",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidReviewerCandidateNotesRunId = `la-invalid-reviewer-candidate-notes-${Date.now()}`;
const invalidReviewerCandidateNotesAsyncDir = join(defaultSubagentAsyncRoot(), invalidReviewerCandidateNotesRunId);
await mkdir(invalidReviewerCandidateNotesAsyncDir, { recursive: true });
await writeFile(join(invalidReviewerCandidateNotesAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidReviewerCandidateNotesRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-editor",
  outputFile: join(invalidReviewerCandidateNotesAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidReviewerCandidateNotesAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "editor",
  summary: "Editor proposes a target without explaining why.",
  candidates: [{ segmentId: "seg-1", target: "Event Time", evidenceRefs: ["tm:1"] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-reviewer-candidate-notes",
  roleId: "editor",
  status: "running",
  sessionId: "la-team-team-invalid-reviewer-candidate-notes-editor",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidReviewerCandidateNotesRunId,
  subagentAsyncDir: invalidReviewerCandidateNotesAsyncDir,
  summary: "Editor is running.",
  transcriptRef: "session:editor-invalid-reviewer-candidate-notes",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-reviewer-candidate-notes",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: invalidReviewerCandidateNotesRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-reviewer-candidate-notes" && row.roleId === "editor");
  assert.equal(editorPass?.status, "failed");
  assert.match(editorPass?.summary ?? "", /Role output rejected: candidateTargets\[0\]\.notes is required for editor/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-reviewer-candidate-notes")).completedStepIds.includes("editor"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-role-id",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidRoleIdRunId = `la-invalid-role-id-${Date.now()}`;
const invalidRoleIdAsyncDir = join(defaultSubagentAsyncRoot(), invalidRoleIdRunId);
await mkdir(invalidRoleIdAsyncDir, { recursive: true });
await writeFile(join(invalidRoleIdAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidRoleIdRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-translator",
  outputFile: join(invalidRoleIdAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-translator", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidRoleIdAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "editor",
  summary: "Wrong role payload.",
  candidates: [{ segmentId: "seg-1", target: "Event Time", evidenceRefs: [] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-role-id",
  roleId: "translator",
  status: "running",
  sessionId: "la-team-team-invalid-role-id-translator",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidRoleIdRunId,
  subagentAsyncDir: invalidRoleIdAsyncDir,
  summary: "Translator is running.",
  transcriptRef: "session:translator-invalid-role-id",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-role-id",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "translator", subagentRunId: invalidRoleIdRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const translatorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-role-id" && row.roleId === "translator");
  assert.equal(translatorPass?.status, "failed");
  assert.match(translatorPass?.summary ?? "", /Role output rejected: roleId must match translator/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-translator-candidate",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidTranslatorCandidateRunId = `la-invalid-translator-candidate-${Date.now()}`;
const invalidTranslatorCandidateAsyncDir = join(defaultSubagentAsyncRoot(), invalidTranslatorCandidateRunId);
await mkdir(invalidTranslatorCandidateAsyncDir, { recursive: true });
await writeFile(join(invalidTranslatorCandidateAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidTranslatorCandidateRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-translator",
  outputFile: join(invalidTranslatorCandidateAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-translator", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidTranslatorCandidateAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "translator",
  summary: "Candidate omits optional function classification.",
  candidates: [{ segmentId: "seg-1", target: "Event Time", evidenceRefs: [] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-translator-candidate",
  roleId: "translator",
  status: "running",
  sessionId: "la-team-team-invalid-translator-candidate-translator",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidTranslatorCandidateRunId,
  subagentAsyncDir: invalidTranslatorCandidateAsyncDir,
  summary: "Translator is running.",
  transcriptRef: "session:translator-invalid-candidate",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-translator-candidate",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "translator", subagentRunId: invalidTranslatorCandidateRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as {
    teamRolePasses: TeamRolePass[];
    teamCandidateTargets: Array<{ workflowId?: string; segmentId: string; target: string; function?: string; evidenceRefs: string[] }>;
  };
  const translatorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-translator-candidate" && row.roleId === "translator");
  assert.equal(translatorPass?.status, "completed", "optional classification metadata must not discard a valid candidate");
  const acceptedCandidate = routeArtifacts.teamCandidateTargets.find((row) => row.workflowId === "team-invalid-translator-candidate" && row.segmentId === "seg-1");
  assert.equal(acceptedCandidate?.target, "Event Time");
  assert.equal(acceptedCandidate?.function, undefined);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-candidate-evidence",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidCandidateEvidenceRunId = `la-invalid-candidate-evidence-${Date.now()}`;
const invalidCandidateEvidenceAsyncDir = join(defaultSubagentAsyncRoot(), invalidCandidateEvidenceRunId);
await mkdir(invalidCandidateEvidenceAsyncDir, { recursive: true });
await writeFile(join(invalidCandidateEvidenceAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidCandidateEvidenceRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-translator",
  outputFile: join(invalidCandidateEvidenceAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-translator", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidCandidateEvidenceAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "translator",
  summary: "Candidate omits optional empty evidence refs.",
  candidates: [{ segmentId: "seg-1", target: "Event Time", function: "ui", notes: "Conventional UI label." }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-candidate-evidence",
  roleId: "translator",
  status: "running",
  sessionId: "la-team-team-invalid-candidate-evidence-translator",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidCandidateEvidenceRunId,
  subagentAsyncDir: invalidCandidateEvidenceAsyncDir,
  summary: "Translator is running.",
  transcriptRef: "session:translator-invalid-candidate-evidence",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-candidate-evidence",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "translator", subagentRunId: invalidCandidateEvidenceRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as {
    teamRolePasses: TeamRolePass[];
    teamCandidateTargets: Array<{ workflowId?: string; segmentId: string; target: string; function?: string; evidenceRefs: string[] }>;
  };
  const translatorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-candidate-evidence" && row.roleId === "translator");
  assert.equal(translatorPass?.status, "completed", "omitted optional evidence refs normalize to an empty array");
  assert.deepEqual(routeArtifacts.teamCandidateTargets.find((row) => row.workflowId === "team-invalid-candidate-evidence")?.evidenceRefs, []);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-candidate-id",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidCandidateIdRunId = `la-invalid-candidate-id-${Date.now()}`;
const invalidCandidateIdAsyncDir = join(defaultSubagentAsyncRoot(), invalidCandidateIdRunId);
await mkdir(invalidCandidateIdAsyncDir, { recursive: true });
await writeFile(join(invalidCandidateIdAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidCandidateIdRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-translator",
  outputFile: join(invalidCandidateIdAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-translator", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidCandidateIdAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "translator",
  summary: "Candidate has invalid id.",
  candidateTargets: [{ id: 42, segmentId: "seg-1", target: "Event Time", function: "ui", notes: "Conventional UI label.", evidenceRefs: [] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-candidate-id",
  roleId: "translator",
  status: "running",
  sessionId: "la-team-team-invalid-candidate-id-translator",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidCandidateIdRunId,
  subagentAsyncDir: invalidCandidateIdAsyncDir,
  summary: "Translator is running.",
  transcriptRef: "session:translator-invalid-candidate-id",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-candidate-id",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "translator", subagentRunId: invalidCandidateIdRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const translatorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-candidate-id" && row.roleId === "translator");
  assert.equal(translatorPass?.status, "failed");
  assert.match(translatorPass?.summary ?? "", /Role output rejected: candidateTargets\[0\]\.id must be a string/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-producer-candidate",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidProducerCandidateRunId = `la-invalid-producer-candidate-${Date.now()}`;
const invalidProducerCandidateAsyncDir = join(defaultSubagentAsyncRoot(), invalidProducerCandidateRunId);
await mkdir(invalidProducerCandidateAsyncDir, { recursive: true });
await writeFile(join(invalidProducerCandidateAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidProducerCandidateRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-producer",
  outputFile: join(invalidProducerCandidateAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-producer", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidProducerCandidateAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "producer",
  summary: "Producer incorrectly wrote candidate translations.",
  candidateTargets: [{ segmentId: "seg-1", target: "Event Time", evidenceRefs: [] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-producer-candidate",
  roleId: "producer",
  status: "running",
  sessionId: "la-team-team-invalid-producer-candidate-producer",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidProducerCandidateRunId,
  subagentAsyncDir: invalidProducerCandidateAsyncDir,
  summary: "Producer is running.",
  transcriptRef: "session:producer-invalid-candidate",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-producer-candidate",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "producer", subagentRunId: invalidProducerCandidateRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const producerPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-producer-candidate" && row.roleId === "producer");
  assert.equal(producerPass?.status, "failed");
  assert.match(producerPass?.summary ?? "", /Role output rejected: candidateTargets is not allowed for producer/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-translator-candidate-schema",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const translatorCandidateRunId = `la-translator-candidate-schema-${Date.now()}`;
const translatorCandidateAsyncDir = join(defaultSubagentAsyncRoot(), translatorCandidateRunId);
await mkdir(translatorCandidateAsyncDir, { recursive: true });
await writeFile(join(translatorCandidateAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: translatorCandidateRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-translator",
  outputFile: join(translatorCandidateAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-translator", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(translatorCandidateAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "translator",
  summary: "Candidate is classified and ready.",
  candidates: [{
    id: "translator-candidate-1",
    segmentId: "seg-1",
    target: "Event Time",
    evidenceRefs: [],
    function: "ui",
    notes: "Conventional UI label; no hard evidence conflict.",
  }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-translator-candidate-schema",
  roleId: "translator",
  status: "running",
  sessionId: "la-team-team-translator-candidate-schema-translator",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: translatorCandidateRunId,
  subagentAsyncDir: translatorCandidateAsyncDir,
  summary: "Translator is running.",
  transcriptRef: "session:translator-candidate-schema",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-translator-candidate-schema",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "translator", subagentRunId: translatorCandidateRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as {
    teamRolePasses: TeamRolePass[];
    teamCandidateTargets: Array<{ id: string; function?: string; notes?: string }>;
  };
  const translatorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-translator-candidate-schema" && row.roleId === "translator");
  assert.equal(translatorPass?.status, "completed");
  const candidate = routeArtifacts.teamCandidateTargets.find((row) => row.id === "translator-candidate-1");
  assert.equal(candidate?.function, "ui");
  assert.match(candidate?.notes ?? "", /Conventional UI label/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-translator-candidate-alias-conflict",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const translatorCandidateAliasRunId = `la-translator-candidate-alias-${Date.now()}`;
const translatorCandidateAliasAsyncDir = join(defaultSubagentAsyncRoot(), translatorCandidateAliasRunId);
await mkdir(translatorCandidateAliasAsyncDir, { recursive: true });
await writeFile(join(translatorCandidateAliasAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: translatorCandidateAliasRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-translator",
  outputFile: join(translatorCandidateAliasAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-translator", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(translatorCandidateAliasAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "translator",
  summary: "Translator emitted both candidate aliases.",
  candidateTargets: [{
    segmentId: "seg-1",
    target: "Event Time",
    evidenceRefs: [],
    function: "ui",
    notes: "Primary field.",
  }],
  candidates: [{
    segmentId: "seg-2",
    target: "Guild",
    evidenceRefs: [],
    function: "ui",
    notes: "Alias field should not be silently ignored.",
  }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-translator-candidate-alias-conflict",
  roleId: "translator",
  status: "running",
  sessionId: "la-team-team-translator-candidate-alias-conflict-translator",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: translatorCandidateAliasRunId,
  subagentAsyncDir: translatorCandidateAliasAsyncDir,
  summary: "Translator is running.",
  transcriptRef: "session:translator-candidate-alias-conflict",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-translator-candidate-alias-conflict",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "translator", subagentRunId: translatorCandidateAliasRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const translatorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-translator-candidate-alias-conflict" && row.roleId === "translator");
  assert.equal(translatorPass?.status, "failed");
  assert.match(translatorPass?.summary ?? "", /Role output rejected: candidateTargets and candidates cannot both be set/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-finding-segment",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidFindingSegmentRunId = `la-invalid-finding-segment-${Date.now()}`;
const invalidFindingSegmentAsyncDir = join(defaultSubagentAsyncRoot(), invalidFindingSegmentRunId);
await mkdir(invalidFindingSegmentAsyncDir, { recursive: true });
await writeFile(join(invalidFindingSegmentAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidFindingSegmentRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-editor",
  outputFile: join(invalidFindingSegmentAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidFindingSegmentAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "editor",
  summary: "Editor found an issue.",
  findings: [{ severity: "major", type: "accuracy", message: "Meaning drift.", evidenceRefs: [] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-finding-segment",
  roleId: "editor",
  status: "running",
  sessionId: "la-team-team-invalid-finding-segment-editor",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidFindingSegmentRunId,
  subagentAsyncDir: invalidFindingSegmentAsyncDir,
  summary: "Editor is running.",
  transcriptRef: "session:editor-invalid-finding-segment",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-finding-segment",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: invalidFindingSegmentRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-finding-segment" && row.roleId === "editor");
  assert.equal(editorPass?.status, "failed");
  assert.match(editorPass?.summary ?? "", /Role output rejected: findings\[0\]\.segmentId is required for editor/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-finding-evidence",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidFindingEvidenceRunId = `la-invalid-finding-evidence-${Date.now()}`;
const invalidFindingEvidenceAsyncDir = join(defaultSubagentAsyncRoot(), invalidFindingEvidenceRunId);
await mkdir(invalidFindingEvidenceAsyncDir, { recursive: true });
await writeFile(join(invalidFindingEvidenceAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidFindingEvidenceRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-editor",
  outputFile: join(invalidFindingEvidenceAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidFindingEvidenceAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "editor",
  summary: "Editor found an issue.",
  findings: [{ segmentId: "seg-1", severity: "major", type: "accuracy", message: "Meaning drift.", proposedTarget: null, evidenceRefs: "invalid" }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-finding-evidence",
  roleId: "editor",
  status: "running",
  sessionId: "la-team-team-invalid-finding-evidence-editor",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidFindingEvidenceRunId,
  subagentAsyncDir: invalidFindingEvidenceAsyncDir,
  summary: "Editor is running.",
  transcriptRef: "session:editor-invalid-finding-evidence",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-finding-evidence",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: invalidFindingEvidenceRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-finding-evidence" && row.roleId === "editor");
  assert.equal(editorPass?.status, "failed");
  assert.match(editorPass?.summary ?? "", /Role output rejected: findings\[0\]\.evidenceRefs must be an array of strings/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-finding-duplicate-id",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidFindingDuplicateIdRunId = `la-invalid-finding-duplicate-id-${Date.now()}`;
const invalidFindingDuplicateIdAsyncDir = join(defaultSubagentAsyncRoot(), invalidFindingDuplicateIdRunId);
await mkdir(invalidFindingDuplicateIdAsyncDir, { recursive: true });
await writeFile(join(invalidFindingDuplicateIdAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidFindingDuplicateIdRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-editor",
  outputFile: join(invalidFindingDuplicateIdAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidFindingDuplicateIdAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "editor",
  summary: "Editor emitted duplicate finding ids.",
  findings: [
    { id: "dup-finding", segmentId: "seg-1", severity: "major", type: "accuracy", message: "Meaning drift.", evidenceRefs: ["tm:1"] },
    { id: "dup-finding", segmentId: "seg-2", severity: "minor", type: "style", message: "Tone drift.", evidenceRefs: ["style:1"] },
  ],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-finding-duplicate-id",
  roleId: "editor",
  status: "running",
  sessionId: "la-team-team-invalid-finding-duplicate-id-editor",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidFindingDuplicateIdRunId,
  subagentAsyncDir: invalidFindingDuplicateIdAsyncDir,
  summary: "Editor is running.",
  transcriptRef: "session:editor-invalid-finding-duplicate-id",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-finding-duplicate-id",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: invalidFindingDuplicateIdRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { completedStepIds?: string[]; teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-finding-duplicate-id" && row.roleId === "editor");
  assert.equal(editorPass?.status, "failed");
  assert.match(editorPass?.summary ?? "", /Role output rejected: findings\[1\]\.id must be unique/);
  assert.equal(routeArtifacts.completedStepIds?.includes("editor") ?? false, false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-noissues",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidNoIssuesRunId = `la-invalid-noissues-${Date.now()}`;
const invalidNoIssuesAsyncDir = join(defaultSubagentAsyncRoot(), invalidNoIssuesRunId);
await mkdir(invalidNoIssuesAsyncDir, { recursive: true });
await writeFile(join(invalidNoIssuesAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidNoIssuesRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-proofreader",
  outputFile: join(invalidNoIssuesAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-proofreader", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidNoIssuesAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "proofreader",
  summary: "Contradictory review.",
  noIssues: true,
  findings: [{ segmentId: "seg-1", severity: "minor", type: "format", message: "Extra space.", evidenceRefs: [] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-noissues",
  roleId: "proofreader",
  status: "running",
  sessionId: "la-team-team-invalid-noissues-proofreader",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidNoIssuesRunId,
  subagentAsyncDir: invalidNoIssuesAsyncDir,
  summary: "Proofreader is running.",
  transcriptRef: "session:proofreader-invalid-noissues",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-noissues",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "proofreader", subagentRunId: invalidNoIssuesRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const proofreaderPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-noissues" && row.roleId === "proofreader");
  assert.equal(proofreaderPass?.status, "failed");
  assert.match(proofreaderPass?.summary ?? "", /Role output rejected: noIssues cannot be true with findings/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-query-only",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const queryOnlyRunId = `la-query-only-${Date.now()}`;
const queryOnlyAsyncDir = join(defaultSubagentAsyncRoot(), queryOnlyRunId);
await mkdir(queryOnlyAsyncDir, { recursive: true });
await writeFile(join(queryOnlyAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: queryOnlyRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-editor",
  outputFile: join(queryOnlyAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(queryOnlyAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "editor",
  summary: "Editor records optional client context.",
  queries: [{ severity: "advisory", question: "Should this button copy follow the platform glossary?", evidenceRefs: ["style:buttons"] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-query-only",
  roleId: "editor",
  status: "running",
  sessionId: "la-team-team-query-only-editor",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: queryOnlyRunId,
  subagentAsyncDir: queryOnlyAsyncDir,
  summary: "Editor is running.",
  transcriptRef: "session:editor-query-only",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-query-only",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: queryOnlyRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[]; teamFindings: Array<{ workflowId?: string; type: string; message: string }> };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-query-only" && row.roleId === "editor");
  assert.equal(editorPass?.status, "completed", "An advisory query remains visible but must not pause the run.");
  assert.equal(routeArtifacts.teamFindings.find((row) => row.workflowId === "team-query-only")?.type, "query");
  assert.match(routeArtifacts.teamFindings.find((row) => row.workflowId === "team-query-only")?.message ?? "", /platform glossary/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-query-evidence",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidQueryEvidenceRunId = `la-invalid-query-evidence-${Date.now()}`;
const invalidQueryEvidenceAsyncDir = join(defaultSubagentAsyncRoot(), invalidQueryEvidenceRunId);
await mkdir(invalidQueryEvidenceAsyncDir, { recursive: true });
await writeFile(join(invalidQueryEvidenceAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidQueryEvidenceRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-editor",
  outputFile: join(invalidQueryEvidenceAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidQueryEvidenceAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "editor",
  summary: "Editor returns invalid evidence refs.",
  queries: [{ question: "Should this button copy follow the platform glossary?", evidenceRefs: "invalid" }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-query-evidence",
  roleId: "editor",
  status: "running",
  sessionId: "la-team-team-invalid-query-evidence-editor",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidQueryEvidenceRunId,
  subagentAsyncDir: invalidQueryEvidenceAsyncDir,
  summary: "Editor is running.",
  transcriptRef: "session:editor-invalid-query-evidence",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-query-evidence",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: invalidQueryEvidenceRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-query-evidence" && row.roleId === "editor");
  assert.equal(editorPass?.status, "failed");
  assert.match(editorPass?.summary ?? "", /Role output rejected: queries\[0\]\.evidenceRefs must be an array of strings/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-query-severity",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidQuerySeverityRunId = `la-invalid-query-severity-${Date.now()}`;
const invalidQuerySeverityAsyncDir = join(defaultSubagentAsyncRoot(), invalidQuerySeverityRunId);
await mkdir(invalidQuerySeverityAsyncDir, { recursive: true });
await writeFile(join(invalidQuerySeverityAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidQuerySeverityRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-editor",
  outputFile: join(invalidQuerySeverityAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidQuerySeverityAsyncDir, "output-0.log"), JSON.stringify({
  roleId: "editor",
  summary: "Editor asks with invalid query severity.",
  queries: [{ question: "Should this button copy follow the platform glossary?", severity: "urgent", evidenceRefs: ["style:buttons"] }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-query-severity",
  roleId: "editor",
  status: "running",
  sessionId: "la-team-team-invalid-query-severity-editor",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidQuerySeverityRunId,
  subagentAsyncDir: invalidQuerySeverityAsyncDir,
  summary: "Editor is running.",
  transcriptRef: "session:editor-invalid-query-severity",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-query-severity",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: invalidQuerySeverityRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-query-severity" && row.roleId === "editor");
  assert.equal(editorPass?.status, "failed");
  assert.match(editorPass?.summary ?? "", /Role output rejected: queries\[0\]\.severity is invalid/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-prelqa",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidPreLqaRunId = `la-invalid-prelqa-${Date.now()}`;
const invalidPreLqaAsyncDir = join(defaultSubagentAsyncRoot(), invalidPreLqaRunId);
await mkdir(invalidPreLqaAsyncDir, { recursive: true });
await writeFile(join(invalidPreLqaAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidPreLqaRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-pre-lqa-reviewer",
  outputFile: join(invalidPreLqaAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-pre-lqa-reviewer", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidPreLqaAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Pre-LQA completed.",
  preLqaRisks: [{}],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-prelqa",
  roleId: "pre_lqa_reviewer",
  status: "running",
  sessionId: "la-team-team-invalid-prelqa-pre-lqa-reviewer",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidPreLqaRunId,
  subagentAsyncDir: invalidPreLqaAsyncDir,
  summary: "Pre-LQA is running.",
  transcriptRef: "session:prelqa-invalid",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-prelqa",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "pre_lqa_reviewer", subagentRunId: invalidPreLqaRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const preLqaPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-prelqa" && row.roleId === "pre_lqa_reviewer");
  assert.equal(preLqaPass?.status, "failed");
  assert.match(preLqaPass?.summary ?? "", /Role output rejected: preLqaRisks\[0\]\.message is required/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-prelqa")).completedStepIds.includes("pre_lqa_reviewer"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-prelqa-evidence",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidPreLqaEvidenceRunId = `la-invalid-prelqa-evidence-${Date.now()}`;
const invalidPreLqaEvidenceAsyncDir = join(defaultSubagentAsyncRoot(), invalidPreLqaEvidenceRunId);
await mkdir(invalidPreLqaEvidenceAsyncDir, { recursive: true });
await writeFile(join(invalidPreLqaEvidenceAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidPreLqaEvidenceRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-pre-lqa-reviewer",
  outputFile: join(invalidPreLqaEvidenceAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-pre-lqa-reviewer", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidPreLqaEvidenceAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Pre-LQA completed.",
  preLqaRisks: [{ message: "Button label may overflow.", severity: "major", evidenceRefs: "invalid" }],
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-prelqa-evidence",
  roleId: "pre_lqa_reviewer",
  status: "running",
  sessionId: "la-team-team-invalid-prelqa-evidence-pre-lqa-reviewer",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidPreLqaEvidenceRunId,
  subagentAsyncDir: invalidPreLqaEvidenceAsyncDir,
  summary: "Pre-LQA is running.",
  transcriptRef: "session:prelqa-invalid-evidence",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-prelqa-evidence",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "pre_lqa_reviewer", subagentRunId: invalidPreLqaEvidenceRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const preLqaPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-prelqa-evidence" && row.roleId === "pre_lqa_reviewer");
  assert.equal(preLqaPass?.status, "failed");
  assert.match(preLqaPass?.summary ?? "", /Role output rejected: preLqaRisks\[0\]\.evidenceRefs must be an array of strings/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-prelqa-evidence")).completedStepIds.includes("pre_lqa_reviewer"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-delivery-qa",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidDeliveryQaRunId = `la-invalid-delivery-qa-${Date.now()}`;
const invalidDeliveryQaAsyncDir = join(defaultSubagentAsyncRoot(), invalidDeliveryQaRunId);
await mkdir(invalidDeliveryQaAsyncDir, { recursive: true });
await writeFile(join(invalidDeliveryQaAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidDeliveryQaRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-delivery-manager",
  outputFile: join(invalidDeliveryQaAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-delivery-manager", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidDeliveryQaAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Delivery QA completed.",
  deliveryQa: {
    reportId: "raw-bad-finding",
    projectId: "proj",
    batchId: "b1",
    workflowId: "team-invalid-delivery-qa",
    generatedAt: new Date(1).toISOString(),
    summary: { blockers: 1, warnings: 0, advisories: 0 },
    findings: [{}],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-delivery-qa",
  roleId: "delivery_manager",
  status: "running",
  sessionId: "la-team-team-invalid-delivery-qa-delivery-manager",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidDeliveryQaRunId,
  subagentAsyncDir: invalidDeliveryQaAsyncDir,
  summary: "Delivery Manager is running.",
  transcriptRef: "session:delivery-qa-invalid",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-delivery-qa",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "delivery_manager", subagentRunId: invalidDeliveryQaRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const deliveryPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-delivery-qa" && row.roleId === "delivery_manager");
  assert.equal(deliveryPass?.status, "failed");
  assert.match(deliveryPass?.summary ?? "", /Role output rejected: deliveryQa is not allowed for delivery_manager/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-delivery-qa")).completedStepIds.includes("delivery_manager"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-delivery-qa-generated-at",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidDeliveryQaGeneratedAtRunId = `la-invalid-delivery-qa-generated-at-${Date.now()}`;
const invalidDeliveryQaGeneratedAtAsyncDir = join(defaultSubagentAsyncRoot(), invalidDeliveryQaGeneratedAtRunId);
await mkdir(invalidDeliveryQaGeneratedAtAsyncDir, { recursive: true });
await writeFile(join(invalidDeliveryQaGeneratedAtAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidDeliveryQaGeneratedAtRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-delivery-manager",
  outputFile: join(invalidDeliveryQaGeneratedAtAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-delivery-manager", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidDeliveryQaGeneratedAtAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Delivery QA completed without generatedAt.",
  deliveryQa: {
    reportId: "raw-bad-generated-at",
    projectId: "proj",
    batchId: "b1",
    workflowId: "team-invalid-delivery-qa-generated-at",
    summary: { blockers: 0, warnings: 0, advisories: 0 },
    findings: [],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-delivery-qa-generated-at",
  roleId: "delivery_manager",
  status: "running",
  sessionId: "la-team-team-invalid-delivery-qa-generated-at-delivery-manager",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidDeliveryQaGeneratedAtRunId,
  subagentAsyncDir: invalidDeliveryQaGeneratedAtAsyncDir,
  summary: "Delivery Manager is running.",
  transcriptRef: "session:delivery-qa-invalid-generated-at",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-delivery-qa-generated-at",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "delivery_manager", subagentRunId: invalidDeliveryQaGeneratedAtRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const deliveryPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-delivery-qa-generated-at" && row.roleId === "delivery_manager");
  assert.equal(deliveryPass?.status, "failed");
  assert.match(deliveryPass?.summary ?? "", /Role output rejected: deliveryQa is not allowed for delivery_manager/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-delivery-qa-scope",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidDeliveryQaScopeRunId = `la-invalid-delivery-qa-scope-${Date.now()}`;
const invalidDeliveryQaScopeAsyncDir = join(defaultSubagentAsyncRoot(), invalidDeliveryQaScopeRunId);
await mkdir(invalidDeliveryQaScopeAsyncDir, { recursive: true });
await writeFile(join(invalidDeliveryQaScopeAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidDeliveryQaScopeRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-delivery-manager",
  outputFile: join(invalidDeliveryQaScopeAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-delivery-manager", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidDeliveryQaScopeAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Delivery QA completed for the wrong workflow.",
  deliveryQa: {
    reportId: "raw-bad-scope",
    projectId: "proj",
    batchId: "b1",
    workflowId: "other-workflow",
    generatedAt: new Date(1).toISOString(),
    summary: { blockers: 0, warnings: 0, advisories: 0 },
    findings: [],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-delivery-qa-scope",
  roleId: "delivery_manager",
  status: "running",
  sessionId: "la-team-team-invalid-delivery-qa-scope-delivery-manager",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidDeliveryQaScopeRunId,
  subagentAsyncDir: invalidDeliveryQaScopeAsyncDir,
  summary: "Delivery Manager is running.",
  transcriptRef: "session:delivery-qa-invalid-scope",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-delivery-qa-scope",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "delivery_manager", subagentRunId: invalidDeliveryQaScopeRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const deliveryPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-delivery-qa-scope" && row.roleId === "delivery_manager");
  assert.equal(deliveryPass?.status, "failed");
  assert.match(deliveryPass?.summary ?? "", /Role output rejected: deliveryQa is not allowed for delivery_manager/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-delivery-qa-scope")).completedStepIds.includes("delivery_manager"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-delivery-qa-summary",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidDeliveryQaSummaryRunId = `la-invalid-delivery-qa-summary-${Date.now()}`;
const invalidDeliveryQaSummaryAsyncDir = join(defaultSubagentAsyncRoot(), invalidDeliveryQaSummaryRunId);
await mkdir(invalidDeliveryQaSummaryAsyncDir, { recursive: true });
await writeFile(join(invalidDeliveryQaSummaryAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidDeliveryQaSummaryRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-delivery-manager",
  outputFile: join(invalidDeliveryQaSummaryAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-delivery-manager", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidDeliveryQaSummaryAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Delivery QA completed with stale summary counts.",
  deliveryQa: {
    reportId: "raw-bad-summary",
    projectId: "proj",
    batchId: "b1",
    workflowId: "team-invalid-delivery-qa-summary",
    generatedAt: new Date(1).toISOString(),
    summary: { blockers: 0, warnings: 0, advisories: 0 },
    findings: [{
      id: "qa-summary-mismatch",
      type: "placeholder_mismatch",
      severity: "blocker",
      message: "Placeholder mismatch.",
      evidence: ["seg-1"],
    }],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-delivery-qa-summary",
  roleId: "delivery_manager",
  status: "running",
  sessionId: "la-team-team-invalid-delivery-qa-summary-delivery-manager",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidDeliveryQaSummaryRunId,
  subagentAsyncDir: invalidDeliveryQaSummaryAsyncDir,
  summary: "Delivery Manager is running.",
  transcriptRef: "session:delivery-qa-invalid-summary",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-delivery-qa-summary",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "delivery_manager", subagentRunId: invalidDeliveryQaSummaryRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const deliveryPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-delivery-qa-summary" && row.roleId === "delivery_manager");
  assert.equal(deliveryPass?.status, "failed");
  assert.match(deliveryPass?.summary ?? "", /Role output rejected: deliveryQa is not allowed for delivery_manager/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-delivery-qa-summary")).completedStepIds.includes("delivery_manager"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-delivery-qa-location",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidDeliveryQaLocationRunId = `la-invalid-delivery-qa-location-${Date.now()}`;
const invalidDeliveryQaLocationAsyncDir = join(defaultSubagentAsyncRoot(), invalidDeliveryQaLocationRunId);
await mkdir(invalidDeliveryQaLocationAsyncDir, { recursive: true });
await writeFile(join(invalidDeliveryQaLocationAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidDeliveryQaLocationRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-delivery-manager",
  outputFile: join(invalidDeliveryQaLocationAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-delivery-manager", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidDeliveryQaLocationAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Delivery QA completed with invalid location.",
  deliveryQa: {
    reportId: "raw-bad-location",
    projectId: "proj",
    batchId: "b1",
    workflowId: "team-invalid-delivery-qa-location",
    generatedAt: new Date(1).toISOString(),
    summary: { blockers: 1, warnings: 0, advisories: 0 },
    findings: [{
      id: "qa-bad-location",
      type: "placeholder_mismatch",
      severity: "blocker",
      source: 123,
      message: "Placeholder mismatch.",
      evidence: ["seg-1"],
    }],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-delivery-qa-location",
  roleId: "delivery_manager",
  status: "running",
  sessionId: "la-team-team-invalid-delivery-qa-location-delivery-manager",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidDeliveryQaLocationRunId,
  subagentAsyncDir: invalidDeliveryQaLocationAsyncDir,
  summary: "Delivery Manager is running.",
  transcriptRef: "session:delivery-qa-invalid-location",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-delivery-qa-location",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "delivery_manager", subagentRunId: invalidDeliveryQaLocationRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const deliveryPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-delivery-qa-location" && row.roleId === "delivery_manager");
  assert.equal(deliveryPass?.status, "failed");
  assert.match(deliveryPass?.summary ?? "", /Role output rejected: deliveryQa is not allowed for delivery_manager/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-delivery-qa-location")).completedStepIds.includes("delivery_manager"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-delivery-qa-duplicate-id",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidDeliveryQaDuplicateRunId = `la-invalid-delivery-qa-duplicate-${Date.now()}`;
const invalidDeliveryQaDuplicateAsyncDir = join(defaultSubagentAsyncRoot(), invalidDeliveryQaDuplicateRunId);
await mkdir(invalidDeliveryQaDuplicateAsyncDir, { recursive: true });
await writeFile(join(invalidDeliveryQaDuplicateAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidDeliveryQaDuplicateRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-delivery-manager",
  outputFile: join(invalidDeliveryQaDuplicateAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-delivery-manager", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidDeliveryQaDuplicateAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Delivery QA completed with duplicate ids.",
  deliveryQa: {
    reportId: "raw-bad-duplicate-id",
    projectId: "proj",
    batchId: "b1",
    workflowId: "team-invalid-delivery-qa-duplicate-id",
    generatedAt: new Date(1).toISOString(),
    summary: { blockers: 2, warnings: 0, advisories: 0 },
    findings: [
      {
        id: "qa-duplicate",
        type: "placeholder_mismatch",
        severity: "blocker",
        message: "Placeholder mismatch.",
        evidence: ["seg-1"],
      },
      {
        id: "qa-duplicate",
        type: "tag_mismatch",
        severity: "blocker",
        message: "Tag mismatch.",
        evidence: ["seg-2"],
      },
    ],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-delivery-qa-duplicate-id",
  roleId: "delivery_manager",
  status: "running",
  sessionId: "la-team-team-invalid-delivery-qa-duplicate-id-delivery-manager",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidDeliveryQaDuplicateRunId,
  subagentAsyncDir: invalidDeliveryQaDuplicateAsyncDir,
  summary: "Delivery Manager is running.",
  transcriptRef: "session:delivery-qa-invalid-duplicate-id",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-delivery-qa-duplicate-id",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "delivery_manager", subagentRunId: invalidDeliveryQaDuplicateRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const deliveryPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-delivery-qa-duplicate-id" && row.roleId === "delivery_manager");
  assert.equal(deliveryPass?.status, "failed");
  assert.match(deliveryPass?.summary ?? "", /Role output rejected: deliveryQa is not allowed for delivery_manager/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-delivery-qa-duplicate-id")).completedStepIds.includes("delivery_manager"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-delivery-qa-evidence",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
const invalidDeliveryQaEvidenceRunId = `la-invalid-delivery-qa-evidence-${Date.now()}`;
const invalidDeliveryQaEvidenceAsyncDir = join(defaultSubagentAsyncRoot(), invalidDeliveryQaEvidenceRunId);
await mkdir(invalidDeliveryQaEvidenceAsyncDir, { recursive: true });
await writeFile(join(invalidDeliveryQaEvidenceAsyncDir, "status.json"), JSON.stringify({
  lifecycleArtifactVersion: 1,
  runId: invalidDeliveryQaEvidenceRunId,
  mode: "single",
  state: "complete",
  agent: "la-team-delivery-manager",
  outputFile: join(invalidDeliveryQaEvidenceAsyncDir, "output-0.log"),
  steps: [{ agent: "la-team-delivery-manager", model: "deepseek/deepseek-v4-flash" }],
}, null, 2), "utf8");
await writeFile(join(invalidDeliveryQaEvidenceAsyncDir, "output-0.log"), JSON.stringify({
  summary: "Delivery QA completed without evidence.",
  deliveryQa: {
    reportId: "raw-bad-finding-evidence",
    projectId: "proj",
    batchId: "b1",
    workflowId: "team-invalid-delivery-qa-evidence",
    generatedAt: new Date(1).toISOString(),
    summary: { blockers: 1, warnings: 0, advisories: 0 },
    findings: [{
      id: "qa-no-evidence",
      type: "placeholder_mismatch",
      severity: "blocker",
      message: "Placeholder mismatch.",
    }],
  },
}), "utf8");
await upsertTeamRolePass(workspaceRoot, "proj", {
  workflowId: "team-invalid-delivery-qa-evidence",
  roleId: "delivery_manager",
  status: "running",
  sessionId: "la-team-team-invalid-delivery-qa-evidence-delivery-manager",
  inputArtifactRefs: [],
  outputArtifactRefs: [],
  subagentRunId: invalidDeliveryQaEvidenceRunId,
  subagentAsyncDir: invalidDeliveryQaEvidenceAsyncDir,
  summary: "Delivery Manager is running.",
  transcriptRef: "session:delivery-qa-invalid-evidence",
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-delivery-qa-evidence",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "delivery_manager", subagentRunId: invalidDeliveryQaEvidenceRunId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const deliveryPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-delivery-qa-evidence" && row.roleId === "delivery_manager");
  assert.equal(deliveryPass?.status, "failed");
  assert.match(deliveryPass?.summary ?? "", /Role output rejected: deliveryQa is not allowed for delivery_manager/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-delivery-qa-evidence")).completedStepIds.includes("delivery_manager"), false);
}

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid",
    "resume",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ execute: false, planHash: await currentPlanHash("team-invalid") }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  assert.equal((responses.at(-1)?.data as { roleId: string }).roleId, "loc_engineer_gate");
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid")).completedStepIds.includes("loc_engineer_gate"), false);
}

await writeTeamRoleSettings(workspaceRoot, {
  profiles: [
    { roleId: "producer", enabled: false, provider: "deepseek", modelId: "deepseek-v4-flash", thinking: "medium" },
  ],
});
await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-disabled",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-disabled",
    "start",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ execute: false, planHash: await currentPlanHash("team-disabled") }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  assert.equal((responses.at(-1)?.data as { roleId: string }).roleId, "loc_engineer_gate");
  const artifacts = await readWorkflowArtifacts(workspaceRoot, "proj");
  const producerPass = artifacts.teamRolePasses.find((row) => row.workflowId === "team-disabled" && row.roleId === "producer");
  assert.equal(producerPass?.status, "skipped");
  assert.equal(producerPass?.modelId, "deepseek-v4-flash");
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-disabled")).completedStepIds.includes("producer"), true);
}
await writeTeamRoleSettings(workspaceRoot, {
  profiles: [
    { roleId: "producer", enabled: true },
  ],
});

{
  const runId = `la-execute-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  const responses: Array<{ status: number; data: unknown }> = [];
  let spawnedAgent = "";
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-smoke",
    "run-role",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "proofreader", modelProvider: "deepseek", modelId: "deepseek-v4-flash", execute: true }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    spawnSubagentRun: async (_projectId, _workflowId, roleId, request) => {
      spawnedAgent = request.params.agent;
      assert.equal(roleId, "proofreader");
      await mkdir(asyncDir, { recursive: true });
      await writeFile(join(asyncDir, "status.json"), JSON.stringify({
        lifecycleArtifactVersion: 1,
        runId,
        mode: "single",
        state: "running",
        agent: "la-team-proofreader",
        startedAt: Date.now(),
        outputFile: join(asyncDir, "output-0.log"),
        sessionFile: join(asyncDir, "child.jsonl"),
        steps: [{ agent: "la-team-proofreader", model: "deepseek/deepseek-v4-flash" }],
      }, null, 2), "utf8");
      return { details: { asyncDir } };
    },
  });
  assert.equal(handled, true);
  assert.equal(spawnedAgent, "la-team-proofreader");
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const proofreaderPass = routeArtifacts.teamRolePasses.find((row) => row.roleId === "proofreader");
  assert.equal(proofreaderPass?.status, "running");
  assert.equal(proofreaderPass?.subagentRunId, runId);
  assert.equal(proofreaderPass?.subagentAsyncDir, asyncDir);
  assert.match(proofreaderPass?.contextManifestRef ?? "", /^team-evidence-policy:[0-9a-f]{64}$/);
}

{
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-smoke",
    "run-role",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "producer", execute: true }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    spawnSubagentRun: async () => [],
  });
  assert.equal(handled, true);
  assert.equal(responses.at(-1)?.status, 202);
  const routeArtifacts = responses.at(-1)?.data as {
    teamRolePasses: TeamRolePass[];
    teamFindings: Array<{ id: string; message: string }>;
    teamCandidateTargets: Array<{ id: string; target: string }>;
  };
  const producerPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-smoke" && row.roleId === "producer");
  assert.equal(producerPass?.status, "waiting");
  assert.match(producerPass?.summary ?? "", /No matching Team child async status was found/);
}

{
  const runId = `la-status-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  const transcriptRoot = join(workspaceRoot, ".pi-subagents", "artifacts");
  const transcriptPath = join(transcriptRoot, `${runId}_la-team-editor_transcript.jsonl`);
  await mkdir(asyncDir, { recursive: true });
  await mkdir(transcriptRoot, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    sessionId: "pi-parent-session",
    mode: "single",
    state: "complete",
    agent: "la-team-editor",
    startedAt: Date.UTC(2026, 0, 1),
    endedAt: Date.UTC(2026, 0, 1, 0, 1),
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(tmpdir(), "pi-subagent-session-outside-async", "session.jsonl"),
    steps: [{ agent: "la-team-editor", model: "deepseek/deepseek-v4-flash", transcriptPath }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), `[la-team-editor] completed\n\`\`\`json\n${JSON.stringify({
    summary: "Editor completed with one accuracy finding.",
    findings: [{
      id: "finding-editor-1",
      segmentId: "seg-1",
      severity: "major",
      type: "accuracy",
      message: "Meaning drift.",
      proposedTarget: "Corrected target",
      evidenceRefs: ["tm:1"],
    }],
    candidates: [{
      id: "candidate-editor-1",
      segmentId: "seg-1",
      target: "Corrected target",
      notes: "Fixes the meaning drift identified in finding-editor-1.",
      evidenceRefs: ["tm:1"],
    }],
  })}\n\`\`\`\n`, "utf8");
  await writeFile(transcriptPath, "{\"type\":\"message\",\"text\":\"editor transcript\"}\n", "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-smoke",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  assert.equal(responses.at(-1)?.status, 200);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const editorPass = routeArtifacts.teamRolePasses.find((row) => row.roleId === "editor");
  assert.equal(editorPass?.status, "completed");
  assert.equal(editorPass?.subagentRunId, runId);
  assert.equal(editorPass?.subagentAsyncDir, asyncDir);
  assert.equal(editorPass?.modelId, "deepseek/deepseek-v4-flash");
  assert.equal(editorPass?.summary, "Editor completed with one accuracy finding.");
  assert.equal(routeArtifacts.teamFindings.find((row) => row.id === "finding-editor-1")?.message, "Meaning drift.");
  assert.equal(routeArtifacts.teamCandidateTargets.find((row) => row.id === "candidate-editor-1")?.target, "Corrected target");
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-smoke")).completedStepIds.includes("editor"), true);

  const transcriptResponses: Array<{ status: number; data: unknown }> = [];
  const transcriptHandled = await handleWorkflowRoute({ method: "GET" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-smoke",
    "transcript",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => transcriptResponses.push({ status, data }),
    readBody: async () => ({}),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(transcriptHandled, false, "legacy transcript reads must stay deleted after Task archive migration");
  assert.equal(transcriptResponses.length, 0);
}

{
  const runId = `la-status-final-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    startedAt: Date.UTC(2026, 0, 1),
    endedAt: Date.UTC(2026, 0, 1, 0, 1),
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    reviewedDeliveryQa: {
      reportId: "reviewed-final-qa",
      reviewedAt: new Date(2).toISOString(),
      rawReport: {
        reportId: "raw-final-qa",
        projectId: "proj",
        batchId: "b1",
        workflowId: "team-smoke",
        generatedAt: new Date(1).toISOString(),
        summary: { blockers: 1, warnings: 0, advisories: 0 },
        findings: [{
          id: "qa-fix-1",
          type: "placeholder_mismatch",
          severity: "blocker",
          segmentId: "seg-1",
          message: "Placeholder mismatch.",
          evidence: ["source:{0}", "target:"],
        }],
      },
      findings: [{
        id: "qa-fix-1",
        type: "placeholder_mismatch",
        severity: "blocker",
        segmentId: "seg-1",
        message: "Placeholder mismatch.",
        evidence: ["source:{0}", "target:"],
        reviewDecision: "fix_required",
        reviewReason: "Must fix before delivery.",
        reviewedBy: "lead_linguist",
      }],
    },
  }), "utf8");
  await writeFile(join(asyncDir, "child.jsonl"), "{\"type\":\"message\",\"text\":\"final transcript\"}\n", "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-smoke",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as {
    teamDecisions: Array<{ id: string; decision: string; reason: string; findingIds: string[] }>;
  };
  const qaDecision = routeArtifacts.teamDecisions.find((row) => row.findingIds.includes("qa-fix-1"));
  assert.equal(qaDecision, undefined);
  const finalPass = (await readWorkflowArtifacts(workspaceRoot, "proj")).teamRolePasses.find(
    (row) => row.workflowId === "team-smoke" && row.roleId === "lead_linguist_final",
  );
  assert.match(finalPass?.summary ?? "", /reviewedDeliveryQa is server\/user-owned/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-invalid-reviewed-qa-scope",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
{
  const runId = `la-status-reviewed-qa-scope-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    reviewedDeliveryQa: {
      reportId: "reviewed-bad-scope",
      reviewedAt: new Date(2).toISOString(),
      rawReport: {
        reportId: "raw-bad-reviewed-scope",
        projectId: "proj",
        batchId: "b1",
        workflowId: "other-workflow",
        generatedAt: new Date(1).toISOString(),
        summary: { blockers: 1, warnings: 0, advisories: 0 },
        findings: [{
          id: "qa-bad-reviewed-scope",
          type: "placeholder_mismatch",
          severity: "blocker",
          segmentId: "seg-1",
          message: "Placeholder mismatch.",
          evidence: ["source:{0}", "target:"],
        }],
      },
      findings: [{
        id: "qa-bad-reviewed-scope",
        type: "placeholder_mismatch",
        severity: "blocker",
        segmentId: "seg-1",
        message: "Placeholder mismatch.",
        evidence: ["source:{0}", "target:"],
        reviewDecision: "fix_required",
        reviewReason: "Must fix before delivery.",
        reviewedBy: "lead_linguist",
      }],
    },
  }), "utf8");
  await writeFile(join(asyncDir, "child.jsonl"), "{\"type\":\"message\",\"text\":\"final invalid reviewed QA transcript\"}\n", "utf8");
  await upsertTeamRolePass(workspaceRoot, "proj", {
    workflowId: "team-invalid-reviewed-qa-scope",
    roleId: "lead_linguist_final",
    status: "running",
    sessionId: "la-team-team-invalid-reviewed-qa-scope-lead-linguist-final",
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    subagentRunId: runId,
    subagentAsyncDir: asyncDir,
    summary: "Lead Linguist Final is running.",
    transcriptRef: "session:invalid-reviewed-qa-scope",
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-invalid-reviewed-qa-scope",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-invalid-reviewed-qa-scope" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /reviewedDeliveryQa is server\/user-owned/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-invalid-reviewed-qa-scope")).completedStepIds.includes("lead_linguist_final"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-final-target",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
{
  const current = await readWorkflowArtifacts(workspaceRoot, "proj");
  await writeWorkflowArtifacts(workspaceRoot, "proj", {
    ...current,
    teamFindings: [...current.teamFindings, {
      id: "qa:clear",
      workflowId: "team-final-target",
      roleId: "delivery_manager",
      segmentId: "seg-1",
      severity: "advisory",
      type: "format",
      message: "Delivery QA has no blocker for this final target.",
      evidenceRefs: ["qa:clear"],
    }],
  });
}

{
  const runId = `la-status-final-target-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    startedAt: Date.UTC(2026, 0, 1),
    endedAt: Date.UTC(2026, 0, 1, 0, 1),
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    summary: "Final decision ready.",
    decisions: [{
      id: "final-decision-1",
      segmentId: "seg-1",
      decision: "accept",
      reason: "Best supported by TM and delivery QA.",
      findingIds: ["qa:clear"],
      finalTarget: "Final Event Time",
      evidenceRefs: ["tm:1", "qa:clear"],
    }],
  }), "utf8");
  await writeFile(join(asyncDir, "child.jsonl"), "{\"type\":\"message\",\"text\":\"final target transcript\"}\n", "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-final-target",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as {
    teamRolePasses: TeamRolePass[];
    teamDecisions: Array<{ id: string; decision: string; reason: string; evidenceRefs?: string[] }>;
    teamCandidateTargets: Array<{ id: string; roleId: string; segmentId: string; target: string; evidenceRefs: string[] }>;
  };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-final-target" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "completed");
  assert.equal(routeArtifacts.teamDecisions.find((row) => row.id === "final-decision-1")?.decision, "accept");
  assert.deepEqual(routeArtifacts.teamDecisions.find((row) => row.id === "final-decision-1")?.evidenceRefs, ["tm:1", "qa:clear"]);
  const finalTarget = routeArtifacts.teamCandidateTargets.find((row) => row.id === "final-decision-1:finalTarget");
  assert.equal(finalTarget?.roleId, "lead_linguist_final");
  assert.equal(finalTarget?.segmentId, "seg-1");
  assert.equal(finalTarget?.target, "Final Event Time");
  assert.deepEqual(finalTarget?.evidenceRefs, ["tm:1", "qa:clear"]);

  const ingestLedger = (await readQualityDecisionLedger(workspaceRoot, "proj")).filter((event) => event.workflowId === "team-final-target");
  assert.equal(ingestLedger.some((event) => event.kind === "team_finding" && event.findingId === "qa:clear"), true);
  assert.equal(ingestLedger.some((event) => event.kind === "team_decision" && event.findingId === "qa:clear" && event.actor === "lead_linguist"), true);

  const beforeUserDecision = await readWorkflowArtifacts(workspaceRoot, "proj");
  await writeWorkflowArtifacts(workspaceRoot, "proj", {
    ...beforeUserDecision,
    teamFindings: [...beforeUserDecision.teamFindings, {
      id: "legacy-user-decision-finding",
      workflowId: "team-final-target",
      roleId: "editor",
      segmentId: "seg-1",
      severity: "major",
      type: "accuracy",
      message: "Legacy projected finding awaiting a human decision.",
      evidenceRefs: ["tm:legacy"],
    }],
  });
  let decisionBody: Record<string, unknown> = {
    id: "user-decision-1",
    segmentId: "seg-1",
    decision: "accepted_risk",
    reason: "Reviewed against the source and accepted for this delivery.",
    findingIds: ["legacy-user-decision-finding"],
    evidenceRefs: ["tm:legacy"],
  };
  const decisionResponses: Array<{ status: number; data: unknown }> = [];
  const decisionDeps = {
    repoRoot: workspaceRoot,
    json: (_res: unknown, status: number, data: unknown) => decisionResponses.push({ status, data }),
    readBody: async () => decisionBody,
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  };
  assert.equal(await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "proj", "workflows", "team-final-target", "decisions",
  ], "proj", decisionDeps), true);
  assert.equal(decisionResponses.at(-1)?.status, 200);
  const userDecisionLedger = (await readQualityDecisionLedger(workspaceRoot, "proj")).filter((event) => event.workflowId === "team-final-target");
  assert.equal(userDecisionLedger.some((event) => event.kind === "team_finding" && event.findingId === "legacy-user-decision-finding"), true);
  assert.equal(userDecisionLedger.some((event) => event.kind === "team_decision" && event.findingId === "legacy-user-decision-finding" && event.actor === "user"), true);

  decisionBody = { decision: "accept", reason: "Invalid reference.", findingIds: ["missing-finding"] };
  await assert.rejects(handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "proj", "workflows", "team-final-target", "decisions",
  ], "proj", decisionDeps), /unknown finding id missing-finding/);
  decisionBody = { segmentId: "outside-batch", decision: "accept", reason: "Invalid segment.", findingIds: [] };
  await assert.rejects(handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "proj", "workflows", "team-final-target", "decisions",
  ], "proj", decisionDeps), /segmentId outside-batch is outside batch b1/);

}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-final-target-batch-qa",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
{
  const current = await readWorkflowArtifacts(workspaceRoot, "proj");
  await writeWorkflowArtifacts(workspaceRoot, "proj", {
    ...current,
    deliveryQaReports: [...current.deliveryQaReports, {
      reportId: "batch-qa-before-final",
      projectId: "proj",
      batchId: "b1",
      generatedAt: new Date(3).toISOString(),
      summary: { blockers: 0, warnings: 1, advisories: 0 },
      findings: [{
        id: "batch-qa-1",
        type: "length_ratio",
        severity: "warning",
        segmentId: "seg-1",
        source: "活动时间",
        target: "Event time",
        message: "Length looks acceptable after final edit.",
        evidence: ["batch-qa:before-final"],
      }],
    }],
  });
}

{
  const runId = `la-status-final-target-batch-qa-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    summary: "Final decision references existing batch QA.",
    decisions: [{
      id: "final-decision-batch-qa",
      segmentId: "seg-1",
      decision: "accept",
      reason: "Accepted after checking batch-level Delivery QA.",
      findingIds: ["batch-qa-before-final:batch-qa-1"],
      finalTarget: "Final Event Time",
      evidenceRefs: ["batch-qa-before-final:batch-qa-1"],
    }],
  }), "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-final-target-batch-qa",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as {
    teamRolePasses: TeamRolePass[];
    teamCandidateTargets: Array<{ id: string; target: string }>;
  };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-final-target-batch-qa" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "completed");
  assert.equal(routeArtifacts.teamCandidateTargets.find((row) => row.id === "final-decision-batch-qa:finalTarget")?.target, "Final Event Time");
  const batchQaLedger = (await readQualityDecisionLedger(workspaceRoot, "proj")).filter((event) => event.workflowId === "team-final-target-batch-qa");
  assert.equal(batchQaLedger.some((event) => event.kind === "delivery_finding" && event.findingId === "batch-qa-1"), true);
  assert.equal(batchQaLedger.some((event) => event.kind === "team_decision" && event.findingId === "batch-qa-1"), true);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-final-decision-no-findings",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-decision-no-findings-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    summary: "Final decision lacks finding linkage.",
    decisions: [{
      id: "final-decision-no-findings",
      segmentId: "seg-1",
      decision: "query",
      reason: "Needs client confirmation.",
      findingIds: [],
    }],
  }), "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-final-decision-no-findings",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-final-decision-no-findings" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /Role output rejected: decisions\[0\]\.findingIds must include at least one finding id/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-final-decision-unknown-finding",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-decision-unknown-finding-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    summary: "Final decision references a missing finding.",
    decisions: [{
      id: "final-decision-unknown-finding",
      segmentId: "seg-1",
      decision: "query",
      reason: "Needs client confirmation.",
      findingIds: ["missing-finding"],
    }],
  }), "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-final-decision-unknown-finding",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-final-decision-unknown-finding" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /Role output rejected: decisions\[0\]\.findingIds contains unknown finding id missing-finding/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-final-decision-cross-segment-finding",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-decision-cross-segment-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    summary: "Final decision references another segment's finding.",
    findings: [{
      id: "finding-seg-2",
      segmentId: "seg-2",
      severity: "major",
      type: "accuracy",
      message: "This finding belongs to seg-2.",
      evidenceRefs: ["tm:seg-2"],
    }],
    decisions: [{
      id: "final-decision-cross-segment",
      segmentId: "seg-1",
      decision: "query",
      reason: "This should not link across segments.",
      findingIds: ["finding-seg-2"],
    }],
  }), "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-final-decision-cross-segment-finding",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-final-decision-cross-segment-finding" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /Role output rejected: decisions\[0\]\.findingIds references finding-seg-2 from segment seg-2, not seg-1/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-final-decision-cross-segment-finding")).completedStepIds.includes("lead_linguist_final"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-final-target-no-evidence",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-target-no-evidence-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    summary: "Final target lacks evidence.",
    decisions: [{
      id: "final-decision-no-evidence",
      segmentId: "seg-1",
      decision: "accept",
      reason: "Looks right, but no evidence chain.",
      findingIds: ["finding-1"],
      finalTarget: "Final Event Time",
      evidenceRefs: "invalid",
    }],
  }), "utf8");
  await upsertTeamRolePass(workspaceRoot, "proj", {
    workflowId: "team-final-target-no-evidence",
    roleId: "lead_linguist_final",
    status: "running",
    sessionId: "la-team-team-final-target-no-evidence-lead-linguist-final",
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    subagentRunId: runId,
    subagentAsyncDir: asyncDir,
    summary: "Lead final is running.",
    transcriptRef: "session:lead-final-no-evidence",
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-final-target-no-evidence",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-final-target-no-evidence" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /Role output rejected: decisions\[0\]\.evidenceRefs must be an array of strings/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-final-target-bad",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-target-bad-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    summary: "Final decision missing segment.",
    decisions: [{
      id: "final-decision-bad",
      decision: "accept",
      reason: "Cannot apply this without a segment.",
      findingIds: ["finding-1"],
      finalTarget: "Final Event Time",
    }],
  }), "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-final-target-bad",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-final-target-bad" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /decisions\[0\]\.segmentId is required with finalTarget/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-final-target-reject-bad",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-target-reject-bad-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    summary: "Rejected decision should not carry a final target.",
    decisions: [{
      id: "final-decision-reject-bad",
      segmentId: "seg-1",
      decision: "reject",
      reason: "This should stay as a finding rejection, not a final target.",
      findingIds: ["finding-1"],
      finalTarget: "Final Event Time",
      evidenceRefs: ["finding-1"],
    }],
  }), "utf8");
  await upsertTeamRolePass(workspaceRoot, "proj", {
    workflowId: "team-final-target-reject-bad",
    roleId: "lead_linguist_final",
    status: "running",
    sessionId: "la-team-team-final-target-reject-bad-lead-linguist-final",
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    subagentRunId: runId,
    subagentAsyncDir: asyncDir,
    summary: "Lead Linguist Final is running.",
    transcriptRef: "session:final-target-reject-bad",
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-final-target-reject-bad",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-final-target-reject-bad" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /decisions\[0\]\.decision must accept finalTarget/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-reviewed-qa",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-bad-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    reviewedDeliveryQa: {
      reportId: "reviewed-final-qa-bad",
      findings: [{
        id: "qa-bad-1",
        reviewDecision: "fix_required",
        reviewedBy: "lead_linguist",
      }],
    },
  }), "utf8");
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-reviewed-qa",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-reviewed-qa" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /reviewedDeliveryQa is server\/user-owned/);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-reviewed-qa-evidence",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-bad-evidence-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    reviewedDeliveryQa: {
      reportId: "reviewed-final-qa-bad-evidence",
      reviewedAt: new Date(2).toISOString(),
      rawReport: {
        reportId: "raw-final-qa-bad-evidence",
        projectId: "proj",
        batchId: "b1",
        workflowId: "team-bad-reviewed-qa-evidence",
        generatedAt: new Date(1).toISOString(),
        summary: { blockers: 1, warnings: 0, advisories: 0 },
        findings: [{
          id: "qa-fix-1",
          type: "placeholder_mismatch",
          severity: "blocker",
          message: "Placeholder mismatch.",
          evidence: ["source:{0}", "target:"],
        }],
      },
      findings: [{
        id: "qa-fix-1",
        type: "placeholder_mismatch",
        severity: "blocker",
        message: "Placeholder mismatch.",
        reviewDecision: "fix_required",
        reviewReason: "Must fix before delivery.",
        reviewedBy: "lead_linguist",
      }],
    },
  }), "utf8");
  await upsertTeamRolePass(workspaceRoot, "proj", {
    workflowId: "team-bad-reviewed-qa-evidence",
    roleId: "lead_linguist_final",
    status: "running",
    sessionId: "la-team-team-bad-reviewed-qa-evidence-lead-linguist-final",
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    subagentRunId: runId,
    subagentAsyncDir: asyncDir,
    summary: "Lead Linguist Final is running.",
    transcriptRef: "session:final-bad-reviewed-qa-evidence",
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-reviewed-qa-evidence",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-reviewed-qa-evidence" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /reviewedDeliveryQa is server\/user-owned/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-bad-reviewed-qa-evidence")).completedStepIds.includes("lead_linguist_final"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-reviewed-qa-id",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-bad-review-id-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    reviewedDeliveryQa: {
      reportId: "reviewed-final-qa-bad-id",
      reviewedAt: new Date(2).toISOString(),
      rawReport: {
        reportId: "raw-final-qa-bad-id",
        projectId: "proj",
        batchId: "b1",
        workflowId: "team-bad-reviewed-qa-id",
        generatedAt: new Date(1).toISOString(),
        summary: { blockers: 1, warnings: 0, advisories: 0 },
        findings: [{
          id: "qa-fix-1",
          type: "placeholder_mismatch",
          severity: "blocker",
          message: "Placeholder mismatch.",
          evidence: ["source:{0}", "target:"],
        }],
      },
      findings: [{
        id: "qa-ghost",
        type: "placeholder_mismatch",
        severity: "blocker",
        message: "Placeholder mismatch.",
        evidence: ["source:{0}", "target:"],
        reviewDecision: "fix_required",
        reviewReason: "Must fix before delivery.",
        reviewedBy: "lead_linguist",
      }],
    },
  }), "utf8");
  await upsertTeamRolePass(workspaceRoot, "proj", {
    workflowId: "team-bad-reviewed-qa-id",
    roleId: "lead_linguist_final",
    status: "running",
    sessionId: "la-team-team-bad-reviewed-qa-id-lead-linguist-final",
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    subagentRunId: runId,
    subagentAsyncDir: asyncDir,
    summary: "Lead Linguist Final is running.",
    transcriptRef: "session:final-bad-reviewed-qa-id",
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-reviewed-qa-id",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-reviewed-qa-id" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /reviewedDeliveryQa is server\/user-owned/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-bad-reviewed-qa-id")).completedStepIds.includes("lead_linguist_final"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-reviewed-qa-severity",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-bad-review-severity-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    reviewedDeliveryQa: {
      reportId: "reviewed-final-qa-bad-severity",
      reviewedAt: new Date(2).toISOString(),
      rawReport: {
        reportId: "raw-final-qa-bad-severity",
        projectId: "proj",
        batchId: "b1",
        workflowId: "team-bad-reviewed-qa-severity",
        generatedAt: new Date(1).toISOString(),
        summary: { blockers: 1, warnings: 0, advisories: 0 },
        findings: [{
          id: "qa-fix-1",
          type: "placeholder_mismatch",
          severity: "blocker",
          message: "Placeholder mismatch.",
          evidence: ["source:{0}", "target:"],
        }],
      },
      findings: [{
        id: "qa-fix-1",
        type: "placeholder_mismatch",
        severity: "warning",
        message: "Placeholder mismatch.",
        evidence: ["source:{0}", "target:"],
        reviewDecision: "fix_required",
        reviewReason: "Must fix before delivery.",
        reviewedBy: "lead_linguist",
      }],
    },
  }), "utf8");
  await upsertTeamRolePass(workspaceRoot, "proj", {
    workflowId: "team-bad-reviewed-qa-severity",
    roleId: "lead_linguist_final",
    status: "running",
    sessionId: "la-team-team-bad-reviewed-qa-severity-lead-linguist-final",
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    subagentRunId: runId,
    subagentAsyncDir: asyncDir,
    summary: "Lead Linguist Final is running.",
    transcriptRef: "session:final-bad-reviewed-qa-severity",
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-reviewed-qa-severity",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-reviewed-qa-severity" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /reviewedDeliveryQa is server\/user-owned/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-bad-reviewed-qa-severity")).completedStepIds.includes("lead_linguist_final"), false);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-bad-reviewed-qa-segment",
  intent: "game_localization_team_run",
  includeReadiness: false,
});

{
  const runId = `la-status-final-bad-review-segment-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: "la-team-lead-linguist-final",
    outputFile: join(asyncDir, "output-0.log"),
    sessionFile: join(asyncDir, "child.jsonl"),
    steps: [{ agent: "la-team-lead-linguist-final", model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({
    reviewedDeliveryQa: {
      reportId: "reviewed-final-qa-bad-segment",
      reviewedAt: new Date(2).toISOString(),
      rawReport: {
        reportId: "raw-final-qa-bad-segment",
        projectId: "proj",
        batchId: "b1",
        workflowId: "team-bad-reviewed-qa-segment",
        generatedAt: new Date(1).toISOString(),
        summary: { blockers: 1, warnings: 0, advisories: 0 },
        findings: [{
          id: "qa-fix-1",
          type: "placeholder_mismatch",
          severity: "blocker",
          segmentId: "seg-1",
          source: "Use {0}",
          target: "Use",
          message: "Placeholder mismatch.",
          evidence: ["source:{0}", "target:"],
        }],
      },
      findings: [{
        id: "qa-fix-1",
        type: "placeholder_mismatch",
        severity: "blocker",
        segmentId: "seg-2",
        source: "Use {0}",
        target: "Use",
        message: "Placeholder mismatch.",
        evidence: ["source:{0}", "target:"],
        reviewDecision: "fix_required",
        reviewReason: "Must fix before delivery.",
        reviewedBy: "lead_linguist",
      }],
    },
  }), "utf8");
  await upsertTeamRolePass(workspaceRoot, "proj", {
    workflowId: "team-bad-reviewed-qa-segment",
    roleId: "lead_linguist_final",
    status: "running",
    sessionId: "la-team-team-bad-reviewed-qa-segment-lead-linguist-final",
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    subagentRunId: runId,
    subagentAsyncDir: asyncDir,
    summary: "Lead Linguist Final is running.",
    transcriptRef: "session:final-bad-reviewed-qa-segment",
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-bad-reviewed-qa-segment",
    "role-status",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "lead_linguist_final", subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  assert.equal(handled, true);
  const routeArtifacts = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  const finalPass = routeArtifacts.teamRolePasses.find((row) => row.workflowId === "team-bad-reviewed-qa-segment" && row.roleId === "lead_linguist_final");
  assert.equal(finalPass?.status, "failed");
  assert.match(finalPass?.summary ?? "", /reviewedDeliveryQa is server\/user-owned/);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-bad-reviewed-qa-segment")).completedStepIds.includes("lead_linguist_final"), false);
}

await assert.rejects(() => readSubagentAsyncStatus({
  asyncRoot: join(workspaceRoot, "safe-root"),
  asyncDir: tmpdir(),
}), /inside/);

{
  const asyncRoot = join(workspaceRoot, "status-race-root");
  const asyncDir = join(asyncRoot, "status-race-run");
  await mkdir(asyncDir, { recursive: true });
  setTimeout(() => {
    void writeFile(join(asyncDir, "status.json"), JSON.stringify({
      runId: "status-race-run",
      state: "running",
      agent: "la-team-producer",
      startedAt: Date.now(),
    }), "utf8");
  }, 25);
  const ready = await waitForSubagentAsyncStatus({ asyncRoot, asyncDir }, { timeoutMs: 500, pollMs: 5 });
  assert.equal(ready.status.runId, "status-race-run");
  assert.equal(ready.status.state, "running");
}

{
  const responses: Array<{ status: number; data: unknown }> = [];
  let stoppedInput: unknown;
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-smoke",
    "role-stop",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: "editor", reason: "user stop" }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    stopActiveRuns: async (input) => {
      stoppedInput = input;
      return { stopped: 1 };
    },
  });
  assert.equal(handled, true);
  assert.equal(responses.at(-1)?.status, 200);
  assert.equal((responses.at(-1)?.data as { stopped: number }).stopped, 1);
  assert.equal(
    (await readCatWorkflowRun(workspaceRoot, "proj", "team-smoke")).status,
    "stopped",
    "a stopped role must pause its sequential Team workflow until the user explicitly resumes it",
  );
  assert.deepEqual(stoppedInput, { projectId: "proj", workflowId: "team-smoke", roleId: "editor", reason: "user stop" });
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-stop-noop",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  let stoppedInput: unknown;
  const handled = await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api",
    "projects",
    "proj",
    "workflows",
    "team-stop-noop",
    "stop",
  ], "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ reason: "user stop" }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    stopActiveRuns: async (input) => {
      stoppedInput = input;
      return { stopped: 0 };
    },
  });
  assert.equal(handled, true);
  assert.equal(responses.at(-1)?.status, 200);
  assert.equal((responses.at(-1)?.data as { stopped: number }).stopped, 0);
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", "team-stop-noop")).status, "stopped");
  assert.deepEqual(stoppedInput, { projectId: "proj", workflowId: "team-stop-noop", roleId: undefined, reason: "user stop" });
}

const stopped = await stopCatWorkflowRun(workspaceRoot, "proj", "team-smoke", "user stop");
assert.equal(stopped.status, "stopped");

const scopedProjectId = "team-output-scope-proj";
const scopedBatchId = "team-output-scope-batch";
const scopedTaskId = "team-output-scope-task";
const scopedBatchDir = join(workspaceRoot, "data", "projects", scopedProjectId, "batches", scopedBatchId);
await mkdir(scopedBatchDir, { recursive: true });
await writeFile(join(scopedBatchDir, "batch.json"), `${JSON.stringify({
  schemaVersion: 1,
  format: "csv_paste",
  projectId: scopedProjectId,
  batchId: scopedBatchId,
  sourceFile: "scope.csv",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  tagReport: { totalSegments: 4, placeholderSegments: 1, masterMatchedSegments: 4, masterUnmatchedSegments: 0, replacedPlaceholders: 0, unresolvedPlaceholders: 0, unresolvedRuntimePlaceholders: 0, unresolvedTagPlaceholders: 0, tagCountMismatches: 0 },
  duplicateSourceGroups: [],
  segments: [
    { index: 1, id: "seg-in", source: "范围内", target: "", rawSource: "范围内", rawTarget: "", locked: false, status: "new", duplicateKey: "范围内", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
    { index: 2, id: "seg-locked", source: "锁定", target: "Locked", rawSource: "锁定", rawTarget: "Locked", locked: true, status: "confirmed", duplicateKey: "锁定", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
    { index: 3, id: "seg-out", source: "任务范围外", target: "", rawSource: "任务范围外", rawTarget: "", locked: false, status: "new", duplicateKey: "任务范围外", placeholderCount: 0, unresolvedPlaceholderCount: 0 },
    { index: 4, id: "seg-format", source: "获得 {0} 金币", target: "", rawSource: "获得 {0} 金币", rawTarget: "", locked: false, status: "new", duplicateKey: "获得 {0} 金币", placeholderCount: 1, unresolvedPlaceholderCount: 0 },
  ],
})}\n`, "utf8");
await createTaskWorkspace(workspaceRoot).create({
  projectId: scopedProjectId,
  taskId: scopedTaskId,
  title: "Scoped Team Task",
  intent: "Translate only the selected segments.",
  kind: "translation",
  scope: { batchId: scopedBatchId, segmentIds: ["seg-in", "seg-locked", "seg-format"], sourceLocale: "zh-CN", targetLocale: "en-US" },
});

let scopedRunSequence = 0;
async function scopedRoleOutputPass(input: {
  workflowId: string;
  roleId: (typeof TEAM_ROLE_IDS)[number];
  output: Record<string, unknown>;
}): Promise<TeamRolePass> {
  await createCatWorkflowRun(workspaceRoot, {
    projectId: scopedProjectId,
    taskId: scopedTaskId,
    batchId: scopedBatchId,
    workflowId: input.workflowId,
    intent: "game_localization_team_run",
    includeReadiness: false,
  });
  const runId = `la-team-output-scope-${++scopedRunSequence}-${Date.now()}`;
  const asyncDir = join(defaultSubagentAsyncRoot(), runId);
  await mkdir(asyncDir, { recursive: true });
  await writeFile(join(asyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId,
    mode: "single",
    state: "complete",
    agent: teamRoleAgentName(input.roleId),
    outputFile: join(asyncDir, "output-0.log"),
    steps: [{ agent: teamRoleAgentName(input.roleId), model: "deepseek/deepseek-v4-flash" }],
  }, null, 2), "utf8");
  await writeFile(join(asyncDir, "output-0.log"), JSON.stringify({ roleId: input.roleId, ...input.output }), "utf8");
  await upsertTeamRolePass(workspaceRoot, scopedProjectId, {
    workflowId: input.workflowId,
    roleId: input.roleId,
    status: "running",
    sessionId: `la-team-${input.workflowId}-${input.roleId}`,
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    subagentRunId: runId,
    subagentAsyncDir: asyncDir,
    summary: `${input.roleId} is running.`,
    transcriptRef: `session:${input.roleId}`,
  });
  const responses: Array<{ status: number; data: unknown }> = [];
  await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", scopedProjectId, "workflows", input.workflowId, "role-status",
  ], scopedProjectId, {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => responses.push({ status, data }),
    readBody: async () => ({ roleId: input.roleId, subagentRunId: runId }),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
  });
  const ledger = responses.at(-1)?.data as { teamRolePasses: TeamRolePass[] };
  return ledger.teamRolePasses.find((row) => row.workflowId === input.workflowId && row.roleId === input.roleId)!;
}

const outsideTaskCandidate = await scopedRoleOutputPass({
  workflowId: "team-output-outside-task-candidate",
  roleId: "translator",
  output: { summary: "Translated.", candidates: [{ segmentId: "seg-out", target: "Outside", function: "ui", notes: "Outside selected task.", evidenceRefs: [] }] },
});
assert.equal(outsideTaskCandidate.status, "failed");
assert.match(outsideTaskCandidate.summary, /candidates\[0\]\.segmentId seg-out is outside task team-output-scope-task scope/);

const lockedCandidate = await scopedRoleOutputPass({
  workflowId: "team-output-locked-candidate",
  roleId: "translator",
  output: { summary: "Translated.", candidates: [{ segmentId: "seg-locked", target: "Changed", function: "ui", notes: "Locked row.", evidenceRefs: [] }] },
});
assert.equal(lockedCandidate.status, "failed");
assert.match(lockedCandidate.summary, /candidates\[0\]\.segmentId seg-locked is locked/);

const inScopeCandidate = await scopedRoleOutputPass({
  workflowId: "team-output-in-scope-candidate",
  roleId: "translator",
  output: { summary: "Translated.", candidates: [{ id: "in-scope-candidate", segmentId: "seg-in", target: "In Scope", function: "ui", notes: "Selected row.", evidenceRefs: [] }] },
});
assert.equal(inScopeCandidate.status, "completed");

const unsafeCandidate = await scopedRoleOutputPass({
  workflowId: "team-output-unsafe-candidate",
  roleId: "translator",
  output: { summary: "Translated.", candidates: [{ segmentId: "seg-format", target: "Gain Gold", function: "ui", evidenceRefs: [] }] },
});
assert.equal(unsafeCandidate.status, "failed");
assert.match(unsafeCandidate.summary, /candidates\[0\].*PLACEHOLDER_SIGNATURE_MISMATCH/);

const outsideBatchQuery = await scopedRoleOutputPass({
  workflowId: "team-output-outside-batch-query",
  roleId: "producer",
  output: { summary: "Need clarification.", queries: [{ segmentId: "seg-missing", message: "Unknown row.", severity: "major", evidenceRefs: [] }] },
});
assert.equal(outsideBatchQuery.status, "failed");
assert.match(outsideBatchQuery.summary, /queries\[0\]\.segmentId seg-missing is outside batch team-output-scope-batch/);

const outsideTaskFinding = await scopedRoleOutputPass({
  workflowId: "team-output-outside-task-finding",
  roleId: "editor",
  output: { summary: "Reviewed.", findings: [{ segmentId: "seg-out", severity: "major", type: "accuracy", message: "Outside selected task.", evidenceRefs: [] }] },
});
assert.equal(outsideTaskFinding.status, "failed");
assert.match(outsideTaskFinding.summary, /findings\[0\]\.segmentId seg-out is outside task/);

const outsideTaskPreLqa = await scopedRoleOutputPass({
  workflowId: "team-output-outside-task-pre-lqa",
  roleId: "pre_lqa_reviewer",
  output: { summary: "Pre-LQA reviewed.", preLqaRisks: [{ segmentId: "seg-out", severity: "major", message: "Outside selected task.", evidenceRefs: [] }] },
});
assert.equal(outsideTaskPreLqa.status, "failed");
assert.match(outsideTaskPreLqa.summary, /preLqaRisks\[0\]\.segmentId seg-out is outside task/);

const qaFinding = { id: "qa-out", type: "format", severity: "warning", segmentId: "seg-out", message: "Outside selected task.", evidence: [] };
const outsideTaskDeliveryQa = await scopedRoleOutputPass({
  workflowId: "team-output-outside-task-delivery-qa",
  roleId: "delivery_manager",
  output: {
    summary: "Delivery QA complete.",
    deliveryQa: {
      reportId: "qa-out-report",
      projectId: scopedProjectId,
      batchId: scopedBatchId,
      workflowId: "team-output-outside-task-delivery-qa",
      generatedAt: "2026-07-11T00:00:00.000Z",
      findings: [qaFinding],
      summary: { blockers: 0, warnings: 1, advisories: 0 },
    },
  },
});
assert.equal(outsideTaskDeliveryQa.status, "failed");
assert.match(outsideTaskDeliveryQa.summary, /deliveryQa is not allowed for delivery_manager/);

const outsideTaskReviewedQa = await scopedRoleOutputPass({
  workflowId: "team-output-outside-task-reviewed-qa",
  roleId: "lead_linguist_final",
  output: {
    summary: "QA reviewed.",
    reviewedDeliveryQa: {
      reportId: "qa-out-review",
      reviewedAt: "2026-07-11T00:01:00.000Z",
      rawReport: {
        reportId: "qa-out-raw",
        projectId: scopedProjectId,
        batchId: scopedBatchId,
        workflowId: "team-output-outside-task-reviewed-qa",
        generatedAt: "2026-07-11T00:00:00.000Z",
        findings: [qaFinding],
        summary: { blockers: 0, warnings: 1, advisories: 0 },
      },
      findings: [{ ...qaFinding, reviewDecision: "query", reviewReason: "Ask the client.", reviewedBy: "lead_linguist" }],
    },
  },
});
assert.equal(outsideTaskReviewedQa.status, "failed");
assert.match(outsideTaskReviewedQa.summary, /reviewedDeliveryQa is server\/user-owned/);

const lockedFinalTarget = await scopedRoleOutputPass({
  workflowId: "team-output-locked-final-target",
  roleId: "lead_linguist_final",
  output: {
    summary: "Final decision.",
    findings: [{ id: "locked-finding", segmentId: "seg-locked", severity: "minor", type: "style", message: "Locked row can be reported.", evidenceRefs: [] }],
    decisions: [{ id: "locked-decision", segmentId: "seg-locked", decision: "accept", reason: "Attempted final target.", findingIds: ["locked-finding"], finalTarget: "Changed", evidenceRefs: [] }],
  },
});
assert.equal(lockedFinalTarget.status, "failed");
assert.match(lockedFinalTarget.summary, /decisions\[0\]\.segmentId seg-locked is locked/);

const visiblePreflightTaskId = "team-visible-preflight-task";
const visiblePreflightWorkflowId = "team-visible-preflight";
await createTaskWorkspace(workspaceRoot).create({
  projectId: "proj",
  taskId: visiblePreflightTaskId,
  title: "Visible Team preflight",
  intent: "Prepare an adaptive Team plan before model execution.",
  kind: "translation",
  scope: { batchId: "b1", segmentIds: [], sourceLocale: "zh-CN", targetLocale: "en-US" },
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  const routeDeps = {
    repoRoot: workspaceRoot,
    json: (_res: unknown, status: number, data: unknown) => responses.push({ status, data }),
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  };
  await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "proj", "workflows",
  ], "proj", {
    ...routeDeps,
    readBody: async () => ({
      taskId: visiblePreflightTaskId,
      batchId: "b1",
      workflowId: visiblePreflightWorkflowId,
      intent: "game_localization_team_run",
      includeReadiness: false,
    }),
  });
  let snapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: visiblePreflightTaskId });
  assert.equal(snapshot.runs.find((row) => row.id === visiblePreflightWorkflowId)?.stopAvailable, false, "a prepared Team task must not expose Stop before execution");

  responses.length = 0;
  await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "proj", "workflows", visiblePreflightWorkflowId, "preflight",
  ], "proj", { ...routeDeps, readBody: async () => ({}) });
  const plan = responses.at(-1)?.data as { selectedRoleIds: string[]; readiness: { status: string } };
  snapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: visiblePreflightTaskId });
  const run = snapshot.runs.find((row) => row.id === visiblePreflightWorkflowId)!;
  const mainThread = snapshot.agentThreads.find((row) => row.id === `${visiblePreflightWorkflowId}.main`)!;
  assert.equal(run.stopAvailable, false);
  assert.equal(run.status, plan.readiness.status === "ready" ? "awaiting_input" : "waiting");
  assert.deepEqual(
    mainThread.childThreadIds,
    plan.selectedRoleIds.map((roleId) => `${visiblePreflightWorkflowId}.${roleId}`),
    "preflight must make every selected Agent conversation visible before execution",
  );
  assert.equal(snapshot.agentThreads.find((row) => row.identity.roleId === "loc_engineer_gate")?.identity.disclosureLabel, "System");
  const selectedModelRoleId = plan.selectedRoleIds.find((roleId) => !["loc_engineer_gate", "delivery_manager"].includes(roleId));
  if (selectedModelRoleId) {
    assert.equal(snapshot.agentThreads.find((row) => row.identity.roleId === selectedModelRoleId)?.identity.disclosureLabel, "Agent");
    assert.equal(snapshot.agentThreads.find((row) => row.identity.roleId === selectedModelRoleId)?.status, "waiting");
  } else {
    assert.ok(plan.selectedRoleIds.every((roleId) => ["loc_engineer_gate", "delivery_manager"].includes(roleId)), "a no-work preflight may remain deterministic-only");
  }
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-launch-race",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
{
  const preflightResponses: Array<{ status: number; data: unknown }> = [];
  const baseDeps = {
    repoRoot: workspaceRoot,
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  };
  await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "proj", "workflows", "team-launch-race", "preflight",
  ], "proj", {
    ...baseDeps,
    json: (_res, status, data) => preflightResponses.push({ status, data }),
    readBody: async () => ({ forceAllRoles: true }),
  });
  const preflightPlan = preflightResponses.at(-1)?.data as { planHash: string; readiness: { status: string; blockers: string[] } };
  assert.equal(preflightPlan.readiness.status, "ready", preflightPlan.readiness.blockers.join("; "));
  const planHash = preflightPlan.planHash;
  let spawnCount = 0;
  const launchResponses: Array<{ status: number; data: unknown }> = [];
  const spawnSubagentRun = async (_projectId: string, _workflowId: string, roleId: (typeof TEAM_ROLE_IDS)[number]) => {
    spawnCount += 1;
    const runId = `team-launch-race-${spawnCount}`;
    const asyncDir = join(defaultSubagentAsyncRoot(), runId);
    await mkdir(asyncDir, { recursive: true });
    await writeFile(join(asyncDir, "status.json"), JSON.stringify({
      lifecycleArtifactVersion: 1,
      runId,
      mode: "single",
      state: "running",
      agent: teamRoleAgentName(roleId),
      startedAt: Date.now(),
      outputFile: join(asyncDir, "output-0.log"),
      steps: [{ agent: teamRoleAgentName(roleId), model: "deepseek/deepseek-v4-flash" }],
    }), "utf8");
    return { details: { asyncDir } };
  };
  const startRequest = () => handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "proj", "workflows", "team-launch-race", "start",
  ], "proj", {
    ...baseDeps,
    json: (_res, status, data) => launchResponses.push({ status, data }),
    readBody: async () => ({ execute: true, forceAllRoles: true, planHash }),
    spawnSubagentRun,
  });
  const results = await Promise.allSettled([startRequest(), startRequest()]);
  assert.equal(spawnCount, 1, "concurrent start requests must claim and spawn one role exactly once");
  assert.equal(results.some((result) => result.status === "fulfilled"), true);
  assert.equal(launchResponses.some((response) => response.status === 200 || response.status === 202), true);
}

await createCatWorkflowRun(workspaceRoot, {
  projectId: "proj",
  batchId: "b1",
  workflowId: "team-background-continuation",
  intent: "game_localization_team_run",
  includeReadiness: false,
});
{
  let spawnCount = 0;
  await continueTeamWorkflowUntilPause({
    projectId: "proj",
    workflowId: "team-background-continuation",
    selectedRoleIds: ["lead_linguist_setup"],
    deps: {
      repoRoot: workspaceRoot,
      json: () => undefined,
      readBody: async () => ({}),
      requireString: (value, label) => {
        if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
        return value;
      },
      optionalString: (value) => typeof value === "string" && value ? value : undefined,
      optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
      optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
      spawnSubagentRun: async (_projectId, _workflowId, roleId) => {
        spawnCount += 1;
        const runId = `team-background-${spawnCount}`;
        const asyncDir = join(defaultSubagentAsyncRoot(), runId);
        const outputFile = join(asyncDir, "output-0.log");
        await mkdir(asyncDir, { recursive: true });
        await writeFile(outputFile, JSON.stringify({
          summary: "Lead strategy prepared.",
          strategy: {
            authorityOrder: ["locked", "termbase", "style guide", "expert judgment"],
            voiceRules: ["Preserve the confirmed race voices."],
            genreRules: [{ genre: "item_description", strategy: "Review puns against visual assets." }],
            uiRules: ["Keep variables and tags intact."],
            termRules: ["Use reviewed exact TM as evidence."],
            queryRules: ["Escalate only material ambiguity."],
            mustNotDo: ["Do not overwrite locked content."],
          },
          findings: [{
            id: "strategy-info",
            severity: "info",
            type: "style",
            message: "Reviewed TM remains the baseline for this pass.",
            evidenceRefs: ["tm:reviewed"],
          }],
        }), "utf8");
        await writeFile(join(asyncDir, "status.json"), JSON.stringify({
          lifecycleArtifactVersion: 1,
          runId,
          mode: "single",
          state: "complete",
          agent: teamRoleAgentName(roleId),
          startedAt: Date.now() - 50,
          endedAt: Date.now(),
          outputFile,
          steps: [{ agent: teamRoleAgentName(roleId), model: "deepseek/deepseek-v4-flash" }],
        }), "utf8");
        return { details: { asyncDir } };
      },
    },
  });
  assert.equal(spawnCount, 1);
  const completed = await readCatWorkflowRun(workspaceRoot, "proj", "team-background-continuation");
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedStepIds.includes("lead_linguist_setup"), true);
  const artifacts = await readWorkflowArtifacts(workspaceRoot, "proj");
  assert.equal(artifacts.teamFindings.find((row) => row.id === "strategy-info")?.severity, "advisory");
}

const queryTaskId = "team-query-decision-task";
const queryWorkflowId = "team-query-decision";
await createTaskWorkspace(workspaceRoot).create({
  projectId: "proj",
  taskId: queryTaskId,
  title: "Team query decision",
  intent: "Pause on an Agent question and resume with the user's answer.",
  kind: "translation",
  scope: { batchId: "b1", segmentIds: ["seg-1"], sourceLocale: "zh-CN", targetLocale: "en-US" },
});
{
  const workflowResponses: Array<{ status: number; data: unknown }> = [];
  const baseDeps = {
    repoRoot: workspaceRoot,
    json: (_res: unknown, status: number, data: unknown) => workflowResponses.push({ status, data }),
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  };
  await handleWorkflowRoute({ method: "POST" } as never, {} as never, [
    "api", "projects", "proj", "workflows",
  ], "proj", {
    ...baseDeps,
    readBody: async () => ({
      taskId: queryTaskId,
      batchId: "b1",
      workflowId: queryWorkflowId,
      intent: "game_localization_team_run",
      includeReadiness: false,
    }),
  });
  assert.equal(workflowResponses.at(-1)?.status, 200);

  let spawnCount = 0;
  const observedRoleTasks: string[] = [];
  const spawnSubagentRun = async (
    _projectId: string,
    _workflowId: string,
    roleId: (typeof TEAM_ROLE_IDS)[number],
    request: { params: { task: string } },
  ) => {
    spawnCount += 1;
    observedRoleTasks.push(request.params.task);
    const runId = `${queryWorkflowId}-attempt-${spawnCount}`;
    const asyncDir = join(defaultSubagentAsyncRoot(), runId);
    const outputFile = join(asyncDir, "output-0.log");
    await mkdir(asyncDir, { recursive: true });
    const output = spawnCount === 1
      ? {
          summary: "The item name is ambiguous.",
          queries: [{
            id: "query-1",
            segmentId: "seg-1",
            severity: "major",
            message: "Which name should the item use?",
            evidenceRefs: ["asset:item-1"],
          }],
        }
      : {
          summary: "Clarification applied.",
          brief: {
            projectGoal: "Use the user's approved item name.",
            scope: [],
            knownAssets: [],
            missingInputs: [],
            risks: [],
            handoffNotes: [],
          },
        };
    await writeFile(outputFile, JSON.stringify(output), "utf8");
    await writeFile(join(asyncDir, "status.json"), JSON.stringify({
      lifecycleArtifactVersion: 1,
      runId,
      mode: "single",
      state: "complete",
      agent: teamRoleAgentName(roleId),
      startedAt: Date.now() - 50,
      endedAt: Date.now(),
      outputFile,
      steps: [{ agent: teamRoleAgentName(roleId), model: "deepseek/deepseek-v4-flash" }],
    }), "utf8");
    return { details: { asyncDir } };
  };
  const continuationDeps = { ...baseDeps, spawnSubagentRun };

  await continueTeamWorkflowUntilPause({
    projectId: "proj",
    workflowId: queryWorkflowId,
    selectedRoleIds: ["producer"],
    deps: continuationDeps,
  });
  assert.equal(spawnCount, 1);
  let snapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: queryTaskId });
  assert.equal(snapshot.runs.find((row) => row.id === queryWorkflowId)?.status, "awaiting_input");
  assert.equal(snapshot.agentThreads.find((row) => row.id === `${queryWorkflowId}.producer`)?.status, "waiting");
  const queryArtifact = snapshot.artifacts.find((row) => row.id === "team-query:query-1");
  assert.equal(queryArtifact?.type, "agent_query");
  assert.deepEqual(queryArtifact?.availableDecisions, ["answer"]);
  const queryDecision = snapshot.decisions.find((row) => row.id === "task-decision:team-query:query-1");
  assert.equal(queryDecision?.kind, "answer");
  assert.equal(queryDecision?.status, "required");
  assert.equal(queryDecision?.options[0]?.action, "answer");

  const answerResponses: Array<{ status: number; data: unknown }> = [];
  const answerUrl = new URL(`http://127.0.0.1/api/projects/proj/tasks/${queryTaskId}/decisions/${encodeURIComponent(queryDecision!.id)}`);
  await handleTaskWorkspaceRoute({ method: "POST" } as never, {} as never, answerUrl, answerUrl.pathname.split("/").filter(Boolean), "proj", {
    repoRoot: workspaceRoot,
    json: (_res, status, data) => answerResponses.push({ status, data }),
    readBody: async () => ({ optionId: "answer", reason: "Use the approved item name: Moonlit Relic." }),
  });
  assert.equal(answerResponses.at(-1)?.status, 200, JSON.stringify(answerResponses.at(-1)?.data));
  snapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: queryTaskId });
  assert.equal(snapshot.decisions.find((row) => row.id === queryDecision!.id)?.status, "recorded");

  await continueTeamWorkflowUntilPause({
    projectId: "proj",
    workflowId: queryWorkflowId,
    selectedRoleIds: ["producer"],
    deps: continuationDeps,
  });
  assert.equal(spawnCount, 2, "Answering a query must resume the same role exactly once.");
  assert.match(observedRoleTasks[1] ?? "", /Use the approved item name: Moonlit Relic\./);
  snapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: queryTaskId });
  assert.equal(snapshot.runs.find((row) => row.id === queryWorkflowId)?.status, "complete");
  assert.equal(snapshot.agentThreads.find((row) => row.id === `${queryWorkflowId}.producer`)?.status, "complete");
  assert.equal((await readWorkflowArtifacts(workspaceRoot, "proj")).teamRolePasses.find(
    (row) => row.workflowId === queryWorkflowId && row.roleId === "producer",
  )?.status, "completed");
}

const resumableTaskId = "team-resume-stopped-role-task";
const resumableWorkflowId = "team-resume-stopped-role";
await createTaskWorkspace(workspaceRoot).create({
  projectId: "proj",
  taskId: resumableTaskId,
  title: "Resume stopped Team role",
  intent: "Resume the exact specialist that was stopped.",
  kind: "translation",
  scope: { batchId: "b1", segmentIds: [], sourceLocale: "zh-CN", targetLocale: "en-US" },
});
{
  const responses: Array<{ status: number; data: unknown }> = [];
  let body: Record<string, unknown> = {
    taskId: resumableTaskId,
    batchId: "b1",
    workflowId: resumableWorkflowId,
    intent: "game_localization_team_run",
    includeReadiness: false,
  };
  const deps = {
    repoRoot: workspaceRoot,
    json: (_res: unknown, status: number, data: unknown) => responses.push({ status, data }),
    readBody: async () => body,
    requireString: (value: unknown, label: string) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value: unknown) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value: unknown) => value === undefined ? undefined : Boolean(value),
  };
  await handleWorkflowRoute({ method: "POST" } as never, {} as never, ["api", "projects", "proj", "workflows"], "proj", deps);
  body = { forceAllRoles: true };
  responses.length = 0;
  await handleWorkflowRoute(
    { method: "POST" } as never,
    {} as never,
    ["api", "projects", "proj", "workflows", resumableWorkflowId, "preflight"],
    "proj",
    deps,
  );
  const planHash = (responses.at(-1)?.data as { planHash: string }).planHash;
  await upsertTeamRolePass(workspaceRoot, "proj", {
    workflowId: resumableWorkflowId,
    roleId: "producer",
    status: "stopped",
    sessionId: `la-team-${resumableWorkflowId}-producer`,
    inputArtifactRefs: [],
    outputArtifactRefs: [],
    summary: "Stopped by user.",
    transcriptRef: `session:la-team-${resumableWorkflowId}-producer`,
  });
  let spawnedRole: string | undefined;
  let resumedSubagentRunId: string | undefined;
  let resumedAsyncDir: string | undefined;
  body = { execute: true, forceAllRoles: true, planHash };
  responses.length = 0;
  await handleWorkflowRoute(
    { method: "POST" } as never,
    {} as never,
    ["api", "projects", "proj", "workflows", resumableWorkflowId, "resume"],
    "proj",
    {
      ...deps,
      spawnSubagentRun: async (_projectId: string, _workflowId: string, roleId: (typeof TEAM_ROLE_IDS)[number]) => {
        spawnedRole = roleId;
        const runId = `${resumableWorkflowId}-${roleId}-resumed`;
        const asyncDir = join(defaultSubagentAsyncRoot(), runId);
        resumedSubagentRunId = runId;
        resumedAsyncDir = asyncDir;
        await mkdir(asyncDir, { recursive: true });
        await writeFile(join(asyncDir, "status.json"), JSON.stringify({
          lifecycleArtifactVersion: 1,
          runId,
          mode: "single",
          state: "running",
          agent: teamRoleAgentName(roleId),
          startedAt: Date.now(),
          totalCost: { inputTokens: 120, outputTokens: 30, costUsd: 0.0042 },
          outputFile: join(asyncDir, "output-0.log"),
          steps: [{ agent: teamRoleAgentName(roleId), status: "running", model: "deepseek/deepseek-v4-flash" }],
        }), "utf8");
        return { details: { asyncDir } };
      },
    },
  );
  assert.equal(spawnedRole, "producer", "Resume must restart the stopped specialist instead of skipping to the next role.");
  let snapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: resumableTaskId });
  assert.equal(snapshot.runs.find((row) => row.id === resumableWorkflowId)?.status, "active");
  const projectedUsage = snapshot.runs.find((row) => row.id === resumableWorkflowId)?.usage;
  assert.equal(projectedUsage?.inputTokens, 120);
  assert.equal(projectedUsage?.outputTokens, 30);
  assert.equal(projectedUsage?.totalTokens, 150);
  assert.equal(projectedUsage?.costUSD, 0.0042);
  assert.equal(projectedUsage?.modelCalls, 1);
  assert.equal(snapshot.agentThreads.find((row) => row.id === `${resumableWorkflowId}.producer`)?.status, "active");

  body = { roleId: "producer", reason: "Pause for review." };
  responses.length = 0;
  await handleWorkflowRoute(
    { method: "POST" } as never,
    {} as never,
    ["api", "projects", "proj", "workflows", resumableWorkflowId, "role-stop"],
    "proj",
    {
      ...deps,
      stopActiveRuns: async () => ({ stopped: 1, reason: "Pause for review.", errors: [] }),
    },
  );
  snapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: resumableTaskId });
  const pausedRun = snapshot.runs.find((row) => row.id === resumableWorkflowId)!;
  assert.equal(pausedRun.status, "stopped", "Stopping a sequential child role must pause the owning Team run.");
  assert.equal(pausedRun.stopAvailable, false);
  assert.equal(pausedRun.resumeAvailable, true);
  assert.equal(snapshot.agentThreads.find((row) => row.id === `${resumableWorkflowId}.main`)?.status, "stopped");
  assert.equal((await readCatWorkflowRun(workspaceRoot, "proj", resumableWorkflowId)).status, "stopped");

  body = { roleId: "producer", subagentRunId: resumedSubagentRunId, asyncDir: resumedAsyncDir };
  responses.length = 0;
  await handleWorkflowRoute(
    { method: "POST" } as never,
    {} as never,
    ["api", "projects", "proj", "workflows", resumableWorkflowId, "role-status"],
    "proj",
    deps,
  );
  snapshot = await createTaskWorkspace(workspaceRoot).open({ projectId: "proj", taskId: resumableTaskId });
  assert.equal(snapshot.agentThreads.find((row) => row.id === `${resumableWorkflowId}.producer`)?.status, "stopped", "late role polling must not reactivate a child after the Team run stopped");
  const stoppedArtifacts = await readWorkflowArtifacts(workspaceRoot, "proj");
  assert.equal(stoppedArtifacts.teamRolePasses.find((row) => row.workflowId === resumableWorkflowId && row.roleId === "producer")?.status, "stopped");
}

{
  const taskId = "specialist-followup-task";
  const sourceWorkflowId = "specialist-followup-source";
  const workspace = createTaskWorkspace(workspaceRoot);
  await workspace.create({
    projectId: "proj",
    taskId,
    title: "Specialist follow-up",
    intent: "Ask the Producer to revisit one point.",
    kind: "review",
    scope: { batchId: "b1", segmentIds: [], sourceLocale: "zh-CN", targetLocale: "en-US" },
  });
  await createCatWorkflowRun(workspaceRoot, {
    projectId: "proj",
    taskId,
    batchId: "b1",
    workflowId: sourceWorkflowId,
    intent: "game_localization_team_run",
    includeReadiness: false,
  });
  const sourceMainThreadId = `${sourceWorkflowId}.main`;
  const sourceRoleThreadId = `${sourceWorkflowId}.producer`;
  await workspace.appendGenerated({
    projectId: "proj",
    taskId,
    runId: sourceWorkflowId,
    events: [
      {
        type: "run_upsert",
        agentThreadId: sourceMainThreadId,
        run: {
          id: sourceWorkflowId,
          taskId,
          mode: "team",
          status: "complete",
          rootAgentThreadId: sourceMainThreadId,
          planHash: "source-plan",
          estimatedCalls: 1,
          modelRoutes: { producer: "deepseek/deepseek-v4-flash" },
          startedAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:01:00.000Z",
          completedAt: "2026-07-14T00:01:00.000Z",
          stopAvailable: false,
          resumeAvailable: false,
        },
      },
      {
        type: "thread_upsert",
        agentThreadId: sourceMainThreadId,
        thread: {
          id: sourceMainThreadId,
          taskId,
          runId: sourceWorkflowId,
          parentThreadId: null,
          identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "Main Agent", disclosureLabel: "Agent" },
          status: "complete",
          canReceiveUserMessage: true,
          handoffSummary: null,
          latestActivityId: null,
          childThreadIds: [sourceRoleThreadId],
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:01:00.000Z",
        },
      },
      {
        type: "thread_upsert",
        agentThreadId: sourceRoleThreadId,
        thread: {
          id: sourceRoleThreadId,
          taskId,
          runId: sourceWorkflowId,
          parentThreadId: sourceMainThreadId,
          identity: { kind: "specialist", roleId: "producer", displayName: "Producer", roleLabel: "Producer", disclosureLabel: "Agent" },
          status: "complete",
          canReceiveUserMessage: true,
          handoffSummary: "The brief is ready, but the playful voice needs another look.",
          latestActivityId: "source-producer-handoff",
          childThreadIds: [],
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:01:00.000Z",
        },
      },
      {
        type: "activity_append",
        agentThreadId: sourceRoleThreadId,
        activity: {
          id: "source-producer-handoff",
          taskId,
          runId: sourceWorkflowId,
          agentThreadId: sourceRoleThreadId,
          seq: 1,
          type: "handoff",
          status: "done",
          actor: { kind: "agent", id: "producer", displayName: "Producer", agentThreadId: sourceRoleThreadId },
          title: "Producer handoff",
          body: "Keep the playful voice visible in the final brief.",
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
          createdAt: "2026-07-14T00:01:00.000Z",
          updatedAt: "2026-07-14T00:01:00.000Z",
        },
      },
    ],
  });

  let spawnedPrompt = "";
  let followUpSubagentRunId = "";
  let followUpAsyncDir = "";
  const followUp = await startSpecialistFollowUp({
    projectId: "proj",
    taskId,
    sourceThreadId: sourceRoleThreadId,
    message: "Please make the voice guidance more actionable.",
    activityId: "source-producer-handoff",
  }, {
    repoRoot: workspaceRoot,
    json: () => undefined,
    readBody: async () => ({}),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((row): row is string => typeof row === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    spawnSubagentRun: async (_projectId, workflowId, roleId, request) => {
      spawnedPrompt = request.params.task;
      const runId = `${workflowId}-${roleId}-follow-up`;
      const asyncDir = join(defaultSubagentAsyncRoot(), runId);
      followUpSubagentRunId = runId;
      followUpAsyncDir = asyncDir;
      await mkdir(asyncDir, { recursive: true });
      await writeFile(join(asyncDir, "status.json"), JSON.stringify({
        lifecycleArtifactVersion: 1,
        runId,
        mode: "single",
        state: "running",
        agent: teamRoleAgentName(roleId),
        startedAt: Date.UTC(2026, 6, 14, 0, 2),
        outputFile: join(asyncDir, "output-0.log"),
        totalTokens: { input: 120, output: 40, total: 160 },
        totalCost: { inputTokens: 120, outputTokens: 40, costUsd: 0.003 },
        steps: [{ agent: teamRoleAgentName(roleId), status: "running", model: "deepseek/deepseek-v4-flash" }],
      }), "utf8");
      return { details: { asyncDir } };
    },
  });
  assert.equal(followUp.roleId, "producer");
  assert.notEqual(followUp.runId, sourceWorkflowId, "A specialist follow-up must create a new Run instead of rewriting history.");
  assert.match(spawnedPrompt, /Please make the voice guidance more actionable/);
  assert.match(spawnedPrompt, /Keep the playful voice visible in the final brief/);
  assert.match(spawnedPrompt, /scoped follow-up, not a fresh full-role pass/);
  assert.match(spawnedPrompt, /findings, queries, candidateTargets, and candidates must all be empty/);
  await writeFile(join(followUpAsyncDir, "output-0.log"), JSON.stringify({
    summary: "Voice guidance clarified.",
    brief: {
      projectGoal: "Keep the game voice actionable.",
      scope: ["Current Task scope"],
      knownAssets: [],
      missingInputs: [],
      risks: [],
      handoffNotes: ["Use playful verbs and concise UI phrasing."],
    },
  }), "utf8");
  await writeFile(join(followUpAsyncDir, "status.json"), JSON.stringify({
    lifecycleArtifactVersion: 1,
    runId: followUpSubagentRunId,
    mode: "single",
    state: "complete",
    agent: "la-team-producer",
    startedAt: Date.UTC(2026, 6, 14, 0, 2),
    endedAt: Date.UTC(2026, 6, 14, 0, 3),
    outputFile: join(followUpAsyncDir, "output-0.log"),
    totalTokens: { input: 120, output: 40, total: 160 },
    totalCost: { inputTokens: 120, outputTokens: 40, costUsd: 0.003 },
    steps: [{ agent: "la-team-producer", status: "complete", model: "deepseek/deepseek-v4-flash" }],
  }), "utf8");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await workspace.open({ projectId: "proj", taskId });
    if (current.runs.find((row) => row.id === followUp.runId)?.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const final = await workspace.open({ projectId: "proj", taskId });
  assert.equal(final.runs.find((row) => row.id === sourceWorkflowId)?.status, "complete");
  assert.equal(final.runs.find((row) => row.id === followUp.runId)?.status, "complete");
  assert.equal(final.activities.find((row) => row.id === `${followUp.runId}.plan`)?.body, "1. Follow up with Producer");
  assert.equal(final.activities.some((row) => row.runId === followUp.runId && row.agentThreadId === followUp.threadId && row.type === "message" && row.body === "Please make the voice guidance more actionable."), true);
  const followUpThread = final.agentThreads.find((row) => row.id === followUp.threadId);
  assert.equal(followUpThread?.identity.roleId, "producer");
  assert.equal(followUpThread?.handoffSummary, "Voice guidance clarified.", "The parsed specialist answer must be the canonical thread handoff, not the generic child-process status.");
  assert.equal(final.activities.some((row) =>
    row.runId === followUp.runId &&
    row.agentThreadId === followUp.threadId &&
    row.type === "handoff" &&
    row.body?.includes("Voice guidance clarified.")
  ), true, "The specialist answer must be visible as a final handoff activity instead of only inside progress trace.");
}

console.log("team_workflow_foundation tests passed");
