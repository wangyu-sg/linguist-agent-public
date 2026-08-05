/**
 * Shared helpers for the store test suite (*.nodetest.ts, run under
 * node --test — bun has no node:sqlite, see runtime.ts). Every test uses
 * mkdtemp dirs only; clocks and entropy are injected for determinism.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSeededEntropy, type EntropySource } from '@linguist/cat-core'
import type { ImportedCatAsset, ImportedCatSegment } from '@linguist/cat-formats'

export function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'cat-store-test-'))
}

/** Deterministic incrementing clock: 2026-01-01T00:00:00.000Z + n seconds. */
export function makeClock(): () => string {
  let tick = 0
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick++ * 1000).toISOString()
}

export function makeEntropy(seed = 'pb-024'): EntropySource {
  return createSeededEntropy(seed)
}

export interface MakeImportedAssetOptions {
  segmentCount?: number
  formatId?: string
  filename?: string
  sourceSha256?: string
  /** Fill every Nth target with a translation. */
  fillEvery?: number
}

export function makeImportedAsset(options: MakeImportedAssetOptions = {}): ImportedCatAsset {
  const count = options.segmentCount ?? 3
  const segments: ImportedCatSegment[] = []
  for (let i = 0; i < count; i++) {
    const target = options.fillEvery !== undefined && i % options.fillEvery === 0 ? `译文 ${i}` : ''
    segments.push({
      ordinal: i,
      key: `key-${i}`,
      source: `Source text ${i}`,
      target,
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: target === '' ? 'untranslated' : 'translated',
      locked: false,
      revision: 0,
      sourceHash: `hash-${i}`,
      ...(i === 0 ? { context: { note: 'first segment', origin: 'test' } } : {}),
    })
  }
  return {
    asset: {
      formatId: options.formatId ?? 'fake_tsv',
      originalFilename: options.filename ?? 'test.tsv',
      sourceSha256: options.sourceSha256 ?? 'a'.repeat(64),
      segmentCount: count,
    },
    segments,
    warnings: [],
    originalBytes: new TextEncoder().encode('fake'),
  }
}
