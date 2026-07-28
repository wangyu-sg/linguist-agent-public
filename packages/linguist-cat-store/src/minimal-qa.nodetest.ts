import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AssetId, Segment, SegmentId } from '@linguist/cat-core'
import {
  MINIMAL_QA_RULES,
  minimalQaSegment,
  multisetDiff,
  placeholderMultiset,
} from './minimal-qa'

function segment(patch: Partial<Segment>): Segment {
  return {
    id: 'seg-0000000000000001' as SegmentId,
    assetId: 'ast-0000000000000001' as AssetId,
    ordinal: 0,
    source: 'Source text',
    target: '',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    status: 'untranslated',
    locked: false,
    revision: 0,
    sourceHash: 'h',
    ...patch,
  }
}

test('minimal qa: empty target on a non-empty source -> EMPTY_TARGET warning', () => {
  const findings = minimalQaSegment(segment({ source: 'Press Start', target: '' }))
  assert.equal(findings.length, 1)
  assert.equal(findings[0]!.code, MINIMAL_QA_RULES.EMPTY_TARGET)
  assert.equal(findings[0]!.severity, 'L1')
  assert.match(findings[0]!.message, /Press Start/)
})

test('minimal qa: empty source never fires EMPTY_TARGET', () => {
  assert.deepEqual(minimalQaSegment(segment({ source: '', target: '' })), [])
})

test('minimal qa: locked segments are skipped entirely', () => {
  assert.deepEqual(minimalQaSegment(segment({ locked: true, target: '' })), [])
  assert.deepEqual(
    minimalQaSegment(segment({ locked: true, source: 'Score: {score}', target: '得分' })),
    [],
  )
})

test('minimal qa: matching placeholders -> no findings', () => {
  assert.deepEqual(
    minimalQaSegment(
      segment({ source: 'Score: {score}', target: '得分：{score}', status: 'draft' }),
    ),
    [],
  )
  // inline tags match as multisets (order-independent)
  assert.deepEqual(
    minimalQaSegment(
      segment({
        source: 'Press <g id="1" ctype="bold">Enter</g> to continue',
        target: '按 <g id="1" ctype="bold">Enter</g> 继续',
        status: 'draft',
      }),
    ),
    [],
  )
})

test('minimal qa: dropped placeholder -> PLACEHOLDER_MISMATCH naming the token', () => {
  const findings = minimalQaSegment(segment({ source: 'Score: {score}', target: '得分', status: 'draft' }))
  assert.equal(findings.length, 1)
  assert.equal(findings[0]!.code, MINIMAL_QA_RULES.PLACEHOLDER_MISMATCH)
  assert.match(findings[0]!.message, /missing in target: \{score\}/)
})

test('minimal qa: extra placeholder in target -> PLACEHOLDER_MISMATCH (not in source)', () => {
  const findings = minimalQaSegment(segment({ source: 'Halt!', target: '站住！{who}', status: 'draft' }))
  assert.equal(findings.length, 1)
  assert.match(findings[0]!.message, /not in source: \{who\}/)
})

test('minimal qa: multiplicities matter (two uses of one token)', () => {
  const findings = minimalQaSegment(
    segment({ source: '{n} of {n}', target: '{n}', status: 'draft' }),
  )
  assert.equal(findings.length, 1)
  assert.match(findings[0]!.message, /\{n\}, \{n\}|\{n\}/)
})

test('minimal qa: placeholder helpers — multiset + diff', () => {
  const tokens = placeholderMultiset('a {x} <b> c {x}')
  assert.equal(tokens.get('{x}'), 2)
  assert.equal(tokens.get('<b>'), 1)
  assert.deepEqual(multisetDiff(new Map([['{x}', 2]]), new Map([['{x}', 1]])), ['{x}'])
  assert.deepEqual(multisetDiff(new Map([['{x}', 1]]), new Map([['{x}', 3]])), [])
})
