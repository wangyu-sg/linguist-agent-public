/**
 * PB-093 chat transcript renderer golden tests: fixed chat.json rows + fixed
 * injected clock -> byte-exact Markdown. Covers the five ChatEvent kinds,
 * usage present/absent, session grouping order (first ts, then sessionId),
 * unassigned rows (malformed_chat_session), the malformed-row appendix,
 * null cases, and double-render determinism. The user text fixture carries
 * Chinese multibyte content plus backticks/fences to pin the verbatim
 * (no Markdown escaping) pass-through.
 *
 * All inputs are synthetic literals; no legacy repo data is ever touched.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { renderChatTranscript, type ChatTranscriptProvenance } from './chat-transcript'

const PROVENANCE: ChatTranscriptProvenance = {
  legacyProjectId: 'p1',
  sourceDigest: '0'.repeat(64),
  archivedAt: '2026-07-26T00:00:00.000Z',
  generator: 'linguist-legacy-import 0.0.4',
}

// Deliberate file order: sess-a rows first, then the tied pair (sess-c before
// sess-b in the file) — sections must sort by first-row ts, then sessionId.
const ROWS: unknown[] = [
  { ts: '2025-03-01T10:00:05.000Z', kind: 'user', text: '请把这段译成德语：`hello`\n~~~\nfence line\n~~~', sessionId: 'sess-a' },
  { ts: '2025-03-01T10:00:06.000Z', kind: 'tool', text: 'tool_start read_file', sessionId: 'sess-a', toolCallId: 'tc-1' },
  { ts: '2025-03-01T10:00:07.000Z', kind: 'tool', text: 'tool_end read_file ok', sessionId: 'sess-a' },
  {
    ts: '2025-03-01T10:00:08.000Z',
    kind: 'assistant',
    text: '译文：Hallo\n第二行保持不变。',
    sessionId: 'sess-a',
    usage: { inputTokens: 120, cacheReadTokens: 30, outputTokens: 45, totalTokens: 195, costUsd: 0.0021, modelCalls: 1 },
  },
  { ts: '2025-03-01T09:00:00.000Z', kind: 'user', text: 'tie session c', sessionId: 'sess-c' },
  { ts: '2025-03-01T09:00:00.000Z', kind: 'user', text: 'earlier session b', sessionId: 'sess-b' },
  { ts: '2025-03-01T09:00:01.500Z', kind: 'assistant', text: 'reply without usage', sessionId: 'sess-b' },
  { ts: '2025-03-01T09:00:02.000Z', kind: 'system', text: 'Agent run stopped by user.', sessionId: 'sess-b' },
  { ts: '2025-03-03T08:00:00.000Z', kind: 'user', text: 'no session here' },
  { ts: '2025-03-03T08:00:01.000Z', kind: 'error', text: 'boom' },
  'not an object',
  42,
  { ts: '2025-03-01T10:00:00.000Z', kind: 'user' }, // missing text
  { kind: 'user', text: 'missing ts' }, // missing ts
]

const EXPECTED_MARKDOWN = [
  '# 旧聊天归档转录（read-only archived transcript）',
  '',
  '> **只读归档**：本文件是旧 Linguist Agent 聊天历史的一次性静态渲染，**不可继续执行**；旧 Runtime / Tool / Prompt / Session 语义与新仓不兼容（PB-093）。',
  '> **工具行为**仅为旧 Runtime 写下的单行调用摘要（`tool_start <name>` / `tool_end <name> ok|error`），**不可重放**；工具参数与结果从不写入 chat.json，故不在本归档中。',
  `> **provenance**：legacyProjectId=\`p1\` · sourceDigest=\`${'0'.repeat(64)}\` · archivedAt=\`2026-07-26T00:00:00.000Z\` · generator=\`linguist-legacy-import 0.0.4\``,
  '',
  '## 会话 `sess-b`',
  '',
  '### 用户 · 2025-03-01T09:00:00.000Z',
  '',
  'earlier session b',
  '',
  '### 助手 · 2025-03-01T09:00:01.500Z',
  '',
  'reply without usage',
  '',
  '**[system] · 2025-03-01T09:00:02.000Z** — Agent run stopped by user.',
  '',
  '## 会话 `sess-c`',
  '',
  '### 用户 · 2025-03-01T09:00:00.000Z',
  '',
  'tie session c',
  '',
  '## 会话 `sess-a`',
  '',
  '### 用户 · 2025-03-01T10:00:05.000Z',
  '',
  // verbatim pass-through: backticks + a tilde fence inside the user text
  // must survive UNESCAPED (report notes declare this).
  '请把这段译成德语：`hello`\n~~~\nfence line\n~~~',
  '',
  '> tool_start read_file · toolCallId=tc-1',
  '',
  '> tool_end read_file ok',
  '',
  '### 助手 · 2025-03-01T10:00:08.000Z',
  '',
  '译文：Hallo\n第二行保持不变。',
  '',
  '> usage: input=120 cache-read=30 output=45 total=195 cost=$0.0021 model-calls=1',
  '',
  '## 未分配会话',
  '',
  '_无 sessionId 的行（旧仓 malformed_chat_session 口径，计入迁移报告）。_',
  '',
  '### 用户 · 2025-03-03T08:00:00.000Z',
  '',
  'no session here',
  '',
  '**[error] · 2025-03-03T08:00:01.000Z** — boom',
  '',
  '## 附录：无法归档的行',
  '',
  '以下 4 行不符合 ChatEvent 形状（非对象或缺 ts/kind/text），原文 JSON 逐行保留：',
  '',
  '~~~json',
  '"not an object"',
  '42',
  '{"ts":"2025-03-01T10:00:00.000Z","kind":"user"}',
  '{"kind":"user","text":"missing ts"}',
  '~~~',
  '',
].join('\n')

test('golden: fixed rows + fixed clock render the exact transcript bytes', () => {
  const rendered = renderChatTranscript({ rows: ROWS, provenance: PROVENANCE })
  assert.ok(rendered !== null)
  assert.equal(rendered.markdown, EXPECTED_MARKDOWN)
  assert.deepEqual(rendered.summary, { sessions: 3, rows: 10, unassignedRows: 2, malformedRows: 4 })
})

test('determinism: same input renders byte-identical markdown (stable sha256)', () => {
  const first = renderChatTranscript({ rows: ROWS, provenance: PROVENANCE })
  const second = renderChatTranscript({ rows: ROWS, provenance: PROVENANCE })
  assert.ok(first !== null && second !== null)
  assert.equal(first.markdown, second.markdown)
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
  assert.equal(sha(first.markdown), sha(second.markdown))
})

test('null cases: non-array, empty array, null, undefined -> no transcript', () => {
  assert.equal(renderChatTranscript({ rows: [], provenance: PROVENANCE }), null)
  assert.equal(renderChatTranscript({ rows: { ts: 'x' }, provenance: PROVENANCE }), null)
  assert.equal(renderChatTranscript({ rows: null, provenance: PROVENANCE }), null)
  assert.equal(renderChatTranscript({ rows: undefined, provenance: PROVENANCE }), null)
})

test('usage line: only present numeric fields render; usage without numerics renders nothing', () => {
  const rows = [
    { ts: '2025-01-01T00:00:00.000Z', kind: 'assistant', text: 'a', sessionId: 's', usage: { outputTokens: 7, costUsd: 0 } },
    { ts: '2025-01-01T00:00:01.000Z', kind: 'assistant', text: 'b', sessionId: 's', usage: { model: 'pi' } },
    { ts: '2025-01-01T00:00:02.000Z', kind: 'assistant', text: 'c', sessionId: 's' },
  ]
  const rendered = renderChatTranscript({ rows, provenance: PROVENANCE })!
  assert.ok(rendered.markdown.includes('> usage: output=7 cost=$0'))
  // 'b' has a usage record but no numeric fields; 'c' has none: exactly one usage line
  assert.equal(rendered.markdown.split('> usage:').length - 1, 1)
  assert.deepEqual(rendered.summary, { sessions: 1, rows: 3, unassignedRows: 0, malformedRows: 0 })
})

test('out-of-domain kind value renders as a label line (not malformed)', () => {
  const rows = [{ ts: '2025-01-01T00:00:00.000Z', kind: 'compaction', text: 'context compacted', sessionId: 's' }]
  const rendered = renderChatTranscript({ rows, provenance: PROVENANCE })!
  assert.ok(rendered.markdown.includes('**[compaction] · 2025-01-01T00:00:00.000Z** — context compacted'))
  assert.deepEqual(rendered.summary, { sessions: 1, rows: 1, unassignedRows: 0, malformedRows: 0 })
})

test('all-malformed input still renders (banner + appendix preserve the data)', () => {
  const rendered = renderChatTranscript({ rows: ['junk', { nope: 1 }], provenance: PROVENANCE })!
  assert.deepEqual(rendered.summary, { sessions: 0, rows: 0, unassignedRows: 0, malformedRows: 2 })
  assert.ok(rendered.markdown.includes('## 附录：无法归档的行'))
  assert.ok(!rendered.markdown.includes('## 会话'))
  assert.ok(rendered.markdown.includes('"junk"\n{"nope":1}'))
})

test('whitespace-only / non-string sessionId counts as unassigned', () => {
  const rows = [
    { ts: '2025-01-01T00:00:00.000Z', kind: 'user', text: 'x', sessionId: '   ' },
    { ts: '2025-01-01T00:00:01.000Z', kind: 'user', text: 'y', sessionId: 7 },
  ]
  const rendered = renderChatTranscript({ rows, provenance: PROVENANCE })!
  assert.deepEqual(rendered.summary, { sessions: 0, rows: 2, unassignedRows: 2, malformedRows: 0 })
  assert.ok(rendered.markdown.includes('## 未分配会话'))
})
