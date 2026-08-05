import { describe, expect, test } from 'bun:test'
import { classifyAgentIslandNavigation } from './agent-island-navigation-policy'

describe('Agent Island 导航策略', () => {
  test('Given 开发环境的 Island 渲染页 When 顶层导航 Then 仅允许本地 Vite origin', () => {
    expect(classifyAgentIslandNavigation(
      'http://127.0.0.1:5173?window=agent-island&platform=darwin',
      true,
    )).toBe('allow-internal')
    expect(classifyAgentIslandNavigation(
      'http://127.0.0.1:5174?window=agent-island',
      true,
    )).toBe('open-external')
  })

  test('Given 任意外部 HTTPS 页面 When Island 请求导航 Then 交由系统浏览器而不保留 Bridge', () => {
    expect(classifyAgentIslandNavigation('https://example.com/path', true)).toBe('open-external')
    expect(classifyAgentIslandNavigation('https://example.com/path', false)).toBe('open-external')
  })

  test('Given 非 HTTP(S) 或打包页跳转 When Island 请求导航 Then fail closed', () => {
    expect(classifyAgentIslandNavigation('file:///tmp/untrusted.html', false)).toBe('deny')
    expect(classifyAgentIslandNavigation('about:blank', true)).toBe('deny')
    expect(classifyAgentIslandNavigation('not a url', true)).toBe('deny')
  })
})
