export const AGENT_MESSAGE_WINDOW_SIZE = 120

export interface AgentMessageWindow {
  start: number
  end: number
  total: number
}

export function createInitialAgentMessageWindow(total: number): AgentMessageWindow {
  return {
    start: Math.max(0, total - AGENT_MESSAGE_WINDOW_SIZE),
    end: total,
    total,
  }
}

export function createTargetAgentMessageWindow(index: number, total: number): AgentMessageWindow {
  const half = Math.floor(AGENT_MESSAGE_WINDOW_SIZE / 2)
  const end = Math.min(total, Math.max(AGENT_MESSAGE_WINDOW_SIZE, index + half))
  return {
    start: Math.max(0, end - AGENT_MESSAGE_WINDOW_SIZE),
    end,
    total,
  }
}

export function expandAgentMessageWindow(
  window: AgentMessageWindow,
  direction: 'older' | 'newer',
): AgentMessageWindow {
  return direction === 'older'
    ? { ...window, start: Math.max(0, window.start - AGENT_MESSAGE_WINDOW_SIZE) }
    : { ...window, end: Math.min(window.total, window.end + AGENT_MESSAGE_WINDOW_SIZE) }
}

export function syncAgentMessageWindow(
  window: AgentMessageWindow,
  total: number,
): AgentMessageWindow {
  if ((window.total === 0 && total > 0) || total < window.total) {
    return createInitialAgentMessageWindow(total)
  }
  if (window.end === window.total) {
    return { start: Math.min(window.start, total), end: total, total }
  }
  return {
    start: Math.min(window.start, total),
    end: Math.min(window.end, total),
    total,
  }
}
