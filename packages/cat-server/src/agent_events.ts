import { randomUUID } from "node:crypto";
import { sensitivePreview } from "@linguist-agent/cat-runtime";

export const AGENT_EVENT_SCHEMA_VERSION = 1 as const;

export type AgentTraceKind =
  | "turn_start"
  | "tool_start"
  | "tool_end"
  | "compaction_start"
  | "compaction_end"
  | "retry_start"
  | "retry_end"
  | "stream_rule_violation"
  | "sandbox_denied"
  | "assistant_thinking_started"
  | "assistant_final"
  | "error";

export interface AgentTraceEvent {
  version: typeof AGENT_EVENT_SCHEMA_VERSION;
  eventId: string;
  turnId: string;
  seq: number;
  ts: string;
  projectId: string;
  sessionId?: string;
  sessionFile?: string;
  kind: AgentTraceKind;
  piEventType?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  text?: string;
  argsPreview?: string;
  resultPreview?: string;
  errorMessage?: string;
  validationWarnings?: string[];
  validationErrors?: string[];
  reason?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  firstKeptEntryId?: string;
  aborted?: boolean;
  willRetry?: boolean;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retrySuccess?: boolean;
  recoveryKind?: string;
  recoveryAction?: string;
  recoveryRetryable?: boolean;
  ruleCode?: string;
  ruleSeverity?: "warning" | "blocker";
  ruleAction?: "observe_only" | "abort_and_retry";
  ruleMatch?: string;
  ruleOffset?: number;
  requestShapeHash?: string;
  systemPromptHash?: string;
  toolSurfaceHash?: string;
  resourceIndexHash?: string;
  systemPromptChars?: number;
  activeToolCount?: number;
  resourceCount?: number;
}

export interface AgentTraceBuilderOptions {
  projectId: string;
  sessionId?: string;
  sessionFile?: string;
  turnId?: string;
  now?: () => string;
}

export interface AgentTraceEventInput {
  piEventType?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  text?: string;
  argsPreview?: string;
  resultPreview?: string;
  errorMessage?: string;
  validationWarnings?: string[];
  validationErrors?: string[];
  reason?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
  firstKeptEntryId?: string;
  aborted?: boolean;
  willRetry?: boolean;
  retryAttempt?: number;
  retryMaxAttempts?: number;
  retrySuccess?: boolean;
  recoveryKind?: string;
  recoveryAction?: string;
  recoveryRetryable?: boolean;
  ruleCode?: string;
  ruleSeverity?: "warning" | "blocker";
  ruleAction?: "observe_only" | "abort_and_retry";
  ruleMatch?: string;
  ruleOffset?: number;
  requestShapeHash?: string;
  systemPromptHash?: string;
  toolSurfaceHash?: string;
  resourceIndexHash?: string;
  systemPromptChars?: number;
  activeToolCount?: number;
  resourceCount?: number;
}

export function previewValue(value: unknown, maxChars = 800): string {
  return sensitivePreview(value, maxChars);
}

export class AgentTraceBuilder {
  readonly turnId: string;
  private seq = 0;
  private readonly now: () => string;
  private readonly base: Pick<AgentTraceEvent, "projectId" | "sessionId" | "sessionFile">;

  constructor(options: AgentTraceBuilderOptions) {
    this.turnId = options.turnId ?? `turn_${randomUUID()}`;
    this.now = options.now ?? (() => new Date().toISOString());
    this.base = {
      projectId: options.projectId,
      sessionId: options.sessionId,
      sessionFile: options.sessionFile,
    };
  }

  event(kind: AgentTraceKind, input: AgentTraceEventInput = {}): AgentTraceEvent {
    this.seq += 1;
    const safeInput = {
      ...input,
      ...(input.argsPreview === undefined ? {} : { argsPreview: previewValue(input.argsPreview) }),
      ...(input.resultPreview === undefined ? {} : { resultPreview: previewValue(input.resultPreview) }),
      ...(input.errorMessage === undefined ? {} : { errorMessage: previewValue(input.errorMessage) }),
    };
    return {
      version: AGENT_EVENT_SCHEMA_VERSION,
      eventId: `${this.turnId}:${String(this.seq).padStart(4, "0")}`,
      turnId: this.turnId,
      seq: this.seq,
      ts: this.now(),
      ...this.base,
      kind,
      ...safeInput,
    };
  }
}
