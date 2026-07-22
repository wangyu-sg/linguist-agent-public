export type CatRecoveryKind =
  | "prompt_too_long"
  | "output_cutoff"
  | "timeout_reconnect"
  | "retryable_provider"
  | "tool_failure"
  | "unknown";

export type CatRecoveryAction =
  | "compact_and_retry_once"
  | "continue_generation"
  | "reconnect_and_retry"
  | "pi_provider_retry"
  | "surface_tool_failure"
  | "surface_error";

export interface CatRuntimeRecoverySignal {
  kind: CatRecoveryKind;
  action: CatRecoveryAction;
  retryable: boolean;
  reason: string;
  correctiveInstruction: string;
}

export interface CatRuntimeRecoveryInput {
  message?: string;
  toolName?: string;
  validationErrors?: string[];
  isToolError?: boolean;
}

function textFrom(input: CatRuntimeRecoveryInput): string {
  return [input.message, ...(input.validationErrors ?? [])].filter(Boolean).join("\n");
}

export function classifyCatRuntimeRecovery(input: CatRuntimeRecoveryInput): CatRuntimeRecoverySignal {
  const text = textFrom(input);
  if (/\b(context_length_exceeded|prompt too long|maximum context|context window|too many tokens)\b/i.test(text)) {
    return {
      kind: "prompt_too_long",
      action: "compact_and_retry_once",
      retryable: true,
      reason: "Prompt exceeded the available context window.",
      correctiveInstruction:
        "Run Pi native compaction with CAT-critical reinjection, then retry the same user request once with a shorter operational answer.",
    };
  }
  if (/\b(output cutoff|max(?:imum)? output|finish_reason[=: ]length|response truncated|incomplete output)\b/i.test(text)) {
    return {
      kind: "output_cutoff",
      action: "continue_generation",
      retryable: true,
      reason: "Provider output appears truncated before the answer completed.",
      correctiveInstruction:
        "Continue from the previous answer boundary without repeating prior text, and keep evidence/proposal state intact.",
    };
  }
  if (/\b(ETIMEDOUT|ECONNRESET|EPIPE|network timeout|socket hang up|websocket|reconnect|connection closed)\b/i.test(text)) {
    return {
      kind: "timeout_reconnect",
      action: "reconnect_and_retry",
      retryable: true,
      reason: "Runtime/provider connection was interrupted.",
      correctiveInstruction:
        "Reconnect or recreate the Pi session surface if needed, then retry once with trace-visible recovery state.",
    };
  }
  if (/\b(429|rate limit|temporar(?:y|ily)|overloaded|503|502|504|try again|retryable)\b/i.test(text)) {
    return {
      kind: "retryable_provider",
      action: "pi_provider_retry",
      retryable: true,
      reason: "Provider reported a retryable transient failure.",
      correctiveInstruction:
        "Use Pi retry settings and emit retry trace state; do not add a second provider retry loop in LA.",
    };
  }
  if (input.isToolError || input.validationErrors?.length) {
    return {
      kind: "tool_failure",
      action: "surface_tool_failure",
      retryable: false,
      reason: `Tool ${input.toolName ?? "unknown"} failed or returned invalid CAT output.`,
      correctiveInstruction:
        "Surface the tool failure with validation details. Do not silently continue with uncited or fallback CAT evidence.",
    };
  }
  return {
    kind: "unknown",
    action: "surface_error",
    retryable: false,
    reason: text || "Unknown runtime failure.",
    correctiveInstruction: "Surface the failure and ask for explicit user direction if no safe retry path is available.",
  };
}

export type CatSelfHealingRetryEventType =
  | "self_healing_compaction_retry"
  | "self_healing_continuation_retry"
  | "self_healing_transient_retry";

export interface CatSelfHealingRetryPlan {
  piEventType: CatSelfHealingRetryEventType;
  /** Compact the session before retrying (prompt_too_long only). */
  compactFirst: boolean;
  /** Backoff before retrying (transient connection/provider classes). */
  delayMs: number;
  /** Keep streamed text and stream-rule state across the retry (output continuation). */
  preserveStreamState: boolean;
  /** Prompt block appended to the base prompt for the retry attempt. */
  promptSuffix: string;
}

export interface CatSelfHealingRetryState {
  used: Array<{ kind: CatRecoveryKind; action: CatRecoveryAction }>;
  compactedThisTurn: boolean;
}

export function createCatSelfHealingRetryState(): CatSelfHealingRetryState {
  return { used: [], compactedThisTurn: false };
}

export function markCatSelfHealingCompacted(state: CatSelfHealingRetryState): void {
  state.compactedThisTurn = true;
}

function retryPromptSuffix(recovery: CatRuntimeRecoverySignal): string {
  return ["", "Runtime self-healing recovery:", recovery.correctiveInstruction].join("\n");
}

/**
 * One-shot retry budget per recovery class, shared by all agent loops so they
 * enact the same policy the runtime-health report declares. Each enacted class
 * is recorded in `state.used` (callers emit matching retry_end trace events);
 * a repeat failure of an already-used class returns undefined and the error
 * must surface. The two transient classes share a single budget because
 * Pi-level auto-retry already ran before the loop sees the failure.
 */
export function planCatSelfHealingRetry(
  recovery: CatRuntimeRecoverySignal,
  state: CatSelfHealingRetryState,
): CatSelfHealingRetryPlan | undefined {
  const alreadyUsed = (kind: CatRecoveryKind): boolean => state.used.some((entry) => entry.kind === kind);
  if (recovery.kind === "prompt_too_long") {
    if (alreadyUsed("prompt_too_long")) return undefined;
    state.used.push({ kind: recovery.kind, action: recovery.action });
    return {
      piEventType: "self_healing_compaction_retry",
      compactFirst: !state.compactedThisTurn,
      delayMs: 0,
      preserveStreamState: false,
      promptSuffix: retryPromptSuffix(recovery),
    };
  }
  if (recovery.kind === "output_cutoff") {
    if (alreadyUsed("output_cutoff")) return undefined;
    state.used.push({ kind: recovery.kind, action: recovery.action });
    return {
      piEventType: "self_healing_continuation_retry",
      compactFirst: false,
      delayMs: 0,
      preserveStreamState: true,
      promptSuffix: retryPromptSuffix(recovery),
    };
  }
  if (recovery.kind === "timeout_reconnect" || recovery.kind === "retryable_provider") {
    if (alreadyUsed("timeout_reconnect") || alreadyUsed("retryable_provider")) return undefined;
    state.used.push({ kind: recovery.kind, action: recovery.action });
    return {
      piEventType: "self_healing_transient_retry",
      compactFirst: false,
      delayMs: 2000,
      preserveStreamState: false,
      promptSuffix: retryPromptSuffix(recovery),
    };
  }
  return undefined;
}
