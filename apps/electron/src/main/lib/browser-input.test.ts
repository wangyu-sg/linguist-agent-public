import { expect, test } from 'bun:test'
import { parseBrowserPressAction } from './browser-key-policy'
import { assertBrowserActInput, assertBrowserPressInput, browserActSchema } from './browser-operation-contract'

test('旧快捷键写法在派发前拒绝，普通正文和导航仍可输入', () => {
  for (const key of ['Meta+A', 'Control+A', 'Shift+Enter', 'F8']) {
    expect(() => parseBrowserPressAction(key)).toThrow('action')
  }
  expect(parseBrowserPressAction('Enter').kind).toBe('key')
  expect(parseBrowserPressAction('请按 Meta+A 选择文字')).toEqual({ kind: 'text', text: '请按 Meta+A 选择文字' })
})

test('显式正文不解释键名，显式按键严格校验并编码修饰键', () => {
  for (const text of ['Meta+A', 'Enter', 'F8', ' 😀\n ']) {
    expect(parseBrowserPressAction({ action: { kind: 'text', text } })).toEqual({ kind: 'text', text })
  }
  expect(parseBrowserPressAction({ action: { kind: 'key', key: 'a', modifiers: ['Meta', 'Shift'] } })).toMatchObject({ kind: 'key', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 12 })
  expect(parseBrowserPressAction({ action: { kind: 'key', key: 'F8' } })).toMatchObject({ kind: 'key', windowsVirtualKeyCode: 119 })
  expect(() => parseBrowserPressAction({ action: { kind: 'key', key: 'NotAKey' } })).toThrow()
  expect(() => assertBrowserPressInput({ key: 'a', action: { kind: 'text', text: 'x' } })).toThrow()
  expect(browserActSchema.type).toBe('object')
  expect(() => assertBrowserActInput({ ref:'old', steps:[] } as unknown as Parameters<typeof assertBrowserActInput>[0])).toThrow()
  expect(() => assertBrowserActInput({ tabId: 'tab', steps: [
    { kind: 'press', action: { kind: 'text', text: 'valid' } },
    { kind: 'press', action: { kind: 'key', key: 'NotAKey' } },
  ] })).toThrow()
})

test('Pi afterToolCall 将未完成序列标为错误并保留原始结构化前缀', async () => {
  const { installRuntimeGuardHooks } = await import('./adapters/pi-agent-adapter')
  const { createAgentRuntimeGuard } = await import('./agent-runtime-guards')
  const session = { agent: {} } as import('@earendil-works/pi-coding-agent').AgentSession
  installRuntimeGuardHooks(session, createAgentRuntimeGuard({}))
  type HookContext = Parameters<NonNullable<typeof session.agent.afterToolCall>>[0]
  for (const status of ['partial', 'unknown', 'failed', 'aborted', 'completed']) {
    const details = { status, completedStepCount: 2, results: [{ stepId: 'first', status: 'ok' }] }
    const context = { toolCall: { name: 'BrowserAct' }, result: { content: [{ type: 'text', text: JSON.stringify(details) }], details }, isError: false } as HookContext
    const override = await session.agent.afterToolCall!(context, new AbortController().signal)
    expect(override?.isError).toBe(status === 'completed' ? undefined : true)
    expect(override?.details ?? context.result.details).toBe(details)
  }
})
