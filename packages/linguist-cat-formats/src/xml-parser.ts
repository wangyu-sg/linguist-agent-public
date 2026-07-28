import { DOMParser } from '@xmldom/xmldom'
import type { ImportWarning } from './adapter'
import { FormatParseError } from './errors'

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'

export interface XmlLocalePairOptions {
  sourceLocale: string
  targetLocale: string
  filename?: string
}

export interface LocalizedElement {
  element: Element
  locale: string
}

export function parseXml(
  bytes: Uint8Array,
  adapterId: string,
  filename: string,
): Document {
  let xml: string
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new FormatParseError(adapterId, filename, '文件不是有效的 UTF-8 XML', { cause })
  }

  // xmldom 不读取外部资源；同时拒绝内部实体声明，避免实体扩展攻击。
  if (/<!ENTITY\b/i.test(xml)) {
    throw new FormatParseError(adapterId, filename, '不允许 XML 实体声明')
  }

  const issues: string[] = []
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => issues.push(String(message)),
      error: (message) => issues.push(String(message)),
      fatalError: (message) => issues.push(String(message)),
    },
  }).parseFromString(xml, 'application/xml')

  if (issues.length > 0 || document.documentElement === null) {
    throw new FormatParseError(adapterId, filename, `XML 格式错误${issues[0] ? `：${issues[0]}` : ''}`)
  }
  return document
}

export function localName(element: Element): string {
  return (element.localName || element.tagName.split(':').at(-1) || '').toLowerCase()
}

export function descendants(element: Element | Document, name: string): Element[] {
  const found: Element[] = []
  const nodes = element.getElementsByTagName('*')
  const expected = name.toLowerCase()
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes.item(index)
    if (node !== null && localName(node) === expected) found.push(node)
  }
  return found
}

export function directChildren(element: Element, names: readonly string[]): Element[] {
  const expected = new Set(names.map((name) => name.toLowerCase()))
  const found: Element[] = []
  for (let node = element.firstChild; node !== null; node = node.nextSibling) {
    if (node.nodeType === 1 && expected.has(localName(node as Element))) found.push(node as Element)
  }
  return found
}

export function elementLocale(element: Element): string | undefined {
  return (
    element.getAttributeNS(XML_NAMESPACE, 'lang')
    || element.getAttribute('xml:lang')
    || element.getAttribute('lang')
    || undefined
  )?.trim()
}

function normalizedLocale(locale: string): string {
  return locale.replaceAll('_', '-').toLowerCase()
}

/**
 * 优先精确 locale；无精确值时，仅当同主语言只出现一种 locale 才回退。
 */
export function selectLocale(
  elements: readonly LocalizedElement[],
  requestedLocale: string,
): LocalizedElement | undefined {
  const requested = normalizedLocale(requestedLocale)
  const exact = elements.find((item) => normalizedLocale(item.locale) === requested)
  if (exact !== undefined) return exact

  const primary = requested.split('-')[0]
  const candidates = elements.filter((item) => normalizedLocale(item.locale).split('-')[0] === primary)
  if (new Set(candidates.map((item) => normalizedLocale(item.locale))).size !== 1) return undefined
  return candidates[0]
}

export function text(element: Element): string {
  return (element.textContent ?? '').trim()
}

export function warning(code: string, message: string, segmentKey?: string): ImportWarning {
  return { code, message, ...(segmentKey === undefined ? {} : { segmentKey }) }
}
