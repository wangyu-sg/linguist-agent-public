import type { AgentRuntimeEvent } from "./runtimeEventNormalizer.js";

export interface RuntimeEventPipeline {
  accept(event: AgentRuntimeEvent): void;
  flush(): void;
  settle(): void;
  cancel(): void;
}

export interface RuntimeEventPipelineOptions {
  emit(event: AgentRuntimeEvent): void;
  flushIntervalMs?: number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

interface PendingFailure {
  errorMessage: string;
}

function assistantFailure(message: unknown): { errorMessage: string; aborted: boolean } | undefined {
  const row = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown } | undefined;
  if (row?.role !== "assistant" || (row.stopReason !== "error" && row.stopReason !== "aborted")) return undefined;
  return {
    errorMessage: typeof row.errorMessage === "string" && row.errorMessage.trim()
      ? row.errorMessage.trim()
      : `Request ${row.stopReason}`,
    aborted: row.stopReason === "aborted",
  };
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
}

/**
 * LA-owned settlement boundary for a Pi session event stream.
 *
 * Text deltas are emitted at most once per timer window. Attempt failures wait
 * for Pi's agent_end retry decision, so a retryable provider error cannot be
 * mistaken for the terminal state of the enclosing Run.
 */
export function createRuntimeEventPipeline(options: RuntimeEventPipelineOptions): RuntimeEventPipeline {
  const schedule = options.schedule ?? defaultSchedule;
  const flushIntervalMs = options.flushIntervalMs ?? 50;
  let pendingDeltas: Array<{ channel: "text" | "thinking"; delta: string }> = [];
  let cancelScheduledFlush: (() => void) | undefined;
  let pendingFailure: PendingFailure | undefined;
  let retryDecision: boolean | undefined;
  let terminalFailureEmitted = false;
  let cancelled = false;

  const emit = (event: AgentRuntimeEvent): void => options.emit(event);

  const flush = (): void => {
    cancelScheduledFlush?.();
    cancelScheduledFlush = undefined;
    const deltas = pendingDeltas;
    pendingDeltas = [];
    for (const entry of deltas) emit({ type: "message.delta", ...entry });
  };

  const queueDelta = (event: Extract<AgentRuntimeEvent, { type: "message.delta" }>): void => {
    const last = pendingDeltas.at(-1);
    if (last?.channel === event.channel) last.delta += event.delta;
    else pendingDeltas.push({ channel: event.channel, delta: event.delta });
    if (!cancelScheduledFlush) {
      cancelScheduledFlush = schedule(() => {
        cancelScheduledFlush = undefined;
        flush();
      }, flushIntervalMs);
    }
  };

  const emitTerminalFailure = (failure: PendingFailure): void => {
    pendingFailure = undefined;
    retryDecision = undefined;
    if (cancelled || terminalFailureEmitted) return;
    flush();
    terminalFailureEmitted = true;
    emit({ type: "run.failed", errorMessage: failure.errorMessage });
  };

  const resolveFailure = (willRetry: boolean): void => {
    const failure = pendingFailure;
    pendingFailure = undefined;
    retryDecision = undefined;
    if (!failure || cancelled) return;
    if (willRetry) {
      emit({ type: "attempt.failed", errorMessage: failure.errorMessage, willRetry: true });
      return;
    }
    emitTerminalFailure(failure);
  };

  return {
    accept(event) {
      if (terminalFailureEmitted && event.type === "run.failed") return;
      if (event.type === "message.delta") {
        queueDelta(event);
        return;
      }
      if (event.type === "message.completed") {
        flush();
        const failure = assistantFailure(event.message);
        if (!failure) {
          retryDecision = undefined;
          emit(event);
          return;
        }
        if (failure.aborted || cancelled) {
          pendingFailure = undefined;
          retryDecision = undefined;
          emit(event);
          return;
        }
        pendingFailure = { errorMessage: failure.errorMessage };
        if (retryDecision !== undefined) resolveFailure(retryDecision);
        return;
      }
      if (event.type === "lifecycle") {
        if (event.phase === "agent_start") retryDecision = undefined;
        if (event.phase === "agent_end" && event.willRetry !== undefined) {
          retryDecision = event.willRetry;
          if (pendingFailure) resolveFailure(event.willRetry);
        }
        if (event.phase === "agent_settled" && pendingFailure) emitTerminalFailure(pendingFailure);
        flush();
        emit(event);
        return;
      }
      flush();
      emit(event);
    },
    flush,
    settle() {
      flush();
      if (pendingFailure) emitTerminalFailure(pendingFailure);
    },
    cancel() {
      cancelled = true;
      pendingFailure = undefined;
      retryDecision = undefined;
      flush();
    },
  };
}
