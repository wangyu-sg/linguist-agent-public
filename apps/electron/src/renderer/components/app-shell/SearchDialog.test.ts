import { describe, expect, test } from 'bun:test'
import { getAgentSearchIdentity } from './SearchDialog'

describe('全局搜索 Agent 身份', () => {
  test('绑定会话标记为 Linguist 并保留项目标签，普通 Agent 不变', () => {
    expect(getAgentSearchIdentity({
      linguistProjectId: 'prj-0000000000000001',
      linguistProjectName: '游戏本地化',
    })).toEqual({
      type: 'linguist',
      projectName: '游戏本地化',
    })
    expect(getAgentSearchIdentity(undefined)).toEqual({ type: 'agent' })
  })

  test('实时项目名优先于会话冻结快照', () => {
    expect(getAgentSearchIdentity({
      linguistProjectId: 'project-1',
      linguistProjectName: '旧项目名',
    }, new Map([['project-1', '新项目名']]))).toEqual({
      type: 'linguist',
      projectName: '新项目名',
    })
  })
})
