import { parseRunWorkerBootstrap, type RunWorkerBootstrapV1 } from "./run_worker_supervisor.js";
import { createCatWorkerRpcApplication } from "./cat_worker_rpc.js";
import { createJsonlGeneralWorkerTransport } from "./general_worker_rpc.js";

const outerTransport = createJsonlGeneralWorkerTransport({ readable: process.stdin, writable: process.stdout });
let bootstrap: RunWorkerBootstrapV1 | undefined;
let application: ReturnType<typeof createCatWorkerRpcApplication> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let heartbeatSequence = 0;
const rpcMessageListeners = new Set<(message: unknown) => void>();
const rpcCloseListeners = new Set<(reason: string) => void>();
let rpcClosed = false;

const rpcTransport = {
  send(payload: unknown): void {
    if (!bootstrap || rpcClosed) throw new Error("CAT worker RPC transport is not ready.");
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
  close(reason = "CAT worker RPC closed."): void {
    if (rpcClosed) return;
    rpcClosed = true;
    for (const listener of rpcCloseListeners) listener(reason);
  },
};

const stop = async (reason: string, terminal: "stopped" | "failed" = "stopped"): Promise<void> => {
  if (heartbeat) clearInterval(heartbeat);
  rpcTransport.close(reason);
  if (application) {
    const active = application;
    application = undefined;
    await active.close();
  }
  if (bootstrap) {
    outerTransport.send(terminal === "stopped"
      ? { schemaVersion: 1, type: "stopped", workerId: bootstrap.workerId }
      : { schemaVersion: 1, type: "failed", workerId: bootstrap.workerId, code: "cat_worker_failed", message: reason });
  }
  process.stdin.pause();
  process.exitCode = terminal === "stopped" ? 0 : 1;
};

outerTransport.onMessage((value) => {
  const message = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (!message || message.schemaVersion !== 1 || typeof message.type !== "string") {
    void stop("CAT worker control envelope is invalid.", "failed");
    return;
  }
  if (message.type === "bootstrap") {
    if (bootstrap) {
      void stop("CAT worker received a duplicate bootstrap.", "failed");
      return;
    }
    try {
      const parsed = parseRunWorkerBootstrap(message.bootstrap);
      if ((parsed.profile !== "cat" && parsed.profile !== "private_eval" && parsed.profile !== "team") || !parsed.preparationPlanHash || parsed.executionSnapshot) {
        throw new Error("CAT worker requires CAT PreparationPlan bootstrap authority.");
      }
      bootstrap = parsed;
      application = createCatWorkerRpcApplication({ transport: rpcTransport });
      outerTransport.send({ schemaVersion: 1, type: "ready", workerId: parsed.workerId });
      heartbeat = setInterval(() => {
        if (bootstrap) outerTransport.send({ schemaVersion: 1, type: "heartbeat", workerId: bootstrap.workerId, sequence: ++heartbeatSequence });
      }, 5_000);
    } catch {
      void stop("CAT worker bootstrap failed.", "failed");
    }
    return;
  }
  if (!bootstrap || message.workerId !== bootstrap.workerId) {
    void stop("CAT worker control identity mismatch.", "failed");
    return;
  }
  if (message.type === "rpc") {
    for (const listener of rpcMessageListeners) listener(message.payload);
    return;
  }
  if (message.type === "cancel") {
    void stop(typeof message.reason === "string" ? message.reason : "CAT worker cancelled.");
    return;
  }
  void stop("CAT worker control command is invalid.", "failed");
});

outerTransport.onClose((reason) => {
  if (heartbeat) clearInterval(heartbeat);
  rpcTransport.close(reason);
  if (application) void application.close().catch(() => process.stderr.write("CAT worker shutdown cleanup failed.\n"));
});

process.once("SIGINT", () => { void stop("CAT worker received SIGINT."); });
process.once("SIGTERM", () => { void stop("CAT worker received SIGTERM."); });
