export type AgentIslandNavigationDisposition = 'allow-internal' | 'open-external' | 'deny'

const DEV_RENDERER_ORIGIN = 'http://127.0.0.1:5173'

/**
 * Agent Island 持有完整 preload bridge，顶层导航只能回到自身开发渲染页。
 * 其余 HTTP(S) 链接交给系统浏览器，所有其他 scheme 一律拒绝。
 */
export function classifyAgentIslandNavigation(
  url: string,
  isDevelopment: boolean,
): AgentIslandNavigationDisposition {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'deny'
  }

  if (isDevelopment && parsed.origin === DEV_RENDERER_ORIGIN) {
    return 'allow-internal'
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return 'open-external'
  }
  return 'deny'
}
