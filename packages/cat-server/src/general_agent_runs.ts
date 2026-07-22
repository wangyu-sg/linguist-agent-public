import { createHash, randomUUID } from "node:crypto";
import { VERSION, type AgentSession, type AgentSessionEvent, type AgentSessionRuntime, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  createTaskWorkspace,
  resolveStandaloneFileGrantAccess,
  TaskWorkspaceConflictError,
  type TaskAgentThread,
  type TaskRunEventDraft,
  type TaskWorkspaceSnapshot,
} from "@linguist-agent/cat-data";
import {
  buildAgentPermissionContract,
  createGeneralAgentSession,
  generalAgentSessionId,
  type AgentPermissionContract,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
  type GeneralDelegationRequest,
  type GeneralDelegationResult,
  type GeneralExecutableExtensionAuthorizationRequest,
} from "@linguist-agent/cat-runtime";
import { previewValue } from "./agent_events.js";
import { ActiveAgentRunRegistry } from "./active_agent_runs.js";
import {
  createSingleTaskRunProjector,
  stopPendingSingleTaskRun,
  type SingleTaskRunProjector,
} from "./single_task_run_projection.js";
import type { AcceptedStandaloneMessage, StandaloneAgentStreamEvent } from "./routes/standalone_task_routes.js";
import { TaskMessageQueueCoordinator } from "./task_message_queue.js";
import { resolveApprovedManagedPackageResources } from "./package_center.js";
import { approvePiExtensionEntries, unknownPiExtensionEntries } from "./pi_extension_trust.js";
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
}

interface LiveGeneralRun {
  taskId: string;
  runId: string;
  session: AgentSession;
  runtime?: AgentSessionRuntime;
  projector: SingleTaskRunProjector;
  rootThreadId: string;
}

export interface GeneralAgentRunCoordinatorDeps {
  repoRoot: string;
  /** Test/managed-runtime override; production uses Pi's canonical agent dir. */
  piAgentDir?: string;
  activeRuns: ActiveAgentRunRegistry;
  messageQueue: TaskMessageQueueCoordinator;
  modelRuntime: () => Promise<ModelRuntime>;
  modelRoute: () => Promise<GeneralModelRoute>;
  /**
   * The server is the authority for whether a selected model is currently
   * usable. The Composer supplies a next-Run preference; it never bypasses
   * the provider catalog or turns into a client-owned runtime route.
   */
  resolveModelRoute?: (route: GeneralModelRoute) => Promise<GeneralModelRoute>;
  permissionContract: () => Promise<AgentPermissionContract>;
  defaultProjectTrust?: () => Promise<PiDefaultProjectTrust>;
  createSession?: typeof createGeneralAgentSession;
  requestPermissionDecision: (
    request: AgentPermissionRequest,
    onPending: (request: AgentPermissionRequest & { requestId?: string }) => void,
  ) => Promise<AgentPermissionUserDecision>;
  cancelPermissionDecisions?: (sessionId: string, reason: string) => void;
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

function acceptedContextHandoffs(snapshot: TaskWorkspaceSnapshot): string[] {
  return snapshot.artifacts
    .filter((artifact) => artifact.type === "context_handoff" && (artifact.status === "accepted" || artifact.status === "final"))
    .slice(-3)
    .map((artifact) => {
      const transcript = typeof artifact.content.transcript === "string" ? artifact.content.transcript.trim() : "";
      return [`Handoff: ${artifact.title}`, artifact.summary, transcript].filter(Boolean).join("\n").slice(0, 20_000);
    });
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
    const route: GeneralModelRoute = {
      provider: selection.provider ?? defaults.provider,
      modelId: selection.modelId ?? defaults.modelId,
      thinkingLevel: selection.thinkingLevel ?? defaults.thinkingLevel,
    };
    return this.deps.resolveModelRoute ? this.deps.resolveModelRoute(route) : route;
  }

  private async resolveWorkingDirectoryTrust(
    taskId: string,
    sessionId: string,
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
    const trusted = decision.decision === "approve";
    await writePiTrustDecision({
      cwd: access.workingDirectory,
      target: "current",
      decision: trusted,
      agentDir: this.deps.piAgentDir,
      defaultProjectTrust,
    });
    return trusted;
  }

  private async authorizeExecutableExtensions(
    request: GeneralExecutableExtensionAuthorizationRequest,
    sessionId: string,
    onPending?: (request: AgentPermissionRequest & { requestId?: string }) => void,
  ): Promise<void> {
    const unknown = await unknownPiExtensionEntries(this.deps.repoRoot, request.extensions);
    if (!unknown.length) return;
    if (!onPending) {
      throw new TaskWorkspaceConflictError("Pi user Extensions changed or have not been approved. Start a normal Chat turn to review their exact digests before this operation.");
    }
    const inventory = JSON.stringify({
      resourceSetHash: request.resourceSetHash,
      extensions: unknown.map((entry) => ({
        path: entry.path,
        canonicalPath: entry.resolvedPath,
        sha256: entry.sha256,
        source: entry.source,
        sizeBytes: entry.sizeBytes,
      })),
    }, null, 2);
    const decision = await this.deps.requestPermissionDecision({
      toolName: "Trust Pi Extension executable code",
      domain: "bridge",
      riskClass: "high",
      argsSummary: inventory.length <= 24_000 ? inventory : `${inventory.slice(0, 23_900)}\n... inventory truncated in UI`,
      sessionId,
    }, onPending);
    if (decision.decision !== "approve") {
      throw new TaskWorkspaceConflictError(decision.reason || "User declined the unknown Pi Extension executable digest.");
    }
    await approvePiExtensionEntries(this.deps.repoRoot, unknown);
  }

  async acceptMessage(input: {
    taskId: string;
    message: string;
    delivery?: "auto" | "steer" | "follow_up";
    agentThreadId?: string;
    modelProvider?: string;
    modelId?: string;
    thinkingLevel?: GeneralModelRoute["thinkingLevel"];
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
      if (input.modelProvider || input.modelId || input.thinkingLevel) {
        throw new TaskWorkspaceConflictError("Model and effort selection apply to a new Run. Stop or let the current Run finish before changing them.");
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
    });

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
      events: pendingRunEvents({ taskId: input.taskId, runId, messageId, message: input.message, occurredAt, parentThread }),
    });
    this.publishMessageStream({
      type: "turn_start",
      taskId: input.taskId,
      runId,
      ts: occurredAt,
      text: input.message,
    });
    void this.launch({
      taskId: input.taskId,
      runId,
      message: input.message,
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
          console.error("Failed to project standalone Run launch failure:", failure);
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
    const modelRoute = await this.resolveStartModelRoute();
    const access = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, input.taskId);
    const sessionId = generalAgentSessionId(input.taskId, access.workingDirectory);
    const projectTrusted = await this.resolveWorkingDirectoryTrust(input.taskId, sessionId);
    const latestThread = input.agentThreadId
      ? snapshot.agentThreads.find((thread) => thread.id === input.agentThreadId && thread.piSessionFile)
      : snapshot.agentThreads.filter((thread) => thread.piSessionFile).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (input.agentThreadId && !latestThread) throw new TaskWorkspaceConflictError(`Agent thread ${input.agentThreadId} has no resumable Pi session.`);
    const created = await (this.deps.createSession ?? createGeneralAgentSession)({
      runtimeRoot: this.deps.repoRoot,
      taskId: input.taskId,
      agentDir: this.deps.piAgentDir,
      modelRuntime: await this.deps.modelRuntime(),
      modelProvider: modelRoute.provider,
      modelId: modelRoute.modelId,
      thinkingLevel: modelRoute.thinkingLevel,
      permissionContract: await this.deps.permissionContract(),
      requestPermissionDecision: (request) => this.deps.requestPermissionDecision(request, () => undefined),
      projectTrusted,
      authorizeExecutableExtensions: (request) => this.authorizeExecutableExtensions(request, sessionId),
      sessionFile: latestThread?.piSessionFile,
      managedResources: await resolveApprovedManagedPackageResources(this.deps.repoRoot),
    });
    try {
      return await created.session.compact(input.customInstructions);
    } finally {
      if (created.runtime) await created.runtime.dispose();
      else created.session.dispose();
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
    const modelRoute = await this.resolveStartModelRoute();
    const access = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, input.taskId);
    const sessionId = generalAgentSessionId(input.taskId, access.workingDirectory);
    const projectTrusted = await this.resolveWorkingDirectoryTrust(input.taskId, sessionId);
    const created = await (this.deps.createSession ?? createGeneralAgentSession)({
      runtimeRoot: this.deps.repoRoot,
      taskId: input.taskId,
      agentDir: this.deps.piAgentDir,
      modelRuntime: await this.deps.modelRuntime(),
      modelProvider: modelRoute.provider,
      modelId: modelRoute.modelId,
      thinkingLevel: modelRoute.thinkingLevel,
      permissionContract: await this.deps.permissionContract(),
      requestPermissionDecision: (request) => this.deps.requestPermissionDecision(request, () => undefined),
      projectTrusted,
      authorizeExecutableExtensions: (request) => this.authorizeExecutableExtensions(request, sessionId),
      sessionFile: source.piSessionFile,
      managedResources: await resolveApprovedManagedPackageResources(this.deps.repoRoot),
    });
    if (!created.runtime) {
      created.session.dispose();
      throw new TaskWorkspaceConflictError("The General Core session runtime does not support Pi branching.");
    }
    try {
      const entryId = input.entryId ?? source.piEntryId ?? created.session.sessionManager.getLeafId() ?? undefined;
      if (!entryId || !created.session.sessionManager.getEntry(entryId)) {
        throw new TaskWorkspaceConflictError("The requested Pi branch point is not present in the selected Agent thread.");
      }
      const position = input.position ?? "at";
      const result = await created.runtime.fork(entryId, { position });
      if (result.cancelled) throw new TaskWorkspaceConflictError("Pi Extension cancelled the branch operation.");
      const branchSession = created.runtime.session;
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
            piEntryId: branchSession.sessionManager.getLeafId() ?? undefined,
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
      await created.runtime.dispose();
    }
  }

  private async launch(input: {
    taskId: string;
    runId: string;
    message: string;
    startedAt: string;
    parentThreadId?: string;
    sessionFile?: string;
    modelRoute: GeneralModelRoute;
  }): Promise<void> {
    const releaseStartLease = this.deps.activeRuns.acquireRunStartLease();
    const modelRoute = input.modelRoute;
    let projector: Awaited<ReturnType<typeof createSingleTaskRunProjector>>;
    try {
      projector = await createSingleTaskRunProjector({
        repoRoot: this.deps.repoRoot,
        locator: { kind: "standalone", taskId: input.taskId },
        taskId: input.taskId,
        runId: input.runId,
        userMessage: input.message,
        startedAt: input.startedAt,
        modelRoute: modelRoute.provider && modelRoute.modelId ? `${modelRoute.provider}/${modelRoute.modelId}` : "unconfigured",
        preprojected: true,
        parentThreadId: input.parentThreadId,
      });
    } catch (error) {
      releaseStartLease();
      throw error;
    }
    let session: AgentSession | undefined;
    let sessionRuntime: AgentSessionRuntime | undefined;
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
      const projectTrusted = await this.resolveWorkingDirectoryTrust(input.taskId, pendingSessionId, onPending);
      const managedResources = await resolveApprovedManagedPackageResources(this.deps.repoRoot);
      const created = await (this.deps.createSession ?? createGeneralAgentSession)({
        runtimeRoot: this.deps.repoRoot,
        taskId: input.taskId,
        agentDir: this.deps.piAgentDir,
        runId: input.runId,
        rootAgentThreadId: `${input.runId}.main`,
        modelRuntime: await this.deps.modelRuntime(),
        modelProvider: modelRoute.provider,
        modelId: modelRoute.modelId,
        thinkingLevel: modelRoute.thinkingLevel,
        permissionContract: await this.deps.permissionContract(),
        requestPermissionDecision: (request) => this.deps.requestPermissionDecision(request, onPending),
        projectTrusted,
        authorizeExecutableExtensions: (request) => this.authorizeExecutableExtensions(request, pendingSessionId!, onPending),
        sessionFile: input.sessionFile,
        contextHandoffs: acceptedContextHandoffs(await createTaskWorkspace(this.deps.repoRoot).open({ kind: "standalone", taskId: input.taskId })),
        onCapabilityActivation: (activation) => {
          projector.accept({
            type: "capability_activation",
            ts: new Date().toISOString(),
            capabilityActivation: activation,
          });
        },
        delegate: (request, signal) => this.runDelegatedChild({
          taskId: input.taskId,
          runId: input.runId,
          parentThreadId: `${input.runId}.main`,
          modelRoute,
          request,
          signal,
        }),
        managedResources,
      });
      session = created.session;
      sessionRuntime = created.runtime;
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
        piRuntimeVersion: VERSION,
        cwd: created.access.workingDirectory,
        fileGrantIds: created.access.grants.map((grant) => grant.id),
        packages: managedResources.packages.map((pkg) => ({
          name: pkg.descriptor.package.name,
          source: pkg.descriptor.package.source,
          version: pkg.descriptor.package.version,
          integrity: pkg.descriptor.package.integrity,
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
      const live: LiveGeneralRun = { taskId: input.taskId, runId: input.runId, session, runtime: created.runtime, projector, rootThreadId };
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
            if (created.runtime) void created.runtime.dispose();
            else session!.dispose();
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
      unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        const ts = new Date().toISOString();
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          assistantText += delta;
          this.publishMessageStream({
            type: "assistant_delta",
            taskId: input.taskId,
            runId: input.runId,
            ts,
            text: delta,
          });
        } else if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
          if (!thinkingStarted) {
            thinkingStarted = true;
            this.publishMessageStream({
              type: "assistant_thinking_started",
              taskId: input.taskId,
              runId: input.runId,
              ts,
            });
          }
        } else if (event.type === "message_end") {
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
        } else if (event.type === "tool_execution_start") {
          projector.accept({
            type: "tool_start",
            ts,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            argsPreview: previewValue(event.args),
          });
        } else if (event.type === "tool_execution_end") {
          projector.accept({
            type: "tool_end",
            ts,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            isError: event.isError,
            resultPreview: previewValue(event.result),
            errorMessage: event.isError ? previewValue(event.result, 240) : undefined,
          });
        } else if (event.type === "queue_update") {
          void this.deps.messageQueue.syncPiQueue({
            locator: { kind: "standalone", taskId: input.taskId },
            runId: input.runId,
            followUp: event.followUp,
          }).catch((error) => {
            console.warn("Standalone message queue sync failed:", error instanceof Error ? error.message : String(error));
          });
          projector.accept({
            type: "queue_update",
            ts,
            text: `${event.steering.length} steering · ${event.followUp.length} follow-up queued`,
          });
        } else if (event.type === "compaction_start") {
          projector.accept({ type: "compaction_start", ts, reason: event.reason });
        } else if (event.type === "compaction_end") {
          projector.accept({
            type: "compaction_end",
            ts,
            reason: event.reason,
            tokensBefore: event.result?.tokensBefore,
            estimatedTokensAfter: event.result?.estimatedTokensAfter,
            isError: Boolean(event.errorMessage),
            errorMessage: event.errorMessage,
          });
        } else if (event.type === "auto_retry_start") {
          projector.accept({
            type: "retry_start",
            ts,
            retryAttempt: event.attempt,
            retryMaxAttempts: event.maxAttempts,
            errorMessage: event.errorMessage,
          });
        } else if (event.type === "auto_retry_end") {
          projector.accept({ type: "retry_end", ts, retrySuccess: event.success, errorMessage: event.finalError });
        }
      });
      await session.prompt(input.message);
      await session.waitForIdle();
      const stopped = this.deps.activeRuns.isStoppingOrStopped(input.runId);
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
        if (sessionRuntime) await sessionRuntime.dispose();
        else session.dispose();
      }
    }
  }

  private async persistThreadSession(taskId: string, runId: string, session: AgentSession): Promise<void> {
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
          piEntryId: session.sessionManager.getLeafId() ?? undefined,
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

    let childSession: AgentSession | undefined;
    let childRuntime: AgentSessionRuntime | undefined;
    let unsubscribe = () => {};
    let abortListener: (() => void) | undefined;
    const activityEvents: TaskRunEventDraft[] = [];
    let summary = "";
    try {
      const childAccess = await resolveStandaloneFileGrantAccess(this.deps.repoRoot, input.taskId);
      const childSessionId = `${generalAgentSessionId(input.taskId, childAccess.workingDirectory)}-${childId}`;
      const projectTrusted = await this.resolveWorkingDirectoryTrust(input.taskId, childSessionId);
      const created = await (this.deps.createSession ?? createGeneralAgentSession)({
        runtimeRoot: this.deps.repoRoot,
        taskId: input.taskId,
        agentDir: this.deps.piAgentDir,
        runId: input.runId,
        rootAgentThreadId: childId,
        sessionIdSuffix: childId,
        readOnlyChild: true,
        modelRuntime: await this.deps.modelRuntime(),
        modelProvider: input.modelRoute.provider,
        modelId: input.modelRoute.modelId,
        thinkingLevel: input.modelRoute.thinkingLevel,
        permissionContract: buildAgentPermissionContract({
          mode: "custom",
          customRules: { fileRead: "auto", fileWrite: "deny", webRead: "deny", bash: "deny", bridge: "deny" },
        }),
        projectTrusted,
        contextHandoffs: [[
          `Delegated task from Main: ${input.request.task}`,
          input.request.context ? `Minimum parent context:\n${input.request.context}` : undefined,
          "Return a concise, evidence-aware report to Main. Do not perform writes or side effects.",
        ].filter(Boolean).join("\n\n")],
        managedResources: await resolveApprovedManagedPackageResources(this.deps.repoRoot),
      });
      childSession = created.session;
      childRuntime = created.runtime;
      let eventIndex = 0;
      unsubscribe = childSession.subscribe((event: AgentSessionEvent) => {
        const occurredAt = new Date().toISOString();
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") summary += event.assistantMessageEvent.delta;
        if (event.type === "message_end" && (event.message as { role?: string }).role === "assistant" && !summary.trim()) {
          summary = assistantMessageText(event.message);
        }
        if (event.type !== "tool_execution_start" && event.type !== "tool_execution_end") return;
        eventIndex += 1;
        const ended = event.type === "tool_execution_end";
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
            title: `${role} ${ended ? (event.isError ? "failed" : "completed") : "started"} ${event.toolName}`,
            body: ended ? previewValue(event.result) : previewValue(event.args),
            tool: { name: event.toolName, effect: "read", target: null, outcome: ended ? (event.isError ? "failed" : "completed") : "started" },
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
            seq: activityEvents.length + 2,
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
            piEntryId: childSession.sessionManager.getLeafId() ?? undefined,
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
              id: `${childId}.failed`, taskId: input.taskId, runId: input.runId, agentThreadId: childId, seq: 1,
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
      if (childRuntime) await childRuntime.dispose();
      else childSession?.dispose();
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
