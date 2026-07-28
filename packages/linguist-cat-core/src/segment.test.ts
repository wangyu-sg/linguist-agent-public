import { describe, expect, test } from 'bun:test'
import {
  RevisionConflictError,
  SegmentLockedError,
  applyTargetEdit,
  compareSegments,
  deriveAssetId,
  deriveSegmentId,
  lockSegment,
  sortSegments,
  unlockSegment,
  type Segment,
} from './index'

const NOW = '2026-07-25T00:00:00.000Z'

export function makeSegment(overrides: Partial<Segment> = {}): Segment {
  const assetId = deriveAssetId('prj-1', 'sha256', 'ui.xlf')
  return {
    id: deriveSegmentId(assetId, 1),
    assetId,
    ordinal: 1,
    source: 'Hello',
    target: '',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
    status: 'untranslated',
    locked: false,
    revision: 0,
    sourceHash: 'abc123',
    ...overrides,
  }
}

describe('applyTargetEdit（CAS）', () => {
  test('期望 revision 匹配 → 段更新 + revision 递增 + 历史条目', () => {
    const seg = makeSegment()
    const { segment, revision } = applyTargetEdit(seg, '你好', 0, { now: NOW })

    expect(segment.target).toBe('你好')
    expect(segment.status).toBe('draft')
    expect(segment.revision).toBe(1)
    expect(revision).toEqual({ revision: 1, target: '你好', status: 'draft', source: 'human', createdAt: NOW })
    // 输入不被突变
    expect(seg.target).toBe('')
    expect(seg.revision).toBe(0)
  })

  test('空译文 → untranslated', () => {
    const { segment } = applyTargetEdit(makeSegment({ target: 'x', status: 'draft', revision: 2 }), '', 2, {
      now: NOW,
    })
    expect(segment.status).toBe('untranslated')
  })

  test('revision 不匹配 → RevisionConflictError，绝不覆盖', () => {
    const seg = makeSegment({ target: '已有译文', revision: 3 })
    let caught: unknown
    try {
      applyTargetEdit(seg, '覆盖', 2, { now: NOW })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RevisionConflictError)
    const conflict = caught as RevisionConflictError
    expect(conflict.code).toBe('REVISION_CONFLICT')
    expect(conflict.expectedRevision).toBe(2)
    expect(conflict.currentRevision).toBe(3)
    // 原段未被改动
    expect(seg.target).toBe('已有译文')
    expect(seg.revision).toBe(3)
  })

  test('锁定段拒绝编辑（SegmentLockedError），即使 revision 匹配', () => {
    const seg = lockSegment(makeSegment())
    expect(() => applyTargetEdit(seg, 'x', 0, { now: NOW })).toThrow(SegmentLockedError)
    try {
      applyTargetEdit(seg, 'x', 0, { now: NOW })
    } catch (err) {
      expect((err as SegmentLockedError).code).toBe('SEGMENT_LOCKED')
      expect((err as SegmentLockedError).segmentId).toBe(seg.id)
    }
  })
})

describe('锁定/解锁', () => {
  test('lock/unlock 只改标志，不动 revision 与译文', () => {
    const seg = makeSegment({ target: '定稿', status: 'reviewed', revision: 5 })
    const locked = lockSegment(seg)
    expect(locked.locked).toBe(true)
    expect(locked.revision).toBe(5)
    expect(locked.target).toBe('定稿')
    const unlocked = unlockSegment(locked)
    expect(unlocked.locked).toBe(false)
    expect(unlocked.revision).toBe(5)
  })
})

describe('确定性排序', () => {
  test('按 ordinal → key → id 全序稳定', () => {
    const a = makeSegment({ ordinal: 2, key: 'b' })
    const b = makeSegment({ ordinal: 1, key: 'z' })
    const c = makeSegment({ ordinal: 2, key: 'a' })
    const sorted = sortSegments([a, b, c])
    expect(sorted.map((s) => `${s.ordinal}:${s.key}`)).toEqual(['1:z', '2:a', '2:b'])
    // 重排输入顺序结果一致
    expect(sortSegments([c, a, b]).map((s) => s.id)).toEqual(sorted.map((s) => s.id))
  })

  test('compareSegments 对同段返回 0', () => {
    const seg = makeSegment()
    expect(compareSegments(seg, { ...seg })).toBe(0)
  })
})
