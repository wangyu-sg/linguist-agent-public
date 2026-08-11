import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import {
  parseProjectAgentSessionPreferences,
  resolveProjectAgentSessionIds,
  serializeProjectAgentSessionIds,
} from './project-agent-session-atoms'

function session(
  id: string,
  projectId: string,
  updatedAt: number,
  archived = false,
): AgentSessionMeta {
  return {
    id,
    title: id,
    linguistProjectId: projectId,
    linguistProjectName: projectId,
    archived,
    createdAt: 1,
    updatedAt,
  }
}

describe('Project Agent Session 恢复', () => {
  test('given 项目上次选择仍有效 when 恢复 then 保留选择且项目之间不串状态', () => {
    const sessions = [
      session('alpha-new', 'alpha', 30),
      session('alpha-selected', 'alpha', 20),
      session('beta-only', 'beta', 10),
    ]

    expect(resolveProjectAgentSessionIds(
      new Map([['alpha', 'alpha-selected']]),
      sessions,
    )).toEqual(new Map([
      ['alpha', 'alpha-selected'],
      ['beta', 'beta-only'],
    ]))
  })

  test('given 显式选择已归档历史 when 恢复 then 保留只读历史；丢失选择才回退', () => {
    const sessions = [
      session('alpha-archived', 'alpha', 40, true),
      session('alpha-latest', 'alpha', 30),
      session('alpha-older', 'alpha', 20),
    ]

    expect(resolveProjectAgentSessionIds(
      new Map([
        ['alpha', 'alpha-archived'],
        ['beta', 'missing'],
      ]),
      sessions,
    )).toEqual(new Map([['alpha', 'alpha-archived']]))
  })

  test('given 项目没有会话 when 恢复 then 不创建也不产生选择', () => {
    expect(resolveProjectAgentSessionIds(
      new Map([['alpha', 'missing']]),
      [],
    )).toEqual(new Map())
  })

  test('given settings 中保存了项目会话选择 when 重启恢复 then 只接受非空字符串映射', () => {
    const restored = parseProjectAgentSessionPreferences({
      alpha: 'alpha-selected',
      beta: '',
      gamma: 42,
    })

    expect(restored).toEqual(new Map([['alpha', 'alpha-selected']]))
    expect(serializeProjectAgentSessionIds(restored)).toEqual({
      alpha: 'alpha-selected',
    })
  })
})
