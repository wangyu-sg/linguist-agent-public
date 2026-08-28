import { sha256Hex, type HashFn } from '../hash'
import { FormatExportError } from '../errors'
import {
  decodeXmlEntities,
  encodeXmlInline,
  encodeXmlText,
  findFirst,
  parseAttrs,
  setAttr,
} from './xliff-xml'
import { XliffAdapter, type XliffParsedUnit } from './xliff'

export const MQXLIFF_ADAPTER_ID = 'mqxliff_1_2'
const MQ_NAMESPACE_PATTERN = /xmlns:mq\s*=\s*(["'])(?:MQXliff|[^"']*memoq[^"']*)\1/i
const FILE_PATTERN = /<((?:[\w.-]+:)?file)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const TRANS_UNIT_PATTERN = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const INLINE_CODE_PATTERN = /<((?:[\w.-]+:)?(?:bpt|ept|ph))\b[^>]*>([\s\S]*?)<\/\1>/gi

interface MqInlineCode {
  rawXml: string
  value: string
}

function mqTimestamp(now: string): string {
  return now.replace(/\.\d{3}Z$/, 'Z')
}

function inlineCodes(value: string): MqInlineCode[] {
  return Array.from(value.matchAll(INLINE_CODE_PATTERN)).map((match) => {
    const decoded = decodeXmlEntities(match[2] ?? '')
    const val = /\bval\s*=\s*(["'])(.*?)\1/i.exec(decoded)?.[2]
    return { rawXml: match[0], value: decodeXmlEntities(val ?? decoded) }
  })
}

function decodeMqInline(value: string): string {
  const parts: string[] = []
  let cursor = 0
  for (const match of value.matchAll(INLINE_CODE_PATTERN)) {
    const start = match.index ?? 0
    parts.push(decodeXmlEntities(value.slice(cursor, start)))
    parts.push(inlineCodes(match[0])[0]?.value ?? '')
    cursor = start + match[0].length
  }
  parts.push(decodeXmlEntities(value.slice(cursor)))
  return parts.join('')
}

function codeSignature(text: string, codes: readonly MqInlineCode[]): string[] {
  const values = [...new Set(codes.map((code) => code.value).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
  const signature: string[] = []
  for (let cursor = 0; cursor < text.length;) {
    const value = values.find((candidate) => text.startsWith(candidate, cursor))
    if (value === undefined) cursor += 1
    else {
      signature.push(value)
      cursor += value.length
    }
  }
  return signature
}

function encodeMqTarget(text: string, sourceInner: string): string {
  const codes = inlineCodes(sourceInner)
  if (codes.length === 0) return encodeXmlInline(text)
  const expected = codes.map((code) => code.value)
  const actual = codeSignature(text, codes)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new FormatExportError(
      MQXLIFF_ADAPTER_ID,
      'memoQ inline code sequence changed; mq:rxt/mq:ch and bpt/ept/ph must be preserved exactly',
    )
  }
  const queues = new Map<string, MqInlineCode[]>()
  for (const code of codes) queues.set(code.value, [...(queues.get(code.value) ?? []), code])
  const values = [...queues.keys()].sort((left, right) => right.length - left.length)
  let out = ''
  for (let cursor = 0; cursor < text.length;) {
    const value = values.find((candidate) => text.startsWith(candidate, cursor))
    if (value === undefined) {
      out += encodeXmlText(text[cursor]!)
      cursor += 1
    } else {
      out += queues.get(value)!.shift()!.rawXml
      cursor += value.length
    }
  }
  return out
}

function rewriteMqTargetInUnit(full: string, targetText: string, now: string, status: string): string {
  const source = findFirst(full, 'source')
  if (!source) return full
  const target = findFirst(full, 'target')
  const encoded = encodeMqTarget(targetText, source.inner)
  const nextTarget = target
    ? `<${target.tagName}${setAttr(target.attrsRaw, 'xml:space', 'preserve')}>${encoded}</${target.tagName}>`
    : `<target xml:space="preserve">${encoded}</target>`
  let next = target
    ? full.replace(target.full, nextTarget)
    : full.replace(source.full, `${source.full}${nextTarget}`)
  const open = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>/i.exec(next)
  if (open) {
    let attrs = setAttr(open[2] ?? '', 'mq:status', status)
    attrs = setAttr(attrs, 'mq:lastchangedtimestamp', mqTimestamp(now))
    next = next.replace(open[0], `<${open[1]}${attrs}>`)
  }
  return next
}

export class MqXliffAdapter extends XliffAdapter {
  override readonly id: string = MQXLIFF_ADAPTER_ID
  override readonly extensions = ['.mqxliff']

  constructor(
    hash: HashFn = sha256Hex,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    super(hash)
  }

  override async detect(input: Uint8Array, filename: string): Promise<number> {
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input)
    } catch {
      return 0
    }
    if (!/<(?:[\w.-]+:)?xliff\b/i.test(text) || !MQ_NAMESPACE_PATTERN.test(text)) return 0
    return filename.toLowerCase().endsWith('.mqxliff') ? 1 : 0.95
  }

  protected override decodeInline(value: string): string {
    return decodeMqInline(value)
  }

  protected override encodeTarget(value: string, unit: XliffParsedUnit): string {
    return encodeMqTarget(value, unit.source.inner)
  }

  protected override rewriteUnit(unit: XliffParsedUnit, newTarget: string): string {
    const rewritten = super.rewriteUnit(unit, newTarget)
    const open = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>/i.exec(rewritten)
    if (!open) return rewritten
    let attrs = setAttr(open[2] ?? '', 'mq:status', 'ConfirmedTranslator')
    attrs = setAttr(attrs, 'mq:lastchangedtimestamp', mqTimestamp(this.now()))
    return rewritten.replace(open[0], `<${open[1]}${attrs}>`)
  }
}

export interface MqXliffDefectWrite {
  id: string
  suggested?: string
  severity: string
  issueType: string
  comment: string
  disposition?: string
}

export interface MqXliffDefectWriteResult {
  content: string
  updatedIds: string[]
  commentedIds: string[]
  skippedLockedIds: string[]
  missingIds: string[]
}

/** memoQ 原生缺陷批注写回；只改命中的 trans-unit，其他单元逐字节不动。 */
export function writeMqXliffDefects(
  content: string,
  defects: readonly MqXliffDefectWrite[],
  now = new Date().toISOString(),
): MqXliffDefectWriteResult {
  const byId = new Map(defects.map((defect) => [defect.id, defect]))
  const seen = new Set<string>()
  const updatedIds: string[] = []
  const commentedIds: string[] = []
  const skippedLockedIds: string[] = []
  FILE_PATTERN.lastIndex = 0
  const lockedFileRanges = [...content.matchAll(FILE_PATTERN)]
    .filter((match) => (parseAttrs(match[2] ?? '').translate ?? '').trim().toLowerCase() === 'no')
    .map((match) => {
      const start = match.index ?? 0
      return { start, end: start + match[0].length }
    })
  const next = content.replace(TRANS_UNIT_PATTERN, (full, _tagName, attrsRaw, _inner, offset: number) => {
    const attrs = parseAttrs(attrsRaw ?? '')
    const id = attrs.id ?? ''
    const defect = byId.get(id)
    if (!defect) return full
    seen.add(id)
    const fileLocked = lockedFileRanges.some((range) => offset >= range.start && offset < range.end)
    const locked = fileLocked || (attrs.translate ?? '').toLowerCase() === 'no'
      || ['1', 'true', 'yes', 'locked'].includes((attrs['mq:locked'] ?? '').toLowerCase())
    if (locked) {
      skippedLockedIds.push(id)
      return full
    }
    let unit = full
    if (defect.disposition === 'defect' && defect.suggested !== undefined) {
      unit = rewriteMqTargetInUnit(unit, defect.suggested, now, 'Edited')
      updatedIds.push(id)
    }
    const text = `[${defect.severity} ${defect.issueType} / ${defect.disposition ?? ''}] ${defect.comment}${defect.suggested === undefined ? '' : ` | suggested=${defect.suggested}`}`
    const commentId = `la-${sha256Hex(new TextEncoder().encode(`${id}|${text}|${now}`)).slice(0, 24)}`
    const comment = `<mq:comment id="${commentId}" creatoruser="linguist-agent" time="${mqTimestamp(now)}" deleted="false" category="0" appliesto="Row" origin="ai_review">${encodeXmlText(text)}</mq:comment>`
    const comments = findFirst(unit, 'comments')
    unit = comments
      ? unit.replace(comments.full, comments.full.replace(`</${comments.tagName}>`, `${comment}</${comments.tagName}>`))
      : unit.replace(/<\/((?:[\w.-]+:)?trans-unit)>/i, `<mq:comments>${comment}</mq:comments></$1>`)
    commentedIds.push(id)
    return unit
  })
  return {
    content: next,
    updatedIds,
    commentedIds,
    skippedLockedIds,
    missingIds: defects.map((defect) => defect.id).filter((id) => !seen.has(id)),
  }
}
