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
  /** Tag name as written (may carry a namespace prefix). */
  tagName: string
  attrsRaw: string
  attrs: Record<string, string>
  inner: string
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
    tagName: match[1]!,
    attrsRaw: match[2] ?? '',
    attrs: parseAttrs(match[2] ?? ''),
    inner: match[3] ?? '',
  }
}
