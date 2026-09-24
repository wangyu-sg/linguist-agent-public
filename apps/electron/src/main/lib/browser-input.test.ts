import { expect, test } from 'bun:test'
import { parseBrowserPressAction } from './browser-key-policy'
import { BrowserKnownFailure, assertBrowserActInput, assertBrowserPressInput, browserActSchema, browserFailureReceipt, browserStateReceipt } from './browser-operation-contract'
import type { BrowserViewState } from '@proma/shared'

test('浏览器动作回执指向实际操作标签，不携带用户标签和历史记录', () => {
  const state = {
    activeTabId: 'user-tab', agentTabId: 'agent-tab', url: 'https://user.example/', title: '用户页面',
    tabs: [
      { tabId: 'user-tab', url: 'https://user.example/', title: '用户页面', documentRevision: 2, loading: false },
      { tabId: 'agent-tab', url: 'https://agent.example/', title: '工作页面', documentRevision: 7, loading: false },
    ],
    trace: Array.from({ length: 30 }, (_, index) => ({ id: `${index}`, summary: '历史记录' })),
  } as BrowserViewState
  expect(browserStateReceipt(state, 'agent-tab', 'dispatched')).toEqual({
    tabId: 'agent-tab', url: 'https://agent.example/', title: '工作页面', documentRevision: 7, loading: false, operationStatus: 'dispatched',
  })
})

test('已识别浏览器失败返回稳定原因、目标和原始错误', () => {
  const stale = new BrowserKnownFailure('stale-ref', '元素引用已失效', { ref: 'r7' })
  expect(browserFailureReceipt(stale, 'agent-tab')).toEqual({
    tabId: 'agent-tab', operationStatus: 'failed', reasonCode: 'stale-ref', target: { ref: 'r7' }, error: '元素引用已失效',
  })
  expect(browserFailureReceipt(new BrowserKnownFailure('no-layout', '截图为空'), 'agent-tab')).toEqual({
    tabId: 'agent-tab', operationStatus: 'failed', reasonCode: 'no-layout', error: '截图为空',
  })
  try {
    assertBrowserActInput({ tabId: 'agent-tab', steps: [{ kind: 'read', probe: { expression: '() => 1', args: 'x'.repeat(64_001) } }] })
    throw new Error('过大的 probe 应被拒绝')
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserKnownFailure)
    expect(browserFailureReceipt(error as BrowserKnownFailure, 'agent-tab')).toMatchObject({
      tabId: 'agent-tab', reasonCode: 'probe-too-large', target: { probe: 'expression' }, error: 'probe args 超过数据预算。',
    })
  }
})

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
  expect(() => assertBrowserActInput({ tabId: 'tab', steps: [
    { kind: 'read', probe: { selector: '.row', attributes: ['id', 'data-tag-id'] } },
  ] })).not.toThrow()
  expect(() => assertBrowserActInput({ tabId: 'tab', steps: [
    { kind: 'read', probe: { selector: '.row', expression: '() => true' } },
  ] } as unknown as Parameters<typeof assertBrowserActInput>[0])).toThrow()
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
    expect(override?.details ?? context.result.details).toEqual(details)
  }
})
