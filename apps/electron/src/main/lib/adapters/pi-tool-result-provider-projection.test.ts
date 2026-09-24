import { expect, test } from 'bun:test'
import { convertToLlm } from '@earendil-works/pi-coding-agent'
import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared'
import { normalizeContext } from '@earendil-works/pi-ai'
import type { Model, ToolResultMessage } from '@earendil-works/pi-ai'
import type { BrowserViewState } from '@proma/shared'
import { browserStateReceipt } from '../browser-operation-contract'
import { serializePiToolResultPayload } from './pi-tool-result-json'

test('Pi 的 Codex Provider 投影只发送浏览器与 CAT 工具 content，不重注入 details', () => {
  const browserState = {
    activeTabId: 'other-tab', agentTabId: 'work-tab',
    tabs: [
      { tabId: 'other-tab', url: 'https://other.example/', title: 'Other', documentRevision: 1, loading: false },
      { tabId: 'work-tab', url: 'https://work.example/', title: 'Work', documentRevision: 7, loading: false },
    ],
    trace: [{ summary: 'BROWSER_DETAILS_ONLY_MARKER' }],
  } as BrowserViewState
  const browser = serializePiToolResultPayload(browserStateReceipt(browserState, 'work-tab', 'dispatched'))
  const importModelText = JSON.stringify({
    found: 1, imported: 1,
    items: [{ filename: 'synthetic.xliff', status: 'imported', unknownTagSummary: { count: 1, patterns: [{ shape: '[value]', frequency: 500, exampleCount: 500, example: { id: 'example-0' } }] } }],
  })
  const importDetails = {
    found: 1, imported: 1,
    items: [{ filename: 'synthetic.xliff', status: 'imported', unknownTagSummary: [{ examples: Array.from({ length: 500 }, (_, index) => `CAT_DETAILS_ONLY_MARKER-${index}`) }] }],
  }
  const messages: ToolResultMessage[] = [
    { role: 'toolResult', toolCallId: 'call_browser', toolName: 'BrowserPress', content: [{ type: 'text', text: browser.text }], details: browser.details, isError: false, timestamp: 1 },
    { role: 'toolResult', toolCallId: 'call_cat', toolName: 'cat_import_resources', content: [{ type: 'text', text: importModelText }], details: importDetails, isError: false, timestamp: 2 },
  ]
  const model: Model<'openai-codex-responses'> = {
    id: 'synthetic', name: 'Synthetic', provider: 'openai-codex', api: 'openai-codex-responses',
    baseUrl: 'https://unused.example/', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 4_096,
  }

  const llmMessages = convertToLlm(messages)
  expect(JSON.stringify(llmMessages)).toContain('CAT_DETAILS_ONLY_MARKER-499')
  const providerInput = convertResponsesMessages(model, normalizeContext({ messages: llmMessages }), new Set(['openai-codex']))
  expect(providerInput).toEqual([
    { type: 'function_call_output', call_id: 'call_browser', output: browser.text },
    { type: 'function_call_output', call_id: 'call_cat', output: importModelText },
  ])
  expect(JSON.stringify(providerInput)).not.toContain('CAT_DETAILS_ONLY_MARKER')
  expect(JSON.stringify(providerInput)).not.toContain('BROWSER_DETAILS_ONLY_MARKER')
  expect(browser.text).not.toContain('other-tab')
})
