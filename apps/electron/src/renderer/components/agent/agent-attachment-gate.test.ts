import { describe, expect, test } from 'bun:test'
import { resolveAgentAttachmentSaveGate } from './agent-attachment-gate'

describe('Agent 会话附件落盘闸门', () => {
  test('Given 普通会话有 Proma workspace When 求闸门 Then 放行并携带真实 slug', () => {
    expect(resolveAgentAttachmentSaveGate({
      linguistProjectId: undefined,
      workspaceSlug: 'demo-workspace',
    })).toEqual({ canSave: true, workspaceSlug: 'demo-workspace' })
  })

  test('Given Linguist 绑定会话没有 Proma workspace When 求闸门 Then 放行且不伪造 workspaceSlug', () => {
    const gate = resolveAgentAttachmentSaveGate({
      linguistProjectId: 'prj-0000000000000001',
      workspaceSlug: undefined,
    })

    expect(gate.canSave).toBe(true)
    expect(gate.workspaceSlug).toBeUndefined()
  })

  test('Given Linguist 会话残留 workspace When 求闸门 Then 优先 workspace（主进程同样 Linguist 优先）', () => {
    expect(resolveAgentAttachmentSaveGate({
      linguistProjectId: 'prj-0000000000000001',
      workspaceSlug: 'stale-workspace',
    })).toEqual({ canSave: true, workspaceSlug: 'stale-workspace' })
  })

  test('Given 普通会话既无 workspace 也无项目绑定 When 求闸门 Then 阻断（保留既有警告行为）', () => {
    expect(resolveAgentAttachmentSaveGate({
      linguistProjectId: undefined,
      workspaceSlug: undefined,
    })).toEqual({ canSave: false })
  })
})
