/**
 * Small dependency-free XML helpers for the XLIFF adapter.
 *
 * PROVENANCE (docs/attribution/SOURCE_PROVENANCE.md, PB-023): the helper
 * logic in this file is adapted from the legacy repo
 * (wangyu-sg/linguist-agent @ la-v2-legacy-freeze-2026-07-25,
 * packages/cat-formats/src/generic_xliff.ts — decodeXmlInline /
 * encodeXmlText / encodeXmlInline / encodeXmlAttr / parseAttrs / setAttr /
 * findFirst, AGPL-3.0 same author). Style adapted to this package
 * (single quotes, no semicolons); semantics unchanged.
 *
 * Why not a DOM: plain bun/node has no DOM, and the adapter must stay
 * runtime-agnostic with zero external dependencies. The regex helpers below
 * cover the XLIFF 1.2 trans-unit shape the adapter supports; they are NOT a
 * general XML parser.
 */

/** Decodes the five predefined XML entities everywhere in `value`. */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Decodes entities and unwraps CDATA sections, but keeps inline markup
 * (`<g>`, `<x/>`, `<ph>`, `<bpt>/<ept>`, ...) verbatim. Segment source/target
 * strings therefore carry their inline tags, which is what makes export
 * round-trip fidelity possible.
 */
export function decodeXmlInline(value: string): string {
  return decodeXmlEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
}

/** Escapes a text run for XML output (& < >). */
export function encodeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Escapes text runs but re-inserts tag-looking substrings verbatim, so
 * segment strings that carry inline tags (see decodeXmlInline) are written
 * back as real markup. NOTE: entity escaping inside tag payloads is
 * normalized (e.g. `&quot;` inside a `<ph>` payload becomes a literal `"`) —
 * well-formed XML either way, but not byte-identical to a non-canonical
 * original. Only modified segments are ever rewritten, so unmodified export
 * stays byte-stable.
 */
export function encodeXmlInline(value: string): string {
  const tagPattern = /<\/?[\w:.-]+\b[^>]*\/?>/g
  let cursor = 0
  let next = ''
  for (const match of value.matchAll(tagPattern)) {
    next += encodeXmlText(value.slice(cursor, match.index))
    next += match[0]
    cursor = (match.index ?? 0) + match[0].length
  }
  next += encodeXmlText(value.slice(cursor))
  return next
}

/** Escapes a value for use inside a double-quoted XML attribute. */
export function encodeXmlAttr(value: string): string {
  return encodeXmlText(value).replace(/"/g, '&quot;')
}

/** Parses an attribute string into a decoded name -> value record. */
export function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([\w:.-]+)\s*=\s*(["'])(.*?)\2/g
  for (const match of raw.matchAll(pattern)) attrs[match[1]!] = decodeXmlEntities(match[3] ?? '')
  return attrs
}

/** Sets (or appends) an attribute inside a raw attribute string. */
export function setAttr(attrsRaw: string, name: string, value: string): string {
  const encoded = encodeXmlAttr(value)
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(["'])(.*?)\\2`, 'i')
  if (pattern.test(attrsRaw)) return attrsRaw.replace(pattern, `$1$2${encoded}$2`)
  return `${attrsRaw} ${name}="${encoded}"`
}

export interface FoundElement {
  /** The full matched element markup, e.g. `<target state="new">x</target>`. */
  full: string
  /** Character offsets within the searched block. */
  start: number
  end: number
  /** Tag name as written (may carry a namespace prefix). */
  tagName: string
  attrsRaw: string
  attrs: Record<string, string>
  inner: string
  selfClosing?: boolean
}

export interface XliffElementSpan extends FoundElement {
  localName: string
  start: number
  openEnd: number
  contentStart: number
  contentEnd: number
  end: number
  parent?: XliffElementSpan
}

function markupEnd(xml: string, start: number): number {
  if (xml.startsWith('<!--', start)) {
    const end = xml.indexOf('-->', start + 4)
    return end < 0 ? xml.length : end + 3
  }
  if (xml.startsWith('<![CDATA[', start)) {
    const end = xml.indexOf(']]>', start + 9)
    return end < 0 ? xml.length : end + 3
  }
  if (xml.startsWith('<?', start)) {
    const end = xml.indexOf('?>', start + 2)
    return end < 0 ? xml.length : end + 2
  }
  let quote = ''
  for (let index = start + 1; index < xml.length; index += 1) {
    const char = xml[index]!
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return index + 1
  }
  return xml.length
}

/** XLIFF 目标 span 索引：只建元素父子关系与字节位置，不解析或重序列化 XML。 */
export class XliffSpanIndex {
  readonly elements: XliffElementSpan[] = []

  constructor(readonly xml: string) {
    const stack: XliffElementSpan[] = []
    for (let cursor = 0; cursor < xml.length;) {
      const start = xml.indexOf('<', cursor)
      if (start < 0) break
      const end = markupEnd(xml, start)
      const markup = xml.slice(start, end)
      cursor = Math.max(end, start + 1)
      if (/^<(?:!|\?)/.test(markup)) continue

      const closing = /^<\/\s*([\w:.-]+)/.exec(markup)
      if (closing) {
        const tagName = closing[1]!
        const stackIndex = stack.findLastIndex((candidate) => candidate.tagName === tagName)
        if (stackIndex < 0) continue
        const node = stack[stackIndex]!
        stack.length = stackIndex
        node.contentEnd = start
        node.end = end
        node.inner = xml.slice(node.contentStart, node.contentEnd)
        node.full = xml.slice(node.start, node.end)
        continue
      }

      const opening = /^<\s*([\w:.-]+)([\s\S]*?)\/?\s*>$/.exec(markup)
      if (!opening) continue
      const selfClosing = /\/\s*>$/.test(markup)
      const attrsRaw = opening[2] ?? ''
      const tagName = opening[1]!
      const node: XliffElementSpan = {
        full: markup,
        tagName,
        localName: tagName.split(':').at(-1)!.toLowerCase(),
        attrsRaw,
        attrs: parseAttrs(attrsRaw),
        inner: '',
        selfClosing,
        start,
        openEnd: end,
        contentStart: end,
        contentEnd: selfClosing ? end : 0,
        end: selfClosing ? end : 0,
        ...(stack.at(-1) === undefined ? {} : { parent: stack.at(-1) }),
      }
      this.elements.push(node)
      if (!selfClosing) stack.push(node)
    }
  }

  find(localName: string): XliffElementSpan[] {
    const expected = localName.toLowerCase()
    return this.elements.filter((element) => element.end > 0 && element.localName === expected)
  }
}

/** 查找当前 block 的 direct child；若 block 本身是单一根元素，则查其 direct child。 */
export function findDirectChild(block: string, name: string): FoundElement | undefined {
  const index = new XliffSpanIndex(block)
  const roots = index.elements.filter((element) => element.parent === undefined && element.end > 0)
  const parent = roots.length === 1 && roots[0]!.localName !== name.toLowerCase()
    ? roots[0]
    : undefined
  return index.find(name).find((element) => element.parent === parent)
}

/**
 * Finds the first `<name>...</name>` element in `block` (namespace-prefix
 * tolerant). Returns undefined when absent. Non-greedy: does not support
 * nested elements of the same name (fine for source/target/note).
 */
export function findFirst(block: string, name: string): FoundElement | undefined {
  const pattern = new RegExp(`<((?:[\\w.-]+:)?${name})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'i')
  const match = pattern.exec(block)
  if (!match) return undefined
  return {
    full: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    tagName: match[1]!,
    attrsRaw: match[2] ?? '',
    attrs: parseAttrs(match[2] ?? ''),
    inner: match[3] ?? '',
  }
}
