import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createPiAgentRuntimePort } from "@linguist-agent/cat-runtime";
import { parseRunWorkerBootstrap, type RunWorkerBootstrapV1 } from "./run_worker_supervisor.js";
import { createGeneralWorkerRpcServer, createJsonlGeneralWorkerTransport } from "./general_worker_rpc.js";

const outerTransport = createJsonlGeneralWorkerTransport({
  readable: process.stdin,
  writable: process.stdout,
});
let bootstrap: RunWorkerBootstrapV1 | undefined;
let rpcServer: Awaited<ReturnType<typeof createGeneralWorkerRpcServer>> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let heartbeatSequence = 0;
const rpcMessageListeners = new Set<(message: unknown) => void>();
const rpcCloseListeners = new Set<(reason: string) => void>();
let rpcClosed = false;

const rpcTransport = {
  send(payload: unknown): void {
    if (!bootstrap || rpcClosed) throw new Error("General worker RPC transport is not ready.");
    outerTransport.send({ schemaVersion: 1, type: "rpc", workerId: bootstrap.workerId, payload });
  },
  onMessage(listener: (message: unknown) => void): () => void {
    rpcMessageListeners.add(listener);
    return () => rpcMessageListeners.delete(listener);
  },
  onClose(listener: (reason: string) => void): () => void {
    rpcCloseListeners.add(listener);
    return () => rpcCloseListeners.delete(listener);
  },
  close(reason = "General worker RPC closed."): void {
    if (rpcClosed) return;
    rpcClosed = true;
    for (const listener of rpcCloseListeners) listener(reason);
  },
};

const stop = async (reason: string, terminal: "stopped" | "failed" = "stopped"): Promise<void> => {
  if (heartbeat) clearInterval(heartbeat);
  rpcTransport.close(reason);
  if (rpcServer) {
    const activeServer = rpcServer;
    rpcServer = undefined;
    await activeServer.dispose();
  }
  if (bootstrap) {
    outerTransport.send(terminal === "stopped"
      ? { schemaVersion: 1, type: "stopped", workerId: bootstrap.workerId }
      : { schemaVersion: 1, type: "failed", workerId: bootstrap.workerId, code: "general_worker_failed", message: reason });
  }
  process.stdin.pause();
  process.exitCode = terminal === "stopped" ? 0 : 1;
};

outerTransport.onMessage((value) => {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!row || row.schemaVersion !== 1 || typeof row.type !== "string") {
    void stop("General worker control envelope is invalid.", "failed");
    return;
  }
  if (row.type === "bootstrap") {
    if (bootstrap) {
      void stop("General worker received a duplicate bootstrap.", "failed");
      return;
    }
    void (async () => {
      const parsed = parseRunWorkerBootstrap(row.bootstrap);
      if (parsed.profile !== "general" || !parsed.preparationPlanHash || parsed.executionSnapshot) {
        throw new Error("General worker requires PreparationPlan bootstrap authority.");
      }
      bootstrap = parsed;
      const modelRuntime = await ModelRuntime.create();
      rpcServer = createGeneralWorkerRpcServer({
        transport: rpcTransport,
        runtimePort: createPiAgentRuntimePort({ modelRuntime: async () => modelRuntime }),
        requestTimeoutMs: 120_000,
      });
      outerTransport.send({ schemaVersion: 1, type: "ready", workerId: parsed.workerId });
      heartbeat = setInterval(() => {
        if (bootstrap) outerTransport.send({ schemaVersion: 1, type: "heartbeat", workerId: bootstrap.workerId, sequence: ++heartbeatSequence });
      }, 5_000);
    })().catch(() => {
      void stop("General worker bootstrap failed.", "failed");
    });
    return;
  }
  if (!bootstrap || row.workerId !== bootstrap.workerId) {
    void stop("General worker control identity mismatch.", "failed");
    return;
  }
  if (row.type === "rpc") {
    for (const listener of rpcMessageListeners) listener(row.payload);
    return;
  }
  if (row.type === "cancel") {
    void stop(typeof row.reason === "string" ? row.reason : "General worker cancelled.");
    return;
  }
  void stop("General worker control command is invalid.", "failed");
});

outerTransport.onClose((reason) => {
  if (heartbeat) clearInterval(heartbeat);
  rpcTransport.close(reason);
  if (rpcServer) void rpcServer.dispose().catch(() => {
    process.stderr.write("General worker shutdown cleanup failed.\n");
  });
});

process.once("SIGINT", () => { void stop("General worker received SIGINT."); });
process.once("SIGTERM", () => { void stop("General worker received SIGTERM."); });
