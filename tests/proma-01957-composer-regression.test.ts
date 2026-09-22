import { expect, test } from 'bun:test'
import { aggregateTaskItems, getTaskProgressCounts } from '../apps/electron/src/renderer/components/agent/task-progress'
import { isLocalFileReference } from '../apps/electron/src/renderer/components/ai-elements/file-path-chip-utils'
import { canReferenceDraggedSession, clearSessionReferenceDragState, getActiveSessionReferenceDragId, getSessionReferenceDragData, setSessionReferenceDragData } from '../apps/electron/src/renderer/lib/session-reference-drag'

test('取消和失败不冒充成功，运行结束后不再显示正在执行的任务文案', () => {
  const activities = ['completed', 'cancelled', 'error', 'in_progress'].map((status) => ({
    toolUseId: status, toolName: 'TaskUpdate', done: true,
    input: { taskId: status, subject: status, status, activeForm: '正在处理' },
  }))
  const items = aggregateTaskItems(activities, false)
  expect(getTaskProgressCounts(items)).toEqual({ completed: 1, terminal: 3, total: 4, hasActive: true })
  expect(aggregateTaskItems(activities, true).at(-1)).toEqual({
    id: 'in_progress', subject: 'in_progress', status: 'pending', activeForm: undefined,
  })
})

test('文件引用不把版本号当文件，保留有目录的文件并拒绝越界相对路径', () => {
  expect(isLocalFileReference('v0.19.57')).toBe(false)
  expect(isLocalFileReference('notes.md')).toBe(true)
  expect(isLocalFileReference('assets/customer.mxliff')).toBe(true)
  expect(isLocalFileReference('../private.txt')).toBe(false)
  expect(isLocalFileReference('https://example.com/report.md')).toBe(false)
})

test('会话拖入使用原生引用协议，自引用被拒绝且拖拽状态可清除', () => {
  const data = new Map<string, string>()
  const transfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() { return [...data.keys()] },
    effectAllowed: 'none',
  } as unknown as DataTransfer
  const item = { sessionId: 'source-session', title: '来源会话' }
  setSessionReferenceDragData(transfer, item)
  expect(getSessionReferenceDragData(transfer)).toEqual(item)
  expect(getActiveSessionReferenceDragId(transfer)).toBe(item.sessionId)
  expect(data.get('text/plain')).toBe(`&session:${item.sessionId}::${encodeURIComponent(item.title)}`)
  expect(canReferenceDraggedSession(item, item.sessionId)).toBe(false)
  expect(canReferenceDraggedSession(item, 'another-session')).toBe(true)
  clearSessionReferenceDragState()
  expect(getActiveSessionReferenceDragId(transfer)).toBeNull()
})
