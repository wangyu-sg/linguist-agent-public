/**
 * SdlXliffAdapter — Trados SDLXLIFF (`.sdlxliff`) bilingual format adapter
 * (PB-086). SDLXLIFF is XLIFF 1.2 plus an `sdl:` namespace
 * (`xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0"`). Plain XLIFF and
 * memoQ MQXLIFF stay with XliffAdapter — this adapter only claims files
 * that declare the sdl namespace (see detect scoring below).
 *
 * PROVENANCE (docs/attribution/SOURCE_PROVENANCE.md, PB-086): the sdl
 * semantics — `<sdl:seg-defs><sdl:seg id conf locked>` lookup keyed by
 * `<mrk mtype="seg" mid>`, the truthy-locked table and the conf -> status
 * mapping — are adapted from the legacy repo (wangyu-sg/linguist-agent @
 * la-v2-legacy-freeze-2026-07-25, packages/cat-formats/src/sdlxliff.ts —
 * parseSegDefs / isLockedAttr / statusFromConfirmation, AGPL-3.0 same
 * author). The adapter itself (segment model, template export, detect,
 * contract glue) is new code on the xliff-xml helper layer.
 *
 * Segment model:
 * - a trans-unit whose `<seg-source>` holds `<mrk mtype="seg" mid="N">`
 *   elements yields ONE SEGMENT PER MRK, keyed by mid (Trados seg ids are
 *   file-unique): source from the seg-source mrk, target from the `<target>`
 *   mrk with the same mid ('' when absent); the aggregate `<source>` of a
 *   segmented unit is ignored, as in the legacy implementation;
 * - any other trans-unit yields one segment keyed by id / resname /
 *   synthesized `#tu-<ordinal>` (import warning), mirroring XliffAdapter
 *   (`<note>` -> context.note, `resname` -> context.origin);
 * - inline tags (`<g>`, `<ph>`, `<bpt>/<ept>`, ...) are preserved VERBATIM
 *   in segment strings (entities decoded, CDATA unwrapped) — they are NOT
 *   unwrapped into {placeholder} display values the way the legacy
 *   implementation did (deliberate deviation; tags round-trip verbatim,
 *   same policy as MQXLIFF).
 *
 * Locked mapping (legacy-faithful):
 * - file/trans-unit `translate="no"`              -> locked (all segments of the unit)
 * - `<sdl:seg id="N" locked="1|true|yes|locked">` -> locked for mid N (case-insensitive)
 *
 * Status mapping (legacy-faithful, two documented deviations):
 * - empty target                                          -> 'untranslated'
 * - conf="ApprovedTranslation" / conf="ApprovedSignOff"   -> 'reviewed'
 * - conf="Translated"                                     -> 'translated'
 *   (DEVIATION: the legacy 3-tier enum new/draft/confirmed had no middle
 *   tier and mapped conf="Translated" to "draft"; this repo's SegmentStatus
 *   has the 'translated' tier, so Trados translator-confirmed segments land
 *   there — consistent with state="translated" in plain XLIFF.)
 * - anything else with a non-empty target (Draft, DraftInternal, unknown or
 *   missing conf)                                       -> 'draft'
 * - non-segmented trans-units carry no sdl:seg conf; they reuse the plain
 *   XLIFF state/state-qualifier mapping (statusFromXliff) instead of the
 *   legacy always-draft fallback (documented deviation).
 *
 * detect scoring (the registry picks the highest-scoring adapter):
 * - sdl namespace + `.sdlxliff` extension   -> 1;
 * - sdl namespace, other extension          -> 0.95 (vendor content wins
 *   over the generic XLIFF extension score);
 * - `.sdlxliff` extension, NO sdl namespace -> 0 (the registry rejects the
 *   preserved vendor extension instead of silently using generic XLIFF);
 * - no sdl namespace, other extension       -> 0 (plain XLIFF / MQXLIFF are
 *   never claimed).
 *
 * Export contract (template-based, same hard rules as XliffAdapter):
 * - originalBytes is the template; unchanged segments keep their EXACT
 *   bytes, so unmodified export reproduces the original byte-for-byte;
 * - a changed mrk segment rewrites only the inner of its
 *   `<mrk mtype="seg" mid="N">` inside `<target>` (the mrk is appended to
 *   `<target>` when missing; `<target>` itself is created after
 *   `<seg-source>` when missing); a changed non-segmented target rewrites
 *   the `<target>` element like XliffAdapter (a non-empty written target
 *   gets state="translated");
 * - unknown key, segment missing from input, source mismatch, or a changed
 *   target on a locked segment -> FormatExportError; nothing is ever
 *   skipped silently;
 * - 已确认当前 T/E/P 阶段的句段按项目策略写回 `<sdl:seg conf>`；locked、
 *   modified_on 与其他 SDL 元数据保持逐字不变。未确认句段保留导入状态。
 *
 * Known limitations:
 * - XLIFF 2.0 is rejected with a typed FormatParseError (same as XliffAdapter);
 * - a `<mrk mtype="seg">` without a mid cannot be addressed: skipped at
 *   import with an 'sdlxliff.mrk_missing_mid' warning (the legacy
 *   implementation skipped it silently); its bytes still round-trip
 *   untouched;
 * - a malformed trans-unit without `<source>` (non-segmented shape) is a
 *   typed FormatParseError here (the legacy implementation skipped it
 *   silently) — failed content is never dropped quietly;
 * - modified segments are re-encoded canonically (text runs escaped, inline
 *   tags verbatim, CDATA not re-wrapped), so they may differ in byte shape
 *   from a non-canonical original while decoding to identical content.
 */

import {
  fnv1a64,
  nativeStatusForStage,
  type SegmentStatus,
} from '@linguist/cat-core'
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
import { statusFromXliff } from './xliff'
import {
  decodeXmlEntities,
  decodeXmlInline,
  encodeXmlAttr,
  encodeXmlInline,
  findDirectChild,
  parseAttrs,
  setAttr,
  type XliffElementSpan,
  XliffSpanIndex,
} from './xliff-xml'

export const SDLXLIFF_ADAPTER_ID = 'sdlxliff_1_2'

const XLIFF_ROOT_PATTERN = /<(?:[\w.-]+:)?xliff\b/i
const SDL_NAMESPACE_PATTERN = /xmlns:sdl\s*=\s*["']/i
const FILE_PATTERN = /<((?:[\w.-]+:)?file)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const TRANS_UNIT_PATTERN = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi
/** `<sdl:seg .../>` / `<sdl:seg ...>...</sdl:seg>` (also tolerates an unprefixed `seg`). */
const SEG_DEF_PATTERN = /<((?:sdl:)?seg)(?=[\s>/])([^>]*)(?:\/>|>[\s\S]*?<\/\1>)/gi

/** Legacy isLockedAttr: truthy locked values (case-insensitive). */
const TRUTHY_LOCKED = ['1', 'true', 'yes', 'locked']

interface SdlSegDef {
  conf: string | undefined
  locked: boolean
}

interface ParsedSdlSegment {
  ordinal: number
  key: string
  sourceText: string
  targetText: string
  locked: boolean
  status: SegmentStatus
  nativeStatus: string | undefined
  sdlSegDefinitionScope: 'unit' | 'document' | undefined
  note: string | undefined
  origin: string | undefined
}

interface ParsedSdlUnit {
  /** Raw trans-unit markup in the template (export splice target). */
  full: string
  /** True when segments came from `<seg-source><mrk mtype="seg">` elements. */
  segmented: boolean
  segs: ParsedSdlSegment[]
}

function looksBinary(bytes: Uint8Array): boolean {
  const probe = Math.min(bytes.length, 512)
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) return true
  return false
}

function translateNo(attrs: Record<string, string>): boolean {
  return (attrs.translate ?? '').trim().toLowerCase() === 'no'
}

/** Legacy parseSegDefs: sdl:seg-defs lookup keyed by `<mrk mtype="seg" mid>`. */
function parseSegDefs(text: string): Map<string, SdlSegDef> {
  const defs = new Map<string, SdlSegDef>()
  SEG_DEF_PATTERN.lastIndex = 0
  for (const match of text.matchAll(SEG_DEF_PATTERN)) {
    const attrs = parseAttrs(match[2] ?? '')
    if (!attrs.id) continue
    defs.set(attrs.id, {
      conf: attrs.conf,
      locked: TRUTHY_LOCKED.includes((attrs.locked ?? '').trim().toLowerCase()),
    })
  }
  return defs
}

/** `<mrk mtype="seg">` elements inside a seg-source/target block. */
function extractSegMrks(block: string | undefined): XliffElementSpan[] {
  if (!block) return []
  return new XliffSpanIndex(block).find('mrk').filter((mrk) => {
    if (mrk.attrs.mtype !== 'seg') return false
    for (let parent = mrk.parent; parent; parent = parent.parent) {
      if (parent.localName === 'mrk' && parent.attrs.mtype === 'seg') return false
    }
    return true
  })
}

/**
 * Legacy statusFromConfirmation, lifted to this repo's 4-tier SegmentStatus
 * (see the file header for the conf="Translated" deviation).
 */
function statusFromSdlConf(target: string, conf: string | undefined): SegmentStatus {
  if (target === '') return 'untranslated'
  const level = (conf ?? '').trim().toLowerCase()
  if (level === 'approvedtranslation' || level === 'approvedsignoff') return 'reviewed'
  if (level === 'translated') return 'translated'
  return 'draft'
}

/** Replaces the inner of `<mrk mtype="seg" mid="...">` inside a target block. */
function replaceMrkInner(targetInner: string, mid: string, nextInner: string): { inner: string; found: boolean } {
  const mrk = extractSegMrks(targetInner).find((candidate) => candidate.attrs.mid === mid)
  if (!mrk) return { inner: targetInner, found: false }
  const replacement = mrk.selfClosing
    ? `<${mrk.tagName}${mrk.attrsRaw}>${nextInner}</${mrk.tagName}>`
    : targetInner.slice(mrk.start, mrk.contentStart) + nextInner + targetInner.slice(mrk.contentEnd, mrk.end)
  return {
    inner: targetInner.slice(0, mrk.start) + replacement + targetInner.slice(mrk.end),
    found: true,
  }
}

export class SdlXliffAdapter implements CatFormatAdapter {
  readonly id: string = SDLXLIFF_ADAPTER_ID
  readonly extensions = ['.sdlxliff']

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
    const hasSdlNamespace = SDL_NAMESPACE_PATTERN.test(text)
    const hasSdlExtension = filename.toLowerCase().endsWith('.sdlxliff')
    if (hasSdlNamespace) return hasSdlExtension ? 1 : 0.95
    return 0
  }

  async import(input: CatFormatImportInput): Promise<ImportedCatAsset> {
    const { bytes, filename, sourceLocale, targetLocale } = input
    const text = this.decode(bytes, filename)
    const { units, warnings } = this.parseTemplate(text, filename)
    const segments: ImportedCatSegment[] = []
    for (const unit of units) {
      for (const seg of unit.segs) {
        segments.push({
          ordinal: seg.ordinal,
          key: seg.key,
          source: seg.sourceText,
          target: seg.targetText,
          sourceLocale,
          targetLocale,
          status: seg.status,
          ...(seg.nativeStatus !== undefined
            ? { importedNativeStatus: seg.nativeStatus }
            : {}),
          locked: seg.locked,
          revision: 0,
          sourceHash: fnv1a64(seg.sourceText),
          ...(seg.note !== undefined || seg.origin !== undefined
            ? {
                context: {
                  ...(seg.note !== undefined ? { note: seg.note } : {}),
                  ...(seg.origin !== undefined ? { origin: seg.origin } : {}),
                },
              }
            : {}),
        })
      }
    }
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
    const { originalBytes, asset, segments, workflow } = input
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
    const changed = new Map<string, string>()
    const statusChanges = new Map<string, string>()
    const documentStatusChanges = new Map<string, string>()
    const templateKeys = new Set<string>()
    for (const unit of units) {
      for (const seg of unit.segs) {
        templateKeys.add(seg.key)
        const segment = byKey.get(seg.key)
        if (!segment) {
          throw new FormatExportError(
            this.id,
            `segment ${JSON.stringify(seg.key)} missing from export input; refusing to skip it silently`,
          )
        }
        if (segment.source !== seg.sourceText) {
          throw new FormatExportError(
            this.id,
            `segment ${JSON.stringify(seg.key)}: source text differs from the original template; sources are never rewritten on export`,
          )
        }
        if (workflow !== undefined && segment.currentStageState === 'confirmed') {
          const nativeStatus = nativeStatusForStage(
            workflow.stage,
            this.id,
            workflow.outputStatusPolicy,
          )
          if (nativeStatus !== undefined && nativeStatus !== seg.nativeStatus) {
            if (!unit.segmented || seg.sdlSegDefinitionScope === undefined) {
              throw new FormatExportError(
                this.id,
                `segment ${JSON.stringify(seg.key)} is confirmed for ${workflow.stage} but has no writable sdl:seg definition`,
              )
            }
            if (seg.locked) {
              throw new FormatExportError(
                this.id,
                `segment ${JSON.stringify(seg.key)} is locked but its workflow status was changed`,
              )
            }
            ;(seg.sdlSegDefinitionScope === 'unit' ? statusChanges : documentStatusChanges)
              .set(seg.key, nativeStatus)
          }
        }
        if (segment.target === seg.targetText) continue
        if (seg.locked) {
          throw new FormatExportError(
            this.id,
            `segment ${JSON.stringify(seg.key)} is locked (translate="no"/sdl:seg locked) but its target was changed; refusing to write or skip it`,
          )
        }
        changed.set(seg.key, segment.target)
      }
    }
    for (const key of byKey.keys()) {
      if (!templateKeys.has(key)) {
        throw new FormatExportError(this.id, `segment key ${JSON.stringify(key)} is not present in the original template`)
      }
    }
    if (changed.size === 0 && statusChanges.size === 0 && documentStatusChanges.size === 0) {
      return originalBytes
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
      if (!unit.segs.some((seg) => changed.has(seg.key) || statusChanges.has(seg.key))) continue
      edits.push({
        start,
        end: start + match[0].length,
        replacement: this.rewriteUnit(unit, changed, statusChanges),
      })
    }

    let out = text
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i]!
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end)
    }
    out = this.rewriteDocumentSegmentStatuses(out, documentStatusChanges)
    return new TextEncoder().encode(out)
  }

  /** 文档级 seg-defs 只写 trans-unit 外部，避免同 id 的局部定义被串改。 */
  private rewriteDocumentSegmentStatuses(text: string, changes: ReadonlyMap<string, string>): string {
    if (changes.size === 0) return text
    let out = ''
    let cursor = 0
    TRANS_UNIT_PATTERN.lastIndex = 0
    for (const match of text.matchAll(TRANS_UNIT_PATTERN)) {
      const start = match.index ?? 0
      out += this.rewriteSegmentStatuses(text.slice(cursor, start), changes) + match[0]
      cursor = start + match[0].length
    }
    return out + this.rewriteSegmentStatuses(text.slice(cursor), changes)
  }

  /** 只在当前 trans-unit 内替换对应 `<sdl:seg>` 的 conf，保留其他元数据。 */
  private rewriteSegmentStatuses(text: string, changes: ReadonlyMap<string, string>): string {
    if (changes.size === 0) return text
    SEG_DEF_PATTERN.lastIndex = 0
    return text.replace(SEG_DEF_PATTERN, (full, tagName: string, attrsRaw: string) => {
      const attrs = parseAttrs(attrsRaw ?? '')
      const id = attrs.id
      if (id === undefined) return full
      const status = changes.get(id)
      if (status === undefined) return full
      const nextAttrs = setAttr(attrsRaw ?? '', 'conf', status)
      return full.replace(`<${tagName}${attrsRaw ?? ''}`, `<${tagName}${nextAttrs}`)
    })
  }

  /** Rewrites the changed segments of one trans-unit; everything else stays verbatim. */
  private rewriteUnit(
    unit: ParsedSdlUnit,
    changed: ReadonlyMap<string, string>,
    statusChanges: ReadonlyMap<string, string>,
  ): string {
    if (!unit.segmented) {
      const seg = unit.segs.find((candidate) => changed.has(candidate.key))
      if (!seg) return unit.full // defensive; the caller only passes units with changes
      const newTarget = changed.get(seg.key)!
      return this.rewritePlainTarget(unit.full, encodeXmlInline(newTarget), newTarget !== '')
    }
    const entries = unit.segs
      .filter((seg) => changed.has(seg.key))
      .map((seg) => ({ mid: seg.key, encoded: encodeXmlInline(changed.get(seg.key)!) }))
    const withTargets = entries.length === 0 ? unit.full : this.rewriteSegmentedTarget(unit.full, entries)
    return this.rewriteSegmentStatuses(withTargets, statusChanges)
  }

  /**
   * Non-segmented unit: rewrites the `<target>` element (same shape as
   * XliffAdapter — a non-empty written target gets state="translated").
   */
  private rewritePlainTarget(tuFull: string, encoded: string, markTranslated: boolean): string {
    const target = findDirectChild(tuFull, 'target')
    if (target) {
      const attrsRaw = markTranslated ? setAttr(target.attrsRaw, 'state', 'translated') : target.attrsRaw
      const nextTarget = `<${target.tagName}${attrsRaw}>${encoded}</${target.tagName}>`
      const at = tuFull.indexOf(target.full)
      if (at < 0) return tuFull // defensive; direct-child target matched within this unit
      return tuFull.slice(0, at) + nextTarget + tuFull.slice(at + target.full.length)
    }
    const source = findDirectChild(tuFull, 'source')
    const inserted = `<target state="translated">${encoded}</target>`
    if (!source) return tuFull // defensive; import rejected source-less units
    const at = tuFull.indexOf(source.full)
    return tuFull.slice(0, at) + source.full + inserted + tuFull.slice(at + source.full.length)
  }

  /**
   * Segmented unit: rewrites only the inner of each changed
   * `<mrk mtype="seg" mid>` inside `<target>`; target attrs and sdl:seg
   * metadata are never touched (see the file header for the write-back
   * policy).
   */
  private rewriteSegmentedTarget(tuFull: string, entries: Array<{ mid: string; encoded: string }>): string {
    const asMrk = (entry: { mid: string; encoded: string }): string =>
      `<mrk mtype="seg" mid="${encodeXmlAttr(entry.mid)}">${entry.encoded}</mrk>`

    const target = findDirectChild(tuFull, 'target')
    if (target) {
      let inner = target.inner
      const missing: Array<{ mid: string; encoded: string }> = []
      for (const entry of entries) {
        const replaced = replaceMrkInner(inner, entry.mid, entry.encoded)
        if (replaced.found) inner = replaced.inner
        else missing.push(entry)
      }
      inner += missing.map(asMrk).join('')
      const nextTarget = `<${target.tagName}${target.attrsRaw}>${inner}</${target.tagName}>`
      const at = tuFull.indexOf(target.full)
      if (at < 0) return tuFull // defensive; direct-child target matched within this unit
      return tuFull.slice(0, at) + nextTarget + tuFull.slice(at + target.full.length)
    }
    const mrks = entries.map(asMrk).join('')
    const segSource = findDirectChild(tuFull, 'seg-source')
    if (!segSource) return tuFull // defensive; a segmented unit always has one
    const at = tuFull.indexOf(segSource.full)
    return tuFull.slice(0, at) + segSource.full + `<target>${mrks}</target>` + tuFull.slice(at + segSource.full.length)
  }

  private decode(bytes: Uint8Array, filename: string): string {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (err) {
      throw new FormatParseError(this.id, filename, 'input is not valid UTF-8', { cause: err })
    }
  }

  /**
   * Parses the template into trans-units in document order, each holding its
   * logical segments (one per `<mrk mtype="seg">` for segmented units, one
   * per trans-unit otherwise). Shared by import and export so both sides see
   * identical keys/sources/targets.
   */
  private parseTemplate(text: string, filename: string): { units: ParsedSdlUnit[]; warnings: ImportWarning[] } {
    if (!XLIFF_ROOT_PATTERN.test(text)) {
      throw new FormatParseError(this.id, filename, 'root is not an XLIFF document (no <xliff> element)')
    }
    const version = parseAttrs(/<(?:[\w.-]+:)?xliff\b([^>]*)>/i.exec(text)?.[1] ?? '').version ?? ''
    if (version.startsWith('2.')) {
      throw new FormatParseError(this.id, filename, `XLIFF ${version} is not supported (XLIFF 1.2 trans-unit documents only)`)
    }

    TRANS_UNIT_PATTERN.lastIndex = 0
    const documentSegDefs = parseSegDefs(text.replace(TRANS_UNIT_PATTERN, ''))
    const warnings: ImportWarning[] = []
    const units: ParsedSdlUnit[] = []
    const seenKeys = new Set<string>()
    let segmentCount = 0

    const pushSegment = (unit: ParsedSdlUnit, seg: ParsedSdlSegment): void => {
      if (seenKeys.has(seg.key)) {
        throw new FormatParseError(this.id, filename, `segment #${seg.ordinal}: duplicate key ${JSON.stringify(seg.key)}`)
      }
      seenKeys.add(seg.key)
      unit.segs.push(seg)
      segmentCount += 1
    }

    FILE_PATTERN.lastIndex = 0
    for (const fileMatch of text.matchAll(FILE_PATTERN)) {
      const fileLocked = translateNo(parseAttrs(fileMatch[2] ?? ''))
      TRANS_UNIT_PATTERN.lastIndex = 0
      for (const tuMatch of (fileMatch[3] ?? '').matchAll(TRANS_UNIT_PATTERN)) {
        const attrs = parseAttrs(tuMatch[2] ?? '')
        const inner = tuMatch[3] ?? ''
        const tuLocked = fileLocked || translateNo(attrs)
        const unit: ParsedSdlUnit = { full: tuMatch[0], segmented: false, segs: [] }

        const segSource = findDirectChild(inner, 'seg-source')
        const sourceMrks = extractSegMrks(segSource?.inner)
        if (sourceMrks.length > 0) {
          unit.segmented = true
          const segDefs = parseSegDefs(inner)
          const target = findDirectChild(inner, 'target')
          const targetMrks = new Map(extractSegMrks(target?.inner).map((mrk) => [mrk.attrs.mid ?? '', mrk]))
          for (const srcMrk of sourceMrks) {
            const mid = srcMrk.attrs.mid
            if (!mid) {
              warnings.push({
                code: 'sdlxliff.mrk_missing_mid',
                message: `trans-unit ${JSON.stringify(attrs.id ?? '?')}: <mrk mtype="seg"> without mid cannot be addressed; skipped (bytes round-trip untouched)`,
              })
              continue
            }
            const localDef = segDefs.get(mid)
            const def = localDef ?? documentSegDefs.get(mid)
            const targetText = decodeXmlInline(targetMrks.get(mid)?.inner ?? '')
            pushSegment(unit, {
              ordinal: segmentCount,
              key: mid,
              sourceText: decodeXmlInline(srcMrk.inner),
              targetText,
              locked: tuLocked || (def?.locked ?? false),
              status: statusFromSdlConf(targetText, def?.conf),
              nativeStatus: def?.conf,
              sdlSegDefinitionScope: localDef !== undefined
                ? 'unit'
                : def !== undefined
                  ? 'document'
                  : undefined,
              note: undefined,
              origin: undefined,
            })
          }
        } else {
          const source = findDirectChild(inner, 'source')
          if (!source) {
            throw new FormatParseError(
              this.id,
              filename,
              `trans-unit ${JSON.stringify(attrs.id ?? '?')} has neither <seg-source> segments nor a <source> element`,
            )
          }
          const target = findDirectChild(inner, 'target')
          const note = findDirectChild(inner, 'note')
          const id = attrs.id?.trim() || undefined
          const resname = attrs.resname?.trim() || undefined
          const key = id ?? resname ?? `#tu-${segmentCount}`
          if (id === undefined && resname === undefined) {
            warnings.push({
              code: 'sdlxliff.missing_id',
              message: `trans-unit #${segmentCount} has neither id nor resname; synthesized key ${JSON.stringify(key)}`,
              segmentKey: key,
            })
          }
          const targetText = decodeXmlInline(target?.inner ?? '')
          pushSegment(unit, {
            ordinal: segmentCount,
            key,
            sourceText: decodeXmlInline(source.inner),
            targetText,
            locked: tuLocked,
            status: statusFromXliff(targetText, target?.attrs ?? {}, attrs),
            nativeStatus: target?.attrs.state ?? attrs.state,
            sdlSegDefinitionScope: undefined,
            note: note ? decodeXmlEntities(note.inner).trim() : undefined,
            origin: resname,
          })
        }
        units.push(unit)
      }
    }
    if (segmentCount === 0) {
      throw new FormatParseError(this.id, filename, 'no importable segments found (no <trans-unit>/<mrk mtype="seg"> segments)')
    }
    return { units, warnings }
  }
}
