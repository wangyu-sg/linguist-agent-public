export const CONVERSATION_BOTTOM_THRESHOLD_PX = 24;

export interface ConversationScrollerMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function conversationDistanceFromBottom(metrics: ConversationScrollerMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

export function conversationIsAtBottom(metrics: ConversationScrollerMetrics): boolean {
  return conversationDistanceFromBottom(metrics) <= CONVERSATION_BOTTOM_THRESHOLD_PX;
}
