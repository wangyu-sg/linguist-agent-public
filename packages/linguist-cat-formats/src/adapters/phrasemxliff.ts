/**
 * PhraseMxliffAdapter — Phrase (Memsource) MXLIFF (`.mxliff`) bilingual
 * format adapter (PB-087). MXLIFF is XLIFF 1.2 plus an `m:` namespace
 * (`xmlns:m="http://www.memsource.com/mxlf/2.0"`). Plain XLIFF and memoQ
 * MQXLIFF stay with XliffAdapter, Trados SDLXLIFF with SdlXliffAdapter —
 * this adapter only claims files that declare the memsource `m:` namespace
 * (see detect scoring below).
 *
 * Why a separate adapter (PB-086 criterion): the Phrase segment MODEL is
 * flat (one segment per `<trans-unit>`, same shape as plain XLIFF — no
 * seg-source/mrk split like SDLXLIFF), but the dialect carries
 * vendor-specific semantics that would muddy XliffAdapter's contract:
 * `m:confirmed` workflow-level status mapping, group-level context
 * (`<group m:para-id>` + `<context context-type="x-key-note">`), and the
 * `m:locked`/`m:para-id`/`m:trans-origin` attribute family. memoQ was
 * folded into XliffAdapter when it was the only dialect and only two
 * attributes; Phrase is a third dialect with its own status contract, so
 * it gets its own adapter — same precedent as PB-086.
 *
 * PROVENANCE (docs/attribution/SOURCE_PROVENANCE.md, PB-087): the phrase
 * semantics — the `m:` attribute family, the isLocked truthy table
 * (`m:locked`/`locked` in 1/true/yes/locked, or translate="no"), the
 * `m:confirmed` truthiness rule (not '', not "0", not "false"), and the
 * group `<context context-type="x-key|x-key-note">` lookup keyed by
 * `m:para-id` — are adapted from the legacy repo
 * (wangyu-sg/linguist-agent @ la-v2-legacy-freeze-2026-07-25,
 * packages/cat-formats/src/phrase_mxliff.ts — isLocked / parseGroupContexts
 * / firstContext, and packages/cat-data/src/batch_workspace.ts —
 * segmentStatus, AGPL-3.0 same author). The adapter itself (segment model,
 * template export, detect, contract glue) is new code on the xliff-xml
 * helper layer.
 *
 * Segment model (flat, same as XliffAdapter):
 * - one segment per `<trans-unit>`; segment key = `id`, else `resname`,
 *   else synthesized `#tu-<ordinal>` (import warning); duplicate keys are a
 *   FormatParseError. `m:para-id` is identity metadata only, never a key
 *   fallback (several trans-units can share a paragraph);
 * - inline tags (`<g>`, `<ph>`, `<bpt>/<ept>`, ...) stay verbatim. When a
 *   verified master mapping exists, Phrase `{n}` placeholders are rehydrated
 *   to their real tags for editing and dehydrated back on export; without a
 *   mapping the original placeholders remain verbatim;
 * - `<note>` -> context.note; when the trans-unit has no `<note>`, the
 *   enclosing group's `<context context-type="x-key-note">` (found via
 *   `m:para-id`) is used instead (legacy contextNote); `resname` ->
 *   context.origin. The group `x-key` master reference is NOT surfaced
 *   (it is consumed by the separate content-based master pairing probe).
 *
 * Locked mapping (legacy-faithful):
 * - file/trans-unit `translate="no"`                    -> locked
 * - truthy `m:locked` (falling back to plain `locked`)
 *   in {1, true, yes, locked} (case-insensitive)        -> locked
 *
 * Status mapping (legacy-faithful, two documented deviations):
 * - empty target                                     -> 'untranslated'
 * - truthy `m:confirmed` (not '', not "0", not "false", case-insensitive):
 *   numeric level >= 2                               -> 'reviewed'
 *   numeric level 1, or non-numeric ("true", ...)    -> 'translated'
 *   (DEVIATION: the legacy 3-tier enum new/draft/confirmed had a single
 *   confirmation tier and mapped every truthy m:confirmed to "confirmed";
 *   this repo's SegmentStatus splits confirmation into 'translated'
 *   (translator-confirmed, Phrase workflow step 1) and 'reviewed'
 *   (confirmed at a later workflow step) — consistent with the SDLXLIFF
 *   conf="Translated" -> 'translated' / Approved* -> 'reviewed' mapping.)
 * - no truthy `m:confirmed`: the plain XLIFF state/state-qualifier mapping
 *   (statusFromXliff) is consulted, so state="final" -> 'reviewed',
 *   state="translated" -> 'translated', otherwise a non-empty target ->
 *   'draft' (DEVIATION: the legacy implementation ignored `state`
 *   entirely — same documented fallback deviation as SdlXliffAdapter's
 *   non-segmented units).
 *
 * detect scoring (the registry picks the highest-scoring adapter):
 * - memsource m: namespace + `.mxliff` extension   -> 1;
 * - memsource m: namespace, other extension        -> 0.95 (vendor content
 *   wins over the generic XLIFF extension score);
 * - `.mxliff` extension, NO memsource namespace    -> 0 (the registry
 *   rejects the preserved vendor extension instead of silently using
 *   generic XLIFF);
 * - no memsource namespace, other extension        -> 0 (plain XLIFF /
 *   MQXLIFF / SDLXLIFF are never claimed).
 *
 * Export contract (template-based, same hard rules as XliffAdapter):
 * - originalBytes is the template; unchanged segments keep their EXACT
 *   bytes, so unmodified export reproduces the original byte-for-byte;
 * - a changed target rewrites only the `<target>` element (created after
 *   `<source>` when missing; a self-closing `<target/>` is expanded); a
 *   non-empty written target gets state="translated";
 * - unknown key, segment missing from input, source mismatch, or a changed
 *   target on a locked segment -> FormatExportError; nothing is ever
 *   skipped silently;
 * - phrase `m:` metadata (`m:confirmed`, `m:modified-at`, `m:level-edited`,
 *   `m:locked`, `m:para-id`, `m:trans-origin`) is NEVER written back — same
 *   no-write-back policy as MQXLIFF mq:status and SDLXLIFF sdl:seg conf.
 *   DEVIATION from the legacy implementation, which stamped
 *   m:confirmed/m:modified-at/m:level-edited on export.
 *
 * Known limitations:
 * - XLIFF 2.0 is rejected with a typed FormatParseError (same as
 *   XliffAdapter);
 * - the group matcher is non-greedy and does not support nested `<group>`
 *   elements of the same name (fine for real Phrase exports); group
 *   context is best-effort metadata — a missed group note never fails
 *   import;
 * - a `<target>` inside `<alt-trans>` can be mistaken for the main target
 *   (same as XliffAdapter);
 * - modified segments are re-encoded canonically (text runs escaped, inline
 *   tags verbatim, CDATA not re-wrapped), so they may differ in byte shape
 *   from a non-canonical original while decoding to identical content.
 */

import { fnv1a64, scanTags, type SegmentStatus } from '@linguist/cat-core'
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
  encodeXmlInline,
  findFirst,
  parseAttrs,
  setAttr,
} from './xliff-xml'

export const PHRASE_MXLIFF_ADAPTER_ID = 'phrase_mxliff_1_2'

const XLIFF_ROOT_PATTERN = /<(?:[\w.-]+:)?xliff\b/i
/** Phrase (Memsource) namespace declaration, e.g. xmlns:m="http://www.memsource.com/mxlf/2.0". */
const MEMSOURCE_NAMESPACE_PATTERN = /xmlns:m\s*=\s*["'][^"']*memsource\.com\/mxlf/i
const FILE_PATTERN = /<((?:[\w.-]+:)?file)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const TRANS_UNIT_PATTERN = /<((?:[\w.-]+:)?trans-unit)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const SELF_CLOSING_TARGET_PATTERN = /<((?:[\w.-]+:)?target)\b([^>]*)\/>/i
const GROUP_PATTERN = /<((?:[\w.-]+:)?group)\b([^>]*)>([\s\S]*?)<\/\1>/gi
const CONTEXT_PATTERN = /<((?:[\w.-]+:)?context)\b([^>]*)>([\s\S]*?)<\/\1>/gi

/** Legacy isLocked: truthy locked values (case-insensitive). */
const TRUTHY_LOCKED = ['1', 'true', 'yes', 'locked']

interface ParsedPhraseUnit {
  ordinal: number
  key: string
  /** Raw trans-unit markup in the template (export splice target). */
  full: string
  sourceText: string
  targetText: string
  locked: boolean
  status: SegmentStatus
  note: string | undefined
  origin: string | undefined
}

export interface PhraseMxliffTagMapping {
  masterId: string
  splitSourceHash: string
  placeholders: string[]
  tags: string[]
}

export interface PhraseMxliffFormatConfig {
  version: 1
  masterFilename: string
  masterSha256: string
  placeholderSegments: number
  matchedSegments: number
  unmatchedSegments: number
  ambiguousSegments: number
  mappings: Record<string, PhraseMxliffTagMapping>
}

export interface PhraseMasterPairProbe {
  config: PhraseMxliffFormatConfig
  score: number
}

function looksBinary(bytes: Uint8Array): boolean {
  const probe = Math.min(bytes.length, 512)
  for (let i = 0; i < probe; i++) if (bytes[i] === 0) return true
  return false
}

function translateNo(attrs: Record<string, string>): boolean {
  return (attrs.translate ?? '').trim().toLowerCase() === 'no'
}

/** Legacy isLocked: truthy `m:locked` (falling back to plain `locked`). */
function phraseLocked(attrs: Record<string, string>): boolean {
  const locked = attrs['m:locked'] ?? attrs.locked
  return TRUTHY_LOCKED.includes((locked ?? '').trim().toLowerCase())
}

/**
 * Legacy m:confirmed truthiness (batch_workspace segmentStatus): not '',
 * not "0", not "false" (case-insensitive). Returns the trimmed raw value
 * when truthy, undefined otherwise.
 */
function phraseConfirmedRaw(attrs: Record<string, string>): string | undefined {
  const raw = (attrs['m:confirmed'] ?? '').trim()
  if (raw === '' || raw === '0' || raw.toLowerCase() === 'false') return undefined
  return raw
}

/**
 * Legacy-faithful status mapping lifted to this repo's 4-tier SegmentStatus
 * (see the file header for the confirmed-level and state-fallback
 * deviations).
 */
function statusFromPhrase(
  target: string,
  tuAttrs: Record<string, string>,
  targetAttrs: Record<string, string>,
): SegmentStatus {
  if (target === '') return 'untranslated'
  const confirmed = phraseConfirmedRaw(tuAttrs)
  if (confirmed !== undefined) {
    const level = Number.parseInt(confirmed, 10)
    if (Number.isFinite(level) && level >= 2) return 'reviewed'
    return 'translated'
  }
  return statusFromXliff(target, targetAttrs, tuAttrs)
}

/** First `<context context-type="...">` value inside a group block (legacy firstContext). */
function firstContextValue(block: string, contextType: string): string | undefined {
  CONTEXT_PATTERN.lastIndex = 0
  for (const match of block.matchAll(CONTEXT_PATTERN)) {
    const attrs = parseAttrs(match[2] ?? '')
    if (attrs['context-type'] === contextType) return decodeXmlEntities(match[3] ?? '').trim()
  }
  return undefined
}

/** Legacy parseGroupContexts: group id / m:para-id -> x-key-note, for trans-unit lookup via m:para-id. */
interface PhraseGroupContext {
  masterId?: string
  note?: string
}

function parseGroupContexts(text: string): Map<string, PhraseGroupContext> {
  const contexts = new Map<string, PhraseGroupContext>()
  GROUP_PATTERN.lastIndex = 0
  for (const match of text.matchAll(GROUP_PATTERN)) {
    const attrs = parseAttrs(match[2] ?? '')
    const key = attrs.id ?? attrs['m:para-id']
    if (!key) continue
    const block = match[3] ?? ''
    contexts.set(key, {
      ...(firstContextValue(block, 'x-key') !== undefined
        ? { masterId: firstContextValue(block, 'x-key') }
        : {}),
      ...(firstContextValue(block, 'x-key-note') !== undefined
        ? { note: firstContextValue(block, 'x-key-note') }
        : {}),
    })
  }
  return contexts
}

const PHRASE_PLACEHOLDER_PATTERN = /\{\d+\}|\{\d+>\}|<\d+\}/g
const PHRASE_NATIVE_TAG_PROFILE = {
  families: [
    {
      id: 'phrase-inline-container',
      pattern: '<(?<phraseContainer>bpt|ept|ph|it|mrk|g|x|bx|ex)\\b[^>]*>[\\s\\S]*?<\\/\\k<phraseContainer>>',
      class: 'singleton' as const,
    },
    { id: 'phrase-change', pattern: '\\{u>|<u\\}', class: 'singleton' as const },
    { id: 'phrase-variable', pattern: '\\{(?!\\d+\\})[^{}\\r\\n]+\\}', class: 'singleton' as const },
  ],
}

function phrasePlaceholders(value: string): string[] {
  return [...value.matchAll(PHRASE_PLACEHOLDER_PATTERN)].map((match) => match[0])
}

function structuralTags(value: string): string[] {
  return scanTags(value, { profile: PHRASE_NATIVE_TAG_PROFILE })
    .filter((tag) => tag.group !== 'placeholder')
    .map((tag) => value.slice(tag.start, tag.end))
}

function stripStructuralTags(value: string): string {
  const tags = scanTags(value, { profile: PHRASE_NATIVE_TAG_PROFILE })
    .filter((tag) => tag.group !== 'placeholder' || tag.familyId.startsWith('phrase-'))
  let out = ''
  let cursor = 0
  for (const tag of tags) {
    out += value.slice(cursor, tag.start)
    cursor = tag.end
  }
  return (out + value.slice(cursor)).replace(/\s+/g, ' ').trim()
}

function splitPlainSource(value: string): string {
  return value.replace(/\{u>|<u\}/g, '').replace(PHRASE_PLACEHOLDER_PATTERN, '').replace(/\s+/g, ' ').trim()
}

function splitPlainForTagCount(value: string, tagCount: number): string {
  let seen = 0
  return value.replace(/\{u>|<u\}/g, '').replace(PHRASE_PLACEHOLDER_PATTERN, (placeholder) => {
    if (seen >= tagCount) return placeholder
    seen += 1
    return ''
  }).replace(/\s+/g, ' ').trim()
}

function parsePhraseConfig(value: string | undefined, filename: string): PhraseMxliffFormatConfig | undefined {
  if (value === undefined) return undefined
  try {
    const parsed = JSON.parse(value) as PhraseMxliffFormatConfig
    if (parsed.version !== 1 || typeof parsed.mappings !== 'object' || parsed.mappings === null) throw new Error()
    return parsed
  } catch {
    throw new FormatParseError(PHRASE_MXLIFF_ADAPTER_ID, filename, 'invalid Phrase master tag mapping config')
  }
}

export function parsePhraseMxliffFormatConfig(
  value: string | undefined,
  filename = 'phrase.mxliff',
): PhraseMxliffFormatConfig | undefined {
  return parsePhraseConfig(value, filename)
}

function rehydratePhraseValue(value: string, mapping?: PhraseMxliffTagMapping): string {
  if (mapping === undefined) return value
  const byPlaceholder = new Map(mapping.placeholders.map((placeholder, index) => [placeholder, mapping.tags[index]]))
  return value.replace(PHRASE_PLACEHOLDER_PATTERN, (placeholder) => byPlaceholder.get(placeholder) ?? placeholder)
}

function dehydratePhraseValue(value: string, mapping?: PhraseMxliffTagMapping): string {
  if (mapping === undefined) return value
  const queues = new Map<string, string[]>()
  mapping.tags.forEach((tag, index) => queues.set(tag, [...(queues.get(tag) ?? []), mapping.placeholders[index]!]))
  const spans = scanTags(value, { profile: PHRASE_NATIVE_TAG_PROFILE })
    .filter((tag) => tag.group !== 'placeholder' || tag.familyId.startsWith('phrase-'))
  let out = ''
  let cursor = 0
  for (const span of spans) {
    const raw = value.slice(span.start, span.end)
    out += value.slice(cursor, span.start)
    out += queues.get(raw)?.shift() ?? raw
    cursor = span.end
  }
  return out + value.slice(cursor)
}

interface MasterUnitForPairing {
  id: string
  resname?: string
  sourceRich: string
  sourcePlain: string
  tags: string[]
}

function parseMasterUnits(text: string): MasterUnitForPairing[] {
  const units: MasterUnitForPairing[] = []
  TRANS_UNIT_PATTERN.lastIndex = 0
  for (const match of text.matchAll(TRANS_UNIT_PATTERN)) {
    const attrs = parseAttrs(match[2] ?? '')
    const source = findFirst(match[3] ?? '', 'seg-source') ?? findFirst(match[3] ?? '', 'source')
    if (!source) continue
    const sourceRich = decodeXmlInline(source.inner)
    units.push({
      id: attrs.id ?? '',
      ...(attrs.resname ? { resname: attrs.resname } : {}),
      sourceRich,
      sourcePlain: stripStructuralTags(sourceRich),
      tags: structuralTags(sourceRich),
    })
  }
  return units
}

/** 内容级 split/master 配对；文件名只用于显示，不参与得分。 */
export async function probePhraseMasterPair(
  splitBytes: Uint8Array,
  splitFilename: string,
  masterBytes: Uint8Array,
  masterFilename: string,
): Promise<PhraseMasterPairProbe> {
  const splitText = new TextDecoder('utf-8', { fatal: true }).decode(splitBytes)
  const masterText = new TextDecoder('utf-8', { fatal: true }).decode(masterBytes)
  if (!MEMSOURCE_NAMESPACE_PATTERN.test(splitText) || !XLIFF_ROOT_PATTERN.test(masterText)) {
    return {
      config: {
        version: 1, masterFilename, masterSha256: await sha256Hex(masterBytes),
        placeholderSegments: 0, matchedSegments: 0, unmatchedSegments: 0, ambiguousSegments: 0, mappings: {},
      },
      score: 0,
    }
  }
  const contexts = parseGroupContexts(splitText)
  const masters = parseMasterUnits(masterText)
  const byId = new Map<string, MasterUnitForPairing[]>()
  const byResname = new Map<string, MasterUnitForPairing[]>()
  const byPlain = new Map<string, MasterUnitForPairing[]>()
  const add = (map: Map<string, MasterUnitForPairing[]>, key: string | undefined, unit: MasterUnitForPairing) => {
    if (!key) return
    map.set(key, [...(map.get(key) ?? []), unit])
  }
  for (const unit of masters) {
    add(byId, unit.id, unit)
    add(byResname, unit.resname, unit)
    add(byPlain, unit.sourcePlain, unit)
  }
  const mappings: Record<string, PhraseMxliffTagMapping> = {}
  let placeholderSegments = 0
  let matchedSegments = 0
  let unmatchedSegments = 0
  let ambiguousSegments = 0
  TRANS_UNIT_PATTERN.lastIndex = 0
  for (const match of splitText.matchAll(TRANS_UNIT_PATTERN)) {
    const attrs = parseAttrs(match[2] ?? '')
    const key = attrs.id?.trim() || attrs.resname?.trim()
    const source = findFirst(match[3] ?? '', 'source')
    if (!key || !source) continue
    const sourceText = decodeXmlInline(source.inner)
    const placeholders = phrasePlaceholders(sourceText)
    if (placeholders.length === 0) continue
    const context = attrs['m:para-id'] ? contexts.get(attrs['m:para-id']) : undefined
    const candidateSets = [
      context?.masterId ? byId.get(context.masterId) : undefined,
      attrs.resname ? byResname.get(attrs.resname) : undefined,
      byPlain.get(splitPlainSource(sourceText)),
    ].filter((items): items is MasterUnitForPairing[] => items !== undefined)
    const candidates = candidateSets.find((items) => items.length > 0) ?? []
    const valid = candidates.filter((unit) =>
      unit.tags.length <= placeholders.length
      && (
        unit.sourcePlain === splitPlainForTagCount(sourceText, unit.tags.length)
        || (context?.masterId !== undefined && unit.id === context.masterId)
      ))
    const equivalent = [...new Map(valid.map((unit) => [JSON.stringify(unit.tags), unit])).values()]
    if (equivalent.length > 1) {
      placeholderSegments += 1
      ambiguousSegments += 1
      continue
    }
    const master = equivalent[0]
    if (!master) {
      placeholderSegments += 1
      unmatchedSegments += 1
      continue
    }
    if (master.tags.length === 0) continue
    placeholderSegments += 1
    mappings[key] = {
      masterId: master.id,
      splitSourceHash: fnv1a64(sourceText),
      placeholders: placeholders.slice(0, master.tags.length),
      tags: master.tags,
    }
    matchedSegments += 1
  }
  const config: PhraseMxliffFormatConfig = {
    version: 1,
    masterFilename,
    masterSha256: await sha256Hex(masterBytes),
    placeholderSegments,
    matchedSegments,
    unmatchedSegments,
    ambiguousSegments,
    mappings,
  }
  return { config, score: placeholderSegments === 0 ? 0 : matchedSegments / placeholderSegments }
}

export function serializePhraseMxliffFormatConfig(config: PhraseMxliffFormatConfig): string {
  return JSON.stringify(config)
}

export class PhraseMxliffAdapter implements CatFormatAdapter {
  readonly id: string = PHRASE_MXLIFF_ADAPTER_ID
  readonly extensions = ['.mxliff']

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
    const hasMemsourceNamespace = MEMSOURCE_NAMESPACE_PATTERN.test(text)
    const hasMxliffExtension = filename.toLowerCase().endsWith('.mxliff')
    if (hasMemsourceNamespace) return hasMxliffExtension ? 1 : 0.95
    return 0
  }

  async import(input: CatFormatImportInput): Promise<ImportedCatAsset> {
    const { bytes, filename, sourceLocale, targetLocale, formatConfigJson } = input
    const text = this.decode(bytes, filename)
    const { units, warnings } = this.parseTemplate(text, filename)
    const config = parsePhraseConfig(formatConfigJson, filename)
    const segments: ImportedCatSegment[] = units.map((unit) => {
      const mapping = config?.mappings[unit.key]
      if (mapping !== undefined && mapping.splitSourceHash !== fnv1a64(unit.sourceText)) {
        throw new FormatParseError(this.id, filename, `Phrase master mapping is stale for segment ${JSON.stringify(unit.key)}`)
      }
      const sourceText = rehydratePhraseValue(unit.sourceText, mapping)
      const targetText = rehydratePhraseValue(unit.targetText, mapping)
      return {
      ordinal: unit.ordinal,
      key: unit.key,
      source: sourceText,
      target: targetText,
      sourceLocale,
      targetLocale,
      status: unit.status,
      locked: unit.locked,
      revision: 0,
      sourceHash: fnv1a64(sourceText),
      ...(unit.note !== undefined || unit.origin !== undefined
        ? {
            context: {
              ...(unit.note !== undefined ? { note: unit.note } : {}),
              ...(unit.origin !== undefined ? { origin: unit.origin } : {}),
            },
          }
        : {}),
      }
    })
    return {
      asset: {
        formatId: this.id,
        originalFilename: filename,
        sourceSha256: await this.hash(bytes),
        segmentCount: segments.length,
        ...(formatConfigJson === undefined ? {} : { formatConfigJson }),
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
    const config = parsePhraseConfig(asset.formatConfigJson, filename)

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
      const mapping = config?.mappings[unit.key]
      if (mapping !== undefined && mapping.splitSourceHash !== fnv1a64(unit.sourceText)) {
        throw new FormatExportError(this.id, `Phrase master mapping is stale for segment ${JSON.stringify(unit.key)}`)
      }
      if (segment.source !== rehydratePhraseValue(unit.sourceText, mapping)) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(unit.key)}: source text differs from the original template; sources are never rewritten on export`,
        )
      }
      if (segment.target === rehydratePhraseValue(unit.targetText, mapping)) continue
      if (unit.locked) {
        throw new FormatExportError(
          this.id,
          `segment ${JSON.stringify(unit.key)} is locked (translate="no"/m:locked) but its target was changed; refusing to write or skip it`,
        )
      }
      edits.push({
        start,
        end: start + match[0].length,
        replacement: this.rewriteUnit(unit.full, dehydratePhraseValue(segment.target, mapping)),
      })
    }

    let out = text
    for (let i = edits.length - 1; i >= 0; i--) {
      const edit = edits[i]!
      out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end)
    }
    return new TextEncoder().encode(out)
  }

  /** Rewrites a single trans-unit's `<target>`; everything else stays verbatim. */
  private rewriteUnit(tuFull: string, newTarget: string): string {
    const encoded = encodeXmlInline(newTarget)
    const target = findFirst(tuFull, 'target')
    if (target) {
      const attrsRaw = newTarget === '' ? target.attrsRaw : setAttr(target.attrsRaw, 'state', 'translated')
      const nextTarget = `<${target.tagName}${attrsRaw}>${encoded}</${target.tagName}>`
      const at = tuFull.indexOf(target.full)
      if (at < 0) return tuFull // defensive; findFirst matched within this unit
      return tuFull.slice(0, at) + nextTarget + tuFull.slice(at + target.full.length)
    }
    const selfClosing = SELF_CLOSING_TARGET_PATTERN.exec(tuFull)
    if (selfClosing) {
      const tagName = selfClosing[1]!
      const attrsRaw = newTarget === '' ? (selfClosing[2] ?? '') : setAttr(selfClosing[2] ?? '', 'state', 'translated')
      return tuFull.replace(selfClosing[0], `<${tagName}${attrsRaw}>${encoded}</${tagName}>`)
    }
    const source = findFirst(tuFull, 'source')
    const inserted = `<target state="translated">${encoded}</target>`
    if (!source) return tuFull // defensive; import rejected source-less units
    return tuFull.replace(source.full, `${source.full}${inserted}`)
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
  private parseTemplate(text: string, filename: string): { units: ParsedPhraseUnit[]; warnings: ImportWarning[] } {
    if (!XLIFF_ROOT_PATTERN.test(text)) {
      throw new FormatParseError(this.id, filename, 'root is not an XLIFF document (no <xliff> element)')
    }
    const version = parseAttrs(/<(?:[\w.-]+:)?xliff\b([^>]*)>/i.exec(text)?.[1] ?? '').version ?? ''
    if (version.startsWith('2.')) {
      throw new FormatParseError(this.id, filename, `XLIFF ${version} is not supported (XLIFF 1.2 trans-unit documents only)`)
    }

    const groupContexts = parseGroupContexts(text)
    const warnings: ImportWarning[] = []
    const units: ParsedPhraseUnit[] = []
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
            code: 'phrase_mxliff.missing_id',
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
        const paraId = attrs['m:para-id']
        const groupNote = paraId ? groupContexts.get(paraId)?.note : undefined
        const sourceText = decodeXmlInline(source.inner)
        const targetText = decodeXmlInline(target?.inner ?? '')
        units.push({
          ordinal,
          key,
          full: tuMatch[0],
          sourceText,
          targetText,
          locked: fileLocked || translateNo(attrs) || phraseLocked(attrs),
          status: statusFromPhrase(targetText, attrs, target?.attrs ?? {}),
          note: note ? decodeXmlEntities(note.inner).trim() : groupNote,
          origin: resname,
        })
      }
    }
    if (units.length === 0) {
      throw new FormatParseError(this.id, filename, 'no <trans-unit> segments found')
    }
    return { units, warnings }
  }
}
