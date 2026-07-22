import { createHash } from "node:crypto";
import {
  createTaskWorkspace,
  DETERMINISTIC_TEAM_ROLE_IDS,
  listPrivateEvalRuns,
  readPrivateEvalRunOutputs,
  requireProjectTaskScope,
  TaskWorkspaceConflictError,
  teamRoleDisplayName,
  type HumanScoreRow,
  type PrivateEvalBlindReview,
  type PrivateEvalRun,
  type PrivateEvalRunOutput,
  type PrivateEvalTeamRoleLifecycleEvent,
  type TeamRoleId,
  type TaskRunEventDraft,
  type TaskRunStatus,
  type TaskUsage,
} from "@linguist-agent/cat-data";

export interface EvalTaskRunProjectorInput {
  repoRoot: string;
  projectId: string;
  taskId: string;
  runId: string;
  evalSetId: string;
  mode: "single_agent" | "team_workflow";
  modelRoutes: Record<string, string>;
  startedAt: string;
  totalSegments: number;
}

export interface EvalTaskRunProjector {
  role(value: PrivateEvalTeamRoleLifecycleEvent, timestamp?: string): void;
  output(value: PrivateEvalRunOutput, timestamp?: string): void;
  complete(usage?: EvalProjectionUsage, timestamp?: string): void;
  stop(usage?: EvalProjectionUsage, timestamp?: string): void;
  fail(error: unknown, usage?: EvalProjectionUsage, timestamp?: string): void;
  flush(): Promise<void>;
}

interface EvalProjectionUsage {
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  modelCalls?: number;
}

const AGENT_ID = "linguist-agent";
const AGENT_NAME = "Linguist Agent";

export async function ensureEvalTaskWorkspace(input: {
  repoRoot: string;
  projectId: string;
  batchId: string;
  evalSetId: string;
  label: string;
}) {
  const workspace = createTaskWorkspace(input.repoRoot);
  const existingRuns = await listPrivateEvalRuns(input.repoRoot, input.evalSetId);
  for (const run of existingRuns) {
    if (run.projectId !== input.projectId || !run.taskId) continue;
    try {
      const snapshot = await workspace.open({ projectId: input.projectId, taskId: run.taskId });
      if (snapshot.task.kind === "eval" && requireProjectTaskScope(snapshot.task.scope, "Eval Task").batchId === input.batchId) return snapshot;
    } catch {
      // A stale run reference must not prevent creating the canonical Eval Task.
    }
  }
  const digest = createHash("sha256").update(`${input.projectId}\0${input.batchId}\0${input.evalSetId}`).digest("hex").slice(0, 20);
  const taskId = `eval-task-${digest}`;
  try {
    return await workspace.create({
      projectId: input.projectId,
      taskId,
      title: `Eval · ${input.label}`,
      intent: `Compare Single and Team localization quality for ${input.label}.`,
      kind: "eval",
      scope: { batchId: input.batchId },
    });
  } catch (error) {
    if (error instanceof TaskWorkspaceConflictError) return workspace.open({ projectId: input.projectId, taskId });
    throw error;
  }
}

export async function projectEvalReviewArtifacts(input: {
  repoRoot: string;
  run: PrivateEvalRun;
  comparison?: { markdown: string; reportPath: string };
  scoreRows?: HumanScoreRow[];
  blindReview?: PrivateEvalBlindReview;
  timestamp?: string;
}): Promise<void> {
  if (!input.run.projectId || !input.run.taskId) return;
  const workspace = createTaskWorkspace(input.repoRoot);
  let snapshot = await workspace.open({ projectId: input.run.projectId, taskId: input.run.taskId });
  if (!snapshot.runs.some((run) => run.id === input.run.runId)) {
    const outputs = await readPrivateEvalRunOutputs(input.repoRoot, input.run.evalSetId, input.run.runId);
    const projector = await createEvalTaskRunProjector({
      repoRoot: input.repoRoot,
      projectId: input.run.projectId,
      taskId: input.run.taskId,
      runId: input.run.runId,
      evalSetId: input.run.evalSetId,
      mode: input.run.mode,
      modelRoutes: input.run.modelRoutes,
      startedAt: input.run.startedAt,
      totalSegments: input.run.segmentCount ?? outputs.length,
    });
    for (const output of outputs) projector.output(output, input.run.completedAt);
    if (input.run.status === "completed") projector.complete(input.run.usage, input.run.completedAt);
    else if (input.run.status === "stopped") projector.stop(input.run.usage, input.run.completedAt);
    else if (input.run.status === "failed") projector.fail(input.run.error ?? "Eval run failed", input.run.usage, input.run.completedAt);
    else throw new Error(`Cannot project review artifacts for running Eval run ${input.run.runId}.`);
    await projector.flush();
    snapshot = await workspace.open({ projectId: input.run.projectId, taskId: input.run.taskId });
  }
  const timestamp = input.timestamp ?? new Date().toISOString();
  const threadId = `${input.run.runId}.main`;
  const events: TaskRunEventDraft[] = [];
  const addArtifact = (
    id: string,
    type: "eval_scorecard" | "eval_comparison",
    title: string,
    summary: string,
    content: Record<string, unknown>,
    actor: "human" | "system",
    status: "reviewable" | "final" = "final",
  ): void => {
    const previous = snapshot.artifacts.find((artifact) => artifact.id === id);
    const activityId = `${id}.v${(previous?.version ?? 0) + 1}`;
    events.push({
      type: "artifact_upsert",
      agentThreadId: threadId,
      occurredAt: timestamp,
      artifact: {
        id,
        taskId: input.run.taskId!,
        runId: input.run.runId,
        type,
        status,
        title,
        summary,
        scope: snapshot.task.scope,
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: [],
        content,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    }, {
      type: "activity_append",
      agentThreadId: threadId,
      occurredAt: timestamp,
      activity: {
        id: activityId,
        taskId: input.run.taskId!,
        runId: input.run.runId,
        agentThreadId: threadId,
        seq: 1,
        type: "artifact_update",
        status: "done",
        actor: actor === "human"
          ? { kind: "human", id: "human:reviewer", displayName: "Reviewer", agentThreadId: null }
          : { kind: "system", id: "private-eval", displayName: "Private Eval", agentThreadId: threadId },
        title,
        body: summary,
        tool: null,
        refs: { artifactIds: [id], evidenceRefs: [], decisionIds: [] },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
  };
  if (input.scoreRows) {
    const segmentCount = new Set(input.scoreRows.map((row) => row.segmentId)).size;
    addArtifact(
      `${input.run.runId}.scorecard`,
      "eval_scorecard",
      "Human eval scorecard",
      `${segmentCount} segments · ${input.scoreRows.length} scores`,
      { evalSetId: input.run.evalSetId, runId: input.run.runId, rows: input.scoreRows },
      "human",
    );
  }
  if (input.blindReview) {
    addArtifact(
      `${input.run.taskId}.blind.${input.blindReview.reviewId}`,
      "eval_comparison",
      "Blind A/B review",
      `${input.blindReview.judged}/${input.blindReview.total} pairs judged`,
      { evalSetId: input.run.evalSetId, blindReview: input.blindReview },
      "human",
      input.blindReview.complete ? "final" : "reviewable",
    );
  }
  if (input.comparison) {
    addArtifact(
      `${input.run.taskId}.comparison`,
      "eval_comparison",
      "Private eval comparison",
      `${snapshot.runs.length} runs compared`,
      { evalSetId: input.run.evalSetId, markdown: input.comparison.markdown, reportPath: input.comparison.reportPath },
      "system",
    );
  }
  await workspace.appendGenerated({
    projectId: input.run.projectId,
    taskId: input.run.taskId,
    runId: input.run.runId,
    events,
  });
}

export async function createEvalTaskRunProjector(input: EvalTaskRunProjectorInput): Promise<EvalTaskRunProjector> {
  const workspace = createTaskWorkspace(input.repoRoot);
  const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
  const threadId = `${input.runId}.main`;
  const childThreadIds = new Set(snapshot.agentThreads
    .filter((thread) => thread.runId === input.runId && thread.parentThreadId === threadId)
    .map((thread) => thread.id));
  const roleStatuses = new Map<TeamRoleId, TaskRunStatus>();
  const projectedRoleActivityIds = new Set(snapshot.activities.map((activity) => activity.id));
  const completedSegmentIds = new Set(snapshot.artifacts
    .filter((artifact) => artifact.runId === input.runId && artifact.type === "eval_output")
    .map((artifact) => artifact.content.segmentId)
    .filter((segmentId): segmentId is string => typeof segmentId === "string"));
  let queue = Promise.resolve();
  const append = (events: TaskRunEventDraft[]): void => {
    queue = queue.then(async () => {
      await workspace.appendGenerated({ projectId: input.projectId, taskId: input.taskId, runId: input.runId, events });
    });
  };
  const roleThreadId = (roleId: TeamRoleId): string => `${input.runId}.${roleId}`;
  const safeSegmentId = (segmentId: string): string => segmentId.replace(/[^A-Za-z0-9._-]+/g, "-");
  const roleActivityId = (value: Pick<PrivateEvalTeamRoleLifecycleEvent, "segmentId" | "roleId" | "callIndex" | "type">): string =>
    `${input.runId}.role.${safeSegmentId(value.segmentId)}.${String(value.callIndex).padStart(3, "0")}.${value.roleId}.${value.type}`;
  const mainThread = (status: TaskRunStatus, timestamp: string): NonNullable<TaskRunEventDraft["thread"]> => ({
    id: threadId,
    taskId: input.taskId,
    runId: input.runId,
    parentThreadId: null,
    identity: { kind: "main", roleId: AGENT_ID, displayName: AGENT_NAME, roleLabel: "Eval Agent", disclosureLabel: "Agent" },
    status,
    canReceiveUserMessage: true,
    handoffSummary: null,
    latestActivityId: null,
    childThreadIds: Array.from(childThreadIds),
    createdAt: input.startedAt,
    updatedAt: timestamp,
  });
  const roleThread = (roleId: TeamRoleId, status: TaskRunStatus, timestamp: string, latestActivityId?: string): NonNullable<TaskRunEventDraft["thread"]> => {
    const existing = snapshot.agentThreads.find((thread) => thread.id === roleThreadId(roleId));
    const deterministic = DETERMINISTIC_TEAM_ROLE_IDS.has(roleId);
    return {
      id: roleThreadId(roleId),
      taskId: input.taskId,
      runId: input.runId,
      parentThreadId: threadId,
      identity: { kind: deterministic ? "deterministic" : "specialist", roleId, displayName: teamRoleDisplayName(roleId), roleLabel: teamRoleDisplayName(roleId), disclosureLabel: deterministic ? "System" : "Agent" },
      status,
      canReceiveUserMessage: !deterministic,
      handoffSummary: existing?.handoffSummary ?? null,
      latestActivityId: latestActivityId ?? existing?.latestActivityId ?? null,
      childThreadIds: [],
      createdAt: existing?.createdAt ?? input.startedAt,
      updatedAt: timestamp,
    };
  };
  const lifecycle = (status: TaskRunStatus, timestamp: string): TaskRunEventDraft[] => [{
    type: "run_upsert",
    agentThreadId: threadId,
    occurredAt: timestamp,
    run: {
      id: input.runId,
      taskId: input.taskId,
      mode: "eval",
      status,
      rootAgentThreadId: threadId,
      planHash: null,
      estimatedCalls: input.totalSegments,
      estimatedCallsBySource: { eval: input.totalSegments },
      modelRoutes: input.modelRoutes,
      startedAt: input.startedAt,
      updatedAt: timestamp,
      completedAt: ["complete", "failed", "stopped"].includes(status) ? timestamp : null,
      stopAvailable: status === "active",
      resumeAvailable: false,
    },
  }, {
    type: "thread_upsert",
    agentThreadId: threadId,
    occurredAt: timestamp,
    thread: mainThread(status, timestamp),
  }];
  const activity = (id: string, timestamp: string, type: "progress" | "artifact_update" | "error", status: "running" | "done" | "blocked" | "error", title: string, body: string | null, artifactIds: string[] = []): TaskRunEventDraft => ({
    type: "activity_append",
    agentThreadId: threadId,
    occurredAt: timestamp,
    activity: {
      id,
      taskId: input.taskId,
      runId: input.runId,
      agentThreadId: threadId,
      seq: 1,
      type,
      status,
      actor: { kind: "agent", id: AGENT_ID, displayName: AGENT_NAME, agentThreadId: threadId },
      title,
      body,
      tool: null,
      refs: { artifactIds, evidenceRefs: [], decisionIds: [] },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });

  append([
    ...lifecycle("active", input.startedAt),
    activity(`${input.runId}.started`, input.startedAt, "progress", "running", "Private eval started", `${input.mode} · ${input.totalSegments} segments`),
  ]);

  const terminal = (status: "complete" | "stopped" | "failed", timestamp: string, title: string, body: string | null): void => {
    append([
      activity(`${input.runId}.${status}`, timestamp, status === "failed" ? "error" : "progress", status === "failed" ? "error" : status === "stopped" ? "blocked" : "done", title, body),
      ...lifecycle(status, timestamp),
    ]);
  };
  const projectUsage = (usage: EvalProjectionUsage, timestamp: string): void => {
    const taskUsage: TaskUsage = {
      inputTokens: usage.inputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      costUSD: usage.costUsd,
      modelCalls: usage.modelCalls ?? completedSegmentIds.size,
    };
    append([{ type: "usage_update", agentThreadId: threadId, occurredAt: timestamp, usageSource: "eval", usage: taskUsage }]);
  };
  const projectRole = (value: PrivateEvalTeamRoleLifecycleEvent, timestamp: string): void => {
    const childId = roleThreadId(value.roleId);
    const deterministic = DETERMINISTIC_TEAM_ROLE_IDS.has(value.roleId);
    childThreadIds.add(childId);
    const status: TaskRunStatus = value.type === "started" ? "active" : value.type === "failed" ? "failed" : "complete";
    roleStatuses.set(value.roleId, status);
    const activityId = roleActivityId(value);
    if (value.type !== "started" && projectedRoleActivityIds.has(activityId)) return;
    const events: TaskRunEventDraft[] = [
      { type: "thread_upsert", agentThreadId: threadId, occurredAt: timestamp, thread: mainThread("active", timestamp) },
      { type: "thread_upsert", agentThreadId: childId, occurredAt: timestamp, thread: roleThread(value.roleId, status, timestamp, value.type === "started" ? undefined : activityId) },
    ];
    if (value.type !== "started") {
      projectedRoleActivityIds.add(activityId);
      const usage = value.usage;
      const detail = [
        value.roleAttempt > 1 ? `Follow-up pass ${value.roleAttempt}.` : undefined,
        value.modelRoute,
        usage?.totalTokens ? `${usage.totalTokens} tokens` : undefined,
        value.error,
      ].filter(Boolean).join(" · ");
      events.push({
        type: "activity_append",
        agentThreadId: childId,
        occurredAt: timestamp,
        activity: {
          id: activityId,
          taskId: input.taskId,
          runId: input.runId,
          agentThreadId: childId,
          seq: 1,
          type: value.type === "failed" ? "error" : "handoff",
          status: value.type === "failed" ? "error" : "done",
          actor: { kind: deterministic ? "system" : "agent", id: value.roleId, displayName: teamRoleDisplayName(value.roleId), agentThreadId: childId },
          title: `${teamRoleDisplayName(value.roleId)} · ${value.segmentId}`,
          body: detail || null,
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [`prompt:${value.promptHash}`], decisionIds: [] },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      });
    }
    append(events);
  };
  const settleActiveRoles = (status: "complete" | "stopped" | "failed", timestamp: string): void => {
    const events: TaskRunEventDraft[] = [];
    for (const [roleId, current] of roleStatuses) {
      const shouldSettle = current === "active" || (status === "stopped" && current === "failed");
      if (!shouldSettle) continue;
      roleStatuses.set(roleId, status);
      events.push({ type: "thread_upsert", agentThreadId: roleThreadId(roleId), occurredAt: timestamp, thread: roleThread(roleId, status, timestamp) });
    }
    if (events.length) append(events);
  };

  return {
    role(value, timestamp = new Date().toISOString()) {
      projectRole(value, timestamp);
    },
    output(value, timestamp = new Date().toISOString()) {
      completedSegmentIds.add(value.segmentId);
      const traces = value.executionManifest?.rolePromptHashes ?? [];
      if (value.executionManifest?.adapter !== "canonical_team_workflow") {
        const attempts = new Map<TeamRoleId, number>();
        traces.forEach((trace, index) => {
          const roleAttempt = (attempts.get(trace.roleId) ?? 0) + 1;
          attempts.set(trace.roleId, roleAttempt);
          projectRole({
            type: "completed",
            segmentId: value.segmentId,
            roleId: trace.roleId,
            callIndex: index + 1,
            roleAttempt,
            modelRoute: trace.modelRoute,
            promptHash: trace.promptHash,
          }, timestamp);
        });
      }
      const safeId = safeSegmentId(value.segmentId);
      const artifactId = `${input.runId}.output.${safeId}`;
      const finalTrace = traces.at(-1);
      const provenanceThreadId = finalTrace ? roleThreadId(finalTrace.roleId) : threadId;
      const provenanceActivityId = finalTrace && value.executionManifest?.adapter !== "canonical_team_workflow" ? roleActivityId({
        type: "completed",
        segmentId: value.segmentId,
        roleId: finalTrace.roleId,
        callIndex: traces.length,
      }) : null;
      append([{
        type: "artifact_upsert",
        agentThreadId: provenanceThreadId,
        occurredAt: timestamp,
        artifact: {
          id: artifactId,
          taskId: input.taskId,
          runId: input.runId,
          type: "eval_output",
          status: value.status === "completed" ? "reviewable" : "draft",
          title: `Eval output · ${value.segmentId}`,
          summary: value.notes?.trim() || null,
          scope: snapshot.task.scope,
          version: 1,
          provenance: { agentThreadId: provenanceThreadId, activityId: provenanceActivityId, evidenceRefs: [], parentArtifactIds: [] },
          availableDecisions: [],
          content: {
            evalSetId: value.evalSetId,
            segmentId: value.segmentId,
            mode: value.mode,
            source: value.source,
            target: value.target ?? null,
            notes: value.notes ?? null,
            status: value.status,
            error: value.error ?? null,
            promptManifest: value.promptManifest ?? null,
            executionManifest: value.executionManifest ?? null,
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }, activity(
        `${artifactId}.activity`, timestamp, "artifact_update", value.status === "completed" ? "done" : "error",
        `Evaluated ${value.segmentId}`, `${completedSegmentIds.size}/${input.totalSegments} segments`, [artifactId],
      )]);
    },
    complete(usage, timestamp = new Date().toISOString()) {
      settleActiveRoles("complete", timestamp);
      terminal("complete", timestamp, "Private eval complete", `${completedSegmentIds.size}/${input.totalSegments} segments`);
      if (usage) projectUsage(usage, timestamp);
    },
    stop(usage, timestamp = new Date().toISOString()) {
      settleActiveRoles("stopped", timestamp);
      terminal("stopped", timestamp, "Private eval stopped", `${completedSegmentIds.size}/${input.totalSegments} segments preserved`);
      if (usage) projectUsage(usage, timestamp);
    },
    fail(error, usage, timestamp = new Date().toISOString()) {
      // A failed artifact append must not prevent the terminal failure state
      // from becoming durable. The caller still receives the original error.
      queue = queue.catch(() => undefined);
      settleActiveRoles("failed", timestamp);
      terminal("failed", timestamp, "Private eval failed", error instanceof Error ? error.message : String(error));
      if (usage) projectUsage(usage, timestamp);
    },
    flush: () => queue,
  };
}
