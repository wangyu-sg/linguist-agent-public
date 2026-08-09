/**
 * PB-091 mapping-matrix tests (pure functions, no IO): segment status and
 * context assembly, format normalization, TM/TB field carry-over with
 * dropped-field counters, term-history status grouping, the override note
 * formula, QA severity/status mapping, ledger review collection, and the
 * latest-report-per-batch selection.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asAssetId, asProjectId, deriveSegmentId } from '@linguist/cat-core'
import {
  bump,
  collectLedgerReviews,
  counterToRecord,
  findHistoryDecision,
  mapLegacyBatch,
  mapLegacyFormat,
  mapLegacySegment,
  mapOverrideEntry,
  mapQaFinding,
  mapQaSeverity,
  mapSegmentStatus,
  mapTermbaseEntry,
  mapTmEntry,
  selectLatestReportsPerBatch,
  termStatusFromHistory,
  type FieldCounter,
} from './map'

function counters(): { dropped: FieldCounter; coercions: FieldCounter } {
  return { dropped: new Map(), coercions: new Map() }
}

// ---------------------------------------------------------------------------
// segment status

test('segment status: new/draft/confirmed -> untranslated/draft/translated, never reviewed', () => {
  const { coercions } = counters()
  assert.equal(mapSegmentStatus('new', coercions), 'untranslated')
  assert.equal(mapSegmentStatus('draft', coercions), 'draft')
  assert.equal(mapSegmentStatus('confirmed', coercions), 'translated')
  assert.equal(coercions.size, 0)
})

test('segment status: unknown or missing coerces to draft and is counted', () => {
  const { coercions } = counters()
  assert.equal(mapSegmentStatus('reviewed', coercions), 'draft')
  assert.equal(mapSegmentStatus(undefined, coercions), 'draft')
  assert.equal(mapSegmentStatus(42, coercions), 'draft')
  assert.deepEqual(counterToRecord(coercions), {
    'segment.status.reviewed->draft': 1,
    'segment.status.missing->draft': 2,
  })
})

// ---------------------------------------------------------------------------
// format mapping

test('format mapping: known legacy formats normalize to new adapter ids', () => {
  const { coercions } = counters()
  assert.deepEqual(mapLegacyFormat('phrase_mxliff', coercions), { formatId: 'phrase_mxliff_1_2', exportUnavailable: false })
  assert.deepEqual(mapLegacyFormat('mqxliff', coercions), { formatId: 'mqxliff_1_2', exportUnavailable: false })
  assert.deepEqual(mapLegacyFormat('sdlxliff', coercions), { formatId: 'sdlxliff_1_2', exportUnavailable: false })
  assert.deepEqual(mapLegacyFormat('xliff_1_2', coercions), { formatId: 'xliff_1_2', exportUnavailable: false })
  assert.deepEqual(mapLegacyFormat('csv_paste', coercions), { formatId: 'csv_rfc4180', exportUnavailable: false })
  assert.deepEqual(mapLegacyFormat('xlsx_paste', coercions), { formatId: 'xlsx_ooxml', exportUnavailable: false })
  assert.deepEqual(counterToRecord(coercions), {
    'format.phrase_mxliff->phrase_mxliff_1_2': 1,
    'format.mqxliff->mqxliff_1_2': 1,
    'format.sdlxliff->sdlxliff_1_2': 1,
    'format.csv_paste->csv_rfc4180': 1,
    'format.xlsx_paste->xlsx_ooxml': 1,
  })
})

test('format mapping: xliff_2_0 recorded as-is and flagged export-unavailable', () => {
  const { coercions } = counters()
  assert.deepEqual(mapLegacyFormat('xliff_2_0', coercions), { formatId: 'xliff_2_0', exportUnavailable: true })
  assert.deepEqual(counterToRecord(coercions), { 'format.xliff_2_0:passthrough-export-unavailable': 1 })
})

test('format mapping: unknown format passes through, flagged and counted', () => {
  const { coercions } = counters()
  assert.deepEqual(mapLegacyFormat('weird_format', coercions), { formatId: 'weird_format', exportUnavailable: true })
  assert.deepEqual(mapLegacyFormat(undefined, coercions), { formatId: 'unknown', exportUnavailable: true })
  assert.deepEqual(counterToRecord(coercions), { 'format.unknown:weird_format': 1, 'format.unknown:unknown': 1 })
})

// ---------------------------------------------------------------------------
// segment mapping (decision 2)

const ASSET = asAssetId('ast-0123456789abcdef')

test('segment mapping: columns, key, derived id, revision 0, sourceHash', () => {
  const { dropped, coercions } = counters()
  const segment = mapLegacySegment(
    { index: 0, id: 'seg-1', source: 'Hello', target: 'Hallo', locked: true, status: 'confirmed' },
    { assetId: ASSET, ordinal: 0, sourceLocale: 'en', targetLocale: 'de' },
    dropped,
    coercions,
  )
  assert.equal(segment.id, deriveSegmentId(ASSET, 0, 'seg-1'))
  assert.equal(segment.key, 'seg-1')
  assert.equal(segment.ordinal, 0)
  assert.equal(segment.source, 'Hello')
  assert.equal(segment.target, 'Hallo')
  assert.equal(segment.locked, true)
  assert.equal(segment.status, 'translated')
  assert.equal(segment.revision, 0)
  assert.match(segment.sourceHash, /^[0-9a-f]{16}$/)
  assert.deepEqual(segment.context, { meta: { legacyIndex: '0' } })
  assert.equal(dropped.size, 0)
})

test('segment mapping: context note/origin/meta evidence assembly', () => {
  const { dropped, coercions } = counters()
  const segment = mapLegacySegment(
    {
      index: 3,
      id: 'seg-9',
      masterId: 'master-1',
      resname: 'res-1',
      contextNote: 'keep the tone',
      source: 'A',
      target: 'B',
      originalTarget: 'B0',
      rawSource: 'A{1}',
      rawTarget: 'B{1}',
      locked: false,
      status: 'draft',
      duplicateKey: 'dup-1',
      duplicateRole: 'first',
      duplicateOrdinal: 2,
      duplicateGroupSize: 4,
      duplicateFirstSegmentId: 'seg-7',
      placeholderCount: 1,
      confirmationLevel: 'ApprovedTranslation',
      tuId: 'tu-42',
      updatedAt: '2025-05-01T00:00:00Z',
      updateReason: 'terminology fix',
      updateChangeType: 'terminology',
      updateEvidenceSources: ['tm', 'termbase'],
    },
    { assetId: ASSET, ordinal: 3, sourceLocale: 'en', targetLocale: 'de' },
    dropped,
    coercions,
  )
  assert.equal(segment.context?.note, 'keep the tone')
  assert.equal(segment.context?.origin, 'master-1')
  assert.deepEqual(segment.context?.meta, {
    resname: 'res-1',
    legacyIndex: '3',
    duplicateKey: 'dup-1',
    duplicateRole: 'first',
    duplicateOrdinal: '2',
    duplicateGroupSize: '4',
    duplicateFirstSegmentId: 'seg-7',
    originalTarget: 'B0',
    rawSource: 'A{1}',
    rawTarget: 'B{1}',
    placeholderCount: '1',
    confirmationLevel: 'ApprovedTranslation',
    tuId: 'tu-42',
    updatedAt: '2025-05-01T00:00:00Z',
    updateReason: 'terminology fix',
    updateChangeType: 'terminology',
    updateEvidenceSources: '["tm","termbase"]',
  })
  assert.equal(dropped.size, 0)
})

test('segment mapping: unresolved* computed values are dropped and counted', () => {
  const { dropped, coercions } = counters()
  const segment = mapLegacySegment(
    {
      index: 0,
      id: 's',
      source: 'A',
      target: '',
      locked: false,
      status: 'new',
      unresolvedPlaceholderCount: 1,
      unresolvedRuntimePlaceholderCount: 1,
      unresolvedTagPlaceholderCount: 0,
      unresolvedPlaceholders: ['{1}'],
      unresolvedRuntimePlaceholders: ['{1}'],
      unresolvedTagPlaceholders: [],
      mysteryField: 'x',
    },
    { assetId: ASSET, ordinal: 0, sourceLocale: 'en', targetLocale: 'de' },
    dropped,
    coercions,
  )
  assert.deepEqual(segment.context, { meta: { legacyIndex: '0' } })
  assert.deepEqual(counterToRecord(dropped), {
    'segment.unresolvedPlaceholderCount': 1,
    'segment.unresolvedRuntimePlaceholderCount': 1,
    'segment.unresolvedTagPlaceholderCount': 1,
    'segment.unresolvedPlaceholders': 1,
    'segment.unresolvedRuntimePlaceholders': 1,
    'segment.unresolvedTagPlaceholders': 1,
    'segment.unknown:mysteryField': 1,
  })
})

// ---------------------------------------------------------------------------
// batch mapping (decision 10 + batch-level drops)

test('batch mapping: one batch = one asset, array order = ordinal, batch fields dropped + counted', () => {
  const { dropped, coercions } = counters()
  const mapped = mapLegacyBatch(
    {
      schemaVersion: 1,
      format: 'phrase_mxliff',
      projectId: 'p1',
      batchId: 'b1',
      sourceFile: '/ext/file.mxliff',
      masterFile: '/ext/master.xliff',
      sourceLanguage: 'en',
      targetLanguage: 'de',
      workflowStage: 'translate',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-02-01T00:00:00Z',
      tagReport: { tags: 2 },
      duplicateSourceGroups: [],
      segments: [
        { index: 0, id: 's1', source: 'one', target: 'eins', locked: false, status: 'confirmed' },
        { index: 1, id: 's2', source: 'two', target: 'zwei', locked: true, status: 'draft' },
      ],
    },
    {
      newProjectId: asProjectId('prj-0123456789abcdef'),
      sourceSha256: 'f'.repeat(64),
      originalFilename: 'file.mxliff',
      sourceLocale: 'en',
      targetLocale: 'de',
    },
    dropped,
    coercions,
  )
  assert.equal(mapped.asset.formatId, 'phrase_mxliff_1_2')
  assert.equal(mapped.asset.segmentCount, 2)
  assert.equal(mapped.segments.length, 2)
  assert.equal(mapped.segments[0]?.ordinal, 0)
  assert.equal(mapped.segments[1]?.ordinal, 1)
  assert.deepEqual(counterToRecord(dropped), {
    'batch.masterFile': 1,
    'batch.workflowStage': 1,
    'batch.createdAt': 1,
    'batch.updatedAt': 1,
    'batch.tagReport': 1,
    'batch.duplicateSourceGroups': 1,
  })
})

// ---------------------------------------------------------------------------
// TM mapping (decision 3)

test('tm mapping: carries source/target/langs/origin; drops no-column fields with counts', () => {
  const { dropped, coercions } = counters()
  const input = mapTmEntry(
    {
      id: 'tm-1',
      source: 'Hello',
      target: 'Hallo',
      srcLang: 'en',
      tgtLang: 'de',
      origin: 'reviewed',
      quality: 90,
      project: 'p1',
      note: 'from client',
      sourceKind: 'client_import',
      sourceBatchId: 'b1',
      sourceSegmentId: 's1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-02-01T00:00:00Z',
    },
    { sourceLocale: 'en', targetLocale: 'de' },
    dropped,
    coercions,
  )
  assert.deepEqual(input, { source: 'Hello', target: 'Hallo', sourceLocale: 'en', targetLocale: 'de', origin: 'reviewed' })
  assert.deepEqual(counterToRecord(dropped), {
    'tm.id': 1,
    'tm.quality': 1,
    'tm.project': 1,
    'tm.note': 1,
    'tm.sourceKind': 1,
    'tm.sourceBatchId': 1,
    'tm.sourceSegmentId': 1,
    'tm.createdAt': 1,
    'tm.updatedAt': 1,
  })
  assert.equal(coercions.size, 0)
})

test('tm mapping: missing languages fall back to project locales; invalid entries dropped', () => {
  const { dropped, coercions } = counters()
  const input = mapTmEntry({ source: 'A', target: 'B' }, { sourceLocale: 'en', targetLocale: 'de' }, dropped, coercions)
  assert.deepEqual(input, { source: 'A', target: 'B', sourceLocale: 'en', targetLocale: 'de' })
  assert.deepEqual(counterToRecord(coercions), { 'tm.srcLang:missing->project-locale': 1, 'tm.tgtLang:missing->project-locale': 1 })
  assert.equal(mapTmEntry({ source: 'A' }, { sourceLocale: 'en', targetLocale: 'de' }, dropped, coercions), null)
  assert.equal(dropped.get('tm.entry-missing-source-or-target'), 1)
})

// ---------------------------------------------------------------------------
// termbase mapping (decision 4)

test('term status: history grouping current/deprecated-family/conflict/none', () => {
  const { coercions } = counters()
  assert.equal(termStatusFromHistory(null, coercions), 'allowed')
  assert.equal(termStatusFromHistory({ status: 'current' }, coercions), 'preferred')
  for (const status of ['deprecated', 'deleted', 'pending', 'unconfirmed_later_row']) {
    assert.equal(termStatusFromHistory({ status }, coercions), 'deprecated')
  }
  assert.equal(termStatusFromHistory({ status: 'conflict' }, coercions), 'allowed')
  assert.equal(termStatusFromHistory({ status: 'something-else' }, coercions), 'allowed')
  assert.deepEqual(counterToRecord(coercions), {
    'termbase.history-conflict->allowed': 1,
    'termbase.history-unknown:something-else->allowed': 1,
  })
})

test('history decision matching: target, deprecatedTargets, conflictTargets (normTerm)', () => {
  const decisions = [
    { source: 'Term', target: 'Begriff', status: 'current' },
    { source: 'Other', deprecatedTargets: ['Alt'], status: 'deprecated' },
    { source: 'Conf', conflictTargets: ['X', 'Y'], status: 'conflict' },
  ]
  assert.equal(findHistoryDecision(decisions, 'term', 'begriff')?.status, 'current')
  assert.equal(findHistoryDecision(decisions, 'other', 'alt')?.status, 'deprecated')
  assert.equal(findHistoryDecision(decisions, 'conf', 'y')?.status, 'conflict')
  assert.equal(findHistoryDecision(decisions, 'conf', 'z'), null)
  // whitespace/case-insensitive (legacy normTerm)
  assert.equal(findHistoryDecision(decisions, '  TERM ', 'BEGRIFF')?.status, 'current')
})

test('termbase mapping: term/translation/note carry; origin folds into note prefix; drops counted', () => {
  const { dropped, coercions } = counters()
  const input = mapTermbaseEntry(
    {
      id: 'tb-1',
      source: 'Term',
      target: 'Begriff',
      srcLang: 'en',
      tgtLang: 'de',
      note: 'keep',
      conceptId: 5,
      fields: { definition: ['def'] },
      sourceFile: 'tb.xlsx',
      sheetName: 'Sheet1',
      rowNo: 7,
      origin: 'sdltb',
    },
    [],
    dropped,
    coercions,
  )
  assert.deepEqual(input, { term: 'Term', translation: 'Begriff', status: 'allowed', caseSensitive: false, note: 'origin:sdltb | keep' })
  assert.deepEqual(counterToRecord(dropped), {
    'termbase.id': 1,
    'termbase.conceptId': 1,
    'termbase.fields': 1,
    'termbase.sourceFile': 1,
    'termbase.sheetName': 1,
    'termbase.rowNo': 1,
    'termbase.srcLang': 1,
    'termbase.tgtLang': 1,
  })
})

test('termbase mapping: history-driven status + origin-only note prefix', () => {
  const { dropped, coercions } = counters()
  const preferred = mapTermbaseEntry(
    { source: 'Term', target: 'Begriff', origin: 'manual' },
    [{ source: 'Term', target: 'Begriff', status: 'current' }],
    dropped,
    coercions,
  )
  assert.deepEqual(preferred, { term: 'Term', translation: 'Begriff', status: 'preferred', caseSensitive: false, note: 'origin:manual' })
})

test('override mapping: note follows the legacy overrideToEntry formula', () => {
  const { dropped } = counters()
  assert.deepEqual(
    mapOverrideEntry({ source: 'A', target: 'B', reason: 'client wish', decidedBy: 'pm', ts: '2024-01-01' }, dropped),
    { term: 'A', translation: 'B', status: 'preferred', caseSensitive: false, note: 'client wish | Decided by: pm | 2024-01-01' },
  )
  assert.deepEqual(
    mapOverrideEntry({ source: 'A', target: 'B', reason: 'r' }, dropped),
    { term: 'A', translation: 'B', status: 'preferred', caseSensitive: false, note: 'r' },
  )
  assert.deepEqual(
    mapOverrideEntry({ source: 'A', target: 'B', decidedBy: 'pm' }, dropped),
    { term: 'A', translation: 'B', status: 'preferred', caseSensitive: false, note: 'Decided by: pm' },
  )
  assert.deepEqual(
    mapOverrideEntry({ source: 'A', target: 'B', ts: '2024' }, dropped),
    { term: 'A', translation: 'B', status: 'preferred', caseSensitive: false, note: '2024' },
  )
  // no parts -> no note at all
  assert.deepEqual(
    mapOverrideEntry({ source: 'A', target: 'B' }, dropped),
    { term: 'A', translation: 'B', status: 'preferred', caseSensitive: false },
  )
  // locales have no column -> dropped + counted
  mapOverrideEntry({ source: 'A', target: 'B', srcLang: 'en', tgtLang: 'de' }, dropped)
  assert.deepEqual(counterToRecord(dropped), { 'termbase-override.srcLang': 1, 'termbase-override.tgtLang': 1 })
  // invalid rows dropped
  assert.equal(mapOverrideEntry({ source: 'A' }, dropped), null)
  assert.equal(dropped.get('termbase-override.missing-source-or-target'), 1)
})

// ---------------------------------------------------------------------------
// QA mapping (decision 5)

test('qa severity: blocker/warning/advisory -> L1/L2/L4（占位符/标签/ICU 旧码 blocker 特判 L0）；未知回落 L4', () => {
  const { coercions } = counters()
  assert.equal(mapQaSeverity('blocker', 'terminology_mismatch', coercions), 'L1')
  assert.equal(mapQaSeverity('blocker', 'placeholder_mismatch', coercions), 'L0')
  assert.equal(mapQaSeverity('blocker', 'tag_mismatch', coercions), 'L0')
  assert.equal(mapQaSeverity('blocker', 'icu_branch_mismatch', coercions), 'L0')
  assert.equal(mapQaSeverity('warning', 'terminology_mismatch', coercions), 'L2')
  assert.equal(mapQaSeverity('advisory', 'suspicious_length_ratio', coercions), 'L4')
  assert.equal(mapQaSeverity('major', 'x', coercions), 'L4')
  assert.equal(mapQaSeverity(undefined, 'x', coercions), 'L4')
  assert.deepEqual(counterToRecord(coercions), { 'qa.severity.major->L4': 1, 'qa.severity.missing->L4': 1 })
})

test('ledger reviews: latest decision per findingId, review kinds only', () => {
  const reviews = collectLedgerReviews([
    { kind: 'delivery_finding', decision: 'open', findingId: 'f1' },
    { kind: 'delivery_waiver', decision: 'ignore_with_reason', findingId: 'f1', reason: 'first' },
    { kind: 'delivery_waiver', decision: 'accepted_risk', findingId: 'f1', reason: 'latest wins' },
    { kind: 'team_decision', decision: 'fix_required', findingId: 'f2', reason: 'must fix' },
    { kind: 'export_authorization', decision: 'authorized', findingId: 'f3' },
    { kind: 'delivery_waiver', decision: 'accepted_risk' },
  ])
  assert.deepEqual(reviews.get('f1'), { decision: 'accepted_risk', reason: 'latest wins' })
  assert.deepEqual(reviews.get('f2'), { decision: 'fix_required', reason: 'must fix' })
  assert.equal(reviews.get('f3'), undefined)
  assert.equal(reviews.size, 2)
})

test('qa finding mapping: open/waived/dropped paths', () => {
  const { dropped, coercions } = counters()
  const segmentIds = new Map([
    ['s1', 'seg-0000000000000001'],
    ['s2', 'seg-0000000000000002'],
  ])
  const reviews = new Map([
    ['f-waived', { decision: 'accepted_risk', reason: 'client approved' }],
    ['f-blank-reason', { decision: 'ignore_with_reason', reason: '  ' }],
    ['f-open', { decision: 'fix_required', reason: 'must fix' }],
    ['f-query', { decision: 'query', reason: 'ask client' }],
  ])
  // no review -> open
  const open = mapQaFinding({ id: 'f-none', type: 'TERM', severity: 'blocker', segmentId: 's1', message: 'm' }, segmentIds, reviews, dropped, coercions)
  assert.deepEqual(open, { input: { segmentId: 'seg-0000000000000001', code: 'TERM', severity: 'L1', message: 'm' }, waiveReason: null })
  // accepted_risk -> waived with reviewReason
  const waived = mapQaFinding({ id: 'f-waived', type: 'TERM', severity: 'warning', segmentId: 's2', message: 'm' }, segmentIds, reviews, dropped, coercions)
  assert.equal(waived?.waiveReason, 'client approved')
  // blank review reason -> honest fallback (store requires non-empty)
  const blank = mapQaFinding({ id: 'f-blank-reason', type: 'TERM', severity: 'warning', segmentId: 's2', message: 'm' }, segmentIds, reviews, dropped, coercions)
  assert.equal(blank?.waiveReason, 'legacy review decision: ignore_with_reason')
  // fix_required / query -> open
  assert.equal(mapQaFinding({ id: 'f-open', type: 'T', severity: 'advisory', segmentId: 's1', message: 'm' }, segmentIds, reviews, dropped, coercions)?.waiveReason, null)
  assert.equal(mapQaFinding({ id: 'f-query', type: 'T', severity: 'advisory', segmentId: 's1', message: 'm' }, segmentIds, reviews, dropped, coercions)?.waiveReason, null)
  // no segmentId -> dropped
  assert.equal(mapQaFinding({ id: 'f1', type: 'T', severity: 'warning', message: 'm' }, segmentIds, reviews, dropped, coercions), null)
  // unknown segmentId -> dropped
  assert.equal(mapQaFinding({ id: 'f2', type: 'T', severity: 'warning', segmentId: 'ghost', message: 'm' }, segmentIds, reviews, dropped, coercions), null)
  assert.deepEqual(counterToRecord(dropped), { 'qa.finding-no-segment-id': 1, 'qa.finding-unknown-segment': 1 })
})

test('latest report per batch: max generatedAt wins, ties deterministic, no-batchId counted', () => {
  const { dropped } = counters()
  const report = (fileName: string, reportId: string | null, batchId: string | null, generatedAt: string | null) => ({
    fileName,
    reportId,
    batchId,
    generatedAt,
    error: null,
  })
  const latest = selectLatestReportsPerBatch(
    [
      report('r-old.json', 'r-old', 'b1', '2025-01-01T00:00:00Z'),
      report('r-new.json', 'r-new', 'b1', '2025-06-01T00:00:00Z'),
      report('r-tie-a.json', 'r-a', 'b2', '2025-03-01T00:00:00Z'),
      report('r-tie-b.json', 'r-b', 'b2', '2025-03-01T00:00:00Z'),
      report('r-nobatch.json', 'r-nb', null, '2025-01-01T00:00:00Z'),
    ],
    dropped,
  )
  assert.equal(latest.get('b1')?.reportId, 'r-new')
  assert.equal(latest.get('b2')?.reportId, 'r-b') // tie -> higher reportId wins
  assert.equal(latest.size, 2)
  assert.equal(dropped.get('qa.report-no-batch-id'), 1)
  assert.equal(dropped.get('qa.report-superseded-by-newer'), 2)
})
