import { createHash } from 'node:crypto'
import type { Segment } from '@linguist/cat-core'
import type { CatDatabase } from './database'
import {
  StoreAuthorityError,
  StoreIdempotencyConflictError,
  StoreJobStateError,
  StoreNotFoundError,
} from './errors'
import {
  proposalFromRow,
  segmentFromRow,
  type ProposalRow,
  type SegmentRow,
} from './repositories/rows'

export type TranslationJobStrategy = 'fast' | 'balanced' | 'best'
export type TranslationJobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface TranslationJobProvenance {
  schemaVersion: 1
  runtime: string
  modelProvider?: string
  modelId?: string
  role?: 'assistant' | 'reviewer' | 'auditor'
  promptVersion?: string
  projectDigestHash?: string
  contextSnapshotId?: string
  /** Internal/check-only jobs can persist recovery state without advancing the project outbox. */
  projectEventPolicy?: 'emit' | 'suppress'
}

export interface TranslationJob {
  jobId: string
  projectId: string
  runId: string
  sessionId: string
  strategy: TranslationJobStrategy
  status: TranslationJobStatus
  segmentIds: string[]
  baseRevisions: Record<string, number>
  cursor: number
  completedSegmentIds: string[]
  failedSegmentIds: string[]
  proposalIds: string[]
  openItemIds: string[]
  provenance: TranslationJobProvenance
  failureCode?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTranslationJobInput {
  jobId: string
  runId: string
  sessionId: string
  strategy: TranslationJobStrategy
  segmentIds: readonly string[]
  provenance: TranslationJobProvenance
}

export interface TranslationJobAuthority {
  sessionId: string
}

export interface CheckpointTranslationJobInput extends TranslationJobAuthority {
  jobId: string
  cursor: number
  completedSegmentIds: readonly string[]
  failedSegmentIds: readonly string[]
  proposalIds: readonly string[]
  openItemIds: readonly string[]
}

export interface RunMutationIdentity {
  runId: string
  toolCallId: string
  idempotencyKey: string
}

export interface RunMutationChange {
  entityType: 'segment' | 'proposal' | 'qa-finding' | 'critic-artifact' | 'file'
  entityId: string
  changeKind: 'created' | 'updated' | 'deleted' | 'touched'
  segmentId?: string
  expectedRevision?: number
  before?: unknown
  after?: unknown
}

export interface ProjectEventInput {
  kind:
    | 'proposal-created'
    | 'proposal-reviewed'
    | 'segment-updated'
    | 'qa-updated'
    | 'asset-updated'
    | 'project-updated'
    | 'job-updated'
    | 'run-undone'
  segmentIds?: readonly string[]
  proposalIds?: readonly string[]
  qaFindingIds?: readonly string[]
  resolvedQaFindingIds?: readonly string[]
  jobId?: string
  job?: {
    status: TranslationJobStatus
    cursor: number
    total: number
    completed: number
    failed: number
  }
}

export interface DurableProjectEvent extends ProjectEventInput {
  projectId: string
  sequence: number
  runId?: string
  toolCallId?: string
  createdAt: string
}

export interface ProjectEventAck {
  consumerId: string
  sequence: number
  ackedAt: string
}

export interface RunStateCapsuleV1 {
  schemaVersion: 1
  projectId: string
  jobId: string
  runId: string
  strategy: TranslationJobStrategy
  status: TranslationJobStatus
  scope: {
    totalSegments: number
    digest: string
  }
  progress: {
    cursor: number
    completedCount: number
    failedCount: number
    pendingCount: number
    completedSegmentIds: string[]
    failedSegmentIds: string[]
    pendingSegmentIds: string[]
    proposalIds: string[]
  }
  openItemIds: string[]
  provenance: {
    digest: string
    contextSnapshotId?: string
  }
  truncated: boolean
}

export interface RunChangeSummaryV1 {
  schemaVersion: 1
  projectId: string
  runId: string
  job?: {
    jobId: string
    status: TranslationJobStatus
    scopedSegments: number
    cursor: number
    completedSegments: number
    failedSegments: number
  }
  mutationCount: number
  changes: {
    proposalsCreated: number
    qaFindingsCreated: number
    qaFindingsUpdated: number
    criticReviewsCreated: number
    filesTouched: number
    total: number
    undone: number
  }
  eventSequence?: {
    first: number
    last: number
  }
  canUndo: boolean
}

export interface RunUndoResult {
  runId: string
  status: 'completed' | 'partial' | 'refused' | 'already-undone'
  reverted: Array<{
    entityType: RunMutationChange['entityType']
    entityId: string
  }>
  refused: Array<{
    entityType: RunMutationChange['entityType']
    entityId: string
    reason: string
  }>
  event?: DurableProjectEvent
}

export interface UndoRunOptions {
  actorId: string
}

export interface RunMutationOutcome<TResult> {
  result: TResult
  changes: readonly RunMutationChange[]
  event?: ProjectEventInput
}

export interface ExecuteRunMutationInput<TPayload, TResult> {
  identity: RunMutationIdentity
  operation: string
  payload: TPayload
  mutate: () => RunMutationOutcome<TResult>
}

export interface IdempotentRunMutation<TResult> {
  result: TResult
  replayed: boolean
  event?: DurableProjectEvent
}

interface TranslationJobRow {
  job_id: string
  project_id: string
  run_id: string
  session_id: string
  strategy: TranslationJobStrategy
  status: TranslationJobStatus
  segment_ids_json: string
  base_revisions_json: string
  cursor: number
  completed_segment_ids_json: string
  failed_segment_ids_json: string
  proposal_ids_json: string
  open_item_ids_json: string
  provenance_json: string
  failure_code: string | null
  created_at: string
  updated_at: string
}

interface MutationReceiptRow {
  operation: string
  request_fingerprint: string
  result_json: string
  run_id: string | null
  tool_call_id: string | null
  event_sequence: number | null
}

interface ProjectEventRow {
  sequence: number
  project_id: string
  run_id: string | null
  kind: ProjectEventInput['kind']
  payload_json: string
  created_at: string
}

interface ProjectEventAckRow {
  consumer_id: string
  sequence: number
  acked_at: string
}

interface RunChangeRow {
  change_id: number
  entity_type: RunMutationChange['entityType']
  entity_id: string
  change_kind: RunMutationChange['changeKind']
  segment_id: string | null
  expected_revision: number | null
  before_json: string | null
  after_json: string | null
  undone_at: string | null
}

const JOB_TRANSITIONS: Readonly<Record<TranslationJobStatus, readonly TranslationJobStatus[]>> = {
  pending: ['running', 'cancelled'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'failed', 'cancelled'],
  completed: [],
  failed: ['running', 'cancelled'],
  cancelled: [],
}

function requireNonBlank(value: string, field: string): void {
  if (value.trim() === '') throw new TypeError(`${field} must be non-blank`)
}

function requireOpaqueId(value: string, field: string): void {
  requireNonBlank(value, field)
  if (value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) {
    throw new TypeError(`${field} must be an opaque identifier of at most 200 characters`)
  }
}

function validateProvenance(provenance: TranslationJobProvenance): void {
  if (provenance.schemaVersion !== 1) {
    throw new TypeError('provenance.schemaVersion must be 1')
  }
  requireOpaqueId(provenance.runtime, 'provenance.runtime')
  if (
    provenance.projectEventPolicy !== undefined
    && provenance.projectEventPolicy !== 'emit'
    && provenance.projectEventPolicy !== 'suppress'
  ) {
    throw new TypeError('provenance.projectEventPolicy must be emit or suppress')
  }
  for (const [field, value] of Object.entries(provenance)) {
    if (field === 'schemaVersion' || field === 'runtime' || value === undefined) continue
    if (typeof value !== 'string') throw new TypeError(`provenance.${field} must be a string`)
    requireOpaqueId(value, `provenance.${field}`)
  }
  if (
    provenance.projectDigestHash !== undefined &&
    !/^[a-f0-9]{64}$/.test(provenance.projectDigestHash)
  ) {
    throw new TypeError('provenance.projectDigestHash must be a lowercase SHA-256 digest')
  }
}

function parseStringArray(value: string): string[] {
  return JSON.parse(value) as string[]
}

function jobFromRow(row: TranslationJobRow): TranslationJob {
  return {
    jobId: row.job_id,
    projectId: row.project_id,
    runId: row.run_id,
    sessionId: row.session_id,
    strategy: row.strategy,
    status: row.status,
    segmentIds: parseStringArray(row.segment_ids_json),
    baseRevisions: JSON.parse(row.base_revisions_json) as Record<string, number>,
    cursor: row.cursor,
    completedSegmentIds: parseStringArray(row.completed_segment_ids_json),
    failedSegmentIds: parseStringArray(row.failed_segment_ids_json),
    proposalIds: parseStringArray(row.proposal_ids_json),
    openItemIds: parseStringArray(row.open_item_ids_json),
    provenance: JSON.parse(row.provenance_json) as TranslationJobProvenance,
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function unique(values: readonly string[], field: string): string[] {
  const result = [...new Set(values)]
  if (result.length !== values.length) throw new TypeError(`${field} must not contain duplicates`)
  return result
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('mutation payload numbers must be finite')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  throw new TypeError(`mutation payload contains unsupported ${typeof value}`)
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/**
 * 冻结范围的身份哈希：segmentIds + baseRevisions 的 canonical SHA-256。
 * state capsule 与工具结果 DTO 共用同一定义，保证跨表面的 digest 逐字节一致。
 */
export function translationJobScopeDigest(
  segmentIds: readonly string[],
  baseRevisions: Record<string, number>,
): string {
  return fingerprint({ segmentIds, baseRevisions })
}

function eventFromRow(row: ProjectEventRow): DurableProjectEvent {
  const payload = JSON.parse(row.payload_json) as Omit<
    DurableProjectEvent,
    'projectId' | 'sequence' | 'runId' | 'createdAt'
  >
  return {
    ...payload,
    projectId: row.project_id,
    sequence: Number(row.sequence),
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    kind: row.kind,
    createdAt: row.created_at,
  }
}

export class RunHarnessRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string,
  ) {}

  createJob(input: CreateTranslationJobInput): TranslationJob {
    requireNonBlank(input.jobId, 'jobId')
    requireNonBlank(input.runId, 'runId')
    requireNonBlank(input.sessionId, 'sessionId')
    validateProvenance(input.provenance)
    const segmentIds = unique(input.segmentIds, 'segmentIds')
    if (segmentIds.length === 0) throw new TypeError('segmentIds must not be empty')

    return this.db.transaction(`create translation job ${input.jobId}`, () => {
      if (this.getRow(input.jobId) !== undefined) {
        throw new StoreJobStateError(input.jobId, 'job id already exists')
      }
      const baseRevisions: Record<string, number> = {}
      const getRevision = this.db.db.prepare('SELECT revision FROM segments WHERE id = ?')
      for (const segmentId of segmentIds) {
        const row = getRevision.get(segmentId) as { revision: number } | undefined
        if (row === undefined) throw new StoreJobStateError(input.jobId, `unknown segment ${segmentId}`)
        baseRevisions[segmentId] = row.revision
      }
      const at = this.now()
      this.db.db.prepare(`
        INSERT INTO translation_jobs (
          job_id, project_id, run_id, session_id, strategy, status,
          segment_ids_json, base_revisions_json, cursor,
          completed_segment_ids_json, failed_segment_ids_json,
          proposal_ids_json, open_item_ids_json, provenance_json,
          failure_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0, '[]', '[]', '[]', '[]', ?, NULL, ?, ?)
      `).run(
        input.jobId,
        this.projectId,
        input.runId,
        input.sessionId,
        input.strategy,
        JSON.stringify(segmentIds),
        JSON.stringify(baseRevisions),
        JSON.stringify(input.provenance),
        at,
        at,
      )
      const job = this.getJob(input.jobId, { sessionId: input.sessionId })!
      this.appendJobEvent(job, at)
      return job
    })
  }

  getJob(jobId: string, authority: TranslationJobAuthority): TranslationJob | undefined {
    const row = this.getRow(jobId)
    if (row === undefined) return undefined
    this.assertAuthority(row, authority)
    return jobFromRow(row)
  }

  /** Project-scoped operational summary for Dev Diagnostics; never crosses project authority. */
  getLatestJob(): TranslationJob | undefined {
    const row = this.db.db.prepare(`
      SELECT * FROM translation_jobs
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC, job_id DESC
      LIMIT 1
    `).get(this.projectId) as TranslationJobRow | undefined
    return row === undefined ? undefined : jobFromRow(row)
  }

  /** 已冻结的 job scope 引用批次段时，撤销导入必须被服务层拒绝。 */
  countReferencingAsset(assetId: string): number {
    const row = this.db.db.prepare(`
      SELECT COUNT(*) AS n
      FROM translation_jobs AS job
      WHERE job.project_id = ?
        AND EXISTS (
          SELECT 1
          FROM json_each(job.segment_ids_json) AS scoped
          JOIN segments AS segment ON segment.id = scoped.value
          WHERE segment.asset_id = ?
        )
    `).get(this.projectId, assetId) as { n: number }
    return Number(row.n)
  }

  transitionJob(
    jobId: string,
    authority: TranslationJobAuthority,
    status: TranslationJobStatus,
    failureCode?: string,
  ): TranslationJob {
    return this.db.transaction(`transition translation job ${jobId}`, () => {
      const row = this.requireRow(jobId)
      this.assertAuthority(row, authority)
      if (row.status === status) return jobFromRow(row)
      if (!JOB_TRANSITIONS[row.status].includes(status)) {
        throw new StoreJobStateError(jobId, `cannot transition ${row.status} to ${status}`)
      }
      const job = jobFromRow(row)
      if (status === 'completed' && job.cursor !== job.segmentIds.length) {
        throw new StoreJobStateError(jobId, 'completion requires every scoped segment checkpointed')
      }
      if (status === 'failed' && (failureCode?.trim() ?? '') === '') {
        throw new StoreJobStateError(jobId, 'failed status requires a non-blank failureCode')
      }
      const at = this.now()
      this.db.db.prepare(`
        UPDATE translation_jobs
        SET status = ?, failure_code = ?, updated_at = ?
        WHERE job_id = ?
      `).run(status, status === 'failed' ? failureCode : null, at, jobId)
      const updated = this.getJob(jobId, authority)!
      this.appendJobEvent(updated, at)
      return updated
    })
  }

  checkpointJob(input: CheckpointTranslationJobInput): TranslationJob {
    return this.db.transaction(`checkpoint translation job ${input.jobId}`, () => {
      const row = this.requireRow(input.jobId)
      this.assertAuthority(row, input)
      const job = jobFromRow(row)
      if (job.status !== 'running') {
        throw new StoreJobStateError(input.jobId, `checkpoint requires running status, got ${job.status}`)
      }
      if (input.cursor < job.cursor || input.cursor > job.segmentIds.length) {
        throw new StoreJobStateError(
          input.jobId,
          `cursor must be monotonic and within scope (${job.cursor}-${job.segmentIds.length})`,
        )
      }
      const completed = unique(input.completedSegmentIds, 'completedSegmentIds')
      const failed = unique(input.failedSegmentIds, 'failedSegmentIds')
      const scope = new Set(job.segmentIds)
      if ([...completed, ...failed].some((segmentId) => !scope.has(segmentId))) {
        throw new StoreJobStateError(input.jobId, 'checkpoint contains a segment outside the frozen scope')
      }
      const failedSet = new Set(failed)
      if (completed.some((segmentId) => failedSet.has(segmentId))) {
        throw new StoreJobStateError(input.jobId, 'completed and failed segment sets overlap')
      }
      const processed = new Set([...completed, ...failed])
      const expectedPrefix = job.segmentIds.slice(0, input.cursor)
      if (
        processed.size !== expectedPrefix.length ||
        expectedPrefix.some((segmentId) => !processed.has(segmentId))
      ) {
        throw new StoreJobStateError(
          input.jobId,
          'checkpoint outcomes must cover the frozen scope prefix through cursor',
        )
      }
      if (
        job.completedSegmentIds.some((segmentId) => !completed.includes(segmentId)) ||
        job.failedSegmentIds.some((segmentId) => !failed.includes(segmentId))
      ) {
        throw new StoreJobStateError(input.jobId, 'checkpoint outcomes must be monotonic')
      }
      const getSegmentState = this.db.db.prepare('SELECT revision, locked FROM segments WHERE id = ?')
      for (const segmentId of completed) {
        const current = getSegmentState.get(segmentId) as
          | { revision: number; locked: number }
          | undefined
        if (current === undefined) {
          throw new StoreJobStateError(input.jobId, `completed segment no longer exists: ${segmentId}`)
        }
        if (current.locked !== 0) {
          throw new StoreJobStateError(input.jobId, `locked segment cannot be completed: ${segmentId}`)
        }
        const expected = job.baseRevisions[segmentId]
        if (current.revision !== expected) {
          throw new StoreJobStateError(
            input.jobId,
            `stale segment ${segmentId}: expected revision ${expected}, got ${current.revision}`,
          )
        }
      }
      const proposals = unique(input.proposalIds, 'proposalIds')
      const getProposal = this.db.db.prepare('SELECT id FROM proposals WHERE id = ?')
      if (proposals.some((proposalId) => getProposal.get(proposalId) === undefined)) {
        throw new StoreJobStateError(input.jobId, 'checkpoint references an unknown proposal')
      }
      const openItems = unique(input.openItemIds, 'openItemIds')
      openItems.forEach((item, index) => requireOpaqueId(item, `openItemIds[${index}]`))
      if (
        input.cursor === job.cursor &&
        canonicalJson(completed) === canonicalJson(job.completedSegmentIds) &&
        canonicalJson(failed) === canonicalJson(job.failedSegmentIds) &&
        canonicalJson(proposals) === canonicalJson(job.proposalIds) &&
        canonicalJson(openItems) === canonicalJson(job.openItemIds)
      ) {
        return job
      }
      const at = this.now()
      this.db.db.prepare(`
        UPDATE translation_jobs
        SET cursor = ?, completed_segment_ids_json = ?, failed_segment_ids_json = ?,
            proposal_ids_json = ?, open_item_ids_json = ?, updated_at = ?
        WHERE job_id = ?
      `).run(
        input.cursor,
        JSON.stringify(completed),
        JSON.stringify(failed),
        JSON.stringify(proposals),
        JSON.stringify(openItems),
        at,
        input.jobId,
      )
      const updated = this.getJob(input.jobId, input)!
      this.appendJobEvent(updated, at)
      return updated
    })
  }

  createStateCapsule(
    jobId: string,
    authority: TranslationJobAuthority,
    options: { maxBytes: number },
  ): RunStateCapsuleV1 {
    if (!Number.isInteger(options.maxBytes) || options.maxBytes < 256) {
      throw new RangeError('maxBytes must be an integer of at least 256')
    }
    const job = this.getJob(jobId, authority)
    if (job === undefined) throw new StoreJobStateError(jobId, 'job does not exist in this project')
    const completed = new Set(job.completedSegmentIds)
    const failed = new Set(job.failedSegmentIds)
    const pending = job.segmentIds.filter((segmentId) => !completed.has(segmentId) && !failed.has(segmentId))
    const capsule: RunStateCapsuleV1 = {
      schemaVersion: 1,
      projectId: this.projectId,
      jobId: job.jobId,
      runId: job.runId,
      strategy: job.strategy,
      status: job.status,
      scope: {
        totalSegments: job.segmentIds.length,
        digest: translationJobScopeDigest(job.segmentIds, job.baseRevisions),
      },
      progress: {
        cursor: job.cursor,
        completedCount: job.completedSegmentIds.length,
        failedCount: job.failedSegmentIds.length,
        pendingCount: pending.length,
        completedSegmentIds: [],
        failedSegmentIds: [],
        pendingSegmentIds: [],
        proposalIds: [],
      },
      openItemIds: [],
      provenance: {
        digest: fingerprint(job.provenance),
        ...(job.provenance.contextSnapshotId === undefined
          ? {}
          : { contextSnapshotId: job.provenance.contextSnapshotId }),
      },
      truncated: false,
    }
    const encoder = new TextEncoder()
    let usedBytes = encoder.encode(JSON.stringify(capsule)).byteLength
    if (usedBytes > options.maxBytes) {
      throw new RangeError('maxBytes is too small for the minimum run state capsule')
    }
    const lists: Array<[string[], readonly string[]]> = [
      [capsule.openItemIds, job.openItemIds],
      [capsule.progress.failedSegmentIds, job.failedSegmentIds],
      [capsule.progress.pendingSegmentIds, pending],
      [capsule.progress.proposalIds, job.proposalIds],
      [capsule.progress.completedSegmentIds, job.completedSegmentIds],
    ]
    let omitted = false
    for (const [target, source] of lists) {
      for (const item of source) {
        const itemBytes = encoder.encode(JSON.stringify(item)).byteLength
          + (target.length === 0 ? 0 : 1)
        if (usedBytes + itemBytes > options.maxBytes) {
          omitted = true
          continue
        }
        target.push(item)
        usedBytes += itemBytes
      }
    }
    capsule.truncated = omitted
    return capsule
  }

  getRunChangeSummary(runId: string): RunChangeSummaryV1 {
    requireNonBlank(runId, 'runId')
    const jobRow = this.db.db.prepare(`
      SELECT * FROM translation_jobs
      WHERE project_id = ? AND run_id = ?
      ORDER BY created_at, job_id
      LIMIT 1
    `).get(this.projectId, runId) as TranslationJobRow | undefined
    const mutationCount = Number((this.db.db.prepare(`
      SELECT COUNT(*) AS count FROM proposal_mutations WHERE run_id = ?
    `).get(runId) as { count: number }).count)
    const rows = this.db.db.prepare(`
      SELECT entity_type, change_kind, undone_at, COUNT(*) AS count
      FROM run_changes
      WHERE run_id = ?
      GROUP BY entity_type, change_kind, undone_at IS NOT NULL
    `).all(runId) as Array<{
      entity_type: RunMutationChange['entityType']
      change_kind: RunMutationChange['changeKind']
      undone_at: string | null
      count: number
    }>
    if (jobRow === undefined && mutationCount === 0 && rows.length === 0) {
      throw new StoreNotFoundError('run', runId)
    }
    const count = (
      entityType: RunMutationChange['entityType'],
      changeKind?: RunMutationChange['changeKind'],
    ) => rows
      .filter((row) =>
        row.entity_type === entityType && (changeKind === undefined || row.change_kind === changeKind))
      .reduce((total, row) => total + Number(row.count), 0)
    const total = rows.reduce((sum, row) => sum + Number(row.count), 0)
    const undone = rows
      .filter((row) => row.undone_at !== null)
      .reduce((sum, row) => sum + Number(row.count), 0)
    const eventRange = this.db.db.prepare(`
      SELECT MIN(sequence) AS first, MAX(sequence) AS last
      FROM project_events WHERE project_id = ? AND run_id = ?
    `).get(this.projectId, runId) as { first: number | null; last: number | null }
    const job = jobRow === undefined ? undefined : jobFromRow(jobRow)
    return {
      schemaVersion: 1,
      projectId: this.projectId,
      runId,
      ...(job === undefined
        ? {}
        : {
            job: {
              jobId: job.jobId,
              status: job.status,
              scopedSegments: job.segmentIds.length,
              cursor: job.cursor,
              completedSegments: job.completedSegmentIds.length,
              failedSegments: job.failedSegmentIds.length,
            },
          }),
      mutationCount,
      changes: {
        proposalsCreated: count('proposal', 'created'),
        qaFindingsCreated: count('qa-finding', 'created'),
        qaFindingsUpdated: count('qa-finding', 'updated'),
        criticReviewsCreated: count('critic-artifact', 'created'),
        filesTouched: count('file'),
        total,
        undone,
      },
      ...(eventRange.first === null || eventRange.last === null
        ? {}
        : { eventSequence: { first: Number(eventRange.first), last: Number(eventRange.last) } }),
      canUndo: rows.some((row) =>
        (
          (row.entity_type === 'proposal' && row.change_kind === 'created')
          || (row.entity_type === 'segment' && row.change_kind === 'updated')
        ) && row.undone_at === null),
    }
  }

  getLatestRunChangeSummary(): RunChangeSummaryV1 | undefined {
    const row = this.db.db.prepare(`
      SELECT event.run_id
      FROM project_events AS event
      WHERE event.project_id = ?
        AND (
          EXISTS (
            SELECT 1 FROM translation_jobs
            WHERE project_id = ? AND run_id = event.run_id
          )
          OR EXISTS (
            SELECT 1 FROM proposal_mutations
            WHERE run_id = event.run_id
          )
        )
      ORDER BY event.sequence DESC
      LIMIT 1
    `).get(this.projectId, this.projectId) as { run_id: string } | undefined
    return row === undefined ? undefined : this.getRunChangeSummary(row.run_id)
  }

  undoRun(runId: string, options: UndoRunOptions): RunUndoResult {
    requireNonBlank(runId, 'runId')
    requireNonBlank(options.actorId, 'actorId')
    return this.db.transaction(`undo CAT changes for run ${runId}`, () => {
      const rows = this.db.db.prepare(`
        SELECT change_id, entity_type, entity_id, change_kind, segment_id,
               expected_revision, before_json, after_json, undone_at
        FROM run_changes
        WHERE run_id = ?
        ORDER BY change_id DESC
      `).all(runId) as RunChangeRow[]
      if (rows.length === 0) throw new StoreNotFoundError('run changes', runId)
      const pending = rows.filter((row) => row.undone_at === null)
      if (pending.length === 0) {
        return { runId, status: 'already-undone', reverted: [], refused: [] }
      }

      const reverted: RunUndoResult['reverted'] = []
      const refused: RunUndoResult['refused'] = []
      const revertedChangeIds: number[] = []
      const segmentIds = new Set<string>()
      const proposalIds: string[] = []
      const undoneAt = this.now()
      for (const row of pending) {
        const reason = this.undoChange(row)
        if (reason !== undefined) {
          refused.push({
            entityType: row.entity_type,
            entityId: row.entity_id,
            reason,
          })
          continue
        }
        this.db.db.prepare(`
          UPDATE run_changes SET undone_at = ?
          WHERE change_id = ? AND undone_at IS NULL
        `).run(undoneAt, row.change_id)
        reverted.push({ entityType: row.entity_type, entityId: row.entity_id })
        revertedChangeIds.push(row.change_id)
        if (row.segment_id !== null) segmentIds.add(row.segment_id)
        if (row.entity_type === 'proposal') proposalIds.push(row.entity_id)
      }
      const event = reverted.length === 0
        ? undefined
        : this.appendEvent(
            `undo:${runId}:${fingerprint(revertedChangeIds)}`,
            runId,
            `undo:${options.actorId}`,
            {
              kind: 'run-undone',
              ...(segmentIds.size === 0 ? {} : { segmentIds: [...segmentIds] }),
              ...(proposalIds.length === 0 ? {} : { proposalIds }),
            },
            undoneAt,
          )
      return {
        runId,
        status:
          reverted.length === 0
            ? 'refused'
            : refused.length === 0
              ? 'completed'
              : 'partial',
        reverted,
        refused,
        ...(event === undefined ? {} : { event }),
      }
    })
  }

  executeMutation<TPayload, TResult>(
    input: ExecuteRunMutationInput<TPayload, TResult>,
  ): IdempotentRunMutation<TResult> {
    const { identity } = input
    requireNonBlank(identity.runId, 'runId')
    requireNonBlank(identity.toolCallId, 'toolCallId')
    requireNonBlank(identity.idempotencyKey, 'idempotencyKey')
    requireNonBlank(input.operation, 'operation')
    const requestFingerprint = fingerprint(input.payload)

    return this.db.transaction(`${input.operation} ${identity.idempotencyKey}`, () => {
      const existing = this.db.db.prepare(`
        SELECT operation, request_fingerprint, result_json, run_id, tool_call_id, event_sequence
        FROM proposal_mutations WHERE idempotency_key = ?
      `).get(identity.idempotencyKey) as MutationReceiptRow | undefined
      if (existing !== undefined) {
        if (
          existing.operation !== input.operation ||
          existing.request_fingerprint !== requestFingerprint ||
          existing.run_id !== identity.runId ||
          existing.tool_call_id !== identity.toolCallId
        ) {
          throw new StoreIdempotencyConflictError(identity.idempotencyKey)
        }
        return {
          result: JSON.parse(existing.result_json) as TResult,
          replayed: true,
          ...(existing.event_sequence === null
            ? {}
            : { event: this.requireEvent(existing.event_sequence) }),
        }
      }

      const at = this.now()
      this.db.db.prepare(`
        INSERT INTO proposal_mutations (
          idempotency_key, operation, request_fingerprint, result_json, created_at,
          run_id, tool_call_id, event_sequence
        ) VALUES (?, ?, ?, 'null', ?, ?, ?, NULL)
      `).run(
        identity.idempotencyKey,
        input.operation,
        requestFingerprint,
        at,
        identity.runId,
        identity.toolCallId,
      )
      const outcome = input.mutate()
      if (outcome.changes.length > 0 && outcome.event === undefined) {
        throw new TypeError('a business mutation with recorded changes requires an outbox event')
      }
      for (const change of outcome.changes) {
        requireNonBlank(change.entityId, 'change.entityId')
        this.db.db.prepare(`
          INSERT INTO run_changes (
            run_id, mutation_key, entity_type, entity_id, change_kind,
            segment_id, expected_revision, before_json, after_json, created_at, undone_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `).run(
          identity.runId,
          identity.idempotencyKey,
          change.entityType,
          change.entityId,
          change.changeKind,
          change.segmentId ?? null,
          change.expectedRevision ?? null,
          change.before === undefined ? null : JSON.stringify(change.before),
          change.after === undefined ? null : JSON.stringify(change.after),
          at,
        )
      }
      const event = outcome.event === undefined
        ? undefined
        : this.appendEvent(
            identity.idempotencyKey,
            identity.runId,
            identity.toolCallId,
            outcome.event,
            at,
          )
      const serializedResult = JSON.stringify(outcome.result)
      if (serializedResult === undefined) throw new TypeError('mutation result must be JSON serializable')
      this.db.db.prepare(`
        UPDATE proposal_mutations SET result_json = ?, event_sequence = ?
        WHERE idempotency_key = ?
      `).run(serializedResult, event?.sequence ?? null, identity.idempotencyKey)
      return {
        result: outcome.result,
        replayed: false,
        ...(event === undefined ? {} : { event }),
      }
    })
  }

  /** Read-only replay window; callers choose when to acknowledge. */
  listEvents(afterSequence = 0, limit = 100): DurableProjectEvent[] {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new RangeError('afterSequence must be a non-negative integer')
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError('limit must be an integer between 1 and 500')
    }
    const rows = this.db.db.prepare(`
      SELECT sequence, project_id, run_id, kind, payload_json, created_at
      FROM project_events
      WHERE project_id = ? AND sequence > ?
      ORDER BY sequence
      LIMIT ?
    `).all(this.projectId, afterSequence, limit) as ProjectEventRow[]
    return rows.map(eventFromRow)
  }

  /** Latest durable outbox event without scanning a bounded replay window. */
  getLatestEvent(): DurableProjectEvent | undefined {
    const row = this.db.db.prepare(`
      SELECT sequence, project_id, run_id, kind, payload_json, created_at
      FROM project_events
      WHERE project_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).get(this.projectId) as ProjectEventRow | undefined
    return row === undefined ? undefined : eventFromRow(row)
  }

  /** 当前 project_events 的最大 sequence（无事件时为 0）；供快照绑定类游标读取。 */
  get latestEventSequence(): number {
    const row = this.db.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS sequence
      FROM project_events WHERE project_id = ?
    `).get(this.projectId) as { sequence: number }
    return Number(row.sequence)
  }

  /**
   * 人工 Store 写入与 Agent run 共用同一 durable outbox。调用者已经在其
   * mutation 事务内时，CatDatabase 会复用该事务，失败即一并回滚。
   */
  appendProjectEvent(input: ProjectEventInput): DurableProjectEvent {
    return this.db.transaction(`append ${input.kind} project event`, () => {
      const sequence = this.nextEventSequence()
      const identity = `manual:${input.kind}:${sequence}`
      return this.appendEvent(identity, identity, identity, input, this.now())
    })
  }

  getEventAck(consumerId: string): ProjectEventAck | undefined {
    requireNonBlank(consumerId, 'consumerId')
    const row = this.db.db.prepare(`
      SELECT consumer_id, sequence, acked_at
      FROM project_event_acks WHERE consumer_id = ?
    `).get(consumerId) as ProjectEventAckRow | undefined
    return row === undefined
      ? undefined
      : { consumerId: row.consumer_id, sequence: Number(row.sequence), ackedAt: row.acked_at }
  }

  ackEvents(consumerId: string, throughSequence: number): ProjectEventAck {
    requireNonBlank(consumerId, 'consumerId')
    if (!Number.isInteger(throughSequence) || throughSequence < 0) {
      throw new RangeError('throughSequence must be a non-negative integer')
    }
    return this.db.transaction(`ack project events for ${consumerId}`, () => {
      if (throughSequence > this.latestEventSequence) {
        throw new RangeError('throughSequence is beyond the durable project event sequence')
      }
      const existing = this.getEventAck(consumerId)
      if (existing !== undefined && existing.sequence >= throughSequence) return existing
      const ackedAt = this.now()
      this.db.db.prepare(`
        INSERT INTO project_event_acks (consumer_id, sequence, acked_at)
        VALUES (?, ?, ?)
        ON CONFLICT(consumer_id) DO UPDATE SET
          sequence = excluded.sequence,
          acked_at = excluded.acked_at
      `).run(consumerId, throughSequence, ackedAt)
      return { consumerId, sequence: throughSequence, ackedAt }
    })
  }

  private appendEvent(
    eventKey: string,
    runId: string,
    toolCallId: string,
    input: ProjectEventInput,
    createdAt: string,
  ): DurableProjectEvent {
    const inserted = this.db.db.prepare(`
      INSERT INTO project_events (
        project_id, event_key, run_id, kind, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      this.projectId,
      eventKey,
      runId,
      input.kind,
      JSON.stringify({ ...input, toolCallId }),
      createdAt,
    )
    return this.requireEvent(Number(inserted.lastInsertRowid))
  }

  private appendJobEvent(
    job: TranslationJob,
    createdAt: string,
  ): DurableProjectEvent | undefined {
    if (job.provenance.projectEventPolicy === 'suppress') return undefined
    const next = this.nextEventSequence()
    return this.appendEvent(
      `job:${job.jobId}:${next}`,
      job.runId,
      `job:${job.jobId}`,
      {
        kind: 'job-updated',
        jobId: job.jobId,
        job: {
          status: job.status,
          cursor: job.cursor,
          total: job.segmentIds.length,
          completed: job.completedSegmentIds.length,
          failed: job.failedSegmentIds.length,
        },
      },
      createdAt,
    )
  }

  private nextEventSequence(): number {
    const row = this.db.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM project_events
    `).get() as { sequence: number }
    return Number(row.sequence)
  }

  private requireEvent(sequence: number): DurableProjectEvent {
    const row = this.db.db.prepare(`
      SELECT sequence, project_id, run_id, kind, payload_json, created_at
      FROM project_events WHERE project_id = ? AND sequence = ?
    `).get(this.projectId, sequence) as ProjectEventRow | undefined
    if (row === undefined) throw new StoreNotFoundError('project event', String(sequence))
    return eventFromRow(row)
  }

  private undoChange(row: RunChangeRow): string | undefined {
    if (row.entity_type === 'file') return 'file effects are recorded but not structurally reversible'
    if (row.entity_type === 'segment' && row.change_kind === 'updated') {
      if (row.before_json === null || row.after_json === null) return 'segment update is missing its snapshots'
      const before = JSON.parse(row.before_json) as Segment
      const after = JSON.parse(row.after_json) as Segment
      const currentRow = this.db.db.prepare('SELECT * FROM segments WHERE id = ?').get(row.entity_id) as
        | SegmentRow
        | undefined
      if (currentRow === undefined) return 'segment no longer exists'
      if (canonicalJson(segmentFromRow(currentRow)) !== canonicalJson(after)) {
        return 'segment changed after this run'
      }
      const revision = this.db.db.prepare(`
        SELECT revision FROM segment_revisions WHERE segment_id = ? AND revision = ?
      `).get(row.entity_id, after.revision)
      if (revision === undefined) return 'segment revision entry no longer exists'
      this.db.db.prepare(`
        UPDATE segments SET target = ?, status = ?, revision = ? WHERE id = ?
      `).run(before.target, before.status, before.revision, row.entity_id)
      this.db.db.prepare(`
        DELETE FROM segment_revisions WHERE segment_id = ? AND revision = ?
      `).run(row.entity_id, after.revision)
      return undefined
    }
    if (row.entity_type !== 'proposal' || row.change_kind !== 'created') {
      return `unsupported structured change ${row.entity_type}:${row.change_kind}`
    }
    const current = this.db.db
      .prepare('SELECT * FROM proposals WHERE id = ?')
      .get(row.entity_id) as ProposalRow | undefined
    if (current === undefined) return 'proposal no longer exists'
    if (row.after_json === null) return 'created proposal is missing its recorded after state'
    const recorded = JSON.parse(row.after_json)
    if (canonicalJson(proposalFromRow(current)) !== canonicalJson(recorded)) {
      return 'proposal changed after this run'
    }
    if (row.segment_id !== null && row.expected_revision !== null) {
      const segment = this.db.db.prepare('SELECT revision FROM segments WHERE id = ?').get(row.segment_id) as
        | { revision: number }
        | undefined
      if (segment === undefined) return 'segment no longer exists'
      if (Number(segment.revision) !== Number(row.expected_revision)) {
        return `segment revision changed from ${row.expected_revision} to ${segment.revision}`
      }
    }
    const recordedProposal = proposalFromRow(current)
    if (recordedProposal.status === 'accepted') {
      const segment = this.db.db.prepare('SELECT revision FROM segments WHERE id = ?').get(recordedProposal.segmentId) as
        | { revision: number }
        | undefined
      if (segment === undefined || Number(segment.revision) !== recordedProposal.baseRevision) {
        return 'accepted proposal segment was not reverted first'
      }
    } else if (recordedProposal.status !== 'pending') return 'proposal is no longer pending'
    const deleted = this.db.db.prepare('DELETE FROM proposals WHERE id = ?').run(row.entity_id)
    return Number(deleted.changes) === 1 ? undefined : 'proposal no longer exists'
  }

  private getRow(jobId: string): TranslationJobRow | undefined {
    return this.db.db
      .prepare('SELECT * FROM translation_jobs WHERE job_id = ? AND project_id = ?')
      .get(jobId, this.projectId) as TranslationJobRow | undefined
  }

  private requireRow(jobId: string): TranslationJobRow {
    const row = this.getRow(jobId)
    if (row === undefined) throw new StoreJobStateError(jobId, 'job does not exist in this project')
    return row
  }

  private assertAuthority(row: TranslationJobRow, authority: TranslationJobAuthority): void {
    if (row.session_id !== authority.sessionId) {
      throw new StoreAuthorityError('translation job', row.job_id)
    }
  }
}
