import { describe, expect, test } from 'bun:test'
import { createContextDocsRefreshGate } from './context-docs-refresh'

describe('Context Docs refresh gate', () => {
  test('given 新请求已开始 when 旧请求最后返回 then 旧结果不得覆盖新计数', () => {
    const gate = createContextDocsRefreshGate()
    const initialRequest = gate.begin()
    const mutationRefresh = gate.begin()

    expect(gate.isLatest(initialRequest)).toBe(false)
    expect(gate.isLatest(mutationRefresh)).toBe(true)
  })
})
