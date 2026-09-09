import { expect, test } from 'bun:test'
import { findSessionToRestore } from './app-mode-registry'
import { getRightPanelMaxWidth } from '@/components/app-shell/right-panel-layout'
import { getMacTitlebarLeadingInsetPx } from '@/lib/window-titlebar-layout'

test('Agent 模式不会恢复 Linguist 父会话的委派子会话', () => {
  const sessions = [
    { id: 'parent', title: '项目会话', linguistProjectId: 'project' },
    {
      id: 'child',
      title: '审校子会话',
      parentSessionId: 'parent',
      sourceDelegationId: 'delegation',
    },
    { id: 'ordinary', title: '普通 Agent' },
  ]

  expect(findSessionToRestore('agent', sessions, 'child', [], new Set())).toEqual(
    sessions[2]!,
  )
})

test('右侧拖宽仍给主会话保留原生最小宽度', () => {
  expect(getRightPanelMaxWidth(1440, 61, true)).toBe(1059)
  expect(getRightPanelMaxWidth(720, 61, true)).toBe(339)
})

test('macOS 根据侧栏实际占用为首个 Tab 预留红绿灯安全区', () => {
  expect(getMacTitlebarLeadingInsetPx(true, 61)).toBe(19)
  expect(getMacTitlebarLeadingInsetPx(true, 241)).toBe(0)
  expect(getMacTitlebarLeadingInsetPx(false, 61)).toBe(0)
})
