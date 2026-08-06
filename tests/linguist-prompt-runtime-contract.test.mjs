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

test('LF-079: Pi 与 Claude 复用各自 Proma Base，并追加同一个 Linguist Prompt overlay', () => {
  // LA-PROMPT-001：同一份 canonical prompt contract，wire 表达随 runtime 推导
  // （pi → markdown，其余 → xml）；Claude 输出保持 byte 级历史一致。
  assert.match(
    orchestrator,
    /const linguistPromptBuild = agentProfile\.kind === 'linguist'\s*\?\s*buildLinguistProjectAssetsPromptWithStatus\(\s*sessionMeta as [^,]+,\s*getLinguistProjectService,\s*\{ renderer: agentRuntime === 'pi' \? 'markdown' : 'xml' \},?\s*\)/,
  )
  assert.match(
    orchestrator,
    /const linguistSystemPrompt = linguistPromptBuild\?\.prompt \?\? ''/,
  )
  assert.match(
    orchestrator,
    /systemPrompt: systemPromptAppend \+ buildPiAdditionalDirectoriesPrompt\(allAdditionalDirectories\)\s*\+ linguistSystemPrompt/,
  )
  assert.match(
    orchestrator,
    /preset: 'claude_code',\s*append: systemPromptAppend \+ linguistSystemPrompt,/,
  )
  assert.equal(
    orchestrator.match(/buildLinguistProjectAssetsPromptWithStatus\(/g)?.length,
    1,
    'overlay 每次发送只构建一次',
  )
})

test('LA-PROMPT-001: Dev Diagnostics 重探测与真实发送同一 runtime→renderer 推导', () => {
  assert.equal(
    diagnosticsIpc.match(/buildLinguistProjectAssetsPromptWithStatus\(/g)?.length,
    1,
    '诊断探针只构建一次 prompt',
  )
  assert.match(
    diagnosticsIpc,
    /renderer: session\?\.agentRuntime === 'pi' \? 'markdown' : 'xml'/,
  )
})
