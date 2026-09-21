import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

test('Pi统计去重并分开压缩usage，不输出原文和隐藏推理', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-usage-'))
  try {
    const message = { id: 'a', type: 'message', timestamp: '2026-09-22T00:00:00Z', message: { role: 'assistant', model: 'synthetic', usage: { input: 10, cacheRead: 20, output: 5, reasoning: 3 }, content: [{ type: 'thinking', thinking: 'PRIVATE_THOUGHT' }, { type: 'toolCall', name: 'read' }] } }
    const entries = [message, message,
      { id: 'b', type: 'message', timestamp: '2026-09-22T00:00:01Z', message: { role: 'toolResult', toolName: 'read', content: [{ type: 'text', text: '私🙂' }] } },
      { id: 'c', type: 'compaction', timestamp: '2026-09-22T00:00:10Z', summary: 'PRIVATE_SUMMARY', usage: { output: 7, reasoning: 2 } },
    ]
    const path = join(root, 'synthetic.jsonl')
    writeFileSync(path, entries.map(entry => JSON.stringify(entry)).join('\n'))
    const output = execFileSync(process.execPath, [resolve('scripts/linguist-run-usage.ts'), path], { encoding: 'utf8' })
    const stats = JSON.parse(output)
    expect(stats.assistants).toBe(1)
    expect(stats.assistantUsage.output).toBe(5)
    expect(stats.compactionUsage.output).toBe(7)
    expect(stats.tools.read).toEqual({ calls: 1, results: 1, textChars: 2, utf8Bytes: 7 })
    expect(stats.compactions[0].precedingGapSecondsUpperBound).toBe(9)
    expect(output).not.toContain('PRIVATE_')
    expect(output).not.toContain('私🙂')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
