import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import {
  currentQuotedSelectionAtom,
  quotedSelectionAtomFamily,
  quotedSelectionMapAtom,
} from '@/atoms/preview-atoms'
import {
  buildQuotedSelectionBlock,
  expandAgentHistoryQuoteMentions,
  parseAgentHistoryQuoteMention,
  parseQuotedSelectionRefs,
  serializeAgentHistoryQuoteMention,
} from './quoted-selection'

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
        quote: {
          text: '历史内容',
          filePath: 'Agent 历史 · Agent 回复',
          sourceType: 'agent-history',
          sourceLabel: 'Agent 历史 · Agent 回复',
          messageId: 'm1',
          messageRole: 'assistant',
          capturedAt: 0,
        },
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

  test('Given 嵌入 LA 会话不等于全局 current When 写入引用 Then chip 按 AgentView 自身 sessionId 仍可读', () => {
    const store = createStore()
    // 进入 Linguist 模式会把全局 current 置空（linguist-navigation），
    // 或停留在其他 Agent 会话；嵌入 LA 会话两种情况下都必须读到自己的引用。
    for (const globalCurrent of [null, 'agent-other']) {
      store.set(currentAgentSessionIdAtom, globalCurrent)
      store.set(quotedSelectionMapAtom, new Map([['linguist-session', {
        text: 'LA 引用内容',
        filePath: 'Agent 历史 · Agent 回复',
        sourceType: 'agent-history' as const,
        capturedAt: 1,
      }]]))

      // 回归保护：旧的全局派生入口在该场景下读不到（这正是 chip 消失的根因）。
      expect(store.get(currentQuotedSelectionAtom)).toBeNull()
      // 新共享入口：按 AgentView 自身 sessionId 派生，chip 仍然显示。
      expect(store.get(quotedSelectionAtomFamily('linguist-session'))?.text).toBe('LA 引用内容')
      // 其他会话不受污染。
      expect(store.get(quotedSelectionAtomFamily('agent-other'))).toBeNull()
    }
  })

  test('Given 可定位的 Agent 历史选区 When 序列化、发送并解析 Then 保留范围且用 inline marker 展示', () => {
    const quote = {
      text: '第二轮的关键内容',
      filePath: 'Agent 历史 · Agent 回复',
      sourceType: 'agent-history' as const,
      sourceLabel: 'Agent 历史 · Agent 回复',
      messageId: 'message-2',
      messageRole: 'assistant' as const,
      selectionStart: 12,
      selectionEnd: 20,
      turn: 2,
      capturedAt: 1,
    }
    const marker = serializeAgentHistoryQuoteMention(quote)

    expect(marker).not.toBeNull()
    const expanded = expandAgentHistoryQuoteMentions(`问题前 ${marker} 问题后`).replace(/\n/g, '\r\n')
    const parsed = parseQuotedSelectionRefs(expanded, { inlineAgentHistoryQuotes: true })

    expect(parsed.text).toBe(`问题前 ${marker} 问题后`)
    expect(parseAgentHistoryQuoteMention(parsed.text.match(/&quote:\S+/)?.[0] ?? '')).toMatchObject({
      text: quote.text,
      messageId: quote.messageId,
      messageRole: quote.messageRole,
      selectionStart: quote.selectionStart,
      selectionEnd: quote.selectionEnd,
      turn: quote.turn,
    })
  })
})
