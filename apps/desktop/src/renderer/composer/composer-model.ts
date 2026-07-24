export const COMPOSER_SINGLE_LINE_TEXT_BUFFER_PX = 32;

export type ComposerLayoutLock = "single-line" | "multiline" | null;

export interface ComposerLayoutMetrics {
  availableInputWidth: number | null;
  measuredTextWidth: number;
  hasLineBreak: boolean;
  hasVisibleAttachments?: boolean;
  isVoiceActive?: boolean;
  lockedLayout?: ComposerLayoutLock;
}

/**
 * Match the source composer grammar: one line only while the text and every
 * active control fit. Attachments, voice, and explicit line breaks always
 * preserve the multiline surface rather than clipping content.
 */
export function shouldUseSingleLineComposer({
  availableInputWidth,
  measuredTextWidth,
  hasLineBreak,
  hasVisibleAttachments = false,
  isVoiceActive = false,
  lockedLayout = null,
}: ComposerLayoutMetrics): boolean {
  if (lockedLayout) return lockedLayout === "single-line";
  if (hasVisibleAttachments || isVoiceActive || hasLineBreak) return false;
  if (availableInputWidth === null) return true;
  return measuredTextWidth + COMPOSER_SINGLE_LINE_TEXT_BUFFER_PX <= availableInputWidth;
}

export type AgentComposerContext = "batch-intent" | "task";
export type AgentComposerRunStatus =
  | "pending"
  | "active"
  | "awaiting_input"
  | "waiting"
  | "stopping"
  | "stopped"
  | "failed"
  | "stale"
  | "complete"
  | null;
export type AgentComposerAction = "send" | "sending" | "steer" | "follow_up" | "stop" | "stopping";

/**
 * Run actions are driven exclusively by the server-projected activeRunId.
 * Historical Runs may retain metadata such as stopAvailable while a snapshot
 * is reconnecting, but must never become a locally inferred active authority.
 */
export function selectCanonicalActiveRun<Run extends { id: string }>(
  activeRunId: string | null | undefined,
  runs: readonly Run[],
): Run | null {
  if (!activeRunId) return null;
  return runs.find((run) => run.id === activeRunId) ?? null;
}

/** Codex spec 03 §2:提交键 tooltip 四态 Send / Stop / Queue / Steer(+本地瞬态)。 */
export type AgentComposerSendState = "send" | "sending" | "stop" | "stopping" | "queue" | "steer";

export interface AgentComposerSendButton {
  state: AgentComposerSendState;
  tooltip: string;
}

/**
 * 单按钮状态机：闲置时发送，运行中在有草稿时默认立即调整。排队动作是
 * 一个键盘变体，不再把投递模式做成常驻的两段式开关。
 */
export function deriveAgentComposerSendButton(action: AgentComposerAction): AgentComposerSendButton {
  switch (action) {
    case "stop":
      return { state: "stop", tooltip: "停止当前 Run (Esc)" };
    case "stopping":
      return { state: "stopping", tooltip: "正在停止…" };
    case "sending":
      return { state: "sending", tooltip: "正在发送…" };
    case "follow_up":
      return { state: "queue", tooltip: "完成后执行 (⌥⌘↩)" };
    case "steer":
      return { state: "steer", tooltip: "立即调整 (⌘↩)" };
    default:
      return { state: "send", tooltip: "发送 (⌘↩)" };
  }
}

export interface AgentComposerPresentationInput {
  context: AgentComposerContext;
  hasHistory?: boolean;
  /** A projectless Chat should speak in Chat language, never in CAT Task jargon. */
  isStandalone?: boolean;
  focusedSegmentId?: string | null;
  recipientName?: string | null;
  runStatus?: AgentComposerRunStatus;
  stopAvailable?: boolean;
  /** 有草稿时，运行中的主发送按钮默认承担立即调整。 */
  hasDraft?: boolean;
  activeDelivery?: "steer" | "follow_up" | null;
  isSending?: boolean;
  isStopping?: boolean;
}

export interface AgentComposerPresentation {
  action: AgentComposerAction;
  canSend: boolean;
  hint: string;
  layoutLock: ComposerLayoutLock;
  placeholder: string;
  sendButton: AgentComposerSendButton;
}

/**
 * One semantic state model drives both the first Batch turn and subsequent
 * Task turns. Standalone and Project Main Runs expose the same Pi
 * steer/follow-up delivery; Project scope only adds domain authority.
 */
export function deriveAgentComposerPresentation({
  context,
  hasHistory = false,
  isStandalone = false,
  focusedSegmentId = null,
  recipientName = null,
  runStatus = null,
  stopAvailable = false,
  hasDraft = false,
  activeDelivery = null,
  isSending = false,
  isStopping = false,
}: AgentComposerPresentationInput): AgentComposerPresentation {
  if (context === "batch-intent") {
    const action: AgentComposerAction = isSending ? "sending" : "send";
    return {
      action,
      canSend: !isSending,
      hint: isSending ? "正在创建 Task…" : "发送后创建 Task",
      layoutLock: "multiline",
      placeholder: "描述需要完成的工作…",
      sendButton: deriveAgentComposerSendButton(action),
    };
  }

  const runIsStopping = isStopping || runStatus === "stopping";
  const runIsActive = runStatus === "active" || runStatus === "pending";
  const action: AgentComposerAction = runIsStopping
    ? "stopping"
    : runIsActive && hasDraft && activeDelivery
      ? activeDelivery
    : runIsActive && stopAvailable
      ? "stop"
      : isSending
        ? "sending"
      : runIsActive
        ? "sending"
        : "send";

  const placeholder = runIsStopping
    ? "Run 正在停止，草稿会保留…"
    : action === "steer"
      ? "补充要求或方向…"
    : action === "follow_up"
        ? "安排当前 Run 完成后的下一步…"
        : runIsActive
          ? "补充要求或方向…"
      : recipientName
        ? `给 ${recipientName} 留言…`
          : focusedSegmentId
            ? "说明这一句要如何处理…"
          : "输入消息…";

  const hint = action === "steer"
    ? "⌘↩ 立即调整 · ⌥⌘↩ 完成后执行 · Esc 停止"
    : action === "follow_up"
      ? "⌥⌘↩ 完成后执行 · Esc 停止"
      : action === "stop"
    ? "Esc 停止 · 草稿会保留"
    : action === "stopping"
      ? "正在停止…"
      : action === "sending"
        ? "当前 Run 正在处理…"
        : recipientName
          ? "⌘↩ 发送 · Esc 取消目标"
          : "⌘↩ 发送";

  return {
    action,
    canSend: action === "send" || action === "steer" || action === "follow_up",
    hint,
    // A first turn is a deliberate prompt surface, not a responsive side
    // effect of the placeholder's length. Keep its multiline geometry while
    // the user types so a short first sentence cannot collapse the Composer.
    layoutLock: hasHistory ? null : "multiline",
    placeholder,
    sendButton: deriveAgentComposerSendButton(action),
  };
}

export function formatRunElapsed(startedAt?: string | null, endedAt?: string | null, now = Date.now()): string | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.floor((end - start) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}
