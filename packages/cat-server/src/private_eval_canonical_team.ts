import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createCatWorkflowRun,
  createProjectManifest,
  createTaskWorkspace,
  DETERMINISTIC_TEAM_ROLE_IDS,
  importCsvBatch,
  readCatWorkflowRun,
  readWorkflowArtifacts,
  stopCatWorkflowRun,
  TEAM_ROLE_IDS,
  type PrivateEvalExecutionManifest,
  type PrivateEvalRunOutput,
  type PrivateEvalSegment,
  type PrivateEvalTeamRoleLifecycleEvent,
  type PrivateEvalThinkingLevel,
  type PrivateEvalUsage,
  type TeamRoleId,
  type TeamRolePass,
  type TeamRoleProfile,
} from "@linguist-agent/cat-data";
import type { ActiveAgentRunRegistry } from "./active_agent_runs.js";
import { deleteProjectWorkspace } from "./projects_index.js";
import {
  preflightTeamWorkflowRun,
  projectCreatedWorkflowTask,
  startTeamWorkflowRun,
  type WorkflowRouteDeps,
} from "./routes/workflow_routes.js";

export type PrivateEvalCanonicalTeamSegment = Pick<
  PrivateEvalSegment,
  "segmentId" | "source" | "tags" | "riskTypes" | "tmRefs" | "termRefs"
>;

export interface RunPrivateEvalCanonicalTeamInput {
  repoRoot: string;
  parentRunId: string;
  evalSetId: string;
  segments: PrivateEvalCanonicalTeamSegment[];
  sourceLocale: string;
  targetLocale: string;
  modelRoutes: Record<string, string>;
  thinkingLevel: PrivateEvalThinkingLevel;
  workflowDeps: WorkflowRouteDeps;
  activeRuns?: ActiveAgentRunRegistry;
  onRoleEvent?: (event: PrivateEvalTeamRoleLifecycleEvent) => void | Promise<void>;
}

export type PrivateEvalCanonicalTeamOutput = Pick<
  PrivateEvalRunOutput,
  "target" | "notes" | "rawResponse" | "executionManifest" | "usage"
>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeId(value: string): string {
  return hash(value).slice(0, 20);
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function routeParts(route: string | undefined): Pick<TeamRoleProfile, "provider" | "modelId"> {
  if (!route) return {};
  const [provider, ...rest] = route.split("/");
  return rest.length ? { provider, modelId: rest.join("/") } : { modelId: route };
}

function modelRoute(pass: TeamRolePass): string | undefined {
  if (pass.modelProvider && pass.modelId) return `${pass.modelProvider}/${pass.modelId}`;
  return pass.modelId;
}

function sumUsage(passes: TeamRolePass[]): PrivateEvalUsage | undefined {
  const rows = passes.flatMap((pass) => pass.usage ? [pass.usage] : []);
  if (!rows.length) return undefined;
  const inputTokens = rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0);
  const outputTokens = rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0);
  const cacheReadTokens = rows.some((row) => row.cacheReadTokens !== undefined)
    ? rows.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0)
    : undefined;
  const cacheWriteTokens = rows.some((row) => row.cacheWriteTokens !== undefined)
    ? rows.reduce((sum, row) => sum + (row.cacheWriteTokens ?? 0), 0)
    : undefined;
  return {
    inputTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    outputTokens,
    totalTokens: rows.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0) || inputTokens + outputTokens,
    costUsd: rows.every((row) => row.costUsd !== undefined) ? rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) : undefined,
    modelCalls: rows.length,
  };
}

/** Run the production batch-level Team workflow against a source-only isolated CAT project. */
export async function runPrivateEvalCanonicalTeam(
  input: RunPrivateEvalCanonicalTeamInput,
): Promise<Map<string, PrivateEvalCanonicalTeamOutput>> {
  const digest = safeId(`${input.evalSetId}\0${input.parentRunId}`);
  const projectId = `private-eval-${digest}`;
  const batchId = `eval-${digest}`;
  const taskId = `task-${digest}`;
  const workflowId = `team-${digest}`;
  const projectRoot = join(input.repoRoot, "data", "projects", projectId);
  const sourceFile = join(projectRoot, "source.csv");
  const scopedSegments = input.segments.map((segment, index) => ({
    original: segment,
    segmentId: `eval-${String(index + 1).padStart(4, "0")}`,
  }));
  const profiles: TeamRoleProfile[] = TEAM_ROLE_IDS.map((roleId) => ({
    roleId,
    enabled: true,
    ...routeParts(input.modelRoutes[roleId] ?? input.modelRoutes.default),
    thinking: input.thinkingLevel,
  }));
  const roleEvents = new Set<string>();
  let roleOrder = new Map<TeamRoleId, number>();
  const deps: WorkflowRouteDeps = {
    ...input.workflowDeps,
    continueTeamRunsInBackground: false,
    readProjectAgentSettings: async () => ({ teamRoleSettings: { profiles } }),
    onTeamRolePass: async ({ roleId, pass }) => {
      await input.workflowDeps.onTeamRolePass?.({ projectId, workflowId, roleId, pass });
      const type = pass.status === "completed" ? "completed" : pass.status === "failed" ? "failed" : ["queued", "running"].includes(pass.status) || (pass.status === "waiting" && !!pass.subagentSpawnRequest) ? "started" : undefined;
      if (!type) return;
      const key = `${roleId}:${type}`;
      if (roleEvents.has(key)) return;
      roleEvents.add(key);
      await input.onRoleEvent?.({
        type,
        segmentId: "batch",
        roleId,
        callIndex: (roleOrder.get(roleId) ?? 0) + 1,
        roleAttempt: 1,
        modelRoute: modelRoute(pass),
        promptHash: pass.contextManifest?.promptHash ?? hash(`${workflowId}:${roleId}`),
        usage: pass.usage,
        error: pass.status === "failed" ? pass.summary : undefined,
      });
    },
  };
  let controlTurnId: string | undefined;
  try {
    await mkdir(projectRoot, { recursive: true });
    const rows = ["SegmentID,Source,Target,Note", ...scopedSegments.map(({ original: segment, segmentId }) => [
      csv(segmentId),
      csv(segment.source),
      csv(""),
      csv([
        segment.tags.length ? `tags: ${segment.tags.join(", ")}` : "",
        segment.riskTypes.length ? `risk: ${segment.riskTypes.join(", ")}` : "",
        ...segment.tmRefs.map((row) => `TM: ${row}`),
        ...segment.termRefs.map((row) => `Term: ${row}`),
      ].filter(Boolean).join(" | ")),
    ].join(","))];
    await writeFile(sourceFile, `${rows.join("\n")}\n`, "utf8");
    await createProjectManifest(input.repoRoot, projectRoot, {
      projectId,
      sourceLanguage: input.sourceLocale,
      targetLanguage: input.targetLocale,
    });
    await importCsvBatch(input.repoRoot, { projectId, csvPath: sourceFile, batchId, overwrite: true, workflowStage: "translate" });
    await createTaskWorkspace(input.repoRoot).create({
      projectId,
      taskId,
      title: "Blind Private Eval",
      intent: "Compare the production Team workflow without references or writes.",
      kind: "eval",
      scope: {
        batchId,
        segmentIds: scopedSegments.map((segment) => segment.segmentId),
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
      },
    });
    const created = await createCatWorkflowRun(input.repoRoot, {
      projectId,
      taskId,
      batchId,
      workflowId,
      intent: "game_localization_team_run",
      userRequest: [
        "Run a blind Private Eval with no interactive user answer.",
        "When evidence is insufficient, preserve the ambiguity as a risk or finding, choose the best professional game-localization default, and continue.",
        "Emit a query only when every candidate would violate a hard delivery constraint; ordinary linguistic ambiguity must not pause this eval.",
      ].join(" "),
      includeReadiness: false,
    });
    await projectCreatedWorkflowTask(created.run, deps);
    const plan = await preflightTeamWorkflowRun({ projectId, workflowId, project: false, deps });
    roleOrder = new Map(plan.selectedRoleIds.map((roleId, index) => [roleId, index]));
    if (plan.readiness.status === "blocked") throw new Error(`Private Eval Team preflight blocked: ${plan.readiness.blockers.join("; ")}`);

    if (input.activeRuns) {
      controlTurnId = `private-eval-team:${input.parentRunId}`;
      input.activeRuns.register({
        turnId: controlTurnId,
        scope: "workflow_role",
        projectId,
        workflowId,
        parentRunId: input.parentRunId,
        session: {
          abort: async () => {
            await deps.stopActiveRuns?.({ projectId, workflowId, reason: "private eval stopped" });
            await stopCatWorkflowRun(input.repoRoot, projectId, workflowId, "private eval stopped");
          },
          dispose: () => undefined,
        },
      });
    }

    await startTeamWorkflowRun({ projectId, workflowId, planHash: plan.planHash, awaitUntilPause: true, deps });
    const workflow = await readCatWorkflowRun(input.repoRoot, projectId, workflowId);
    if (workflow.status !== "completed") throw new Error(`Private Eval canonical Team ended ${workflow.status}: ${workflow.history.at(-1)?.message ?? "no workflow detail"}`);
    const artifacts = await readWorkflowArtifacts(input.repoRoot, projectId);
    const passes = artifacts.teamRolePasses.filter((pass) => pass.workflowId === workflowId && pass.status === "completed");
    const modelPasses = passes.filter((pass) => !DETERMINISTIC_TEAM_ROLE_IDS.has(pass.roleId));
    const rolePromptHashes = modelPasses.map((pass) => ({
      roleId: pass.roleId,
      promptHash: pass.contextManifest?.promptHash ?? hash(`${workflowId}:${pass.roleId}`),
      modelRoute: modelRoute(pass),
    }));
    const roleContextManifests = modelPasses.flatMap((pass) => pass.contextManifest ? [{
      roleId: pass.roleId,
      modelRoute: modelRoute(pass),
      manifest: pass.contextManifest,
    }] : []);
    const executionManifest: PrivateEvalExecutionManifest = {
      adapter: "canonical_team_workflow",
      roleIds: modelPasses.map((pass) => pass.roleId),
      estimatedCalls: plan.estimatedCalls,
      actualCalls: modelPasses.length,
      rolePromptHashes,
      roleContextManifests,
      thinkingLevel: input.thinkingLevel,
      segmentIdMode: "eval_alias_v1",
      referenceIncluded: false,
      writeMode: "none",
    };
    const rank = new Map(plan.selectedRoleIds.map((roleId, index) => [roleId, index]));
    const candidates = artifacts.teamCandidateTargets
      .filter((candidate) => candidate.workflowId === workflowId)
      .sort((a, b) => (rank.get(a.roleId) ?? -1) - (rank.get(b.roleId) ?? -1));
    const usage = sumUsage(modelPasses);
    return new Map(scopedSegments.map(({ original: segment, segmentId }, index) => {
      const candidate = candidates.filter((row) => row.segmentId === segmentId).at(-1);
      if (!candidate) throw new Error(`Private Eval canonical Team produced no candidate for ${segment.segmentId} (${segmentId}).`);
      return [segment.segmentId, {
        target: candidate.target,
        notes: candidate.notes,
        rawResponse: JSON.stringify({ workflowId, candidateId: candidate.id, roleId: candidate.roleId }),
        executionManifest,
        usage: index === 0 ? usage : undefined,
      }];
    }));
  } finally {
    if (controlTurnId) input.activeRuns?.unregister(controlTurnId);
    await deleteProjectWorkspace(input.repoRoot, projectId).catch(() => undefined);
  }
}
