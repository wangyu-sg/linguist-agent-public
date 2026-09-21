/** 只读指定 Pi JSONL：仅输出计数、原始 usage 与时间边界，不输出客户正文或摘要。 */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const [file, from, until] = process.argv.slice(2)
if (!file) throw new Error('用法：bun scripts/linguist-run-usage.ts <Pi JSONL> [开始 ISO 时间] [结束 ISO 时间]')
const start = from ? Date.parse(from) : -Infinity
const end = until ? Date.parse(until) : Infinity
if (Number.isNaN(start) || Number.isNaN(end) || start > end) throw new Error('时间范围无效')
interface Entry {
  id?: string
  type: string
  timestamp?: string
  tokensBefore?: number
  usage?: Record<string, unknown>
  message?: {
    role: string; model?: string; provider?: string; api?: string
    toolName?: string
    usage?: Record<string, unknown>
    content?: Array<{ type: string; text?: string; name?: string }>
  }
}
const seen = new Set<string>()
const tools: Record<string, { calls: number; results: number; textChars: number; utf8Bytes: number }> = {}
const models = new Set<string>()
const assistantUsage: Record<string, number> = {}
const compactionUsage: Record<string, number> = {}
const fields = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'totalTokens']
const compactions: Array<{ timestamp?: string; tokensBefore?: number; precedingGapSecondsUpperBound: number | null }> = []
let first: string | undefined
let last: string | undefined
let previous: number | undefined
let assistants = 0
for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
  if (!line.trim()) continue
  const entry = JSON.parse(line) as Entry
  if (entry.id && seen.has(entry.id)) continue
  if (entry.id) seen.add(entry.id)
  const time = entry.timestamp ? Date.parse(entry.timestamp) : NaN
  if (time < start || time > end || Number.isNaN(time)) continue
  first ??= entry.timestamp
  last = entry.timestamp
  const message = entry.message
  if (entry.type === 'message' && message?.role === 'assistant') {
    assistants += 1
    models.add(`${message.provider ?? 'unknown'}/${message.api ?? 'unknown'}/${message.model ?? 'unknown'}`)
    for (const block of message.content ?? []) {
      if (block.type !== 'toolCall') continue
      const item = tools[block.name ?? 'unknown'] ??= { calls: 0, results: 0, textChars: 0, utf8Bytes: 0 }
      item.calls += 1
    }
  }
  if (entry.type === 'message' && message?.role === 'toolResult') {
    const item = tools[message.toolName ?? 'unknown'] ??= { calls: 0, results: 0, textChars: 0, utf8Bytes: 0 }
    item.results += 1
    for (const block of message.content ?? []) {
      if (block.type !== 'text') continue
      item.textChars += [...(block.text ?? '')].length
      item.utf8Bytes += Buffer.byteLength(block.text ?? '', 'utf8')
    }
  }
  const usage = entry.type === 'compaction' ? entry.usage : message?.role === 'assistant' ? message.usage : undefined
  const totals = entry.type === 'compaction' ? compactionUsage : assistantUsage
  for (const field of fields) {
    if (typeof usage?.[field] === 'number') totals[field] = (totals[field] ?? 0) + usage[field]
  }
  if (entry.type === 'compaction') compactions.push({ timestamp: entry.timestamp, tokensBefore: entry.tokensBefore, precedingGapSecondsUpperBound: previous === undefined ? null : (time - previous) / 1000 })
  previous = time
}
console.log(JSON.stringify({
  range: { first, last }, assistants, models: [...models], tools, assistantUsage, compactionUsage, compactions,
  semantics: 'Pi 原始 usage 分栏累计；reasoning 若包含于 output 不再相加。缺字段为未记录。文本字符按 Unicode code point；不是 token。相邻日志间隔是压缩耗时上界，不是模型思考时间或精确压缩时间。未记录完整 Provider 请求、账单、授权等待和有效 effort 时均未知。并行会话应另取区间并集，不相加墙钟时间。',
}, null, 2))
