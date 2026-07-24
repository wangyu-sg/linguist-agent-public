import { createHash, randomUUID } from "node:crypto";
import type {
  AgentPermissionContract,
  AgentPermissionRequest,
  AgentPermissionUserDecision,
  AgentRunOptions,
  CatIsolatedResources,
  CatRequestShapeManifest,
  CatSessionPreset,
} from "@linguist-agent/cat-runtime";
import type { LibraryPersistence, TaskExecutionSnapshot } from "@linguist-agent/cat-data";
import type { AgentSessionEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  prepareCatWorkerRuntime,
  type CatWorkerExecutionIdentity,
  type CatWorkerUiRequest,
  type PreparedCatWorkerRuntime,
} from "./cat_worker_rpc.js";
import type { RunWorkerBootstrapV1, RunWorkerHandle, RunWorkerTerminal } from "./run_worker_supervisor.js";

export interface CatWorkerServerToolPlan {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  executionMode?: "sequential" | "parallel";
}

export interface CatWorkerSessionPlanV1 {
  schemaVersion: 1;
  planHash: string;
  profile: "cat" | "private_eval" | "team";
  runtimeRoot: string;
  workspace: { root: string; projectId: string };
  taskId: string | null;
  runId: string;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
  sessionMode: "memory" | "new" | "continue" | "project";
  sessionId: string | null;
  branchEntryId: string | null;
  preset: CatSessionPreset;
  disabledTools: string[];
  runOptions: AgentRunOptions | null;
  isolatedResources: CatIsolatedResources;
  runtimeExtension: boolean;
  permissionContract: AgentPermissionContract | null;
  serverTools: CatWorkerServerToolPlan[];
  extensionBinding: boolean;
  memoryRecall?: string;
}

export interface CatWorkerSessionProxy {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly systemPrompt: string;
  readonly isStreaming: boolean;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: { images?: unknown[] }): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  clearQueue(): { steering: string[]; followUp: string[] };
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  compact(instructions?: string): Promise<{
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    estimatedTokensAfter?: number;
    details?: unknown;
  }>;
  abort(): Promise<void>;
  dispose(): void;
}

export interface CatWorkerSessionCreation extends PreparedCatWorkerRuntime {
  session: CatWorkerSessionProxy;
  requestShape: CatRequestShapeManifest;
  workerId: string;
  runtimeEpochId: string;
  terminal: Promise<RunWorkerTerminal>;
  emitExtensionEvent(channel: string, data: unknown): void;
  onExtensionEvent(listener: (channel: string, data: unknown) => void): () => void;
}

export interface CatWorkerToolDefinition {
  name: string;
  description: string;
  sourceInfo?: { source?: string };
}

export interface CatWorkerSessionAuthority {
  createSession(input: {
    plan: CatWorkerSessionPlanV1;
    executionIdentity: CatWorkerExecutionIdentity;
    persistExecutionSnapshot(snapshot: TaskExecutionSnapshot, requestShape: CatRequestShapeManifest): Promise<void>;
    requestPermissionDecision(request: AgentPermissionRequest): Promise<AgentPermissionUserDecision>;
    executeServerTool(name: string, toolCallId: string, input: unknown, signal: AbortSignal): Promise<unknown>;
    requestUi(request: CatWorkerUiRequest): Promise<unknown>;
    notifyUi(message: string, level: "info" | "warning" | "error"): void;
    libraryPersistence?: LibraryPersistence;
  }): Promise<CatWorkerSessionCreation>;
}

export interface CatWorkerSupervisor {
  start(input: RunWorkerBootstrapV1): Promise<RunWorkerHandle>;
}

function stable(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
}

export function finalizeCatWorkerSessionPlan(input: Omit<CatWorkerSessionPlanV1, "planHash">): CatWorkerSessionPlanV1 {
  const planHash = createHash("sha256").update(stable(input)).digest("hex");
  return { ...input, planHash };
}

export function describeCatWorkerServerTools(tools: readonly ToolDefinition[]): CatWorkerServerToolPlan[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    ...(tool.promptSnippet ? { promptSnippet: tool.promptSnippet } : {}),
    ...(tool.promptGuidelines?.length ? { promptGuidelines: [...tool.promptGuidelines] } : {}),
    parameters: tool.parameters,
    ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
  }));
}

export class SupervisorCatWorkerSessionAuthority implements CatWorkerSessionAuthority {
  constructor(
    private readonly supervisor: CatWorkerSupervisor,
    private readonly rpcTimeoutMs = 120_000,
  ) {
    if (!Number.isFinite(rpcTimeoutMs) || rpcTimeoutMs <= 0) throw new Error("CAT worker RPC timeout must be positive.");
  }

  async createSession(input: Parameters<CatWorkerSessionAuthority["createSession"]>[0]): Promise<CatWorkerSessionCreation> {
    const plan = input.plan.planHash
      ? input.plan
      : (() => {
          const { planHash: _ignored, ...unsigned } = input.plan;
          return finalizeCatWorkerSessionPlan(unsigned);
        })();
    const workerId = `${plan.profile}-${randomUUID()}`;
    const handle = await this.supervisor.start({
      schemaVersion: 1,
      workerId,
      runId: plan.runId,
      profile: plan.profile,
      preparationPlanHash: plan.planHash,
      runtimeRoot: plan.runtimeRoot,
      workingDirectory: plan.workspace.root,
      createdAt: input.executionIdentity.createdAt,
    });
    try {
      const prepared = await prepareCatWorkerRuntime({
        transport: handle.applicationTransport,
        plan,
        timeoutMs: this.rpcTimeoutMs,
        executionIdentity: input.executionIdentity,
        persistExecutionSnapshot: input.persistExecutionSnapshot,
        requestPermissionDecision: input.requestPermissionDecision,
        executeServerTool: input.executeServerTool,
        requestUi: input.requestUi,
        notifyUi: input.notifyUi,
        libraryPersistence: input.libraryPersistence,
      });
      let disposePromise: Promise<void> | undefined;
      const dispose = (): Promise<void> => disposePromise ??= (async () => {
        let disposalError: unknown;
        try { await prepared.dispose(); } catch (error) { disposalError = error; }
        await handle.stop("CAT worker Session disposed.");
        if (disposalError) throw disposalError;
      })();
      prepared.session.dispose = () => { void dispose(); };
      return {
        ...prepared,
        workerId,
        runtimeEpochId: input.executionIdentity.runtimeEpochId,
        terminal: handle.terminal,
        dispose,
      };
    } catch (error) {
      await handle.stop("CAT worker preparation failed.");
      throw error;
    }
  }
}
