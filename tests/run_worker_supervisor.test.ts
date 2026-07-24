import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskExecutionSnapshot } from "@linguist-agent/cat-data";
import {
  RunWorkerSupervisor,
  NodeJsonlRunWorkerProcessAdapter,
  parseRunWorkerBootstrap,
  type RunWorkerCommand,
  type RunWorkerProcess,
  type RunWorkerProcessAdapter,
  type RunWorkerProcessCallbacks,
} from "../packages/cat-server/src/run_worker_supervisor.js";

const hash = (value: string): string => value.repeat(64).slice(0, 64);
const executionSnapshot: TaskExecutionSnapshot = {
  schemaVersion: 1,
  executionId: "run-1.execution.1",
  runId: "run-1",
  threadId: "run-1.main",
  turnId: "turn-1",
  runtimeEpochId: "run-1.epoch.1",
  configRevision: 1,
  providerId: "fixture",
  modelId: "fixture-model",
  reasoningEffort: null,
  executionProfile: "balanced",
  promptHash: hash("a"),
  toolManifestHash: hash("b"),
  resourceSnapshotHash: hash("c"),
  capabilityGrantHash: hash("d"),
  contextInputHash: hash("e"),
  createdAt: "2026-07-23T00:00:00.000Z",
};

const bootstrap = {
  schemaVersion: 1 as const,
  workerId: "worker-1",
  runId: "run-1",
  profile: "general" as const,
  executionSnapshot,
  runtimeRoot: "/synthetic/runtime",
  workingDirectory: "/synthetic/workspace",
  createdAt: "2026-07-23T00:00:01.000Z",
};

assert.deepEqual(parseRunWorkerBootstrap(bootstrap), bootstrap);
const preparationBootstrap = {
  ...bootstrap,
  workerId: "worker-preparation",
  executionSnapshot: undefined,
  preparationPlanHash: hash("f"),
};
assert.deepEqual(parseRunWorkerBootstrap(preparationBootstrap), {
  schemaVersion: 1,
  workerId: "worker-preparation",
  runId: bootstrap.runId,
  profile: "general",
  preparationPlanHash: hash("f"),
  runtimeRoot: bootstrap.runtimeRoot,
  workingDirectory: bootstrap.workingDirectory,
  createdAt: bootstrap.createdAt,
});
assert.throws(
  () => parseRunWorkerBootstrap({ ...bootstrap, schemaVersion: 2 }),
  /schemaVersion must be 1/,
);
assert.throws(
  () => parseRunWorkerBootstrap({ ...bootstrap, executionSnapshot: { ...executionSnapshot, runId: "other" } }),
  /executionSnapshot.runId must match/,
);
assert.throws(
  () => parseRunWorkerBootstrap({ ...bootstrap, extra: true }),
  /unknown field: extra/,
);

type FakeBehavior = "complete" | "hang" | "silent" | "crash";

class FakeProcess implements RunWorkerProcess {
  readonly commands: RunWorkerCommand[] = [];
  readonly signals: NodeJS.Signals[] = [];
  constructor(
    readonly callbacks: RunWorkerProcessCallbacks,
    private readonly behavior: FakeBehavior,
  ) {}

  send(command: RunWorkerCommand): void {
    this.commands.push(command);
    if (command.type === "rpc") {
      queueMicrotask(() => this.callbacks.onMessage({ schemaVersion: 1, type: "rpc", workerId: command.workerId, payload: command.payload }));
      return;
    }
    if (command.type !== "bootstrap") return;
    if (this.behavior === "crash") {
      queueMicrotask(() => this.callbacks.onExit({ code: 7, signal: null }));
      return;
    }
    queueMicrotask(() => this.callbacks.onMessage({ schemaVersion: 1, type: "ready", workerId: command.bootstrap.workerId }));
    if (this.behavior === "complete") {
      queueMicrotask(() => this.callbacks.onMessage({ schemaVersion: 1, type: "heartbeat", workerId: command.bootstrap.workerId, sequence: 1 }));
      queueMicrotask(() => this.callbacks.onMessage({ schemaVersion: 1, type: "completed", workerId: command.bootstrap.workerId }));
    }
  }

  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    queueMicrotask(() => this.callbacks.onExit({ code: null, signal }));
  }
}

class FakeAdapter implements RunWorkerProcessAdapter {
  processes: FakeProcess[] = [];
  constructor(private readonly behavior: FakeBehavior) {}
  spawn(_workerId: string, callbacks: RunWorkerProcessCallbacks): RunWorkerProcess {
    const process = new FakeProcess(callbacks, this.behavior);
    this.processes.push(process);
    return process;
  }
}

const completeAdapter = new FakeAdapter("complete");
const completeSupervisor = new RunWorkerSupervisor(completeAdapter, {
  readyTimeoutMs: 50,
  heartbeatTimeoutMs: 50,
  cancelGraceMs: 10,
});
const completed = await completeSupervisor.start(bootstrap);
assert.equal((await completed.terminal).kind, "completed");
assert.deepEqual(completeAdapter.processes[0]?.signals, []);

const hangingAdapter = new FakeAdapter("hang");
const hangingSupervisor = new RunWorkerSupervisor(hangingAdapter, {
  readyTimeoutMs: 50,
  heartbeatTimeoutMs: 500,
  cancelGraceMs: 5,
});
const hanging = await hangingSupervisor.start({ ...bootstrap, workerId: "worker-cancel" });
const applicationMessages: unknown[] = [];
hanging.applicationTransport.onMessage((message) => applicationMessages.push(message));
hanging.applicationTransport.send({ requestId: "rpc-1" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(applicationMessages, [{ requestId: "rpc-1" }]);
const stopped = await hanging.stop("user_requested");
assert.equal(stopped.kind, "stopped");
assert.equal(hangingAdapter.processes[0]?.commands.some((command) => command.type === "cancel"), true);
assert.deepEqual(hangingAdapter.processes[0]?.signals, ["SIGKILL"]);

const silentAdapter = new FakeAdapter("silent");
const silentSupervisor = new RunWorkerSupervisor(silentAdapter, {
  readyTimeoutMs: 50,
  heartbeatTimeoutMs: 5,
  cancelGraceMs: 5,
});
const silent = await silentSupervisor.start({ ...bootstrap, workerId: "worker-silent" });
const silentTerminal = await silent.terminal;
assert.deepEqual(silentTerminal, { kind: "failed", code: "heartbeat_timeout", message: "Run worker worker-silent missed its heartbeat deadline." });
assert.deepEqual(silentAdapter.processes[0]?.signals, ["SIGKILL"]);

const crashAdapter = new FakeAdapter("crash");
const crashSupervisor = new RunWorkerSupervisor(crashAdapter, {
  readyTimeoutMs: 50,
  heartbeatTimeoutMs: 50,
  cancelGraceMs: 5,
});
await assert.rejects(
  () => crashSupervisor.start({ ...bootstrap, workerId: "worker-crash" }),
  /exited before ready.*code 7/,
);

const processFixtureRoot = await mkdtemp(join(tmpdir(), "la-run-worker-supervisor-"));
try {
  const entryPath = join(processFixtureRoot, "worker.mjs");
  await writeFile(entryPath, [
    "import { createInterface } from 'node:readline';",
    "const lines = createInterface({ input: process.stdin });",
    "lines.on('line', (line) => {",
    "  const command = JSON.parse(line);",
    "  if (command.type !== 'bootstrap') return;",
    "  const workerId = command.bootstrap.workerId;",
    "  process.stdout.write(JSON.stringify({ schemaVersion: 1, type: 'ready', workerId }) + '\\n');",
    "  process.stdout.write(JSON.stringify({ schemaVersion: 1, type: 'heartbeat', workerId, sequence: 1 }) + '\\n');",
    "  process.stdout.write(JSON.stringify({ schemaVersion: 1, type: 'completed', workerId }) + '\\n');",
    "  setImmediate(() => process.exit(0));",
    "});",
  ].join("\n"));
  const processSupervisor = new RunWorkerSupervisor(new NodeJsonlRunWorkerProcessAdapter({
    entryPath,
    cwd: processFixtureRoot,
    env: {},
  }), {
    readyTimeoutMs: 1_000,
    heartbeatTimeoutMs: 1_000,
    cancelGraceMs: 100,
  });
  const processHandle = await processSupervisor.start({ ...bootstrap, workerId: "worker-process" });
  assert.deepEqual(await processHandle.terminal, { kind: "completed" });
} finally {
  await rm(processFixtureRoot, { recursive: true, force: true });
}

process.stdout.write("run worker supervisor tests passed\n");
