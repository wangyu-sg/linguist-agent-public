import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, AgentSessionEvent, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { createTaskWorkspace } from "@linguist-agent/cat-data";
import { buildAgentPermissionContract } from "@linguist-agent/cat-runtime";
import { ActiveAgentRunRegistry } from "../packages/cat-server/src/active_agent_runs.js";
import { GeneralAgentRunCoordinator } from "../packages/cat-server/src/general_agent_runs.js";
import { TaskMessageQueueCoordinator } from "../packages/cat-server/src/task_message_queue.js";

class FakeGeneralSession {
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly sessionManager: {
    getLeafId: () => string;
    getEntry: (id: string) => { id: string } | undefined;
  };
  isStreaming = false;
  steering: string[] = [];
  followUps: string[] = [];
  disposed = false;
  compactInstructions: Array<string | undefined> = [];
  private listeners = new Set<(event: AgentSessionEvent) => void>();
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

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AgentSessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async prompt(): Promise<void> {
    this.isStreaming = true;
    await this.promptGate;
    if (this.followUps.length) {
      this.followUps = [];
      this.emit({ type: "queue_update", steering: [...this.steering], followUp: [] } as AgentSessionEvent);
    }
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "Reasoning step one. " },
      message: { role: "assistant", content: [] },
    } as AgentSessionEvent);
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "Reasoning step two." },
      message: { role: "assistant", content: [] },
    } as AgentSessionEvent);
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Completed general work." },
      message: { role: "assistant", content: [] },
    } as AgentSessionEvent);
    this.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Completed general work." }],
        stopReason: "stop",
        usage: { input: 12, output: 4, totalTokens: 16, cost: { total: 0.001 } },
      },
    } as AgentSessionEvent);
    // A second assistant message whose reasoning only surfaces on message_end.
    // The fallback can only fire if the first message's accumulated thinking
    // was reset — a stale buffer would suppress it.
    this.emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "End-only reasoning." },
          { type: "text", text: "Follow-up answer." },
        ],
        stopReason: "stop",
      },
    } as AgentSessionEvent);
    this.isStreaming = false;
    this.emit({ type: "agent_settled" } as AgentSessionEvent);
  }

  async steer(message: string): Promise<void> {
    if (message.startsWith("/")) throw new Error("Extension commands cannot be queued as steering messages");
    this.steering.push(message);
    this.emit({ type: "queue_update", steering: [...this.steering], followUp: [...this.followUps] } as AgentSessionEvent);
  }

  async followUp(message: string): Promise<void> {
    if (message.startsWith("/")) throw new Error("Extension commands cannot be queued as follow-up messages");
    this.followUps.push(message);
    this.emit({ type: "queue_update", steering: [...this.steering], followUp: [...this.followUps] } as AgentSessionEvent);
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const queued = { steering: [...this.steering], followUp: [...this.followUps] };
    this.steering = [];
    this.followUps = [];
    this.emit({ type: "queue_update", steering: [], followUp: [] } as AgentSessionEvent);
    return queued;
  }

  getSteeringMessages(): readonly string[] { return this.steering; }
  getFollowUpMessages(): readonly string[] { return this.followUps; }

  async compact(customInstructions?: string): Promise<unknown> {
    this.compactInstructions.push(customInstructions);
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
  const fake = new FakeGeneralSession();
  const childFake = new FakeGeneralSession("fake-delegated-child", "/tmp/fake-delegated-child.jsonl");
  const compactFake = new FakeGeneralSession();
  const forkSource = new FakeGeneralSession("fake-fork-source", fake.sessionFile, "entry-1");
  const forkBranch = new FakeGeneralSession("fake-fork-branch", "/tmp/fake-fork-branch.jsonl", "entry-1");
  let forkRuntimeDisposed = false;
  const forkRuntime = {
    session: forkSource,
    async fork(entryId: string, options?: { position?: "before" | "at" }) {
      assert.equal(entryId, "entry-1");
      assert.equal(options?.position, "at");
      this.session = forkBranch;
      return { cancelled: false };
    },
    async dispose() { forkRuntimeDisposed = true; },
  } as unknown as AgentSessionRuntime;
  let createdSessions = 0;
  let delegateFromMain: ((input: { task: string; role?: string; context?: string }) => Promise<{ agentThreadId: string; role: string; summary: string }>) | undefined;
  let childWasReadOnly = false;
  let mainProjectTrusted = false;
  let mainModelRoute: { provider?: string; modelId?: string; thinkingLevel?: string } | undefined;
  const permissionRequests: string[] = [];
  const activeRuns = new ActiveAgentRunRegistry(0, 200);
  const messageQueue = new TaskMessageQueueCoordinator(root);
  const coordinator = new GeneralAgentRunCoordinator({
    repoRoot: root,
    piAgentDir: join(root, "pi-agent"),
    activeRuns,
    messageQueue,
    modelRuntime: async () => ({}) as never,
    modelRoute: async () => ({ provider: "fixture", modelId: "fixture-model", thinkingLevel: "high" }),
    permissionContract: async () => buildAgentPermissionContract({ mode: "ask" }),
    requestPermissionDecision: async (request, onPending) => {
      permissionRequests.push(request.toolName);
      onPending({ ...request, requestId: `permission-${permissionRequests.length}` });
      return request.toolName === "Trust working-directory Pi resources"
        ? { decision: "approve", reason: "fixture directory" }
        : { decision: "deny", reason: "not needed in fixture" };
    },
    createSession: async (options) => {
      const index = createdSessions++;
      if (index === 0) delegateFromMain = options.delegate;
      if (index === 0) mainProjectTrusted = options.projectTrusted === true;
      if (index === 0) mainModelRoute = {
        provider: options.modelProvider,
        modelId: options.modelId,
        thinkingLevel: options.thinkingLevel,
      };
      if (index === 1) childWasReadOnly = options.readOnlyChild === true;
      return {
      session: (index === 0 ? fake : index === 1 ? childFake : index === 2 ? compactFake : forkSource) as unknown as AgentSession,
      ...(index === 3 ? { runtime: forkRuntime } : {}),
      access: { workspaceRoot: root, workingDirectory: root, grants: [] },
      resources: {
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
      },
    }},
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
  });
  assert.equal(started.delivery, "start");
  await waitFor(async () => fake.isStreaming && (await workspace.open({ kind: "standalone", taskId: "chat-one" })).runs[0]?.status === "active", "active General Run");
  assert.equal(mainProjectTrusted, true);
  assert.deepEqual(mainModelRoute, { provider: "fixture", modelId: "selected-model", thinkingLevel: "low" });
  assert.deepEqual(permissionRequests, ["Trust working-directory Pi resources"]);

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
  assert.equal(completed.runs[0]?.resourceManifest?.resourceIndexHash, "d".repeat(64));
  assert.equal(completed.runs[0]?.resourceManifest?.activeToolNames.includes("read"), true);
  assert.equal(completed.activities.some((activity) => activity.title === "Pi resource conflicts resolved" && activity.body?.includes("winner: /trusted/winner.ts")), true);
  assert.deepEqual(
    completed.activities.filter((activity) => activity.type === "message").map((activity) => activity.body),
    ["First request", "Adjust the current work", "Then prepare a summary"],
  );
  assert.equal(completed.activities.some((activity) => activity.type === "final_response" && activity.body === "Completed general work."), true);
  assert.equal(completed.activities.some((activity) => activity.title === "Message queue updated"), true);
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

  assert.deepEqual(await coordinator.compact({ taskId: "chat-one", customInstructions: "Keep decisions." }), {
    summary: "compact summary",
    tokensBefore: 120,
    estimatedTokensAfter: 40,
  });
  assert.deepEqual(compactFake.compactInstructions, ["Keep decisions."]);
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
