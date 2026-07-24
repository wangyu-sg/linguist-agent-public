import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createTaskWorkspace } from "@linguist-agent/cat-data";
import {
  buildAgentPermissionContract,
  parseGeneralAgentSessionPlan,
  prepareGeneralAgentSessionPlan,
  type AgentRuntimeEvent,
  type AgentRuntimePort,
  type AgentRuntimeSession,
  type AgentRuntimeSessionCreation,
} from "@linguist-agent/cat-runtime";
import {
  createGeneralWorkerRpcServer,
  createJsonlGeneralWorkerTransport,
  prepareGeneralWorkerRuntime,
  type GeneralWorkerRpcTransport,
} from "../packages/cat-server/src/general_worker_rpc.js";

class MemoryTransport implements GeneralWorkerRpcTransport {
  peer?: MemoryTransport;
  private readonly messageListeners = new Set<(message: unknown) => void>();
  private readonly closeListeners = new Set<(reason: string) => void>();
  closed = false;
  dropMessages = false;

  send(message: unknown): void {
    if (this.closed) throw new Error("transport closed");
    if (this.dropMessages) return;
    const cloned = JSON.parse(JSON.stringify(message)) as unknown;
    queueMicrotask(() => this.peer?.deliver(cloned));
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(reason = "closed"): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener(reason);
    if (this.peer && !this.peer.closed) this.peer.close(reason);
  }

  private deliver(message: unknown): void {
    if (!this.closed) for (const listener of this.messageListeners) listener(message);
  }
}

function pair(): [MemoryTransport, MemoryTransport] {
  const host = new MemoryTransport();
  const worker = new MemoryTransport();
  host.peer = worker;
  worker.peer = host;
  return [host, worker];
}

class FakeSession implements AgentRuntimeSession {
  readonly systemPrompt = "exact worker system prompt";
  isStreaming = false;
  prompts: string[] = [];
  steering: string[] = [];
  followUps: string[] = [];
  permissionResult?: string;
  delegationSummary?: string;
  throwSecret = false;
  private readonly listeners = new Set<(event: AgentRuntimeEvent) => void>();

  constructor(
    private readonly requestPermission: NonNullable<Parameters<AgentRuntimePort["createGeneralSession"]>[0]["requestPermissionDecision"]>,
    private readonly delegate: NonNullable<Parameters<AgentRuntimePort["createGeneralSession"]>[0]["delegate"]>,
    readonly sessionId = "worker-session",
    readonly sessionFile = "/synthetic/session.jsonl",
    private readonly leafId = "leaf-1",
  ) {}

  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(text: string): Promise<void> {
    if (this.throwSecret) throw new Error("Authorization: Bearer super-secret api_key=private-value");
    this.isStreaming = true;
    this.prompts.push(text);
    const decision = await this.requestPermission({
      requestId: "worker-permission",
      taskId: "rpc-chat",
      runId: "rpc-run",
      kind: "tool",
      toolName: "read",
      domain: "fileRead",
      riskClass: "low",
      argsSummary: "fixture",
    });
    this.permissionResult = decision.action;
    const child = await this.delegate({ task: "inspect", role: "Research Agent" });
    this.delegationSummary = child.summary;
    for (const listener of this.listeners) listener({ type: "message.delta", channel: "text", delta: "hello" });
    this.isStreaming = false;
  }

  async waitForIdle(): Promise<void> {}
  async steer(text: string): Promise<void> {
    if (text === "slow") await new Promise((resolve) => setTimeout(resolve, 5));
    this.steering.push(text);
  }
  async followUp(text: string): Promise<void> {
    this.followUps.push(text);
    for (const listener of this.listeners) listener({ type: "queue.changed", steering: [...this.steering], followUp: [...this.followUps] });
  }
  clearQueue(): { steering: string[]; followUp: string[] } {
    const current = { steering: [...this.steering], followUp: [...this.followUps] };
    this.steering = [];
    this.followUps = [];
    return current;
  }
  getSteeringMessages(): readonly string[] { return this.steering; }
  getFollowUpMessages(): readonly string[] { return this.followUps; }
  async compact(): Promise<unknown> { return { compacted: true }; }
  async abort(): Promise<void> { this.isStreaming = false; }
  leafEntryId(): string | undefined { return this.leafId; }
  hasEntry(entryId: string): boolean { return entryId === this.leafId; }
}

const root = await mkdtemp(join(tmpdir(), "la-general-worker-rpc-"));
const agentDir = await mkdtemp(join(tmpdir(), "la-general-worker-rpc-agent-"));
try {
  await createTaskWorkspace(root).create({
    owner: { kind: "standalone" },
    taskId: "rpc-chat",
    title: "RPC Chat",
    intent: "Verify General worker RPC activation.",
    kind: "general",
  });
  await mkdir(join(agentDir, "skills"), { recursive: true });
  const plan = await prepareGeneralAgentSessionPlan({
    runtimeRoot: root,
    taskId: "rpc-chat",
    runId: "rpc-run",
    rootAgentThreadId: "rpc-run.main",
    agentDir,
    modelProvider: "fixture",
    modelId: "fixture-model",
    thinkingLevel: "high",
    permissionContract: buildAgentPermissionContract({ mode: "ask" }),
    delegationEnabled: true,
    managedResources: { extensions: [], skills: [], prompts: [], themes: [] },
  });
  assert.throws(
    () => parseGeneralAgentSessionPlan({ ...plan, unknownAuthority: true }),
    /unknown field: unknownAuthority/,
  );

  const jsonlInput = new PassThrough();
  const jsonlOutput = new PassThrough();
  const jsonlOutputChunks: Buffer[] = [];
  jsonlOutput.on("data", (chunk: Buffer) => jsonlOutputChunks.push(chunk));
  const jsonlTransport = createJsonlGeneralWorkerTransport({ readable: jsonlInput, writable: jsonlOutput, maxMessageBytes: 2_048 });
  const jsonlMessages: unknown[] = [];
  jsonlTransport.onMessage((message) => jsonlMessages.push(message));
  jsonlInput.write([
    JSON.stringify({ schemaVersion: 1, type: "fixture" }),
    JSON.stringify({ schemaVersion: 1, type: "fixture-2" }),
    "",
  ].join("\n"));
  jsonlTransport.send({ schemaVersion: 1, type: "reply" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(jsonlMessages, [
    { schemaVersion: 1, type: "fixture" },
    { schemaVersion: 1, type: "fixture-2" },
  ]);
  assert.match(Buffer.concat(jsonlOutputChunks).toString("utf8"), /"type":"reply"/);
  jsonlTransport.close();

  let fakeSession: FakeSession | undefined;
  let emitCapabilityActivation: (() => void) | undefined;
  const runtimePort: AgentRuntimePort = {
    async supportsInput() { return true; },
    async createGeneralSession(input): Promise<AgentRuntimeSessionCreation> {
      assert.deepEqual(input.preparedPlan, plan);
      assert.ok(input.requestPermissionDecision);
      assert.ok(input.delegate);
      emitCapabilityActivation = () => input.onCapabilityActivation?.({
        query: "document",
        addedToolNames: ["document_extract_evidence"],
        matchedToolNames: ["document_extract_evidence"],
        sources: [{ toolName: "document_extract_evidence", source: "builtin", path: "inline" }],
      });
      fakeSession = new FakeSession(input.requestPermissionDecision, input.delegate);
      return {
        session: fakeSession,
        runtimeVersion: "fixture-runtime",
        access: plan.access,
        resources: {
          extensions: [],
          skills: [],
          prompts: [],
          contextFiles: [],
          activeToolNames: plan.initialActiveToolNames,
          entries: plan.resourceSnapshot.entries,
          conflicts: [],
          resourceSetHash: plan.resourceSnapshotHash,
        },
        fork: async (entryId, options) => {
          assert.equal(entryId, "leaf-1");
          assert.deepEqual(options, { position: "at" });
          return {
            cancelled: false,
            session: new FakeSession(input.requestPermissionDecision!, input.delegate!, "worker-branch-session", "/synthetic/branch.jsonl", "branch-leaf"),
          };
        },
        async dispose() {},
      };
    },
  };

  const [hostTransport, workerTransport] = pair();
  const worker = createGeneralWorkerRpcServer({ transport: workerTransport, runtimePort, requestTimeoutMs: 100 });
  const order: string[] = [];
  const events: AgentRuntimeEvent[] = [];
  const capabilityActivations: string[] = [];
  const prepared = await prepareGeneralWorkerRuntime({
    transport: hostTransport,
    plan,
    timeoutMs: 100,
    executionIdentity: {
      executionId: "rpc-run.execution.1",
      threadId: "rpc-run.main",
      turnId: "turn-1",
      runtimeEpochId: "rpc-run.epoch.1",
      configRevision: 1,
      executionProfile: "balanced",
      createdAt: "2026-07-23T01:00:00.000Z",
    },
    persistExecutionSnapshot: async (snapshot) => {
      order.push("persist");
      assert.equal(snapshot.promptHash, createHash("sha256").update("exact worker system prompt").digest("hex"));
      assert.equal(snapshot.toolManifestHash, plan.toolManifestHash);
      assert.equal(snapshot.resourceSnapshotHash, plan.resourceSnapshotHash);
    },
    requestPermissionDecision: async () => {
      order.push("permission");
      return { action: "allow_once" };
    },
    delegate: async () => {
      order.push("delegate");
      return { agentThreadId: "child-1", role: "Research Agent", summary: "verified" };
    },
    onCapabilityActivation: (activation) => capabilityActivations.push(...activation.addedToolNames),
  });
  order.push("prepared");
  assert.deepEqual(order, ["persist", "prepared"], "the Session proxy must not be returned before durable activation");
  assert.equal(prepared.attestation.planHash, plan.planHash);
  assert.equal(prepared.session.sessionId, "worker-session");
  const unsubscribe = prepared.session.subscribe((event) => events.push(event));
  emitCapabilityActivation?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(capabilityActivations, ["document_extract_evidence"]);
  await prepared.session.prompt("hello worker");
  await Promise.all([
    prepared.session.steer("slow"),
    prepared.session.followUp("next"),
  ]);
  await prepared.session.waitForIdle();
  assert.deepEqual(order, ["persist", "prepared", "permission", "delegate"]);
  assert.deepEqual(fakeSession?.prompts, ["hello worker"]);
  assert.equal(fakeSession?.permissionResult, "allow_once");
  assert.equal(fakeSession?.delegationSummary, "verified");
  assert.equal(events.some((event) => event.type === "message.delta"), true);
  assert.equal(events.some((event) => event.type === "queue.changed"), true);
  assert.deepEqual(prepared.session.getSteeringMessages(), ["slow"]);
  assert.deepEqual(prepared.session.getFollowUpMessages(), ["next"]);
  assert.ok(prepared.fork);
  const branch = await prepared.fork("leaf-1", { position: "at" });
  assert.equal(branch.cancelled, false);
  assert.equal(branch.session.sessionId, "worker-branch-session");
  assert.equal(branch.session.sessionFile, "/synthetic/branch.jsonl");
  assert.equal(branch.session.leafEntryId(), "branch-leaf");
  unsubscribe();
  await prepared.dispose();
  await worker.dispose();

  const [unactivatedHost, unactivatedWorker] = pair();
  const unactivatedServer = createGeneralWorkerRpcServer({ transport: unactivatedWorker, runtimePort, requestTimeoutMs: 100 });
  const unactivatedResponses: unknown[] = [];
  unactivatedHost.onMessage((message) => unactivatedResponses.push(message));
  unactivatedHost.send({ schemaVersion: 1, type: "request", requestId: "prepare-1", method: "prepare", payload: { plan } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  unactivatedHost.send({
    schemaVersion: 1,
    type: "request",
    requestId: "activate-wrong",
    method: "activate",
    payload: { executionSnapshot: { ...prepared.executionSnapshot, promptHash: "f".repeat(64) } },
  });
  unactivatedHost.send({ schemaVersion: 1, type: "request", requestId: "prompt-early", method: "prompt", payload: { text: "forbidden" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(JSON.stringify(unactivatedResponses), /activation hashes differ/);
  assert.match(JSON.stringify(unactivatedResponses), /WORKER_NOT_ACTIVATED/);
  await unactivatedServer.dispose();
  unactivatedHost.close();

  const mismatchedPort: AgentRuntimePort = {
    ...runtimePort,
    async createGeneralSession(input) {
      const created = await runtimePort.createGeneralSession(input);
      return { ...created, resources: { ...created.resources, activeToolNames: ["read"] } };
    },
  };
  const [mismatchHost, mismatchWorker] = pair();
  const mismatchServer = createGeneralWorkerRpcServer({ transport: mismatchWorker, runtimePort: mismatchedPort, requestTimeoutMs: 100 });
  await assert.rejects(
    () => prepareGeneralWorkerRuntime({
      transport: mismatchHost,
      plan,
      timeoutMs: 100,
      executionIdentity: {
        executionId: "rpc-run.execution.2",
        threadId: "rpc-run.main",
        turnId: "turn-2",
        runtimeEpochId: "rpc-run.epoch.1",
        configRevision: 1,
        executionProfile: "balanced",
        createdAt: "2026-07-23T01:01:00.000Z",
      },
      persistExecutionSnapshot: async () => assert.fail("mismatched attestation must not persist"),
      requestPermissionDecision: async () => ({ action: "deny" }),
      delegate: async () => ({ agentThreadId: "never", role: "Research Agent", summary: "never" }),
    }),
    /tool manifest differs from the PreparationPlan/,
  );
  await mismatchServer.dispose();
  mismatchHost.close();

  const [secretHost, secretWorker] = pair();
  const secretServer = createGeneralWorkerRpcServer({ transport: secretWorker, runtimePort, requestTimeoutMs: 100 });
  const secretPrepared = await prepareGeneralWorkerRuntime({
    transport: secretHost,
    plan,
    timeoutMs: 100,
    executionIdentity: {
      executionId: "rpc-run.execution.3",
      threadId: "rpc-run.main",
      turnId: "turn-3",
      runtimeEpochId: "rpc-run.epoch.1",
      configRevision: 1,
      executionProfile: "balanced",
      createdAt: "2026-07-23T01:02:00.000Z",
    },
    persistExecutionSnapshot: async () => {},
    requestPermissionDecision: async () => ({ action: "deny" }),
    delegate: async () => ({ agentThreadId: "never", role: "Research Agent", summary: "never" }),
  });
  assert.ok(fakeSession);
  fakeSession.throwSecret = true;
  const secretError = await secretPrepared.session.prompt("secret").then(() => "", (error: unknown) => error instanceof Error ? error.message : String(error));
  assert.match(secretError, /REDACTED/);
  assert.doesNotMatch(secretError, /super-secret|private-value/);
  await secretPrepared.dispose();
  await secretServer.dispose();

  const [timeoutHost] = pair();
  timeoutHost.dropMessages = true;
  await assert.rejects(
    () => prepareGeneralWorkerRuntime({
      transport: timeoutHost,
      plan,
      timeoutMs: 5,
      executionIdentity: {
        executionId: "rpc-run.execution.4",
        threadId: "rpc-run.main",
        turnId: "turn-4",
        runtimeEpochId: "rpc-run.epoch.1",
        configRevision: 1,
        executionProfile: "balanced",
        createdAt: "2026-07-23T01:03:00.000Z",
      },
      persistExecutionSnapshot: async () => {},
      requestPermissionDecision: async () => ({ action: "deny" }),
      delegate: async () => ({ agentThreadId: "never", role: "Research Agent", summary: "never" }),
    }),
    /timed out/,
  );

  const [closedHost, closedWorker] = pair();
  const closedPromise = prepareGeneralWorkerRuntime({
    transport: closedHost,
    plan,
    timeoutMs: 100,
    executionIdentity: {
      executionId: "rpc-run.execution.5",
      threadId: "rpc-run.main",
      turnId: "turn-5",
      runtimeEpochId: "rpc-run.epoch.1",
      configRevision: 1,
      executionProfile: "balanced",
      createdAt: "2026-07-23T01:04:00.000Z",
    },
    persistExecutionSnapshot: async () => {},
    requestPermissionDecision: async () => ({ action: "deny" }),
    delegate: async () => ({ agentThreadId: "never", role: "Research Agent", summary: "never" }),
  });
  closedWorker.close("worker crashed");
  await assert.rejects(() => closedPromise, /worker crashed/);

  process.stdout.write("general worker RPC tests passed\n");
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
}
