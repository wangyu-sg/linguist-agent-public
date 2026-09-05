import type {
  EvidenceGap,
  EvidenceGapCode,
  ContextAnchorLocator,
  StageEvidenceRef,
  StageEvidenceReceipt,
  StageEvidenceBaseline,
  StageEvidencePlan,
  StageEvidenceRole,
  WorkflowStage,
} from '@linguist/cat-core'
import { createStageEvidenceBaseline, deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'

export type StageEvidenceStateStatus =
  | 'planning'
  | 'ready'
  | 'ready-with-gaps'
  | 'stale'
  | 'complete'

export interface StageEvidenceState {
  stageRunId: string
  projectId: string
  sessionId: string
  role: StageEvidenceRole
  stage: WorkflowStage
  plan: StageEvidencePlan
  baseline: StageEvidenceBaseline
  status: StageEvidenceStateStatus
  staleReason?: string
  createdAt: string
  updatedAt: string
}

export interface CreateStageEvidenceStateInput {
  stageRunId: string
  sessionId: string
  plan: StageEvidencePlan
  baseline: StageEvidenceBaseline
}

export interface ProjectInventoryGapInput {
  id: string
  code: EvidenceGapCode
  severity: 'blocking' | 'warning'
  evidence?: StageEvidenceRef
  summary: string
  suggestedAction: string
}

export interface RecordStageEvidenceReceiptInput {
  stageRunId: string
  baselineHash: string
  sessionId: string
  generationRunId: string
  toolCallId?: string
  segmentIds: string[]
  evidence: StageEvidenceReceipt['evidence']
}

export interface StageEvidencePresentationCoverage {
  required: number
  presented: number
  pending: Array<{ evidence: StageEvidenceRef; anchorIds: string[] }>
}

export interface StageEvidenceCompletion {
  status: 'in_progress' | 'blocked' | 'stale' | 'complete'
  decisions: {
    total: number
    confirmed: number
    unchanged: number
    corrected: number
    blocked: number
    pending: number
    status: 'in_progress' | 'complete' | 'completed_with_blocks'
  }
  presentation: StageEvidencePresentationCoverage
  blockingGaps: EvidenceGap[]
  warnings: EvidenceGap[]
}

interface StageEvidenceStateRow {
  stage_run_id: string
  project_id: string
  session_id: string
  role: StageEvidenceRole
  stage: WorkflowStage
  plan_json: string
  baseline_json: string
  status: StageEvidenceStateStatus
  stale_reason: string | null
  created_at: string
  updated_at: string
}

interface EvidenceGapRow {
  gap_id: string
  stage_run_id: string | null
  code: EvidenceGapCode
  severity: 'blocking' | 'warning'
  evidence_ref_json: string | null
  summary: string
  suggested_action: string
  status: 'open' | 'resolved' | 'waived'
  created_at: string
  resolved_at: string | null
  resolved_by: 'system' | 'agent' | 'user' | null
}

interface StageEvidenceReceiptRow {
  receipt_id: string
  stage_run_id: string
  baseline_hash: string
  session_id: string
  generation_run_id: string
  tool_call_id: string | null
  segment_ids_json: string
  evidence_json: string
  presented_at: string
}

const ROLE_STAGE: Record<StageEvidenceRole, WorkflowStage> = {
  translator: 'translation',
  reviewer: 'editing',
  proofreader: 'proofreading',
}

function stateFromRow(row: StageEvidenceStateRow): StageEvidenceState {
  return {
    stageRunId: row.stage_run_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    role: row.role,
    stage: row.stage,
    plan: JSON.parse(row.plan_json) as StageEvidencePlan,
    baseline: JSON.parse(row.baseline_json) as StageEvidenceBaseline,
    status: row.status,
    ...(row.stale_reason === null ? {} : { staleReason: row.stale_reason }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function gapFromRow(row: EvidenceGapRow): EvidenceGap {
  return {
    id: row.gap_id,
    ...(row.stage_run_id === null ? {} : { stageRunId: row.stage_run_id }),
    code: row.code,
    severity: row.severity,
    ...(row.evidence_ref_json === null
      ? {}
      : { evidence: JSON.parse(row.evidence_ref_json) as StageEvidenceRef }),
    summary: row.summary,
    suggestedAction: row.suggested_action,
    status: row.status,
    createdAt: row.created_at,
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
    ...(row.resolved_by === null ? {} : { resolvedBy: row.resolved_by }),
  }
}

function receiptFromRow(row: StageEvidenceReceiptRow): StageEvidenceReceipt {
  return {
    id: row.receipt_id,
    stageRunId: row.stage_run_id,
    baselineHash: row.baseline_hash,
    sessionId: row.session_id,
    generationRunId: row.generation_run_id,
    ...(row.tool_call_id === null ? {} : { toolCallId: row.tool_call_id }),
    segmentIds: JSON.parse(row.segment_ids_json) as string[],
    evidence: JSON.parse(row.evidence_json) as StageEvidenceReceipt['evidence'],
    presentedAt: row.presented_at,
  }
}

function evidenceRefKey(ref: StageEvidenceRef): string {
  return `${ref.kind}\u0000${ref.id}`
}

export class StageEvidenceRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string,
  ) {}

  create(input: CreateStageEvidenceStateInput): StageEvidenceState {
    if (
      input.stageRunId.trim() === ''
      || input.sessionId.trim() === ''
      || input.plan.stageRunId !== input.stageRunId
      || input.baseline.stageRunId !== input.stageRunId
    ) {
      throw new TypeError('Stage Evidence state requires one non-blank stageRunId and sessionId')
    }
    if (ROLE_STAGE[input.plan.role] !== input.plan.stage) {
      throw new TypeError(`Stage Evidence role ${input.plan.role} cannot run ${input.plan.stage}`)
    }
    if (
      input.plan.assetIds.length === 0
      || new Set(input.plan.assetIds).size !== input.plan.assetIds.length
      || input.plan.segmentIds.length === 0
      || new Set(input.plan.segmentIds).size !== input.plan.segmentIds.length
    ) {
      throw new TypeError('Stage Evidence plan requires a non-empty unique Segment scope')
    }
    const expectedBaseline = createStageEvidenceBaseline({
      stageRunId: input.stageRunId,
      discoveryScopeHash: input.baseline.discoveryScopeHash,
      mappingRevision: input.baseline.mappingRevision,
      ruleSetRevision: input.baseline.ruleSetRevision,
      segmentIds: input.plan.segmentIds,
      evidence: input.plan.requirements.map((item) => item.evidence),
    })
    if (JSON.stringify(expectedBaseline) !== JSON.stringify(input.baseline)) {
      throw new TypeError('Stage Evidence baseline does not match the frozen plan facts')
    }

    return this.db.transaction(`create Stage Evidence state ${input.stageRunId}`, () => {
      if (this.get(input.stageRunId) !== undefined) {
        throw new TypeError(`Stage Evidence state already exists: ${input.stageRunId}`)
      }
      const found = this.db.db.prepare(`
        SELECT segment.id, segment.asset_id
        FROM segments AS segment
        INNER JOIN assets AS asset ON asset.id = segment.asset_id
        WHERE segment.id IN (${input.plan.segmentIds.map(() => '?').join(',')})
          AND asset.project_id = ?
      `).all(...input.plan.segmentIds, this.projectId) as Array<{ id: string; asset_id: string }>
      const foundIds = new Set(found.map((row) => row.id))
      const missing = input.plan.segmentIds.find((segmentId) => !foundIds.has(segmentId))
      if (missing !== undefined) throw new StoreNotFoundError('segment', missing)
      const assetIds = new Set(input.plan.assetIds)
      const outsideAssetScope = found.find((row) => !assetIds.has(row.asset_id))
      if (outsideAssetScope !== undefined) {
        throw new TypeError(`Segment ${outsideAssetScope.id} is outside the Stage Evidence Asset scope`)
      }

      const at = this.now()
      const hasOpenProjectGaps = this.db.db.prepare(`
        SELECT 1 FROM evidence_gaps
        WHERE project_id = ? AND stage_run_id IS NULL AND status = 'open'
        LIMIT 1
      `).get(this.projectId) !== undefined
      this.db.db.prepare(`
        INSERT INTO stage_evidence_states (
          stage_run_id, project_id, session_id, role, stage, plan_json,
          baseline_json, status, stale_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        input.stageRunId,
        this.projectId,
        input.sessionId,
        input.plan.role,
        input.plan.stage,
        JSON.stringify(input.plan),
        JSON.stringify(input.baseline),
        hasOpenProjectGaps ? 'ready-with-gaps' : 'ready',
        at,
        at,
      )
      return this.get(input.stageRunId) as StageEvidenceState
    })
  }

  get(stageRunId: string): StageEvidenceState | undefined {
    const row = this.db.db.prepare(`
      SELECT * FROM stage_evidence_states
      WHERE stage_run_id = ? AND project_id = ?
    `).get(stageRunId, this.projectId) as StageEvidenceStateRow | undefined
    return row === undefined ? undefined : stateFromRow(row)
  }

  list(stage?: WorkflowStage): StageEvidenceState[] {
    const rows = stage === undefined
      ? this.db.db.prepare(`
          SELECT * FROM stage_evidence_states
          WHERE project_id = ? ORDER BY updated_at DESC, stage_run_id
        `).all(this.projectId)
      : this.db.db.prepare(`
          SELECT * FROM stage_evidence_states
          WHERE project_id = ? AND stage = ? ORDER BY updated_at DESC, stage_run_id
        `).all(this.projectId, stage)
    return (rows as StageEvidenceStateRow[]).map(stateFromRow)
  }

  markStale(stageRunId: string, reason: string): StageEvidenceState {
    if (reason.trim() === '') throw new TypeError('Stage Evidence stale reason must be non-blank')
    const result = this.db.db.prepare(`
      UPDATE stage_evidence_states
      SET status = 'stale', stale_reason = ?, updated_at = ?
      WHERE stage_run_id = ? AND project_id = ?
    `).run(reason, this.now(), stageRunId, this.projectId)
    if (result.changes === 0 && this.get(stageRunId) === undefined) {
      throw new StoreNotFoundError('stage evidence state', stageRunId)
    }
    return this.get(stageRunId) as StageEvidenceState
  }

  recordReceipt(input: RecordStageEvidenceReceiptInput): StageEvidenceReceipt {
    const state = this.get(input.stageRunId)
    if (state === undefined) throw new StoreNotFoundError('stage evidence state', input.stageRunId)
    if (state.baseline.baselineHash !== input.baselineHash) {
      throw new TypeError('Stage Evidence receipt baseline does not match the frozen Stage')
    }
    if (input.sessionId.trim() === '' || input.generationRunId.trim() === '' || input.evidence.length === 0) {
      throw new TypeError('Stage Evidence receipt requires session, generation, and evidence')
    }
    const planned = new Set(state.plan.requirements.map((item) => evidenceRefKey(item.evidence.ref)))
    const unplanned = input.evidence.find((item) => !planned.has(evidenceRefKey(item.ref)))
    if (unplanned !== undefined) throw new TypeError('Stage Evidence receipt contains unplanned evidence')
    const receiptId = deriveStableIdV2('evr', [
      input.stageRunId,
      input.baselineHash,
      input.sessionId,
      input.generationRunId,
      input.toolCallId ?? null,
      JSON.stringify([...new Set(input.segmentIds)].sort()),
      JSON.stringify(input.evidence),
    ])
    const at = this.now()
    this.db.db.prepare(`
      INSERT OR IGNORE INTO stage_evidence_receipts (
        receipt_id, stage_run_id, baseline_hash, session_id, generation_run_id,
        tool_call_id, segment_ids_json, evidence_json, presented_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receiptId,
      input.stageRunId,
      input.baselineHash,
      input.sessionId,
      input.generationRunId,
      input.toolCallId ?? null,
      JSON.stringify([...new Set(input.segmentIds)].sort()),
      JSON.stringify(input.evidence),
      at,
    )
    const row = this.db.db.prepare('SELECT * FROM stage_evidence_receipts WHERE receipt_id = ?')
      .get(receiptId) as StageEvidenceReceiptRow
    return receiptFromRow(row)
  }

  listReceipts(stageRunId: string): StageEvidenceReceipt[] {
    return (this.db.db.prepare(`
      SELECT * FROM stage_evidence_receipts
      WHERE stage_run_id = ? ORDER BY presented_at, receipt_id
    `).all(stageRunId) as StageEvidenceReceiptRow[]).map(receiptFromRow)
  }

  getPresentationCoverage(stageRunId: string): StageEvidencePresentationCoverage {
    const state = this.get(stageRunId)
    if (state === undefined) throw new StoreNotFoundError('stage evidence state', stageRunId)
    const presented = new Map<string, Set<string>>()
    const visual = new Map<string, Set<string>>()
    const ranges = new Map<string, Array<{ start: number; end: number }>>()
    for (const receipt of this.listReceipts(stageRunId)) {
      if (receipt.baselineHash !== state.baseline.baselineHash) continue
      for (const item of receipt.evidence) {
        const key = evidenceRefKey(item.ref)
        const planned = state.plan.requirements.find(requirement => evidenceRefKey(requirement.evidence.ref) === key)
        if (item.submission !== 'provider-response-v1' || item.version !== planned?.evidence.version) continue
        if (item.textRange) ranges.set(key, [...(ranges.get(key) ?? []), item.textRange])
        const map = item.visual ? visual : presented
        const anchors = map.get(key) ?? new Set<string>()
        item.anchorIds.forEach(anchorId => anchors.add(anchorId))
        map.set(key, anchors)
      }
    }
    for (const parts of ranges.values()) parts.sort((a, b) => a.start - b.start)
    const required = state.plan.requirements.filter(item => item.requiredness === 'required')
    const pending = required.flatMap<StageEvidencePresentationCoverage['pending'][number]>(item => {
      const key = evidenceRefKey(item.evidence.ref)
      if (item.evidence.ref.kind !== 'context-doc') {
        const anchors = presented.get(key)
        const missing = item.anchorIds.filter(id => !anchors?.has(id))
        return anchors !== undefined && missing.length === 0 ? [] : [{ evidence: item.evidence.ref, anchorIds: missing }]
      }
      const doc = this.db.db.prepare('SELECT kind, text_extract FROM context_docs WHERE id = ? AND project_id = ?')
        .get(item.evidence.ref.id, this.projectId) as { kind: string; text_extract: string | null } | undefined
      const completeRange = (range: { start: number; end: number }): boolean => {
        let end = range.start
        for (const part of ranges.get(key) ?? []) {
          if (part.start > end) break
          end = Math.max(end, part.end)
          if (end >= range.end) return true
        }
        return false
      }
      const fullText = doc?.text_extract !== null && doc?.text_extract !== undefined && doc.text_extract.length > 0
        && completeRange({ start: 0, end: doc.text_extract.length })
      const anchors = this.db.db.prepare('SELECT id, locator_json, media_context_doc_id FROM context_anchors WHERE context_doc_id = ?')
        .all(item.evidence.ref.id) as Array<{ id: string; locator_json: string; media_context_doc_id: string | null }>
      const ids = item.anchorIds.length > 0 ? item.anchorIds : anchors.map(anchor => anchor.id)
      const missing = ids.filter(id => {
        const anchor = anchors.find(candidate => candidate.id === id)
        if (anchor === undefined) return true
        const locator = JSON.parse(anchor.locator_json) as ContextAnchorLocator
        if (anchor.media_context_doc_id !== null || locator.kind === 'image') return !visual.get(key)?.has(id)
        return !(locator.textRange ? completeRange(locator.textRange) : fullText)
      })
      const covered = ids.length > 0 ? missing.length === 0
        : doc?.kind === 'image' ? visual.has(key) : fullText
      return covered ? [] : [{ evidence: item.evidence.ref, anchorIds: missing }]
    })
    return { required: required.length, presented: required.length - pending.length, pending }
  }

  refreshCompletion(
    stageRunId: string,
    decisions: StageEvidenceCompletion['decisions'],
  ): StageEvidenceCompletion {
    const state = this.get(stageRunId)
    if (state === undefined) throw new StoreNotFoundError('stage evidence state', stageRunId)
    const presentation = this.getPresentationCoverage(stageRunId)
    const gaps = this.listOpenGaps(stageRunId)
    const blockingGaps = gaps.filter((gap) => gap.severity === 'blocking')
    const warnings = gaps.filter((gap) => gap.severity === 'warning')
    const status: StageEvidenceCompletion['status'] = state.status === 'stale'
      ? 'stale'
      : decisions.pending > 0
        ? 'in_progress'
        : decisions.blocked > 0 || presentation.pending.length > 0 || blockingGaps.length > 0
          ? 'blocked'
          : 'complete'
    if (status === 'complete' && state.status !== 'complete') {
      this.db.db.prepare(`
        UPDATE stage_evidence_states SET status = 'complete', stale_reason = NULL, updated_at = ?
        WHERE stage_run_id = ? AND project_id = ?
      `).run(this.now(), stageRunId, this.projectId)
    } else if (status !== 'complete' && status !== 'stale' && state.status === 'complete') {
      this.db.db.prepare(`
        UPDATE stage_evidence_states SET status = ?, updated_at = ?
        WHERE stage_run_id = ? AND project_id = ?
      `).run(gaps.length > 0 ? 'ready-with-gaps' : 'ready', this.now(), stageRunId, this.projectId)
    }
    return { status, decisions, presentation, blockingGaps, warnings }
  }

  replaceProjectInventoryGaps(inputs: readonly ProjectInventoryGapInput[]): EvidenceGap[] {
    if (new Set(inputs.map((input) => input.id)).size !== inputs.length) {
      throw new TypeError('Project Evidence inventory gap ids must be unique')
    }
    return this.db.transaction('replace Project Evidence inventory gaps', () => {
      const at = this.now()
      this.db.db.prepare(`
        UPDATE evidence_gaps
        SET status = 'resolved', resolved_at = ?, resolved_by = 'system'
        WHERE project_id = ? AND stage_run_id IS NULL AND status = 'open'
      `).run(at, this.projectId)
      const upsert = this.db.db.prepare(`
        INSERT INTO evidence_gaps (
          gap_id, project_id, stage_run_id, code, severity, evidence_ref_json,
          summary, suggested_action, status, created_at, resolved_at, resolved_by
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'open', ?, NULL, NULL)
        ON CONFLICT(gap_id) DO UPDATE SET
          code = excluded.code,
          severity = excluded.severity,
          evidence_ref_json = excluded.evidence_ref_json,
          summary = excluded.summary,
          suggested_action = excluded.suggested_action,
          status = CASE WHEN evidence_gaps.status = 'waived' THEN 'waived' ELSE 'open' END,
          resolved_at = CASE WHEN evidence_gaps.status = 'waived' THEN evidence_gaps.resolved_at ELSE NULL END,
          resolved_by = CASE WHEN evidence_gaps.status = 'waived' THEN evidence_gaps.resolved_by ELSE NULL END
      `)
      for (const input of inputs) {
        if (input.id.trim() === '' || input.summary.trim() === '' || input.suggestedAction.trim() === '') {
          throw new TypeError('Project Evidence inventory gaps require non-blank id, summary, and action')
        }
        upsert.run(
          input.id,
          this.projectId,
          input.code,
          input.severity,
          input.evidence === undefined ? null : JSON.stringify(input.evidence),
          input.summary,
          input.suggestedAction,
          at,
        )
      }
      return this.listProjectInventoryGaps()
    })
  }

  listProjectInventoryGaps(): EvidenceGap[] {
    return (this.db.db.prepare(`
      SELECT * FROM evidence_gaps
      WHERE project_id = ? AND stage_run_id IS NULL
      ORDER BY status, severity, gap_id
    `).all(this.projectId) as EvidenceGapRow[]).map(gapFromRow)
  }

  replaceStageGaps(
    stageRunId: string,
    inputs: readonly ProjectInventoryGapInput[],
  ): EvidenceGap[] {
    if (this.get(stageRunId) === undefined) throw new StoreNotFoundError('stage evidence state', stageRunId)
    if (new Set(inputs.map((input) => input.id)).size !== inputs.length) {
      throw new TypeError('Stage Evidence gap ids must be unique')
    }
    return this.db.transaction(`replace Stage Evidence gaps ${stageRunId}`, () => {
      const at = this.now()
      this.db.db.prepare(`
        UPDATE evidence_gaps
        SET status = 'resolved', resolved_at = ?, resolved_by = 'system'
        WHERE project_id = ? AND stage_run_id = ? AND status = 'open'
      `).run(at, this.projectId, stageRunId)
      const upsert = this.db.db.prepare(`
        INSERT INTO evidence_gaps (
          gap_id, project_id, stage_run_id, code, severity, evidence_ref_json,
          summary, suggested_action, status, created_at, resolved_at, resolved_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL, NULL)
        ON CONFLICT(gap_id) DO UPDATE SET
          code = excluded.code,
          severity = excluded.severity,
          evidence_ref_json = excluded.evidence_ref_json,
          summary = excluded.summary,
          suggested_action = excluded.suggested_action,
          status = CASE WHEN evidence_gaps.status = 'waived' THEN 'waived' ELSE 'open' END,
          resolved_at = CASE WHEN evidence_gaps.status = 'waived' THEN evidence_gaps.resolved_at ELSE NULL END,
          resolved_by = CASE WHEN evidence_gaps.status = 'waived' THEN evidence_gaps.resolved_by ELSE NULL END
      `)
      for (const input of inputs) {
        if (input.id.trim() === '' || input.summary.trim() === '' || input.suggestedAction.trim() === '') {
          throw new TypeError('Stage Evidence gaps require non-blank id, summary, and action')
        }
        upsert.run(
          input.id,
          this.projectId,
          stageRunId,
          input.code,
          input.severity,
          input.evidence === undefined ? null : JSON.stringify(input.evidence),
          input.summary,
          input.suggestedAction,
          at,
        )
      }
      const gaps = this.listOpenGaps(stageRunId)
      this.db.db.prepare(`
        UPDATE stage_evidence_states
        SET status = CASE
          WHEN status IN ('stale', 'complete') THEN status
          WHEN ? > 0 THEN 'ready-with-gaps'
          ELSE 'ready'
        END, updated_at = ?
        WHERE stage_run_id = ? AND project_id = ?
      `).run(gaps.length, at, stageRunId, this.projectId)
      return gaps
    })
  }

  listOpenGaps(stageRunId: string): EvidenceGap[] {
    return (this.db.db.prepare(`
      SELECT * FROM evidence_gaps
      WHERE project_id = ? AND status = 'open'
        AND (stage_run_id IS NULL OR stage_run_id = ?)
      ORDER BY severity, gap_id
    `).all(this.projectId, stageRunId) as EvidenceGapRow[]).map(gapFromRow)
  }
}
