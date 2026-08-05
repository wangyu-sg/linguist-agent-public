import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Segment } from '@linguist/cat-core'
import {
  runLinguistConsistencyWorker,
  runLinguistQaWorker,
} from './cat-job-worker-client'

test('CAT QA production worker runs pure QA on a real worker thread', async () => {
  const segment = {
    id: 'seg-worker-1',
    assetId: 'asset-worker-1',
    ordinal: 0,
    source: 'Health Potion',
    target: '',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    status: 'untranslated',
    locked: false,
    revision: 0,
    sourceHash: 'worker-source-hash',
  } as Segment
  const phases: string[] = []
  const result = await runLinguistQaWorker(
    { segments: [segment], options: {} },
    undefined,
    (phase) => phases.push(phase),
  )

  assert.ok(result.workerThreadId > 0)
  assert.deepEqual(phases, ['started', 'completed'])
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0]!.code, 'EMPTY_TARGET')
  assert.equal(result.findings[0]!.segmentId, segment.id)
})

test('CAT consistency production worker returns an advisory plan on a real worker thread', async () => {
  const segments = ['译文一', '译文二'].map((target, ordinal) => ({
    id: `seg-worker-consistency-${ordinal}`,
    assetId: 'asset-worker-consistency',
    ordinal,
    source: 'Save your work',
    target,
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    status: 'translated',
    locked: false,
    revision: 0,
    sourceHash: `worker-consistency-source-hash-${ordinal}`,
  })) as Segment[]
  const phases: string[] = []
  const result = await runLinguistConsistencyWorker(
    { segments, options: {}, persistedFindings: [] },
    undefined,
    (phase) => phases.push(phase),
  )

  assert.ok(result.workerThreadId > 0)
  assert.deepEqual(phases, ['started', 'completed'])
  assert.equal(result.pass.authority, 'advisory_finding')
  assert.equal(result.pass.canCommit, false)
  assert.equal(result.pass.groups.length, 1)
  assert.deepEqual(result.pass.groups[0]!.segmentIds, segments.map((segment) => segment.id))
})
