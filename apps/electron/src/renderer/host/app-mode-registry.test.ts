/**
 * App 主模式注册表测试：模式顺序、视图驻留、键盘导航、会话恢复、
 * 欢迎页入口与 Agent Rail 可见性策略的唯一真源行为。
 */

import { describe, expect, test } from 'bun:test'
import {
  APP_MODE_DEFINITIONS,
  canRestoreSessionForMode,
  findSessionToRestore,
  getAppModeDefinition,
  getModeSliderTranslateX,
  resolveActiveViewForMode,
  resolveModeNavigation,
  resolveRightRailPolicy,
  resolveWelcomeModeDefinitions,
  shouldForceCollapseLeftSidebar,
  shouldSuppressAgentRail,
  type AgentRailContext,
} from './app-mode-registry'

describe('AppMode 注册表与三模式导航', () => {
  test('给 Agent、Chat 和 Linguist 各提供一个稳定入口', () => {
    expect(APP_MODE_DEFINITIONS.map((definition) => definition.mode)).toEqual([
      'agent',
      'chat',
      'linguist',
    ])
  })

  test('根据当前模式把滑块移动到对应的三等分位置', () => {
    expect(getModeSliderTranslateX('agent')).toBe(0)
    expect(getModeSliderTranslateX('chat')).toBe(100)
    expect(getModeSliderTranslateX('linguist')).toBe(200)
  })

  test('键盘方向键在三种模式之间循环，Home/End 跳到边界', () => {
    expect(resolveModeNavigation('agent', 'ArrowRight')).toBe('chat')
    expect(resolveModeNavigation('linguist', 'ArrowRight')).toBe('agent')
    expect(resolveModeNavigation('agent', 'ArrowLeft')).toBe('linguist')
    expect(resolveModeNavigation('chat', 'Home')).toBe('agent')
    expect(resolveModeNavigation('chat', 'End')).toBe('linguist')
  })

  test('仅 Agent 与 Chat 恢复会话，Linguist 恢复项目标签', () => {
    expect(canRestoreSessionForMode('agent')).toBe(true)
    expect(canRestoreSessionForMode('chat')).toBe(true)
    expect(canRestoreSessionForMode('linguist')).toBe(false)
    expect(getAppModeDefinition('linguist').restoresProjectTab).toBe(true)
    expect(getAppModeDefinition('agent').restoresProjectTab).toBe(false)
    expect(getAppModeDefinition('chat').restoresProjectTab).toBe(false)
  })

  test('given 普通空白页与 Linguist 会话空白页 when 计算模式入口 then 普通页提供三模式而 Linguist 不显示切换器', () => {
    expect(resolveWelcomeModeDefinitions('agent').map((item) => item.mode)).toEqual([
      'agent',
      'chat',
      'linguist',
    ])
    expect(resolveWelcomeModeDefinitions('chat').map((item) => item.mode)).toEqual([
      'agent',
      'chat',
      'linguist',
    ])
    expect(resolveWelcomeModeDefinitions('linguist')).toEqual([])
  })

  test('given 跨模式标签 when 恢复空 Chat then 不复用 Linguist 项目并要求创建草稿', () => {
    expect(findSessionToRestore('chat', [], null, [
      { type: 'linguist-project', id: 'project-tab', title: '项目' },
    ], new Set())).toBeNull()
  })

  test('given 多个候选 when 恢复模式 then 按上次会话、同类标签、最近会话的顺序选择', () => {
    const sessions = [
      { id: 'recent', title: '最近', archived: false },
      { id: 'last', title: '上次', archived: false },
    ]
    const tabs = [
      { type: 'chat' as const, id: 'chat-tab', sessionId: 'recent', title: '标签标题' },
    ]

    expect(findSessionToRestore('chat', sessions, 'last', tabs, new Set())).toEqual(sessions[1]!)
    expect(findSessionToRestore('chat', sessions, null, tabs, new Set())).toEqual({
      id: 'recent',
      title: '标签标题',
    })
    expect(findSessionToRestore('chat', sessions, null, [], new Set())).toEqual(sessions[0]!)
  })

  test('given 只有归档或草稿会话 when 恢复模式 then 要求创建新的草稿', () => {
    expect(findSessionToRestore(
      'agent',
      [
        { id: 'archived', title: '已归档', archived: true },
        { id: 'draft', title: '草稿', archived: false },
      ],
      null,
      [],
      new Set(['draft']),
    )).toBeNull()
  })

  test('given Linguist 绑定会话与普通 Agent 会话 when 恢复 Agent 模式 then 不选择 Linguist 会话', () => {
    expect(findSessionToRestore(
      'agent',
      [
        {
          id: 'linguist',
          title: '项目会话',
          archived: false,
          linguistProjectId: 'project-a',
        },
        { id: 'ordinary', title: '普通会话', archived: false },
      ],
      'linguist',
      [],
      new Set(),
    )).toEqual({ id: 'ordinary', title: '普通会话', archived: false })
  })
})

describe('resolveActiveViewForMode（视图驻留）', () => {
  test('given 项目管理页 when 离开 Linguist then Agent/Chat 回到普通主区', () => {
    expect(resolveActiveViewForMode('projects', 'agent')).toBe('conversations')
    expect(resolveActiveViewForMode('projects', 'chat')).toBe('conversations')
    expect(resolveActiveViewForMode('projects', 'linguist')).toBe('projects')
  })

  test('given Agent 专属主区 when 进入 Linguist then planning 改写、agent-skills 保留', () => {
    expect(resolveActiveViewForMode('planning', 'linguist')).toBe('conversations')
    // K3：Linguist 项目「Agent 能力」入口复用唯一 AgentSkillsView，不再改写。
    expect(resolveActiveViewForMode('agent-skills', 'linguist')).toBe('agent-skills')
  })

  test('given 非 Linguist 模式 when 切换模式 then 不改写通用路由', () => {
    expect(resolveActiveViewForMode('conversations', 'agent')).toBe('conversations')
    expect(resolveActiveViewForMode('planning', 'chat')).toBe('planning')
    expect(resolveActiveViewForMode('agent-skills', 'agent')).toBe('agent-skills')
  })
})

describe('resolveRightRailPolicy（PB-102 Right Rail 上下文编排）', () => {
  const base: AgentRailContext = {
    appMode: 'agent',
    hasAgentSession: true,
    automationFormOpen: false,
    activeView: 'conversations',
  }

  test('Agent 模式会话视图 + 有会话 → 显示', () => {
    expect(resolveRightRailPolicy(base)).toBe(true)
  })

  test('Chat / Linguist 模式不显示', () => {
    expect(resolveRightRailPolicy({ ...base, appMode: 'chat' })).toBe(false)
    expect(resolveRightRailPolicy({ ...base, appMode: 'linguist' })).toBe(false)
  })

  test('无当前会话不显示', () => {
    expect(resolveRightRailPolicy({ ...base, hasAgentSession: false })).toBe(false)
  })

  test('定时任务表单打开时不显示（表单自带右栏配置）', () => {
    expect(resolveRightRailPolicy({ ...base, automationFormOpen: true })).toBe(false)
  })

  test('项目管理视图不显示', () => {
    expect(resolveRightRailPolicy({ ...base, activeView: 'projects' })).toBe(false)
  })

  test('planning / agent-skills 全屏视图不显示', () => {
    expect(resolveRightRailPolicy({ ...base, activeView: 'planning' })).toBe(false)
    expect(resolveRightRailPolicy({ ...base, activeView: 'agent-skills' })).toBe(false)
  })

  test('given 800px 视口 when 左栏折叠 then 不按展开宽度错误隐藏右栏', () => {
    expect(shouldSuppressAgentRail(800, 300, 300, 320)).toBe(true)
    expect(shouldSuppressAgentRail(800, 60, 300, 320)).toBe(false)
  })

  test('given 极窄视口 when 判定左栏让位 then 200% zoom 等效宽度折叠为图标栏', () => {
    expect(shouldForceCollapseLeftSidebar(442, 300, 320)).toBe(true)
    expect(shouldForceCollapseLeftSidebar(619, 300, 320)).toBe(true)
    expect(shouldForceCollapseLeftSidebar(885, 300, 320)).toBe(false)
  })
})
