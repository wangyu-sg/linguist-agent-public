import { describe, expect, test } from 'bun:test'
import {
  AUDIT_ONLY_EVIDENCE_PATTERNS,
  isAuditOnlyEvidenceSource,
  isCitableEvidenceSource,
} from './index'

describe('evidence（可引用证据判定，PB-083 随迁）', () => {
  test('六条审计专用前缀正则逐条命中（大小写不敏感、允许分隔符变体）', () => {
    const auditOnly = [
      'tool_trace: run 1',
      'tool call: cat_get_segments',
      'trace: session-9',
      'agent_event: msg-1',
      'agent events stream',
      'pi-event: turn-3',
      'runtime_validation: gate',
      'TOOL-TRACE upper',
      '  tooltrace padded',
    ]
    for (const value of auditOnly) {
      expect(isAuditOnlyEvidenceSource(value)).toBe(true)
      expect(isCitableEvidenceSource(value)).toBe(false)
    }
    expect(AUDIT_ONLY_EVIDENCE_PATTERNS.length).toBe(6)
  })

  test('普通来源可引用；空串/空白不可引用也不算审计专用', () => {
    const citable = ['term: 术语库 v3', 'tm:prp-abc', 'seg-0123 target', '项目术语表.csv:12']
    for (const value of citable) {
      expect(isAuditOnlyEvidenceSource(value)).toBe(false)
      expect(isCitableEvidenceSource(value)).toBe(true)
    }
    expect(isCitableEvidenceSource('')).toBe(false)
    expect(isCitableEvidenceSource('   ')).toBe(false)
    expect(isAuditOnlyEvidenceSource('')).toBe(false)
  })
})
