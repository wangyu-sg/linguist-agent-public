/**
 * Segment + SegmentRevision — plan-mandated segment schema with
 * revision-based optimistic concurrency (CAS) and locked semantics.
 *
 * Hard rules:
 * - A locked segment rejects target edits (SegmentLockedError).
 * - Every content mutation requires expectedRevision === segment.revision,
 *   otherwise RevisionConflictError — never overwrite on conflict.
 * - Every accepted content mutation appends a SegmentRevision entry.
 */

import { RevisionConflictError, SegmentLockedError } from './errors'
import type { AssetId, SegmentId } from './ids'
import type { CurrentStageState } from './workflow'

export type SegmentStatus = 'untranslated' | 'draft' | 'translated' | 'reviewed'

/** Optional translator-facing context attached to a segment. */
export interface SegmentContext {
  /** Context note from the source file or a human (e.g. Phrase context note). */
  note?: string
  /** Origin hint, e.g. resource name / master file reference. */
  origin?: string
  /** Free-form extra metadata (stringly-typed, JSON-safe). */
  meta?: Record<string, string>
}

export interface Segment {
  id: SegmentId
  assetId: AssetId
  ordinal: number
  key?: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  status: SegmentStatus
  /** 相对于项目当前 T/E/P 阶段的进度；旧数据库行可缺省。 */
  currentStageState?: CurrentStageState
  /** 导入格式携带的原生状态，仅供回写和诊断。 */
  importedNativeStatus?: string
  locked: boolean
  revision: number
  sourceHash: string
  context?: SegmentContext
}

export type SegmentRevisionSource = 'human' | 'proposal' | 'import'

/** One entry of a segment's append-only revision history. */
export interface SegmentRevision {
  revision: number
  target: string
  status: SegmentStatus
  source: SegmentRevisionSource
  createdAt: string
}

export interface TargetEditResult {
  segment: Segment
  revision: SegmentRevision
}

/** Throws SegmentLockedError when the segment is locked. */
export function assertSegmentEditable(segment: Segment): void {
  if (segment.locked) throw new SegmentLockedError(segment.id)
}

/** Throws RevisionConflictError when expectedRevision is stale. */
export function assertRevision(segment: Segment, expectedRevision: number): void {
  if (segment.revision !== expectedRevision) {
    throw new RevisionConflictError(segment.id, expectedRevision, segment.revision)
  }
}

export interface ApplyTargetEditOptions {
  /** Revision history attribution; default 'human'. */
  source?: SegmentRevisionSource
  /** Explicit resulting status; default: '' -> 'untranslated', otherwise 'draft'. */
  status?: SegmentStatus
  /** ISO timestamp for the revision entry; inject for determinism. */
  now?: string
}

/**
 * Pure CAS edit: validates lock + expectedRevision, then returns the updated
 * segment (revision + 1) and the new revision-history entry. Never mutates
 * the input; never overwrites on conflict.
 */
export function applyTargetEdit(
  segment: Segment,
  newTarget: string,
  expectedRevision: number,
  options: ApplyTargetEditOptions = {},
): TargetEditResult {
  assertSegmentEditable(segment)
  assertRevision(segment, expectedRevision)

  const status = options.status ?? (newTarget === '' ? 'untranslated' : 'draft')
  const revision: SegmentRevision = {
    revision: segment.revision + 1,
    target: newTarget,
    status,
    source: options.source ?? 'human',
    createdAt: options.now ?? new Date().toISOString(),
  }
  return {
    segment: {
      ...segment,
      target: newTarget,
      status,
      currentStageState: 'draft',
      revision: revision.revision,
    },
    revision,
  }
}

/** Lock a segment (metadata-only; revision unchanged). */
export function lockSegment(segment: Segment): Segment {
  return { ...segment, locked: true }
}

/** Unlock a segment (metadata-only; revision unchanged). */
export function unlockSegment(segment: Segment): Segment {
  return { ...segment, locked: false }
}

/** Deterministic ordering: by ordinal, then key, then id — a total order. */
export function compareSegments(a: Segment, b: Segment): number {
  if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal
  const keyCmp = (a.key ?? '').localeCompare(b.key ?? '')
  if (keyCmp !== 0) return keyCmp
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Stable sorted copy of a segment list. */
export function sortSegments(segments: readonly Segment[]): Segment[] {
  return [...segments].sort(compareSegments)
}
