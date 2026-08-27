import { runQa, type QaRunOptions, type Segment } from '@linguist/cat-core'
import type { ProjectDatabase } from './project-database'
import type { QaRunPersistence } from './repositories/qa-findings'
import type { PersistedQaFinding } from './repositories/rows'

/**
 * 从统一 evaluator 为每个 Segment 构建术语 QA 快照。
 */
export function buildQaTermOptions(db: ProjectDatabase, segments: readonly Segment[]): Pick<
  QaRunOptions,
  'terminologyBySegment'
> {
  return {
    terminologyBySegment: Object.fromEntries(segments.map((segment) => {
      const evaluated = db.termEntries.evaluateSegment(segment).matches
      const hard = evaluated.filter((item) => item.enforcement === 'hard')
      const advisory = evaluated.filter((item) => item.enforcement === 'advisory' && (
        item.match.status === 'required'
        || item.match.status === 'forbidden'
        || (item.match.status === 'preferred' && !item.targetUsed)
        || (item.match.status === 'deprecated' && item.targetUsed)
      ))
      const advisoryGroups = Map.groupBy(
        advisory,
        (item) => item.match.term.normalize('NFKC').toLocaleLowerCase(),
      )
      return [segment.id as string, {
        requiredTerminology: hard
          .filter((item) => item.match.status === 'required')
          .map(({ match }) => ({
            sourceTerm: match.term,
            targetTerm: match.translation,
            caseSensitive: match.caseSensitive,
          })),
        forbiddenTerms: hard
          .filter((item) => item.match.status === 'forbidden')
          .map(({ match }) => ({
            sourceTerm: match.term,
            term: match.translation,
            caseSensitive: match.caseSensitive,
          })),
        glossaryConflicts: [...advisoryGroups.values()].map((items) => ({
          sourceTerm: items[0]!.match.term,
          translations: [...new Set(items.map((item) => item.match.translation))].sort(),
        })),
      }]
    })),
  }
}

/** Run the pure QA Core and atomically replace open Findings for one batch. */
export function runAssetQa(
  db: ProjectDatabase,
  assetId: string,
  options: QaRunOptions = {},
  persistence: QaRunPersistence = {},
): PersistedQaFinding[] {
  const total = db.segments.count({ assetId })
  const segments = total === 0 ? [] : db.segments.query({ assetId, limit: total })
  const termOptions = buildQaTermOptions(db, segments)
  return db.qaFindings.replaceForAsset(
    assetId,
    runQa(segments, {
      ...termOptions,
      // 显式传入的 option 覆盖 term_entries 派生值（undefined 不覆盖）。
      ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    }),
    new Map(segments.map((segment) => [segment.id as string, segment.revision])),
    { ruleVersion: 'deterministic-v1', ...persistence },
  )
}
