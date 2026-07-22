import {
  type TeamRoleProfile,
  type TeamContextManifest,
  teamRoleSessionId,
  type TeamRoleId,
  type TeamRolePass,
  type TeamRoleSubagentSpawnRequest,
} from "@linguist-agent/cat-data";
import type { PiEventBusLike } from "@linguist-agent/cat-runtime";
import { randomUUID } from "node:crypto";

const SUBAGENT_RESULT_INTERCOM_EVENT = "subagent:result-intercom";
const SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT = "subagent:result-intercom-delivery";

export interface PrepareSubagentTeamRoleRunInput {
  workflowId: string;
  roleId: TeamRoleId;
  task?: string;
  modelProvider?: string;
  modelId?: string;
  thinking?: TeamRoleProfile["thinking"];
  inputArtifactRefs?: string[];
  outputArtifactRefs?: string[];
  contextManifestRef?: string;
  contextManifest?: TeamContextManifest;
  summary?: string;
  transcriptRef?: string;
  output?: string;
  sessionDir?: string;
  toolBudget?: TeamRoleSubagentSpawnRequest["params"]["toolBudget"];
}

export interface PreparedSubagentTeamRoleRun {
  httpStatus: 202;
  rolePass: TeamRolePass;
}

/**
 * pi-subagents emits a transient grouped-result delivery event for every async
 * Run. LA consumes that Run through its canonical async status/activity bridge,
 * but the Package still expects the host event bus to acknowledge receipt.
 * This acknowledgement owns no durable state and never replaces the canonical
 * Task/Run/Activity/Artifact projection.
 */
export function bindSubagentResultDeliveryAcknowledgement(eventBus: PiEventBusLike): () => void {
  const unsubscribe = eventBus.on(SUBAGENT_RESULT_INTERCOM_EVENT, (value) => {
    if (!value || typeof value !== "object") return;
    const payload = value as Record<string, unknown>;
    if (payload.source !== "async" || typeof payload.requestId !== "string" || !payload.requestId.trim()) return;
    if (typeof payload.runId !== "string" || !Array.isArray(payload.children)) return;
    eventBus.emit(SUBAGENT_RESULT_INTERCOM_DELIVERY_EVENT, {
      requestId: payload.requestId,
      delivered: true,
      consumer: "linguist-agent-canonical-team-bridge",
    });
  });
  return typeof unsubscribe === "function" ? unsubscribe : () => undefined;
}

export function teamRoleAgentName(roleId: TeamRoleId): string {
  return `la-team-${roleId.replaceAll("_", "-")}`;
}

export function teamRoleModelSpecifier(input: Pick<PrepareSubagentTeamRoleRunInput, "modelProvider" | "modelId" | "thinking">): string | undefined {
  if (!input.modelId) return undefined;
  const model = input.modelProvider ? `${input.modelProvider}/${input.modelId}` : input.modelId;
  return input.thinking
    ? `${model.replace(/:(?:minimal|low|medium|high|xhigh)$/, "")}:${input.thinking}`
    : model;
}

export function buildSubagentSpawnRequest(input: PrepareSubagentTeamRoleRunInput): TeamRoleSubagentSpawnRequest {
  const agent = teamRoleAgentName(input.roleId);
  const model = teamRoleModelSpecifier(input);
  const sessionId = teamRoleSessionId(input.workflowId, input.roleId);
  return {
    protocol: "pi-subagents-rpc-v1",
    method: "spawn",
    params: {
      agent,
      task: input.task ?? [
        `Run ${agent} for LA workflow ${input.workflowId}.`,
        "Use only the provided LA workflow artifacts and CAT evidence.",
        "Return the role JSON artifact required by the agent prompt.",
      ].join("\n"),
      context: "fresh",
      // Product Team profiles are repository-owned. Never merge user-global
      // agent files, overrides, modelScope, or disabled state into a Run.
      agentScope: "project",
      async: true,
      clarify: false,
      artifacts: true,
      acceptance: {
        level: "none",
        reason: "LA validates localization role output through typed artifacts and CAT gates.",
      },
      output: input.output ?? `data/team-role-outputs/${sessionId}.json`,
      outputMode: "file-only",
      ...(input.sessionDir ? { sessionDir: input.sessionDir } : {}),
      ...(model ? { model } : {}),
      ...(input.toolBudget ? { toolBudget: input.toolBudget } : {}),
    },
  };
}

interface SubagentRpcReply {
  version: 1;
  requestId: string;
  method?: string;
  success: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

export async function spawnSubagentViaRpc(
  eventBus: PiEventBusLike,
  request: TeamRoleSubagentSpawnRequest,
  timeoutMs = 15_000,
  recoverAsyncDir?: () => Promise<string | undefined>,
): Promise<SubagentRpcReply> {
  try {
    return await callSubagentRpc(eventBus, request.method, request.params, timeoutMs);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Timed out waiting for pi-subagents RPC reply")) throw error;
    const asyncDir = await recoverAsyncDir?.();
    if (!asyncDir) throw error;
    return {
      version: 1,
      requestId: `recovered-${randomUUID()}`,
      method: "spawn",
      success: true,
      data: { details: { asyncDir, recoveredAfterRpcTimeout: true } },
    };
  }
}

export async function callSubagentRpc(
  eventBus: PiEventBusLike,
  method: "ping" | "status" | "spawn" | "interrupt" | "stop",
  params?: unknown,
  timeoutMs = 15_000,
): Promise<SubagentRpcReply> {
  const requestId = `la-${randomUUID()}`;
  const replyEvent = `subagents:rpc:v1:reply:${requestId}`;
  const reply = await new Promise<SubagentRpcReply>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | void;
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for pi-subagents RPC reply ${requestId}`)));
    }, timeoutMs);
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof unsubscribe === "function") unsubscribe();
      fn();
    };
    unsubscribe = eventBus.on(replyEvent, (data) => {
      finish(() => resolve(data as SubagentRpcReply));
    });
    eventBus.emit("subagents:rpc:v1:request", {
      version: 1,
      requestId,
      method,
      params,
      source: { extension: "linguist-agent" },
    });
  });
  if (!reply.success) {
    throw new Error(reply.error?.message ?? "pi-subagents RPC spawn failed");
  }
  return reply;
}

export function prepareSubagentTeamRoleRun(input: PrepareSubagentTeamRoleRunInput): PreparedSubagentTeamRoleRun {
  const sessionId = teamRoleSessionId(input.workflowId, input.roleId);
  const subagentSpawnRequest = buildSubagentSpawnRequest(input);
  return {
    httpStatus: 202,
    rolePass: {
      workflowId: input.workflowId,
      roleId: input.roleId,
      status: "waiting",
      sessionId,
      modelProvider: input.modelProvider,
      modelId: input.modelId,
      thinking: input.thinking,
      inputArtifactRefs: input.inputArtifactRefs ?? [],
      outputArtifactRefs: input.outputArtifactRefs ?? [],
      contextManifestRef: input.contextManifestRef,
      contextManifest: input.contextManifest,
      subagentSpawnRequest,
      summary: input.summary ?? `Prepared ${subagentSpawnRequest.params.agent} pi-subagents spawn request. LA server has not executed the role yet.`,
      transcriptRef: input.transcriptRef ?? `session:${sessionId}`,
    },
  };
}
