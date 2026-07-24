import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import {
  createTaskWorkspace,
  formatAssistantMemoryRecallReport,
  parseRichArtifactDocument,
  resolveStandaloneFileGrantAccess,
  searchAssistantMemories,
  standaloneTaskWorkspaceRoot,
  TaskWorkspaceConflictError,
  writeJsonFile,
  type RichArtifactTodoStatus,
  type TaskAgentThread,
  type TaskRunEventDraft,
  type TaskWorkspaceSnapshot,
  type ExecutionProfileId,
  type ExecutionProfilePlan,
  safeLogger,
} from "@linguist-agent/cat-data";
import {
  buildAgentPermissionContract,
  prepareGeneralAgentSessionPlan,
  agentPermissionAction,
  generalAgentSessionId,
  type AgentRuntimeEvent,
  type AgentRuntimeImageContent,
  type AgentRuntimePort,
  type AgentRuntimeSession,
  type AgentRuntimeSessionCreation,
  assertRuntimeCompactionTarget,
  buildRuntimeCompactionHandoff,
  renderRuntimeCompactionInstructions,
  type AgentPermissionContract,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
  type GeneralDelegationRequest,
  type GeneralDelegationResult,
} from "@linguist-agent/cat-runtime";
import type { AssistantMemoryPersistence, LibraryPersistence } from "@linguist-agent/cat-data";
import { previewValue } from "./agent_events.js";
import {
  prepareDirectImageAttachments,
  visibleAttachmentMessage,
  withAttachmentContext,
} from "./direct_image_attachments.js";
import { ActiveAgentRunRegistry } from "./active_agent_runs.js";
import type { GeneralWorkerSessionAuthority, GeneralWorkerSessionCreation } from "./general_worker_runtime.js";
import {
  createSingleTaskRunProjector,
  stopPendingSingleTaskRun,
  type SingleTaskRunProjector,
} from "./single_task_run_projection.js";
import type { AcceptedStandaloneMessage, StandaloneAgentStreamEvent } from "./routes/standalone_task_routes.js";
import { TaskMessageQueueCoordinator } from "./task_message_queue.js";
import { resolveActivatedLapkgResources } from "./lapkg_activation.js";
import {
  hasGeneralContextResources,
  readPiTrustStatus,
  writePiTrustDecision,
  type PiDefaultProjectTrust,
} from "./pi_trust.js";

export interface GeneralModelRoute {
  provider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /** Requested quality name; direct provider/model selection omits it and becomes custom. */
  executionProfile?: ExecutionProfileId;
  /** Server-resolved immutable plan; callers never invent one in the renderer. */
  profilePlan?: ExecutionProfilePlan;
}

interface LiveGeneralRun {
  taskId: string;
  runId: string;
  session: AgentRuntimeSession;
  projector: SingleTaskRunProjector;
  rootThreadId: string;
}

export interface GeneralAgentRunCoordinatorDeps {
  repoRoot: string;
  /** Test/managed-runtime override; production uses Pi's canonical agent dir. */
  piAgentDir?: string;
  activeRuns: ActiveAgentRunRegistry;
  messageQueue: TaskMessageQueueCoordinator;
  runtimePort: AgentRuntimePort;
  workerRuntime: GeneralWorkerSessionAuthority;
  modelRoute: () => Promise<GeneralModelRoute>;
  /**
   * The server is the authority for whether a selected model is currently
   * usable. The Composer supplies a next-Run preference; it never bypasses
   * the provider catalog or turns into a client-owned runtime route.
   */
  resolveModelRoute?: (route: GeneralModelRoute) => Promise<GeneralModelRoute>;
  permissionContract: () => Promise<AgentPermissionContract>;
  defaultProjectTrust?: () => Promise<PiDefaultProjectTrust>;
  requestPermissionDecision: (
    request: AgentPermissionRequest,
    onPending: (request: AgentPermissionRequest & { requestId?: string }) => void,
  ) => Promise<AgentPermissionUserDecision>;
  cancelPermissionDecisions?: (sessionId: string, reason: string) => void;
  resolveManagedResources?: () => Promise<Awaited<ReturnType<typeof resolveActivatedLapkgResources>>>;
  assistantMemoryStore?: () => AssistantMemoryPersistence | undefined;
  libraryPersistence?: () => LibraryPersistence | undefined;
}

function usageFromMessage(message: unknown) {
  const usage = (message as { role?: string; usage?: {
    input?: unknown;
    output?: unknown;
    totalTokens?: unknown;
    cost?: { total?: unknown };
  } } | undefined)?.usage;
  if (!usage) return undefined;
  const number = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  return {
    inputTokens: number(usage.input),
    outputTokens: number(usage.output),
    totalTokens: number(usage.totalTokens),
    costUsd: number(usage.cost?.total),
    modelCalls: 1,
  };
}

function messageError(message: unknown): string | undefined {
  const row = message as { role?: string; stopReason?: string; errorMessage?: string } | undefined;
  if (row?.role !== "assistant" || (row.stopReason !== "error" && row.stopReason !== "aborted")) return undefined;
  return row.errorMessage?.trim() || `Request ${row.stopReason}`;
}

function assistantMessageText(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const row = part as { type?: unknown; text?: unknown };
    return row?.type === "text" && typeof row.text === "string" ? [row.text] : [];
  }).join("\n").trim();
}

function assistantMessageHasThinking(message: unknown): boolean {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    const row = part as { type?: unknown; thinking?: unknown };
    return row?.type === "thinking" && typeof row.thinking === "string" && row.thinking.trim().length > 0;
  });
}

function delegatedRole(value: string | undefined): string {
  const role = value?.trim() || "Research Agent";
  if (!/^[A-Za-z][A-Za-z0-9 &/.-]{0,79}$/.test(role)) {
    throw new Error("Delegated child role must be a short English label.");
  }
  return role;
}

function snapshotThinkingLevel(value: string | null): GeneralModelRoute["thinkingLevel"] {
  if (value === null) return undefined;
  if (["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)) {
    return value as GeneralModelRoute["thinkingLevel"];
  }
  throw new TaskWorkspaceConflictError("The stored ExecutionProfile has an unsupported reasoning effort; start a new Run instead.");
}

function acceptedContextHandoffs(snapshot: TaskWorkspaceSnapshot): string[] {
  return snapshot.artifacts
    .filter((artifact) => artifact.type === "context_handoff" && (artifact.status === "accepted" || artifact.status === "final"))
    .slice(-3)
    .map((artifact) => {
      const transcript = typeof artifact.content.transcript === "string" ? artifact.content.transcript.trim() : "";
      return [`Handoff: ${artifact.title}`, artifact.summary, transcript].filter(Boolean).join("\n").slice(0, 20_000);
    });
}

async function scopedGeneralMemorySnapshot(input: {
  runtimeRoot: string;
  query: string;
  store?: AssistantMemoryPersistence;
}): Promise<string> {
  if (!input.query.trim()) return "";
  const report = await searchAssistantMemories(input.runtimeRoot, {
    query: input.query,
    context: { includePersonal: true },
    store: input.store,
  });
  return formatAssistantMemoryRecallReport(report);
}

function pendingRunEvents(input: {
  taskId: string;
  runId: string;
  messageId: string;
  message: string;
  occurredAt: string;
  parentThread?: TaskAgentThread;
}): TaskRunEventDraft[] {
  const threadId = `${input.runId}.main`;
  return [{
    type: "run_upsert",
    agentThreadId: threadId,
    occurredAt: input.occurredAt,
    run: {
      id: input.runId,
      taskId: input.taskId,
      mode: "single",
      status: "pending",
      rootAgentThreadId: threadId,
      planHash: null,
      estimatedCalls: 1,
      estimatedCallsBySource: { main: 1 },
      startedAt: null,
      updatedAt: input.occurredAt,
      completedAt: null,
      stopAvailable: true,
      resumeAvailable: false,
      executionSnapshots: [],
      configChanges: [],
    },
  }, {
    type: "thread_upsert",
    agentThreadId: threadId,
    occurredAt: input.occurredAt,
    thread: {
      id: threadId,
      taskId: input.taskId,
      runId: input.runId,
      parentThreadId: input.parentThread?.id ?? null,
      identity: {
        kind: "main",
        roleId: "linguist-agent",
        displayName: "Linguist Agent",
        roleLabel: "General Agent",
        disclosureLabel: "Agent",
      },
      status: "pending",
      canReceiveUserMessage: true,
      handoffSummary: null,
      latestActivityId: input.messageId,
      childThreadIds: [],
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  }, {
    type: "activity_append",
    agentThreadId: threadId,
    occurredAt: input.occurredAt,
    activity: {
      id: input.messageId,
      taskId: input.taskId,
      runId: input.runId,
      agentThreadId: threadId,
      seq: 1,
      type: "message",
      status: "done",
      actor: { kind: "human", id: "user", displayName: "You", agentThreadId: threadId },
      title: "You",
      body: input.message,
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    },
  }];
}

export class GeneralAgentRunCoordinator {
  private readonly live = new Map<string, LiveGeneralRun>();
  private readonly pendingSessionIds = new Map<string, string>();
  private readonly streamListeners = new Map<string, Set<(event: StandaloneAgentStreamEvent) => void>>();

  constructor(private readonly deps: GeneralAgentRunCoordinatorDeps) {}

  private resolveManagedResources(): Promise<Awaited<ReturnType<typeof resolveActivatedLapkgResources>>> {
    return this.deps.resolveManagedResources
      ? this.deps.resolveManagedResources()
      : resolveActivatedLapkgResources(this.deps.repoRoot);
  }

  /**
   * The canonical Task event log remains the durable source of truth. This is
   * deliberately a separate, short-lived channel for the exact Pi deltas that
   * make a visible Agent reply feel live before the final activity is stored.
   */
  subscribeMessageStream(taskId: string, listener: (event: StandaloneAgentStreamEvent) => void): () => void {
    const listeners = this.streamListeners.get(taskId) ?? new Set<(event: StandaloneAgentStreamEvent) => void>();
    listeners.add(listener);
    this.streamListeners.set(taskId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.streamListeners.delete(taskId);
    };
  }

  private publishMessageStream(event: StandaloneAgentStreamEvent): void {
    for (const listener of this.streamListeners.get(event.taskId) ?? []) {
      try { listener(event); } catch { /* A renderer disconnect must never affect the Run. */ }
    }
  }

  private async resolveStartModelRoute(selection: GeneralModelRoute = {}): Promise<GeneralModelRoute> {
    const defaults = await this.deps.modelRoute().catch((): GeneralModelRoute => ({}));
    const explicitModelPreference = selection.provider !== undefined
      || selection.modelId !== undefined
      || selection.thinkingLevel !== undefined;
    const route: GeneralModelRoute = {
      provider: selection.provider ?? defaults.provider,
      modelId: selection.modelId ?? defaults.modelId,
      thinkingLevel: selection.thinkingLevel ?? defaults.thinkingLevel,
      ...(selection.executionProfile === undefined && explicitModelPreference
        ? {}
        : { executionProfile: selection.executionProfile ?? defaults.executionProfile }),
    };
    const resolved = this.deps.resolveModelRoute ? await this.deps.resolveModelRoute(route) : route;
    if (!resolved.profilePlan) {
      throw new TaskWorkspaceConflictError("The selected model has no verified immutable ExecutionProfile plan.");
    }
    if (resolved.provider !== resolved.profilePlan.model.provider
      || resolved.modelId !== resolved.profilePlan.model.modelId
      || resolved.thinkingLevel !== resolved.profilePlan.model.thinkingLevel) {
      throw new TaskWorkspaceConflictError("The selected model route differs from its immutable ExecutionProfile plan.");
    }
    return resolved;
  }

  private async prepareStartAttachments(input: {
    taskId: string;
    attachmentGrantIds?: string[];
    modelRoute: GeneralModelRoute;
  }): Promise<{ images: AgentRuntimeImageContent[]; labels: string[]; imageLabels: string[] }> {
    const ids = input.attachmentGrantIds ?? [];
    if (ids.length === 0) return { images: [], labels: [], imageLabels: [] };
    const access = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, input.taskId);
    const byId = new Map(access.grants.map((grant) => [grant.id, grant]));
    const selected = ids.map((id) => byId.get(id));
    const missing = ids.filter((_id, index) => !selected[index]);
    if (missing.length) throw new TaskWorkspaceConflictError(`Selected file attachment is no longer authorized: ${missing.join(", ")}.`);
    const nonFiles = selected.filter((grant) => grant?.kind !== "file");
    if (nonFiles.length) throw new TaskWorkspaceConflictError("Only explicitly granted files can be attached to a Run; attach a file instead of a directory.");
    const prepared = await prepareDirectImageAttachments(selected.map((grant) => ({
      path: grant!.realPath,
      label: basename(grant!.realPath),
    })));
    if (prepared.images.length) {
      if (!input.modelRoute.provider || !input.modelRoute.modelId) {
        throw new TaskWorkspaceConflictError("Select a configured vision-capable model before attaching images.");
      }
      if (!await this.deps.runtimePort.supportsInput(input.modelRoute.provider, input.modelRoute.modelId, "image")) {
        throw new TaskWorkspaceConflictError(`Model ${input.modelRoute.provider}/${input.modelRoute.modelId} does not accept image input. Choose a vision-capable model or remove the image attachment.`);
      }
    }
    return prepared;
  }

  private async resolveWorkingDirectoryTrust(
    taskId: string,
    sessionId: string,
    runId?: string,
    onPending?: (request: AgentPermissionRequest & { requestId?: string }) => void,
  ): Promise<boolean> {
    const access = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, taskId);
    const defaultProjectTrust = await this.deps.defaultProjectTrust?.().catch(() => "ask" as const) ?? "ask";
    const status = await readPiTrustStatus({ cwd: access.workingDirectory, agentDir: this.deps.piAgentDir, defaultProjectTrust });
    if (status.effectiveDecision === "trusted") return true;
    if (status.effectiveDecision === "untrusted") return false;
    const hasDirectoryResources = status.hasTrustResources || hasGeneralContextResources(access.workingDirectory);
    if (!hasDirectoryResources) return false;
    if (status.defaultProjectTrust === "always") return true;
    if (status.defaultProjectTrust === "never" || !onPending) return false;
    const decision = await this.deps.requestPermissionDecision({
      taskId,
      runId,
      kind: "pi_resource_trust",
      toolName: "Trust working-directory Pi resources",
      domain: "bridge",
      riskClass: "high",
      argsSummary: JSON.stringify({
        workingDirectory: access.workingDirectory,
        piResources: status.hasTrustResources,
        instructionContext: hasGeneralContextResources(access.workingDirectory),
        effect: "Load this directory's .pi resources, .agents/skills, and instruction context before the Run starts.",
      }, null, 2),
      sessionId,
    }, onPending);
    const trusted = agentPermissionAction(decision) !== "deny";
    await writePiTrustDecision({
      cwd: access.workingDirectory,
      target: "current",
      decision: trusted,
      agentDir: this.deps.piAgentDir,
      defaultProjectTrust,
    });
    return trusted;
  }

  async acceptMessage(input: {
    taskId: string;
    message: string;
    delivery?: "auto" | "steer" | "follow_up";
    agentThreadId?: string;
    modelProvider?: string;
    modelId?: string;
    thinkingLevel?: GeneralModelRoute["thinkingLevel"];
    executionProfile?: "fast" | "balanced" | "best";
    attachmentGrantIds?: string[];
  }): Promise<AcceptedStandaloneMessage> {
    const workspace = createTaskWorkspace(this.deps.repoRoot);
    const snapshot = await workspace.open({ kind: "standalone", taskId: input.taskId });
    if (snapshot.task.status === "archived") throw new TaskWorkspaceConflictError("Archived Chats must be restored before sending a message.");
    const current = this.live.get(input.taskId);
    if (snapshot.activeRunId || current) {
      if (!current || snapshot.activeRunId !== current.runId || !current.session.isStreaming) {
        throw new TaskWorkspaceConflictError(`Standalone Task ${input.taskId} has a Run that is not ready to accept queued messages.`);
      }
      if (input.agentThreadId && input.agentThreadId !== current.rootThreadId) {
        throw new TaskWorkspaceConflictError("Cannot queue a message onto a different Agent thread while this Chat is running.");
      }
      if (input.modelProvider || input.modelId || input.thinkingLevel || input.executionProfile) {
        throw new TaskWorkspaceConflictError("Model and effort selection apply to a new Run. Stop or let the current Run finish before changing them.");
      }
      if (input.attachmentGrantIds?.length) {
        throw new TaskWorkspaceConflictError("File and image attachments apply to a new Run. Stop or let the current Run finish before attaching them.");
      }
      const delivery = input.delivery === "follow_up" ? "follow_up" : "steer";
      return this.deps.messageQueue.deliver({
        locator: { kind: "standalone", taskId: input.taskId },
        runId: current.runId,
        message: input.message,
        delivery,
      });
    }
    if (input.delivery === "steer" || input.delivery === "follow_up") {
      throw new TaskWorkspaceConflictError(`${input.delivery} requires an active standalone Run.`);
    }

    // Validate before creating a durable pending Run. A bad client selection
    // must fail visibly, never yield a hidden "unconfigured" Pi session.
    const modelRoute = await this.resolveStartModelRoute({
      provider: input.modelProvider,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel,
      executionProfile: input.executionProfile,
    });
    const attachments = await this.prepareStartAttachments({
      taskId: input.taskId,
      attachmentGrantIds: input.attachmentGrantIds,
      modelRoute,
    });
    const userMessage = visibleAttachmentMessage(input.message, attachments.labels);
    const promptMessage = withAttachmentContext(input.message, attachments.labels, attachments.imageLabels);

    const runId = `turn_${randomUUID()}`;
    const messageId = `message_${randomUUID()}`;
    const occurredAt = new Date().toISOString();
    const resumableThreads = snapshot.agentThreads.filter((thread) => thread.piSessionFile);
    const parentThread = input.agentThreadId
      ? snapshot.agentThreads.find((thread) => thread.id === input.agentThreadId)
      : resumableThreads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (input.agentThreadId && !parentThread) throw new TaskWorkspaceConflictError(`Agent thread ${input.agentThreadId} does not belong to this Chat.`);
    if (input.agentThreadId && !parentThread?.piSessionFile) {
      throw new TaskWorkspaceConflictError(`Agent thread ${input.agentThreadId} has no resumable Pi session.`);
    }
    await workspace.appendGenerated({
      kind: "standalone",
      taskId: input.taskId,
      runId,
      events: pendingRunEvents({ taskId: input.taskId, runId, messageId, message: userMessage, occurredAt, parentThread }),
    });
    this.publishMessageStream({
      type: "turn_start",
      taskId: input.taskId,
      runId,
      ts: occurredAt,
      text: userMessage,
    });
    void this.launch({
      taskId: input.taskId,
      runId,
      message: promptMessage,
      userMessage,
      images: attachments.images,
      startedAt: occurredAt,
      parentThreadId: parentThread?.id,
      sessionFile: parentThread?.piSessionFile,
      modelRoute,
    })
      .catch(async (error) => {
        this.publishMessageStream({
          type: "error",
          taskId: input.taskId,
          runId,
          ts: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        await this.failPendingLaunch(input.taskId, runId, error).catch((failure) => {
          safeLogger.error("standalone.run_launch_failure_projection_failed", { error: failure });
        });
      });
    return { messageId, runId, delivery: "start" };
  }

  async stop(input: { taskId: string; reason?: string }): Promise<unknown> {
    const live = this.live.get(input.taskId);
    const pendingSessionId = this.pendingSessionIds.get(input.taskId);
    if (pendingSessionId) {
      this.deps.cancelPermissionDecisions?.(
        pendingSessionId,
        "permission request cancelled because the pending standalone Run was stopped",
      );
    }
    const stopped = await this.deps.activeRuns.stop({
      scope: "standalone",
      taskId: input.taskId,
      turnId: live?.runId,
      reason: input.reason,
    });
    if (stopped.stopped > 0) return stopped;
    if (await stopPendingSingleTaskRun({
      repoRoot: this.deps.repoRoot,
      locator: { kind: "standalone", taskId: input.taskId },
      taskId: input.taskId,
      reason: input.reason,
    })) return { ...stopped, stopped: 1 };
    return stopped;
  }

  async compact(input: { taskId: string; customInstructions?: string; agentThreadId?: string }): Promise<unknown> {
    const workspace = createTaskWorkspace(this.deps.repoRoot);
    const snapshot = await workspace.open({ kind: "standalone", taskId: input.taskId });
    if (snapshot.task.status === "archived") throw new TaskWorkspaceConflictError("Archived Chats must be restored before compaction.");
    if (snapshot.activeRunId || this.live.has(input.taskId)) {
      throw new TaskWorkspaceConflictError("Stop or finish the active Run before compacting this Chat.");
    }
    const access = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, input.taskId);
    const sessionId = generalAgentSessionId(input.taskId, access.workingDirectory);
    const projectTrusted = await this.resolveWorkingDirectoryTrust(input.taskId, sessionId);
    const latestThread = input.agentThreadId
      ? snapshot.agentThreads.find((thread) => thread.id === input.agentThreadId && thread.piSessionFile)
      : snapshot.agentThreads.filter((thread) => thread.piSessionFile).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (input.agentThreadId && !latestThread) throw new TaskWorkspaceConflictError(`Agent thread ${input.agentThreadId} has no resumable Pi session.`);
    const permissionContract = await this.deps.permissionContract();
    const managedResources = await this.resolveManagedResources();
    if (!latestThread) throw new TaskWorkspaceConflictError("This Chat has no resumable Agent thread to compact.");
    const run = snapshot.runs.find((candidate) => candidate.id === latestThread.runId);
    const execution = run?.executionSnapshots?.at(-1);
    if (!run?.resourceManifest || !execution || !execution.executionProfile || !execution.providerId || !execution.modelId) {
      throw new TaskWorkspaceConflictError("This legacy Agent thread has no verified execution/resource snapshot; start a new Run or fork instead of compacting it.");
    }
    const modelRoute = await this.resolveStartModelRoute({
      provider: execution.providerId,
      modelId: execution.modelId,
      thinkingLevel: snapshotThinkingLevel(execution.reasoningEffort),
      executionProfile: execution.executionProfile,
    });
    const plan = await prepareGeneralAgentSessionPlan({
      runtimeRoot: this.deps.repoRoot,
      taskId: input.taskId,
      agentDir: this.deps.piAgentDir,
      runId: run.id,
      rootAgentThreadId: latestThread.id,
      modelProvider: modelRoute.provider,
      modelId: modelRoute.modelId,
      thinkingLevel: modelRoute.thinkingLevel,
      executionProfilePlan: modelRoute.profilePlan,
      permissionContract,
      projectTrusted,
      sessionFile: latestThread?.piSessionFile,
      managedResources,
      assistantMemoryStore: this.deps.assistantMemoryStore?.(),
    });
    const created = await this.deps.workerRuntime.createGeneralSession({
      plan,
      executionIdentity: {
        executionId: `${run.id}.compaction.${randomUUID()}`,
        threadId: latestThread.id,
        turnId: `${run.id}.compaction`,
        runtimeEpochId: execution.runtimeEpochId,
        configRevision: execution.configRevision,
        executionProfile: execution.executionProfile,
        createdAt: new Date().toISOString(),
      },
      persistExecutionSnapshot: async () => undefined,
      requestPermissionDecision: (request) => this.deps.requestPermissionDecision(request, () => undefined),
      delegate: async () => { throw new Error("Compaction cannot delegate work."); },
      assistantMemoryStore: this.deps.assistantMemoryStore?.(),
      libraryPersistence: this.deps.libraryPersistence?.(),
      agentPlanHandler: (payload) => updateAgentPlanArtifact({ repoRoot: this.deps.repoRoot, taskId: input.taskId, runId: run.id, agentThreadId: latestThread.id, payload }),
      agentPresentHandler: (payload) => presentAgentAnswerArtifact({ repoRoot: this.deps.repoRoot, taskId: input.taskId, runId: run.id, agentThreadId: latestThread.id, payload }),
    });
    try {
      try {
        assertRuntimeCompactionTarget({
          threadId: latestThread.id,
          expectedSessionId: latestThread.piSessionId,
          expectedSessionFile: latestThread.piSessionFile!,
          actualSessionId: created.session.sessionId,
          actualSessionFile: created.session.sessionFile,
        });
      } catch (error) {
        throw new TaskWorkspaceConflictError(error instanceof Error ? error.message : String(error));
      }
      const createdAt = new Date().toISOString();
      const handoffId = `compaction-handoff-${randomUUID()}`;
      const activityId = `${handoffId}.activity`;
      const handoff = buildRuntimeCompactionHandoff({
        handoffId,
        taskId: input.taskId,
        runId: run.id,
        threadId: latestThread.id,
        sessionId: created.session.sessionId,
        taskGoal: snapshot.task.intent,
        openDecisionIds: snapshot.decisions.filter((decision) => decision.status === "required").map((decision) => decision.id),
        pendingArtifactIds: snapshot.artifacts
          .filter((artifact) => artifact.status === "draft" || artifact.status === "reviewable")
          .map((artifact) => artifact.id),
        execution: {
          executionId: execution.executionId,
          runtimeEpochId: execution.runtimeEpochId,
          configRevision: execution.configRevision,
          promptHash: execution.promptHash,
          toolManifestHash: execution.toolManifestHash,
          resourceSnapshotHash: execution.resourceSnapshotHash,
          capabilityGrantHash: execution.capabilityGrantHash,
          contextInputHash: execution.contextInputHash,
        },
        resourceManifestHash: createHash("sha256").update(JSON.stringify(run.resourceManifest)).digest("hex"),
        requestedFocus: input.customInstructions,
        createdAt,
      });
      const transcript = renderRuntimeCompactionInstructions(handoff);
      await workspace.appendGenerated({
        kind: "standalone",
        taskId: input.taskId,
        runId: run.id,
        events: [{
          type: "artifact_upsert",
          agentThreadId: latestThread.id,
          occurredAt: createdAt,
          artifact: {
            id: handoffId,
            taskId: input.taskId,
            runId: run.id,
            type: "context_handoff",
            status: "final",
            title: "Durable compaction handoff",
            summary: `Preserves ${handoff.openDecisionIds.length} open decision(s), ${handoff.pendingArtifactIds.length} pending artifact(s), and the exact execution/resource policy hashes.`,
            scope: snapshot.task.scope,
            version: 1,
            provenance: { agentThreadId: latestThread.id, activityId, evidenceRefs: [], parentArtifactIds: [] },
            availableDecisions: [],
            content: { kind: "runtime_compaction_handoff", ...handoff, transcript },
            createdAt,
            updatedAt: createdAt,
          },
        }, {
          type: "activity_append",
          agentThreadId: latestThread.id,
          occurredAt: createdAt,
          activity: {
            id: activityId,
            taskId: input.taskId,
            runId: run.id,
            agentThreadId: latestThread.id,
            seq: 1,
            type: "handoff",
            status: "done",
            actor: { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: latestThread.id },
            title: "Compaction handoff persisted",
            body: `Schema v1 · execution ${execution.executionId} · session ${created.session.sessionId}`,
            tool: null,
            refs: { artifactIds: [handoffId], evidenceRefs: [], decisionIds: handoff.openDecisionIds, segmentIds: [] },
            createdAt,
            updatedAt: createdAt,
          },
        }],
      });
      return await created.session.compact({ handoff });
    } finally {
      await created.dispose();
    }
  }

  async fork(input: {
    taskId: string;
    sourceThreadId?: string;
    entryId?: string;
    position?: "before" | "at";
  }): Promise<unknown> {
    const workspace = createTaskWorkspace(this.deps.repoRoot);
    const snapshot = await workspace.open({ kind: "standalone", taskId: input.taskId });
    if (snapshot.task.status === "archived") throw new TaskWorkspaceConflictError("Archived Chats must be restored before branching.");
    if (snapshot.activeRunId || this.live.has(input.taskId)) throw new TaskWorkspaceConflictError("Stop or finish the active Run before branching this Chat.");
    const source = input.sourceThreadId
      ? snapshot.agentThreads.find((thread) => thread.id === input.sourceThreadId)
      : snapshot.agentThreads.filter((thread) => thread.piSessionFile).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!source) throw new TaskWorkspaceConflictError("This Chat has no resumable Agent thread to branch.");
    if (!source.piSessionFile) throw new TaskWorkspaceConflictError(`Agent thread ${source.id} has no resumable Pi session.`);
    const access = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, input.taskId);
    const sessionId = generalAgentSessionId(input.taskId, access.workingDirectory);
    const projectTrusted = await this.resolveWorkingDirectoryTrust(input.taskId, sessionId);
    const sourceRun = snapshot.runs.find((candidate) => candidate.id === source.runId);
    const sourceExecution = sourceRun?.executionSnapshots?.at(-1);
    if (!sourceExecution || !sourceExecution.executionProfile || !sourceExecution.providerId || !sourceExecution.modelId) {
      throw new TaskWorkspaceConflictError("This legacy Agent thread has no verified ExecutionProfile snapshot; start a new Run instead of branching it.");
    }
    const modelRoute = await this.resolveStartModelRoute({
      provider: sourceExecution.providerId,
      modelId: sourceExecution.modelId,
      thinkingLevel: snapshotThinkingLevel(sourceExecution.reasoningEffort),
      executionProfile: sourceExecution.executionProfile,
    });
    const plan = await prepareGeneralAgentSessionPlan({
      runtimeRoot: this.deps.repoRoot,
      taskId: input.taskId,
      agentDir: this.deps.piAgentDir,
      runId: source.runId,
      rootAgentThreadId: source.id,
      modelProvider: modelRoute.provider,
      modelId: modelRoute.modelId,
      thinkingLevel: modelRoute.thinkingLevel,
      executionProfilePlan: modelRoute.profilePlan,
      permissionContract: await this.deps.permissionContract(),
      projectTrusted,
      sessionFile: source.piSessionFile,
      managedResources: await this.resolveManagedResources(),
      assistantMemoryStore: this.deps.assistantMemoryStore?.(),
    });
    const created = await this.deps.workerRuntime.createGeneralSession({
      plan,
      executionIdentity: {
        executionId: `${source.runId}.fork.${randomUUID()}`,
        threadId: source.id,
        turnId: `${source.runId}.fork`,
        runtimeEpochId: sourceExecution.runtimeEpochId,
        configRevision: sourceExecution.configRevision,
        executionProfile: sourceExecution.executionProfile,
        createdAt: new Date().toISOString(),
      },
      persistExecutionSnapshot: async () => undefined,
      requestPermissionDecision: (request) => this.deps.requestPermissionDecision(request, () => undefined),
      delegate: async () => { throw new Error("Branch creation cannot delegate work."); },
      assistantMemoryStore: this.deps.assistantMemoryStore?.(),
      libraryPersistence: this.deps.libraryPersistence?.(),
      agentPlanHandler: (payload) => updateAgentPlanArtifact({ repoRoot: this.deps.repoRoot, taskId: input.taskId, runId: source.runId, agentThreadId: source.id, payload }),
      agentPresentHandler: (payload) => presentAgentAnswerArtifact({ repoRoot: this.deps.repoRoot, taskId: input.taskId, runId: source.runId, agentThreadId: source.id, payload }),
    });
    if (!created.fork) {
      await created.dispose();
      throw new TaskWorkspaceConflictError("The General Core session runtime does not support Pi branching.");
    }
    try {
      const entryId = input.entryId ?? source.piEntryId ?? created.session.leafEntryId();
      if (!entryId) {
        throw new TaskWorkspaceConflictError("The requested Pi branch point is not present in the selected Agent thread.");
      }
      const position = input.position ?? "at";
      const result = await created.fork(entryId, { position });
      if (result.cancelled) throw new TaskWorkspaceConflictError("Pi Extension cancelled the branch operation.");
      const branchSession = result.session;
      const branchedAt = new Date().toISOString();
      const runId = `branch_${randomUUID()}`;
      const threadId = `${runId}.main`;
      const activityId = `${runId}.created`;
      await workspace.appendGenerated({
        kind: "standalone",
        taskId: input.taskId,
        runId,
        events: [{
          type: "run_upsert",
          agentThreadId: threadId,
          occurredAt: branchedAt,
          run: {
            id: runId,
            taskId: input.taskId,
            mode: "single",
            status: "complete",
            rootAgentThreadId: threadId,
            planHash: null,
            estimatedCalls: 0,
            estimatedCallsBySource: {},
            startedAt: branchedAt,
            updatedAt: branchedAt,
            completedAt: branchedAt,
            stopAvailable: false,
            resumeAvailable: false,
          },
        }, {
          type: "thread_upsert",
          agentThreadId: threadId,
          occurredAt: branchedAt,
          thread: {
            id: threadId,
            taskId: input.taskId,
            runId,
            parentThreadId: source.id,
            identity: { kind: "main", roleId: "linguist-agent", displayName: "Linguist Agent", roleLabel: "General Agent", disclosureLabel: "Agent" },
            status: "complete",
            canReceiveUserMessage: true,
            handoffSummary: `Forked from ${source.id} at Pi entry ${entryId}.`,
            latestActivityId: activityId,
            childThreadIds: [],
            piSessionId: branchSession.sessionId,
            piSessionFile: branchSession.sessionFile,
            piEntryId: branchSession.leafEntryId(),
            branchPointEntryId: entryId,
            branchPosition: position,
            createdAt: branchedAt,
            updatedAt: branchedAt,
          },
        }, {
          type: "activity_append",
          agentThreadId: threadId,
          occurredAt: branchedAt,
          activity: {
            id: activityId,
            taskId: input.taskId,
            runId,
            agentThreadId: threadId,
            seq: 1,
            type: "handoff",
            status: "done",
            actor: { kind: "system", id: "pi-runtime", displayName: "Pi Runtime", agentThreadId: threadId },
            title: "Conversation branch created",
            body: `Forked ${position} Pi entry ${entryId}; the original thread remains unchanged.`,
            tool: null,
            refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: branchedAt,
            updatedAt: branchedAt,
          },
        }],
      });
      return {
        taskId: input.taskId,
        sourceThreadId: source.id,
        threadId,
        branchPointEntryId: entryId,
        branchPosition: position,
        piSessionId: branchSession.sessionId,
      };
    } finally {
      await created.dispose();
    }
  }

  private async launch(input: {
    taskId: string;
    runId: string;
    message: string;
    userMessage: string;
    images: AgentRuntimeImageContent[];
    startedAt: string;
    parentThreadId?: string;
    sessionFile?: string;
    modelRoute: GeneralModelRoute;
  }): Promise<void> {
    const releaseStartLease = this.deps.activeRuns.acquireRunStartLease();
    const modelRoute = input.modelRoute;
    const profilePlan = modelRoute.profilePlan;
    if (!profilePlan) throw new TaskWorkspaceConflictError("A General Run requires a verified immutable ExecutionProfile plan.");
    let projector: Awaited<ReturnType<typeof createSingleTaskRunProjector>>;
    try {
      projector = await createSingleTaskRunProjector({
        repoRoot: this.deps.repoRoot,
        locator: { kind: "standalone", taskId: input.taskId },
        taskId: input.taskId,
        runId: input.runId,
        userMessage: input.userMessage,
        startedAt: input.startedAt,
        modelRoute: modelRoute.provider && modelRoute.modelId ? `${modelRoute.provider}/${modelRoute.modelId}` : "unconfigured",
        preprojected: true,
        parentThreadId: input.parentThreadId,
      });
    } catch (error) {
      releaseStartLease();
      throw error;
    }
    let session: AgentRuntimeSession | undefined;
    let sessionCreation: AgentRuntimeSessionCreation | undefined;
    let unsubscribe = () => {};
    let registered = false;
    let pendingSessionId: string | undefined;
    let runFailure: unknown;
    try {
      const access = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, input.taskId);
      pendingSessionId = generalAgentSessionId(input.taskId, access.workingDirectory);
      this.pendingSessionIds.set(input.taskId, pendingSessionId);
      const onPending = (pending: AgentPermissionRequest & { requestId?: string }) => {
        const ts = new Date().toISOString();
        projector.accept({
          type: "permission_request",
          ts,
          permissionRequest: pending,
        });
        this.publishMessageStream({
          type: "permission_request",
          taskId: input.taskId,
          runId: input.runId,
          ts,
          permissionRequest: pending,
        });
      };
      const projectTrusted = await this.resolveWorkingDirectoryTrust(input.taskId, pendingSessionId, input.runId, onPending);
      const managedResources = await this.resolveManagedResources();
      const permissionContract = await this.deps.permissionContract();
      const contextHandoffs = acceptedContextHandoffs(await createTaskWorkspace(this.deps.repoRoot).open({ kind: "standalone", taskId: input.taskId }));
      const assistantMemoryStore = this.deps.assistantMemoryStore?.();
      const plan = await prepareGeneralAgentSessionPlan({
        runtimeRoot: this.deps.repoRoot,
        taskId: input.taskId,
        agentDir: this.deps.piAgentDir,
        runId: input.runId,
        rootAgentThreadId: `${input.runId}.main`,
        modelProvider: modelRoute.provider,
        modelId: modelRoute.modelId,
        thinkingLevel: modelRoute.thinkingLevel,
        executionProfilePlan: profilePlan,
        permissionContract,
        projectTrusted,
        sessionFile: input.sessionFile,
        contextHandoffs,
        delegationEnabled: true,
        managedResources,
        assistantMemoryStore,
        confirmedMemory: await scopedGeneralMemorySnapshot({
          runtimeRoot: this.deps.repoRoot,
          query: input.message,
          store: assistantMemoryStore,
        }),
      });
      const runtimeEpochId = `${input.runId}.epoch.1`;
      const created = await this.deps.workerRuntime.createGeneralSession({
        plan,
        executionIdentity: {
          executionId: `${input.runId}.execution.1`,
          threadId: `${input.runId}.main`,
          turnId: input.runId,
          runtimeEpochId,
          configRevision: 1,
          executionProfile: profilePlan.profile,
          createdAt: input.startedAt,
        },
        persistExecutionSnapshot: (snapshot) => projector.setExecutionSnapshot(snapshot),
        requestPermissionDecision: (request) => this.deps.requestPermissionDecision(request, onPending),
        delegate: (request) => this.runDelegatedChild({
          taskId: input.taskId,
          runId: input.runId,
          parentThreadId: `${input.runId}.main`,
          modelRoute,
          request,
          signal: undefined,
        }),
      assistantMemoryStore: this.deps.assistantMemoryStore?.(),
      libraryPersistence: this.deps.libraryPersistence?.(),
        agentPlanHandler: (payload) => updateAgentPlanArtifact({ repoRoot: this.deps.repoRoot, taskId: input.taskId, runId: input.runId, agentThreadId: `${input.runId}.main`, payload }),
        agentPresentHandler: (payload) => presentAgentAnswerArtifact({ repoRoot: this.deps.repoRoot, taskId: input.taskId, runId: input.runId, agentThreadId: `${input.runId}.main`, payload }),
        onCapabilityActivation: (activation) => {
          projector.accept({
            type: "capability_activation",
            ts: new Date().toISOString(),
            capabilityActivation: activation,
          });
        },
      });
      session = created.session;
      sessionCreation = created;
      const systemPrompt = typeof session.systemPrompt === "string" ? session.systemPrompt : "";
      const systemPromptHash = createHash("sha256").update(systemPrompt).digest("hex");
      const toolSurfaceHash = createHash("sha256").update(JSON.stringify(created.resources.activeToolNames)).digest("hex");
      const requestShapeHash = createHash("sha256").update(JSON.stringify({
        systemPromptHash,
        toolSurfaceHash,
        resourceIndexHash: created.resources.resourceSetHash,
      })).digest("hex");
      await projector.setResourceManifest({
        schemaVersion: 2,
        profile: "general",
        piRuntimeVersion: created.runtimeVersion,
        cwd: created.access.workingDirectory,
        fileGrantIds: created.access.grants.map((grant) => grant.id),
        packages: managedResources.packages.map((pkg) => ({
          name: pkg.packageId,
          source: `lapkg:${pkg.publisherId}`,
          version: pkg.packageVersion,
          integrity: `sha256-${pkg.archiveSha256}`,
        })),
        activeToolNames: created.resources.activeToolNames,
        conflicts: created.resources.conflicts,
        resources: created.resources.entries
          .filter((entry) => entry.type === "extension" || entry.type === "skill" || entry.type === "prompt")
          .map((entry) => ({
            packageSource: `${entry.scope}:${entry.source}`,
            resourceType: entry.type as "extension" | "skill" | "prompt",
            resourceId: `${entry.resolvedPath}#sha256=${entry.sha256}`,
            enabled: true,
          })),
        requestShapeHash,
        systemPromptHash,
        toolSurfaceHash,
        resourceIndexHash: created.resources.resourceSetHash,
        requestShape: {
          schemaVersion: 2,
          systemPromptChars: systemPrompt.length,
          activeToolCount: created.resources.activeToolNames.length,
          resourceCount: created.resources.entries.length,
        },
      });
      if (created.resources.conflicts.length) {
        projector.accept({
          type: "resource_conflict",
          ts: new Date().toISOString(),
          text: created.resources.conflicts.map((conflict) => [
            `${conflict.kind}: ${conflict.name}`,
            `winner: ${conflict.winnerPath}`,
            `shadowed: ${conflict.shadowedPath}`,
          ].join("\n")).join("\n\n"),
        });
      }
      const rootThreadId = `${input.runId}.main`;
      const live: LiveGeneralRun = { taskId: input.taskId, runId: input.runId, session, projector, rootThreadId };
      this.live.set(input.taskId, live);
      await this.deps.messageQueue.bindRun({
        locator: { kind: "standalone", taskId: input.taskId },
        runId: input.runId,
        threadId: rootThreadId,
        session,
        onChange: (messageQueue) => {
          this.publishMessageStream({
            type: "queue_update",
            taskId: input.taskId,
            runId: input.runId,
            ts: new Date().toISOString(),
            messageQueue,
          });
        },
      });
      this.deps.activeRuns.register({
        turnId: input.runId,
        sessionId: session.sessionId,
        workerId: created.workerId,
        runtimeEpochId: created.runtimeEpochId,
        scope: "standalone",
        taskId: input.taskId,
        beforeAbort: async () => {
          await this.deps.messageQueue.pause({ kind: "standalone", taskId: input.taskId }, "interrupted");
          this.deps.cancelPermissionDecisions?.(
            session!.sessionId,
            "permission request cancelled because the standalone Run was stopped",
          );
        },
        session: {
          abort: () => session!.abort(),
          dispose: () => {
            void created.dispose();
          },
        },
      });
      registered = true;
      releaseStartLease();
      await projector.flush();
      if (this.deps.activeRuns.isStoppingOrStopped(input.runId)) {
        const ts = new Date().toISOString();
        projector.accept({ type: "stopped", ts, text: "Agent run stopped by user." });
        this.publishMessageStream({
          type: "stopped",
          taskId: input.taskId,
          runId: input.runId,
          ts,
          text: "Agent run stopped by user.",
        });
        return;
      }

      let assistantText = "";
      let thinkingStarted = false;
      let runtimeTerminalError: string | undefined;
      unsubscribe = session.subscribe((event: AgentRuntimeEvent) => {
        const ts = new Date().toISOString();
        if (event.type === "message.delta" && event.channel === "text") {
          assistantText += event.delta;
          this.publishMessageStream({
            type: "assistant_delta",
            taskId: input.taskId,
            runId: input.runId,
            ts,
            text: event.delta,
          });
        } else if (event.type === "message.delta" && event.channel === "thinking") {
          if (!thinkingStarted) {
            thinkingStarted = true;
            this.publishMessageStream({
              type: "assistant_thinking_started",
              taskId: input.taskId,
              runId: input.runId,
              ts,
            });
          }
        } else if (event.type === "message.completed") {
          const error = messageError(event.message);
          const role = (event.message as { role?: string }).role;
          if (role === "assistant" && !error) {
            // Pi may persist provider reasoning in its private JSONL session,
            // but LA never exposes hidden reasoning to the renderer. Providers
            // that only reveal its presence at message_end still get the same
            // safe, content-free live status signal.
            if (!thinkingStarted && assistantMessageHasThinking(event.message)) {
              thinkingStarted = true;
              this.publishMessageStream({
                type: "assistant_thinking_started",
                taskId: input.taskId,
                runId: input.runId,
                ts,
              });
            }
            const finalText = assistantText.trim() || assistantMessageText(event.message) || "(no final response)";
            // Some providers only surface text on message_end. Preserve genuine
            // output in the live UI without replaying tokens that were already
            // streamed through message_update.
            if (!assistantText.trim() && finalText !== "(no final response)") {
              this.publishMessageStream({
                type: "assistant_delta",
                taskId: input.taskId,
                runId: input.runId,
                ts,
                text: finalText,
              });
            }
            projector.accept({
              type: "assistant_message",
              ts,
              text: finalText,
              usage: usageFromMessage(event.message),
            });
            assistantText = "";
          }
        } else if (event.type === "tool.started") {
          projector.accept({
            type: "tool_start",
            ts,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            argsPreview: previewValue(event.args),
          });
        } else if (event.type === "tool.completed") {
          projector.accept({
            type: "tool_end",
            ts,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            isError: event.isError,
            resultPreview: previewValue(event.result),
            errorMessage: event.isError ? previewValue(event.result, 240) : undefined,
          });
        } else if (event.type === "queue.changed") {
          void this.deps.messageQueue.syncPiQueue({
            locator: { kind: "standalone", taskId: input.taskId },
            runId: input.runId,
            followUp: event.followUp,
          }).catch((error) => {
            safeLogger.warn("standalone.message_queue_sync_failed", { error });
          });
          projector.accept({
            type: "queue_update",
            ts,
            text: `${event.steering.length} steering · ${event.followUp.length} follow-up queued`,
          });
        } else if (event.type === "compaction.started") {
          projector.accept({ type: "compaction_start", ts, reason: event.reason });
        } else if (event.type === "compaction.completed") {
          projector.accept({
            type: "compaction_end",
            ts,
            reason: event.reason,
            tokensBefore: event.tokensBefore,
            estimatedTokensAfter: event.estimatedTokensAfter,
            isError: Boolean(event.errorMessage),
            errorMessage: event.errorMessage,
          });
        } else if (event.type === "retry.started") {
          projector.accept({
            type: "retry_start",
            ts,
            retryAttempt: event.attempt,
            retryMaxAttempts: event.maxAttempts,
            errorMessage: event.errorMessage,
          });
        } else if (event.type === "retry.completed") {
          projector.accept({ type: "retry_end", ts, retryAttempt: event.attempt, retrySuccess: event.success, errorMessage: event.finalError });
        } else if (event.type === "attempt.failed") {
          assistantText = "";
        } else if (event.type === "runtime.diagnostic") {
          projector.accept({
            type: "runtime_diagnostic",
            ts,
            text: event.message,
            errorMessage: event.code,
          });
        } else if (event.type === "run.failed") {
          runtimeTerminalError = event.errorMessage;
          projector.accept({
            type: "error",
            ts,
            text: event.errorMessage,
            errorMessage: event.errorMessage,
          });
          this.publishMessageStream({
            type: "error",
            taskId: input.taskId,
            runId: input.runId,
            ts,
            errorMessage: event.errorMessage,
          });
        }
      });
      await session.prompt(input.message, input.images.length ? { images: input.images } : undefined);
      await session.waitForIdle();
      const stopped = this.deps.activeRuns.isStoppingOrStopped(input.runId);
      if (runtimeTerminalError && !stopped) {
        runFailure = new Error(runtimeTerminalError);
        return;
      }
      const ts = new Date().toISOString();
      projector.accept({
        type: stopped ? "stopped" : "done",
        ts,
        text: stopped ? "Agent run stopped by user." : undefined,
      });
      if (stopped) {
        this.publishMessageStream({
          type: "stopped",
          taskId: input.taskId,
          runId: input.runId,
          ts,
          text: "Agent run stopped by user.",
        });
      } else {
        this.publishMessageStream({ type: "assistant_final", taskId: input.taskId, runId: input.runId, ts });
        this.publishMessageStream({ type: "done", taskId: input.taskId, runId: input.runId, ts });
      }
    } catch (error) {
      const stopped = this.deps.activeRuns.isStoppingOrStopped(input.runId);
      if (!stopped) runFailure = error;
      const ts = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      projector.accept({
        type: stopped ? "stopped" : "error",
        ts,
        errorMessage,
        text: errorMessage,
      });
      this.publishMessageStream({
        type: stopped ? "stopped" : "error",
        taskId: input.taskId,
        runId: input.runId,
        ts,
        ...(stopped ? { text: "Agent run stopped by user." } : { errorMessage }),
      });
    } finally {
      releaseStartLease();
      if (pendingSessionId && this.pendingSessionIds.get(input.taskId) === pendingSessionId) {
        this.pendingSessionIds.delete(input.taskId);
      }
      unsubscribe();
      if (session) {
        await this.deps.messageQueue.finishRun({
          locator: { kind: "standalone", taskId: input.taskId },
          runId: input.runId,
          ...(runFailure ? { error: runFailure } : {}),
        }).catch(() => undefined);
      }
      await projector.flush().catch(() => undefined);
      if (session) await this.persistThreadSession(input.taskId, input.runId, session).catch(() => undefined);
      if (this.live.get(input.taskId)?.runId === input.runId) this.live.delete(input.taskId);
      if (registered) this.deps.activeRuns.complete({ scope: "standalone", turnId: input.runId });
      else if (session) {
        await sessionCreation?.dispose();
      }
    }
  }

  private async persistThreadSession(taskId: string, runId: string, session: AgentRuntimeSession): Promise<void> {
    const workspace = createTaskWorkspace(this.deps.repoRoot);
    const snapshot = await workspace.open({ kind: "standalone", taskId });
    const thread = snapshot.agentThreads.find((candidate) => candidate.id === `${runId}.main`);
    if (!thread) return;
    const occurredAt = new Date().toISOString();
    await workspace.appendGenerated({
      kind: "standalone",
      taskId,
      runId,
      events: [{
        type: "thread_upsert",
        agentThreadId: thread.id,
        occurredAt,
        thread: {
          ...thread,
          childThreadIds: [...new Set([
            ...thread.childThreadIds,
            ...snapshot.agentThreads.filter((candidate) => candidate.parentThreadId === thread.id).map((candidate) => candidate.id),
          ])],
          piSessionId: session.sessionId,
          piSessionFile: session.sessionFile,
          piEntryId: session.leafEntryId(),
          updatedAt: occurredAt,
        },
      }],
    });
  }

  private async runDelegatedChild(input: {
    taskId: string;
    runId: string;
    parentThreadId: string;
    modelRoute: GeneralModelRoute;
    request: GeneralDelegationRequest;
    signal?: AbortSignal;
  }): Promise<GeneralDelegationResult> {
    const workspace = createTaskWorkspace(this.deps.repoRoot);
    const snapshot = await workspace.open({ kind: "standalone", taskId: input.taskId });
    const parent = snapshot.agentThreads.find((thread) => thread.id === input.parentThreadId);
    if (snapshot.activeRunId !== input.runId || !parent || parent.status !== "active") {
      throw new TaskWorkspaceConflictError("Delegation requires the active Main General Run.");
    }
    const existingChildren = snapshot.agentThreads.filter((thread) => thread.parentThreadId === parent.id);
    if (existingChildren.length >= 8) throw new TaskWorkspaceConflictError("This General Run already has eight delegated child threads.");
    const role = delegatedRole(input.request.role);
    const profilePlan = input.modelRoute.profilePlan;
    if (!profilePlan) throw new TaskWorkspaceConflictError("Delegation requires the Main Run's verified ExecutionProfile plan.");
    const childId = `${input.runId}.delegate.${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const startedActivityId = `${childId}.started`;
    await workspace.appendGenerated({
      kind: "standalone",
      taskId: input.taskId,
      runId: input.runId,
      events: [{
        type: "thread_upsert",
        agentThreadId: parent.id,
        occurredAt: startedAt,
        thread: { ...parent, childThreadIds: [...new Set([...parent.childThreadIds, childId])], updatedAt: startedAt },
      }, {
        type: "thread_upsert",
        agentThreadId: childId,
        occurredAt: startedAt,
        thread: {
          id: childId,
          taskId: input.taskId,
          runId: input.runId,
          parentThreadId: parent.id,
          identity: { kind: "specialist", roleId: childId, displayName: role, roleLabel: role, disclosureLabel: "Agent" },
          status: "active",
          canReceiveUserMessage: false,
          handoffSummary: "Server-owned delegated child with read-only access no broader than Main.",
          latestActivityId: startedActivityId,
          childThreadIds: [],
          createdAt: startedAt,
          updatedAt: startedAt,
        },
      }, {
        type: "activity_append",
        agentThreadId: childId,
        occurredAt: startedAt,
        activity: {
          id: startedActivityId,
          taskId: input.taskId,
          runId: input.runId,
          agentThreadId: childId,
          seq: 1,
          type: "handoff",
          status: "running",
          actor: { kind: "agent", id: parent.id, displayName: parent.identity.displayName, agentThreadId: parent.id },
          title: `${role} received delegated work`,
          body: input.request.task,
          tool: { name: "delegate_agent", effect: "read", target: role, outcome: "started" },
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
          createdAt: startedAt,
          updatedAt: startedAt,
        },
      }],
    });

    let childSession: AgentRuntimeSession | undefined;
    let childCreation: GeneralWorkerSessionCreation | undefined;
    let workerBound = false;
    let unsubscribe = () => {};
    let abortListener: (() => void) | undefined;
    const activityEvents: TaskRunEventDraft[] = [];
    let summary = "";
    try {
      const childAccess = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, input.taskId);
      const childSessionId = `${generalAgentSessionId(input.taskId, childAccess.workingDirectory)}-${childId}`;
      const projectTrusted = await this.resolveWorkingDirectoryTrust(input.taskId, childSessionId);
      const permissionContract = buildAgentPermissionContract({
        mode: "custom",
        customRules: { fileRead: "auto", fileWrite: "deny", webRead: "deny", bash: "deny", bridge: "deny" },
      });
      const assistantMemoryStore = this.deps.assistantMemoryStore?.();
      const plan = await prepareGeneralAgentSessionPlan({
        runtimeRoot: this.deps.repoRoot,
        taskId: input.taskId,
        agentDir: this.deps.piAgentDir,
        runId: input.runId,
        rootAgentThreadId: childId,
        sessionIdSuffix: childId,
        readOnlyChild: true,
        modelProvider: input.modelRoute.provider,
        modelId: input.modelRoute.modelId,
        thinkingLevel: input.modelRoute.thinkingLevel,
        executionProfilePlan: profilePlan,
        permissionContract,
        projectTrusted,
        contextHandoffs: [[
          `Delegated task from Main: ${input.request.task}`,
          input.request.context ? `Minimum parent context:\n${input.request.context}` : undefined,
          "Return a concise, evidence-aware report to Main. Do not perform writes or side effects.",
        ].filter(Boolean).join("\n\n")],
        managedResources: await this.resolveManagedResources(),
        assistantMemoryStore,
        confirmedMemory: await scopedGeneralMemorySnapshot({
          runtimeRoot: this.deps.repoRoot,
          query: input.request.task,
          store: assistantMemoryStore,
        }),
      });
      const created = await this.deps.workerRuntime.createGeneralSession({
        plan,
        executionIdentity: {
          executionId: `${childId}.execution.1`,
          threadId: childId,
          turnId: childId,
          runtimeEpochId: `${input.runId}.${childId}.epoch.1`,
          configRevision: 1,
          executionProfile: profilePlan.profile,
          createdAt: new Date().toISOString(),
        },
        persistExecutionSnapshot: async () => undefined,
        requestPermissionDecision: (request) => this.deps.requestPermissionDecision(request, () => undefined),
        delegate: async () => { throw new Error("Delegated read-only children cannot delegate further."); },
      assistantMemoryStore: this.deps.assistantMemoryStore?.(),
      libraryPersistence: this.deps.libraryPersistence?.(),
      });
      childSession = created.session;
      childCreation = created;
      const workerBoundAt = new Date().toISOString();
      await workspace.appendGenerated({
        kind: "standalone",
        taskId: input.taskId,
        runId: input.runId,
        events: [{
          type: "activity_append",
          agentThreadId: childId,
          occurredAt: workerBoundAt,
          activity: {
            id: `${childId}.worker-bound`,
            taskId: input.taskId,
            runId: input.runId,
            agentThreadId: childId,
            seq: 2,
            type: "progress",
            status: "done",
            actor: { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: childId },
            title: "Delegated Worker isolated",
            body: `Worker ${created.workerId} · epoch ${created.runtimeEpochId}`,
            tool: null,
            refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: workerBoundAt,
            updatedAt: workerBoundAt,
          },
        }],
      });
      workerBound = true;
      let eventIndex = 1;
      unsubscribe = childSession.subscribe((event: AgentRuntimeEvent) => {
        const occurredAt = new Date().toISOString();
        if (event.type === "message.delta" && event.channel === "text") {
          summary += event.delta;
        }
        if (event.type === "message.completed" && (event.message as { role?: string }).role === "assistant" && !summary.trim()) {
          summary = assistantMessageText(event.message);
        }
        if (event.type === "runtime.diagnostic") {
          eventIndex += 1;
          activityEvents.push({
            type: "activity_append",
            agentThreadId: childId,
            occurredAt,
            activity: {
              id: `${childId}.runtime-diagnostic.${eventIndex}`,
              taskId: input.taskId,
              runId: input.runId,
              agentThreadId: childId,
              seq: eventIndex + 1,
              type: "error",
              status: "error",
              actor: { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: childId },
              title: "Runtime event diagnostic",
              body: `${event.code}: ${event.message}`,
              tool: null,
              refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
              createdAt: occurredAt,
              updatedAt: occurredAt,
            },
          });
          return;
        }
        if (event.type !== "tool.started" && event.type !== "tool.completed") return;
        eventIndex += 1;
        const ended = event.type === "tool.completed";
        const toolName = event.toolName;
        activityEvents.push({
          type: "activity_append",
          agentThreadId: childId,
          occurredAt,
          activity: {
            id: `${childId}.tool.${eventIndex}`,
            taskId: input.taskId,
            runId: input.runId,
            agentThreadId: childId,
            seq: eventIndex + 1,
            type: "tool_action",
            status: ended ? (event.isError ? "error" : "done") : "running",
            actor: { kind: "agent", id: childId, displayName: role, agentThreadId: childId },
            title: `${role} ${ended ? (event.isError ? "failed" : "completed") : "started"} ${toolName}`,
            body: ended ? previewValue(event.result) : previewValue(event.args),
            tool: { name: toolName, effect: "read", target: null, outcome: ended ? (event.isError ? "failed" : "completed") : "started" },
            refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        });
      });
      abortListener = () => { void childSession?.abort(); };
      input.signal?.addEventListener("abort", abortListener, { once: true });
      if (input.signal?.aborted) await childSession.abort();
      await childSession.prompt(input.request.task);
      await childSession.waitForIdle();
      if (input.signal?.aborted) throw new Error("Delegated child was stopped with Main.");
      summary = summary.trim() || "The delegated child returned no text response.";
      const completedAt = new Date().toISOString();
      const finalActivityId = `${childId}.final`;
      const current = await workspace.open({ kind: "standalone", taskId: input.taskId });
      const child = current.agentThreads.find((thread) => thread.id === childId);
      if (!child || current.activeRunId !== input.runId) throw new TaskWorkspaceConflictError("Main Run ended before delegated child projection completed.");
      await workspace.appendGenerated({
        kind: "standalone",
        taskId: input.taskId,
        runId: input.runId,
        events: [...activityEvents, {
          type: "activity_append",
          agentThreadId: childId,
          occurredAt: completedAt,
          activity: {
            id: finalActivityId,
            taskId: input.taskId,
            runId: input.runId,
            agentThreadId: childId,
            seq: activityEvents.length + 3,
            type: "final_response",
            status: "done",
            actor: { kind: "agent", id: childId, displayName: role, agentThreadId: childId },
            title: `${role} completed delegated work`,
            body: summary,
            tool: null,
            refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: completedAt,
            updatedAt: completedAt,
          },
        }, {
          type: "thread_upsert",
          agentThreadId: childId,
          occurredAt: completedAt,
          thread: {
            ...child,
            status: "complete",
            handoffSummary: summary.slice(0, 2_000),
            latestActivityId: finalActivityId,
            piSessionId: childSession.sessionId,
            piSessionFile: childSession.sessionFile,
            piEntryId: childSession.leafEntryId(),
            updatedAt: completedAt,
          },
        }],
      });
      return { agentThreadId: childId, role, summary };
    } catch (error) {
      const failedAt = new Date().toISOString();
      const current = await workspace.open({ kind: "standalone", taskId: input.taskId }).catch(() => undefined);
      const child = current?.agentThreads.find((thread) => thread.id === childId);
      if (child && current?.activeRunId === input.runId) {
        const message = error instanceof Error ? error.message : String(error);
        await workspace.appendGenerated({
          kind: "standalone",
          taskId: input.taskId,
          runId: input.runId,
          events: [{
            type: "activity_append",
            agentThreadId: childId,
            occurredAt: failedAt,
            activity: {
              id: `${childId}.failed`, taskId: input.taskId, runId: input.runId, agentThreadId: childId, seq: workerBound ? 3 : 2,
              type: "error", status: "error",
              actor: { kind: "agent", id: childId, displayName: role, agentThreadId: childId },
              title: `${role} failed delegated work`, body: message, tool: null,
              refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] }, createdAt: failedAt, updatedAt: failedAt,
            },
          }, {
            type: "thread_upsert", agentThreadId: childId, occurredAt: failedAt,
            thread: { ...child, status: "failed", handoffSummary: message, latestActivityId: `${childId}.failed`, updatedAt: failedAt },
          }],
        });
      }
      throw error;
    } finally {
      if (abortListener) input.signal?.removeEventListener("abort", abortListener);
      unsubscribe();
      await childCreation?.dispose();
    }
  }

  private async failPendingLaunch(taskId: string, runId: string, error: unknown): Promise<void> {
    const workspace = createTaskWorkspace(this.deps.repoRoot);
    const snapshot = await workspace.open({ kind: "standalone", taskId });
    const run = snapshot.runs.find((candidate) => candidate.id === runId && candidate.status === "pending");
    const thread = snapshot.agentThreads.find((candidate) => candidate.id === run?.rootAgentThreadId);
    if (!run || !thread) return;
    const failedAt = new Date().toISOString();
    await workspace.appendGenerated({
      kind: "standalone",
      taskId,
      runId,
      expectedActiveRun: { id: runId, status: "pending", startedAt: null },
      events: [{
        type: "activity_append",
        agentThreadId: thread.id,
        occurredAt: failedAt,
        activity: {
          id: `${runId}.launch-failed`,
          taskId,
          runId,
          agentThreadId: thread.id,
          seq: 1,
          type: "error",
          status: "error",
          actor: { kind: "system", id: "runtime", displayName: "Runtime", agentThreadId: thread.id },
          title: "General Run failed to launch",
          body: error instanceof Error ? error.message : String(error),
          tool: null,
          refs: { artifactIds: [], evidenceRefs: [], decisionIds: [], segmentIds: [] },
          createdAt: failedAt,
          updatedAt: failedAt,
        },
      }, {
        type: "run_upsert",
        agentThreadId: thread.id,
        occurredAt: failedAt,
        run: { ...run, status: "failed", updatedAt: failedAt, completedAt: failedAt, stopAvailable: false, resumeAvailable: true },
      }, {
        type: "thread_upsert",
        agentThreadId: thread.id,
        occurredAt: failedAt,
        thread: { ...thread, status: "failed", updatedAt: failedAt },
      }],
    });
  }
}

/* ---------- agent_plan_update: host-owned canonical work-plan writer ---------- */

const AGENT_PLAN_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const AGENT_PLAN_STATUSES = ["pending", "in_progress", "completed"] as const;

export type AgentPlanUpdateItem = { id: string; text: string; status: RichArtifactTodoStatus };
export type AgentPlanUpdatePayload = { title?: string; items: AgentPlanUpdateItem[] };

/** Strict server-side validation of the model-submitted full todo list. */
export function parseAgentPlanUpdatePayload(payload: unknown): AgentPlanUpdatePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("agent_plan_update payload must be an object.");
  const row = payload as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== "title" && key !== "items") throw new Error(`agent_plan_update payload has an unexpected field: ${key}.`);
  }
  if (row.title !== undefined && (typeof row.title !== "string" || !row.title.trim() || row.title.length > 1_000 || row.title.includes("\0"))) {
    throw new Error("agent_plan_update title must be a non-empty string of at most 1000 characters without NUL.");
  }
  if (!Array.isArray(row.items) || row.items.length === 0) throw new Error("agent_plan_update items must not be empty.");
  if (row.items.length > 500) throw new Error("agent_plan_update items must contain at most 500 entries.");
  const items = row.items.map((value, index) => {
    const label = `agent_plan_update items[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const item = value as Record<string, unknown>;
    for (const key of Object.keys(item)) {
      if (key !== "id" && key !== "text" && key !== "status") throw new Error(`${label} has an unexpected field: ${key}.`);
    }
    if (typeof item.id !== "string" || !AGENT_PLAN_ITEM_ID_PATTERN.test(item.id)) throw new Error(`${label}.id must be a stable identifier.`);
    if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 2_000) throw new Error(`${label}.text must be a non-empty string of at most 2000 characters.`);
    if (item.text.includes("\0")) throw new Error(`${label}.text contains a NUL byte.`);
    if (typeof item.status !== "string" || !(AGENT_PLAN_STATUSES as readonly string[]).includes(item.status)) {
      throw new Error(`${label}.status must be one of ${AGENT_PLAN_STATUSES.join(", ")}.`);
    }
    return { id: item.id, text: item.text, status: item.status as RichArtifactTodoStatus };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("agent_plan_update item ids must be unique.");
  return { ...(row.title === undefined ? {} : { title: row.title.trim() }), items };
}

/**
 * The host-owned agent_plan writer. The model submits a full todo list; the
 * host validates it and appends the next canonical artifact version plus a
 * plan activity to the active Run. The Worker never writes Task truth itself.
 */
export async function updateAgentPlanArtifact(options: {
  repoRoot: string;
  taskId: string;
  runId: string;
  agentThreadId: string;
  payload: unknown;
}): Promise<{ artifactId: string; version: number }> {
  const request = parseAgentPlanUpdatePayload(options.payload);
  const workspace = createTaskWorkspace(options.repoRoot);
  const before = await workspace.open({ kind: "standalone", taskId: options.taskId });
  if (before.activeRunId !== options.runId) throw new TaskWorkspaceConflictError("The plan-update Run is no longer active.");
  const now = new Date().toISOString();
  const artifactId = `agent-plan:${options.taskId}`;
  const completed = request.items.filter((item) => item.status === "completed").length;
  const document = parseRichArtifactDocument({
    schemaVersion: 1,
    title: request.title ?? "Agent 工作计划",
    createdAt: now,
    generator: "Linguist Agent · agent_plan_update",
    blocks: [{ id: "plan", type: "todo_list", items: request.items }],
  });
  const artifactPath = join(
    standaloneTaskWorkspaceRoot(options.repoRoot, options.taskId),
    "artifacts",
    `${artifactId.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`,
  );
  await writeJsonFile(artifactPath, document);
  const activityId = `${options.runId}.plan.${randomUUID()}`;
  const snapshot = await workspace.appendGenerated({
    kind: "standalone",
    taskId: options.taskId,
    runId: options.runId,
    expectedActiveRun: { id: options.runId, status: "active" },
    events: [{
      type: "artifact_upsert",
      agentThreadId: options.agentThreadId,
      occurredAt: now,
      artifact: {
        id: artifactId,
        taskId: options.taskId,
        runId: options.runId,
        type: "agent_plan",
        status: "reviewable",
        title: document.title,
        summary: `${request.items.length} 项工作计划，${completed} 项已完成`,
        scope: { kind: "standalone", fileGrantIds: [] },
        version: 1,
        provenance: { agentThreadId: options.agentThreadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: [],
        content: { document, artifactPath },
        createdAt: now,
        updatedAt: now,
      },
    }, {
      type: "activity_append",
      agentThreadId: options.agentThreadId,
      occurredAt: now,
      activity: {
        id: activityId,
        taskId: options.taskId,
        runId: options.runId,
        agentThreadId: options.agentThreadId,
        seq: 1,
        type: "plan",
        status: "done",
        actor: { kind: "agent", id: "main", displayName: "Linguist Agent", agentThreadId: options.agentThreadId },
        title: `更新工作计划：${request.items.length} 项，${completed} 项已完成`,
        body: null,
        tool: { name: "agent_plan_update", effect: "write", target: artifactId, outcome: `${completed}/${request.items.length} 完成` },
        refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
        createdAt: now,
        updatedAt: now,
      },
    }],
  });
  const artifact = snapshot.artifacts.find((entry) => entry.id === artifactId);
  if (!artifact) throw new Error("Agent plan artifact was not persisted.");
  return { artifactId, version: artifact.version };
}

/* ---------- agent_present: host-owned canonical visual-answer writer ---------- */

const AGENT_PRESENT_BLOCK_TYPES = ["markdown", "table", "chart", "diff", "file_reference"] as const;

type AgentPresentBlock = ReturnType<typeof parseRichArtifactDocument>["blocks"][number];
export type AgentPresentPayload = { title?: string; blocks: AgentPresentBlock[] };

/**
 * Strict server-side validation of the model-submitted visual answer. Only
 * presentational blocks are accepted: todo_list stays exclusive to the plan
 * tool and evidence blocks (image, page_overlay) are not model-presentable.
 */
export function parseAgentPresentPayload(payload: unknown): AgentPresentPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("agent_present payload must be an object.");
  const row = payload as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== "title" && key !== "blocks") throw new Error(`agent_present payload has an unexpected field: ${key}.`);
  }
  if (row.title !== undefined && (typeof row.title !== "string" || !row.title.trim() || row.title.length > 1_000 || row.title.includes("\0"))) {
    throw new Error("agent_present title must be a non-empty string of at most 1000 characters without NUL.");
  }
  if (!Array.isArray(row.blocks)) throw new Error("agent_present blocks must be an array.");
  if (row.blocks.length === 0) throw new Error("agent_present blocks must not be empty.");
  row.blocks.forEach((block, index) => {
    const type = block && typeof block === "object" && !Array.isArray(block)
      ? (block as Record<string, unknown>).type
      : undefined;
    if (typeof type !== "string" || !(AGENT_PRESENT_BLOCK_TYPES as readonly string[]).includes(type)) {
      throw new Error(`agent_present blocks[${index}].type is not presentable: ${String(type)}.`);
    }
  });
  const validated = parseRichArtifactDocument({
    schemaVersion: 1,
    title: "agent_present payload validation",
    createdAt: "1970-01-01T00:00:00.000Z",
    generator: "agent_present payload validation",
    blocks: row.blocks,
  });
  return { ...(row.title === undefined ? {} : { title: (row.title as string).trim() }), blocks: validated.blocks };
}

/**
 * The host-owned agent_present writer. The model submits declarative content
 * blocks; the host validates them, stamps title/generator/createdAt, and
 * appends a brand-new canonical artifact plus an artifact_update activity to
 * the active Run. The Worker never writes Task truth itself.
 */
export async function presentAgentAnswerArtifact(options: {
  repoRoot: string;
  taskId: string;
  runId: string;
  agentThreadId: string;
  payload: unknown;
}): Promise<{ artifactId: string; version: number }> {
  const request = parseAgentPresentPayload(options.payload);
  const workspace = createTaskWorkspace(options.repoRoot);
  const before = await workspace.open({ kind: "standalone", taskId: options.taskId });
  if (before.activeRunId !== options.runId) throw new TaskWorkspaceConflictError("The present Run is no longer active.");
  const now = new Date().toISOString();
  const artifactId = `agent-present:${options.taskId}:${randomUUID()}`;
  const document = parseRichArtifactDocument({
    schemaVersion: 1,
    title: request.title ?? "Agent 可视化回答",
    createdAt: now,
    generator: "Linguist Agent · agent_present",
    blocks: request.blocks,
  });
  const artifactPath = join(
    standaloneTaskWorkspaceRoot(options.repoRoot, options.taskId),
    "artifacts",
    `${artifactId.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`,
  );
  await writeJsonFile(artifactPath, document);
  const activityId = `${options.runId}.present.${randomUUID()}`;
  const snapshot = await workspace.appendGenerated({
    kind: "standalone",
    taskId: options.taskId,
    runId: options.runId,
    expectedActiveRun: { id: options.runId, status: "active" },
    events: [{
      type: "artifact_upsert",
      agentThreadId: options.agentThreadId,
      occurredAt: now,
      artifact: {
        id: artifactId,
        taskId: options.taskId,
        runId: options.runId,
        type: "agent_present",
        status: "reviewable",
        title: document.title,
        summary: `${document.blocks.length} 个内容块的可视化回答`,
        scope: { kind: "standalone", fileGrantIds: [] },
        version: 1,
        provenance: { agentThreadId: options.agentThreadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: [],
        content: { document, artifactPath },
        createdAt: now,
        updatedAt: now,
      },
    }, {
      type: "activity_append",
      agentThreadId: options.agentThreadId,
      occurredAt: now,
      activity: {
        id: activityId,
        taskId: options.taskId,
        runId: options.runId,
        agentThreadId: options.agentThreadId,
        seq: 1,
        type: "artifact_update",
        status: "done",
        actor: { kind: "agent", id: "main", displayName: "Linguist Agent", agentThreadId: options.agentThreadId },
        title: `呈现可视化回答：${document.title}`,
        body: null,
        tool: { name: "agent_present", effect: "write", target: artifactId, outcome: `${document.blocks.length} 个内容块` },
        refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
        createdAt: now,
        updatedAt: now,
      },
    }],
  });
  const artifact = snapshot.artifacts.find((entry) => entry.id === artifactId);
  if (!artifact) throw new Error("Agent present artifact was not persisted.");
  return { artifactId, version: artifact.version };
}
