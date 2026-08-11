import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const orchestrator = readFileSync(
  new URL('../apps/electron/src/main/lib/agent-orchestrator.ts', import.meta.url),
  'utf8',
)
const diagnosticsIpc = readFileSync(
  new URL('../apps/electron/src/main/lib/linguist/diagnostics-ipc.ts', import.meta.url),
  'utf8',
)

test('LF-079: Pi 复用 Proma Base，并追加 Linguist Prompt overlay', () => {
  // LA-PROMPT-001：Pi-only 运行时始终使用 Markdown wire。
  assert.match(
    orchestrator,
    /const linguistPromptBuild = agentProfile\.kind === 'linguist'\s*\?\s*buildLinguistPrompt\(\s*sessionMeta as [^,]+,\s*getLinguistProjectService,\s*\{ renderer: 'markdown' \},?\s*\)/,
  )
  assert.match(
    orchestrator,
    /const linguistSystemPrompt = linguistPromptBuild\?\.prompt \?\? ''/,
  )
  assert.match(
    orchestrator,
    /systemPrompt: systemPromptAppend \+ buildPiAdditionalDirectoriesPrompt\(allAdditionalDirectories\)\s*\+ linguistSystemPrompt/,
  )
  assert.equal(
    orchestrator.match(/buildLinguistPrompt\(/g)?.length,
    1,
    'overlay 每次发送只构建一次',
  )
})

test('LA-PROMPT-001: Dev Diagnostics 重探测与真实发送同用 Markdown renderer', () => {
  assert.equal(
    diagnosticsIpc.match(/buildLinguistPrompt\(/g)?.length,
    1,
    '诊断探针只构建一次 prompt',
  )
  assert.match(
    diagnosticsIpc,
    /renderer: 'markdown'/,
  )
})
