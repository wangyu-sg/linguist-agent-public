import { randomUUID } from "node:crypto";
import { isAbsolute, relative } from "node:path";
import { realpath } from "node:fs/promises";
import {
  createTaskWorkspace,
  createWorkspace,
  formatAssistantMemoryRecallReport,
  pendingInitialTaskRun,
  readProjectManifest,
  safeLogger,
  searchAssistantMemories,
  TaskWorkspaceConflictError,
  type AssistantMemoryPersistence,
  type LibraryPersistence,
  type TaskMessageQueue,
  type TaskScope,
  type TaskRunEventDraft,
} from "@linguist-agent/cat-data";
import {
  buildCatCompactionInstructionsFromManifest,
  buildCatCompactionInstructionsForWorkspace,
  buildCatStreamRetryInstruction,
  CAT_SEGMENT_RUN_TOOLS,
  classifyCatRuntimeRecovery,
  createCatSelfHealingRetryState,
  createCatStreamRuleMonitor,
  extractCatRuntimeValidation,
  markCatSelfHealingCompacted,
  planCatSelfHealingRetry,
  shouldAbortForCatStreamViolation,
  type AgentPermissionContract,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
  type CatStreamRuleViolation,
  type NativeCapabilityPackageId,
} from "@linguist-agent/cat-runtime";
import { createAssistantMemoryTools } from "@linguist-agent/cat-tools";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { AgentTraceBuilder, previewValue, type AgentTraceEvent } from "../agent_events.js";
import { prepareDirectImageAttachments, withAttachmentContext } from "../direct_image_attachments.js";
import { createPrepareTeamExecutionTool } from "../main_team_host_tool.js";
import {
  describeCatWorkerServerTools,
  finalizeCatWorkerSessionPlan,
  type CatWorkerSessionAuthority,
  type CatWorkerSessionCreation,
  type CatWorkerSessionPlanV1,
} from "../cat_worker_runtime.js";
import { createSingleTaskRunProjector, type SingleTaskRunProjector } from "../single_task_run_projection.js";
import { createTaskSessionStopBridge } from "../task_session_stop_bridge.js";
import {
  completeTaskExtensionFatalFailure,
  createTaskExtensionInteractionHost,
  persistTaskExtensionFatalFallback,
} from "../task_extension_interactions.js";
import { TaskMessageQueueCoordinator } from "../task_message_queue.js";
import {
  resolveTaskRunResources,
  serverOwnedRunDisabledTools,
} from "../task_run_resources.js";
import {
  mergeTaskPackageIsolatedResources,
  resolveTaskPackageRunResources,
} from "../task_package_profile.js";
import { ActiveAgentRunRegistry } from "../active_agent_runs.js";

export type ProjectTaskThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ProjectTaskChatEvent {
  ts: string;
  kind: "user" | "assistant" | "tool" | "system" | "error";
  text: string;
  sessionId?: string;
  sessionFile?: string;
  toolCallId?: string;
  usage?: { inputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number; modelCalls?: number };
}

export interface ProjectTaskStreamEvent {
  type: "turn_start" | "user" | "assistant_delta" | "assistant_thinking_started" | "assistant_final" | "tool_start" | "tool_end" | "compaction_start" | "compaction_end" | "retry_start" | "retry_end" | "stream_rule_violation" | "sandbox_denied" | "permission_request" | "queue_update" | "stopped" | "error" | "done";
  ts: string;
  turnId?: string;
  sessionId?: string;
  sessionFile?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsPreview?: string;
  resultPreview?: string;
  isError?: boolean;
  errorMessage?: string;
  validationWarnings?: string[];
  validationErrors?: string[];
  reason?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  firstKeptEntryId?: string;
  aborted?: boolean;
  willRetry?: boolean;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retrySuccess?: boolean;
  recoveryKind?: string;
  recoveryAction?: string;
  recoveryRetryable?: boolean;
  ruleCode?: string;
  ruleSeverity?: "warning" | "blocker";
  ruleAction?: "observe_only" | "abort_and_retry";
  ruleMatch?: string;
  ruleOffset?: number;
  permissionRequest?: AgentPermissionRequest & { requestId: string; createdAt: string; expiresAt: string };
  messageQueue?: TaskMessageQueue;
  chat?: ProjectTaskChatEvent[];
  usage?: ProjectTaskChatEvent["usage"];
}

export interface ProjectTaskRunOptions {
  expectedRunId?: string;
  segmentId?: string;
  segmentSource?: string;
  parentRunId?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ProjectTaskThinkingLevel;
  attachmentPaths?: string[];
  attachmentRefs?: string[];
  capabilityIds?: NativeCapabilityPackageId[];
  sessionId: string;
  taskId: string;
  taskScope: TaskScope;
}

export interface ProjectTaskRunCoordinatorDeps {
  repoRoot: string;
  activeRuns: ActiveAgentRunRegistry;
  messageQueue: TaskMessageQueueCoordinator;
  workerRuntime: CatWorkerSessionAuthority;
  readProjectSummary: (projectId: string) => Promise<{ batches: Array<{ batchId: string; format: string; segments: number; confirmed: number; draft: number; new: number; locked: number }> } | undefined>;
  resolveSessionId: (projectId: string) => Promise<string>;
  consumePendingBranchEntry: (projectId: string, sessionId: string) => Promise<string | undefined>;
  readAgentSettings: (projectId: string) => Promise<{ modelProvider?: string; modelId?: string; thinkingLevel?: ProjectTaskThinkingLevel; disabledTools?: string[] }>;
  readModelDefaults: () => Promise<{ effectiveProvider?: string; effectiveModel?: string; effectiveThinkingLevel?: ProjectTaskThinkingLevel }>;
  readProviderCatalog: () => Promise<{ providers: Array<{ id: unknown; kind: unknown; models: Array<{ id: unknown; available?: unknown; input?: unknown }> }> }>;
  projectPermissionContract: (projectId: string, taskId: string, operationId: string) => Promise<AgentPermissionContract>;
  projectPermissionSessionOptions: (projectId: string, emit: (event: ProjectTaskStreamEvent) => void, taskId: string, runId: string) => Promise<{
    permissionContract: AgentPermissionContract;
    requestPermissionDecision: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>;
  }>;
  createSupportSession: (plan: CatWorkerSessionPlanV1, operation: string) => Promise<CatWorkerSessionCreation>;
  readSessionStats: (path: string, projectId: string, sessionId: string) => Promise<{ contextTokens: number | null }>;
  projectSessionInfo: (projectId: string, sessionId: string) => Promise<unknown>;
  readTaskPackageRunResources: (projectId: string, taskId: string) => Promise<Awaited<ReturnType<typeof resolveTaskPackageRunResources>>>;
  prepareTeamExecution: (input: { projectId: string; taskId: string; runId: string; reason: string }) => ReturnType<Parameters<typeof createPrepareTeamExecutionTool>[0]>;
  syncTaskTitle: (input: { projectId: string; taskId: string; title: string }) => Promise<void>;
  cancelPermissionDecisions: (sessionId: string, reason: string) => void;
  assistantMemoryStore: () => AssistantMemoryPersistence | undefined;
  assistantLibraryStore: () => LibraryPersistence | undefined;
  formatTaskRuntimeScope: (scope: TaskScope) => string[];
}

export interface ProjectTaskCompactionResult {
  result: {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    estimatedTokensAfter?: number;
    details?: unknown;
  };
  session: unknown;
}

const CAT_STREAM_RULE_MAX_RETRIES = 1;

function streamRuleTraceInput(violation: ReturnType<ReturnType<typeof createCatStreamRuleMonitor>["observeDelta"]>[number]) {
  return {
    piEventType: "message_update",
    text: violation.message,
    isError: violation.severity === "blocker",
    ruleCode: violation.code,
    ruleSeverity: violation.severity,
    ruleAction: violation.action,
    ruleMatch: violation.match,
    ruleOffset: violation.offset,
  };
}

function buildStreamRuleRetryPrompt(basePrompt: string, violation: CatStreamRuleViolation, attempt: number, maxAttempts: number): string {
  const instruction = buildCatStreamRetryInstruction(violation);
  return [
    basePrompt,
    "",
    "CAT stream-rule recovery:",
    `Retry ${attempt}/${maxAttempts}.`,
    `Reason: ${instruction.reason}`,
    instruction.correctiveInstruction,
    "Do not mention the aborted draft unless the user explicitly asks about runtime recovery.",
  ].join("\n");
}

function recoveryTraceInput(input: { message?: string; toolName?: string; validationErrors?: string[]; isToolError?: boolean }) {
  const recovery = classifyCatRuntimeRecovery(input);
  return {
    recovery,
    trace: {
      reason: recovery.reason,
      recoveryKind: recovery.kind,
      recoveryAction: recovery.action,
      recoveryRetryable: recovery.retryable,
    },
  };
}

function sandboxDeniedTraceInput(event: { result?: unknown; toolName?: string }) {
  const message = previewValue(event.result, 240);
  return {
    isDenied: Boolean(message && /\b(sandbox(?:ed)? denied|operation not permitted|permission denied|denyWrite|denyRead|egress denied|not allowed by sandbox|seatbelt)\b/i.test(message)),
    trace: {
      reason: `Sandbox denied ${event.toolName ?? "tool"} execution.`,
      recoveryKind: "sandbox_denied",
      recoveryAction: "blocked_by_harness",
      recoveryRetryable: false,
    },
  };
}

function assistantMessageError(message: unknown): string | undefined {
  const assistant = message as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
  if (!assistant || assistant.role !== "assistant") return undefined;
  if (assistant.stopReason !== "error" && assistant.stopReason !== "aborted") return undefined;
  return assistant.errorMessage?.trim() || `Request ${assistant.stopReason}`;
}

function assistantMessageHasThinking(message: unknown): boolean {
  const content = (message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) && content.some((part) => {
    const row = part as { type?: unknown; thinking?: unknown };
    return row?.type === "thinking" && typeof row.thinking === "string" && row.thinking.trim().length > 0;
  });
}

function assistantMessageUsage(message: unknown): ProjectTaskChatEvent["usage"] {
  const usage = (message as { usage?: { input?: unknown; cacheRead?: unknown; cacheWrite?: unknown; output?: unknown; totalTokens?: unknown; cost?: { total?: unknown } } } | undefined)?.usage;
  if (!usage) return undefined;
  const number = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  return {
    inputTokens: number(usage.input),
    cacheReadTokens: number(usage.cacheRead),
    cacheWriteTokens: number(usage.cacheWrite),
    outputTokens: number(usage.output),
    totalTokens: number(usage.totalTokens),
    costUsd: number(usage.cost?.total),
    modelCalls: 1,
  };
}

/**
 * Owns Project Task compaction's Run activity and Pi support-session use case.
 * The server supplies infrastructure handles; it does not retain this Task/Run
 * state transition or Pi session orchestration inline.
 */
export class ProjectTaskRunCoordinator {
  constructor(private readonly deps: ProjectTaskRunCoordinatorDeps) {}

  private async appendCompactionActivity(input: {
    projectId: string;
    taskId: string;
    operationId: string;
    phase: "start" | "completed" | "failed";
    body?: string;
  }): Promise<void> {
    const workspace = createTaskWorkspace(this.deps.repoRoot);
    const snapshot = await workspace.open({ projectId: input.projectId, taskId: input.taskId });
    const run = [...snapshot.runs].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1);
    if (!run) throw new Error("Task context cannot be compacted before its first Agent run.");
    const thread = snapshot.agentThreads.find((candidate) => candidate.id === run.rootAgentThreadId);
    if (!thread) throw new Error(`Task run ${run.id} has no root Agent thread.`);
    const occurredAt = new Date().toISOString();
    const status = input.phase === "start" ? "running" : input.phase === "failed" ? "error" : "done";
    const title = input.phase === "start" ? "Compacting context" : input.phase === "failed" ? "Context compaction failed" : "Context compacted";
    const event: TaskRunEventDraft = {
      type: "activity_append",
      agentThreadId: thread.id,
      occurredAt,
      activity: {
        id: `${input.operationId}.${input.phase}`,
        taskId: input.taskId,
        runId: run.id,
        agentThreadId: thread.id,
        seq: 1,
        type: input.phase === "failed" ? "error" : "progress",
        status,
        actor: { kind: "system", id: "pi-runtime", displayName: "Pi Runtime", agentThreadId: thread.id },
        title,
        body: input.body ?? null,
        tool: null,
        refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    };
    await workspace.appendGenerated({ projectId: input.projectId, taskId: input.taskId, runId: run.id, events: [event] });
  }

  async compact(projectId: string, taskId: string, customInstructions?: string, requestedSessionId?: string): Promise<ProjectTaskCompactionResult> {
    const operationId = `task-compaction-${randomUUID()}`;
    await this.appendCompactionActivity({ projectId, taskId, operationId, phase: "start" });
    const manifest = await readProjectManifest(this.deps.repoRoot, projectId);
    const summary = await this.deps.readProjectSummary(projectId);
    const workspace = createWorkspace(this.deps.repoRoot, projectId);
    const sessionId = requestedSessionId ?? await this.deps.resolveSessionId(projectId);
    const branchEntryId = await this.deps.consumePendingBranchEntry(projectId, sessionId);
    const agentSettings = await this.deps.readAgentSettings(projectId);
    const modelDefaults = await this.deps.readModelDefaults();
    const permissionContract = await this.deps.projectPermissionContract(projectId, taskId, operationId);
    const created = await this.deps.createSupportSession(finalizeCatWorkerSessionPlan({
      schemaVersion: 1,
      profile: "cat",
      runtimeRoot: this.deps.repoRoot,
      workspace: { root: workspace.root, projectId: workspace.projectId },
      taskId,
      runId: operationId,
      modelProvider: agentSettings.modelProvider ?? modelDefaults.effectiveProvider ?? null,
      modelId: agentSettings.modelId ?? modelDefaults.effectiveModel ?? null,
      thinkingLevel: agentSettings.thinkingLevel ?? modelDefaults.effectiveThinkingLevel ?? null,
      sessionId,
      branchEntryId: branchEntryId ?? null,
      sessionMode: "project",
      disabledTools: serverOwnedRunDisabledTools(agentSettings.disabledTools),
      preset: "cat",
      runOptions: null,
      isolatedResources: {},
      runtimeExtension: true,
      permissionContract,
      serverTools: [],
      extensionBinding: false,
    }), "Project Session compaction");
    const { session } = created;
    const beforeStats = session.sessionFile
      ? await this.deps.readSessionStats(session.sessionFile, projectId, session.sessionId)
      : undefined;
    try {
      const result = await session.compact(buildCatCompactionInstructionsFromManifest(
        manifest,
        summary?.batches.map((batch) => ({
          batchId: batch.batchId,
          format: batch.format,
          segments: batch.segments,
          confirmed: batch.confirmed,
          draft: batch.draft,
          new: batch.new,
          locked: batch.locked,
        })),
        customInstructions,
      ));
      const effectiveTokensBefore = result.tokensBefore || (typeof beforeStats?.contextTokens === "number" ? beforeStats.contextTokens : 0);
      await this.appendCompactionActivity({
        projectId,
        taskId,
        operationId,
        phase: "completed",
        body: [`${effectiveTokensBefore} tokens before compaction`, result.estimatedTokensAfter !== undefined ? `${result.estimatedTokensAfter} estimated after` : undefined].filter(Boolean).join(" · "),
      });
      return {
        result: { summary: result.summary, firstKeptEntryId: result.firstKeptEntryId, tokensBefore: effectiveTokensBefore, estimatedTokensAfter: result.estimatedTokensAfter, details: result.details },
        session: await this.deps.projectSessionInfo(projectId, sessionId),
      };
    } catch (error) {
      await this.appendCompactionActivity({ projectId, taskId, operationId, phase: "failed", body: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await created.dispose();
    }
  }
  private async prepareProjectDirectImageAttachments(projectId: string, attachmentPaths: string[] = []) {
    if (attachmentPaths.length === 0) return { images: [], labels: [], imageLabels: [] };
    const manifest = await readProjectManifest(this.deps.repoRoot, projectId);
    const assets = new Map(manifest.scan.assets.map((asset) => [asset.relPath, asset]));
    const projectRoot = await realpath(manifest.root);
    const selected = [] as Array<{ path: string; label: string }>;
    for (const relPath of attachmentPaths) {
      const asset = assets.get(relPath);
      if (!asset) throw new TaskWorkspaceConflictError(`Unknown Project asset attachment: ${relPath}.`);
      const absolute = await realpath(asset.path);
      const rel = relative(projectRoot, absolute);
      if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\\\") || isAbsolute(rel)) {
        throw new TaskWorkspaceConflictError(`Project asset attachment escaped the Project root: ${asset.relPath}.`);
      }
      selected.push({ path: absolute, label: asset.relPath });
    }
    return prepareDirectImageAttachments(selected);
  }

  private async confirmedMemoryRecallForCat(projectId: string, query = ""): Promise<string> {
    const store = this.deps.assistantMemoryStore();
    if (!store) throw new Error("SQLite assistant memory storage is not ready.");
    if (!query.trim()) return "";
    const manifest = await readProjectManifest(this.deps.repoRoot, projectId).catch(() => undefined);
    const report = await searchAssistantMemories(this.deps.repoRoot, {
      query,
      context: {
        projectId,
        ...(manifest?.targetLanguage ? { locale: manifest.targetLanguage } : {}),
        includePersonal: true,
      },
      store,
    });
    return formatAssistantMemoryRecallReport(report);
  }
  async run(
    projectId: string,
    message: string,
    rawEmit: (event: ProjectTaskStreamEvent) => void,
    options: ProjectTaskRunOptions,
  ): Promise<ProjectTaskChatEvent[]> {
  let taskProjector: SingleTaskRunProjector | undefined;
  const emit = (event: ProjectTaskStreamEvent): void => {
    rawEmit(event);
    taskProjector?.accept(event);
  };
  const workspace = createWorkspace(this.deps.repoRoot, projectId);
  let assistantParts: string[] = [];
  let thinkingStarted = false;
  let assistantEndError: string | undefined;
  let assistantUsage: ProjectTaskChatEvent["usage"];
  const toolParts: Array<{ text: string; toolCallId?: string }> = [];
  const trace: AgentTraceEvent[] = [];
  const selfHealing = createCatSelfHealingRetryState();
  const selectedSessionId = options.sessionId;
  const agentSettings = await this.deps.readAgentSettings(projectId);
  const modelDefaults = await this.deps.readModelDefaults();
  const selectedModelProvider = options.modelProvider ?? agentSettings.modelProvider ?? modelDefaults.effectiveProvider;
  const selectedModelId = options.modelId ?? agentSettings.modelId ?? modelDefaults.effectiveModel;
  const selectedThinkingLevel = options.thinkingLevel ?? agentSettings.thinkingLevel ?? modelDefaults.effectiveThinkingLevel;
  if (!selectedModelProvider || !selectedModelId) {
    throw new TaskWorkspaceConflictError("No model is configured for this Task Run.");
  }
  const providerCatalog = await this.deps.readProviderCatalog();
  const selectedModel = providerCatalog.providers
    .find((provider) => provider.id === selectedModelProvider && provider.kind === "model")
    ?.models.find((model) => model.id === selectedModelId);
  if (!selectedModel?.available) {
    throw new TaskWorkspaceConflictError(`Model ${selectedModelProvider}/${selectedModelId} is not available for this Task Run.`);
  }
  const directAttachments = await this.prepareProjectDirectImageAttachments(projectId, options.attachmentPaths);
  if (directAttachments.images.length
    && (!Array.isArray(selectedModel.input) || !selectedModel.input.includes("image"))) {
    throw new TaskWorkspaceConflictError(`Model ${selectedModelProvider}/${selectedModelId} does not accept image input. Choose a vision-capable model or remove the image attachment.`);
  }
  const taskDisabledTools = serverOwnedRunDisabledTools(agentSettings.disabledTools);
  const segmentRunOptions = options.segmentId ? { tools: [...CAT_SEGMENT_RUN_TOOLS, "prepare_team_execution"] } : undefined;
  const taskSnapshot = await createTaskWorkspace(this.deps.repoRoot).open({ projectId, taskId: options.taskId });
  const queueLocator = { kind: "project" as const, projectId, taskId: options.taskId };
  const normalizedMessage = message.trim();
  const memoryRecall = await this.confirmedMemoryRecallForCat(projectId, normalizedMessage);
  const pendingInitial = pendingInitialTaskRun(taskSnapshot, normalizedMessage, options.expectedRunId);
  if (options.expectedRunId && !pendingInitial) {
    throw new TaskWorkspaceConflictError(
      `Task ${options.taskId} Run ${options.expectedRunId} is no longer pending for this message.`,
    );
  }
  const turnId = pendingInitial?.run.id ?? `turn_${randomUUID()}`;
  const permissionOptions = await this.deps.projectPermissionSessionOptions(projectId, emit, options.taskId, turnId);
  const startedAt = new Date().toISOString();
  const threadId = `${turnId}.main`;
  const stopBridge = createTaskSessionStopBridge();
  let extensionInteractionFatalError: Error | undefined;
  let rejectExtensionFatal!: (error: Error) => void;
  const extensionFatal = new Promise<never>((_resolve, reject) => { rejectExtensionFatal = reject; });
  void extensionFatal.catch(() => undefined);
  const interactionHost = createTaskExtensionInteractionHost({
    repoRoot: this.deps.repoRoot,
    projectId,
    taskId: options.taskId,
    runId: turnId,
    agentThreadId: threadId,
    onFatalError: (error) => {
      if (extensionInteractionFatalError) return;
      extensionInteractionFatalError = error;
      rejectExtensionFatal(error);
      void stopBridge.registrySession.abort().catch(() => undefined);
    },
  });
  const releaseRunStart = this.deps.activeRuns.acquireRunStartLease();
  let runRegistered = false;
  try {
    this.deps.activeRuns.register({
      turnId,
      sessionId: selectedSessionId,
      scope: "project",
      projectId,
      taskId: options.taskId,
      parentRunId: options.parentRunId,
      beforeAbort: async () => {
        await this.deps.messageQueue.pause(queueLocator, "interrupted");
        this.deps.cancelPermissionDecisions(selectedSessionId, "permission request cancelled because the Task was stopped");
        await interactionHost.prepareStop();
      },
      session: stopBridge.registrySession,
    });
    runRegistered = true;
    taskProjector = await createSingleTaskRunProjector({
      repoRoot: this.deps.repoRoot,
      projectId,
      taskId: options.taskId,
      runId: turnId,
      userMessage: message,
      startedAt,
      modelRoute: `${selectedModelProvider}/${selectedModelId}`,
      focusedSegmentId: options.segmentId,
      evidenceRefs: options.attachmentRefs,
      preprojected: Boolean(pendingInitial),
    });
    await taskProjector.flush();
  } catch (error) {
    if (runRegistered) this.deps.activeRuns.unregister(turnId);
    await interactionHost.dispose().catch(() => undefined);
    throw error;
  } finally {
    releaseRunStart();
  }

  let createdSession: CatWorkerSessionCreation;
  try {
    const resources = await resolveTaskRunResources("main", { cwd: this.deps.repoRoot }, options.capabilityIds);
    const taskPackageResources = await this.deps.readTaskPackageRunResources(projectId, options.taskId);
    if (this.deps.activeRuns.isStoppingOrStopped(turnId)) throw new Error("Agent run stopped while resolving Task resources.");
    const serverTools = [
      ...createAssistantMemoryTools({
        runtimeRoot: this.deps.repoRoot,
        scope: { kind: "project" as const, projectId },
        sourceTaskId: options.taskId,
        store: this.deps.assistantMemoryStore(),
      }),
      createPrepareTeamExecutionTool(async (reason) => {
        await taskProjector?.flush();
        const prepared = await this.deps.prepareTeamExecution({
          projectId,
          taskId: options.taskId,
          runId: turnId,
          reason,
        });
        taskProjector?.markTeamPrepared();
        return prepared;
      }),
    ];
    const serverToolByName = new Map(serverTools.map((tool) => [tool.name, tool]));
    const plan = finalizeCatWorkerSessionPlan({
      schemaVersion: 1,
      profile: "cat",
      runtimeRoot: this.deps.repoRoot,
      workspace: { root: workspace.root, projectId: workspace.projectId },
      taskId: options.taskId,
      runId: turnId,
      modelProvider: selectedModelProvider,
      modelId: selectedModelId,
      thinkingLevel: selectedThinkingLevel ?? null,
      sessionId: selectedSessionId,
      sessionMode: "project",
      branchEntryId: null,
      preset: "cat",
      disabledTools: taskDisabledTools,
      runOptions: segmentRunOptions ?? null,
      isolatedResources: mergeTaskPackageIsolatedResources(resources.isolatedResources, taskPackageResources.isolatedResources),
      runtimeExtension: true,
      permissionContract: permissionOptions.permissionContract,
      serverTools: describeCatWorkerServerTools(serverTools),
      extensionBinding: true,
      memoryRecall,
    });
    createdSession = await this.deps.workerRuntime.createSession({
      plan,
      executionIdentity: {
        executionId: `${turnId}.execution.1`,
        threadId,
        turnId,
        runtimeEpochId: `${turnId}.epoch.1`,
        configRevision: 1,
        executionProfile: null,
        createdAt: startedAt,
      },
      persistExecutionSnapshot: (snapshot) => taskProjector!.setExecutionSnapshot(snapshot),
      requestPermissionDecision: permissionOptions.requestPermissionDecision,
      executeServerTool: async (name, toolCallId, toolInput, signal) => {
        const tool = serverToolByName.get(name);
        if (!tool) throw new Error(`CAT worker requested unknown server tool ${name}.`);
        const execute = tool.execute as unknown as (id: string, input: unknown, signal: AbortSignal) => Promise<unknown>;
        return execute(toolCallId, toolInput, signal);
      },
      requestUi: (request) => {
        if (request.method === "select") return interactionHost.uiContext.select(request.title, request.options ?? [], request.dialog);
        if (request.method === "confirm") return interactionHost.uiContext.confirm(request.title, request.message ?? "", request.dialog);
        if (request.method === "input") return interactionHost.uiContext.input(request.title, request.message, request.dialog);
        return interactionHost.uiContext.editor(request.title, request.message);
      },
      notifyUi: (notification, level) => interactionHost.uiContext.notify(notification, level),
      libraryPersistence: this.deps.assistantLibraryStore(),
    });
    this.deps.activeRuns.bindWorkerIdentity(turnId, {
      workerId: createdSession.workerId,
      runtimeEpochId: createdSession.runtimeEpochId,
    });
    stopBridge.bind(createdSession.session);
    const workerEventBus: EventBus = {
      emit: (channel, data) => createdSession.emitExtensionEvent(channel, data),
      on: (channel, handler) => createdSession.onExtensionEvent((candidate, data) => {
        if (candidate === channel) handler(data);
      }),
    };
    interactionHost.bindEvents(workerEventBus);
    const mergedPackages = Array.from(new Map([
      ...resources.manifest.packages,
      ...taskPackageResources.packages,
    ].map((entry) => [entry.name, entry])).values());
    await taskProjector.setResourceManifest({
      ...resources.manifest,
      packages: mergedPackages,
      ...(taskPackageResources.profileRevision > 0 || taskPackageResources.selections.length > 0
        ? {
            profileRevision: taskPackageResources.profileRevision,
            profileHash: taskPackageResources.profileHash,
            resources: taskPackageResources.selections,
          }
        : {}),
      activeToolNames: createdSession.requestShape.activeToolNames,
      requestShapeHash: createdSession.requestShape.requestShapeHash,
      systemPromptHash: createdSession.requestShape.systemPromptHash,
      toolSurfaceHash: createdSession.requestShape.toolSurfaceHash,
      resourceIndexHash: createdSession.requestShape.resourceIndexHash,
      requestShape: {
        schemaVersion: createdSession.requestShape.schemaVersion,
        systemPromptChars: createdSession.requestShape.systemPromptChars,
        activeToolCount: createdSession.requestShape.activeToolCount,
        resourceCount: createdSession.requestShape.resourceCount,
      },
      mainSurface: {
        packageNames: mergedPackages.map(({ name }) => name),
        requestShape: createdSession.requestShape,
      },
    });
    stopBridge.throwIfForcedStopped();
  } catch (error) {
    const ts = new Date().toISOString();
    const stoppedDuringSetup = stopBridge.isForcedStopError(error) || this.deps.activeRuns.isStoppingOrStopped(turnId);
    if (stoppedDuringSetup) {
      void interactionHost.prepareStop().catch(() => undefined);
      void interactionHost.dispose().catch(() => undefined);
    } else {
      await interactionHost.dispose().catch(() => undefined);
    }
    emit({
      type: stoppedDuringSetup ? "stopped" : "error",
      ts,
      turnId,
      sessionId: selectedSessionId,
      ...(stoppedDuringSetup
        ? { text: "Agent run stopped by user." }
        : { isError: true, errorMessage: error instanceof Error ? error.message : String(error) }),
    });
    await taskProjector.flush();
    this.deps.activeRuns.unregister(turnId);
    if (stoppedDuringSetup) {
      return [
        { ts, kind: "user", text: message, sessionId: selectedSessionId },
        { ts, kind: "system", text: "Agent run stopped by user.", sessionId: selectedSessionId },
      ];
    }
    throw error;
  }
  const { session, requestShape } = createdSession;
  await this.deps.messageQueue.bindRun({
    locator: queueLocator,
    runId: turnId,
    threadId,
    session,
    onChange: (messageQueue) => emit({
      type: "queue_update",
      ts: new Date().toISOString(),
      turnId,
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
      messageQueue,
    }),
  });
  const syncCanonicalTaskTitle = async (): Promise<void> => {
    const latest = await createTaskWorkspace(this.deps.repoRoot).open({ projectId, taskId: options.taskId });
    await this.deps.syncTaskTitle({ projectId, taskId: options.taskId, title: latest.task.title });
  };
  // Naming is important durable metadata, but it must never prevent the
  // canonical Task Run from starting. Late title completion and the finally
  // sync below both converge the Pi session without another model call.
  await syncCanonicalTaskTitle().catch((error) => {
    safeLogger.warn("task.title_session_sync_failed", { error });
  });
  const sessionMeta = { sessionId: session.sessionId, sessionFile: session.sessionFile };
  const traceBuilder = new AgentTraceBuilder({ projectId, ...sessionMeta, turnId });
  // A focused-segment conversation can contain explanations, source quotes,
  // or Chinese operator text. It is still not a candidate write.
  let streamRules = createCatStreamRuleMonitor();
  let pendingStreamRuleRetry: CatStreamRuleViolation | undefined;
  let retryAbortRequested = false;
  let streamRuleRetries = 0;
  const requestStreamRuleRetry = (violation: CatStreamRuleViolation, abortActiveTurn = true): void => {
    if (pendingStreamRuleRetry || !shouldAbortForCatStreamViolation(violation)) return;
    pendingStreamRuleRetry = violation;
    if (!abortActiveTurn || streamRuleRetries >= CAT_STREAM_RULE_MAX_RETRIES) return;
    retryAbortRequested = true;
    void session.abort().catch((error) => {
      const traceEvent = traceBuilder.event("error", {
        piEventType: "stream_rule_abort_error",
        isError: true,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      trace.push(traceEvent);
      emit({
        type: "error",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        isError: true,
        errorMessage: traceEvent.errorMessage,
      });
    });
  };
  const started = traceBuilder.event("turn_start", {
    piEventType: "turn_start",
    text: message,
    requestShapeHash: requestShape.requestShapeHash,
    systemPromptHash: requestShape.systemPromptHash,
    toolSurfaceHash: requestShape.toolSurfaceHash,
    resourceIndexHash: requestShape.resourceIndexHash,
    systemPromptChars: requestShape.systemPromptChars,
    activeToolCount: requestShape.activeToolCount,
    resourceCount: requestShape.resourceCount,
  });
  trace.push(started);
  emit({
    type: "turn_start",
    ts: started.ts,
    turnId: started.turnId,
    ...sessionMeta,
    text: message,
  });
  const publishThinkingStarted = (): void => {
    if (thinkingStarted) return;
    thinkingStarted = true;
    const traceEvent = traceBuilder.event("assistant_thinking_started", {
      piEventType: "thinking_started",
    });
    trace.push(traceEvent);
    emit({
      type: "assistant_thinking_started",
      ts: traceEvent.ts,
      turnId: traceEvent.turnId,
      ...sessionMeta,
    });
  };
  session.subscribe((event) => {
    const ts = new Date().toISOString();
    if (extensionInteractionFatalError && event.type === "tool_execution_end" && event.toolName === "ask_user") return;
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      assistantParts.push(event.assistantMessageEvent.delta);
      emit({
        type: "assistant_delta",
        ts,
        turnId: traceBuilder.turnId,
        ...sessionMeta,
        text: event.assistantMessageEvent.delta,
      });
      for (const violation of streamRules.observeDelta(event.assistantMessageEvent.delta)) {
        const traceEvent = traceBuilder.event("stream_rule_violation", streamRuleTraceInput(violation));
        trace.push(traceEvent);
        emit({
          type: "stream_rule_violation",
          ts: traceEvent.ts,
          turnId: traceEvent.turnId,
          ...sessionMeta,
          text: traceEvent.text,
          isError: traceEvent.isError,
          ruleCode: traceEvent.ruleCode,
          ruleSeverity: traceEvent.ruleSeverity,
          ruleAction: traceEvent.ruleAction,
          ruleMatch: traceEvent.ruleMatch,
          ruleOffset: traceEvent.ruleOffset,
        });
        requestStreamRuleRetry(violation);
      }
    }
    if (
      event.type === "message_update"
      && event.assistantMessageEvent.type === "thinking_delta"
    ) {
      publishThinkingStarted();
    }
    if (event.type === "message_end") {
      if (assistantMessageHasThinking(event.message)) publishThinkingStarted();
      assistantEndError = assistantMessageError(event.message) ?? assistantEndError;
      assistantUsage = assistantMessageUsage(event.message) ?? assistantUsage;
    }
    if (event.type === "queue_update") {
      void this.deps.messageQueue.syncPiQueue({
        locator: queueLocator,
        runId: turnId,
        followUp: event.followUp,
      }).catch((error) => {
        safeLogger.warn("task.message_queue_sync_failed", { error });
      });
    }
    if (event.type === "tool_execution_start") {
      toolParts.push({ text: `tool_start ${event.toolName}`, toolCallId: event.toolCallId });
      const traceEvent = traceBuilder.event("tool_start", {
        piEventType: event.type,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        argsPreview: previewValue(event.args),
      });
      trace.push(traceEvent);
      emit({
        type: "tool_start",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        argsPreview: traceEvent.argsPreview,
      });
    }
    if (event.type === "tool_execution_end") {
      toolParts.push({ text: `tool_end ${event.toolName} ${event.isError ? "error" : "ok"}`, toolCallId: event.toolCallId });
      const validation = extractCatRuntimeValidation(event.result);
      const denied = sandboxDeniedTraceInput({ result: event.result, toolName: event.toolName });
      const isDenied = denied.isDenied;
      const recovery = isDenied
        ? denied.trace
        : event.isError || validation?.errors.length
        ? recoveryTraceInput({
            message: event.isError ? previewValue(event.result, 240) : validation?.errors.join("; "),
            toolName: event.toolName,
            isToolError: event.isError,
            validationErrors: validation?.errors,
          }).trace
        : undefined;
      const traceEvent = traceBuilder.event(isDenied ? "sandbox_denied" : "tool_end", {
        piEventType: event.type,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: isDenied || event.isError || Boolean(validation?.errors.length),
        resultPreview: previewValue(event.result),
        errorMessage: isDenied || event.isError ? previewValue(event.result, 240) : validation?.errors.join("; "),
        validationWarnings: validation?.warnings.length ? validation.warnings : undefined,
        validationErrors: validation?.errors.length ? validation.errors : undefined,
        ...recovery,
      });
      trace.push(traceEvent);
      emit({
        type: isDenied ? "sandbox_denied" : "tool_end",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: traceEvent.isError,
        resultPreview: traceEvent.resultPreview,
        errorMessage: traceEvent.errorMessage,
        validationWarnings: traceEvent.validationWarnings,
        validationErrors: traceEvent.validationErrors,
        recoveryKind: traceEvent.recoveryKind,
        recoveryAction: traceEvent.recoveryAction,
        recoveryRetryable: traceEvent.recoveryRetryable,
      });
    }
    if (event.type === "compaction_start") {
      const traceEvent = traceBuilder.event("compaction_start", {
        piEventType: event.type,
        reason: event.reason,
        text: `Pi compaction started: ${event.reason}`,
      });
      trace.push(traceEvent);
      emit({
        type: "compaction_start",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        reason: event.reason,
        text: traceEvent.text,
      });
    }
    if (event.type === "compaction_end") {
      if (!event.errorMessage && !event.aborted) markCatSelfHealingCompacted(selfHealing);
      const traceEvent = traceBuilder.event("compaction_end", {
        piEventType: event.type,
        reason: event.reason,
        tokensBefore: event.result?.tokensBefore,
        estimatedTokensAfter: event.result?.estimatedTokensAfter,
        firstKeptEntryId: event.result?.firstKeptEntryId,
        aborted: event.aborted,
        willRetry: event.willRetry,
        isError: Boolean(event.errorMessage),
        errorMessage: event.errorMessage,
        text: event.result?.summary,
      });
      trace.push(traceEvent);
      emit({
        type: "compaction_end",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        reason: event.reason,
        tokensBefore: event.result?.tokensBefore,
        estimatedTokensAfter: event.result?.estimatedTokensAfter,
        firstKeptEntryId: event.result?.firstKeptEntryId,
        aborted: event.aborted,
        willRetry: event.willRetry,
        isError: Boolean(event.errorMessage),
        errorMessage: event.errorMessage,
        text: event.result?.summary,
      });
    }
    if (event.type === "auto_retry_start") {
      const traceEvent = traceBuilder.event("retry_start", {
        piEventType: event.type,
        text: `Provider retry ${event.attempt}/${event.maxAttempts}`,
        errorMessage: event.errorMessage,
        retryAttempt: event.attempt,
        retryMaxAttempts: event.maxAttempts,
      });
      trace.push(traceEvent);
      emit({
        type: "retry_start",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        text: traceEvent.text,
        errorMessage: event.errorMessage,
        retryAttempt: event.attempt,
        retryMaxAttempts: event.maxAttempts,
      });
    }
    if (event.type === "auto_retry_end") {
      const traceEvent = traceBuilder.event("retry_end", {
        piEventType: event.type,
        isError: !event.success,
        errorMessage: event.finalError,
        retrySuccess: event.success,
      });
      trace.push(traceEvent);
      emit({
        type: "retry_end",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        isError: !event.success,
        errorMessage: event.finalError,
        retrySuccess: event.success,
      });
    }
  });

  let promptError: unknown;
  let stoppedByUser = false;
  // Project context is injected once per turn by the cat-runtime before_agent_start
  // hook; embedding the snapshot here again doubled every turn's context cost.
  const basePrompt = [
    options.taskId ? `Current task: ${options.taskId}` : "",
    ...this.deps.formatTaskRuntimeScope(options.taskScope),
    options.segmentId ? `Focused segment: ${options.segmentId}` : "",
    options.segmentSource ? `Focused segment source: ${options.segmentSource}` : "",
    options.capabilityIds?.length ? `Enabled Run capabilities: ${options.capabilityIds.join(", ")}` : "",
    `When using batch_read, use an imported batch_id from "imported_batches". Do not conclude a batch is unimported just because it appears in raw scanned assets.`,
    ``,
    `User request: ${message}`,
    ``,
    `Use CAT tools when project/batch evidence is needed. Keep the answer operational and list next concrete actions.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
  try {
    stopBridge.throwIfForcedStopped();
    if (this.deps.activeRuns.isStoppingOrStopped(started.turnId)) {
      throw new Error("Agent run stopped before the first prompt.");
    }
    let promptText = withAttachmentContext(basePrompt, directAttachments.labels, directAttachments.imageLabels);
    let preserveStreamState = false;
    for (;;) {
      if (preserveStreamState) {
        // Output-cutoff continuation: keep streamed text and stream-rule state.
        preserveStreamState = false;
      } else {
        assistantParts = [];
        assistantEndError = undefined;
        streamRules = createCatStreamRuleMonitor();
      }
      pendingStreamRuleRetry = undefined;
      retryAbortRequested = false;
      try {
        await Promise.race([session.prompt(promptText, directAttachments.images.length ? { images: directAttachments.images } : undefined), extensionFatal, stopBridge.forcedStop]);
        stopBridge.throwIfForcedStopped();
        if (assistantEndError && !pendingStreamRuleRetry) throw new Error(assistantEndError);
      } catch (error) {
        if (extensionInteractionFatalError) throw extensionInteractionFatalError;
        if (stopBridge.isForcedStopError(error)) throw error;
        if (!pendingStreamRuleRetry) {
          const { recovery, trace: recoveryTrace } = recoveryTraceInput({
            message: error instanceof Error ? error.message : String(error),
          });
          const plan = planCatSelfHealingRetry(recovery, selfHealing);
          if (plan) {
            const traceEvent = traceBuilder.event("retry_start", {
              piEventType: plan.piEventType,
              text: `Self-healing retry: ${recovery.reason}`,
              retryAttempt: 1,
              retryMaxAttempts: 1,
              ...recoveryTrace,
            });
            trace.push(traceEvent);
            emit({
              type: "retry_start",
              ts: traceEvent.ts,
              turnId: traceEvent.turnId,
              ...sessionMeta,
              text: traceEvent.text,
              retryAttempt: traceEvent.retryAttempt,
              retryMaxAttempts: traceEvent.retryMaxAttempts,
              recoveryKind: traceEvent.recoveryKind,
              recoveryAction: traceEvent.recoveryAction,
              recoveryRetryable: traceEvent.recoveryRetryable,
            });
            if (plan.compactFirst) {
              await Promise.race([
                session.compact(await buildCatCompactionInstructionsForWorkspace(workspace, recovery.correctiveInstruction)),
                stopBridge.forcedStop,
              ]);
            }
            if (plan.delayMs > 0) {
              await Promise.race([
                new Promise((resolve) => setTimeout(resolve, plan.delayMs)),
                stopBridge.forcedStop,
              ]);
            }
            stopBridge.throwIfForcedStopped();
            preserveStreamState = plan.preserveStreamState;
            promptText = `${basePrompt}${plan.promptSuffix}`;
            continue;
          }
          throw error;
        }
        if (streamRuleRetries >= CAT_STREAM_RULE_MAX_RETRIES) break;
      }

      if (!pendingStreamRuleRetry) {
        for (const violation of streamRules.finalize()) {
          const traceEvent = traceBuilder.event("stream_rule_violation", streamRuleTraceInput(violation));
          trace.push(traceEvent);
          emit({
            type: "stream_rule_violation",
            ts: traceEvent.ts,
            turnId: traceEvent.turnId,
            ...sessionMeta,
            text: traceEvent.text,
            isError: traceEvent.isError,
            ruleCode: traceEvent.ruleCode,
            ruleSeverity: traceEvent.ruleSeverity,
            ruleAction: traceEvent.ruleAction,
            ruleMatch: traceEvent.ruleMatch,
            ruleOffset: traceEvent.ruleOffset,
          });
          requestStreamRuleRetry(violation, false);
        }
      }
      if (!pendingStreamRuleRetry || streamRuleRetries >= CAT_STREAM_RULE_MAX_RETRIES) break;

      streamRuleRetries += 1;
      const retryInstruction = buildCatStreamRetryInstruction(pendingStreamRuleRetry);
      const traceEvent = traceBuilder.event("retry_start", {
        piEventType: retryAbortRequested ? "stream_rule_abort" : "stream_rule_retry",
        text: `CAT stream-rule retry ${streamRuleRetries}/${CAT_STREAM_RULE_MAX_RETRIES}: ${retryInstruction.reason}`,
        reason: retryInstruction.reason,
        retryAttempt: streamRuleRetries,
        retryMaxAttempts: CAT_STREAM_RULE_MAX_RETRIES,
      });
      trace.push(traceEvent);
      emit({
        type: "retry_start",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        text: traceEvent.text,
        reason: traceEvent.reason,
        retryAttempt: traceEvent.retryAttempt,
        retryMaxAttempts: traceEvent.retryMaxAttempts,
      });
      promptText = buildStreamRuleRetryPrompt(basePrompt, pendingStreamRuleRetry, streamRuleRetries, CAT_STREAM_RULE_MAX_RETRIES);
    }
    if (pendingStreamRuleRetry && streamRuleRetries >= CAT_STREAM_RULE_MAX_RETRIES) {
      const retryInstruction = buildCatStreamRetryInstruction(pendingStreamRuleRetry);
      const traceEvent = traceBuilder.event("retry_end", {
        piEventType: "stream_rule_retry_exhausted",
        isError: true,
        reason: retryInstruction.reason,
        errorMessage: `CAT stream-rule retry circuit breaker exhausted: ${retryInstruction.reason}`,
        retrySuccess: false,
      });
      trace.push(traceEvent);
      emit({
        type: "retry_end",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        isError: true,
        reason: traceEvent.reason,
        errorMessage: traceEvent.errorMessage,
        retrySuccess: false,
      });
      throw new Error(`CAT stream-rule retry circuit breaker exhausted: ${retryInstruction.reason}`);
    }
    if (streamRuleRetries > 0) {
      const traceEvent = traceBuilder.event("retry_end", {
        piEventType: "stream_rule_retry_end",
        retrySuccess: true,
      });
      trace.push(traceEvent);
      emit({
        type: "retry_end",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        retrySuccess: true,
      });
    }
    for (const used of selfHealing.used) {
      const traceEvent = traceBuilder.event("retry_end", {
        piEventType: "self_healing_retry_end",
        recoveryKind: used.kind,
        recoveryAction: used.action,
        recoveryRetryable: true,
        retrySuccess: true,
      });
      trace.push(traceEvent);
      emit({
        type: "retry_end",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        recoveryKind: traceEvent.recoveryKind,
        recoveryAction: traceEvent.recoveryAction,
        recoveryRetryable: traceEvent.recoveryRetryable,
        retrySuccess: true,
      });
    }
    await interactionHost.flush();
    stopBridge.throwIfForcedStopped();
    if (extensionInteractionFatalError) throw extensionInteractionFatalError;
  } catch (error) {
    if (stopBridge.isForcedStopError(error) || this.deps.activeRuns.isStoppingOrStopped(started.turnId)) {
      stoppedByUser = true;
      void interactionHost.prepareStop().catch(() => undefined);
      emit({
        type: "stopped",
        ts: new Date().toISOString(),
        turnId: started.turnId,
        ...sessionMeta,
        text: "Agent run stopped by user.",
        usage: assistantUsage,
      });
    } else {
      await interactionHost.dispose().catch(() => undefined);
      promptError = error;
      const { trace: recoveryTrace } = recoveryTraceInput({
        message: error instanceof Error ? error.message : String(error),
      });
      const traceEvent = traceBuilder.event("error", {
        piEventType: "prompt_error",
        isError: true,
        errorMessage: error instanceof Error ? error.message : String(error),
        ...recoveryTrace,
      });
      trace.push(traceEvent);
      const promptFailure: ProjectTaskStreamEvent = {
        type: "error",
        ts: traceEvent.ts,
        turnId: traceEvent.turnId,
        ...sessionMeta,
        isError: true,
        errorMessage: traceEvent.errorMessage,
        recoveryKind: traceEvent.recoveryKind,
        recoveryAction: traceEvent.recoveryAction,
        recoveryRetryable: traceEvent.recoveryRetryable,
        usage: assistantUsage,
      };
      if (extensionInteractionFatalError) {
        const fatalPersistence = await interactionHost.fatalPersistence();
        await completeTaskExtensionFatalFailure({
          fatalPersistence,
          emitRaw: () => { rawEmit(promptFailure); },
          persistFallback: async () => {
            await persistTaskExtensionFatalFallback({
              repoRoot: this.deps.repoRoot,
              projectId,
              taskId: options.taskId,
              runId: started.turnId,
              failedAt: promptFailure.ts,
            });
          },
        });
      } else {
        emit(promptFailure);
      }
    }
  } finally {
    if (stoppedByUser) void interactionHost.dispose().catch(() => undefined);
    else await interactionHost.dispose().catch(() => undefined);
    await syncCanonicalTaskTitle().catch(() => undefined);
    await this.deps.messageQueue.finishRun({
      locator: queueLocator,
      runId: started.turnId,
      ...(promptError && !stoppedByUser ? { error: promptError } : {}),
    }).catch(() => undefined);
    this.deps.activeRuns.unregister(started.turnId);
  }

  const now = new Date().toISOString();
  const assistantText = assistantParts.join("").trim() || "(no final response)";
  if (!promptError && !stoppedByUser) {
    const finalTrace = traceBuilder.event("assistant_final", { piEventType: "assistant_final", text: assistantText });
    trace.push(finalTrace);
    emit({
      type: "assistant_final",
      ts: finalTrace.ts,
      turnId: finalTrace.turnId,
      ...sessionMeta,
      text: assistantText,
      usage: assistantUsage,
    });
  }
  await taskProjector?.flush();

  const chatEvents: ProjectTaskChatEvent[] = stoppedByUser
    ? [
        { ts: now, kind: "user", text: message, ...sessionMeta },
        ...toolParts.map((part) => ({ ts: now, kind: "tool" as const, text: part.text, toolCallId: part.toolCallId, ...sessionMeta })),
        { ts: new Date().toISOString(), kind: "system", text: "Agent run stopped by user.", ...sessionMeta },
      ]
    : promptError
    ? [
        { ts: now, kind: "user", text: message, ...sessionMeta },
        ...toolParts.map((part) => ({ ts: now, kind: "tool" as const, text: part.text, toolCallId: part.toolCallId, ...sessionMeta })),
        {
          ts: new Date().toISOString(),
          kind: "error",
          text: promptError instanceof Error ? promptError.message : String(promptError),
          ...sessionMeta,
        },
      ]
    : [
        { ts: now, kind: "user", text: message, ...sessionMeta },
        ...toolParts.map((part) => ({ ts: now, kind: "tool" as const, text: part.text, toolCallId: part.toolCallId, ...sessionMeta })),
        { ts: new Date().toISOString(), kind: "assistant", text: assistantText, usage: assistantUsage, ...sessionMeta },
      ];
  if (promptError) throw promptError;
  return chatEvents;
}
}
