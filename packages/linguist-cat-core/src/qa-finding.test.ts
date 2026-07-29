import { describe, expect, test } from 'bun:test'
import {
  InvalidStateTransitionError,
  QA_FINDING_TRANSITIONS,
  openQaFinding,
  transitionQaFinding,
} from './index'
import { makeSegment } from './segment.test'

describe('QA Finding（类型 + 不变量，无规则引擎）', () => {
  test('open → resolved / waived；resolved/waived → open（重开）', () => {
    const seg = makeSegment()
    const finding = openQaFinding({
      segmentId: seg.id,
      code: 'NUMBER_MISMATCH',
      severity: 'L1',
      message: '数字不一致：源 3 处，译文 2 处',
    })
    expect(finding.status).toBe('open')
    expect(finding.id).toMatch(/^qaf_v2_[0-9a-f]{64}$/)
    // PB-096：issueType/disposition 缺省按 code 静态映射表回填
    expect(finding.issueType).toBe('numbers_units_dates')
    expect(finding.disposition).toBe('defect')

    const resolved = transitionQaFinding(finding, 'resolved')
    expect(resolved.status).toBe('resolved')
    expect(transitionQaFinding(resolved, 'open').status).toBe('open')
    expect(transitionQaFinding(finding, 'waived').status).toBe('waived')
  })

  test('未知码兜底 other/L2/defect；显式传入优先于映射表', () => {
    const seg = makeSegment()
    const fallback = openQaFinding({ segmentId: seg.id, code: 'X_UNKNOWN', severity: 'L2', message: 'm' })
    expect(fallback.issueType).toBe('other')
    expect(fallback.disposition).toBe('defect')
    const explicit = openQaFinding({
      segmentId: seg.id,
      code: 'REQUIRED_TERM',
      severity: 'L1',
      issueType: 'terminology_hard',
      disposition: 'defect',
      message: 'm',
    })
    expect(explicit.issueType).toBe('terminology_hard')
    expect(explicit.disposition).toBe('defect')
  })

  test('非法迁移 → InvalidStateTransitionError', () => {
    const seg = makeSegment()
    const finding = openQaFinding({ segmentId: seg.id, code: 'X', severity: 'L4', message: 'm' })
    expect(() => transitionQaFinding(finding, 'open')).toThrow(InvalidStateTransitionError)
    const resolved = transitionQaFinding(finding, 'resolved')
    expect(() => transitionQaFinding(resolved, 'waived')).toThrow(InvalidStateTransitionError)
  })

  test('迁移表与实现一致（守卫）', () => {
    expect(QA_FINDING_TRANSITIONS.open).toEqual(['resolved', 'waived'])
    expect(QA_FINDING_TRANSITIONS.resolved).toEqual(['open'])
    expect(QA_FINDING_TRANSITIONS.waived).toEqual(['open'])
  })
})
