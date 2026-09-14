import { expect, test } from 'bun:test'
import { DEFAULT_CONTEXT_WINDOW, inferContextWindow } from '../packages/shared/src/utils/context-window'
import { resolveReasoningProfile } from '../packages/shared/src/types/reasoning-profile'
import { buildWorkspaceMcpEntry, hasWorkspaceMcpTransportChanged } from '../apps/electron/src/main/lib/mcp-configuration-policy'
import { liveMarkdownTableCellKeyAction, parseLiveMarkdownTable, serializeLiveMarkdownTable, updateLiveMarkdownTableCell } from '../apps/electron/src/renderer/components/markdown/live-markdown-table'

test('DeepSeek Flash 的上下文与 reasoning 使用共享规则，未知模型不被改名', () => {
  expect(inferContextWindow('deepseek-flash')).toBe(1_000_000)
  const profile = resolveReasoningProfile({ modelId: 'deepseek-flash', transport: 'anthropic-messages' })
  expect(profile?.id).toBe('deepseek-flash')
  expect(profile?.encodings).toEqual(resolveReasoningProfile({ modelId: 'deepseek-v4-flash', transport: 'anthropic-messages' })?.encodings)
  expect(inferContextWindow('unlisted-custom-model')).toBe(DEFAULT_CONTEXT_WINDOW)
})

test('MCP 配置验证公开 OAuth URL，并识别连接地址变化', () => {
  const entry = buildWorkspaceMcpEntry({ name: 'exa', type: 'http', url: 'https://mcp.exa.ai/mcp' })
  expect(entry.enabled).toBe(true)
  expect(hasWorkspaceMcpTransportChanged(entry, { ...entry, url: 'https://example.com/mcp' })).toBe(true)
  expect(() => buildWorkspaceMcpEntry({ name: 'test', type: 'http', url: 'https://example.com', oauth: { tokenEndpoint: 'http://example.com/token' } })).toThrow('HTTPS')
})

test('Markdown 表格换行保存后可重读，IME Enter 不提交', () => {
  const table = parseLiveMarkdownTable('| A | B |\n| --- | --- |\n| first | second |')!
  const updated = updateLiveMarkdownTableCell(table, 1, 0, 'first\nnext')
  expect(parseLiveMarkdownTable(serializeLiveMarkdownTable(updated))?.rows[0]?.[0]).toBe('first<br>next')
  expect(liveMarkdownTableCellKeyAction('Enter', true, false, 13)).not.toBe('commit')
  expect(liveMarkdownTableCellKeyAction('Enter', false, true, 229)).not.toBe('commit')
})
