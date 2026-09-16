// 受管浏览器对所有 Agent 会话开放；会话来源只影响 UI 标识。

export interface BrowserViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserViewLayout {
  sessionId: string
  tabId?: string
  /** Renderer 全局单调递增代际；主进程忽略晚到的旧布局 IPC。 */
  revision: number
  visible: boolean
  /** overlay 临时遮挡页面时为 true；Slot 仍挂载，session 不应进入 LRU。 */
  preserveSessionOnHide?: boolean
  bounds: BrowserViewBounds
}

export type BrowserExecutionSource = 'user' | 'automation' | 'delegation'

export type BrowserTraceAction = 'navigate' | 'observe' | 'find' | 'wait' | 'click' | 'act' | 'fill' | 'press' | 'hover' | 'drag' | 'scroll' | 'extract' | 'select' | 'upload' | 'dom' | 'script' | 'screenshot' | 'tab' | 'download' | 'popup'
export type BrowserOperationStatus = 'dispatched' | 'verified' | 'failed' | 'unknown'

/** 脱敏的浏览器操作账本项；绝不含输入正文、Cookie、截图或脚本全文。 */
export interface BrowserTraceItem {
  id: string
  action: BrowserTraceAction
  summary: string
  at: number
  /** 兼容旧 UI：仅 failed/unknown 为 false。新代码应使用 status。 */
  success: boolean
  status: BrowserOperationStatus
  tabId: string
  domain: string | null
  executionSource: BrowserExecutionSource
}

export interface BrowserTabState {
  tabId: string
  url: string
  title: string
  loading: boolean
  visible: boolean
  canGoBack: boolean
  canGoForward: boolean
  trace: BrowserTraceItem[]
}

export interface BrowserTabSummary {
  tabId: string
  url: string
  title: string
  /** 页面声明的 HTTP(S) favicon；未提供或加载失败时 renderer 使用默认图标。 */
  favicon?: string
  loading: boolean
  /** 此标签由 Agent 创建（与当前默认工作标签无关）。 */
  openedByAgent: boolean
  /** 此标签由页面 window.open / target=_blank 创建。 */
  openedByPopup: boolean
}

export interface BrowserViewState {
  sessionId: string
  /** 非用户触发时，面板可显示来源并提供停止当前 Agent run 的控制。 */
  executionSource: BrowserExecutionSource
  /** 用户在浏览器面板中查看的 tab。 */
  activeTabId: string
  /** Agent 的默认工作 tab；被用户关闭后为 null，绝不回退到用户标签。 */
  agentTabId: string | null
  tabs: BrowserTabSummary[]
  /** 当前 active tab 的投影，保留扁平字段方便工具和旧 renderer 使用。 */
  url: string
  title: string
  loading: boolean
  visible: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** 脱敏的操作账本，始终代表当前会话，非单一显示标签。 */
  trace: BrowserTraceItem[]
  /** 最近一条 Agent 操作，用于用户未查看工作 tab 时的非阻断活动提示。 */
  activity: BrowserTraceItem | null
}

/** 通知 renderer 当前会话的受管浏览器已销毁。 */
export interface BrowserSessionClosed {
  sessionId: string
  closed: true
}

export type BrowserStateChange = BrowserViewState | BrowserSessionClosed

/** 原生 WebContentsView 获得用户焦点；renderer 用它同步双 Pane 焦点与工具栏目标。 */
export interface BrowserTabFocusChange {
  sessionId: string
  tabId: string
}

export interface BrowserNavigateInput {
  sessionId: string
  tabId?: string
  url: string
}

export interface BrowserTabInput {
  sessionId: string
  tabId?: string
}

export interface BrowserCreateTabInput {
  sessionId: string
  url?: string
}

/** 浏览器工具跨进程传递的数据；不携带函数或页面节点。 */
export type BrowserJsonValue = null | boolean | number | string | BrowserJsonValue[] | { [key: string]: BrowserJsonValue }
export type BrowserKeyModifier = 'Alt' | 'Control' | 'Meta' | 'Shift'
export type BrowserInputAction =
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: string; modifiers?: BrowserKeyModifier[] }
export type BrowserTarget = { ref: string; selector?: never } | { selector: string; ref?: never }
export type BrowserInputTarget = BrowserTarget & { focus?: 'activate' | 'verify' }
export interface BrowserProbe {
  /** 同步只读函数表达式，args 经 JSON 作为数据传入。 */
  expression: string
  args?: BrowserJsonValue
}
export interface BrowserGuard { probe: BrowserProbe; expected: BrowserJsonValue }
export interface BrowserPressInput {
  action?: BrowserInputAction
  /** 仅供原有导航/普通正文调用；与 action 互斥。 */
  key?: string
  target?: BrowserInputTarget
  guard?: BrowserGuard
}
export type BrowserSequenceStep = { stepId?: string; itemId?: string } & (
  | { kind: 'click'; target: BrowserTarget; guard?: BrowserGuard }
  | { kind: 'focus'; target: BrowserTarget }
  | ({ kind: 'press'; action: BrowserInputAction } & Omit<BrowserPressInput, 'key' | 'action'>)
  | { kind: 'fill'; target: BrowserTarget; text: string; guard?: BrowserGuard }
  | { kind: 'scroll'; selector?: string; deltaY?: number; position?: 'top' | 'bottom' }
  | { kind: 'read'; probe: BrowserProbe }
  | ({ kind: 'check' } & BrowserGuard)
  | ({ kind: 'wait'; timeoutMs?: number } & BrowserGuard)
)
export type BrowserActInput =
  | { ref: string; waitFor?: { kind: 'url' | 'text' | 'selector'; value: string }; timeoutMs?: number; tabId?: string; steps?: never }
  | { steps: BrowserSequenceStep[]; tabId: string; timeoutMs?: number; ref?: never; waitFor?: never }
export interface BrowserSequenceResult {
  status: 'completed' | 'partial' | 'failed' | 'aborted' | 'unknown'
  tabId: string
  completedStepCount: number
  stoppedAt?: number
  results: Array<{ stepId: string; itemId?: string; status: 'ok' | 'mismatch' | 'failed' | 'unknown'; value?: BrowserJsonValue }>
  unexecutedFrom?: number
  timing: { queuedMs: number; elapsedMs: number; waitMs: number }
}
