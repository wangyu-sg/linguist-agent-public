import { createHash, randomUUID } from "node:crypto";
import {
  createTaskWorkspace,
  requireProjectTaskScope,
  type TaskArtifactStatus,
  type TaskArtifactType,
  type TaskDecisionKind,
  type TaskDecisionOption,
  type TaskRunEventDraft,
} from "@linguist-agent/cat-data";
import { bindTaskDecision } from "./task_decision_binding.js";

interface PipelineArtifact {
  type: TaskArtifactType;
  status?: TaskArtifactStatus;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  key?: string;
  decisions?: Array<{
    key: string;
    kind: TaskDecisionKind;
    prompt: string;
    options: TaskDecisionOption[];
    selectedOptionId: string;
    reason: string;
  }>;
}

/** Project one deterministic batch action into its owning Task without changing the action's domain result. */
export async function runTaskPipeline<Result>(input: {
  repoRoot: string;
  projectId: string;
  batchId: string;
  taskId?: string;
  operation: "quality_audit" | "quality_waiver" | "delivery_readiness" | "delivery_qa" | "delivery_qa_review" | "delivery_export";
  title: string;
  execute: () => Promise<Result>;
  artifact: (result: Result) => PipelineArtifact;
}): Promise<Result> {
  if (!input.taskId) return input.execute();
  const workspace = createTaskWorkspace(input.repoRoot);
  const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
  if (requireProjectTaskScope(snapshot.task.scope, "Pipeline Task").batchId !== input.batchId) throw new Error("Task pipeline batch scope does not match the requested batch.");

  const runId = `pipeline_${randomUUID()}`;
  const threadId = `${runId}.main`;
  const startedAt = new Date().toISOString();
  const identity = {
    kind: "deterministic" as const,
    roleId: input.operation,
    displayName: input.operation === "delivery_export" ? "Delivery Export"
      : input.operation === "delivery_readiness" ? "Delivery Readiness"
      : input.operation.startsWith("quality_") ? "Quality Audit"
      : "Delivery QA",
    roleLabel: "CAT Pipeline",
    disclosureLabel: "System" as const,
  };
  const activity = (
    id: string,
    timestamp: string,
    status: "running" | "done" | "error",
    title: string,
    body: string | null,
    artifactIds: string[] = [],
    decisionIds: string[] = [],
  ): TaskRunEventDraft => ({
    type: "activity_append",
    agentThreadId: threadId,
    occurredAt: timestamp,
    activity: {
      id,
      taskId: input.taskId!,
      runId,
      agentThreadId: threadId,
      seq: 1,
      type: status === "error" ? "error" : status === "done" ? "artifact_update" : "progress",
      status,
      actor: { kind: "system", id: input.operation, displayName: identity.displayName, agentThreadId: threadId },
      title,
      body,
      tool: null,
      refs: { artifactIds, evidenceRefs: [], decisionIds },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });
  const thread = (status: "active" | "complete" | "failed", timestamp: string, latestActivityId: string | null): TaskRunEventDraft => ({
    type: "thread_upsert",
    agentThreadId: threadId,
    occurredAt: timestamp,
    thread: {
      id: threadId,
      taskId: input.taskId!,
      runId,
      parentThreadId: null,
      identity,
      status,
      canReceiveUserMessage: false,
      handoffSummary: null,
      latestActivityId,
      childThreadIds: [],
      createdAt: startedAt,
      updatedAt: timestamp,
    },
  });
  const run = (status: "active" | "complete" | "failed", timestamp: string): TaskRunEventDraft => ({
    type: "run_upsert",
    agentThreadId: threadId,
    occurredAt: timestamp,
    run: {
      id: runId,
      taskId: input.taskId!,
      mode: "pipeline",
      status,
      rootAgentThreadId: threadId,
      planHash: null,
      estimatedCalls: 0,
      modelRoutes: { pipeline: "system/cat-kernel" },
      startedAt,
      updatedAt: timestamp,
      completedAt: status === "active" ? null : timestamp,
      stopAvailable: false,
      resumeAvailable: false,
    },
  });
  const append = (events: TaskRunEventDraft[]) => workspace.appendGenerated({
    projectId: input.projectId,
    taskId: input.taskId!,
    runId,
    events,
  });
  const startActivityId = `${runId}.${input.operation}.${Date.now()}.started`;
  await append([run("active", startedAt), thread("active", startedAt, startActivityId), activity(startActivityId, startedAt, "running", input.title, input.batchId)]);

  try {
    const result = await input.execute();
    const finishedAt = new Date().toISOString();
    const artifact = input.artifact(result);
    const suffix = artifact.key?.replace(/[^A-Za-z0-9._-]+/g, "-")
      ?? createHash("sha256").update(JSON.stringify(artifact.content)).digest("hex").slice(0, 16);
    const artifactId = `pipeline.${input.operation}.${createHash("sha256").update(`${input.taskId}\0${suffix}`).digest("hex").slice(0, 24)}`;
    const doneActivityId = `${runId}.${input.operation}.completed`;
    const decisions = (artifact.decisions ?? []).map((decision) => ({
      id: `pipeline.decision.${createHash("sha256").update(`${input.taskId}\0${decision.key}`).digest("hex").slice(0, 24)}`,
      value: decision,
    }));
    const events: TaskRunEventDraft[] = [run("complete", finishedAt), thread("complete", finishedAt, doneActivityId), {
      type: "artifact_upsert",
      agentThreadId: threadId,
      occurredAt: finishedAt,
      artifact: {
        id: artifactId,
        taskId: input.taskId,
        runId,
        type: artifact.type,
        status: artifact.status ?? "final",
        title: artifact.title,
        summary: artifact.summary,
        scope: snapshot.task.scope,
        version: 1,
        provenance: { agentThreadId: threadId, activityId: doneActivityId, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: [],
        content: artifact.content,
        createdAt: finishedAt,
        updatedAt: finishedAt,
      },
    }];
    events.push(...decisions.map(({ id, value }): TaskRunEventDraft => ({
      type: "decision_upsert",
      agentThreadId: threadId,
      occurredAt: finishedAt,
      decision: bindTaskDecision({
        id,
        taskId: input.taskId!,
        runId,
        requestedByThreadId: threadId,
        artifactId,
        kind: value.kind,
        status: "recorded",
        prompt: value.prompt,
        options: value.options,
        selectedOptionId: value.selectedOptionId,
        reason: value.reason,
        scope: snapshot.task.scope,
        createdAt: finishedAt,
        decidedAt: finishedAt,
      }, { runPlanHash: null }),
    })));
    events.push(activity(doneActivityId, finishedAt, "done", artifact.title, artifact.summary, [artifactId], decisions.map(({ id }) => id)));
    await append(events);
    return result;
  } catch (error) {
    const failedAt = new Date().toISOString();
    const errorId = `${runId}.${input.operation}.${Date.now()}.failed`;
    const events: TaskRunEventDraft[] = [run("failed", failedAt), thread("failed", failedAt, errorId), activity(errorId, failedAt, "error", `${input.title} failed`, error instanceof Error ? error.message : String(error))];
    await append(events);
    throw error;
  }
}
