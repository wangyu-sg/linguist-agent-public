import { describe, expect, test } from 'bun:test'
import type { LinguistQaFindingInfo } from '@proma/shared'
import {
  QA_DISPOSITION_LABELS,
  QA_DISPOSITIONS,
  QA_SEVERITIES,
  QA_SEVERITY_BADGE_CLASSES,
  QA_SEVERITY_LABELS,
  QA_SEVERITY_TIERS,
  QA_TIER_LABELS,
  isQaIssueType,
  qaSeverityTier,
  summarizeOpenQaFindingsBySegment,
} from './qa-findings-utils'

describe('PB-096 QA Findings 面板纯逻辑', () => {
  test('severity 五档齐全：标签与徽标色逐档有值，且全部走 token 层状态色', () => {
    expect(QA_SEVERITIES).toEqual(['L0', 'L1', 'L2', 'L3', 'L4'])
    for (const severity of QA_SEVERITIES) {
      expect(QA_SEVERITY_LABELS[severity].startsWith(severity)).toBe(true)
      const badge = QA_SEVERITY_BADGE_CLASSES[severity]
      // 禁新 raw palette：只允许 token 层状态色 / foreground 派生
      expect(/^(text-(destructive|warning|info|success)|text-foreground\/)/.test(badge)).toBe(true)
    }
  })

  test('disposition 四值齐全且有中文标签', () => {
    expect(QA_DISPOSITIONS).toEqual(['defect', 'needs_review', 'query', 'info'])
    for (const disposition of QA_DISPOSITIONS) {
      expect(QA_DISPOSITION_LABELS[disposition].length).toBeGreaterThan(0)
    }
  })

  test('K4 三级展示：五档映射阻止写回/需要检查/普通提示，普通 QA 不再一律红色', () => {
    expect(QA_SEVERITIES.map((severity) => qaSeverityTier(severity))).toEqual([
      'blocking',
      'blocking',
      'check',
      'check',
      'notice',
    ])
    expect(QA_TIER_LABELS).toEqual({
      blocking: '阻止写回',
      check: '需要检查',
      notice: '普通提示',
    })
    // 每档 tier 与徽标色一致：blocking 才用 destructive。
    for (const severity of QA_SEVERITIES) {
      const isBlocking = QA_SEVERITY_TIERS[severity] === 'blocking'
      expect(QA_SEVERITY_BADGE_CLASSES[severity].includes('destructive')).toBe(isBlocking)
    }
  })

  test('issueType 运行时守卫', () => {
    expect(isQaIssueType('terminology_hard')).toBe(true)
    expect(isQaIssueType('')).toBe(false)
    expect(isQaIssueType(42)).toBe(false)
    expect(isQaIssueType(undefined)).toBe(false)
  })

  test('given 多个片段和已处理 Finding when 汇总行内指标 then 只保留开放数量与最高严重度', () => {
    const finding = (
      id: string,
      segmentId: string,
      severity: LinguistQaFindingInfo['severity'],
      status: LinguistQaFindingInfo['status'] = 'open',
    ): LinguistQaFindingInfo => ({
      id,
      segmentId,
      code: 'qa-test',
      severity,
      issueType: 'other',
      disposition: 'needs_review',
      message: '仅用于测试，不应复制到行内状态',
      status,
      segmentRevision: 1,
      currentRevision: 1,
    })

    const summaries = summarizeOpenQaFindingsBySegment([
      finding('qaf-1', 'segment-a', 'L3'),
      finding('qaf-2', 'segment-a', 'L1'),
      finding('qaf-3', 'segment-a', 'L0', 'resolved'),
      finding('qaf-4', 'segment-b', 'L4'),
    ])

    expect(summaries).toEqual(new Map([
      ['segment-a', { count: 2, highestSeverity: 'L1' }],
      ['segment-b', { count: 1, highestSeverity: 'L4' }],
    ]))
  })
})
