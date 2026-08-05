/**
 * XliffAdapter — XLIFF 1.2 (`<xliff><file><body><trans-unit>`) bilingual
 * format adapter, with memoQ MQXLIFF (`.mqxliff`) support (MQXLIFF is XLIFF
 * 1.2 with an `mq:` namespace; the extras handled here are `mq:locked` and
 * `mq:status`). XLIFF 2.0 is NOT supported (typed FORMAT_PARSE_ERROR) — see
 * known limitations at the bottom.
 *
 * Import contract:
 * - source/target extracted with inline tags (`<g>`, `<x/>`, `<ph>`,
 *   `<bpt>/<ept>`, namespaced variants) preserved VERBATIM in the segment
 *   strings (entities decoded, CDATA unwrapped — see xliff-xml.ts);
 * - segment key = trans-unit `id`, else `resname`, else synthesized
 *   `#tu-<ordinal>` (recorded as an import warning); duplicate keys are a
 *   FORMAT_PARSE_ERROR;
 * - `translate="no"` (trans-unit or file level) or a truthy `mq:locked`
 *   (1/true/yes/locked) -> `locked: true`;
 * - `<note>` -> `context.note`; `resname` -> `context.origin`;
 * - empty/missing `<target>` -> target '' + status 'untranslated';
 * - status mapping (deliberately conservative — documented, not exhaustive):
 *     empty target                          -> 'untranslated'
 *     state="final", state-qualifier in {signed-off, reviewed, approved},
 *       mq:status in {Proofread, ConfirmedReviewer*}  -> 'reviewed'
 *     state="translated", state-qualifier="translated",
 *       mq:status="ConfirmedTranslator"               -> 'translated'
 *     anything else with a non-empty target           -> 'draft'
 *
 * Export contract (template-based, plan §6.3):
 * - originalBytes is the template; trans-units are located by key;
 * - a segment whose target equals the template target is left BYTE-UNTOUCHED,
 *   so unmodified export reproduces the original bytes exactly;
 * - a changed target rewrites only the `<target>` element (created after
 *   `<source>` when missing); a non-empty written target gets
 *   state="translated";
 * - unknown key, segment missing from input, source mismatch, or a changed
 *   target on a locked unit -> FormatExportError; nothing is ever skipped
 *   silently.
 *
 * Known limitations:
 * - XLIFF 2.0 (`<xliff version="2.x">`, `<unit>/<segment>`) is rejected with
 *   a typed FormatParseError; no 2.0 support in this leg;
 * - MQXLIFF write-back does NOT update mq:status/mq:lastchangedtimestamp or
 *   unwrap `<ph>/<bpt>/<ept>` payloads into val= placeholders the way the
 *   legacy mqxliff.ts did — tags round-trip verbatim instead;
 * - a `<target>` inside `<alt-trans>` could be mistaken for the main target
 *   when the trans-unit has no main `<target>` (same behavior as the legacy
 *   parser); alt-trans content is otherwise preserved byte-identically;
 * - modified segments are re-encoded canonically (text runs escaped, inline
 *   tags verbatim, CDATA not re-wrapped), so they may differ in byte shape
 *   from a non-canonical original while decoding to identical content.
 */

import { fnv1a64, type SegmentStatus } from '@linguist/cat-core'
import type {
  CatFormatAdapter,
  CatFormatExportInput,
  CatFormatImportInput,
  ImportedCatAsset,
  ImportedCatSegment,
  ImportWarning,
} from '../adapter'
import { FormatExportError, FormatParseError } from '../errors'
import { sha256Hex, type HashFn } from '../hash'
import {
  decodeXmlEntities,
  decodeXmlInline,
  encodeXmlInline,
  findFirst,
  parseAttrs,
  setAttr,
  type FoundElement,
} from './xliff-xml'

export const XLIFF_ADAPTER_ID = 'xliff_1_2'

const XLIFF_ROOT_PATTERN = /<(?:[\w.-]+:)?xliff\b/i
const FILE_PATTERN = /<((?:[\w.-]+:)?file)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const TRANS_UNIT_PATTERN = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const SELF_CLOSING_TARGET_PATTERN = /<((?:[\w.-]+:)?target)\b([^>]*)\/>/i

interface ParsedUnit {
  ordinal: number
  key: string
  /** Raw trans-unit markup in the template (export splice target). */
  full: string
  source: FoundElement
  target: FoundElement | undefined
  /** Decoded (inline-tags-verbatim) source/target text. */
  sourceText: string
  targetText: string
  locked: boolean
  attrs: Record<string, string>
  note: string | undefined
}

function looksBinary(bytes: Uint8Array): boolean {
  const probe = Math.min(bytes.length, 512)
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) return true
  return false
}

function translateNo(attrs: Record<string, string>): boolean {
  return (attrs.translate ?? '').trim().toLowerCase() === 'no'
}

function mqLocked(attrs: Record<string, string>): boolean {
  return ['1', 'true', 'yes', 'locked'].includes((attrs['mq:locked'] ?? '').trim().toLowerCase())
}

/**
 * Conservative state/state-qualifier/mq:status -> SegmentStatus mapping (see
 * file header). Exported for SdlXliffAdapter, which reuses it for the
 * non-segmented trans-units of an SDLXLIFF file (see sdlxliff.ts header).
 */
export function statusFromXliff(target: string, targetAttrs: Record<string, string>, tuAttrs: Record<string, string>): SegmentStatus {
  if (target === '') return 'untranslated'
  const state = (targetAttrs.state ?? '').trim().toLowerCase()
  const qualifier = (targetAttrs['state-qualifier'] ?? '').trim().toLowerCase()
  const mq = (tuAttrs['mq:status'] ?? '').trim().toLowerCase()
  if (state === 'final' || qualifier === 'signed-off' || qualifier === 'reviewed' || qualifier === 'approved') {
    return 'reviewed'
  }
  if (mq === 'proofread' || mq.startsWith('confirmedreviewer')) return 'reviewed'
  if (state === 'translated' || qualifier === 'translated' || mq === 'confirmedtranslator') return 'translated'
  return 'draft'
}

export class XliffAdapter implements CatFormatAdapter {
  readonly id: string = XLIFF_ADAPTER_ID
  readonly extensions = ['.xliff', '.xlf', '.mqxliff']

  constructor(private readonly hash: HashFn = sha256Hex) {}

  async detect(input: Uint8Array, filename: string): Promise<number> {
    if (looksBinary(input)) return 0
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input)
    } catch {
      return 0
    }
    if (!XLIFF_ROOT_PATTERN.test(text)) return 0
    const lower = filename.toLowerCase()
    if (this.extensions.some((ext) => lower.endsWith(ext))) return 0.9
    return 0.5
  }

  async import(input: CatFormatImportInput): Promise<ImportedCatAsset> {
    const { bytes, filename, sourceLocale, targetLocale } = input
    const text = this.decode(bytes, filename)
    const { units, warnings } = this.parseTemplate(text, filename)
    const segments: ImportedCatSegment[] = units.map((unit) => ({
      ordinal: unit.ordinal,
      key: unit.key,
      source: unit.sourceText,
      target: unit.targetText,
      sourceLocale,
      targetLocale,
      status: statusFromXliff(unit.targetText, unit.target?.attrs ?? {}, unit.attrs),
      locked: unit.locked,
      revision: 0,
      sourceHash: fnv1a64(unit.sourceText),
      ...(unit.note !== undefined || unit.attrs.resname !== undefined
        ? {
            context: {
              ...(unit.note !== undefined ? { note: unit.note } : {}),
              ...(unit.attrs.resname !== undefined ? { origin: unit.attrs.resname } : {}),
            },
          }
        : {}),
    }))
    return {
      asset: {
        formatId: this.id,
        originalFilename: filename,
        sourceSha256: await this.hash(bytes),
        segmentCount: segments.length,
      },
      segments,
      warnings,
      originalBytes: bytes,
    }
  }

  async export(input: CatFormatExportInput): Promise<Uint8Array> {
    const { originalBytes, asset, segments } = input
    const filename = asset.originalFilename
    const text = this.decode(originalBytes, filename)
    const { units } = this.parseTemplate(text, filename)

    const byKey = new Map<string, (typeof segments)[number]>()
    for (const segment of segments) {
      const key = segment.key ?? ''
      if (byKey.has(key)) {
        throw new FormatExportError(this.id, `duplicate segment key ${JSON.stringify(key)} in export input`)
      }
      byKey.set(key, segment)
    }
    const templateKeys = new Set(units.map((unit) => unit.key))
    for (const key of byKey.keys()) {
      if (!templateKeys.has(key)) {
        throw new FormatExportError(this.id, `segment key ${JSON.stringify(key)} is not present in the original template`)
      }
    }

    // Splice edits over the original text; untouched units keep their exact bytes.
    const edits: Array<{ start: number; end: number; replacement: string }> = []
    let cursor = 0
    TRANS_UNIT_PATTERN.lastIndex = 0
    for (const match of text.matchAll(TRANS_UNIT_PATTERN)) {
      const start = match.index ?? 0
      const unit = units[cursor]
      if (!unit) break
      cursor += 1
      const segment = byKey.get(unit.key)
      if (!segment) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(unit.key)} missing from export input; refusing to skip it silently`,
        )
      }
      if (segment.source !== unit.sourceText) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(unit.key)}: source text differs from the original template; sources are never rewritten on export`,
        )
      }
      if (segment.target === unit.targetText) continue
      if (unit.locked) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(unit.key)} is locked (translate="no"/mq:locked) but its target was changed; refusing to write or skip it`,
        )
      }
      edits.push({ start, end: start + match[0].length, replacement: this.rewriteUnit(unit, segment.target) })
    }

    let out = text
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i]!
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end)
    }
    return new TextEncoder().encode(out)
  }

  /** Rewrites a single trans-unit's `<target>`; everything else stays verbatim. */
  private rewriteUnit(unit: ParsedUnit, newTarget: string): string {
    const encoded = encodeXmlInline(newTarget)
    if (unit.target) {
      const attrsRaw = newTarget === '' ? unit.target.attrsRaw : setAttr(unit.target.attrsRaw, 'state', 'translated')
      const nextTarget = `<${unit.target.tagName}${attrsRaw}>${encoded}</${unit.target.tagName}>`
      const at = unit.full.indexOf(unit.target.full)
      if (at < 0) return unit.full // defensive; findFirst matched within this unit
      return unit.full.slice(0, at) + nextTarget + unit.full.slice(at + unit.target.full.length)
    }
    const selfClosing = SELF_CLOSING_TARGET_PATTERN.exec(unit.full)
    if (selfClosing) {
      const tagName = selfClosing[1]!
      const attrsRaw = newTarget === '' ? (selfClosing[2] ?? '') : setAttr(selfClosing[2] ?? '', 'state', 'translated')
      return unit.full.replace(selfClosing[0], `<${tagName}${attrsRaw}>${encoded}</${tagName}>`)
    }
    const inserted = `<target state="translated">${encoded}</target>`
    return unit.full.replace(unit.source.full, `${unit.source.full}${inserted}`)
  }

  private decode(bytes: Uint8Array, filename: string): string {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (err) {
      throw new FormatParseError(this.id, filename, 'input is not valid UTF-8', { cause: err })
    }
  }

  /**
   * Parses the template into trans-units in document order. Shared by import
   * and export so both sides see identical keys/sources/targets.
   */
  private parseTemplate(text: string, filename: string): { units: ParsedUnit[]; warnings: ImportWarning[] } {
    if (!XLIFF_ROOT_PATTERN.test(text)) {
      throw new FormatParseError(this.id, filename, 'root is not an XLIFF document (no <xliff> element)')
    }
    const version = parseAttrs(/<(?:[\w.-]+:)?xliff\b([^>]*)>/i.exec(text)?.[1] ?? '').version ?? ''
    if (version.startsWith('2.')) {
      throw new FormatParseError(this.id, filename, `XLIFF ${version} is not supported (XLIFF 1.2 trans-unit documents only)`)
    }

    const warnings: ImportWarning[] = []
    const units: ParsedUnit[] = []
    const seenKeys = new Set<string>()
    FILE_PATTERN.lastIndex = 0
    for (const fileMatch of text.matchAll(FILE_PATTERN)) {
      const fileLocked = translateNo(parseAttrs(fileMatch[2] ?? ''))
      TRANS_UNIT_PATTERN.lastIndex = 0
      for (const tuMatch of (fileMatch[3] ?? '').matchAll(TRANS_UNIT_PATTERN)) {
        const ordinal = units.length
        const attrs = parseAttrs(tuMatch[2] ?? '')
        const inner = tuMatch[3] ?? ''
        const id = attrs.id?.trim() || undefined
        const resname = attrs.resname?.trim() || undefined
        const key = id ?? resname ?? `#tu-${ordinal}`
        if (id === undefined && resname === undefined) {
          warnings.push({
            code: 'xliff.missing_id',
            message: `trans-unit #${ordinal} has neither id nor resname; synthesized key ${JSON.stringify(key)}`,
            segmentKey: key,
          })
        }
        if (seenKeys.has(key)) {
          throw new FormatParseError(this.id, filename, `trans-unit #${ordinal}: duplicate key ${JSON.stringify(key)}`)
        }
        seenKeys.add(key)
        const source = findFirst(inner, 'source')
        if (!source) {
          throw new FormatParseError(this.id, filename, `trans-unit ${JSON.stringify(key)} has no <source> element`)
        }
        const target = findFirst(inner, 'target')
        const note = findFirst(inner, 'note')
        units.push({
          ordinal,
          key,
          full: tuMatch[0],
          source,
          target,
          sourceText: decodeXmlInline(source.inner),
          targetText: decodeXmlInline(target?.inner ?? ''),
          locked: fileLocked || translateNo(attrs) || mqLocked(attrs),
          attrs,
          note: note ? decodeXmlEntities(note.inner).trim() : undefined,
        })
      }
    }
    if (units.length === 0) {
      throw new FormatParseError(this.id, filename, 'no <trans-unit> segments found')
    }
    return { units, warnings }
  }
}
