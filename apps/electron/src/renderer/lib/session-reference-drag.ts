/**
 * 左侧 Agent 会话行拖入输入框时使用的内部拖放协议。
 * 自定义 MIME 用于可靠识别来源，text/plain 仅作为宿主兼容兜底。
 */

export const SESSION_REFERENCE_DRAG_MIME = 'application/x-proma-session-reference'

export interface SessionReferenceDragItem {
  sessionId: string
  title: string
}

export function setSessionReferenceDragData(
  dataTransfer: DataTransfer,
  item: SessionReferenceDragItem,
): void {
  dataTransfer.setData(SESSION_REFERENCE_DRAG_MIME, JSON.stringify(item))
  dataTransfer.setData(
    'text/plain',
    `&session:${item.sessionId}::${encodeURIComponent(item.title)}`,
  )
  dataTransfer.effectAllowed = 'copy'
}

export function getSessionReferenceDragData(
  dataTransfer: DataTransfer,
): SessionReferenceDragItem | null {
  const raw = dataTransfer.getData(SESSION_REFERENCE_DRAG_MIME)
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const item = parsed as Partial<SessionReferenceDragItem>
    return typeof item.sessionId === 'string'
      && item.sessionId.trim().length > 0
      && typeof item.title === 'string'
      && item.title.trim().length > 0
      ? { sessionId: item.sessionId, title: item.title }
      : null
  } catch {
    return null
  }
}

/**
 * 侧栏三点菜单「引用此会话」触发的事件名，与拖拽走不同入口但复用同一份 mention 插入逻辑。
 * detail 携带目标会话 id（当前主视图打开的 Agent 会话）与被引用的会话信息；
 * 由持有 RichTextInput ref 的 AgentView 监听后回写 inserted，调用方据此决定是否提示用户。
 */
export const INSERT_SESSION_REFERENCE_MENTION_EVENT = 'proma:insert-session-reference-mention'

export interface InsertSessionReferenceMentionDetail {
  targetSessionId: string
  item: SessionReferenceDragItem
  inserted: boolean
}

export function insertSessionReferenceMention(
  targetSessionId: string,
  item: SessionReferenceDragItem,
): boolean {
  const detail: InsertSessionReferenceMentionDetail = { targetSessionId, item, inserted: false }
  window.dispatchEvent(
    new CustomEvent<InsertSessionReferenceMentionDetail>(INSERT_SESSION_REFERENCE_MENTION_EVENT, { detail }),
  )
  return detail.inserted
}
