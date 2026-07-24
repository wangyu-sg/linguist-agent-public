import { createHash, randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { parseAssistantMemoryFile, parseLibraryMetadataFile } from "@linguist-agent/cat-data";
import type {
  AssistantMemoryPersistence,
  AssistantMemoryFileV1,
  AssistantMemoryScope,
  LibraryPersistence,
  LibraryScope,
  StoredLibraryDocumentV1,
  TaskExecutionSnapshot,
} from "@linguist-agent/cat-data";
import {
  parseGeneralAgentSessionPlan,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
  type AgentRuntimeEvent,
  type AgentRuntimePort,
  type AgentRuntimeSession,
  type AgentRuntimeSessionCreation,
  type CapabilityActivation,
  type GeneralAgentSessionPlanV1,
  type GeneralDelegationRequest,
  type GeneralDelegationResult,
  type GeneralResourceInventory,
  type RuntimeCompactionRequest,
} from "@linguist-agent/cat-runtime";

export interface GeneralWorkerRpcTransport {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onClose(listener: (reason: string) => void): () => void;
  close(reason?: string): void;
}

export function createJsonlGeneralWorkerTransport(input: {
  readable: Readable;
  writable: Writable;
  maxMessageBytes?: number;
}): GeneralWorkerRpcTransport {
  const maxMessageBytes = input.maxMessageBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1_024) throw new Error("General worker JSONL maxMessageBytes is invalid.");
  const messageListeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<(reason: string) => void>();
  let buffer = Buffer.alloc(0);
  let closed = false;
  const close = (reason = "closed"): void => {
    if (closed) return;
    closed = true;
    input.readable.off("data", onData);
    input.readable.off("end", onEnd);
    input.readable.off("error", onError);
    for (const listener of closeListeners) listener(reason);
  };
  const onData = (chunk: Buffer | string): void => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = Buffer.concat([buffer, bytes]);
    let newline = buffer.indexOf(0x0a);
    while (newline >= 0) {
      if (newline + 1 > maxMessageBytes) {
        close("General worker JSONL message exceeded the byte limit.");
        return;
      }
      const line = buffer.subarray(0, newline).toString("utf8").trim();
      buffer = buffer.subarray(newline + 1);
      if (line) {
        try {
          const parsed = JSON.parse(line) as unknown;
          for (const listener of messageListeners) listener(parsed);
        } catch (error) {
          close(`General worker JSONL input is invalid: ${publicError(error).message}`);
          return;
        }
      }
      newline = buffer.indexOf(0x0a);
    }
    if (buffer.byteLength > maxMessageBytes) close("General worker JSONL message exceeded the byte limit.");
  };
  const onEnd = (): void => close("General worker JSONL input ended.");
  const onError = (error: Error): void => close(`General worker JSONL input failed: ${publicError(error).message}`);
  input.readable.on("data", onData);
  input.readable.on("end", onEnd);
  input.readable.on("error", onError);
  return {
    send(message) {
      if (closed) throw new Error("General worker JSONL transport is closed.");
      const line = `${JSON.stringify(message)}\n`;
      if (Buffer.byteLength(line) > maxMessageBytes) {
        close("General worker JSONL output exceeded the byte limit.");
        throw new Error("General worker JSONL output exceeded the byte limit.");
      }
      input.writable.write(line);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close,
  };
}

type RpcMethod =
  | "prepare"
  | "activate"
  | "prompt"
  | "wait_for_idle"
  | "steer"
  | "follow_up"
  | "clear_queue"
  | "compact"
  | "fork"
  | "abort"
  | "dispose";

interface RpcRequest {
  schemaVersion: 1;
  type: "request";
  requestId: string;
  method: RpcMethod;
  payload: unknown;
}

interface RpcResponse {
  schemaVersion: 1;
  type: "response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

interface RpcBridgeRequest {
  schemaVersion: 1;
  type: "bridge_request";
  requestId: string;
  bridge: "permission" | "delegation" | "memory" | "library" | "server_tool";
  payload: unknown;
}

interface RpcBridgeResponse {
  schemaVersion: 1;
  type: "bridge_response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface GeneralWorkerAttestationV1 {
  schemaVersion: 1;
  planHash: string;
  sessionId: string;
  sessionFile: string | null;
  runtimeVersion: string;
  systemPromptHash: string;
  systemPromptChars: number;
  toolManifestHash: string;
  resourceSnapshotHash: string;
  capabilityGrantHash: string;
  contextInputHash: string;
  workingDirectory: string;
  fileGrantIds: string[];
}

interface PreparedResult {
  attestation: GeneralWorkerAttestationV1;
  systemPrompt: string;
  access: AgentRuntimeSessionCreation["access"];
  resources: GeneralResourceInventory;
  state: RpcSessionState;
}

interface RpcSessionState {
  steering: string[];
  followUp: string[];
  leafEntryId: string | null;
}

export interface GeneralWorkerExecutionIdentity {
  executionId: string;
  threadId: string;
  turnId: string;
  runtimeEpochId: string;
  configRevision: number;
  executionProfile: TaskExecutionSnapshot["executionProfile"];
  createdAt: string;
}

export interface PreparedGeneralWorkerRuntime extends AgentRuntimeSessionCreation {
  attestation: GeneralWorkerAttestationV1;
  executionSnapshot: TaskExecutionSnapshot;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(row: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  const extra = Object.keys(row).find((field) => !allowed.has(field));
  if (extra) throw new Error(`${label} has unknown field: ${extra}`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function publicError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]");
  const code = error instanceof RpcPublicError ? error.code : "WORKER_RPC_FAILED";
  return { code, message: message.slice(0, 1_000) };
}

class RpcPublicError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function parseRequest(value: unknown): RpcRequest {
  const row = object(value, "General worker request");
  exact(row, ["schemaVersion", "type", "requestId", "method", "payload"], "General worker request");
  if (row.schemaVersion !== 1 || row.type !== "request") throw new Error("General worker request envelope is invalid.");
  const requestId = nonEmptyString(row.requestId, "General worker request.requestId");
  if (!["prepare", "activate", "prompt", "wait_for_idle", "steer", "follow_up", "clear_queue", "compact", "fork", "abort", "dispose"].includes(String(row.method))) {
    throw new Error("General worker request method is invalid.");
  }
  return { schemaVersion: 1, type: "request", requestId, method: row.method as RpcMethod, payload: row.payload };
}

function parseResponse(value: unknown): RpcResponse {
  const row = object(value, "General worker response");
  exact(row, ["schemaVersion", "type", "requestId", "ok", "result", "error"], "General worker response");
  if (row.schemaVersion !== 1 || row.type !== "response" || typeof row.ok !== "boolean") throw new Error("General worker response envelope is invalid.");
  const requestId = nonEmptyString(row.requestId, "General worker response.requestId");
  if (!row.ok) {
    const error = object(row.error, "General worker response.error");
    exact(error, ["code", "message"], "General worker response.error");
    return {
      schemaVersion: 1,
      type: "response",
      requestId,
      ok: false,
      error: {
        code: nonEmptyString(error.code, "General worker response.error.code"),
        message: nonEmptyString(error.message, "General worker response.error.message"),
      },
    };
  }
  return { schemaVersion: 1, type: "response", requestId, ok: true, result: row.result };
}

function parseBridgeResponse(value: unknown): RpcBridgeResponse {
  const row = object(value, "General worker bridge response");
  exact(row, ["schemaVersion", "type", "requestId", "ok", "result", "error"], "General worker bridge response");
  if (row.schemaVersion !== 1 || row.type !== "bridge_response" || typeof row.ok !== "boolean") throw new Error("General worker bridge response envelope is invalid.");
  const requestId = nonEmptyString(row.requestId, "General worker bridge response.requestId");
  if (!row.ok) {
    const error = object(row.error, "General worker bridge response.error");
    exact(error, ["code", "message"], "General worker bridge response.error");
    return {
      schemaVersion: 1,
      type: "bridge_response",
      requestId,
      ok: false,
      error: {
        code: nonEmptyString(error.code, "General worker bridge response.error.code"),
        message: nonEmptyString(error.message, "General worker bridge response.error.message"),
      },
    };
  }
  return { schemaVersion: 1, type: "bridge_response", requestId, ok: true, result: row.result };
}

function parsePermissionRequest(value: unknown): AgentPermissionRequest {
  const row = object(value, "General worker permission request");
  exact(row, ["requestId", "taskId", "runId", "sessionId", "projectId", "kind", "toolName", "domain", "riskClass", "argsSummary"], "General worker permission request");
  for (const field of ["requestId", "taskId", "runId", "sessionId", "projectId"] as const) {
    if (row[field] !== undefined && typeof row[field] !== "string") throw new Error(`General worker permission request.${field} must be a string.`);
  }
  if (row.kind !== undefined && row.kind !== "tool" && row.kind !== "pi_resource_trust") throw new Error("General worker permission request.kind is invalid.");
  if (!["fileRead", "fileWrite", "webRead", "bash", "bridge"].includes(String(row.domain))) throw new Error("General worker permission request.domain is invalid.");
  if (!["low", "medium", "high", "protected", "non_picker"].includes(String(row.riskClass))) throw new Error("General worker permission request.riskClass is invalid.");
  nonEmptyString(row.toolName, "General worker permission request.toolName");
  if (typeof row.argsSummary !== "string") throw new Error("General worker permission request.argsSummary must be a string.");
  return row as unknown as AgentPermissionRequest;
}

function parsePermissionDecision(value: unknown): AgentPermissionUserDecision {
  const row = object(value, "General worker permission decision");
  exact(row, ["action", "decision", "reason"], "General worker permission decision");
  if (row.action !== undefined && !["allow_once", "allow_conversation", "always_allow", "deny"].includes(String(row.action))) throw new Error("General worker permission decision.action is invalid.");
  if (row.decision !== undefined && row.decision !== "approve" && row.decision !== "deny") throw new Error("General worker permission decision.decision is invalid.");
  if (row.reason !== undefined && typeof row.reason !== "string") throw new Error("General worker permission decision.reason must be a string.");
  if (row.action === undefined && row.decision === undefined) throw new Error("General worker permission decision requires an action.");
  return row as unknown as AgentPermissionUserDecision;
}

function parseDelegationRequest(value: unknown): GeneralDelegationRequest {
  const row = object(value, "General worker delegation request");
  exact(row, ["task", "role", "context"], "General worker delegation request");
  const task = nonEmptyString(row.task, "General worker delegation request.task");
  if (task.length > 12_000) throw new Error("General worker delegation request.task is too long.");
  if (row.role !== undefined && (typeof row.role !== "string" || row.role.length > 80)) throw new Error("General worker delegation request.role is invalid.");
  if (row.context !== undefined && (typeof row.context !== "string" || row.context.length > 20_000)) throw new Error("General worker delegation request.context is invalid.");
  return row as unknown as GeneralDelegationRequest;
}

function parseDelegationResult(value: unknown): GeneralDelegationResult {
  const row = object(value, "General worker delegation result");
  exact(row, ["agentThreadId", "role", "summary"], "General worker delegation result");
  for (const field of ["agentThreadId", "role", "summary"] as const) nonEmptyString(row[field], `General worker delegation result.${field}`);
  return row as unknown as GeneralDelegationResult;
}

function parseMemoryScope(value: unknown): AssistantMemoryScope {
  const row = object(value, "General worker memory scope");
  exact(row, ["kind", "projectId"], "General worker memory scope");
  if (row.kind === "personal") return { kind: "personal" };
  if (row.kind === "project" && typeof row.projectId === "string" && row.projectId.trim()) {
    return { kind: "project", projectId: row.projectId };
  }
  throw new Error("General worker memory scope is invalid.");
}

function parseMemoryBridgeRequest(value: unknown): { operation: "read" | "write"; scope: AssistantMemoryScope; file?: unknown; expected?: unknown } {
  const row = object(value, "General worker memory bridge request");
  exact(row, ["operation", "scope", "file", "expected"], "General worker memory bridge request");
  if (row.operation !== "read" && row.operation !== "write") throw new Error("General worker memory bridge operation is invalid.");
  if (row.operation === "read") return { operation: "read", scope: parseMemoryScope(row.scope) };
  if (row.file === undefined || row.expected === undefined) throw new Error("General worker memory write requires file and expected.");
  return { operation: "write", scope: parseMemoryScope(row.scope), file: row.file, expected: row.expected };
}

function parseLibraryScope(value: unknown): LibraryScope {
  const row = object(value, "General worker Library scope");
  exact(row, ["kind", "projectId"], "General worker Library scope");
  if (row.kind === "personal") return { kind: "personal" };
  if (row.kind === "project" && typeof row.projectId === "string" && row.projectId.trim()) return { kind: "project", projectId: row.projectId };
  throw new Error("General worker Library scope is invalid.");
}

function parseLibraryBridgeRequest(value: unknown): { operation: "read" | "materialize"; scope: LibraryScope; document?: StoredLibraryDocumentV1 } {
  const row = object(value, "General worker Library bridge request");
  exact(row, ["operation", "scope", "document"], "General worker Library bridge request");
  if (row.operation !== "read" && row.operation !== "materialize") throw new Error("General worker Library bridge operation is invalid.");
  const scope = parseLibraryScope(row.scope);
  if (row.operation === "read") return { operation: "read", scope };
  const document = parseLibraryMetadataFile({ schemaVersion: 1, scope, documents: [row.document], blocks: [], updatedAt: "1970-01-01T00:00:00.000Z" }, "General worker Library bridge document").documents[0];
  if (!document) throw new Error("General worker Library bridge document is invalid.");
  return { operation: "materialize", scope, document };
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`${label} must be a string array.`);
  return [...value] as string[];
}

function parseRuntimeEvent(value: unknown): AgentRuntimeEvent {
  const row = object(value, "General worker runtime event");
  const type = nonEmptyString(row.type, "General worker runtime event.type");
  if (type === "lifecycle") {
    exact(row, ["type", "phase", "willRetry"], "General worker runtime event");
    nonEmptyString(row.phase, "General worker runtime event.phase");
    if (row.willRetry !== undefined && typeof row.willRetry !== "boolean") throw new Error("General worker lifecycle willRetry is invalid.");
  } else if (type === "message.delta") {
    exact(row, ["type", "channel", "delta"], "General worker runtime event");
    if (row.channel !== "text" && row.channel !== "thinking") throw new Error("General worker message channel is invalid.");
    if (typeof row.delta !== "string") throw new Error("General worker message delta is invalid.");
  } else if (type === "message.completed") {
    exact(row, ["type", "message"], "General worker runtime event");
  } else if (type === "tool.started" || type === "tool.updated" || type === "tool.completed") {
    const allowed = type === "tool.started"
      ? ["type", "toolCallId", "toolName", "args"]
      : type === "tool.updated"
        ? ["type", "toolCallId", "toolName", "args", "partialResult"]
        : ["type", "toolCallId", "toolName", "result", "isError"];
    exact(row, allowed, "General worker runtime event");
    nonEmptyString(row.toolCallId, "General worker runtime event.toolCallId");
    nonEmptyString(row.toolName, "General worker runtime event.toolName");
    if (type === "tool.completed" && typeof row.isError !== "boolean") throw new Error("General worker tool completion isError is invalid.");
  } else if (type === "queue.changed") {
    exact(row, ["type", "steering", "followUp"], "General worker runtime event");
    stringArray(row.steering, "General worker queue steering");
    stringArray(row.followUp, "General worker queue followUp");
  } else if (type === "compaction.started") {
    exact(row, ["type", "reason"], "General worker runtime event");
    if (typeof row.reason !== "string") throw new Error("General worker compaction reason is invalid.");
  } else if (type === "compaction.completed") {
    exact(row, ["type", "reason", "tokensBefore", "estimatedTokensAfter", "aborted", "willRetry", "errorMessage"], "General worker runtime event");
    if (typeof row.reason !== "string" || typeof row.aborted !== "boolean" || typeof row.willRetry !== "boolean") throw new Error("General worker compaction completion is invalid.");
    for (const field of ["tokensBefore", "estimatedTokensAfter"] as const) {
      if (row[field] !== undefined && (typeof row[field] !== "number" || !Number.isFinite(row[field]))) throw new Error(`General worker compaction ${field} is invalid.`);
    }
    if (row.errorMessage !== undefined && typeof row.errorMessage !== "string") throw new Error("General worker compaction errorMessage is invalid.");
  } else if (type === "retry.started") {
    exact(row, ["type", "attempt", "maxAttempts", "delayMs", "errorMessage"], "General worker runtime event");
    for (const field of ["attempt", "maxAttempts", "delayMs"] as const) {
      if (!Number.isFinite(row[field])) throw new Error(`General worker retry ${field} is invalid.`);
    }
    if (typeof row.errorMessage !== "string") throw new Error("General worker retry errorMessage is invalid.");
  } else if (type === "retry.completed") {
    exact(row, ["type", "success", "attempt", "finalError"], "General worker runtime event");
    if (typeof row.success !== "boolean" || !Number.isFinite(row.attempt)) throw new Error("General worker retry completion is invalid.");
    if (row.finalError !== undefined && typeof row.finalError !== "string") throw new Error("General worker retry finalError is invalid.");
  } else if (type === "attempt.failed") {
    exact(row, ["type", "errorMessage", "willRetry"], "General worker runtime event");
    if (row.willRetry !== true || typeof row.errorMessage !== "string") throw new Error("General worker attempt failure must remain retryable.");
  } else if (type === "run.failed") {
    exact(row, ["type", "errorMessage"], "General worker runtime event");
    if (typeof row.errorMessage !== "string") throw new Error("General worker run failure is invalid.");
  } else if (type === "runtime.diagnostic") {
    exact(row, ["type", "code", "nativeType", "message"], "General worker runtime event");
    if (row.code !== "UNMAPPED_NATIVE_EVENT" && row.code !== "INVALID_NATIVE_EVENT") throw new Error("General worker diagnostic code is invalid.");
    nonEmptyString(row.nativeType, "General worker diagnostic nativeType");
    nonEmptyString(row.message, "General worker diagnostic message");
  } else {
    throw new Error(`General worker runtime event type is invalid: ${type}`);
  }
  return row as unknown as AgentRuntimeEvent;
}

function parseStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return [...value];
}

function parseCapabilityActivation(value: unknown): CapabilityActivation {
  const row = object(value, "General worker capability activation");
  exact(row, ["query", "addedToolNames", "matchedToolNames", "sources"], "General worker capability activation");
  const query = nonEmptyString(row.query, "General worker capability activation.query");
  const sources = Array.isArray(row.sources) ? row.sources.map((sourceValue) => {
    const source = object(sourceValue, "General worker capability activation source");
    exact(source, ["toolName", "source", "path"], "General worker capability activation source");
    return {
      toolName: nonEmptyString(source.toolName, "General worker capability activation source.toolName"),
      source: nonEmptyString(source.source, "General worker capability activation source.source"),
      path: nonEmptyString(source.path, "General worker capability activation source.path"),
    };
  }) : (() => { throw new Error("General worker capability activation.sources must be an array."); })();
  return {
    query,
    addedToolNames: parseStringList(row.addedToolNames, "General worker capability activation.addedToolNames"),
    matchedToolNames: parseStringList(row.matchedToolNames, "General worker capability activation.matchedToolNames"),
    sources,
  };
}

function parseCompactionRequest(value: unknown): RuntimeCompactionRequest {
  const request = object(value, "General worker compaction request");
  exact(request, ["handoff"], "General worker compaction request");
  const handoff = object(request.handoff, "General worker compaction handoff");
  exact(handoff, [
    "schemaVersion", "handoffId", "taskId", "runId", "threadId", "sessionId",
    "taskGoal", "openDecisionIds", "pendingArtifactIds", "execution",
    "resourceManifestHash", "policyHash", "requestedFocus", "createdAt",
  ], "General worker compaction handoff");
  if (handoff.schemaVersion !== 1) throw new Error("General worker compaction handoff schemaVersion is invalid.");
  for (const field of ["handoffId", "taskId", "runId", "threadId", "sessionId", "taskGoal", "resourceManifestHash", "policyHash", "createdAt"] as const) {
    nonEmptyString(handoff[field], `General worker compaction handoff.${field}`);
  }
  if (handoff.requestedFocus !== undefined && typeof handoff.requestedFocus !== "string") {
    throw new Error("General worker compaction handoff.requestedFocus is invalid.");
  }
  const execution = object(handoff.execution, "General worker compaction execution");
  exact(execution, [
    "executionId", "runtimeEpochId", "configRevision", "promptHash", "toolManifestHash",
    "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash",
  ], "General worker compaction execution");
  for (const field of ["executionId", "runtimeEpochId", "promptHash", "toolManifestHash", "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash"] as const) {
    nonEmptyString(execution[field], `General worker compaction execution.${field}`);
  }
  if (!Number.isSafeInteger(execution.configRevision) || Number(execution.configRevision) < 1) {
    throw new Error("General worker compaction execution.configRevision is invalid.");
  }
  return {
    handoff: {
      schemaVersion: 1,
      handoffId: String(handoff.handoffId),
      taskId: String(handoff.taskId),
      runId: String(handoff.runId),
      threadId: String(handoff.threadId),
      sessionId: String(handoff.sessionId),
      taskGoal: String(handoff.taskGoal),
      openDecisionIds: parseStringList(handoff.openDecisionIds, "General worker compaction handoff.openDecisionIds"),
      pendingArtifactIds: parseStringList(handoff.pendingArtifactIds, "General worker compaction handoff.pendingArtifactIds"),
      execution: {
        executionId: String(execution.executionId),
        runtimeEpochId: String(execution.runtimeEpochId),
        configRevision: Number(execution.configRevision),
        promptHash: String(execution.promptHash),
        toolManifestHash: String(execution.toolManifestHash),
        resourceSnapshotHash: String(execution.resourceSnapshotHash),
        capabilityGrantHash: String(execution.capabilityGrantHash),
        contextInputHash: String(execution.contextInputHash),
      },
      resourceManifestHash: String(handoff.resourceManifestHash),
      policyHash: String(handoff.policyHash),
      ...(handoff.requestedFocus === undefined ? {} : { requestedFocus: handoff.requestedFocus }),
      createdAt: String(handoff.createdAt),
    },
  };
}

function parseAttestation(value: unknown): GeneralWorkerAttestationV1 {
  const row = object(value, "General worker attestation");
  exact(row, [
    "schemaVersion", "planHash", "sessionId", "sessionFile", "runtimeVersion", "systemPromptHash",
    "systemPromptChars", "toolManifestHash", "resourceSnapshotHash", "capabilityGrantHash",
    "contextInputHash", "workingDirectory", "fileGrantIds",
  ], "General worker attestation");
  if (row.schemaVersion !== 1) throw new Error("General worker attestation schemaVersion must be 1.");
  for (const field of ["planHash", "sessionId", "runtimeVersion", "systemPromptHash", "toolManifestHash", "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash", "workingDirectory"] as const) {
    nonEmptyString(row[field], `General worker attestation.${field}`);
  }
  if (row.sessionFile !== null && typeof row.sessionFile !== "string") throw new Error("General worker attestation.sessionFile must be a string or null.");
  if (!Number.isSafeInteger(row.systemPromptChars) || (row.systemPromptChars as number) < 0) throw new Error("General worker attestation.systemPromptChars is invalid.");
  if (!Array.isArray(row.fileGrantIds) || row.fileGrantIds.some((entry) => typeof entry !== "string")) throw new Error("General worker attestation.fileGrantIds must be a string array.");
  return row as unknown as GeneralWorkerAttestationV1;
}

function assertAttestation(plan: GeneralAgentSessionPlanV1, attestation: GeneralWorkerAttestationV1): void {
  if (attestation.planHash !== plan.planHash) throw new Error("General worker attestation plan hash differs from the PreparationPlan.");
  if (attestation.toolManifestHash !== plan.toolManifestHash) throw new Error("General worker attestation tool manifest differs from the PreparationPlan.");
  if (attestation.resourceSnapshotHash !== plan.resourceSnapshotHash) throw new Error("General worker attestation resource snapshot differs from the PreparationPlan.");
  if (attestation.capabilityGrantHash !== plan.capabilityGrantHash) throw new Error("General worker attestation capability grant differs from the PreparationPlan.");
  if (attestation.contextInputHash !== plan.contextInputHash) throw new Error("General worker attestation context input differs from the PreparationPlan.");
  if (attestation.workingDirectory !== plan.access.workingDirectory) throw new Error("General worker attestation working directory differs from the PreparationPlan.");
  if (JSON.stringify(attestation.fileGrantIds) !== JSON.stringify(plan.access.grants.map((grant) => grant.id))) {
    throw new Error("General worker attestation file grants differ from the PreparationPlan.");
  }
}

function parsePreparedResult(value: unknown, plan: GeneralAgentSessionPlanV1): PreparedResult {
  const row = object(value, "General worker prepared result");
  exact(row, ["attestation", "systemPrompt", "access", "resources", "state"], "General worker prepared result");
  const attestation = parseAttestation(row.attestation);
  assertAttestation(plan, attestation);
  if (typeof row.systemPrompt !== "string" || sha256(row.systemPrompt) !== attestation.systemPromptHash || row.systemPrompt.length !== attestation.systemPromptChars) {
    throw new Error("General worker system prompt differs from its attestation.");
  }
  if (JSON.stringify(row.access) !== JSON.stringify(plan.access)) throw new Error("General worker prepared access differs from the PreparationPlan.");
  const resources = object(row.resources, "General worker prepared resources");
  exact(resources, ["extensions", "skills", "prompts", "contextFiles", "activeToolNames", "entries", "conflicts", "resourceSetHash"], "General worker prepared resources");
  for (const field of ["extensions", "skills", "prompts", "contextFiles", "entries", "conflicts"] as const) {
    if (!Array.isArray(resources[field])) throw new Error(`General worker prepared resources.${field} must be an array.`);
  }
  for (const extensionValue of resources.extensions as unknown[]) {
    const extension = object(extensionValue, "General worker prepared extension");
    exact(extension, ["path", "tools", "commands", "sha256", "source", "scope"], "General worker prepared extension");
    nonEmptyString(extension.path, "General worker prepared extension.path");
    stringArray(extension.tools, "General worker prepared extension.tools");
    stringArray(extension.commands, "General worker prepared extension.commands");
    for (const field of ["sha256", "source", "scope"] as const) if (extension[field] !== undefined && typeof extension[field] !== "string") throw new Error(`General worker prepared extension.${field} is invalid.`);
  }
  for (const field of ["skills", "prompts"] as const) {
    for (const itemValue of resources[field] as unknown[]) {
      const item = object(itemValue, `General worker prepared ${field} item`);
      exact(item, ["name", "description", "filePath"], `General worker prepared ${field} item`);
      for (const key of ["name", "description", "filePath"] as const) if (typeof item[key] !== "string") throw new Error(`General worker prepared ${field}.${key} is invalid.`);
    }
  }
  stringArray(resources.contextFiles, "General worker prepared resources.contextFiles");
  for (const conflictValue of resources.conflicts as unknown[]) {
    const conflict = object(conflictValue, "General worker prepared conflict");
    exact(conflict, ["kind", "name", "winnerPath", "shadowedPath"], "General worker prepared conflict");
    if (conflict.kind !== "tool" && conflict.kind !== "flag") throw new Error("General worker prepared conflict.kind is invalid.");
    for (const field of ["name", "winnerPath", "shadowedPath"] as const) nonEmptyString(conflict[field], `General worker prepared conflict.${field}`);
  }
  const activeToolNames = stringArray(resources.activeToolNames, "General worker prepared resources.activeToolNames");
  if (JSON.stringify(activeToolNames) !== JSON.stringify(plan.initialActiveToolNames)) throw new Error("General worker prepared tools differ from the PreparationPlan.");
  if (resources.resourceSetHash !== plan.resourceSnapshotHash) throw new Error("General worker prepared resources differ from the PreparationPlan.");
  if (JSON.stringify(resources.entries) !== JSON.stringify(plan.resourceSnapshot.entries)) throw new Error("General worker prepared resource entries differ from the PreparationPlan.");
  const stateRow = object(row.state, "General worker prepared state");
  exact(stateRow, ["steering", "followUp", "leafEntryId"], "General worker prepared state");
  const state: RpcSessionState = {
    steering: stringArray(stateRow.steering, "General worker prepared state.steering"),
    followUp: stringArray(stateRow.followUp, "General worker prepared state.followUp"),
    leafEntryId: stateRow.leafEntryId === null ? null : nonEmptyString(stateRow.leafEntryId, "General worker prepared state.leafEntryId"),
  };
  return {
    attestation,
    systemPrompt: row.systemPrompt,
    access: row.access as AgentRuntimeSessionCreation["access"],
    resources: resources as unknown as GeneralResourceInventory,
    state,
  };
}

function parseActivationSnapshot(value: unknown, plan: GeneralAgentSessionPlanV1, attestation: GeneralWorkerAttestationV1): TaskExecutionSnapshot {
  const row = object(value, "General worker activation snapshot");
  exact(row, [
    "schemaVersion", "executionId", "runId", "threadId", "turnId", "runtimeEpochId", "configRevision",
    "providerId", "modelId", "reasoningEffort", "executionProfile", "promptHash", "toolManifestHash",
    "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash", "createdAt",
  ], "General worker activation snapshot");
  if (row.schemaVersion !== 1 || row.runId !== plan.runId || row.threadId !== plan.rootAgentThreadId) throw new Error("General worker activation identity differs from the PreparationPlan.");
  if (row.promptHash !== attestation.systemPromptHash
    || row.toolManifestHash !== attestation.toolManifestHash
    || row.resourceSnapshotHash !== attestation.resourceSnapshotHash
    || row.capabilityGrantHash !== attestation.capabilityGrantHash
    || row.contextInputHash !== attestation.contextInputHash) {
    throw new Error("General worker activation hashes differ from the attested Session.");
  }
  for (const field of ["executionId", "runId", "threadId", "turnId", "runtimeEpochId", "createdAt"] as const) nonEmptyString(row[field], `General worker activation snapshot.${field}`);
  if (!Number.isSafeInteger(row.configRevision) || (row.configRevision as number) < 1) throw new Error("General worker activation configRevision is invalid.");
  return row as unknown as TaskExecutionSnapshot;
}

function sessionState(session: AgentRuntimeSession): RpcSessionState {
  return {
    steering: [...session.getSteeringMessages()],
    followUp: [...session.getFollowUpMessages()],
    leafEntryId: session.leafEntryId() ?? null,
  };
}

function requiredTextPayload(payload: unknown, method: string): string {
  const row = object(payload, `General worker ${method} payload`);
  exact(row, ["text"], `General worker ${method} payload`);
  return nonEmptyString(row.text, `General worker ${method} payload.text`);
}

function assertEmptyPayload(payload: unknown, method: string): void {
  exact(object(payload, `General worker ${method} payload`), [], `General worker ${method} payload`);
}

export function createGeneralWorkerRpcServer(input: {
  transport: GeneralWorkerRpcTransport;
  runtimePort: AgentRuntimePort;
  requestTimeoutMs: number;
}): { dispose(): Promise<void> } {
  if (!Number.isFinite(input.requestTimeoutMs) || input.requestTimeoutMs <= 0) throw new Error("General worker bridge timeout must be positive.");
  let plan: GeneralAgentSessionPlanV1 | undefined;
  let creation: AgentRuntimeSessionCreation | undefined;
  let activeSession: AgentRuntimeSession | undefined;
  let activated = false;
  let unsubscribeSession = () => {};
  const pendingBridges = new Map<string, { kind: RpcBridgeRequest["bridge"]; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  const bridge = (kind: RpcBridgeRequest["bridge"], payload: unknown): Promise<unknown> => {
    const requestId = `bridge_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingBridges.delete(requestId);
        reject(new Error(`General worker ${kind} bridge timed out.`));
      }, input.requestTimeoutMs);
      pendingBridges.set(requestId, { kind, resolve, reject, timer });
      input.transport.send({ schemaVersion: 1, type: "bridge_request", requestId, bridge: kind, payload } satisfies RpcBridgeRequest);
    });
  };
  const assistantMemoryStore: AssistantMemoryPersistence = {
    read: (scope) => bridge("memory", { operation: "read", scope, file: null, expected: null }) as Promise<Awaited<ReturnType<AssistantMemoryPersistence["read"]>>>,
    write: (scope, file, expected) => bridge("memory", { operation: "write", scope, file, expected }) as Promise<void>,
  };
  const libraryPersistence: LibraryPersistence = {
    read: (scope) => bridge("library", { operation: "read", scope, document: null }) as Promise<Awaited<ReturnType<LibraryPersistence["read"]>>>,
    write: async () => { throw new Error("General read-only Library workers cannot write Library metadata."); },
    putDocument: async () => { throw new Error("General read-only Library workers cannot import Library documents."); },
    materializeDocument: async (scope, document) => {
      const result = await bridge("library", { operation: "materialize", scope, document }) as { path?: unknown };
      if (!result || typeof result.path !== "string" || !result.path.trim()) throw new Error("General worker Library materialization path is invalid.");
      return { path: result.path };
    },
    removeDocument: async () => { throw new Error("General read-only Library workers cannot remove Library documents."); },
  };

  const respond = (requestId: string, result: unknown): void => {
    input.transport.send({ schemaVersion: 1, type: "response", requestId, ok: true, result } satisfies RpcResponse);
  };
  const fail = (requestId: string, error: unknown): void => {
    input.transport.send({ schemaVersion: 1, type: "response", requestId, ok: false, error: publicError(error) } satisfies RpcResponse);
  };

  const handleRequest = async (request: RpcRequest): Promise<void> => {
    if (request.method === "prepare") {
      if (creation) throw new RpcPublicError("WORKER_ALREADY_PREPARED", "General worker Session is already prepared.");
      const payload = object(request.payload, "General worker prepare payload");
      exact(payload, ["plan"], "General worker prepare payload");
      plan = parseGeneralAgentSessionPlan(payload.plan);
      creation = await input.runtimePort.createGeneralSession({
        runtimeRoot: plan.runtimeRoot,
        taskId: plan.taskId,
        runId: plan.runId,
        rootAgentThreadId: plan.rootAgentThreadId,
        sessionIdSuffix: plan.sessionIdSuffix,
        readOnlyChild: plan.readOnlyChild,
        agentDir: plan.agentDir,
        modelProvider: plan.modelProvider,
        modelId: plan.modelId,
        thinkingLevel: plan.thinkingLevel,
        permissionContract: plan.permissionContract,
        projectTrusted: plan.projectTrusted,
        sessionFile: plan.sessionFile,
        contextHandoffs: plan.contextHandoffs,
        managedResources: { extensions: [], skills: [], prompts: [], themes: [] },
        preparedPlan: plan,
        onCapabilityActivation: (activation) => {
          input.transport.send({ schemaVersion: 1, type: "capability_activation", activation });
        },
        requestPermissionDecision: async (permission) => bridge("permission", permission) as Promise<AgentPermissionUserDecision>,
        delegate: plan.delegationEnabled
          ? async (delegation) => bridge("delegation", delegation) as Promise<GeneralDelegationResult>
          : undefined,
        assistantMemoryStore,
        libraryPersistence,
        submitAgentPlan: (payload: unknown) => bridge("server_tool", { tool: "agent_plan_update", payload }),
        submitAgentPresent: (payload: unknown) => bridge("server_tool", { tool: "agent_present", payload }),
      });
      activeSession = creation.session;
      if (JSON.stringify(creation.access) !== JSON.stringify(plan.access)) throw new Error("General worker Session access differs from the PreparationPlan.");
      if (JSON.stringify(creation.resources.activeToolNames) !== JSON.stringify(plan.initialActiveToolNames)) {
        throw new Error("General worker attestation tool manifest differs from the PreparationPlan.");
      }
      if (creation.resources.resourceSetHash !== plan.resourceSnapshotHash) throw new Error("General worker Session resources differ from the PreparationPlan.");
      const attestation: GeneralWorkerAttestationV1 = {
        schemaVersion: 1,
        planHash: plan.planHash,
        sessionId: creation.session.sessionId,
        sessionFile: creation.session.sessionFile ?? null,
        runtimeVersion: creation.runtimeVersion,
        systemPromptHash: sha256(creation.session.systemPrompt),
        systemPromptChars: creation.session.systemPrompt.length,
        toolManifestHash: sha256({ initial: creation.resources.activeToolNames, registered: plan.registeredToolNames }),
        resourceSnapshotHash: creation.resources.resourceSetHash,
        capabilityGrantHash: plan.capabilityGrantHash,
        contextInputHash: plan.contextInputHash,
        workingDirectory: creation.access.workingDirectory,
        fileGrantIds: creation.access.grants.map((grant) => grant.id),
      };
      assertAttestation(plan, attestation);
      unsubscribeSession = activeSession.subscribe((event) => {
        input.transport.send({ schemaVersion: 1, type: "event", event, state: sessionState(activeSession!) });
      });
      respond(request.requestId, {
        attestation,
        systemPrompt: creation.session.systemPrompt,
        access: creation.access,
        resources: creation.resources,
        state: sessionState(creation.session),
      } satisfies PreparedResult);
      return;
    }
    if (!creation || !plan) throw new RpcPublicError("WORKER_NOT_PREPARED", "General worker Session has not been prepared.");
    if (request.method === "activate") {
      if (activated) throw new RpcPublicError("WORKER_ALREADY_ACTIVATED", "General worker Session is already activated.");
      const payload = object(request.payload, "General worker activate payload");
      exact(payload, ["executionSnapshot"], "General worker activate payload");
      const attestation: GeneralWorkerAttestationV1 = {
        schemaVersion: 1,
        planHash: plan.planHash,
        sessionId: creation.session.sessionId,
        sessionFile: creation.session.sessionFile ?? null,
        runtimeVersion: creation.runtimeVersion,
        systemPromptHash: sha256(creation.session.systemPrompt),
        systemPromptChars: creation.session.systemPrompt.length,
        toolManifestHash: plan.toolManifestHash,
        resourceSnapshotHash: creation.resources.resourceSetHash,
        capabilityGrantHash: plan.capabilityGrantHash,
        contextInputHash: plan.contextInputHash,
        workingDirectory: creation.access.workingDirectory,
        fileGrantIds: creation.access.grants.map((grant) => grant.id),
      };
      parseActivationSnapshot(payload.executionSnapshot, plan, attestation);
      activated = true;
      respond(request.requestId, { activated: true, state: sessionState(creation.session) });
      return;
    }
    if (request.method === "dispose") {
      assertEmptyPayload(request.payload, "dispose");
      unsubscribeSession();
      const activeCreation = creation;
      creation = undefined;
      activeSession = undefined;
      await activeCreation.dispose();
      respond(request.requestId, { disposed: true });
      return;
    }
    if (!activated || !activeSession) throw new RpcPublicError("WORKER_NOT_ACTIVATED", "General worker Session cannot execute before Host activation.");
    if (request.method === "prompt") {
      const payload = object(request.payload, "General worker prompt payload");
      exact(payload, ["text", "images"], "General worker prompt payload");
      const text = requiredTextPayload(payload, "prompt");
      const images = payload.images;
      if (images !== undefined && !Array.isArray(images)) throw new Error("General worker prompt payload.images must be an array.");
      await activeSession.prompt(text, images ? { images: images as never[] } : undefined);
    } else if (request.method === "wait_for_idle") {
      assertEmptyPayload(request.payload, "wait_for_idle");
      await activeSession.waitForIdle();
    } else if (request.method === "steer") {
      await activeSession.steer(requiredTextPayload(request.payload, "steer"));
    } else if (request.method === "follow_up") {
      await activeSession.followUp(requiredTextPayload(request.payload, "follow_up"));
    } else if (request.method === "clear_queue") {
      assertEmptyPayload(request.payload, "clear_queue");
      activeSession.clearQueue();
    } else if (request.method === "compact") {
      const payload = object(request.payload, "General worker compact payload");
      exact(payload, ["request"], "General worker compact payload");
      await activeSession.compact(parseCompactionRequest(payload.request));
    } else if (request.method === "fork") {
      if (!creation.fork) throw new RpcPublicError("WORKER_FORK_UNSUPPORTED", "The General Worker runtime does not support Pi branching.");
      const payload = object(request.payload, "General worker fork payload");
      exact(payload, ["entryId", "position"], "General worker fork payload");
      const entryId = nonEmptyString(payload.entryId, "General worker fork payload.entryId");
      if (payload.position !== "before" && payload.position !== "at") throw new Error("General worker fork position is invalid.");
      const result = await creation.fork(entryId, { position: payload.position });
      if (!result.cancelled) {
        unsubscribeSession();
        activeSession = result.session;
        unsubscribeSession = activeSession.subscribe((event) => {
          input.transport.send({ schemaVersion: 1, type: "event", event, state: sessionState(activeSession!) });
        });
      }
      respond(request.requestId, {
        cancelled: result.cancelled,
        sessionId: result.session.sessionId,
        sessionFile: result.session.sessionFile ?? null,
        leafEntryId: result.session.leafEntryId() ?? null,
        state: sessionState(activeSession),
      });
      return;
    } else if (request.method === "abort") {
      assertEmptyPayload(request.payload, "abort");
      await activeSession.abort();
    }
    respond(request.requestId, { state: sessionState(activeSession) });
  };

  const unsubscribeMessage = input.transport.onMessage((raw) => {
    const envelope = raw && typeof raw === "object" ? raw as Record<string, unknown> : undefined;
    if (envelope?.type === "bridge_response") {
      let response: RpcBridgeResponse;
      try {
        response = parseBridgeResponse(raw);
      } catch (error) {
        input.transport.close(publicError(error).message);
        return;
      }
      const pending = pendingBridges.get(response.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingBridges.delete(response.requestId);
      if (response.ok) pending.resolve(pending.kind === "permission"
        ? parsePermissionDecision(response.result)
        : pending.kind === "delegation"
          ? parseDelegationResult(response.result)
          : response.result);
      else pending.reject(new Error(response.error?.message ?? "General worker bridge failed."));
      return;
    }
    let request: RpcRequest;
    try {
      request = parseRequest(raw);
    } catch (error) {
      input.transport.close(publicError(error).message);
      return;
    }
    void handleRequest(request).catch(async (error) => {
      if (request.method === "prepare" && creation) {
        unsubscribeSession();
        const failedCreation = creation;
        creation = undefined;
        activeSession = undefined;
        plan = undefined;
        await failedCreation.dispose().catch((disposeError) => {
          process.stderr.write(`General worker failed-prepare cleanup error: ${publicError(disposeError).message}\n`);
        });
      }
      fail(request.requestId, error);
    });
  });
  const unsubscribeClose = input.transport.onClose((reason) => {
    for (const pending of pendingBridges.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`General worker transport closed: ${reason}`));
    }
    pendingBridges.clear();
    unsubscribeSession();
    if (creation) {
      const activeCreation = creation;
      creation = undefined;
      activeSession = undefined;
      void activeCreation.dispose().catch((error) => {
        process.stderr.write(`General worker dispose failed after transport close: ${publicError(error).message}\n`);
      });
    }
  });
  return {
    async dispose() {
      unsubscribeMessage();
      unsubscribeClose();
      unsubscribeSession();
      for (const pending of pendingBridges.values()) clearTimeout(pending.timer);
      pendingBridges.clear();
      if (creation) {
        const activeCreation = creation;
        creation = undefined;
        activeSession = undefined;
        await activeCreation.dispose();
      }
    },
  };
}

class GeneralWorkerRpcClient {
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Set<(event: AgentRuntimeEvent) => void>();
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeClose: () => void;
  private closed = false;
  state: RpcSessionState = { steering: [], followUp: [], leafEntryId: null };

  constructor(
    private readonly transport: GeneralWorkerRpcTransport,
    private readonly timeoutMs: number,
    private readonly requestPermissionDecision: (request: AgentPermissionRequest) => Promise<AgentPermissionUserDecision>,
    private readonly delegate: (request: GeneralDelegationRequest) => Promise<GeneralDelegationResult>,
    private readonly assistantMemoryStore: AssistantMemoryPersistence | undefined,
    private readonly libraryPersistence: LibraryPersistence | undefined,
    private readonly serverToolHandler: ((request: ServerToolBridgeRequest) => Promise<unknown>) | undefined,
    private readonly onCapabilityActivation?: (activation: CapabilityActivation) => void,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("General worker RPC timeout must be positive.");
    this.unsubscribeMessage = transport.onMessage((message) => {
      try {
        this.accept(message);
      } catch (error) {
        const reason = publicError(error).message;
        this.close(reason);
        this.transport.close(reason);
      }
    });
    this.unsubscribeClose = transport.onClose((reason) => this.close(reason));
  }

  subscribe(listener: (event: AgentRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(method: RpcMethod, payload: unknown): Promise<unknown> {
    if (this.closed) throw new Error("General worker RPC transport is closed.");
    const requestId = `rpc_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`General worker RPC ${method} timed out.`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.transport.send({ schemaVersion: 1, type: "request", requestId, method, payload } satisfies RpcRequest);
    });
  }

  dispose(): void {
    this.close("client disposed");
    this.unsubscribeMessage();
    this.unsubscribeClose();
  }

  private accept(raw: unknown): void {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : undefined;
    if (row?.type === "event") {
      const eventRow = object(raw, "General worker event");
      exact(eventRow, ["schemaVersion", "type", "event", "state"], "General worker event");
      if (eventRow.schemaVersion !== 1) return this.close("invalid worker event schema");
      this.updateState(eventRow.state);
      const event = parseRuntimeEvent(eventRow.event);
      for (const listener of this.listeners) listener(event);
      return;
    }
    if (row?.type === "bridge_request") {
      void this.answerBridge(raw);
      return;
    }
    if (row?.type === "capability_activation") {
      const activationRow = object(raw, "General worker capability activation event");
      exact(activationRow, ["schemaVersion", "type", "activation"], "General worker capability activation event");
      if (activationRow.schemaVersion !== 1) throw new Error("General worker capability activation schemaVersion is invalid.");
      this.onCapabilityActivation?.(parseCapabilityActivation(activationRow.activation));
      return;
    }
    let response: RpcResponse;
    try {
      response = parseResponse(raw);
    } catch (error) {
      this.close(publicError(error).message);
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    if (!response.ok) {
      pending.reject(new RpcPublicError(response.error!.code, response.error!.message));
      return;
    }
    const resultRow = response.result && typeof response.result === "object" ? response.result as Record<string, unknown> : undefined;
    if (resultRow?.state) this.updateState(resultRow.state);
    pending.resolve(response.result);
  }

  private async answerBridge(raw: unknown): Promise<void> {
    let requestId = "unknown";
    try {
      const row = object(raw, "General worker bridge request");
      exact(row, ["schemaVersion", "type", "requestId", "bridge", "payload"], "General worker bridge request");
      if (row.schemaVersion !== 1 || row.type !== "bridge_request") throw new Error("General worker bridge request envelope is invalid.");
      requestId = nonEmptyString(row.requestId, "General worker bridge request.requestId");
      const result = row.bridge === "permission"
        ? parsePermissionDecision(await this.requestPermissionDecision(parsePermissionRequest(row.payload)))
        : row.bridge === "delegation"
          ? parseDelegationResult(await this.delegate(parseDelegationRequest(row.payload)))
          : row.bridge === "memory"
            ? await this.answerMemoryBridge(row.payload)
          : row.bridge === "library"
            ? await this.answerLibraryBridge(row.payload)
          : row.bridge === "server_tool"
            ? await this.answerServerToolBridge(row.payload)
          : (() => { throw new Error("General worker bridge type is invalid."); })();
      this.transport.send({ schemaVersion: 1, type: "bridge_response", requestId, ok: true, result } satisfies RpcBridgeResponse);
    } catch (error) {
      this.transport.send({ schemaVersion: 1, type: "bridge_response", requestId, ok: false, error: publicError(error) } satisfies RpcBridgeResponse);
    }
  }

  private async answerMemoryBridge(payload: unknown): Promise<unknown> {
    if (!this.assistantMemoryStore) throw new Error("SQLite Assistant Memory bridge is unavailable.");
    const request = parseMemoryBridgeRequest(payload);
    if (request.operation === "read") return this.assistantMemoryStore.read(request.scope);
    const file = parseAssistantMemoryFile(request.file, "General worker memory write.file");
    if (JSON.stringify(file.scope) !== JSON.stringify(request.scope)) throw new Error("General worker memory write scope does not match file scope.");
    const expected = request.expected === null
      ? null
      : parseAssistantMemoryFile(request.expected, "General worker memory write.expected");
    if (expected && JSON.stringify(expected.scope) !== JSON.stringify(request.scope)) throw new Error("General worker memory expected scope does not match request scope.");
    return this.assistantMemoryStore.write(
      request.scope,
      file as AssistantMemoryFileV1,
      expected as AssistantMemoryFileV1 | null,
    );
  }

  private async answerLibraryBridge(payload: unknown): Promise<unknown> {
    if (!this.libraryPersistence) throw new Error("SQLite Library bridge is unavailable.");
    const request = parseLibraryBridgeRequest(payload);
    if (request.operation === "read") {
      const value = await this.libraryPersistence.read(request.scope);
      return value ? parseLibraryMetadataFile(value, "General worker Library read result") : null;
    }
    const materialized = await this.libraryPersistence.materializeDocument(request.scope, request.document!);
    return { path: materialized.path };
  }

  private async answerServerToolBridge(payload: unknown): Promise<unknown> {
    if (!this.serverToolHandler) throw new Error("General worker server tools are unavailable.");
    const request = parseServerToolRequest(payload);
    return this.serverToolHandler(request);
  }

  private updateState(value: unknown): void {
    const row = object(value, "General worker session state");
    exact(row, ["steering", "followUp", "leafEntryId"], "General worker session state");
    if (!Array.isArray(row.steering) || row.steering.some((entry) => typeof entry !== "string")) throw new Error("General worker steering state is invalid.");
    if (!Array.isArray(row.followUp) || row.followUp.some((entry) => typeof entry !== "string")) throw new Error("General worker follow-up state is invalid.");
    if (row.leafEntryId !== null && typeof row.leafEntryId !== "string") throw new Error("General worker leaf entry state is invalid.");
    this.state = { steering: [...row.steering] as string[], followUp: [...row.followUp] as string[], leafEntryId: row.leafEntryId as string | null };
  }

  private close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`General worker RPC disconnected: ${reason}`));
    }
    this.pending.clear();
  }
}

function buildExecutionSnapshot(plan: GeneralAgentSessionPlanV1, attestation: GeneralWorkerAttestationV1, identity: GeneralWorkerExecutionIdentity): TaskExecutionSnapshot {
  if (!plan.runId || !plan.rootAgentThreadId) throw new Error("General worker activation requires a Run and root Agent thread identity.");
  return {
    schemaVersion: 1,
    executionId: identity.executionId,
    runId: plan.runId,
    threadId: identity.threadId,
    turnId: identity.turnId,
    runtimeEpochId: identity.runtimeEpochId,
    configRevision: identity.configRevision,
    providerId: plan.modelProvider ?? null,
    modelId: plan.modelId ?? null,
    reasoningEffort: plan.thinkingLevel ?? null,
    executionProfile: identity.executionProfile,
    promptHash: attestation.systemPromptHash,
    toolManifestHash: attestation.toolManifestHash,
    resourceSnapshotHash: attestation.resourceSnapshotHash,
    capabilityGrantHash: attestation.capabilityGrantHash,
    contextInputHash: attestation.contextInputHash,
    createdAt: identity.createdAt,
  };
}

export async function prepareGeneralWorkerRuntime(input: {
  transport: GeneralWorkerRpcTransport;
  plan: GeneralAgentSessionPlanV1;
  timeoutMs: number;
  executionIdentity: GeneralWorkerExecutionIdentity;
  persistExecutionSnapshot(snapshot: TaskExecutionSnapshot): Promise<void>;
  requestPermissionDecision(request: AgentPermissionRequest): Promise<AgentPermissionUserDecision>;
  delegate(request: GeneralDelegationRequest): Promise<GeneralDelegationResult>;
  assistantMemoryStore?: AssistantMemoryPersistence;
  libraryPersistence?: LibraryPersistence;
  serverToolHandler?: (request: ServerToolBridgeRequest) => Promise<unknown>;
  onCapabilityActivation?(activation: CapabilityActivation): void;
}): Promise<PreparedGeneralWorkerRuntime> {
  const plan = parseGeneralAgentSessionPlan(JSON.parse(JSON.stringify(input.plan)) as unknown);
  const rpc = new GeneralWorkerRpcClient(input.transport, input.timeoutMs, input.requestPermissionDecision, input.delegate, input.assistantMemoryStore, input.libraryPersistence, input.serverToolHandler, input.onCapabilityActivation);
  try {
    const prepared = parsePreparedResult(await rpc.request("prepare", { plan }), plan);
    const attestation = prepared.attestation;
    rpc.state = prepared.state;
    const executionSnapshot = buildExecutionSnapshot(plan, attestation, input.executionIdentity);
    await input.persistExecutionSnapshot(executionSnapshot);
    await rpc.request("activate", { executionSnapshot });
    let streaming = false;
    const session: AgentRuntimeSession = {
    sessionId: attestation.sessionId,
    sessionFile: attestation.sessionFile ?? undefined,
    systemPrompt: prepared.systemPrompt,
    get isStreaming() { return streaming; },
    subscribe: (listener) => rpc.subscribe(listener),
    prompt: async (text, options) => {
      streaming = true;
      try {
        await rpc.request("prompt", { text, images: options?.images });
      } finally {
        streaming = false;
      }
    },
    waitForIdle: async () => { await rpc.request("wait_for_idle", {}); },
    steer: async (text) => { await rpc.request("steer", { text }); },
    followUp: async (text) => { await rpc.request("follow_up", { text }); },
    clearQueue: () => {
      const current = { steering: [...rpc.state.steering], followUp: [...rpc.state.followUp] };
      void rpc.request("clear_queue", {}).catch((error) => {
        process.stderr.write(`General worker clear-queue RPC failed: ${publicError(error).message}\n`);
      });
      rpc.state = { ...rpc.state, steering: [], followUp: [] };
      return current;
    },
    getSteeringMessages: () => rpc.state.steering,
    getFollowUpMessages: () => rpc.state.followUp,
    compact: (request) => rpc.request("compact", { request }),
    abort: async () => { await rpc.request("abort", {}); },
    leafEntryId: () => rpc.state.leafEntryId ?? undefined,
    hasEntry: (entryId) => rpc.state.leafEntryId === entryId,
    };
    const sessionWithIdentity = (identity: { sessionId: string; sessionFile: string | null; leafEntryId: string | null }): AgentRuntimeSession => ({
      sessionId: identity.sessionId,
      sessionFile: identity.sessionFile ?? undefined,
      systemPrompt: session.systemPrompt,
      get isStreaming() { return session.isStreaming; },
      subscribe: (listener) => session.subscribe(listener),
      prompt: (text, options) => session.prompt(text, options),
      waitForIdle: () => session.waitForIdle(),
      steer: (text) => session.steer(text),
      followUp: (text) => session.followUp(text),
      clearQueue: () => session.clearQueue(),
      getSteeringMessages: () => session.getSteeringMessages(),
      getFollowUpMessages: () => session.getFollowUpMessages(),
      compact: (request) => session.compact(request),
      abort: () => session.abort(),
      leafEntryId: () => identity.leafEntryId ?? undefined,
      hasEntry: (entryId) => identity.leafEntryId === entryId,
    });
    return {
      session,
      runtimeVersion: attestation.runtimeVersion,
      access: prepared.access,
      resources: prepared.resources,
      attestation,
      executionSnapshot,
      fork: async (entryId, options) => {
        const result = object(await rpc.request("fork", { entryId, position: options?.position ?? "at" }), "General worker fork result");
        exact(result, ["cancelled", "sessionId", "sessionFile", "leafEntryId", "state"], "General worker fork result");
        if (typeof result.cancelled !== "boolean") throw new Error("General worker fork result.cancelled is invalid.");
        const sessionId = nonEmptyString(result.sessionId, "General worker fork result.sessionId");
        if (result.sessionFile !== null && typeof result.sessionFile !== "string") throw new Error("General worker fork result.sessionFile is invalid.");
        if (result.leafEntryId !== null && typeof result.leafEntryId !== "string") throw new Error("General worker fork result.leafEntryId is invalid.");
        return {
          cancelled: result.cancelled,
          session: sessionWithIdentity({
            sessionId,
            sessionFile: result.sessionFile as string | null,
            leafEntryId: result.leafEntryId as string | null,
          }),
        };
      },
      dispose: async () => {
        try {
          await rpc.request("dispose", {});
        } finally {
          rpc.dispose();
          input.transport.close("General worker Session disposed.");
        }
      },
    };
  } catch (error) {
    rpc.dispose();
    input.transport.close("General worker preparation failed.");
    throw error;
  }
}

/* ---------- server_tool bridge(host 校验并执行的宿主工具) ---------- */

const SERVER_TOOL_NAMES = ["agent_plan_update", "agent_present"] as const;

export type ServerToolBridgeRequest = { tool: (typeof SERVER_TOOL_NAMES)[number]; payload: unknown };

export function parseServerToolRequest(value: unknown): ServerToolBridgeRequest {
  const row = object(value, "General worker server tool request");
  exact(row, ["tool", "payload"], "General worker server tool request");
  const tool = nonEmptyString(row.tool, "General worker server tool request.tool");
  if (!(SERVER_TOOL_NAMES as readonly string[]).includes(tool)) {
    throw new Error(`General worker server tool is not registered: ${tool}.`);
  }
  return { tool: tool as ServerToolBridgeRequest["tool"], payload: row.payload };
}
