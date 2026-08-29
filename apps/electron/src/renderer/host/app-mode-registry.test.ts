import { expect, test } from 'bun:test'
import { findSessionToRestore } from './app-mode-registry'
import { getExpandedRightWorkspaceLayout } from '@/components/app-shell/right-panel-layout'

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

test('展开右侧工作区时优先保留 320px Agent rail，空间不足则由工作区独占', () => {
  expect(getExpandedRightWorkspaceLayout(1440, 61)).toEqual({
    mainAreaWidth: 320,
    rightPanelWidth: 1059,
  })
  expect(getExpandedRightWorkspaceLayout(720, 61)).toEqual({
    mainAreaWidth: 0,
    rightPanelWidth: 659,
  })
})
