import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStandaloneFileGrant,
  createTaskWorkspace,
  ModelContextRegistry,
  planExecutionProfile,
} from "@linguist-agent/cat-data";
import {
  buildAgentPermissionContract,
  type AgentRuntimeEvent,
  type AgentRuntimePort,
  type RuntimeCompactionRequest,
} from "@linguist-agent/cat-runtime";
import { ActiveAgentRunRegistry } from "../packages/cat-server/src/active_agent_runs.js";
import { GeneralAgentRunCoordinator } from "../packages/cat-server/src/general_agent_runs.js";
import type { GeneralWorkerSessionAuthority } from "../packages/cat-server/src/general_worker_runtime.js";
import { TaskMessageQueueCoordinator } from "../packages/cat-server/src/task_message_queue.js";

class FakeGeneralSession {
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly sessionManager: {
    getLeafId: () => string;
    getEntry: (id: string) => { id: string } | undefined;
  };
  readonly systemPrompt = "General fixture prompt";
  isStreaming = false;
  steering: string[] = [];
  followUps: string[] = [];
  disposed = false;
  compactRequests: RuntimeCompactionRequest[] = [];
  beforeCompact?: (request: RuntimeCompactionRequest) => Promise<void>;
  promptFailure?: string;
  promptRequests: Array<{ text: string; images?: Array<{ type: string; data: string; mimeType: string }> }> = [];
  private listeners = new Set<(event: AgentRuntimeEvent) => void>();
  private releasePrompt!: () => void;
  private promptGate = new Promise<void>((resolve) => { this.releasePrompt = resolve; });

  constructor(sessionId = "fake-general-session", sessionFile = "/tmp/fake-general-session.jsonl", leafId = "entry-1") {
    this.sessionId = sessionId;
    this.sessionFile = sessionFile;
    this.sessionManager = {
      getLeafId: () => leafId,
      getEntry: (id) => id === leafId ? { id } : undefined,
    };
  }

  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  emitRuntimeDiagnostic(): void {
    this.emit({
      type: "runtime.diagnostic",
      code: "UNMAPPED_NATIVE_EVENT",
      nativeType: "future_pi_event",
      message: "Unmapped Pi runtime event future_pi_event.",
    });
  }

  emitRetry(): void {
    this.emit({ type: "retry.started", attempt: 1, maxAttempts: 2, delayMs: 10, errorMessage: "temporary" });
    this.emit({ type: "retry.completed", success: true, attempt: 1 });
  }

  async prompt(text = "", options?: { images?: Array<{ type: string; data: string; mimeType: string }> }): Promise<void> {
    this.promptRequests.push({ text, images: options?.images });
    this.isStreaming = true;
    if (this.promptFailure) throw new Error(this.promptFailure);
    await this.promptGate;
    if (this.followUps.length) {
      this.followUps = [];
      this.emit({ type: "queue.changed", steering: [...this.steering], followUp: [] });
    }
    this.emit({
      type: "message.delta",
      channel: "thinking",
      delta: "Reasoning step one. ",
    });
    this.emit({
      type: "message.delta",
      channel: "thinking",
      delta: "Reasoning step two.",
    });
    this.emit({
      type: "message.delta",
      channel: "text",
      delta: "Completed general work.",
    });
    this.emit({
      type: "message.completed",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Completed general work." }],
        stopReason: "stop",
        usage: { input: 12, output: 4, totalTokens: 16, cost: { total: 0.001 } },
      },
    });
    // A second assistant message whose reasoning only surfaces on message_end.
    // The fallback can only fire if the first message's accumulated thinking
    // was reset — a stale buffer would suppress it.
    this.emit({
      type: "message.completed",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "End-only reasoning." },
          { type: "text", text: "Follow-up answer." },
        ],
        stopReason: "stop",
      },
    });
    this.isStreaming = false;
    this.emit({ type: "lifecycle", phase: "agent_settled" });
  }

  async steer(message: string): Promise<void> {
    if (message.startsWith("/")) throw new Error("Extension commands cannot be queued as steering messages");
    this.steering.push(message);
    this.emit({ type: "queue.changed", steering: [...this.steering], followUp: [...this.followUps] });
  }

  async followUp(message: string): Promise<void> {
    if (message.startsWith("/")) throw new Error("Extension commands cannot be queued as follow-up messages");
    this.followUps.push(message);
    this.emit({ type: "queue.changed", steering: [...this.steering], followUp: [...this.followUps] });
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const queued = { steering: [...this.steering], followUp: [...this.followUps] };
    this.steering = [];
    this.followUps = [];
    this.emit({ type: "queue.changed", steering: [], followUp: [] });
    return queued;
  }

  getSteeringMessages(): readonly string[] { return this.steering; }
  getFollowUpMessages(): readonly string[] { return this.followUps; }
  leafEntryId(): string | undefined { return this.sessionManager.getLeafId(); }
  hasEntry(entryId: string): boolean { return Boolean(this.sessionManager.getEntry(entryId)); }

  async compact(request: RuntimeCompactionRequest): Promise<unknown> {
    await this.beforeCompact?.(request);
    this.compactRequests.push(request);
    return { summary: "compact summary", tokensBefore: 120, estimatedTokensAfter: 40 };
  }

  complete(): void { this.releasePrompt(); }
  async waitForIdle(): Promise<void> {}
  async abort(): Promise<void> { this.releasePrompt(); }
  dispose(): void { this.disposed = true; }
}

async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const root = await mkdtemp(join(tmpdir(), "la-general-runs-"));
try {
  const workspace = createTaskWorkspace(root);
  await workspace.create({
    owner: { kind: "standalone" },
    taskId: "chat-one",
    title: "General run",
    intent: "Exercise start, steer, follow-up, and projection.",
    kind: "general",
  });
  const privateWorkspace = join(root, "data", "assistant", "tasks", "chat-one", "workspace");
  await mkdir(privateWorkspace, { recursive: true });
  await writeFile(join(privateWorkspace, "AGENTS.md"), "# Trusted fixture context\n", "utf8");
  const imagePath = join(root, "reference.png");
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const imageGrant = await createStandaloneFileGrant(root, {
    taskId: "chat-one",
    path: imagePath,
    kind: "file",
    access: "read",
  });
  const fake = new FakeGeneralSession();
  const childFake = new FakeGeneralSession("fake-delegated-child", "/tmp/fake-delegated-child.jsonl");
  const stopFake = new FakeGeneralSession("fake-stop-worker", "/tmp/fake-stop-worker.jsonl");
  const crashFake = new FakeGeneralSession("fake-crash-worker", "/tmp/fake-crash-worker.jsonl");
  crashFake.promptFailure = "General worker RPC disconnected: worker crashed";
  const compactFake = new FakeGeneralSession();
  const forkSource = new FakeGeneralSession("fake-fork-source", fake.sessionFile, "entry-1");
  const forkBranch = new FakeGeneralSession("fake-fork-branch", "/tmp/fake-fork-branch.jsonl", "entry-1");
  let forkRuntimeDisposed = false;
  let delegateFromMain: ((input: { task: string; role?: string; context?: string }) => Promise<{ agentThreadId: string; role: string; summary: string }>) | undefined;
  let childWasReadOnly = false;
  let mainProjectTrusted = false;
  let mainModelRoute: { provider?: string; modelId?: string; thinkingLevel?: string } | undefined;
  let mainExecutionProfilePlan: { profile: string; profileHash: string } | undefined;
  const executionProfileRegistry = new ModelContextRegistry([
    { provider: "fixture", modelId: "fixture-model", contextWindow: 64_000, outputReserveTokens: 4_000 },
    { provider: "fixture", modelId: "selected-model", contextWindow: 64_000, outputReserveTokens: 4_000 },
    { provider: "fixture", modelId: "other-model", contextWindow: 64_000, outputReserveTokens: 4_000 },
  ]);
  const permissionRequests: string[] = [];
  const activeRuns = new ActiveAgentRunRegistry(0, 200);
  const messageQueue = new TaskMessageQueueCoordinator(root);
  const mainResources = {
    extensions: [],
    skills: [],
    prompts: [],
    contextFiles: [],
    activeToolNames: ["read"],
    entries: [{
      type: "context" as const,
      path: join(root, "AGENTS.md"),
      resolvedPath: join(root, "AGENTS.md"),
      source: "local",
      scope: "project" as const,
      origin: "top-level" as const,
      sha256: "c".repeat(64),
      sizeBytes: 12,
    }],
    conflicts: [{
      kind: "tool" as const,
      name: "duplicate_tool",
      winnerPath: "/trusted/winner.ts",
      shadowedPath: "/trusted/shadowed.ts",
    }],
    resourceSetHash: "d".repeat(64),
  };
  let hostMainSessionCalls = 0;
  const runtimePort: AgentRuntimePort = {
    supportsInput: async (_provider, _modelId, input) => input === "text" || input === "image",
    createGeneralSession: async () => {
      hostMainSessionCalls += 1;
      throw new Error("Host General Session construction is forbidden after Worker cutover");
    },
  };
  const workerRuntime: GeneralWorkerSessionAuthority = {
    async createGeneralSession(input) {
      const isCompaction = input.executionIdentity.turnId.endsWith(".compaction");
      const isFork = input.executionIdentity.turnId.endsWith(".fork");
      const mainSession = input.plan.readOnlyChild
        ? childFake
        : isCompaction
          ? compactFake
          : isFork
            ? forkSource
            : input.plan.taskId === "chat-stop"
              ? stopFake
              : input.plan.taskId === "chat-crash"
                ? crashFake
                : fake;
      if (input.plan.readOnlyChild) childWasReadOnly = true;
      if (input.plan.delegationEnabled) delegateFromMain = (request) => input.delegate(request);
      mainProjectTrusted = input.plan.projectTrusted;
      mainModelRoute = {
        provider: input.plan.modelProvider,
        modelId: input.plan.modelId,
        thinkingLevel: input.plan.thinkingLevel,
      };
      mainExecutionProfilePlan = input.plan.executionProfilePlan;
      const executionSnapshot = {
        schemaVersion: 1 as const,
        executionId: input.executionIdentity.executionId,
        runId: input.plan.runId!,
        threadId: input.executionIdentity.threadId,
        turnId: input.executionIdentity.turnId,
        runtimeEpochId: input.executionIdentity.runtimeEpochId,
        configRevision: input.executionIdentity.configRevision,
        providerId: input.plan.modelProvider ?? null,
        modelId: input.plan.modelId ?? null,
        reasoningEffort: input.plan.thinkingLevel ?? null,
        executionProfile: input.executionIdentity.executionProfile,
        promptHash: createHash("sha256").update(mainSession.systemPrompt).digest("hex"),
        toolManifestHash: input.plan.toolManifestHash,
        resourceSnapshotHash: input.plan.resourceSnapshotHash,
        capabilityGrantHash: input.plan.capabilityGrantHash,
        contextInputHash: input.plan.contextInputHash,
        createdAt: input.executionIdentity.createdAt,
      };
      await input.persistExecutionSnapshot(executionSnapshot);
      const resources = {
        ...mainResources,
        activeToolNames: input.plan.initialActiveToolNames,
        entries: input.plan.resourceSnapshot.entries,
        resourceSetHash: input.plan.resourceSnapshotHash,
      };
      return {
        session: mainSession,
        runtimeVersion: "fixture-runtime",
        access: input.plan.access,
        resources,
        executionSnapshot,
        workerId: `general-${input.executionIdentity.turnId}`,
        runtimeEpochId: input.executionIdentity.runtimeEpochId,
        terminal: new Promise(() => undefined),
        ...(isFork ? {
          fork: async (entryId: string, forkOptions?: { position?: "before" | "at" }) => {
            assert.equal(entryId, "entry-1");
            assert.equal(forkOptions?.position, "at");
            return { cancelled: false, session: forkBranch };
          },
        } : {}),
        dispose: async () => {
          mainSession.dispose();
          if (isFork) forkRuntimeDisposed = true;
        },
      };
    },
  };
  const coordinator = new GeneralAgentRunCoordinator({
    repoRoot: root,
    piAgentDir: join(root, "pi-agent"),
    activeRuns,
    messageQueue,
    runtimePort,
    workerRuntime,
    modelRoute: async () => ({ provider: "fixture", modelId: "fixture-model", thinkingLevel: "high", executionProfile: "balanced" as const }),
    resolveModelRoute: async (route) => {
      assert.ok(route.provider && route.modelId, "the server model resolver receives a complete route");
      const profilePlan = planExecutionProfile({
        ...(route.executionProfile && route.executionProfile !== "custom"
          ? { requestedProfile: route.executionProfile }
          : { explicitModel: { provider: route.provider, modelId: route.modelId, ...(route.thinkingLevel ? { thinkingLevel: route.thinkingLevel } : {}) } }),
        qualityRoutes: {
          balanced: { provider: "fixture", modelId: "fixture-model", thinkingLevel: "high" },
        },
        requestBudget: {
          registry: executionProfileRegistry,
          provider: route.provider,
          modelId: route.modelId,
          toolSchemaTokens: 0,
          historyTokens: 0,
          providerFramingTokens: 0,
          safetyMarginTokens: 0,
          compactionReserveTokens: 0,
        },
      });
      return { ...route, profilePlan };
    },
    permissionContract: async () => buildAgentPermissionContract({ mode: "ask" }),
    requestPermissionDecision: async (request, onPending) => {
      permissionRequests.push(request.toolName);
      onPending({ ...request, requestId: `permission-${permissionRequests.length}` });
      return request.toolName === "Trust working-directory Pi resources"
        ? { decision: "approve", reason: "fixture directory" }
        : { decision: "deny", reason: "not needed in fixture" };
    },
  });
  const streamEvents: Array<{ type: string; text?: string }> = [];
  const unsubscribeStream = coordinator.subscribeMessageStream("chat-one", (event) => streamEvents.push(event));

  const started = await coordinator.acceptMessage({
    taskId: "chat-one",
    message: "First request",
    delivery: "auto",
    modelProvider: "fixture",
    modelId: "selected-model",
    thinkingLevel: "low",
    attachmentGrantIds: [imageGrant.grant.id],
  });
  assert.equal(started.delivery, "start");
  await waitFor(async () => fake.isStreaming && (await workspace.open({ kind: "standalone", taskId: "chat-one" })).runs[0]?.status === "active", "active General Run");
  assert.equal(activeRuns.find({ turnId: started.runId })?.workerId, `general-${started.runId}`);
  assert.equal(activeRuns.find({ turnId: started.runId })?.runtimeEpochId, `${started.runId}.epoch.1`);
  assert.equal(mainProjectTrusted, true);
  assert.deepEqual(mainModelRoute, { provider: "fixture", modelId: "selected-model", thinkingLevel: "low" });
  assert.equal(mainExecutionProfilePlan?.profile, "custom", "the Worker receives the immutable profile plan rather than an ambient model setting");
  assert.match(mainExecutionProfilePlan?.profileHash ?? "", /^[a-f0-9]{64}$/u);
  assert.deepEqual(fake.promptRequests[0]?.images, [{
    type: "image",
    mimeType: "image/png",
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
  }], "a granted PNG reaches Pi's native prompt image channel");
  assert.match(fake.promptRequests[0]?.text ?? "", /Attached files for this request: reference\.png/, "the session receives explicit attachment provenance alongside image content");
  assert.deepEqual(permissionRequests, ["Trust working-directory Pi resources"]);
  fake.emitRuntimeDiagnostic();
  fake.emitRetry();

  assert.ok(delegateFromMain, "Main General Core must receive the server-owned delegation bridge");
  childFake.complete();
  const delegated = await delegateFromMain({ task: "Inspect the granted files and summarize risks.", role: "Research Agent" });
  assert.equal(childWasReadOnly, true);
  assert.equal(delegated.role, "Research Agent");
  const withChild = await workspace.open({ kind: "standalone", taskId: "chat-one" });
  const childThread = withChild.agentThreads.find((thread) => thread.id === delegated.agentThreadId);
  assert.equal(childThread?.parentThreadId, `${started.runId}.main`);
  assert.equal(childThread?.identity.kind, "specialist");
  assert.equal(childThread?.identity.roleLabel, "Research Agent");
  assert.equal(childThread?.status, "complete");
  assert.equal(childThread?.piSessionId, "fake-delegated-child");
  assert.equal(
    withChild.activities.some((activity) => activity.agentThreadId === childThread?.id
      && activity.title === "Delegated Worker isolated"
      && activity.body?.includes(`${childThread?.id}.epoch.1`)),
    true,
    "delegated child activity records the Worker and runtime epoch before execution",
  );
  assert.equal(withChild.activities.some((activity) => activity.agentThreadId === childThread?.id && activity.type === "final_response"), true);
  assert.equal(withChild.agentThreads.find((thread) => thread.id === `${started.runId}.main`)?.childThreadIds.includes(delegated.agentThreadId), true);

  const steered = await coordinator.acceptMessage({ taskId: "chat-one", message: "Adjust the current work", delivery: "auto" });
  assert.equal(steered.delivery, "steer");
  assert.deepEqual(fake.steering, ["Adjust the current work"]);
  const followed = await coordinator.acceptMessage({ taskId: "chat-one", message: "Then prepare a summary", delivery: "follow_up" });
  assert.equal(followed.delivery, "follow_up");
  assert.deepEqual(fake.followUps, ["Then prepare a summary"]);
  await assert.rejects(
    coordinator.acceptMessage({
      taskId: "chat-one",
      message: "Change models while active",
      modelProvider: "fixture",
      modelId: "other-model",
    }),
    /apply to a new Run/,
  );
  await assert.rejects(
    coordinator.acceptMessage({ taskId: "chat-one", message: "/fixture-command", delivery: "steer" }),
    /Extension commands cannot be queued/,
  );

  fake.complete();
  await waitFor(async () => (await workspace.open({ kind: "standalone", taskId: "chat-one" })).task.status === "complete", "completed General Run");
  const completed = await workspace.open({ kind: "standalone", taskId: "chat-one" });
  assert.equal(completed.runs[0]?.id, started.runId);
  assert.equal(completed.runs[0]?.status, "complete");
  assert.equal(completed.runs[0]?.resourceManifest?.profile, "general");
  assert.equal(completed.runs[0]?.resourceManifest?.resourceIndexHash, completed.runs[0]?.executionSnapshots?.[0]?.resourceSnapshotHash);
  assert.equal(completed.runs[0]?.resourceManifest?.activeToolNames.includes("read"), true);
  assert.equal(completed.runs[0]?.executionSnapshots?.length, 1);
  assert.equal(completed.runs[0]?.executionSnapshots?.[0]?.modelId, "selected-model");
  assert.equal(completed.runs[0]?.executionSnapshots?.[0]?.executionProfile, "custom", "an explicit legacy model selection must not be relabelled as a quality tier");
  assert.equal(completed.runs[0]?.executionSnapshots?.[0]?.configRevision, 1);
  assert.equal(completed.runs[0]?.executionSnapshots?.[0]?.promptHash, createHash("sha256").update(fake.systemPrompt).digest("hex"));
  assert.equal(hostMainSessionCalls, 0, "new General Runs must never construct a Host Pi Session after cutover");
  assert.deepEqual(completed.runs[0]?.configChanges, []);
  assert.equal(completed.activities.some((activity) => activity.title === "Pi resource conflicts resolved" && activity.body?.includes("winner: /trusted/winner.ts")), true);
  assert.deepEqual(
    completed.activities.filter((activity) => activity.type === "message").map((activity) => activity.body),
    ["First request\n\n附件：reference.png", "Adjust the current work", "Then prepare a summary"],
  );
  assert.equal(completed.activities.some((activity) => activity.type === "final_response" && activity.body === "Completed general work."), true);
  assert.equal(completed.activities.some((activity) => activity.title === "Message queue updated"), true);
  assert.equal(completed.activities.some((activity) => activity.title === "Retrying Agent run"), true);
  assert.equal(completed.activities.some((activity) => activity.title === "Retry completed"), true);
  assert.equal(
    completed.activities.some((activity) => activity.title === "Runtime event diagnostic"
      && activity.body === "UNMAPPED_NATIVE_EVENT: Unmapped Pi runtime event future_pi_event."),
    true,
    "unmapped runtime events remain visible in canonical Task activity",
  );
  assert.equal(completed.artifacts.some((artifact) => artifact.content.text === "Completed general work."), true);
  assert.equal(completed.usage?.totalTokens, 16);
  assert.deepEqual(streamEvents.filter((event) => event.type !== "queue_update").map((event) => event.type), [
    "turn_start",
    "permission_request",
    "assistant_thinking_started",
    "assistant_delta",
    "assistant_delta",
    "assistant_final",
    "done",
  ]);
  assert.equal(streamEvents.some((event) => event.type === "queue_update"), true);
  assert.equal(streamEvents.filter((event) => event.type === "assistant_thinking_started").length, 1);
  assert.equal(streamEvents.some((event) => event.text?.includes("Reasoning")), false);
  assert.equal(streamEvents.find((event) => event.type === "assistant_delta")?.text, "Completed general work.");
  // Hidden reasoning never crosses the renderer stream or canonical history.
  assert.equal(completed.activities.some((activity) => activity.body?.includes("Reasoning")), false);
  assert.equal(completed.artifacts.some((artifact) => artifact.content.text?.includes("Reasoning")), false);
  assert.equal(completed.activities.filter((activity) => activity.type === "final_response" && activity.agentThreadId === `${started.runId}.main`).length, 2);
  unsubscribeStream();
  await waitFor(async () => activeRuns.list().length === 0, "active General Run cleanup");
  assert.deepEqual(activeRuns.list(), []);
  assert.equal(fake.disposed, true);

  await workspace.create({
    owner: { kind: "standalone" },
    taskId: "chat-stop",
    title: "Stop worker",
    intent: "Stop a Worker-owned General Run.",
    kind: "general",
  });
  const stopStarted = await coordinator.acceptMessage({ taskId: "chat-stop", message: "Wait for Stop", delivery: "auto" });
  await waitFor(async () => stopFake.isStreaming && Boolean(activeRuns.find({ turnId: stopStarted.runId })?.workerId), "Worker-owned Run before Stop");
  const stopResult = await coordinator.stop({ taskId: "chat-stop", reason: "test stop" }) as { stopped: number };
  assert.equal(stopResult.stopped, 1);
  await waitFor(async () => (await workspace.open({ kind: "standalone", taskId: "chat-stop" })).runs[0]?.status === "stopped", "stopped Worker Run projection");
  assert.equal((await workspace.open({ kind: "standalone", taskId: "chat-stop" })).runs[0]?.executionSnapshots?.[0]?.executionProfile, "balanced", "the configured default remains the known Balanced compatibility profile");
  assert.equal(stopFake.disposed, true);

  await workspace.create({
    owner: { kind: "standalone" },
    taskId: "chat-crash",
    title: "Crash worker",
    intent: "Project a Worker disconnect as a failed Run.",
    kind: "general",
  });
  await coordinator.acceptMessage({ taskId: "chat-crash", message: "Trigger disconnect", delivery: "auto" });
  await waitFor(async () =>
    (await workspace.open({ kind: "standalone", taskId: "chat-crash" })).runs[0]?.status === "failed" && crashFake.disposed,
  "failed Worker Run projection and disposal");
  const crashed = await workspace.open({ kind: "standalone", taskId: "chat-crash" });
  assert.equal(crashed.activities.some((activity) => activity.status === "error" && activity.body?.includes("worker crashed")), true);
  assert.equal(crashFake.disposed, true);
  assert.equal(hostMainSessionCalls, 0, "Stop and crash paths must not fall back to Host Session construction");

  const compactRun = completed.runs[0]!;
  const compactThread = completed.agentThreads.find((thread) => thread.id === compactRun.rootAgentThreadId)!;
  await workspace.appendGenerated({
    kind: "standalone",
    taskId: "chat-one",
    runId: compactRun.id,
    events: [{
      type: "artifact_upsert",
      agentThreadId: compactThread.id,
      artifact: {
        id: "pending-artifact",
        taskId: "chat-one",
        runId: compactRun.id,
        type: "preview",
        status: "reviewable",
        title: "Pending review",
        scope: completed.task.scope,
        version: 1,
        provenance: { agentThreadId: compactThread.id, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: [],
        content: { kind: "fixture" },
        createdAt: "2026-07-22T20:00:00.000Z",
        updatedAt: "2026-07-22T20:00:00.000Z",
      },
    }, {
      type: "decision_upsert",
      agentThreadId: compactThread.id,
      decision: {
        id: "pending-decision",
        taskId: "chat-one",
        runId: compactRun.id,
        requestedByThreadId: compactThread.id,
        kind: "approval",
        status: "required",
        prompt: "Approve the pending result?",
        options: [{ id: "approve", label: "Approve", action: "approve", destructive: false }],
        scope: completed.task.scope,
        createdAt: "2026-07-22T20:00:00.000Z",
      },
    }],
  });
  compactFake.beforeCompact = async (request) => {
    const persisted = await workspace.open({ kind: "standalone", taskId: "chat-one" });
    assert.equal(
      persisted.artifacts.some((artifact) => artifact.id === request.handoff.handoffId),
      true,
      "the structured handoff must be durable before the exact Pi session compacts",
    );
  };

  assert.deepEqual(await coordinator.compact({ taskId: "chat-one", customInstructions: "Keep decisions." }), {
    summary: "compact summary",
    tokensBefore: 120,
    estimatedTokensAfter: 40,
  });
  assert.equal(compactFake.compactRequests.length, 1);
  assert.equal(compactFake.compactRequests[0]?.handoff.requestedFocus, "Keep decisions.");
  assert.deepEqual(compactFake.compactRequests[0]?.handoff.openDecisionIds, ["pending-decision"]);
  assert.deepEqual(compactFake.compactRequests[0]?.handoff.pendingArtifactIds, ["pending-artifact"]);
  assert.equal(compactFake.compactRequests[0]?.handoff.sessionId, compactFake.sessionId);
  assert.equal(compactFake.compactRequests[0]?.handoff.execution.resourceSnapshotHash, compactRun.executionSnapshots?.at(-1)?.resourceSnapshotHash);
  assert.equal(compactFake.compactRequests[0]?.handoff.policyHash, compactRun.executionSnapshots?.at(-1)?.capabilityGrantHash);
  assert.equal(compactFake.disposed, true);

  const forked = await coordinator.fork({ taskId: "chat-one", position: "at" }) as { threadId: string; branchPointEntryId: string };
  assert.equal(forked.branchPointEntryId, "entry-1");
  const afterFork = await workspace.open({ kind: "standalone", taskId: "chat-one" });
  const branchThread = afterFork.agentThreads.find((thread) => thread.id === forked.threadId);
  assert.equal(branchThread?.parentThreadId, completed.agentThreads[0]?.id);
  assert.equal(branchThread?.piSessionId, "fake-fork-branch");
  assert.equal(branchThread?.branchPointEntryId, "entry-1");
  assert.equal(forkRuntimeDisposed, true);

  console.log("general Agent Run coordinator tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
