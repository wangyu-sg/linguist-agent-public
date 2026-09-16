import type { BrowserInputAction, BrowserPressInput } from '@proma/shared'

/**
 * BrowserPress 的按键语义与键码。
 *
 * 导航键（PageDown / ArrowDown 等）通过 Chromium CDP 的 Input.dispatchKeyEvent
 * 派发时，必须携带 windowsVirtualKeyCode 才能被识别为真实按键并触发浏览器的
 * 默认行为（PageDown 滚动页面、Enter 提交表单、Tab 移动焦点等）。只传 key
 * 字符串时，Chromium 无法为非字符导航键推断虚拟键码，默认行为不会发生。
 */
export interface BrowserNavigationKeyCode {
  /** DOM KeyboardEvent.code，对导航键通常与 key 一致 */
  code: string
  /** Windows 虚拟键码（VK_*），Chromium 依赖它识别非字符导航键 */
  windowsVirtualKeyCode: number
}

const NAVIGATION_KEY_CODES: Record<string, BrowserNavigationKeyCode> = {
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
  ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { code: 'Delete', windowsVirtualKeyCode: 46 },
  Home: { code: 'Home', windowsVirtualKeyCode: 36 },
  End: { code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { code: 'PageDown', windowsVirtualKeyCode: 34 },
}

const MAX_BROWSER_TEXT_LENGTH = 10_000

export type BrowserPressAction =
  | { kind: 'key'; key: string; code: string; windowsVirtualKeyCode: number; modifiers: number; commands?: string[] }
  | { kind: 'text'; text: string }

/** 旧参数只在边界规范化一次，后续派发统一使用显式 action。 */
export function parseBrowserPressAction(input: string | BrowserPressInput): BrowserPressAction {
  const request = typeof input === 'string' ? { key: input } : input
  if ((request.action === undefined) === (request.key === undefined)) throw new Error('需要且只能提供 action 或 key。')
  let action: BrowserInputAction
  if (request.action !== undefined) action = request.action
  else {
    const key = request.key!
    if (/^(?:(?:Alt|Control|Ctrl|Meta|Cmd|Command|Shift)\+)+(?:[a-z0-9]|Enter|Tab|Escape|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|Space|F\d{1,2})$/i.test(key) || /^F(?:[1-9]|1[0-2])$/.test(key)) {
      throw new Error('快捷键须使用 action: { kind: "key", key, modifiers }；输入字面正文请使用 action.kind="text"。')
    }
    if (!key) throw new Error('BrowserPress 需要导航键或非空文本。')
    action = Object.hasOwn(NAVIGATION_KEY_CODES, key) ? { kind: 'key', key } : { kind: 'text', text: key === 'Space' ? ' ' : key }
  }
  if (action.kind === 'text') {
    if (typeof action.text !== 'string' || action.text.length > MAX_BROWSER_TEXT_LENGTH) throw new Error(`正文须为最多 ${MAX_BROWSER_TEXT_LENGTH} 字符的文本。`)
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(action.text)) throw new Error('输入文本包含不支持的控制字符。')
    return { kind: 'text', text: action.text }
  }
  if (action.kind !== 'key') throw new Error('未知 action kind。')
  const modifierBits = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }
  let modifiers = 0
  for (const modifier of action.modifiers ?? []) {
    if (!Object.hasOwn(modifierBits, modifier)) throw new Error('不支持的修饰键。')
    modifiers |= modifierBits[modifier]
  }
  const key = action.key
  let code = Object.hasOwn(NAVIGATION_KEY_CODES, key) ? NAVIGATION_KEY_CODES[key] : undefined
  if (/^[a-z]$/i.test(key)) code = { code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) code = { code: key, windowsVirtualKeyCode: 111 + Number(key.slice(1)) }
  if (!code) throw new Error(`不支持的按键：${key}；不会降级为正文。`)
  return { kind: 'key', key, ...code, modifiers,
    ...(key.toLowerCase() === 'a' && (modifiers === 2 || modifiers === 4) ? { commands: ['selectAll'] } : {}) }
}
