import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_PRIVATE_EVAL_THINKING_LEVEL,
  createPrivateEvalBlindReview,
  createPrivateEvalRun,
  createPrivateEvalSet,
  executePrivateEvalRun,
  evaluatePrivateEvalMechanicalQa,
  listPrivateEvalRuns,
  listPrivateEvalSets,
  listPrivateEvalBlindReviews,
  readBatch,
  readPrivateEvalRun,
  readPrivateEvalRunOutputs,
  readPrivateEvalSet,
  readProjectTagRuleContext,
  readHumanScorecard,
  readPrivateEvalBlindReview,
  readPrivateEvalBlindReviewRunIds,
  renderPrivateEvalComparison,
  updatePrivateEvalRun,
  writeHumanScorecard,
  writePrivateEvalBlindJudgments,
  summarizePrivateEvalOutputUsage,
  seedPrivateEvalRunFromCheckpoint,
  type PrivateEvalTeamRoleLifecycleEvent,
  type PrivateEvalThinkingLevel,
} from "@linguist-agent/cat-data";
import type { ActiveAgentRunRegistry } from "../active_agent_runs.js";
import type { PrivateEvalCanonicalTeamOutput, PrivateEvalCanonicalTeamSegment } from "../private_eval_canonical_team.js";
import {
  runPrivateEvalCanonicalSingle,
  type PrivateEvalCanonicalSingleGenerationInput,
  type PrivateEvalCanonicalSingleGenerationResult,
  type PrivateEvalCanonicalSingleOutput,
} from "../private_eval_canonical_single.js";
import {
  createEvalTaskRunProjector,
  ensureEvalTaskWorkspace,
  projectEvalReviewArtifacts,
  type EvalTaskRunProjector,
} from "../eval_task_run_projection.js";

export interface EvalRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
  runSingleGeneration?: (input: PrivateEvalCanonicalSingleGenerationInput) => Promise<PrivateEvalCanonicalSingleGenerationResult>;
  runTeamWorkflow?: (input: {
    parentRunId: string;
    evalSetId: string;
    segments: PrivateEvalCanonicalTeamSegment[];
    sourceLocale: string;
    targetLocale: string;
    modelRoutes: Record<string, string>;
    thinkingLevel: PrivateEvalThinkingLevel;
    onRoleEvent?: (event: PrivateEvalTeamRoleLifecycleEvent) => void | Promise<void>;
  }) => Promise<Map<string, PrivateEvalCanonicalTeamOutput>>;
  activeRuns?: ActiveAgentRunRegistry;
}

function evalTermTargets(refs: readonly string[]): string[] {
  return refs.flatMap((ref) => {
    const target = ref.match(/=>\s*[^=]+=(.*)$/)?.[1]?.trim();
    return target ? [target] : [];
  });
}

const INTERRUPTED_EVAL_ERROR = "Private Eval was interrupted because its runtime execution is no longer active.";

async function listReconciledPrivateEvalRuns(deps: EvalRouteDeps, evalSetId: string) {
  const runs = await listPrivateEvalRuns(deps.repoRoot, evalSetId);
  if (!deps.activeRuns) return runs;
  const interrupted = runs.filter((run) => run.status === "running" && !deps.activeRuns?.find({ turnId: run.runId }));
  if (!interrupted.length) return runs;
  const payload = await readPrivateEvalSet(deps.repoRoot, evalSetId);
  const replacements = new Map<string, Awaited<ReturnType<typeof updatePrivateEvalRun>>>();
  for (const run of interrupted) {
    const outputs = await readPrivateEvalRunOutputs(deps.repoRoot, evalSetId, run.runId);
    const completedAt = new Date().toISOString();
    const failed = await updatePrivateEvalRun(deps.repoRoot, {
      ...run,
      status: "failed",
      completedAt,
      usage: run.usage ?? summarizePrivateEvalOutputUsage(outputs),
      error: INTERRUPTED_EVAL_ERROR,
    });
    replacements.set(run.runId, failed);
    if (failed.projectId && failed.taskId) {
      const projector = await createEvalTaskRunProjector({
        repoRoot: deps.repoRoot,
        projectId: failed.projectId,
        taskId: failed.taskId,
        runId: failed.runId,
        evalSetId,
        mode: failed.mode,
        modelRoutes: failed.modelRoutes,
        startedAt: failed.startedAt,
        totalSegments: failed.segmentCount ?? payload.segments.length,
      });
      for (const output of outputs) projector.output(output, completedAt);
      projector.fail(INTERRUPTED_EVAL_ERROR, failed.usage, completedAt);
      await projector.flush();
    }
  }
  return runs.map((run) => replacements.get(run.runId) ?? run);
}

export async function stopPrivateEvalRun(
  input: { evalSetId: string; runId: string; reason?: string },
  deps: Pick<EvalRouteDeps, "repoRoot" | "activeRuns">,
): Promise<unknown> {
  let result = await deps.activeRuns?.stop({
    scope: "private_eval",
    turnId: input.runId,
    reason: input.reason,
  }) ?? { stopped: 0, errors: [] };
  let run = await readPrivateEvalRun(deps.repoRoot, input.evalSetId, input.runId);
  const outputs = await readPrivateEvalRunOutputs(deps.repoRoot, input.evalSetId, input.runId);
  const partialUsage = summarizePrivateEvalOutputUsage(outputs);
  if (run.status === "running") {
    run = await updatePrivateEvalRun(deps.repoRoot, {
      ...run,
      usage: run.usage ?? partialUsage,
      status: "stopped",
      completedAt: new Date().toISOString(),
      error: undefined,
    });
    result = { ...result, stopped: Math.max(1, result.stopped) };
  } else if (run.status === "stopped" && !run.usage && partialUsage) {
    run = await updatePrivateEvalRun(deps.repoRoot, { ...run, usage: partialUsage });
  }
  if (run.status === "stopped" && run.projectId && run.taskId) {
    const payload = await readPrivateEvalSet(deps.repoRoot, input.evalSetId);
    const projector = await createEvalTaskRunProjector({
      repoRoot: deps.repoRoot,
      projectId: run.projectId,
      taskId: run.taskId,
      runId: input.runId,
      evalSetId: input.evalSetId,
      mode: run.mode,
      modelRoutes: run.modelRoutes,
      startedAt: run.startedAt,
      totalSegments: run.segmentCount ?? payload.segments.length,
    });
    for (const output of outputs) projector.output(output, run.completedAt);
    projector.stop(run.usage, run.completedAt);
    await projector.flush();
  }
  return result;
}

function parseModelRoute(route: unknown): { modelProvider?: string; modelId?: string } {
  if (typeof route !== "string" || !route.trim()) return {};
  const [modelProvider, ...rest] = route.split("/");
  const modelId = rest.join("/");
  return modelProvider && modelId ? { modelProvider, modelId } : { modelId: route };
}

const PRIVATE_EVAL_THINKING_LEVELS = new Set<PrivateEvalThinkingLevel>(["minimal", "low", "medium", "high", "xhigh"]);

function parsePrivateEvalThinkingLevel(value: unknown): PrivateEvalThinkingLevel {
  if (value === undefined) return DEFAULT_PRIVATE_EVAL_THINKING_LEVEL;
  if (typeof value === "string" && PRIVATE_EVAL_THINKING_LEVELS.has(value as PrivateEvalThinkingLevel)) return value as PrivateEvalThinkingLevel;
  throw new Error("thinkingLevel must be one of: minimal, low, medium, high, xhigh.");
}

function sameModelRoutes(left: Record<string, string>, right: Record<string, string>): boolean {
  const entries = (value: Record<string, string>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries(left)) === JSON.stringify(entries(right));
}

export async function handleEvalRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  deps: EvalRouteDeps,
): Promise<boolean> {
  if (parts[0] !== "api" || parts[1] !== "evals" || parts[2] !== "private") return false;

  if (parts.length === 3 && req.method === "GET") {
    deps.json(res, 200, { rows: await listPrivateEvalSets(deps.repoRoot) });
    return true;
  }

  if (parts.length === 3 && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await createPrivateEvalSet(deps.repoRoot, {
      evalSetId: deps.requireString(body.evalSetId, "evalSetId"),
      label: deps.requireString(body.label, "label"),
      sourceRoot: deps.requireString(body.sourceRoot, "sourceRoot"),
      sampleSize: typeof body.sampleSize === "number" ? body.sampleSize : undefined,
    }));
    return true;
  }

  if (!parts[3]) return false;
  const evalSetId = decodeURIComponent(parts[3]);

  if (parts.length === 4 && req.method === "GET") {
    deps.json(res, 200, await readPrivateEvalSet(deps.repoRoot, evalSetId));
    return true;
  }

  if (parts[4] === "sample" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await createPrivateEvalSet(deps.repoRoot, {
      evalSetId,
      label: deps.optionalString(body.label) ?? evalSetId,
      sourceRoot: deps.requireString(body.sourceRoot, "sourceRoot"),
      sampleSize: typeof body.sampleSize === "number" ? body.sampleSize : undefined,
    }));
    return true;
  }

  if (parts[4] === "runs" && parts.length === 5 && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    if (body.execute !== true) {
      deps.json(res, 400, { error: "Private Eval runs must be executed when they are created." });
      return true;
    }
    if (body.runId !== undefined) {
      deps.json(res, 400, { error: "Private Eval runId is server-owned." });
      return true;
    }
    const resumedFromRunId = deps.optionalString(body.resumedFromRunId);
    if (resumedFromRunId) await listReconciledPrivateEvalRuns(deps, evalSetId);
    const checkpointRun = resumedFromRunId ? await readPrivateEvalRun(deps.repoRoot, evalSetId, resumedFromRunId) : undefined;
    if (checkpointRun && !["failed", "stopped"].includes(checkpointRun.status)) {
      throw new Error("Private Eval can resume only from a failed or stopped run.");
    }
    const requestedModelRoutes = typeof body.modelRoutes === "object" && body.modelRoutes ? body.modelRoutes as Record<string, string> : undefined;
    const modelRoutes = checkpointRun ? checkpointRun.modelRoutes : (requestedModelRoutes ?? {});
    if (checkpointRun && requestedModelRoutes && !sameModelRoutes(requestedModelRoutes, checkpointRun.modelRoutes)) {
      throw new Error("Private Eval resume cannot change model routes.");
    }
    const thinkingLevel = body.thinkingLevel === undefined && checkpointRun?.thinkingLevel
      ? checkpointRun.thinkingLevel
      : parsePrivateEvalThinkingLevel(body.thinkingLevel);
    if (checkpointRun?.thinkingLevel && thinkingLevel !== checkpointRun.thinkingLevel) {
      throw new Error("Private Eval resume cannot change thinking level.");
    }
    const requestedMode = body.mode === "team_workflow" ? "team_workflow" as const : "single_agent" as const;
    const mode = checkpointRun?.mode ?? requestedMode;
    if (checkpointRun && body.mode !== undefined && requestedMode !== checkpointRun.mode) {
      throw new Error("Private Eval resume cannot change execution mode.");
    }
    const projectId = deps.requireString(body.projectId, "projectId");
    const batchId = deps.requireString(body.batchId, "batchId");
    if (checkpointRun && checkpointRun.projectId !== projectId) throw new Error("Private Eval resume requires the same canonical project scope.");
    const requestedSegmentLimit = typeof body.segmentLimit === "number" ? body.segmentLimit : undefined;
    if (checkpointRun?.segmentCount !== undefined && requestedSegmentLimit !== undefined && requestedSegmentLimit !== checkpointRun.segmentCount) {
      throw new Error("Private Eval resume cannot change segment count.");
    }
    const segmentLimit = checkpointRun?.segmentCount ?? requestedSegmentLimit;
    const evalPayload = await readPrivateEvalSet(deps.repoRoot, evalSetId);
    const taskId = (await ensureEvalTaskWorkspace({
      repoRoot: deps.repoRoot,
      projectId,
      batchId,
      evalSetId,
      label: evalPayload.evalSet.label,
    })).task.id;
    if (checkpointRun && checkpointRun.taskId !== taskId) throw new Error("Private Eval resume requires the same canonical Eval Task scope.");
    const segmentCount = Math.min(evalPayload.segments.length, segmentLimit ?? evalPayload.segments.length);
    if (mode === "single_agent" && !deps.runSingleGeneration) {
      throw new Error("single_agent private eval requires the isolated Pi generation adapter.");
    }
    if (mode === "team_workflow" && !deps.runTeamWorkflow) {
      throw new Error("team_workflow private eval requires the canonical batch-level Team workflow adapter.");
    }
    const executingProjectId = projectId;
    const executingBatch = await readBatch(deps.repoRoot, executingProjectId, batchId);
    const evalTagRuleContext = await readProjectTagRuleContext(deps.repoRoot, executingProjectId);
    let stopped = false;
    const releaseRunStart = deps.activeRuns?.acquireRunStartLease();
    let run: Awaited<ReturnType<typeof createPrivateEvalRun>>;
    try {
      run = await createPrivateEvalRun(deps.repoRoot, evalSetId, {
        mode,
        modelRoutes,
        projectId,
        taskId,
        segmentCount,
        thinkingLevel,
        resumedFromRunId,
      });
      // Register immediately after the durable run is created. A concurrent GET
      // must not misclassify this same-process launch as a restart orphan while
      // the canonical Task projection is being flushed.
      deps.activeRuns?.register({
        turnId: run.runId,
        scope: "private_eval",
        projectId,
        session: {
          abort: async () => {
            stopped = true;
            await deps.activeRuns?.stop({ parentRunId: run.runId, reason: "private eval stopped" });
          },
          dispose: () => undefined,
        },
      });
    } finally {
      releaseRunStart?.();
    }
    const model = parseModelRoute(modelRoutes.default);
    let projector: EvalTaskRunProjector | undefined;
    try {
      projector = await createEvalTaskRunProjector({
        repoRoot: deps.repoRoot,
        projectId: executingProjectId,
        taskId,
        runId: run.runId,
        evalSetId,
        mode,
        modelRoutes,
        startedAt: run.startedAt,
        totalSegments: segmentCount,
      });
      // The 202 response advertises a canonical Task Run. Flush its initial
      // run/thread/activity events before returning so the native client never
      // races a not-yet-created projection.
      await projector.flush();
      if (checkpointRun) {
        const checkpointOutputs = await seedPrivateEvalRunFromCheckpoint(deps.repoRoot, evalSetId, run.runId, checkpointRun.runId);
        if (!checkpointOutputs.length) throw new Error("Private Eval resume checkpoint contains no completed outputs.");
        run = await updatePrivateEvalRun(deps.repoRoot, {
          ...run,
          checkpointOutputCount: checkpointOutputs.length,
          checkpointUsage: summarizePrivateEvalOutputUsage(checkpointOutputs),
        });
        for (const output of checkpointOutputs) projector.output(output, run.startedAt);
        await projector.flush();
      }
    } catch (error) {
      await updatePrivateEvalRun(deps.repoRoot, {
        ...run,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      deps.activeRuns?.unregister(run.runId);
      throw error;
    }
    const persistedOutputs = await readPrivateEvalRunOutputs(deps.repoRoot, evalSetId, run.runId);
    const alreadyCompleted = new Set(persistedOutputs.filter((output) => output.status === "completed").map((output) => output.segmentId));
    const pendingSegments = (evalPayload?.segments ?? [])
      .slice(0, segmentLimit ?? evalPayload?.segments.length)
      .filter((segment) => !alreadyCompleted.has(segment.segmentId))
      .map((segment) => ({
        segmentId: segment.segmentId,
        source: segment.source,
        tags: [...segment.tags],
        riskTypes: [...segment.riskTypes],
        tmRefs: [...segment.tmRefs],
        termRefs: [...segment.termRefs],
      }));
    const teamSegments = pendingSegments;
    let singleOutputs: Promise<Map<string, PrivateEvalCanonicalSingleOutput>> | undefined;
    let teamOutputs: Promise<Map<string, PrivateEvalCanonicalTeamOutput>> | undefined;
    const segmentRunner = run.mode === "team_workflow"
      ? async ({ segment }: Parameters<Parameters<typeof executePrivateEvalRun>[3]>[0]) => {
          teamOutputs ??= deps.runTeamWorkflow!({
            parentRunId: run.runId,
            evalSetId,
            segments: teamSegments,
            sourceLocale: executingBatch.sourceLanguage,
            targetLocale: executingBatch.targetLanguage,
            modelRoutes,
            thinkingLevel,
            onRoleEvent: async (event) => {
              projector?.role(event);
              await projector?.flush();
            },
          });
          const output = (await teamOutputs).get(segment.segmentId);
          if (!output) throw new Error(`Canonical Team produced no output for ${segment.segmentId}.`);
          return {
            ...output,
            mechanicalQa: evaluatePrivateEvalMechanicalQa(segment.source, output.target, evalTagRuleContext, {
              targetLocale: executingBatch.targetLanguage,
              allowedTerms: evalTermTargets(segment.termRefs),
            }),
          };
        }
      : async ({ segment }: Parameters<Parameters<typeof executePrivateEvalRun>[3]>[0]) => {
          singleOutputs ??= runPrivateEvalCanonicalSingle({
            projectId: executingProjectId,
            parentRunId: run.runId,
            evalSetId,
            segments: pendingSegments,
            sourceLocale: executingBatch.sourceLanguage,
            targetLocale: executingBatch.targetLanguage,
            ...model,
            thinkingLevel,
            generate: deps.runSingleGeneration!,
          });
          const output = (await singleOutputs).get(segment.segmentId);
          if (!output) throw new Error(`Canonical Single produced no output for ${segment.segmentId}.`);
          return {
            ...output,
            mechanicalQa: evaluatePrivateEvalMechanicalQa(segment.source, output.target, evalTagRuleContext, {
              targetLocale: executingBatch.targetLanguage,
              allowedTerms: evalTermTargets(segment.termRefs),
            }),
          };
        };
    const execute = async () => {
      try {
        const result = await executePrivateEvalRun(deps.repoRoot, evalSetId, run.runId, segmentRunner, {
          segmentLimit,
          shouldStop: () => stopped || deps.activeRuns?.isStoppingOrStopped(run.runId) === true,
          onOutput: async (output) => {
            projector?.output(output);
            await projector?.flush();
          },
        });
        if (result.run.status === "stopped") projector?.stop(result.run.usage, result.run.completedAt);
        else projector?.complete(result.run.usage, result.run.completedAt);
        await projector?.flush();
        if (result.run.projectId && result.run.taskId) {
          const comparison = await renderPrivateEvalComparison(deps.repoRoot, evalSetId, `task-${result.run.taskId}`);
          await projectEvalReviewArtifacts({ repoRoot: deps.repoRoot, run: result.run, comparison });
        }
        return result;
      } catch (error) {
        const failedRun = await readPrivateEvalRun(deps.repoRoot, evalSetId, run.runId);
        projector?.fail(error, failedRun.usage, failedRun.completedAt);
        await projector?.flush();
        throw error;
      }
    };
    if (body.background === true || body.async === true) {
      void execute().catch((error) => {
        console.error("private eval background run failed", error);
      }).finally(() => {
        deps.activeRuns?.unregister(run.runId);
      });
      deps.json(res, 202, { run, outputs: [] });
      return true;
    }
    try {
      deps.json(res, 200, await execute());
    } finally {
      deps.activeRuns?.unregister(run.runId);
    }
    return true;
  }

  if (parts[4] === "runs" && parts.length === 5 && req.method === "GET") {
    deps.json(res, 200, { rows: await listReconciledPrivateEvalRuns(deps, evalSetId) });
    return true;
  }

  if (parts[4] === "runs" && parts[6] === "outputs" && req.method === "GET") {
    deps.json(res, 200, { rows: await readPrivateEvalRunOutputs(deps.repoRoot, evalSetId, decodeURIComponent(parts[5] ?? "")) });
    return true;
  }

  if (parts[4] === "runs" && parts[6] === "stop" && req.method === "POST") {
    const runId = decodeURIComponent(parts[5] ?? "");
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await stopPrivateEvalRun({
      evalSetId,
      runId,
      reason: deps.optionalString(body.reason),
    }, deps));
    return true;
  }

  if (parts[4] === "blind-reviews" && parts.length === 5 && req.method === "GET") {
    deps.json(res, 200, { rows: await listPrivateEvalBlindReviews(deps.repoRoot, evalSetId) });
    return true;
  }

  if (parts[4] === "blind-reviews" && parts.length === 5 && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const runIds = Array.isArray(body.runIds) ? body.runIds.map((value) => deps.requireString(value, "runId")) : [];
    if (runIds.length !== 2) throw new Error("Blind review requires exactly two run ids.");
    const review = await createPrivateEvalBlindReview(deps.repoRoot, evalSetId, {
      runIds: [runIds[0], runIds[1]],
      seed: deps.requireString(body.seed, "seed"),
      sampleSize: typeof body.sampleSize === "number" ? body.sampleSize : undefined,
      reviewId: deps.optionalString(body.reviewId),
    });
    deps.json(res, 200, review);
    return true;
  }

  if (parts[4] === "blind-reviews" && parts[5] && parts.length === 6 && req.method === "GET") {
    deps.json(res, 200, await readPrivateEvalBlindReview(deps.repoRoot, evalSetId, decodeURIComponent(parts[5])));
    return true;
  }

  if (parts[4] === "blind-reviews" && parts[5] && parts[6] === "judgments" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const reviewId = decodeURIComponent(parts[5]);
    const review = await writePrivateEvalBlindJudgments(
      deps.repoRoot,
      evalSetId,
      reviewId,
      Array.isArray(body.rows) ? body.rows as never : [],
    );
    const [runId] = await readPrivateEvalBlindReviewRunIds(deps.repoRoot, evalSetId, reviewId);
    const run = await readPrivateEvalRun(deps.repoRoot, evalSetId, runId);
    if (run.projectId && run.taskId) {
      await projectEvalReviewArtifacts({
        repoRoot: deps.repoRoot,
        run,
        blindReview: review,
      });
    }
    deps.json(res, 200, review);
    return true;
  }

  if (parts[4] === "scorecards" && parts[5] && req.method === "GET") {
    deps.json(res, 200, { rows: await readHumanScorecard(deps.repoRoot, evalSetId, decodeURIComponent(parts[5])) });
    return true;
  }

  if (parts[4] === "scorecards" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const runId = deps.requireString(body.runId, "runId");
    const path = await writeHumanScorecard(deps.repoRoot, evalSetId, runId, Array.isArray(body.rows) ? body.rows as never : []);
    const run = await readPrivateEvalRun(deps.repoRoot, evalSetId, runId);
    const rows = await readHumanScorecard(deps.repoRoot, evalSetId, runId);
    const comparison = await renderPrivateEvalComparison(deps.repoRoot, evalSetId, `task-${run.taskId ?? runId}`);
    await projectEvalReviewArtifacts({ repoRoot: deps.repoRoot, run, scoreRows: rows, comparison });
    deps.json(res, 200, {
      path,
    });
    return true;
  }

  if (parts[4] === "comparison" && req.method === "GET") {
    deps.json(res, 200, await renderPrivateEvalComparison(deps.repoRoot, evalSetId));
    return true;
  }

  return false;
}
