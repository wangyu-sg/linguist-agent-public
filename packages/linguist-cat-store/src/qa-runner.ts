import { runQa, type QaRunOptions } from '@linguist/cat-core'
import type { ProjectDatabase } from './project-database'
import type { QaRunPersistence } from './repositories/qa-findings'
import type { PersistedQaFinding } from './repositories/rows'

/**
 * PB-096 术语接线：从 term_entries 构建 QA 术语规则。
 * - forbidden 条目 → forbiddenTerms（永远 strict 阻断，L1 defect）；
 * - preferred 条目 → requiredTerminology（按项目 glossaryPolicy 升降级）；
 * - preferred 一词多译冲突组 → glossaryConflicts（glossary_conflict/query）。
 * 调用方显式传入的同名 option 优先（测试/工具直调场景）。
 */
export function buildQaTermOptions(db: ProjectDatabase): Pick<
  QaRunOptions,
  'requiredTerminology' | 'forbiddenTerms' | 'glossaryConflicts'
> {
  const preferred = db.termEntries.list({ status: 'preferred', limit: Number.MAX_SAFE_INTEGER })
  const forbidden = db.termEntries.list({ status: 'forbidden', limit: Number.MAX_SAFE_INTEGER })
  return {
    requiredTerminology: preferred.map((entry) => ({
      sourceTerm: entry.term,
      targetTerm: entry.translation,
      caseSensitive: entry.caseSensitive,
    })),
    forbiddenTerms: forbidden.map((entry) => ({
      term: entry.translation,
      caseSensitive: entry.caseSensitive,
    })),
    glossaryConflicts: db.termEntries.listPreferredConflicts(),
  }
}

/** Run the pure QA Core and atomically replace all open project Findings. */
export function runProjectQa(
  db: ProjectDatabase,
  options: QaRunOptions = {},
  persistence: QaRunPersistence = {},
): PersistedQaFinding[] {
  const total = db.segments.count()
  const segments = total === 0 ? [] : db.segments.query({ limit: total })
  const termOptions = buildQaTermOptions(db)
  return db.qaFindings.replaceForProject(
    runQa(segments, {
      ...termOptions,
      // 显式传入的 option 覆盖 term_entries 派生值（undefined 不覆盖）。
      ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    }),
    new Map(segments.map((segment) => [segment.id as string, segment.revision])),
    { ruleVersion: 'deterministic-v1', ...persistence },
  )
}
