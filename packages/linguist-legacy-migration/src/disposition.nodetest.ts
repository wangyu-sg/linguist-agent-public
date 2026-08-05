/**
 * PB-092 disposition unit tests: the pure derivation table (five outcomes,
 * precedence rules) and the project router (not-found / quarantine /
 * salvage / import across the orphan situations).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveDisposition, determineProjectRoute, type DispositionInput, type ProjectRouteInput } from './disposition'

function plan(overrides: Partial<DispositionInput> = {}): DispositionInput {
  return {
    refused: false,
    storeError: false,
    assetsImported: 0,
    assetsSkipped: 0,
    lostSources: 0,
    exportUnavailable: 0,
    qaDropped: 0,
    tmImported: 0,
    termsImported: 0,
    archivesPlanned: 0,
    ...overrides,
  }
}

function route(overrides: Partial<ProjectRouteInput> = {}): ProjectRouteInput {
  return {
    dirExists: true,
    manifestResolved: true,
    manifestError: null,
    localesAvailable: true,
    salvageOrphan: false,
    batches: 0,
    readCacheHasProjections: false,
    blobStoreBlobs: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// deriveDisposition

test('disposition: clean import with assets is imported', () => {
  assert.equal(deriveDisposition(plan({ assetsImported: 2, tmImported: 5, termsImported: 3 })), 'imported')
})

test('disposition: TM-only project (zero assets, zero archives) is imported', () => {
  assert.equal(deriveDisposition(plan({ tmImported: 7 })), 'imported')
})

test('disposition: any degradation is partial (skipped / lost / export-unavailable / qa-dropped)', () => {
  assert.equal(deriveDisposition(plan({ assetsImported: 1, assetsSkipped: 1 })), 'partial')
  assert.equal(deriveDisposition(plan({ assetsImported: 1, lostSources: 1 })), 'partial')
  assert.equal(deriveDisposition(plan({ assetsImported: 1, exportUnavailable: 1 })), 'partial')
  assert.equal(deriveDisposition(plan({ assetsImported: 1, qaDropped: 2 })), 'partial')
})

test('disposition: zero CAT data with archives is archived-only (chat-only project)', () => {
  assert.equal(deriveDisposition(plan({ archivesPlanned: 1 })), 'archived-only')
})

test('disposition: partial beats archived-only when CAT data was lost', () => {
  // one unreadable batch + chat archived -> partial, not archived-only
  assert.equal(deriveDisposition(plan({ assetsSkipped: 1, archivesPlanned: 1 })), 'partial')
})

test('disposition: archived-only requires zero assets AND zero TM/TB', () => {
  assert.equal(deriveDisposition(plan({ tmImported: 1, archivesPlanned: 1 })), 'imported')
  assert.equal(deriveDisposition(plan({ termsImported: 1, archivesPlanned: 1 })), 'imported')
})

test('disposition: quarantined and error win over every counter', () => {
  assert.equal(deriveDisposition(plan({ refused: true, assetsImported: 3, assetsSkipped: 1, archivesPlanned: 2 })), 'quarantined')
  assert.equal(deriveDisposition(plan({ storeError: true, assetsImported: 3 })), 'error')
  // refused outranks a mid-flight store error flag (never both, but the order is pinned)
  assert.equal(deriveDisposition(plan({ refused: true, storeError: true })), 'quarantined')
})

// ---------------------------------------------------------------------------
// determineProjectRoute

test('route: directory + manifest + locales -> import', () => {
  assert.deepEqual(determineProjectRoute(route()), { kind: 'import' })
})

test('route: no directory, no projection -> not-found (exit 3 path)', () => {
  assert.deepEqual(determineProjectRoute(route({ dirExists: false, manifestResolved: false })), { kind: 'not-found' })
})

test('route: projection without directory -> quarantine orphan-sqlite-project with layer evidence', () => {
  const decision = determineProjectRoute(
    route({ dirExists: false, manifestResolved: true, readCacheHasProjections: true, blobStoreBlobs: 4 }),
  )
  assert.deepEqual(decision, {
    kind: 'quarantine',
    refusal: { reason: 'orphan-sqlite-project', evidence: { readCacheHasProjections: true, blobStoreBlobs: 4 } },
  })
  // --salvage-orphan never rescues a directory-less project
  const salvaged = determineProjectRoute(route({ dirExists: false, manifestResolved: true, salvageOrphan: true }))
  assert.equal(salvaged.kind, 'quarantine')
})

test('route: orphan project (dir, no manifest) is quarantined by default', () => {
  const decision = determineProjectRoute(
    route({ manifestResolved: false, manifestError: 'invalid JSON: boom', batches: 2, localesAvailable: true }),
  )
  assert.equal(decision.kind, 'quarantine')
  assert.equal(decision.kind === 'quarantine' && decision.refusal.reason, 'orphan-project')
})

test('route: orphan + --salvage-orphan + batch locales -> salvage', () => {
  assert.deepEqual(
    determineProjectRoute(route({ manifestResolved: false, salvageOrphan: true, localesAvailable: true, batches: 2 })),
    { kind: 'salvage' },
  )
})

test('route: orphan + --salvage-orphan without any locales -> quarantine orphan-project-no-locales', () => {
  const decision = determineProjectRoute(
    route({ manifestResolved: false, salvageOrphan: true, localesAvailable: false, batches: 1 }),
  )
  assert.equal(decision.kind, 'quarantine')
  assert.equal(decision.kind === 'quarantine' && decision.refusal.reason, 'orphan-project-no-locales')
})

test('route: readable manifest but no language pair anywhere -> quarantine missing-locales', () => {
  const decision = determineProjectRoute(route({ localesAvailable: false }))
  assert.deepEqual(decision, { kind: 'quarantine', refusal: { reason: 'missing-locales', evidence: { batches: 0 } } })
})
