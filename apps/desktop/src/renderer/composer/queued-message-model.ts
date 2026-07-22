export function moveQueuedMessage(messageIds: string[], activeId: string, overId: string): string[] {
  const from = messageIds.indexOf(activeId);
  const to = messageIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return messageIds;
  const next = [...messageIds];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
