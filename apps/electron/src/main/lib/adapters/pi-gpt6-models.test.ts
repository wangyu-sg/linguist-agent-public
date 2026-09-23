import { expect, test } from 'bun:test'
import * as pi from '@earendil-works/pi-coding-agent'
import { inferContextWindow, isCodexFastModeSupportedModel, resolveReasoningProfile } from '@proma/shared'
import { buildCodexModel, listCodexModels } from './pi-model-registry'

test('GPT-6 Sol 和 Luna 可拉取并用 Codex 模型构建', async () => {
  const ids = (await listCodexModels()).map((model) => model.id)
  expect(ids).toContain('gpt-6-sol')
  expect(ids).toContain('gpt-6-luna')
  expect(ids).not.toContain('gpt-5.4')
  expect(ids).not.toContain('gpt-5.5')

  const { model } = await buildCodexModel(pi, {
    model: 'gpt-6-sol',
    codexOAuthCredentials: { access: 'test', refresh: 'test', expires: Date.now() + 3_600_000 },
  })
  expect(model.id).toBe('gpt-6-sol')
  expect(model.contextWindow).toBe(372_000)
  expect(model.thinkingLevelMap?.off).toBe('none')
})

test('GPT-6 档位和窗口按精确模型家族识别', () => {
  expect(resolveReasoningProfile({ modelId: 'gpt-6-luna', transport: 'openai-responses' })?.defaultLevel).toBe('medium')
  expect(resolveReasoningProfile({ modelId: 'gpt-6-sol', transport: 'anthropic-messages' })).toBeUndefined()
  expect(inferContextWindow('gpt-6-astra-fast')).toBe(372_000)
  expect(isCodexFastModeSupportedModel('gpt-6-sol')).toBe(true)
  expect(isCodexFastModeSupportedModel('gpt-6-sol-preview')).toBe(false)
})
