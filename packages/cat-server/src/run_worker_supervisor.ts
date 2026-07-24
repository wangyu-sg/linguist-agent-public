import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import type { TaskExecutionSnapshot } from "@linguist-agent/cat-data";

export type RunWorkerProfile = "general" | "cat" | "private_eval" | "team";

export interface RunWorkerBootstrapV1 {
  schemaVersion: 1;
  workerId: string;
  runId: string;
  profile: RunWorkerProfile;
  executionSnapshot?: TaskExecutionSnapshot;
  preparationPlanHash?: string;
  runtimeRoot: string;
  workingDirectory: string;
  createdAt: string;
}

export type RunWorkerCommand =
  | { schemaVersion: 1; type: "bootstrap"; bootstrap: RunWorkerBootstrapV1 }
  | { schemaVersion: 1; type: "cancel"; workerId: string; reason: string }
  | { schemaVersion: 1; type: "rpc"; workerId: string; payload: unknown };

export type RunWorkerMessage =
  | { schemaVersion: 1; type: "ready"; workerId: string }
  | { schemaVersion: 1; type: "heartbeat"; workerId: string; sequence: number }
  | { schemaVersion: 1; type: "rpc"; workerId: string; payload: unknown }
  | { schemaVersion: 1; type: "completed"; workerId: string }
  | { schemaVersion: 1; type: "stopped"; workerId: string }
  | { schemaVersion: 1; type: "failed"; workerId: string; code: string; message: string };

export interface RunWorkerProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface RunWorkerProcessCallbacks {
  onMessage(message: unknown): void;
  onExit(exit: RunWorkerProcessExit): void;
}

export interface RunWorkerProcess {
  send(command: RunWorkerCommand): void;
  kill(signal: NodeJS.Signals): void;
}

export interface RunWorkerProcessAdapter {
  spawn(workerId: string, callbacks: RunWorkerProcessCallbacks): RunWorkerProcess;
}

export interface NodeJsonlRunWorkerProcessAdapterOptions {
  entryPath: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  nodeArgs?: readonly string[];
  maxMessageBytes?: number;
}

export class NodeJsonlRunWorkerProcessAdapter implements RunWorkerProcessAdapter {
  private readonly entryPath: string;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly nodeArgs: readonly string[];
  private readonly maxMessageBytes: number;

  constructor(options: NodeJsonlRunWorkerProcessAdapterOptions) {
    if (!isAbsolute(options.entryPath) || !isAbsolute(options.cwd)) throw new Error("Run worker entryPath and cwd must be absolute.");
    const maxMessageBytes = options.maxMessageBytes ?? 1_048_576;
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1_024) throw new Error("Run worker maxMessageBytes is invalid.");
    this.entryPath = options.entryPath;
    this.cwd = options.cwd;
    this.env = Object.freeze({ ...(options.env ?? {}) });
    this.nodeArgs = Object.freeze([...(options.nodeArgs ?? [])]);
    this.maxMessageBytes = maxMessageBytes;
  }

  spawn(_workerId: string, callbacks: RunWorkerProcessCallbacks): RunWorkerProcess {
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [...this.nodeArgs, this.entryPath], {
      cwd: this.cwd,
      env: { ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = Buffer.alloc(0);
    let exited = false;
    child.stderr.resume();
    const exitOnce = (exit: RunWorkerProcessExit): void => {
      if (exited) return;
      exited = true;
      callbacks.onExit(exit);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let newline = buffer.indexOf(0x0a);
      while (newline >= 0) {
        if (newline + 1 > this.maxMessageBytes) {
          callbacks.onMessage({ schemaVersion: 0, type: "oversized_worker_message" });
          return;
        }
        const line = buffer.subarray(0, newline).toString("utf8").trim();
        buffer = buffer.subarray(newline + 1);
        if (line) {
          try {
            callbacks.onMessage(JSON.parse(line));
          } catch (error) {
            callbacks.onMessage({
              schemaVersion: 0,
              type: "invalid_worker_json",
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }
        newline = buffer.indexOf(0x0a);
      }
      if (buffer.byteLength > this.maxMessageBytes) callbacks.onMessage({ schemaVersion: 0, type: "oversized_worker_message" });
    });
    child.once("error", () => exitOnce({ code: null, signal: null }));
    child.once("exit", (code, signal) => exitOnce({ code, signal }));
    return {
      send: (command) => {
        if (exited || child.stdin.destroyed) throw new Error("Run worker process is not writable.");
        child.stdin.write(`${JSON.stringify(command)}\n`);
      },
      kill: (signal) => {
        if (!exited) child.kill(signal);
      },
    };
  }
}

export type RunWorkerTerminal =
  | { kind: "completed" }
  | { kind: "stopped" }
  | { kind: "failed"; code: "worker_failed" | "worker_crashed" | "heartbeat_timeout"; message: string };

export interface RunWorkerHandle {
  readonly workerId: string;
  readonly terminal: Promise<RunWorkerTerminal>;
  readonly applicationTransport: RunWorkerApplicationTransport;
  stop(reason: string): Promise<RunWorkerTerminal>;
}

export interface RunWorkerApplicationTransport {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onClose(listener: (reason: string) => void): () => void;
  close(reason?: string): void;
}

export interface RunWorkerSupervisorOptions {
  readyTimeoutMs: number;
  heartbeatTimeoutMs: number;
  cancelGraceMs: number;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactFields(row: Record<string, unknown>, fields: string[], label: string): void {
  const allowed = new Set(fields);
  const extra = Object.keys(row).find((field) => !allowed.has(field));
  if (extra) throw new Error(`${label} has unknown field: ${extra}`);
}

function requiredString(row: Record<string, unknown>, field: string, label: string): string {
  const value = row[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}.${field} must be a non-empty string.`);
  return value;
}

function parseExecutionSnapshot(value: unknown): TaskExecutionSnapshot {
  const row = record(value, "bootstrap.executionSnapshot");
  exactFields(row, [
    "schemaVersion", "executionId", "runId", "threadId", "turnId", "runtimeEpochId", "configRevision",
    "providerId", "modelId", "reasoningEffort", "executionProfile", "promptHash", "toolManifestHash",
    "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash", "createdAt",
  ], "bootstrap.executionSnapshot");
  if (row.schemaVersion !== 1) throw new Error("bootstrap.executionSnapshot.schemaVersion must be 1.");
  for (const field of ["executionId", "runId", "threadId", "turnId", "runtimeEpochId"] as const) requiredString(row, field, "bootstrap.executionSnapshot");
  if (!Number.isSafeInteger(row.configRevision) || (row.configRevision as number) < 1) {
    throw new Error("bootstrap.executionSnapshot.configRevision must be a positive integer.");
  }
  for (const field of ["promptHash", "toolManifestHash", "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash"] as const) {
    if (typeof row[field] !== "string" || !/^[a-f0-9]{64}$/u.test(row[field])) {
      throw new Error(`bootstrap.executionSnapshot.${field} must be a SHA-256 digest.`);
    }
  }
  for (const field of ["providerId", "modelId", "reasoningEffort"] as const) {
    if (row[field] !== null && typeof row[field] !== "string") throw new Error(`bootstrap.executionSnapshot.${field} must be a string or null.`);
  }
  if (row.executionProfile !== null && !["fast", "balanced", "best", "custom"].includes(String(row.executionProfile))) {
    throw new Error("bootstrap.executionSnapshot.executionProfile is invalid.");
  }
  if (typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) {
    throw new Error("bootstrap.executionSnapshot.createdAt must be an ISO timestamp.");
  }
  return row as unknown as TaskExecutionSnapshot;
}

export function parseRunWorkerBootstrap(value: unknown): RunWorkerBootstrapV1 {
  const row = record(value, "bootstrap");
  exactFields(row, ["schemaVersion", "workerId", "runId", "profile", "executionSnapshot", "preparationPlanHash", "runtimeRoot", "workingDirectory", "createdAt"], "bootstrap");
  if (row.schemaVersion !== 1) throw new Error("bootstrap.schemaVersion must be 1.");
  const workerId = requiredString(row, "workerId", "bootstrap");
  const runId = requiredString(row, "runId", "bootstrap");
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(workerId)) throw new Error("bootstrap.workerId is invalid.");
  if (!(["general", "cat", "private_eval", "team"] as unknown[]).includes(row.profile)) throw new Error("bootstrap.profile is invalid.");
  const executionSnapshot = row.executionSnapshot === undefined ? undefined : parseExecutionSnapshot(row.executionSnapshot);
  const preparationPlanHash = row.preparationPlanHash === undefined ? undefined : requiredString(row, "preparationPlanHash", "bootstrap");
  if (preparationPlanHash !== undefined && !/^[a-f0-9]{64}$/u.test(preparationPlanHash)) throw new Error("bootstrap.preparationPlanHash must be a SHA-256 digest.");
  if ((executionSnapshot === undefined) === (preparationPlanHash === undefined)) throw new Error("bootstrap requires exactly one execution authority.");
  const runtimeRoot = requiredString(row, "runtimeRoot", "bootstrap");
  const workingDirectory = requiredString(row, "workingDirectory", "bootstrap");
  if (!isAbsolute(runtimeRoot) || !isAbsolute(workingDirectory)) throw new Error("bootstrap roots must be absolute paths.");
  const createdAt = requiredString(row, "createdAt", "bootstrap");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("bootstrap.createdAt must be an ISO timestamp.");
  if (executionSnapshot && executionSnapshot.runId !== runId) throw new Error("bootstrap.executionSnapshot.runId must match bootstrap.runId.");
  return {
    schemaVersion: 1,
    workerId,
    runId,
    profile: row.profile as RunWorkerProfile,
    ...(executionSnapshot ? { executionSnapshot } : {}),
    ...(preparationPlanHash ? { preparationPlanHash } : {}),
    runtimeRoot,
    workingDirectory,
    createdAt,
  };
}

function parseRunWorkerMessage(value: unknown, workerId: string): RunWorkerMessage {
  const row = record(value, "worker message");
  if (row.schemaVersion !== 1) throw new Error("worker message schemaVersion must be 1.");
  if (row.workerId !== workerId) throw new Error(`worker message identity mismatch for ${workerId}.`);
  if (row.type === "ready" || row.type === "completed" || row.type === "stopped") {
    exactFields(row, ["schemaVersion", "type", "workerId"], "worker message");
    return row as unknown as RunWorkerMessage;
  }
  if (row.type === "heartbeat") {
    exactFields(row, ["schemaVersion", "type", "workerId", "sequence"], "worker message");
    if (!Number.isSafeInteger(row.sequence) || (row.sequence as number) < 0) throw new Error("worker heartbeat sequence is invalid.");
    return row as unknown as RunWorkerMessage;
  }
  if (row.type === "rpc") {
    exactFields(row, ["schemaVersion", "type", "workerId", "payload"], "worker message");
    return row as unknown as RunWorkerMessage;
  }
  if (row.type === "failed") {
    exactFields(row, ["schemaVersion", "type", "workerId", "code", "message"], "worker message");
    requiredString(row, "code", "worker message");
    requiredString(row, "message", "worker message");
    return row as unknown as RunWorkerMessage;
  }
  throw new Error(`worker message type is invalid: ${String(row.type)}`);
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

export class RunWorkerSupervisor {
  constructor(
    private readonly adapter: RunWorkerProcessAdapter,
    private readonly options: RunWorkerSupervisorOptions,
  ) {
    for (const [field, value] of Object.entries(options)) {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`RunWorkerSupervisor ${field} must be positive.`);
    }
  }

  async start(input: RunWorkerBootstrapV1): Promise<RunWorkerHandle> {
    const bootstrap = parseRunWorkerBootstrap(input);
    const ready = deferred<void>();
    const terminal = deferred<RunWorkerTerminal>();
    let state: "starting" | "running" | "stopping" | "terminal" = "starting";
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    let process!: RunWorkerProcess;
    const applicationListeners = new Set<(message: unknown) => void>();
    const applicationCloseListeners = new Set<(reason: string) => void>();
    let applicationClosed = false;

    const clearTimers = (): void => {
      if (readyTimer) clearTimeout(readyTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (cancelTimer) clearTimeout(cancelTimer);
    };
    const settle = (result: RunWorkerTerminal): void => {
      if (state === "terminal") return;
      state = "terminal";
      clearTimers();
      if (!applicationClosed) {
        applicationClosed = true;
        const reason = result.kind === "failed" ? result.message : `Run worker ${bootstrap.workerId} ${result.kind}.`;
        for (const listener of applicationCloseListeners) listener(reason);
      }
      terminal.resolve(result);
    };
    const resetHeartbeat = (): void => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        if (state !== "running") return;
        settle({ kind: "failed", code: "heartbeat_timeout", message: `Run worker ${bootstrap.workerId} missed its heartbeat deadline.` });
        process.kill("SIGKILL");
      }, this.options.heartbeatTimeoutMs);
    };

    process = this.adapter.spawn(bootstrap.workerId, {
      onMessage: (raw) => {
        let message: RunWorkerMessage;
        try {
          message = parseRunWorkerMessage(raw, bootstrap.workerId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (state === "starting") ready.reject(new Error(`Run worker ${bootstrap.workerId} sent an invalid startup message: ${detail}`));
          settle({ kind: "failed", code: "worker_failed", message: detail });
          process.kill("SIGKILL");
          return;
        }
        if (message.type === "ready") {
          if (state !== "starting") return;
          state = "running";
          if (readyTimer) clearTimeout(readyTimer);
          resetHeartbeat();
          ready.resolve();
          return;
        }
        if (message.type === "heartbeat") {
          if (state === "running") resetHeartbeat();
          return;
        }
        if (message.type === "rpc") {
          if (state !== "running" || applicationClosed) return;
          for (const listener of applicationListeners) listener(message.payload);
          return;
        }
        if (message.type === "completed") {
          settle({ kind: "completed" });
          return;
        }
        if (message.type === "stopped") {
          settle({ kind: "stopped" });
          return;
        }
        settle({ kind: "failed", code: "worker_failed", message: message.message });
      },
      onExit: (exit) => {
        if (state === "terminal") return;
        if (state === "starting") {
          const detail = `Run worker ${bootstrap.workerId} exited before ready (code ${String(exit.code)}, signal ${String(exit.signal)}).`;
          ready.reject(new Error(detail));
          settle({ kind: "failed", code: "worker_crashed", message: detail });
          return;
        }
        if (state === "stopping") {
          settle({ kind: "stopped" });
          return;
        }
        settle({
          kind: "failed",
          code: "worker_crashed",
          message: `Run worker ${bootstrap.workerId} crashed (code ${String(exit.code)}, signal ${String(exit.signal)}).`,
        });
      },
    });

    readyTimer = setTimeout(() => {
      if (state !== "starting") return;
      const error = new Error(`Run worker ${bootstrap.workerId} did not become ready within ${this.options.readyTimeoutMs}ms.`);
      ready.reject(error);
      settle({ kind: "failed", code: "worker_crashed", message: error.message });
      process.kill("SIGKILL");
    }, this.options.readyTimeoutMs);
    process.send({ schemaVersion: 1, type: "bootstrap", bootstrap });

    const handle: RunWorkerHandle = {
      workerId: bootstrap.workerId,
      terminal: terminal.promise,
      applicationTransport: {
        send: (payload) => {
          if (state !== "running" || applicationClosed) throw new Error(`Run worker ${bootstrap.workerId} RPC transport is not active.`);
          process.send({ schemaVersion: 1, type: "rpc", workerId: bootstrap.workerId, payload });
        },
        onMessage: (listener) => {
          applicationListeners.add(listener);
          return () => applicationListeners.delete(listener);
        },
        onClose: (listener) => {
          applicationCloseListeners.add(listener);
          return () => applicationCloseListeners.delete(listener);
        },
        close: (reason = "application transport closed") => {
          if (applicationClosed) return;
          applicationClosed = true;
          for (const listener of applicationCloseListeners) listener(reason);
          void handle.stop(reason);
        },
      },
      stop: async (reason) => {
        if (state === "terminal") return terminal.promise;
        if (state !== "stopping") {
          state = "stopping";
          if (heartbeatTimer) clearTimeout(heartbeatTimer);
          process.send({ schemaVersion: 1, type: "cancel", workerId: bootstrap.workerId, reason });
          cancelTimer = setTimeout(() => process.kill("SIGKILL"), this.options.cancelGraceMs);
        }
        return terminal.promise;
      },
    };

    await ready.promise;
    return handle;
  }
}
