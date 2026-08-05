import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const orchestrator = readFileSync(
  new URL('../apps/electron/src/main/lib/agent-orchestrator.ts', import.meta.url),
  'utf8',
)

test('LF-079: Pi 与 Claude 复用各自 Proma Base，并追加同一个 Linguist Prompt overlay', () => {
  assert.match(
    orchestrator,
    /const linguistPromptBuild = agentProfile\.kind === 'linguist'\s*\?\s*buildLinguistProjectAssetsPromptWithStatus\(\s*sessionMeta as [^,]+,\s*getLinguistProjectService,\s*\)/,
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
