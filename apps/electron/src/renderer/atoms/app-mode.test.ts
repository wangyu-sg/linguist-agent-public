import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { appModeAtom, normalizePrimaryAppMode } from './app-mode'

describe('主应用模式', () => {
  test('given 合法主模式 when 归一化 then 保留原值', () => {
    expect(normalizePrimaryAppMode('agent')).toBe('agent')
    expect(normalizePrimaryAppMode('chat')).toBe('chat')
    expect(normalizePrimaryAppMode('linguist')).toBe('linguist')
  })

  test('given 历史 scratch 或损坏持久化值 when 归一化 then 回退到 Agent', () => {
    expect(normalizePrimaryAppMode('scratch')).toBe('agent')
    expect(normalizePrimaryAppMode('unknown')).toBe('agent')
    expect(normalizePrimaryAppMode(null)).toBe('agent')
  })

  test('given 新 store when 读取主模式 then 默认进入 Agent', () => {
    expect(createStore().get(appModeAtom)).toBe('agent')
  })
})
