export type SessionDeleteTarget =
  | { kind: 'chat-conversation'; id: string }
  | { kind: 'agent-session'; id: string }
  | { kind: 'linguist-session'; id: string; projectId: string }

interface SessionDeleteActions {
  deleteChatConversation: (id: string) => Promise<unknown>
  deleteAgentSession: (id: string) => Promise<unknown>
}

export function deleteSessionTarget(
  target: SessionDeleteTarget,
  actions: SessionDeleteActions,
): Promise<unknown> {
  return target.kind === 'chat-conversation'
    ? actions.deleteChatConversation(target.id)
    : actions.deleteAgentSession(target.id)
}
