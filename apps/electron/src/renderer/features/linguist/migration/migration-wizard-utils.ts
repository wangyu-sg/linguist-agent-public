/**
 * Migration wizard pure helpers (PB-094): the six-step display model,
 * whole-run progress percentage, and report aggregation/grouping. No React,
 * no IPC — unit-tested with bun test (migration-wizard-utils.test.ts).
 */

import type {
  LinguistMigrationDisposition,
  LinguistMigrationProgress,
  LinguistMigrationProjectReport,
  LinguistMigrationScannedProject,
} from '@proma/shared'

// ---------------------------------------------------------------------------
// step model

/** Internal phases; 'running' covers BOTH the import and verify display steps. */
export type MigrationWizardPhase = 'scan' | 'preview' | 'select' | 'running' | 'report'

export type MigrationRunningPhase = 'import' | 'verify'

/** Display steps (Chinese UI labels): 扫描 → 预览 → 选择 → 导入 → 验证 → 报告. */
export const MIGRATION_WIZARD_STEP_LABELS = ['扫描', '预览', '选择', '导入', '验证', '报告'] as const

/** Active display-step index (0..5) for the stepper. */
export function wizardActiveStepIndex(
  phase: MigrationWizardPhase,
  runningPhase: MigrationRunningPhase,
): number {
  switch (phase) {
    case 'scan':
      return 0
    case 'preview':
      return 1
    case 'select':
      return 2
    case 'running':
      return runningPhase === 'import' ? 3 : 4
    case 'report':
      return 5
  }
}

// ---------------------------------------------------------------------------
// progress

/**
 * Whole-run percent. Each project contributes two units (import, verify)
 * and progress events fire when a phase STARTS, so the bar reaches 100%
 * only when the aggregated report arrives (the wizard switches phase).
 */
export function migrationProgressPercent(progress: LinguistMigrationProgress | null): number {
  if (progress === null || progress.total <= 0) return 0
  const unitsDone = (progress.index - 1) * 2 + (progress.phase === 'verify' ? 1 : 0)
  return Math.min(99, Math.round((unitsDone / (progress.total * 2)) * 100))
}

// ---------------------------------------------------------------------------
// report aggregation

export const MIGRATION_DISPOSITION_ORDER: readonly LinguistMigrationDisposition[] = [
  'imported',
  'partial',
  'archived-only',
  'quarantined',
  'error',
]

export const MIGRATION_DISPOSITION_LABELS: Record<LinguistMigrationDisposition, string> = {
  imported: '已导入',
  partial: '部分导入',
  'archived-only': '仅归档',
  quarantined: '已隔离',
  error: '错误',
}

/** Card/row accent tone per disposition. */
export type MigrationDispositionTone = 'success' | 'warning' | 'muted' | 'error'

export const MIGRATION_DISPOSITION_TONES: Record<LinguistMigrationDisposition, MigrationDispositionTone> = {
  imported: 'success',
  partial: 'warning',
  'archived-only': 'muted',
  quarantined: 'warning',
  error: 'error',
}

export interface MigrationReportGroup {
  disposition: LinguistMigrationDisposition
  projects: LinguistMigrationProjectReport[]
}

/** Group project reports by disposition (fixed order, empty groups omitted). */
export function groupProjectReports(projects: LinguistMigrationProjectReport[]): MigrationReportGroup[] {
  return MIGRATION_DISPOSITION_ORDER.flatMap((disposition) => {
    const group = projects.filter((project) => project.disposition === disposition)
    return group.length > 0 ? [{ disposition, projects: group }] : []
  })
}

// ---------------------------------------------------------------------------
// selection

/**
 * Default selection: every scanned project. Orphans are safe to include —
 * they import as quarantined report-only entries (zero writes) unless the
 * user explicitly opts into salvage.
 */
export function defaultSelectedProjectIds(projects: LinguistMigrationScannedProject[]): string[] {
  return projects.map((project) => project.projectId)
}
