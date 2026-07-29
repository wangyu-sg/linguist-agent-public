import { describe, expect, test } from 'bun:test'
import {
  MODE_SWITCHER_MODES,
  canRestoreSessionForMode,
  findSessionToRestore,
  getModeSliderTranslateX,
  getNextMode,
  getWelcomeModeOptions,
} from './mode-switcher-utils'

describe('ModeSwitcher 三模式导航', () => {
  test('给 Agent、Chat 和 Linguist 各提供一个稳定入口', () => {
    expect(MODE_SWITCHER_MODES.map((mode) => mode.value)).toEqual([
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
    expect(getNextMode('agent', 'ArrowRight')).toBe('chat')
    expect(getNextMode('linguist', 'ArrowRight')).toBe('agent')
    expect(getNextMode('agent', 'ArrowLeft')).toBe('linguist')
    expect(getNextMode('chat', 'Home')).toBe('agent')
    expect(getNextMode('chat', 'End')).toBe('linguist')
  })

  test('仅 Agent 与 Chat 恢复会话，Linguist 不借用普通会话', () => {
    expect(canRestoreSessionForMode('agent')).toBe(true)
    expect(canRestoreSessionForMode('chat')).toBe(true)
    expect(canRestoreSessionForMode('linguist')).toBe(false)
  })

  test('given 普通空白页与 Linguist 会话空白页 when 计算模式入口 then 普通页提供三模式而 Linguist 不显示切换器', () => {
    expect(getWelcomeModeOptions('agent').map((item) => item.value)).toEqual([
      'agent',
      'chat',
      'linguist',
    ])
    expect(getWelcomeModeOptions('chat').map((item) => item.value)).toEqual([
      'agent',
      'chat',
      'linguist',
    ])
    expect(getWelcomeModeOptions('linguist')).toEqual([])
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
