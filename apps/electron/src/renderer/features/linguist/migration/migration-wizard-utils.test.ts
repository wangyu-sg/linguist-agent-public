import { describe, expect, test } from 'bun:test'
import type { LinguistMigrationProjectReport, LinguistMigrationScannedProject } from '@proma/shared'
import {
  defaultSelectedProjectIds,
  groupProjectReports,
  MIGRATION_DISPOSITION_LABELS,
  MIGRATION_DISPOSITION_ORDER,
  MIGRATION_DISPOSITION_TONES,
  MIGRATION_WIZARD_STEP_LABELS,
  migrationProgressPercent,
  wizardActiveStepIndex,
} from './migration-wizard-utils'

function makeProject(
  disposition: LinguistMigrationProjectReport['disposition'],
  legacyProjectId: string,
): LinguistMigrationProjectReport {
  return {
    legacyProjectId,
    newProjectId: 'prj-0000000000000000',
    projectName: legacyProjectId,
    disposition,
    targetConflict: false,
    refusal: null,
    totals: { assets: 0, segments: 0, tmImported: 0, termsImported: 0, qaOpen: 0, qaWaived: 0 },
    transcript: null,
    archivesWritten: 0,
    rollback: [],
    notes: [],
    verify: { status: 'skipped', checks: [] },
  }
}

describe('步骤状态机（六步显示模型）', () => {
  test('相位 → 活动步骤下标', () => {
    expect(MIGRATION_WIZARD_STEP_LABELS).toEqual(['扫描', '预览', '选择', '导入', '验证', '报告'])
    expect(wizardActiveStepIndex('scan', 'import')).toBe(0)
    expect(wizardActiveStepIndex('preview', 'import')).toBe(1)
    expect(wizardActiveStepIndex('select', 'import')).toBe(2)
    expect(wizardActiveStepIndex('running', 'import')).toBe(3)
    expect(wizardActiveStepIndex('running', 'verify')).toBe(4)
    expect(wizardActiveStepIndex('report', 'verify')).toBe(5)
  })
})

describe('进度百分比（每项目 2 单元，事件在相位开始时触发）', () => {
  test('无事件为 0；事件序列单调递增且运行中不到 100', () => {
    expect(migrationProgressPercent(null)).toBe(0)
    expect(migrationProgressPercent({ projectId: 'a', phase: 'import', index: 1, total: 2 })).toBe(0)
    expect(migrationProgressPercent({ projectId: 'a', phase: 'verify', index: 1, total: 2 })).toBe(25)
    expect(migrationProgressPercent({ projectId: 'b', phase: 'import', index: 2, total: 2 })).toBe(50)
    expect(migrationProgressPercent({ projectId: 'b', phase: 'verify', index: 2, total: 2 })).toBe(75)
  })

  test('单项目运行最高 50；total 为 0 时防御为 0', () => {
    expect(migrationProgressPercent({ projectId: 'a', phase: 'verify', index: 1, total: 1 })).toBe(50)
    expect(migrationProgressPercent({ projectId: 'a', phase: 'verify', index: 1, total: 0 })).toBe(0)
  })
})

describe('报告聚合分组', () => {
  test('按固定顺序分组，空组省略', () => {
    const groups = groupProjectReports([
      makeProject('quarantined', 'q1'),
      makeProject('imported', 'i1'),
      makeProject('imported', 'i2'),
      makeProject('error', 'e1'),
    ])
    expect(groups.map((g) => g.disposition)).toEqual(['imported', 'quarantined', 'error'])
    expect(groups[0]?.projects.map((p) => p.legacyProjectId)).toEqual(['i1', 'i2'])
    expect(groups[1]?.projects.map((p) => p.legacyProjectId)).toEqual(['q1'])
    expect(groupProjectReports([])).toEqual([])
  })

  test('五值标签 / 色调 / 顺序齐全', () => {
    expect(MIGRATION_DISPOSITION_ORDER).toEqual(['imported', 'partial', 'archived-only', 'quarantined', 'error'])
    for (const disposition of MIGRATION_DISPOSITION_ORDER) {
      expect(MIGRATION_DISPOSITION_LABELS[disposition].length).toBeGreaterThan(0)
      expect(MIGRATION_DISPOSITION_TONES[disposition]).toBeTruthy()
    }
    expect(MIGRATION_DISPOSITION_LABELS['archived-only']).toBe('仅归档')
    expect(MIGRATION_DISPOSITION_TONES.error).toBe('error')
  })
})

describe('默认选择', () => {
  test('默认选中全部扫描到的项目（孤儿默认隔离、零写入，安全入选）', () => {
    const scanned = [
      { projectId: 'a' },
      { projectId: 'b' },
    ] as LinguistMigrationScannedProject[]
    expect(defaultSelectedProjectIds(scanned)).toEqual(['a', 'b'])
    expect(defaultSelectedProjectIds([])).toEqual([])
  })
})
