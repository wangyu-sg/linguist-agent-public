import { Type } from 'typebox'
import { Script } from 'node:vm'
import { Check } from 'typebox/value'
import type { BrowserActInput, BrowserPressInput, BrowserProbe, BrowserGuard } from '@proma/shared'
import { parseBrowserPressAction } from './browser-key-policy'

const selector = Type.String({ minLength: 1, maxLength: 1000, description: 'CSS selector observed in the current page; no guessed targets.' })
const ref = Type.String({ minLength: 1, description: 'Current BrowserObserve/Find reference from this tab.' })
const target = (input = false) => Type.Union([
  Type.Object({ ref, ...(input ? { focus: Type.Optional(Type.Union([Type.Literal('activate'), Type.Literal('verify')], { description: 'Default verify preserves an existing selection; activate focuses the input first.' })) } : {}) }, { additionalProperties: false }),
  Type.Object({ selector, ...(input ? { focus: Type.Optional(Type.Union([Type.Literal('activate'), Type.Literal('verify')], { description: 'Default verify preserves an existing selection; activate focuses the input first.' })) } : {}) }, { additionalProperties: false }),
], { description: 'An observed ref or selector, exclusively. Input targets must be the actual editable node.' })
const probe = Type.Object({
  expression: Type.String({ minLength: 1, maxLength: 20000, description: 'Synchronous read-only function expression (args) => JSON, based on observed DOM. No mutations, events, requests, timers or promises.' }),
  args: Type.Optional(Type.Unknown({ description: 'JSON data passed to the function; never interpolated as source code.' })),
}, { additionalProperties: false })
const expected = Type.Unknown({ description: 'Complete expected JSON, compared strictly without trimming or text normalization.' })
const guard = Type.Object({ probe, expected }, { additionalProperties: false, description: 'Re-read immediately before mutation; mismatch prevents dispatch.' })
const text = Type.String({ maxLength: 10000, description: 'Exact literal text including spaces, Unicode and line breaks; never interpreted as keys.' })
const action = Type.Union([
  Type.Object({ kind: Type.Literal('text'), text }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('key'), key: Type.String({ minLength: 1, description: 'Navigation key, a-z/A-Z or F1-F12. Unknown keys fail without typing.' }), modifiers: Type.Optional(Type.Array(Type.Union(['Alt', 'Control', 'Meta', 'Shift'].map(value => Type.Literal(value))), { uniqueItems: true, maxItems: 4, description: 'Modifier keys held for this event only.' })) }, { additionalProperties: false }),
], { description: 'Explicit literal text or physical key action.' })
export const browserPressSchema = Type.Object({
  action: Type.Optional(action), key: Type.Optional(Type.String({ description: 'Legacy navigation key or ordinary text, mutually exclusive with action. Complete shortcut strings are rejected.' })),
  target: Type.Optional(target(true)), guard: Type.Optional(guard), tabId: Type.Optional(Type.String({ description: 'Agent working tab if omitted.' })),
}, { additionalProperties: false })
const identifiers = {
  stepId: Type.Optional(Type.String({ maxLength: 100, description: 'Result correlation identifier; defaults to the step index.' })),
  itemId: Type.Optional(Type.String({ maxLength: 200, description: 'Optional row/job log identifier; grants no permission or target identity.' })),
}
const step = (properties: Parameters<typeof Type.Object>[0]) => Type.Object({ ...identifiers, ...properties }, { additionalProperties: false })
// 工具参数的根保持 object；两种动作互斥关系由派发前校验落实。
export const browserActSchema = Type.Object({
  ref: Type.Optional(ref),
  waitFor: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal('url'), Type.Literal('text'), Type.Literal('selector')]), value: Type.String({ minLength: 1, maxLength: 2000, description: 'Legacy click wait condition.' }) }, { additionalProperties: false })),
  steps: Type.Optional(Type.Array(Type.Union([
      step({ kind: Type.Literal('click'), target: target(), guard: Type.Optional(guard) }),
      step({ kind: Type.Literal('focus'), target: target() }),
      step({ kind: Type.Literal('press'), action, target: Type.Optional(target(true)), guard: Type.Optional(guard) }),
      step({ kind: Type.Literal('fill'), target: target(), text, guard: Type.Optional(guard) }),
      step({ kind: Type.Literal('scroll'), selector: Type.Optional(selector), deltaY: Type.Optional(Type.Number({ minimum: -50000, maximum: 50000 })), position: Type.Optional(Type.Union([Type.Literal('top'), Type.Literal('bottom')])) }),
      step({ kind: Type.Literal('read'), probe }),
      step({ kind: Type.Literal('check'), probe, expected }),
      step({ kind: Type.Literal('wait'), probe, expected, timeoutMs: Type.Optional(Type.Number({ minimum: 1, maximum: 30000, description: 'Condition deadline, additionally limited by remaining sequence time.' })) }),
    ]), { minItems: 1, maxItems: 64, description: 'Flat bounded sequence on one tab; no branching, retries, loops or nested flows. Failed/unknown prefix is not replayed.' })),
  tabId: Type.Optional(Type.String({ minLength: 1, description: 'Required explicit tab for steps; legacy click defaults to the working tab.' })),
  timeoutMs: Type.Optional(Type.Number({ minimum: 250, maximum: 30000, description: 'Steps: total budget including queue wait, default/max 30000ms. Legacy click: wait budget, default 10000ms.' })),
}, { additionalProperties: false })

function assertProbe(probe: BrowserProbe): void {
  // 只编译语法，不在宿主执行页面代码；读取仍由 Chromium 的 side-effect check 执行。
  new Script(`(${probe.expression})`)
  if (probe.args !== undefined && JSON.stringify(probe.args).length > 64000) throw new Error('probe args 超过数据预算。')
}
function assertGuard(guard: BrowserGuard): void {
  assertProbe(guard.probe)
  const json = JSON.stringify(guard.expected)
  if (json === undefined || json.length > 64000) throw new Error('expected 须为不超过 64000 字符的 JSON。')
}

export function assertBrowserPressInput(input: BrowserPressInput): void {
  if (!Check(browserPressSchema, input) || (input.action === undefined) === (input.key === undefined)) throw new Error('BrowserPress 需要且只能提供 action 或旧 key；target 必须为一个 ref 或 selector。')
  parseBrowserPressAction(input)
  if (input.guard) assertGuard(input.guard)
}
export function assertBrowserActInput(input: BrowserActInput): void {
  if (!Check(browserActSchema, input) || (input.steps !== undefined ? input.ref !== undefined || input.waitFor !== undefined || !input.tabId : !input.ref)) throw new Error('BrowserAct 参数无效：ref/waitFor 与 steps 互斥，steps 为 1–64 个合法步骤，总预算不超过 30 秒。')
  for (const step of input.steps ?? []) {
    if (step.kind === 'read') assertProbe(step.probe)
    if (step.kind === 'check' || step.kind === 'wait') assertGuard(step)
    if ('guard' in step && step.guard) assertGuard(step.guard)
    if (step.kind === 'press') parseBrowserPressAction({ action: step.action })
    if (step.kind === 'fill') parseBrowserPressAction({ action: { kind: 'text', text: step.text } })
    if (step.kind === 'scroll' && (step.deltaY === undefined) === (step.position === undefined)) throw new Error('scroll 必须且只能提供 deltaY 或 position。')
  }
}
