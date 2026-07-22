/**
 * Pure event-reduction for the ephemeral live reply painted while a turn
 * streams. Both the standalone transport and the project Task stream feed the
 * same wire shapes, so one reducer serves both paths.
 *
 * Policy: hidden reasoning never enters renderer state. Pi sends only a
 * content-free signal that private reasoning started; the UI may present that
 * status and elapsed time while canonical Activity shows reviewable work.
 */

export type LiveReplyStatus = "streaming" | "complete" | "failed";

export interface LiveReplyState {
  startedAt: string;
  runId?: string;
  text: string;
  thinking: boolean;
  status: LiveReplyStatus;
  error?: string;
}

/** Wire payload the reducer understands; unknown types pass through unchanged. */
export interface LiveStreamEvent {
  type?: string;
  runId?: string;
  /** Project Task streams call the canonical Run id `turnId`. */
  turnId?: string;
  text?: string;
  errorMessage?: string;
}

function eventRunId(event: LiveStreamEvent): string | undefined {
  return event.runId ?? event.turnId;
}

function freshState(now: () => string, event: LiveStreamEvent): LiveReplyState {
  const runId = eventRunId(event);
  return {
    startedAt: now(),
    ...(runId ? { runId } : {}),
    text: "",
    thinking: false,
    status: "streaming",
  };
}

function withRunIdentity(state: LiveReplyState, event: LiveStreamEvent): LiveReplyState {
  const runId = eventRunId(event);
  return !state.runId && runId ? { ...state, runId } : state;
}

export function reduceLiveStreamEvent(
  state: LiveReplyState | null,
  event: LiveStreamEvent,
  now: () => string = () => new Date().toISOString(),
): LiveReplyState | null {
  if (!event || typeof event !== "object") return state;
  switch (event.type) {
    case "turn_start":
      return freshState(now, event);
    case "assistant_delta":
      if (!event.text) return state;
      if (state && state.status !== "streaming") return state;
      return { ...withRunIdentity(state ?? freshState(now, event), event), text: `${state?.text ?? ""}${event.text}`, status: "streaming" };
    case "assistant_thinking_started":
      if (state && state.status !== "streaming") return state;
      return { ...withRunIdentity(state ?? freshState(now, event), event), thinking: true, status: "streaming" };
    case "assistant_final":
    case "done":
      return state?.status === "streaming" ? { ...state, status: "complete" } : state;
    case "stopped":
      return state?.status === "streaming" ? { ...state, status: "failed", error: event.text ?? "Agent run stopped." } : state;
    case "error":
      if (state && state.status !== "streaming") return state;
      return {
        ...withRunIdentity(state ?? freshState(now, event), event),
        status: "failed",
        error: event.errorMessage ?? event.text ?? "Agent 回复中断。",
      };
    default:
      return state;
  }
}

export function liveReplyMatchesDurableActivity(
  reply: LiveReplyState,
  activity: { runId: string; agentThreadId: string; createdAt: string },
  rootAgentThreadId?: string,
): boolean {
  if (activity.createdAt < reply.startedAt) return false;
  if (reply.runId && activity.runId !== reply.runId) return false;
  if (rootAgentThreadId && activity.agentThreadId !== rootAgentThreadId) return false;
  return true;
}
