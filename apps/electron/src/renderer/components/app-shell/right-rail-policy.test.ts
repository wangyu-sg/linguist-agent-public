/** Agent Rail 只在「Agent 模式 + 有会话 + 会话视图」出现。 */

import { describe, expect, test } from 'bun:test'
import {
  shouldShowAgentRail,
  shouldSuppressAgentRail,
  type AgentRailContext,
} from './right-rail-policy'

const base: AgentRailContext = {
  appMode: 'agent',
  hasAgentSession: true,
  automationFormOpen: false,
  activeView: 'conversations',
}

describe('shouldShowAgentRail（PB-102 Right Rail 上下文编排）', () => {
  test('Agent 模式会话视图 + 有会话 → 显示', () => {
    expect(shouldShowAgentRail(base)).toBe(true)
  })

  test('Chat 模式不显示', () => {
    expect(shouldShowAgentRail({ ...base, appMode: 'chat' })).toBe(false)
  })

  test('无当前会话不显示', () => {
    expect(shouldShowAgentRail({ ...base, hasAgentSession: false })).toBe(false)
  })

  test('定时任务表单打开时不显示（表单自带右栏配置）', () => {
    expect(shouldShowAgentRail({ ...base, automationFormOpen: true })).toBe(false)
  })

  test('项目管理视图不显示', () => {
    expect(shouldShowAgentRail({ ...base, activeView: 'projects' })).toBe(false)
  })

  test('automations / agent-skills 全屏视图不显示', () => {
    expect(shouldShowAgentRail({ ...base, activeView: 'automations' })).toBe(false)
    expect(shouldShowAgentRail({ ...base, activeView: 'agent-skills' })).toBe(false)
  })

  test('given 800px 视口 when 左栏折叠 then 不按展开宽度错误隐藏右栏', () => {
    expect(shouldSuppressAgentRail(800, 300, 300, 320)).toBe(true)
    expect(shouldSuppressAgentRail(800, 60, 300, 320)).toBe(false)
  })
})
