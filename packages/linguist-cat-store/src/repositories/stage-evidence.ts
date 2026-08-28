import type {
  StageEvidenceBaseline,
  StageEvidencePlan,
  StageEvidenceRole,
  WorkflowStage,
} from '@linguist/cat-core'
import { createStageEvidenceBaseline } from '@linguist/cat-core'
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
      this.db.db.prepare(`
        INSERT INTO stage_evidence_states (
          stage_run_id, project_id, session_id, role, stage, plan_json,
          baseline_json, status, stale_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', NULL, ?, ?)
      `).run(
        input.stageRunId,
        this.projectId,
        input.sessionId,
        input.plan.role,
        input.plan.stage,
        JSON.stringify(input.plan),
        JSON.stringify(input.baseline),
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
}
