import { describe, expect, test } from 'bun:test'
import {
  getAgentSessionTransferLabel,
  getAgentSessionTransferPresentation,
} from './AgentSessionActionsMenu'

describe('AgentSessionActionsMenu', () => {
  test('given 未注入语义 when 渲染 then 保持 Agent 迁移文案', () => {
    expect(getAgentSessionTransferLabel()).toBe('迁移到其他项目')
  })

  test('given Linguist 注入复制语义 when 渲染 then 不显示迁移文案', () => {
    expect(getAgentSessionTransferLabel('复制到其他项目')).toBe('复制到其他项目')
  })

  test('given Linguist 会话运行中 when 构造菜单 then 保留禁用复制入口及原因', () => {
    expect(getAgentSessionTransferPresentation({
      canMove: false,
      transferLabel: '复制到其他项目',
      hasAction: true,
      disabledReason: '会话正在运行或等待处理，完成后可复制',
    })).toEqual({
      visible: true,
      disabled: true,
      label: '复制到其他项目',
      disabledReason: '会话正在运行或等待处理，完成后可复制',
    })
  })

  test('given 普通 Agent 会话运行中 when 构造菜单 then 保持隐藏迁移入口', () => {
    expect(getAgentSessionTransferPresentation({
      canMove: false,
      hasAction: true,
    })).toEqual({
      visible: false,
      disabled: true,
      label: '迁移到其他项目',
      disabledReason: undefined,
    })
  })
})
