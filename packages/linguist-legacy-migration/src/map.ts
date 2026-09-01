/**
 * PB-091 mapping layer: pure functions from legacy payload shapes
 * (extract.ts) to new-repo store rows (cat-core / cat-store). No IO.
 *
 * Every legacy field that has no home in the new model is counted in a
 * FieldCounter (`droppedFields`) — nothing is silently lost. Value coercions
 * (status/format/severity remaps) are counted separately (`coercions`).
 *
 * Provenance — semantics lifted from frozen legacy-repo SOURCE (read-only):
 * - linguist-agent/packages/cat-data/src/batch_workspace.ts:38-69 —
 *   BatchSegment fields; status domain new|draft|confirmed.
 * - linguist-agent/packages/cat-data/src/termbase.ts:340-342,363-378,382-399 —
 *   normTerm(), overrideToEntry() note formula, authorityTierForHistory()
 *   status grouping (current / deprecated-family / conflict).
 * - linguist-agent/packages/cat-data/src/term_history.ts:5-12 —
 *   TermHistoryDecisionStatus domain.
 * - linguist-agent/packages/cat-data/src/delivery_qa.ts:36-47,607-623 —
 *   DeliveryQaFinding severity domain and the review-decision persistence
 *   (delivery_waiver / team_decision ledger events keyed by findingId).
 * - docs/roadmap/LEGACY_MIGRATION_CONTRACTS.md §5, §14 (new repo) —
 *   PB-091 must-preserve field table.
 */

import {
  createAsset,
  deriveSegmentId,
  fnv1a64,
  type Asset,
  type AssetId,
  type OpenQaFindingInput,
  type ProjectId,
  type QaFindingSeverity,
  type Segment,
  type SegmentContext,
  type SegmentStatus,
} from '@linguist/cat-core'
import type { TermEntryImportInput, TermEntryStatus, TmUnitImportInput } from '@linguist/cat-store'

// ---------------------------------------------------------------------------
// field counters (dropped fields / coercions; rendered per-item in the report)

export type FieldCounter = Map<string, number>

export function bump(counter: FieldCounter, key: string, n = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + n)
}

export function counterToRecord(counter: FieldCounter): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of [...counter.keys()].sort()) out[key] = counter.get(key)!
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// ---------------------------------------------------------------------------
// §decision 10 — batch format mapping (assets.format_id has no CHECK; legacy
// values are normalized to new adapter ids, xliff_2_0 is recorded as-is and
// flagged export-unavailable, unknown values pass through and are reported).

export const LEGACY_FORMAT_MAP: Readonly<Record<string, string>> = {
  phrase_mxliff: 'phrase_mxliff_1_2',
  mqxliff: 'mqxliff_1_2',
  sdlxliff: 'sdlxliff_1_2',
  xliff_1_2: 'xliff_1_2',
  csv_paste: 'csv_rfc4180',
  xlsx_paste: 'xlsx_ooxml',
}

/** Paste batches carry a synthetic sourceFile — they never had source bytes. */
export const PASTE_FORMATS: ReadonlySet<string> = new Set(['csv_paste', 'xlsx_paste'])

export interface MappedFormat {
  formatId: string
  /** true when no new-repo adapter can export this format (xliff_2_0, unknown). */
  exportUnavailable: boolean
}

export function mapLegacyFormat(format: unknown, coercions: FieldCounter): MappedFormat {
  const raw = asString(format) ?? 'unknown'
  if (raw === 'xliff_2_0') {
    bump(coercions, 'format.xliff_2_0:passthrough-export-unavailable')
    return { formatId: 'xliff_2_0', exportUnavailable: true }
  }
  const mapped = LEGACY_FORMAT_MAP[raw]
  if (mapped !== undefined) {
    if (mapped !== raw) bump(coercions, `format.${raw}->${mapped}`)
    return { formatId: mapped, exportUnavailable: false }
  }
  bump(coercions, `format.unknown:${raw}`)
  return { formatId: raw, exportUnavailable: true }
}

// ---------------------------------------------------------------------------
// §decision 2 — BatchSegment -> Segment (adapter bypass: legacy segments are
// already parsed JSON, so rows are built directly).

/** new|draft|confirmed -> untranslated|draft|translated (never reviewed). */
export function mapSegmentStatus(status: unknown, coercions: FieldCounter): SegmentStatus {
  if (status === 'new') return 'untranslated'
  if (status === 'draft') return 'draft'
  if (status === 'confirmed') return 'translated'
  bump(coercions, `segment.status.${typeof status === 'string' ? status : 'missing'}->draft`)
  return 'draft'
}

/** BatchSegment fields handled as first-class columns (not meta, not dropped). */
const SEGMENT_COLUMN_FIELDS = new Set(['id', 'source', 'target', 'locked', 'status'])

/**
 * Import-time computed values (PB-091 decision 2): dropped and counted.
 * The final state they describe is fully captured by source/target/status.
 */
const SEGMENT_COMPUTED_DROP_FIELDS = [
  'unresolvedPlaceholderCount',
  'unresolvedRuntimePlaceholderCount',
  'unresolvedTagPlaceholderCount',
  'unresolvedPlaceholders',
  'unresolvedRuntimePlaceholders',
  'unresolvedTagPlaceholders',
] as const

function metaString(meta: Record<string, string>, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string') meta[key] = value
  else if (typeof value === 'number' || typeof value === 'boolean') meta[key] = String(value)
  else meta[key] = JSON.stringify(value)
}

export interface SegmentMapContext {
  assetId: AssetId
  ordinal: number
  sourceLocale: string
  targetLocale: string
}

/**
 * Map one raw BatchSegment. Array order -> ordinal (order preservation);
 * legacy segment id -> key; new id = deriveSegmentId(assetId, ordinal, key).
 * revision = 0 with no history rows (legacy has no per-segment revision
 * chain; "final semantics" = final state only — contracts §5).
 * Evidence fields land in context.note/origin/meta; unresolved* import-time
 * computed values are dropped and counted.
 */
export function mapLegacySegment(
  raw: Record<string, unknown>,
  ctx: SegmentMapContext,
  dropped: FieldCounter,
  coercions: FieldCounter,
): Segment {
  const key = asString(raw.id)
  const source = asString(raw.source) ?? (bump(coercions, 'segment.source:non-string'), String(raw.source ?? ''))
  const target = asString(raw.target) ?? (raw.target === undefined || raw.target === null ? '' : (bump(coercions, 'segment.target:non-string'), String(raw.target)))

  const context: SegmentContext = {}
  const meta: Record<string, string> = {}
  const note = asString(raw.contextNote)
  if (note !== null) context.note = note
  const masterId = asString(raw.masterId)
  if (masterId !== null) context.origin = masterId

  // evidence fields -> context.meta (stringly-typed, JSON-safe)
  metaString(meta, 'resname', raw.resname)
  metaString(meta, 'legacyIndex', raw.index)
  metaString(meta, 'duplicateKey', raw.duplicateKey)
  metaString(meta, 'duplicateRole', raw.duplicateRole)
  metaString(meta, 'duplicateOrdinal', raw.duplicateOrdinal)
  metaString(meta, 'duplicateGroupSize', raw.duplicateGroupSize)
  metaString(meta, 'duplicateFirstSegmentId', raw.duplicateFirstSegmentId)
  metaString(meta, 'originalTarget', raw.originalTarget)
  metaString(meta, 'rawSource', raw.rawSource)
  metaString(meta, 'rawTarget', raw.rawTarget)
  metaString(meta, 'placeholderCount', raw.placeholderCount)
  metaString(meta, 'confirmationLevel', raw.confirmationLevel)
  metaString(meta, 'tuId', raw.tuId)
  // revisions "final semantics" evidence (contracts §5/§14)
  metaString(meta, 'updatedAt', raw.updatedAt)
  metaString(meta, 'updateReason', raw.updateReason)
  metaString(meta, 'updateChangeType', raw.updateChangeType)
  metaString(meta, 'updateEvidenceSources', raw.updateEvidenceSources)

  const handled = new Set([...SEGMENT_COLUMN_FIELDS, ...SEGMENT_COMPUTED_DROP_FIELDS])
  for (const knownKey of [
    'contextNote', 'masterId', 'resname', 'index', 'duplicateKey', 'duplicateRole', 'duplicateOrdinal',
    'duplicateGroupSize', 'duplicateFirstSegmentId', 'originalTarget', 'rawSource', 'rawTarget',
    'placeholderCount', 'confirmationLevel', 'tuId', 'updatedAt', 'updateReason', 'updateChangeType',
    'updateEvidenceSources',
  ]) {
    handled.add(knownKey)
  }
  for (const field of SEGMENT_COMPUTED_DROP_FIELDS) {
    if (raw[field] !== undefined) bump(dropped, `segment.${field}`)
  }
  for (const keyName of Object.keys(raw)) {
    if (!handled.has(keyName)) bump(dropped, `segment.unknown:${keyName}`)
  }

  if (Object.keys(meta).length > 0) context.meta = meta

  return {
    id: deriveSegmentId(ctx.assetId, ctx.ordinal, key ?? undefined),
    assetId: ctx.assetId,
    ordinal: ctx.ordinal,
    ...(key !== null ? { key } : {}),
    source,
    target,
    sourceLocale: ctx.sourceLocale,
    targetLocale: ctx.targetLocale,
    status: mapSegmentStatus(raw.status, coercions),
    locked: raw.locked === true,
    revision: 0,
    sourceHash: fnv1a64(source),
    ...(Object.keys(context).length > 0 ? { context } : {}),
  }
}

/** Batch-level fields with no new-model home (counted per batch, contracts §5). */
const BATCH_DROP_FIELDS = ['masterFile', 'workflowStage', 'createdAt', 'updatedAt', 'tagReport', 'duplicateSourceGroups'] as const
const BATCH_HANDLED_FIELDS = new Set([
  'schemaVersion', 'format', 'projectId', 'batchId', 'sourceFile', 'sourceLanguage', 'targetLanguage', 'segments',
  ...BATCH_DROP_FIELDS,
])

export interface BatchMapContext {
  newProjectId: ProjectId
  sourceSha256: string
  originalFilename: string
  sourceLocale: string
  targetLocale: string
}

export interface MappedBatch {
  asset: Asset
  segments: Segment[]
  format: MappedFormat
}

/** Map one raw CatBatch to an Asset + Segment rows (one batch = one asset). */
export function mapLegacyBatch(
  raw: Record<string, unknown>,
  ctx: BatchMapContext,
  dropped: FieldCounter,
  coercions: FieldCounter,
): MappedBatch {
  const format = mapLegacyFormat(raw.format, coercions)
  const rawSegments = Array.isArray(raw.segments) ? raw.segments : (bump(dropped, 'batch.segments:not-an-array'), [])
  const asset = createAsset({
    projectId: ctx.newProjectId,
    formatId: format.formatId,
    originalFilename: ctx.originalFilename,
    sourceSha256: ctx.sourceSha256,
    segmentCount: rawSegments.length,
  })
  const segments: Segment[] = []
  for (const [ordinal, entry] of rawSegments.entries()) {
    if (!isRecord(entry)) {
      bump(dropped, 'segment.not-an-object')
      continue
    }
    segments.push(mapLegacySegment(entry, { assetId: asset.id, ordinal, sourceLocale: ctx.sourceLocale, targetLocale: ctx.targetLocale }, dropped, coercions))
  }
  for (const field of BATCH_DROP_FIELDS) {
    if (raw[field] !== undefined) bump(dropped, `batch.${field}`)
  }
  for (const keyName of Object.keys(raw)) {
    if (!BATCH_HANDLED_FIELDS.has(keyName)) bump(dropped, `batch.unknown:${keyName}`)
  }
  return { asset, segments, format }
}

// ---------------------------------------------------------------------------
// §decision 3 — tm.json TmEntry -> tm_units import input.
// source/target/srcLang/tgtLang map to the new occurrence model; every other
// legacy field has no column and is dropped + counted.

const TM_DROPPED_FIELDS = ['id', 'quality', 'project', 'note', 'sourceKind', 'sourceBatchId', 'sourceSegmentId', 'createdAt', 'updatedAt'] as const

export function mapTmEntry(
  raw: Record<string, unknown>,
  fallbackLocales: { sourceLocale: string; targetLocale: string },
  occurrenceKey: string,
  dropped: FieldCounter,
  coercions: FieldCounter,
): TmUnitImportInput | null {
  const source = asString(raw.source)
  const target = asString(raw.target)
  if (source === null || target === null) {
    bump(dropped, 'tm.entry-missing-source-or-target')
    return null
  }
  const sourceLocale = asString(raw.srcLang) ?? (bump(coercions, 'tm.srcLang:missing->project-locale'), fallbackLocales.sourceLocale)
  const targetLocale = asString(raw.tgtLang) ?? (bump(coercions, 'tm.tgtLang:missing->project-locale'), fallbackLocales.targetLocale)
  for (const field of TM_DROPPED_FIELDS) {
    if (raw[field] !== undefined) bump(dropped, `tm.${field}`)
  }
  const handled = new Set(['source', 'target', 'srcLang', 'tgtLang', 'origin', ...TM_DROPPED_FIELDS])
  for (const keyName of Object.keys(raw)) {
    if (!handled.has(keyName)) bump(dropped, `tm.unknown:${keyName}`)
  }
  return {
    source,
    target,
    sourceLocale,
    targetLocale,
    sourceId: 'legacy-import',
    occurrenceKey,
  }
}

// ---------------------------------------------------------------------------
// §decision 4 — termbase TermbaseEntry / TermbaseOverride -> term_entries.
//
// Status comes from term_history.json decisions (legacy grouping, provenance
// termbase.ts authorityTierForHistory): current -> preferred; deprecated |
// deleted | pending | unconfirmed_later_row -> deprecated; conflict -> stays
// allowed and is reported. No history -> allowed (default).
//
// origin has no column and is folded into the note prefix:
//   note = `origin:<origin>` + (note ? ` | ${note}` : '')
// conceptId/fields/sourceFile/sheetName/rowNo/srcLang/tgtLang/id are dropped
// and counted. caseSensitive = false.

/** Legacy normTerm (termbase.ts:340-342). */
function normTerm(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

const HISTORY_DEPRECATED_FAMILY: ReadonlySet<string> = new Set(['deprecated', 'deleted', 'pending', 'unconfirmed_later_row'])

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Find the term-history decision for an entry (legacy historyForEntry,
 * termbase.ts:382-394): first decision whose source matches (normTerm) and
 * whose target / deprecatedTargets / conflictTargets contains the entry target.
 */
export function findHistoryDecision(
  decisions: readonly Record<string, unknown>[],
  source: string,
  target: string,
): Record<string, unknown> | null {
  const normSource = normTerm(source)
  const normTarget = normTerm(target)
  for (const decision of decisions) {
    if (normTerm(asString(decision.source) ?? undefined) !== normSource) continue
    const decisionTarget = asString(decision.target)
    if (decisionTarget !== null && normTerm(decisionTarget) === normTarget) return decision
    if (stringArray(decision.deprecatedTargets).some((item) => normTerm(item) === normTarget)) return decision
    if (stringArray(decision.conflictTargets).some((item) => normTerm(item) === normTarget)) return decision
  }
  return null
}

export function termStatusFromHistory(
  decision: Record<string, unknown> | null,
  coercions: FieldCounter,
): TermEntryStatus {
  if (decision === null) return 'allowed'
  const status = asString(decision.status)
  if (status === 'current') return 'preferred'
  if (status !== null && HISTORY_DEPRECATED_FAMILY.has(status)) return 'deprecated'
  if (status === 'conflict') {
    bump(coercions, 'termbase.history-conflict->allowed')
    return 'allowed'
  }
  if (status !== null) bump(coercions, `termbase.history-unknown:${status}->allowed`)
  return 'allowed'
}

const TB_DROPPED_FIELDS = ['id', 'conceptId', 'fields', 'sourceFile', 'sheetName', 'rowNo', 'srcLang', 'tgtLang'] as const

export function mapTermbaseEntry(
  raw: Record<string, unknown>,
  historyDecisions: readonly Record<string, unknown>[],
  dropped: FieldCounter,
  coercions: FieldCounter,
): TermEntryImportInput | null {
  const term = asString(raw.source)
  const translation = asString(raw.target)
  if (term === null || translation === null) {
    bump(dropped, 'termbase.entry-missing-source-or-target')
    return null
  }
  const status = termStatusFromHistory(findHistoryDecision(historyDecisions, term, translation), coercions)
  const origin = asString(raw.origin)
  const noteText = asString(raw.note)
  // origin folds into the note prefix (no origin column in term_entries).
  const note = origin !== null ? `origin:${origin}${noteText !== null ? ` | ${noteText}` : ''}` : (noteText ?? undefined)
  for (const field of TB_DROPPED_FIELDS) {
    if (raw[field] !== undefined) bump(dropped, `termbase.${field}`)
  }
  const handled = new Set(['source', 'target', 'note', 'origin', ...TB_DROPPED_FIELDS])
  for (const keyName of Object.keys(raw)) {
    if (!handled.has(keyName)) bump(dropped, `termbase.unknown:${keyName}`)
  }
  return { term, translation, status, caseSensitive: false, ...(note !== undefined && note !== '' ? { note } : {}) }
}

/**
 * termbase_overrides[] -> synthesized preferred entries. The note follows
 * the legacy overrideToEntry formula (termbase.ts:363-378):
 *   [reason, decidedBy ? `Decided by: ${decidedBy}` : undefined, ts].filter(Boolean).join(" | ")
 */
export function mapOverrideEntry(
  raw: Record<string, unknown>,
  dropped: FieldCounter,
): TermEntryImportInput | null {
  const term = asString(raw.source)
  const translation = asString(raw.target)
  if (term === null || translation === null) {
    bump(dropped, 'termbase-override.missing-source-or-target')
    return null
  }
  const reason = asString(raw.reason)
  const decidedBy = asString(raw.decidedBy)
  const ts = asString(raw.ts)
  const note = [reason, decidedBy !== null ? `Decided by: ${decidedBy}` : null, ts].filter((part): part is string => part !== null && part !== '').join(' | ')
  if (raw.srcLang !== undefined) bump(dropped, 'termbase-override.srcLang')
  if (raw.tgtLang !== undefined) bump(dropped, 'termbase-override.tgtLang')
  const handled = new Set(['source', 'target', 'reason', 'decidedBy', 'ts', 'srcLang', 'tgtLang'])
  for (const keyName of Object.keys(raw)) {
    if (!handled.has(keyName)) bump(dropped, `termbase-override.unknown:${keyName}`)
  }
  return { term, translation, status: 'preferred', caseSensitive: false, ...(note !== '' ? { note } : {}) }
}

// ---------------------------------------------------------------------------
// §decision 5 — delivery_qa findings -> qa_findings rows.

/**
 * blocker|warning|advisory -> L1|L2|L4（PB-096 五档契约）；占位符/标签/ICU
 * 类旧码的 blocker 按契约特判 L0；未知档位回落 L4 并计数。
 */
const LEGACY_L0_QA_CODES: ReadonlySet<string> = new Set([
  'placeholder_mismatch',
  'tag_mismatch',
  'icu_branch_mismatch',
])

export function mapQaSeverity(severity: unknown, code: string, coercions: FieldCounter): QaFindingSeverity {
  if (severity === 'blocker') return LEGACY_L0_QA_CODES.has(code) ? 'L0' : 'L1'
  if (severity === 'warning') return 'L2'
  if (severity === 'advisory') return 'L4'
  bump(coercions, `qa.severity.${typeof severity === 'string' ? severity : 'missing'}->L4`)
  return 'L4'
}

/** Review decision recovered from the quality decision ledger. */
export interface LedgerReview {
  decision: string
  reason: string | null
}

const REVIEW_KINDS: ReadonlySet<string> = new Set(['delivery_waiver', 'team_decision'])
const REVIEW_DECISIONS: ReadonlySet<string> = new Set(['ignore_with_reason', 'accepted_risk', 'fix_required', 'query'])

/**
 * Collect review decisions from VALIDATED ledger events (latest event per
 * findingId wins). Provenance: reviewSavedDeliveryQaReport persists reviews
 * only as delivery_waiver / team_decision ledger events keyed by findingId
 * (delivery_qa.ts:607-623); reviewed reports are never written to disk.
 */
export function collectLedgerReviews(events: readonly Record<string, unknown>[]): Map<string, LedgerReview> {
  const reviews = new Map<string, LedgerReview>()
  for (const event of events) {
    const kind = asString(event.kind)
    const decision = asString(event.decision)
    const findingId = asString(event.findingId)
    if (kind === null || !REVIEW_KINDS.has(kind) || decision === null || !REVIEW_DECISIONS.has(decision) || findingId === null) continue
    reviews.set(findingId, { decision, reason: asString(event.reason) })
  }
  return reviews
}

export interface MappedQaFinding {
  input: OpenQaFindingInput
  /** Non-null when the finding must be transitioned to waived after insertOpen. */
  waiveReason: string | null
}

/**
 * Map one raw DeliveryQaFinding. Findings without a segmentId, or whose
 * segmentId is not among the imported segments, are dropped and counted.
 * Status: no review -> open; ignore_with_reason / accepted_risk -> waived
 * (waiver_reason = reviewReason); fix_required / query -> open.
 */
export function mapQaFinding(
  raw: Record<string, unknown>,
  segmentIds: ReadonlyMap<string, string>,
  reviews: ReadonlyMap<string, LedgerReview>,
  dropped: FieldCounter,
  coercions: FieldCounter,
): MappedQaFinding | null {
  const legacySegmentId = asString(raw.segmentId)
  if (legacySegmentId === null) {
    bump(dropped, 'qa.finding-no-segment-id')
    return null
  }
  const segmentId = segmentIds.get(legacySegmentId)
  if (segmentId === undefined) {
    bump(dropped, 'qa.finding-unknown-segment')
    return null
  }
  const code = asString(raw.type) ?? (bump(coercions, 'qa.type:missing->unknown'), 'unknown')
  const message = asString(raw.message) ?? (bump(coercions, 'qa.message:missing->empty'), '')
  const severity = mapQaSeverity(raw.severity, code, coercions)
  const findingId = asString(raw.id)
  const review = findingId !== null ? reviews.get(findingId) : undefined
  let waiveReason: string | null = null
  if (review !== undefined && (review.decision === 'ignore_with_reason' || review.decision === 'accepted_risk')) {
    // The store requires a non-empty waiver reason; fall back honestly.
    waiveReason = review.reason !== null && review.reason.trim() !== '' ? review.reason : `legacy review decision: ${review.decision}`
  }
  return { input: { segmentId: segmentId as OpenQaFindingInput['segmentId'], code, severity, message }, waiveReason }
}

/**
 * Pick the latest delivery_qa report per batchId (max generatedAt; ties
 * broken by reportId then fileName for determinism). Reports without a
 * batchId are skipped and counted.
 */
export function selectLatestReportsPerBatch<T extends { fileName: string; reportId: string | null; batchId: string | null; generatedAt: string | null; error: string | null }>(
  reports: readonly T[],
  dropped: FieldCounter,
): Map<string, T> {
  const latest = new Map<string, T>()
  for (const report of reports) {
    if (report.error !== null) continue
    if (report.batchId === null) {
      bump(dropped, 'qa.report-no-batch-id')
      continue
    }
    const current = latest.get(report.batchId)
    if (current === undefined) {
      latest.set(report.batchId, report)
      continue
    }
    const key = (r: T): string => `${r.generatedAt ?? ''}${r.reportId ?? ''}${r.fileName}`
    if (key(report) > key(current)) {
      latest.set(report.batchId, report)
      bump(dropped, 'qa.report-superseded-by-newer')
    } else {
      bump(dropped, 'qa.report-superseded-by-newer')
    }
  }
  return latest
}
