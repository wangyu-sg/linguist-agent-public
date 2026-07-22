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

/** Codex spec 03 §2:提交键 tooltip 四态 Send / Stop / Queue / Steer(+本地瞬态)。 */
export type AgentComposerSendState = "send" | "sending" | "stop" | "stopping" | "queue" | "steer";

export interface AgentComposerSendButton {
  state: AgentComposerSendState;
  tooltip: string;
  /** spec 03 §3:stop 态按钮内嵌 Esc kbd 提示。 */
  kbd: "Esc" | null;
}

/**
 * 单按钮状态机:idle→Send;streaming→Stop(内嵌 Esc kbd);streaming+queue 模式→Queue;
 * streaming+steer 模式→Steer。本地 follow_up/steer action 与 spec 的 Queue/Steer 一一对应。
 */
export function deriveAgentComposerSendButton(action: AgentComposerAction): AgentComposerSendButton {
  switch (action) {
    case "stop":
      return { state: "stop", tooltip: "停止当前 Run(Esc)", kbd: "Esc" };
    case "stopping":
      return { state: "stopping", tooltip: "正在停止…", kbd: null };
    case "sending":
      return { state: "sending", tooltip: "正在发送…", kbd: null };
    case "follow_up":
      return { state: "queue", tooltip: "排队:当前 turn 完成后执行(⌘↩)", kbd: null };
    case "steer":
      return { state: "steer", tooltip: "转向:立即插入当前 turn(⌘↩)", kbd: null };
    default:
      return { state: "send", tooltip: "发送(⌘↩)", kbd: null };
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
  /** Queue/Steer replaces Stop only while the user has a message to submit. */
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
      placeholder: "交代这单的活儿：目标、语气、禁区，越具体越好。",
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
    ? "Run 正在停止；写好的草稿会留住…"
    : action === "steer"
      ? "现在补充方向；消息会进入当前 Pi turn…"
      : action === "follow_up"
        ? "安排下一步；消息会在当前 turn 完成后执行…"
        : runIsActive
          ? "先把话写下；当前 Run 完成后再发送…"
      : recipientName
        ? `追问 ${recipientName}：哪里不对、要怎么改…`
          : focusedSegmentId
            ? "问这一句，或交代要改成什么样…"
          : hasHistory
            ? "接着说：改哪里、盯什么、做到什么程度…"
            : isStandalone
              ? "你想完成什么？"
              : "交代你想做成什么样：审校、翻译，还是查问题…";

  const hint = action === "steer"
    ? "⌘↩ 现在调整 · ⌘. 停止"
    : action === "follow_up"
      ? "⌘↩ 完成后执行 · ⌘. 停止"
      : action === "stop"
    ? "⌘. 停止 · 草稿会保留"
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
