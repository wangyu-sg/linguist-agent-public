import { randomUUID } from "node:crypto";
import type {
  AgentPermissionRequest,
  AgentPermissionUserDecision,
  GeneralAgentSessionPlanV1,
  GeneralDelegationRequest,
  GeneralDelegationResult,
  CapabilityActivation,
} from "@linguist-agent/cat-runtime";
import type { AssistantMemoryPersistence, LibraryPersistence, TaskExecutionSnapshot } from "@linguist-agent/cat-data";
import {
  prepareGeneralWorkerRuntime,
  type GeneralWorkerExecutionIdentity,
  type PreparedGeneralWorkerRuntime,
} from "./general_worker_rpc.js";
import type { RunWorkerBootstrapV1, RunWorkerHandle, RunWorkerTerminal } from "./run_worker_supervisor.js";

export interface GeneralWorkerSupervisor {
  start(input: RunWorkerBootstrapV1): Promise<RunWorkerHandle>;
}

export interface GeneralWorkerSessionCreation extends PreparedGeneralWorkerRuntime {
  workerId: string;
  runtimeEpochId: string;
  terminal: Promise<RunWorkerTerminal>;
}

export interface GeneralWorkerSessionAuthority {
  createGeneralSession(input: {
    plan: GeneralAgentSessionPlanV1;
    executionIdentity: GeneralWorkerExecutionIdentity;
    persistExecutionSnapshot(snapshot: TaskExecutionSnapshot): Promise<void>;
    requestPermissionDecision(request: AgentPermissionRequest): Promise<AgentPermissionUserDecision>;
    delegate(request: GeneralDelegationRequest): Promise<GeneralDelegationResult>;
    onCapabilityActivation?(activation: CapabilityActivation): void;
    assistantMemoryStore?: AssistantMemoryPersistence;
    libraryPersistence?: LibraryPersistence;
    agentPlanHandler?: (payload: unknown) => Promise<unknown>;
    agentPresentHandler?: (payload: unknown) => Promise<unknown>;
  }): Promise<GeneralWorkerSessionCreation>;
}

export class SupervisorGeneralWorkerSessionAuthority implements GeneralWorkerSessionAuthority {
  constructor(
    private readonly supervisor: GeneralWorkerSupervisor,
    private readonly rpcTimeoutMs = 120_000,
  ) {
    if (!Number.isFinite(rpcTimeoutMs) || rpcTimeoutMs <= 0) throw new Error("General worker RPC timeout must be positive.");
  }

  async createGeneralSession(input: Parameters<GeneralWorkerSessionAuthority["createGeneralSession"]>[0]): Promise<GeneralWorkerSessionCreation> {
    const workerId = `general-${randomUUID()}`;
    const handle = await this.supervisor.start({
      schemaVersion: 1,
      workerId,
      runId: input.plan.runId ?? input.plan.taskId,
      profile: "general",
      preparationPlanHash: input.plan.planHash,
      runtimeRoot: input.plan.runtimeRoot,
      workingDirectory: input.plan.access.workingDirectory,
      createdAt: input.executionIdentity.createdAt,
    });
    try {
      const prepared = await prepareGeneralWorkerRuntime({
        transport: handle.applicationTransport,
        plan: input.plan,
        timeoutMs: this.rpcTimeoutMs,
        executionIdentity: input.executionIdentity,
        persistExecutionSnapshot: input.persistExecutionSnapshot,
        requestPermissionDecision: input.requestPermissionDecision,
        delegate: input.delegate,
        onCapabilityActivation: input.onCapabilityActivation,
        assistantMemoryStore: input.assistantMemoryStore,
        libraryPersistence: input.libraryPersistence,
        serverToolHandler: input.agentPlanHandler || input.agentPresentHandler
          ? (request) => routeGeneralServerTool({ agent_plan_update: input.agentPlanHandler, agent_present: input.agentPresentHandler }, request)
          : undefined,
      });
      return {
        ...prepared,
        workerId,
        runtimeEpochId: input.executionIdentity.runtimeEpochId,
        terminal: handle.terminal,
        dispose: async () => {
          let disposalError: unknown;
          try {
            await prepared.dispose();
          } catch (error) {
            disposalError = error;
          }
          await handle.stop("General worker Session disposed.");
          if (disposalError) throw disposalError;
        },
      };
    } catch (error) {
      await handle.stop("General worker preparation failed.");
      throw error;
    }
  }
}

/* ---------- server_tool 路由：按工具名分发，无静默回退 ---------- */

export type GeneralServerToolHandler = (payload: unknown) => Promise<unknown>;

export type GeneralServerToolHandlers = {
  agent_plan_update?: GeneralServerToolHandler;
  agent_present?: GeneralServerToolHandler;
};

/** Route a validated server_tool request to its reviewed host handler; a missing handler rejects loudly. */
export async function routeGeneralServerTool(
  handlers: GeneralServerToolHandlers,
  request: import("./general_worker_rpc.js").ServerToolBridgeRequest,
): Promise<unknown> {
  const handler = handlers[request.tool];
  if (!handler) throw new Error(`General worker server tool is unavailable in this Session: ${request.tool}.`);
  return handler(request.payload);
}
