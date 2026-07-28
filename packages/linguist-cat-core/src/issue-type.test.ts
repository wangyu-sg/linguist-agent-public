import { describe, expect, test } from 'bun:test'
import { DEFAULT_GLOSSARY_POLICY, normalizeGlossaryPolicy } from './glossary-policy'
import {
  FALLBACK_QA_ISSUE_MAPPING,
  QA_CODE_ISSUE_MAPPING,
  QA_FINDING_DISPOSITIONS,
  QA_FINDING_SEVERITIES,
  QA_ISSUE_TYPES,
  resolveQaIssueMapping,
} from './issue-type'
import { QA_RULE_CODES } from './qa-core'

describe('PB-096 issue_type 契约（29 枚举 + 静态映射表）', () => {
  test('issue_type 恰为契约 29 枚举（含 other 兜底）', () => {
    expect(QA_ISSUE_TYPES.length).toBe(29)
    expect(new Set(QA_ISSUE_TYPES).size).toBe(29)
    expect(QA_ISSUE_TYPES).toContain('other')
  })

  test('severity 五档 / disposition 四值词表', () => {
    expect(QA_FINDING_SEVERITIES).toEqual(['L0', 'L1', 'L2', 'L3', 'L4'])
    expect(QA_FINDING_DISPOSITIONS).toEqual(['defect', 'needs_review', 'query', 'info'])
  })

  test('QA 全部规则码都在静态映射表中，且表值落在词表内', () => {
    for (const code of Object.values(QA_RULE_CODES)) {
      const mapping = QA_CODE_ISSUE_MAPPING[code]
      expect(mapping, `missing mapping for ${code}`).toBeDefined()
      expect(QA_ISSUE_TYPES).toContain(mapping!.issueType)
      expect(QA_FINDING_SEVERITIES).toContain(mapping!.severity)
      expect(QA_FINDING_DISPOSITIONS).toContain(mapping!.disposition)
    }
  })

  test('契约定级抽查：占位符/标签 L0 defect；术语冲突 query；未知码 other 兜底', () => {
    expect(resolveQaIssueMapping('PLACEHOLDER_MISMATCH')).toEqual({
      issueType: 'placeholders_variables',
      severity: 'L0',
      disposition: 'defect',
    })
    expect(resolveQaIssueMapping('TAG_MISMATCH').severity).toBe('L0')
    expect(resolveQaIssueMapping('GLOSSARY_CONFLICT').disposition).toBe('query')
    expect(resolveQaIssueMapping('NO_SUCH_CODE')).toEqual(FALLBACK_QA_ISSUE_MAPPING)
  })
})

describe('PB-096 glossaryPolicy（缺省回落，同 qualityProfile 先例）', () => {
  test('三档字面量原样通过；缺省/未知一律回落 prefer', () => {
    expect(DEFAULT_GLOSSARY_POLICY).toBe('prefer')
    for (const policy of ['strict', 'prefer', 'off'] as const) {
      expect(normalizeGlossaryPolicy(policy)).toBe(policy)
    }
    expect(normalizeGlossaryPolicy(undefined)).toBe('prefer')
    expect(normalizeGlossaryPolicy('STRICT')).toBe('prefer')
    expect(normalizeGlossaryPolicy(42)).toBe('prefer')
    expect(normalizeGlossaryPolicy(null)).toBe('prefer')
  })
})
