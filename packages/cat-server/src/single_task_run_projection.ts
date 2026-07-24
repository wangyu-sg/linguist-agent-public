import { createHash } from "node:crypto";
import {
  appendTaskExecutionSnapshot,
  createTaskWorkspace,
  pendingInitialTaskRun,
  TaskWorkspaceConflictError,
  type TaskActivity,
  type TaskActivityStatus,
  type TaskActivityType,
  type TaskRunEventDraft,
  type TaskExecutionSnapshot,
  type TaskRun,
  type TaskRunResourceManifest,
  type TaskRunStatus,
  type TaskLocator,
} from "@linguist-agent/cat-data";
import { previewValue } from "./agent_events.js";
import { isCatEvidenceTool, taskToolEffect } from "./subagent_task_activity_bridge.js";

export interface SingleTaskRunSignal {
  type: string;
  ts: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsPreview?: string;
  resultPreview?: string;
  isError?: boolean;
  errorMessage?: string;
  reason?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retrySuccess?: boolean;
  permissionRequest?: {
    requestId?: string;
    toolName: string;
    domain: string;
    riskClass: string;
    argsSummary: string;
  };
  capabilityActivation?: {
    query: string;
    addedToolNames: string[];
    matchedToolNames: string[];
  };
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number; modelCalls?: number };
}

export interface SingleTaskRunProjectorInput {
  repoRoot: string;
  projectId?: string;
  locator?: TaskLocator;
  taskId: string;
  runId: string;
  userMessage: string;
  startedAt: string;
  modelRoute: string;
  focusedSegmentId?: string;
  evidenceRefs?: string[];
  preprojected?: boolean;
  parentThreadId?: string | null;
}

export interface SingleTaskRunProjector {
  accept(signal: SingleTaskRunSignal): void;
  markTeamPrepared(): void;
  setExecutionSnapshot(snapshot: TaskExecutionSnapshot): Promise<void>;
  setResourceManifest(manifest: TaskRunResourceManifest): Promise<void>;
  flush(): Promise<void>;
}

function canonicalLocator(input: { taskId: string; projectId?: string; locator?: TaskLocator }): TaskLocator {
  if (input.locator) {
    if (input.locator.taskId !== input.taskId) throw new Error("Task locator taskId does not match projector taskId.");
    return input.locator;
  }
  if (!input.projectId) throw new Error("A projectId or canonical Task locator is required.");
  return { kind: "project", projectId: input.projectId, taskId: input.taskId };
}

export async function stopPendingSingleTaskRun(input: {
  repoRoot: string;
  projectId?: string;
  locator?: TaskLocator;
  taskId: string;
  runId?: string;
  reason?: string;
}): Promise<boolean> {
  const workspace = createTaskWorkspace(input.repoRoot);
  const locator = canonicalLocator(input);
  const snapshot = await workspace.open(locator);
  const pending = pendingInitialTaskRun(snapshot, undefined, input.runId);
  if (!pending) return false;
  const stoppedAt = new Date().toISOString();
  try {
    await workspace.appendGenerated({
      ...locator,
      runId: pending.run.id,
      expectedActiveRun: { id: pending.run.id, status: "pending", startedAt: null },
      events: [{
        type: "activity_append",
        agentThreadId: pending.thread.id,
        occurredAt: stoppedAt,
        activity: {
          id: `${pending.run.id}.stopped`,
          taskId: input.taskId,
          runId: pending.run.id,
          agentThreadId: pending.thread.id,
          seq: 1,
          type: "progress",
          status: "blocked",
          actor: { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: pending.thread.id },
          title: "Task stopped",
          body: input.reason?.trim() || "Stopped before the Agent run started.",
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
          createdAt: stoppedAt,
          updatedAt: stoppedAt,
        },
      }, {
        type: "run_upsert",
        agentThreadId: pending.thread.id,
        occurredAt: stoppedAt,
        run: {
          ...pending.run,
          status: "stopped",
          updatedAt: stoppedAt,
          completedAt: stoppedAt,
          stopAvailable: false,
          resumeAvailable: true,
        },
      }, {
        type: "thread_upsert",
        agentThreadId: pending.thread.id,
        occurredAt: stoppedAt,
        thread: { ...pending.thread, status: "stopped", updatedAt: stoppedAt },
      }],
    });
    return true;
  } catch (error) {
    if (error instanceof TaskWorkspaceConflictError) return false;
    throw error;
  }
}

const AGENT_ID = "linguist-agent";
const AGENT_NAME = "Linguist Agent";

function bounded(value: string | undefined, limit = 800): string | null {
  const text = value?.trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit - 14)}... [truncated]`;
}

function boundedPreview(value: string | undefined, limit = 800): string | null {
  if (value === undefined) return null;
  return bounded(previewValue(value, limit), limit);
}

function snapshotHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function modelIdentity(route: string): { providerId: string | null; modelId: string | null } {
  const separator = route.indexOf("/");
  return separator > 0 && separator < route.length - 1
    ? { providerId: route.slice(0, separator), modelId: route.slice(separator + 1) }
    : { providerId: null, modelId: null };
}

export async function createSingleTaskRunProjector(input: SingleTaskRunProjectorInput): Promise<SingleTaskRunProjector> {
  const workspace = createTaskWorkspace(input.repoRoot);
  const locator = canonicalLocator(input);
  const snapshot = await workspace.open(locator);
  const threadId = `${input.runId}.main`;
  let queue = Promise.resolve();
  let teamPrepared = false;
  let responseSequence = 0;
  let timelineCreated = snapshot.runs.some((run) => run.id === input.runId);

  const append = (
    events: TaskRunEventDraft[],
    expectedActiveRun?: { id: string; status: TaskRunStatus; startedAt?: string | null },
  ): void => {
    queue = queue.then(async () => {
      await workspace.appendGenerated({
        ...locator,
        runId: input.runId,
        expectedActiveRun,
        events,
      });
    });
  };

  const activity = (
    id: string,
    timestamp: string,
    type: TaskActivityType,
    status: TaskActivityStatus,
    title: string,
    body: string | null,
    tool: TaskActivity["tool"] = null,
    artifactIds: string[] = [],
    actor: TaskActivity["actor"] = { kind: "agent", id: AGENT_ID, displayName: AGENT_NAME, agentThreadId: threadId },
    evidenceRefs: string[] = [],
  ): TaskRunEventDraft => ({
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
      actor,
      title,
      body,
      tool,
      refs: {
        artifactIds,
        evidenceRefs,
        decisionIds: [],
        segmentIds: input.focusedSegmentId ? [input.focusedSegmentId] : [],
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });

  const lifecycle = (status: TaskRunStatus, timestamp: string): TaskRunEventDraft[] => {
    const initializeTimeline = !timelineCreated;
    timelineCreated = true;
    return [{
    type: "run_upsert",
    agentThreadId: threadId,
    occurredAt: timestamp,
    run: {
      id: input.runId,
      taskId: input.taskId,
      mode: teamPrepared ? "team" : "single",
      status,
      rootAgentThreadId: threadId,
      planHash: null,
      estimatedCalls: 1,
      estimatedCallsBySource: { main: 1 },
      modelRoutes: { main: input.modelRoute },
      startedAt: input.startedAt,
      updatedAt: timestamp,
      completedAt: ["stopped", "failed", "complete"].includes(status) ? timestamp : null,
      stopAvailable: status === "active",
      resumeAvailable: status === "stopped" || status === "failed",
      ...(initializeTimeline ? { executionSnapshots: [], configChanges: [] } : {}),
    },
  }, {
    type: "thread_upsert",
    agentThreadId: threadId,
    occurredAt: timestamp,
    thread: {
      id: threadId,
      taskId: input.taskId,
      runId: input.runId,
      parentThreadId: input.parentThreadId ?? null,
      identity: { kind: "main", roleId: AGENT_ID, displayName: AGENT_NAME, roleLabel: "Main Agent", disclosureLabel: "Agent" },
      status,
      canReceiveUserMessage: true,
      handoffSummary: null,
      latestActivityId: null,
      childThreadIds: [],
      createdAt: input.startedAt,
      updatedAt: timestamp,
    },
  }];
  };

  if (input.preprojected) {
    append(
      lifecycle("active", input.startedAt),
      { id: input.runId, status: "pending", startedAt: null },
    );
  } else {
    append([
      ...lifecycle("active", input.startedAt),
      activity(
        `${input.runId}.message`,
        input.startedAt,
        "message",
        "done",
        "You",
        input.userMessage.trim() || null,
        null,
        [],
        { kind: "human", id: "user", displayName: "You", agentThreadId: threadId },
        input.evidenceRefs,
      ),
    ]);
  }

  return {
    markTeamPrepared() {
      teamPrepared = true;
    },
    setExecutionSnapshot(execution) {
      queue = queue.then(async () => {
        const current = await workspace.open(locator);
        const run = current.runs.find((candidate) => candidate.id === input.runId);
        if (!run) throw new Error(`Run ${input.runId} is not projected.`);
        const nextRun = appendTaskExecutionSnapshot(run, execution);
        await workspace.appendGenerated({
          ...locator,
          runId: input.runId,
          events: [{
            type: "run_upsert",
            agentThreadId: run.rootAgentThreadId,
            occurredAt: execution.createdAt,
            run: nextRun,
          }],
        });
      });
      return queue;
    },
    setResourceManifest(manifest) {
      queue = queue.then(async () => {
        const current = await workspace.open(locator);
        const run = current.runs.find((candidate) => candidate.id === input.runId);
        if (!run) throw new Error(`Run ${input.runId} is not projected.`);
        let nextRun: TaskRun = { ...run, resourceManifest: manifest };
        if (run.executionSnapshots?.length === 0 && run.configChanges?.length === 0) {
          const identity = modelIdentity(input.modelRoute);
          const execution: TaskExecutionSnapshot = {
            schemaVersion: 1,
            executionId: `${input.runId}.execution.1`,
            runId: input.runId,
            threadId,
            turnId: input.runId,
            runtimeEpochId: `${input.runId}.epoch.1`,
            configRevision: 1,
            ...identity,
            reasoningEffort: null,
            executionProfile: null,
            promptHash: manifest.systemPromptHash ?? "",
            toolManifestHash: manifest.toolSurfaceHash ?? "",
            resourceSnapshotHash: manifest.resourceIndexHash ?? "",
            capabilityGrantHash: snapshotHash([...(manifest.fileGrantIds ?? [])].sort()),
            contextInputHash: snapshotHash({
              userMessage: input.userMessage,
              evidenceRefs: [...(input.evidenceRefs ?? [])].sort(),
              parentThreadId: input.parentThreadId ?? null,
            }),
            createdAt: new Date().toISOString(),
          };
          nextRun = appendTaskExecutionSnapshot(nextRun, execution);
        }
        await workspace.appendGenerated({
          ...locator,
          runId: input.runId,
          events: [{
            type: "run_upsert",
            agentThreadId: run.rootAgentThreadId,
            occurredAt: run.updatedAt,
            run: nextRun,
          }],
        });
      });
      return queue;
    },
    accept(signal) {
      const suffix = (signal.toolCallId ?? signal.type).replace(/[^A-Za-z0-9._-]+/g, "-");
      const eventKey = signal.ts.replace(/[^A-Za-z0-9]+/g, "");
      const usage = signal.usage ? {
        type: "usage_update" as const,
        agentThreadId: threadId,
        occurredAt: signal.ts,
        usageSource: "main",
        usage: {
          inputTokens: signal.usage.inputTokens,
          outputTokens: signal.usage.outputTokens,
          totalTokens: signal.usage.totalTokens,
          costUSD: signal.usage.costUsd,
          modelCalls: signal.usage.modelCalls,
        },
      } : undefined;
      if (signal.type === "tool_start" && signal.toolName) {
        const evidence = isCatEvidenceTool(signal.toolName);
        const argsPreview = boundedPreview(signal.argsPreview);
        append([activity(
          `${input.runId}.tool.${suffix}.start`, signal.ts,
          evidence ? "evidence_read" : "tool_action", "running",
          `${AGENT_NAME} started ${signal.toolName}`, argsPreview,
          { name: signal.toolName, effect: taskToolEffect(signal.toolName), target: boundedPreview(signal.argsPreview, 240), outcome: null },
        )]);
      } else if ((signal.type === "tool_end" || signal.type === "sandbox_denied") && signal.toolName) {
        const evidence = isCatEvidenceTool(signal.toolName);
        const failed = signal.type === "sandbox_denied" || Boolean(signal.isError);
        append([activity(
          `${input.runId}.tool.${suffix}.end`, signal.ts,
          evidence ? "evidence_read" : "tool_action", failed ? "error" : "done",
          `${AGENT_NAME} ${failed ? "failed" : "completed"} ${signal.toolName}`,
          boundedPreview(signal.errorMessage ?? signal.resultPreview),
          { name: signal.toolName, effect: taskToolEffect(signal.toolName), target: null, outcome: failed ? "failed" : "completed" },
        )]);
      } else if (signal.type === "assistant_final") {
        const artifactId = `${input.runId}.result`;
        const finalText = signal.text?.trim() || "(no final response)";
        append([
          {
            type: "artifact_upsert",
            agentThreadId: threadId,
            occurredAt: signal.ts,
            artifact: {
              id: artifactId,
              taskId: input.taskId,
              runId: input.runId,
              type: "preview",
              status: "final",
              title: "Agent result",
              summary: bounded(finalText, 240),
              scope: snapshot.task.scope,
              version: 1,
              provenance: { agentThreadId: threadId, activityId: `${input.runId}.final`, evidenceRefs: [], parentArtifactIds: [] },
              availableDecisions: [],
              content: { kind: "agent_result", text: finalText },
              createdAt: signal.ts,
              updatedAt: signal.ts,
            },
          },
          activity(`${input.runId}.final`, signal.ts, "final_response", "done", teamPrepared ? "Team plan ready" : "Task complete", finalText, null, [artifactId]),
          ...(teamPrepared ? [] : lifecycle("complete", signal.ts)),
          ...(usage ? [usage] : []),
        ]);
      } else if (signal.type === "capability_activation" && signal.capabilityActivation) {
        const activation = signal.capabilityActivation;
        append([activity(
          `${input.runId}.capability.${eventKey}`,
          signal.ts,
          "tool_action",
          "done",
          activation.addedToolNames.length ? "Capabilities activated" : "Capabilities already active",
          [
            `Query: ${activation.query}`,
            `Matched: ${activation.matchedToolNames.join(", ") || "none"}`,
            `Added: ${activation.addedToolNames.join(", ") || "none"}`,
          ].join("\n"),
          {
            name: "capability_search",
            effect: "read",
            target: bounded(activation.query, 240),
            outcome: bounded(activation.addedToolNames.join(", ") || "already active", 240),
          },
        )]);
      } else if (signal.type === "resource_conflict") {
        append([activity(
          `${input.runId}.resource-conflict.${eventKey}`,
          signal.ts,
          "progress",
          "done",
          "Pi resource conflicts resolved",
          bounded(signal.text, 4_000),
        )]);
      } else if (signal.type === "assistant_message") {
        responseSequence += 1;
        const responseKey = `${eventKey}.${responseSequence}`;
        const artifactId = `${input.runId}.result.${responseKey}`;
        const finalText = signal.text?.trim() || "(no final response)";
        append([
          {
            type: "artifact_upsert",
            agentThreadId: threadId,
            occurredAt: signal.ts,
            artifact: {
              id: artifactId,
              taskId: input.taskId,
              runId: input.runId,
              type: "preview",
              status: "final",
              title: "Agent result",
              summary: bounded(finalText, 240),
              scope: snapshot.task.scope,
              version: 1,
              provenance: { agentThreadId: threadId, activityId: `${input.runId}.response.${responseKey}`, evidenceRefs: [], parentArtifactIds: [] },
              availableDecisions: [],
              content: { kind: "agent_result", text: finalText },
              createdAt: signal.ts,
              updatedAt: signal.ts,
            },
          },
          activity(`${input.runId}.response.${responseKey}`, signal.ts, "final_response", "done", "Agent response", finalText, null, [artifactId]),
          ...(usage ? [usage] : []),
        ]);
      } else if (signal.type === "queue_update") {
        append([activity(
          `${input.runId}.queue.${eventKey}`,
          signal.ts,
          "progress",
          "done",
          "Message queue updated",
          bounded(signal.text),
        )]);
      } else if (signal.type === "done") {
        append(lifecycle("complete", signal.ts));
      } else if (signal.type === "compaction_start") {
        append([activity(`${input.runId}.compaction.${eventKey}.start`, signal.ts, "progress", "running", "Compacting context", bounded(signal.reason ?? signal.text))]);
      } else if (signal.type === "compaction_end") {
        const body = [
          signal.tokensBefore !== undefined ? `${signal.tokensBefore} tokens before` : undefined,
          signal.estimatedTokensAfter !== undefined ? `${signal.estimatedTokensAfter} estimated after` : undefined,
          signal.errorMessage ?? signal.text,
        ].filter(Boolean).join(" · ");
        append([activity(`${input.runId}.compaction.${eventKey}.end`, signal.ts, signal.isError ? "error" : "progress", signal.isError ? "error" : "done", signal.isError ? "Context compaction failed" : "Context compacted", bounded(body))]);
      } else if (signal.type === "retry_start") {
        const attempt = signal.retryAttempt !== undefined ? `Attempt ${signal.retryAttempt}${signal.retryMaxAttempts ? `/${signal.retryMaxAttempts}` : ""}` : undefined;
        append([activity(`${input.runId}.retry.${signal.retryAttempt ?? "current"}.${eventKey}.start`, signal.ts, "progress", "running", "Retrying Agent run", bounded([attempt, signal.reason ?? signal.text, signal.errorMessage].filter(Boolean).join(" · ")))]);
      } else if (signal.type === "retry_end") {
        const failed = signal.retrySuccess === false || signal.isError === true;
        append([activity(`${input.runId}.retry.${signal.retryAttempt ?? "current"}.${eventKey}.end`, signal.ts, failed ? "error" : "progress", failed ? "error" : "done", failed ? "Retry failed" : "Retry completed", bounded(signal.errorMessage ?? signal.text))]);
      } else if (signal.type === "runtime_diagnostic") {
        append([activity(
          `${input.runId}.runtime-diagnostic.${eventKey}`,
          signal.ts,
          "error",
          "error",
          "Runtime event diagnostic",
          bounded([signal.errorMessage, signal.text].filter(Boolean).join(": ")),
          null,
          [],
          { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: threadId },
        )]);
      } else if (signal.type === "permission_request" && signal.permissionRequest) {
        const request = signal.permissionRequest;
        const argsSummary = boundedPreview(request.argsSummary);
        append([activity(
          `${input.runId}.permission.${request.requestId ?? createPermissionRequestId(request)}`,
          signal.ts,
          "elicitation",
          "blocked",
          `Permission required · ${request.toolName}`,
          bounded([request.domain, request.riskClass, argsSummary].filter(Boolean).join(" · ")),
        )]);
      } else if (signal.type === "stopped") {
        append([
          activity(`${input.runId}.stopped`, signal.ts, "progress", "blocked", "Task stopped", bounded(signal.text)),
          ...lifecycle("stopped", signal.ts),
          ...(usage ? [usage] : []),
        ]);
      } else if (signal.type === "error") {
        append([
          activity(`${input.runId}.failed`, signal.ts, "error", "error", "Task failed", bounded(signal.errorMessage ?? signal.text)),
          ...lifecycle("failed", signal.ts),
          ...(usage ? [usage] : []),
        ]);
      }
    },
    flush: () => queue,
  };
}

function createPermissionRequestId(request: NonNullable<SingleTaskRunSignal["permissionRequest"]>): string {
  return `${request.toolName}-${request.domain}`.replace(/[^A-Za-z0-9._-]+/g, "-");
}
