import type { CatDatabase } from './database'
import {
  addProblem,
  integrityResult,
  type ProblemCounts,
  type ProjectIntegrityCheck,
} from './integrity-types'

const EVENT_KINDS = new Set([
  'proposal-created',
  'proposal-reviewed',
  'segment-updated',
  'qa-updated',
  'asset-updated',
  'project-updated',
  'job-updated',
  'run-undone',
])
const JOB_STRATEGIES = new Set(['fast', 'balanced', 'best'])
const JOB_STATUSES = new Set(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'])
const JOB_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  pending: new Set(['running', 'cancelled']),
  running: new Set(['paused', 'completed', 'failed', 'cancelled']),
  paused: new Set(['running', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(['running', 'cancelled']),
  cancelled: new Set(),
}
const RUN_ENTITY_TYPES = new Set(['proposal', 'qa-finding', 'critic-artifact', 'file'])
const RUN_CHANGE_KINDS = new Set(['created', 'updated', 'deleted', 'touched'])

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isOpaqueId(value: unknown): value is string {
  return isNonBlankString(value)
    && value.length <= 200
    && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return undefined
  }
}

function parseUniqueStringArray(value: string): string[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      !Array.isArray(parsed)
      || parsed.some((item) => !isNonBlankString(item))
      || new Set(parsed).size !== parsed.length
    ) return undefined
    return parsed as string[]
  } catch {
    return undefined
  }
}

interface IntegrityEventRow {
  sequence: number
  project_id: string
  event_key: string
  run_id: string | null
  kind: string
  payload_json: string
}

export function checkEventSequence(
  db: CatDatabase,
  projectId: string,
): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  try {
    const events = db.db.prepare(`
      SELECT sequence, project_id, event_key, run_id, kind, payload_json
      FROM project_events ORDER BY sequence
    `).all() as IntegrityEventRow[]
    const bySequence = new Map(events.map((event) => [Number(event.sequence), event]))
    let previous = 0
    for (const event of events) {
      const sequence = Number(event.sequence)
      if (!Number.isSafeInteger(sequence) || sequence !== previous + 1) {
        addProblem(failed, 'EVENT_SEQUENCE_GAP')
      }
      previous = sequence
      if (event.project_id !== projectId) addProblem(failed, 'EVENT_PROJECT_MISMATCH')
      if (!isNonBlankString(event.event_key) || !isNonBlankString(event.run_id)) {
        addProblem(failed, 'EVENT_IDENTITY_INVALID')
      }
      if (!EVENT_KINDS.has(event.kind)) addProblem(failed, 'EVENT_KIND_INVALID')
      const payload = parseJsonRecord(event.payload_json)
      if (payload === undefined) addProblem(failed, 'EVENT_PAYLOAD_INVALID')
      else {
        if (payload.kind !== event.kind) addProblem(failed, 'EVENT_KIND_DIVERGED')
        if (!isNonBlankString(payload.toolCallId)) addProblem(failed, 'EVENT_TOOL_CALL_INVALID')
      }
    }

    const acks = db.db.prepare(`
      SELECT consumer_id, sequence FROM project_event_acks ORDER BY consumer_id
    `).all() as Array<{ consumer_id: string; sequence: number }>
    for (const ack of acks) {
      const sequence = Number(ack.sequence)
      if (!isNonBlankString(ack.consumer_id)) addProblem(failed, 'EVENT_ACK_CONSUMER_INVALID')
      if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > previous) {
        addProblem(failed, 'EVENT_ACK_OUT_OF_RANGE')
      }
    }

    const links = db.db.prepare(`
      SELECT idempotency_key, run_id, tool_call_id, event_sequence
      FROM proposal_mutations
      WHERE event_sequence IS NOT NULL
      ORDER BY idempotency_key
    `).all() as Array<{
      idempotency_key: string
      run_id: string | null
      tool_call_id: string | null
      event_sequence: number
    }>
    for (const link of links) {
      const event = bySequence.get(Number(link.event_sequence))
      if (event === undefined) {
        addProblem(failed, 'MUTATION_EVENT_MISSING')
        continue
      }
      const payload = parseJsonRecord(event.payload_json)
      if (
        event.event_key !== link.idempotency_key
        || event.run_id !== link.run_id
        || payload?.toolCallId !== link.tool_call_id
      ) addProblem(failed, 'MUTATION_EVENT_LINEAGE_MISMATCH')
    }
    return integrityResult('event_sequence', events.length + acks.length + links.length, failed)
  } catch {
    return integrityResult(
      'event_sequence',
      0,
      new Map(),
      new Map([['EVENT_SEQUENCE_SCAN_UNAVAILABLE', 1]]),
    )
  }
}

interface IntegrityJobRow {
  job_id: string
  project_id: string
  run_id: string
  session_id: string
  strategy: string
  status: string
  segment_ids_json: string
  base_revisions_json: string
  cursor: number
  completed_segment_ids_json: string
  failed_segment_ids_json: string
  proposal_ids_json: string
  open_item_ids_json: string
  provenance_json: string
  failure_code: string | null
}

function validJobProvenance(value: Record<string, unknown>): boolean {
  if (value.schemaVersion !== 1 || !isOpaqueId(value.runtime)) return false
  if (
    value.projectEventPolicy !== undefined
    && value.projectEventPolicy !== 'emit'
    && value.projectEventPolicy !== 'suppress'
  ) return false
  for (const [field, item] of Object.entries(value)) {
    if (field === 'schemaVersion' || item === undefined) continue
    if (!isOpaqueId(item)) return false
  }
  return value.projectDigestHash === undefined
    || (typeof value.projectDigestHash === 'string' && /^[a-f0-9]{64}$/.test(value.projectDigestHash))
}

export function checkJobLineage(
  db: CatDatabase,
  projectId: string,
): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  try {
    const jobs = db.db.prepare(
      'SELECT * FROM translation_jobs ORDER BY job_id',
    ).all() as IntegrityJobRow[]
    const segments = new Map(
      (db.db.prepare('SELECT id, revision FROM segments').all() as Array<{
        id: string
        revision: number
      }>).map((row) => [row.id, Number(row.revision)]),
    )
    const revisions = new Set(
      (db.db.prepare('SELECT segment_id, revision FROM segment_revisions').all() as Array<{
        segment_id: string
        revision: number
      }>).map((row) => `${row.segment_id}\0${Number(row.revision)}`),
    )
    const proposals = new Set(
      (db.db.prepare('SELECT id FROM proposals').all() as Array<{ id: string }>).map((row) => row.id),
    )
    const eventRows = db.db.prepare(`
      SELECT sequence, run_id, payload_json
      FROM project_events
      WHERE kind = 'job-updated'
      ORDER BY sequence
    `).all() as Array<{ sequence: number; run_id: string | null; payload_json: string }>
    const eventsByJob = new Map<string, Array<{
      sequence: number
      runId: string | null
      payload: Record<string, unknown>
    }>>()
    for (const event of eventRows) {
      const payload = parseJsonRecord(event.payload_json)
      if (
        payload === undefined
        || !isNonBlankString(payload.jobId)
        || asRecord(payload.job) === undefined
      ) {
        addProblem(failed, 'JOB_EVENT_PAYLOAD_INVALID')
        continue
      }
      const entries = eventsByJob.get(payload.jobId) ?? []
      entries.push({ sequence: Number(event.sequence), runId: event.run_id, payload })
      eventsByJob.set(payload.jobId, entries)
    }
    const jobsById = new Map(jobs.map((job) => [job.job_id, job]))
    for (const [jobId, events] of eventsByJob) {
      const job = jobsById.get(jobId)
      if (job === undefined) addProblem(failed, 'JOB_EVENT_REFERENCE_MISSING', events.length)
      else {
        addProblem(
          failed,
          'JOB_EVENT_RUN_MISMATCH',
          events.filter((event) => event.runId !== job.run_id).length,
        )
      }
    }

    for (const job of jobs) {
      if (
        !isNonBlankString(job.job_id)
        || !isNonBlankString(job.run_id)
        || !isNonBlankString(job.session_id)
        || job.project_id !== projectId
      ) addProblem(failed, 'JOB_IDENTITY_INVALID')
      if (!JOB_STRATEGIES.has(job.strategy) || !JOB_STATUSES.has(job.status)) {
        addProblem(failed, 'JOB_STATE_INVALID')
      }
      if (
        (job.status === 'failed' && !isNonBlankString(job.failure_code))
        || (job.status !== 'failed' && job.failure_code !== null)
      ) addProblem(failed, 'JOB_FAILURE_STATE_INVALID')

      const scope = parseUniqueStringArray(job.segment_ids_json)
      const completed = parseUniqueStringArray(job.completed_segment_ids_json)
      const failedSegments = parseUniqueStringArray(job.failed_segment_ids_json)
      const proposalIds = parseUniqueStringArray(job.proposal_ids_json)
      const openItems = parseUniqueStringArray(job.open_item_ids_json)
      const baseRevisions = parseJsonRecord(job.base_revisions_json)
      const provenance = parseJsonRecord(job.provenance_json)
      if (
        scope === undefined
        || completed === undefined
        || failedSegments === undefined
        || proposalIds === undefined
        || openItems === undefined
        || baseRevisions === undefined
        || provenance === undefined
        || !validJobProvenance(provenance)
        || openItems.some((item) => !isOpaqueId(item))
      ) {
        addProblem(failed, 'JOB_STATE_JSON_INVALID')
        continue
      }
      if (scope.length === 0) addProblem(failed, 'JOB_SCOPE_EMPTY')
      const scopeSet = new Set(scope)
      const baseKeys = Object.keys(baseRevisions)
      if (
        baseKeys.length !== scope.length
        || baseKeys.some((segmentId) => !scopeSet.has(segmentId))
      ) addProblem(failed, 'JOB_BASE_REVISION_SCOPE_MISMATCH')
      for (const segmentId of scope) {
        const currentRevision = segments.get(segmentId)
        const baseRevision = baseRevisions[segmentId]
        if (currentRevision === undefined) addProblem(failed, 'JOB_SEGMENT_REFERENCE_MISSING')
        else if (
          !Number.isSafeInteger(baseRevision)
          || Number(baseRevision) < 0
          || Number(baseRevision) > currentRevision
          || (Number(baseRevision) > 0 && !revisions.has(`${segmentId}\0${Number(baseRevision)}`))
        ) addProblem(failed, 'JOB_BASE_REVISION_INVALID')
      }
      const cursor = Number(job.cursor)
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > scope.length) {
        addProblem(failed, 'JOB_CURSOR_INVALID')
      } else {
        const failedSet = new Set(failedSegments)
        const processed = new Set([...completed, ...failedSegments])
        if (
          completed.some((segmentId) => !scopeSet.has(segmentId) || failedSet.has(segmentId))
          || failedSegments.some((segmentId) => !scopeSet.has(segmentId))
          || processed.size !== cursor
          || scope.slice(0, cursor).some((segmentId) => !processed.has(segmentId))
        ) addProblem(failed, 'JOB_CHECKPOINT_INVALID')
        if (job.status === 'completed' && cursor !== scope.length) {
          addProblem(failed, 'JOB_COMPLETION_INVALID')
        }
      }
      addProblem(
        failed,
        'JOB_PROPOSAL_REFERENCE_MISSING',
        proposalIds.filter((proposalId) => !proposals.has(proposalId)).length,
      )

      const events = eventsByJob.get(job.job_id) ?? []
      if (provenance.projectEventPolicy === 'suppress') {
        if (events.length > 0) addProblem(failed, 'JOB_EVENT_POLICY_MISMATCH')
      } else if (events.length === 0) {
        addProblem(failed, 'JOB_EVENT_MISSING')
      } else {
        let previousState: {
          status: string
          cursor: number
          completed: number
          failed: number
        } | undefined
        for (const event of events) {
          const state = event.payload.job as Record<string, unknown>
          const status = state.status
          const eventCursor = Number(state.cursor)
          const total = Number(state.total)
          const eventCompleted = Number(state.completed)
          const eventFailed = Number(state.failed)
          if (
            typeof status !== 'string'
            || !JOB_STATUSES.has(status)
            || !Number.isSafeInteger(eventCursor)
            || !Number.isSafeInteger(total)
            || !Number.isSafeInteger(eventCompleted)
            || !Number.isSafeInteger(eventFailed)
            || eventCursor < 0
            || eventCompleted < 0
            || eventFailed < 0
            || eventCursor > scope.length
            || total !== scope.length
            || eventCompleted + eventFailed !== eventCursor
            || (status === 'completed' && eventCursor !== scope.length)
          ) {
            addProblem(failed, 'JOB_EVENT_STATE_INVALID')
            continue
          }
          if (previousState === undefined) {
            if (status !== 'pending' || eventCursor !== 0) {
              addProblem(failed, 'JOB_EVENT_HISTORY_INVALID')
            }
          } else if (
            eventCursor < previousState.cursor
            || eventCompleted < previousState.completed
            || eventFailed < previousState.failed
            || (
              status !== previousState.status
              && !JOB_TRANSITIONS[previousState.status]?.has(status)
            )
          ) {
            addProblem(failed, 'JOB_EVENT_HISTORY_INVALID')
          }
          previousState = {
            status,
            cursor: eventCursor,
            completed: eventCompleted,
            failed: eventFailed,
          }
        }
        const state = events[events.length - 1]!.payload.job as Record<string, unknown>
        if (
          state.status !== job.status
          || Number(state.cursor) !== cursor
          || Number(state.total) !== scope.length
          || Number(state.completed) !== completed.length
          || Number(state.failed) !== failedSegments.length
        ) addProblem(failed, 'JOB_EVENT_STATE_DIVERGED')
      }
    }
    return integrityResult('job_lineage', jobs.length + eventRows.length, failed)
  } catch {
    return integrityResult(
      'job_lineage',
      0,
      new Map(),
      new Map([['JOB_LINEAGE_SCAN_UNAVAILABLE', 1]]),
    )
  }
}

interface IntegrityRunChangeRow {
  change_id: number
  run_id: string
  mutation_key: string
  entity_type: string
  entity_id: string
  change_kind: string
  segment_id: string | null
  expected_revision: number | null
  before_json: string | null
  after_json: string | null
  undone_at: string | null
  receipt_key: string | null
  receipt_run_id: string | null
  tool_call_id: string | null
  event_sequence: number | null
}

function validOptionalJson(value: string | null): boolean {
  if (value === null) return true
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

export function checkRunLineage(db: CatDatabase): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  const unavailable: ProblemCounts = new Map()
  try {
    const receipts = db.db.prepare(`
      SELECT idempotency_key, run_id, tool_call_id, event_sequence, result_json
      FROM proposal_mutations
      WHERE run_id IS NOT NULL OR tool_call_id IS NOT NULL OR event_sequence IS NOT NULL
      ORDER BY idempotency_key
    `).all() as Array<{
      idempotency_key: string
      run_id: string | null
      tool_call_id: string | null
      event_sequence: number | null
      result_json: string
    }>
    const events = new Map(
      (db.db.prepare(`
        SELECT sequence, event_key, run_id, payload_json FROM project_events
      `).all() as Array<{
        sequence: number
        event_key: string
        run_id: string | null
        payload_json: string
      }>).map((event) => [Number(event.sequence), event]),
    )
    for (const receipt of receipts) {
      if (!isNonBlankString(receipt.run_id) || !isNonBlankString(receipt.tool_call_id)) {
        addProblem(failed, 'RUN_MUTATION_IDENTITY_INVALID')
      }
      if (!validOptionalJson(receipt.result_json)) {
        addProblem(failed, 'RUN_MUTATION_RESULT_INVALID')
      }
      if (receipt.event_sequence !== null) {
        const event = events.get(Number(receipt.event_sequence))
        const payload = event === undefined ? undefined : parseJsonRecord(event.payload_json)
        if (event === undefined) addProblem(failed, 'RUN_MUTATION_EVENT_MISSING')
        else if (
          event.event_key !== receipt.idempotency_key
          || event.run_id !== receipt.run_id
          || payload?.toolCallId !== receipt.tool_call_id
        ) addProblem(failed, 'RUN_MUTATION_EVENT_MISMATCH')
      }
    }

    const changes = db.db.prepare(`
      SELECT c.change_id, c.run_id, c.mutation_key, c.entity_type, c.entity_id,
             c.change_kind, c.segment_id, c.expected_revision, c.before_json,
             c.after_json, c.undone_at,
             m.idempotency_key AS receipt_key, m.run_id AS receipt_run_id,
             m.tool_call_id, m.event_sequence
      FROM run_changes c
      LEFT JOIN proposal_mutations m ON m.idempotency_key = c.mutation_key
      ORDER BY c.change_id
    `).all() as IntegrityRunChangeRow[]
    const segments = new Map(
      (db.db.prepare('SELECT id, revision FROM segments').all() as Array<{
        id: string
        revision: number
      }>).map((row) => [row.id, Number(row.revision)]),
    )
    const revisions = new Set(
      (db.db.prepare('SELECT segment_id, revision FROM segment_revisions').all() as Array<{
        segment_id: string
        revision: number
      }>).map((row) => `${row.segment_id}\0${Number(row.revision)}`),
    )
    const entityIds = {
      proposal: new Set(
        (db.db.prepare('SELECT id FROM proposals').all() as Array<{ id: string }>).map((row) => row.id),
      ),
      'qa-finding': new Set(
        (db.db.prepare('SELECT id FROM qa_findings').all() as Array<{ id: string }>).map((row) => row.id),
      ),
      'critic-artifact': new Set(
        (db.db.prepare(
          'SELECT artifact_id FROM critic_artifacts',
        ).all() as Array<{ artifact_id: string }>).map((row) => row.artifact_id),
      ),
    }
    const latestByEntity = new Map<string, IntegrityRunChangeRow>()
    for (const change of changes) {
      if (
        !isNonBlankString(change.run_id)
        || !isNonBlankString(change.mutation_key)
        || !isNonBlankString(change.entity_id)
      ) addProblem(failed, 'RUN_CHANGE_IDENTITY_INVALID')
      if (!RUN_ENTITY_TYPES.has(change.entity_type) || !RUN_CHANGE_KINDS.has(change.change_kind)) {
        addProblem(failed, 'RUN_CHANGE_KIND_INVALID')
      }
      if (
        change.receipt_key === null
        || change.receipt_run_id !== change.run_id
        || !isNonBlankString(change.tool_call_id)
      ) addProblem(failed, 'RUN_CHANGE_MUTATION_MISMATCH')
      if (change.event_sequence === null) addProblem(failed, 'RUN_CHANGE_EVENT_MISSING')
      if (change.segment_id !== null) {
        const currentRevision = segments.get(change.segment_id)
        if (currentRevision === undefined) addProblem(failed, 'RUN_SEGMENT_REFERENCE_MISSING')
        if (
          change.expected_revision !== null
          && (
            !Number.isSafeInteger(Number(change.expected_revision))
            || Number(change.expected_revision) < 0
            || currentRevision === undefined
            || Number(change.expected_revision) > currentRevision
            || (
              Number(change.expected_revision) > 0
              && !revisions.has(`${change.segment_id}\0${Number(change.expected_revision)}`)
            )
          )
        ) addProblem(failed, 'RUN_SEGMENT_REVISION_INVALID')
      } else if (change.expected_revision !== null) {
        addProblem(failed, 'RUN_SEGMENT_REVISION_INVALID')
      }
      if (!validOptionalJson(change.before_json) || !validOptionalJson(change.after_json)) {
        addProblem(failed, 'RUN_CHANGE_JSON_INVALID')
      }
      if (
        change.undone_at !== null
        && (change.entity_type !== 'proposal' || change.change_kind !== 'created')
      ) addProblem(failed, 'RUN_UNDO_LINEAGE_INVALID')
      latestByEntity.set(`${change.entity_type}\0${change.entity_id}`, change)
    }
    for (const change of latestByEntity.values()) {
      if (change.entity_type === 'file') {
        addProblem(unavailable, 'RUN_FILE_REFERENCE_UNAVAILABLE')
      } else if (
        change.undone_at === null
        && change.change_kind !== 'deleted'
        && RUN_ENTITY_TYPES.has(change.entity_type)
        && !entityIds[change.entity_type as keyof typeof entityIds]?.has(change.entity_id)
      ) {
        addProblem(failed, 'RUN_ENTITY_REFERENCE_MISSING')
      }
    }
    return integrityResult('run_lineage', receipts.length + changes.length, failed, unavailable)
  } catch {
    return integrityResult(
      'run_lineage',
      0,
      new Map(),
      new Map([['RUN_LINEAGE_SCAN_UNAVAILABLE', 1]]),
    )
  }
}
