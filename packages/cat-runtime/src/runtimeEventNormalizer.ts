export type AgentRuntimeEvent =
  | { type: "lifecycle"; phase: string; willRetry?: boolean }
  | { type: "message.delta"; channel: "text" | "thinking"; delta: string }
  | { type: "message.completed"; message: unknown }
  | { type: "tool.started"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool.updated"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool.completed"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "queue.changed"; steering: string[]; followUp: string[] }
  | { type: "compaction.started"; reason: string }
  | {
      type: "compaction.completed";
      reason: string;
      tokensBefore?: number;
      estimatedTokensAfter?: number;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | { type: "retry.started"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "retry.completed"; success: boolean; attempt: number; finalError?: string }
  | { type: "attempt.failed"; errorMessage: string; willRetry: true }
  | { type: "run.failed"; errorMessage: string }
  | {
      type: "runtime.diagnostic";
      code: "UNMAPPED_NATIVE_EVENT" | "INVALID_NATIVE_EVENT";
      nativeType: string;
      message: string;
    };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function nativeType(value: unknown): string {
  const type = record(value)?.type;
  return typeof type === "string" && type ? type : "<missing>";
}

function invalid(type: string, field: string): AgentRuntimeEvent {
  return {
    type: "runtime.diagnostic",
    code: "INVALID_NATIVE_EVENT",
    nativeType: type,
    message: `Pi runtime event ${type} has an invalid ${field}.`,
  };
}

function stringField(row: UnknownRecord, field: string): string | undefined {
  const value = row[field];
  return typeof value === "string" ? value : undefined;
}

function numberField(row: UnknownRecord, field: string): number | undefined {
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(row: UnknownRecord, field: string): boolean | undefined {
  const value = row[field];
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayField(row: UnknownRecord, field: string): string[] | undefined {
  const value = row[field];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : undefined;
}

export function normalizePiRuntimeEvent(value: unknown): AgentRuntimeEvent {
  const row = record(value);
  const type = nativeType(value);
  if (!row) return invalid(type, "event envelope");

  if (["agent_start", "agent_settled", "turn_start", "message_start", "entry_appended", "session_info_changed", "thinking_level_changed"].includes(type)) {
    return { type: "lifecycle", phase: type };
  }
  if (type === "agent_end") {
    const willRetry = booleanField(row, "willRetry");
    return willRetry === undefined ? invalid(type, "willRetry") : { type: "lifecycle", phase: type, willRetry };
  }
  if (type === "turn_end") return { type: "lifecycle", phase: type };

  if (type === "message_update") {
    const update = record(row.assistantMessageEvent);
    const updateType = update ? stringField(update, "type") : undefined;
    if (updateType !== "text_delta" && updateType !== "thinking_delta") {
      return { type: "lifecycle", phase: updateType ? `message_update.${updateType}` : "message_update" };
    }
    if (!update) return invalid(type, "assistantMessageEvent");
    const delta = stringField(update, "delta");
    if (delta === undefined) return invalid(type, "assistantMessageEvent.delta");
    return { type: "message.delta", channel: updateType === "text_delta" ? "text" : "thinking", delta };
  }
  if (type === "message_end") {
    if (!("message" in row)) return invalid(type, "message");
    return { type: "message.completed", message: row.message };
  }

  if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end") {
    const toolCallId = stringField(row, "toolCallId");
    if (!toolCallId) return invalid(type, "toolCallId");
    const toolName = stringField(row, "toolName");
    if (!toolName) return invalid(type, "toolName");
    if (type === "tool_execution_start") return { type: "tool.started", toolCallId, toolName, args: row.args };
    if (type === "tool_execution_update") return { type: "tool.updated", toolCallId, toolName, args: row.args, partialResult: row.partialResult };
    const isError = booleanField(row, "isError");
    return isError === undefined
      ? invalid(type, "isError")
      : { type: "tool.completed", toolCallId, toolName, result: row.result, isError };
  }

  if (type === "queue_update") {
    const steering = stringArrayField(row, "steering");
    if (!steering) return invalid(type, "steering");
    const followUp = stringArrayField(row, "followUp");
    if (!followUp) return invalid(type, "followUp");
    return { type: "queue.changed", steering, followUp };
  }
  if (type === "compaction_start") {
    const reason = stringField(row, "reason");
    return reason === undefined ? invalid(type, "reason") : { type: "compaction.started", reason };
  }
  if (type === "compaction_end") {
    const reason = stringField(row, "reason");
    if (reason === undefined) return invalid(type, "reason");
    const aborted = booleanField(row, "aborted");
    if (aborted === undefined) return invalid(type, "aborted");
    const willRetry = booleanField(row, "willRetry");
    if (willRetry === undefined) return invalid(type, "willRetry");
    const result = record(row.result);
    const tokensBefore = result ? numberField(result, "tokensBefore") : undefined;
    const estimatedTokensAfter = result ? numberField(result, "estimatedTokensAfter") : undefined;
    const errorMessage = stringField(row, "errorMessage");
    return {
      type: "compaction.completed",
      reason,
      ...(tokensBefore === undefined ? {} : { tokensBefore }),
      ...(estimatedTokensAfter === undefined ? {} : { estimatedTokensAfter }),
      aborted,
      willRetry,
      ...(errorMessage === undefined ? {} : { errorMessage }),
    };
  }
  if (type === "auto_retry_start") {
    const attempt = numberField(row, "attempt");
    if (attempt === undefined) return invalid(type, "attempt");
    const maxAttempts = numberField(row, "maxAttempts");
    if (maxAttempts === undefined) return invalid(type, "maxAttempts");
    const delayMs = numberField(row, "delayMs");
    if (delayMs === undefined) return invalid(type, "delayMs");
    const errorMessage = stringField(row, "errorMessage");
    if (errorMessage === undefined) return invalid(type, "errorMessage");
    return { type: "retry.started", attempt, maxAttempts, delayMs, errorMessage };
  }
  if (type === "auto_retry_end") {
    const success = booleanField(row, "success");
    if (success === undefined) return invalid(type, "success");
    const attempt = numberField(row, "attempt");
    if (attempt === undefined) return invalid(type, "attempt");
    const finalError = stringField(row, "finalError");
    return { type: "retry.completed", success, attempt, ...(finalError === undefined ? {} : { finalError }) };
  }

  return {
    type: "runtime.diagnostic",
    code: "UNMAPPED_NATIVE_EVENT",
    nativeType: type,
    message: `Unmapped Pi runtime event ${type}.`,
  };
}
