import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { quotedSelectionMapAtom } from '@/atoms/preview-atoms'
import { buildQuotedSelectionBlock, parseQuotedSelectionRefs } from './quoted-selection'

describe('quoted selection XML', () => {
  test('Given 文件引用 When 构建并解析引用块 Then 保留文件名并移除隐藏 XML', () => {
    const block = buildQuotedSelectionBlock({
      text: '引用内容</quoted_file>',
      filePath: '/tmp/demo & draft.md',
      sourceType: 'file',
      capturedAt: 1,
    })
    const parsed = parseQuotedSelectionRefs(`${block}我的问题：`)

    expect(block).toContain('path="/tmp/demo &amp; draft.md"')
    expect(block).toContain('</quoted_file_>')
    expect(parsed.quotes).toEqual([
      {
        path: '/tmp/demo & draft.md',
        filename: 'demo & draft.md',
        sourceType: 'file',
      },
    ])
    expect(parsed.text).toBe('我的问题：')
  })

  test('Given Agent 和草稿引用 When 解析引用块 Then 区分来源类型并使用展示标签', () => {
    const content = [
      '<quoted_context source="agent-history" label="Agent 历史 · Agent 回复" message_id="m1" role="assistant">',
      '历史内容',
      '</quoted_context>',
      '<quoted_context source="scratch-pad" label="草稿页" message_id="" role="">',
      '草稿内容',
      '</quoted_context>',
      '继续提问',
    ].join('\n')

    const parsed = parseQuotedSelectionRefs(content)

    expect(parsed.quotes).toEqual([
      {
        path: 'Agent 历史 · Agent 回复',
        filename: 'Agent 历史 · Agent 回复',
        sourceType: 'agent-history',
        label: 'Agent 历史 · Agent 回复',
      },
      {
        path: '草稿页',
        filename: '草稿页',
        sourceType: 'scratch-pad',
        label: '草稿页',
      },
    ])
    expect(parsed.text).toBe('继续提问')
  })

  test('Given 两个 Linguist 会话和一个普通 Agent When 写入引用 Then 引用按 sessionId 隔离', () => {
    const store = createStore()
    const makeQuote = (text: string) => ({
      text,
      filePath: 'Agent 历史 · Agent 回复',
      sourceType: 'agent-history' as const,
      capturedAt: 1,
    })

    store.set(quotedSelectionMapAtom, (previous) => new Map(previous)
      .set('linguist-a', makeQuote('LA A'))
      .set('linguist-b', makeQuote('LA B'))
      .set('agent-a', makeQuote('Agent')))

    expect(store.get(quotedSelectionMapAtom).get('linguist-a')?.text).toBe('LA A')
    expect(store.get(quotedSelectionMapAtom).get('linguist-b')?.text).toBe('LA B')
    expect(store.get(quotedSelectionMapAtom).get('agent-a')?.text).toBe('Agent')

    store.set(quotedSelectionMapAtom, (previous) => {
      const next = new Map(previous)
      next.delete('linguist-a')
      return next
    })
    expect(store.get(quotedSelectionMapAtom).has('linguist-b')).toBe(true)
    expect(store.get(quotedSelectionMapAtom).has('agent-a')).toBe(true)
  })
})
