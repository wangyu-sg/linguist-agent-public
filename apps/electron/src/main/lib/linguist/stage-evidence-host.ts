import { createHash, randomUUID } from 'node:crypto'
import {
  createStageEvidenceBaseline,
  type ContextEvidenceLink,
  type StageEvidencePlan,
  type StageEvidenceRequirement,
  type StageEvidenceRole,
  type VersionedStageEvidenceRef,
} from '@linguist/cat-core'
import type {
  ProjectDatabase,
  ProjectInventoryGapInput,
  StageEvidenceState,
} from '@linguist/cat-store'
import type { AgentSessionMeta } from '@proma/shared'
import type { ProjectDiscoveryScope } from './project-discovery-scope'

type StageSession = Pick<
  AgentSessionMeta,
  'id' | 'linguistRole' | 'linguistDelegatedScope'
>

const ROLE_STAGE = {
  translator: 'translation',
  reviewer: 'editing',
  proofreader: 'proofreading',
} as const

const REQUIREDNESS_RANK = { optional: 0, conditional: 1, required: 2 } as const

function hash(values: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([...values].sort())).digest('hex')
}

function refKey(item: VersionedStageEvidenceRef): string {
  return `${item.ref.kind}\u0000${item.ref.id}`
}

function relevantLink(
  link: ContextEvidenceLink,
  assetIds: ReadonlySet<string>,
  segmentIds: ReadonlySet<string>,
): boolean {
  return link.relation.kind === 'asset'
    ? assetIds.has(link.relation.assetId)
    : segmentIds.has(link.relation.segmentId)
}

export function ensureStageEvidenceForSession(input: {
  session: StageSession
  db: ProjectDatabase
  discoveryScope: ProjectDiscoveryScope
  fallbackSegmentIds: readonly string[]
  restart?: boolean
  toolCallId?: string
  contextDocId?: string
}): StageEvidenceState | undefined {
  const role = input.session.linguistRole
  if (role !== 'translator' && role !== 'reviewer' && role !== 'proofreader') return undefined
  const segmentIds = [...new Set(
    input.session.linguistDelegatedScope?.segmentIds ?? input.fallbackSegmentIds,
  )]
  if (segmentIds.length === 0) return undefined
  const segments = input.db.segments.getByIds(segmentIds)
  if (segments.length !== segmentIds.length) throw new Error('Stage Evidence scope contains a missing Segment')
  const assetIds = [...new Set(segments.map((segment) => segment.assetId as string))]
  const existing = input.db.stageEvidence.list(ROLE_STAGE[role]).find(state => state.sessionId === input.session.id)
  const sameScope = existing?.plan.segmentIds.length === segmentIds.length && segmentIds.every(id => existing.plan.segmentIds.includes(id))
  let stageRunId = existing?.stageRunId ?? `stage:${randomUUID()}`
  const segmentIdSet = new Set(segmentIds)
  const assetIdSet = new Set(assetIds)
  const evidenceByRef = new Map(input.discoveryScope.managedEvidence.map((item) => [refKey(item), item]))
  const requirements: StageEvidenceRequirement[] = []
  const stageGaps: ProjectInventoryGapInput[] = []

  for (const assetId of assetIds) {
    const evidence = evidenceByRef.get(`asset\u0000${assetId}`)
    if (evidence === undefined) throw new Error(`Stage Evidence scope Asset is not registered: ${assetId}`)
    requirements.push({
      evidence,
      purpose: 'source-authority',
      requiredness: 'required',
      scope: { kind: 'assets', assetIds: [assetId] },
      anchorIds: [],
      rationale: '冻结范围内的 CAT 主批次是 Source authority',
    })
  }

  const mappingRevisions: string[] = []
  for (const doc of input.db.contextDocs.list({ limit: input.db.contextDocs.count() })) {
    const evidence = evidenceByRef.get(`context-doc\u0000${doc.id}`)
    if (evidence === undefined) continue
    const links = input.db.contextDocs.listEvidenceLinks(doc.id)
      .filter((link) => relevantLink(link, assetIdSet, segmentIdSet))
    const previouslyUsed = sameScope && existing?.plan.requirements.some(item => item.evidence.ref.kind === 'context-doc' && item.evidence.ref.id === doc.id)
    if (links.length === 0 && doc.id !== input.contextDocId && !previouslyUsed) continue
    mappingRevisions.push(...links.map((link) => JSON.stringify({
      contextDocId: doc.id,
      anchorId: link.anchorId ?? null,
      relation: link.relation,
      requiredness: link.requiredness,
      mappingRevision: link.mappingRevision,
    })))
    const anchorIds = [...new Set(links.flatMap((link) => link.anchorId === undefined ? [] : [link.anchorId]))].sort()
    const linkedSegmentIds = [...new Set(links.flatMap((link) =>
      link.relation.kind === 'segment' ? [link.relation.segmentId] : []))]
    const requiredness = links.reduce<ContextEvidenceLink['requiredness']>(
      (current, link) => REQUIREDNESS_RANK[link.requiredness] > REQUIREDNESS_RANK[current]
        ? link.requiredness
        : current,
      'optional',
    )
    const anchors = input.db.contextDocs.listAnchors(doc.id)
    mappingRevisions.push(...anchors.map((anchor) => JSON.stringify({
      contextDocId: doc.id,
      anchorId: anchor.id,
      locator: anchor.locator,
      mediaContextDocId: anchor.mediaContextDocId ?? null,
    })))
    if (links.length > 0) {
      const linkedAnchors = new Set(anchorIds)
      const dataRows = new Map<string, typeof anchors>()
      for (const anchor of anchors) {
        const row = anchor.locator.kind === 'sheet' && anchor.locator.rowKind === 'data'
          ? anchor.locator.row
          : anchor.locator.kind === 'image'
            ? anchor.locator.row
            : undefined
        const sheet = anchor.locator.kind === 'sheet' || anchor.locator.kind === 'image'
          ? anchor.locator.sheet
          : undefined
        if (sheet === undefined || row === undefined) continue
        const key = `${sheet}\u0000${row}`
        dataRows.set(key, [...(dataRows.get(key) ?? []), anchor])
      }
      for (const [key, rowAnchors] of dataRows) {
        if (rowAnchors.some((anchor) => linkedAnchors.has(anchor.id))) continue
        const [sheet, row] = key.split('\u0000')
        stageGaps.push({
          id: `gap_${hash([stageRunId, doc.id, sheet ?? '', row ?? '']).slice(0, 24)}`,
          code: 'UNMAPPED_CLIENT_VISIBLE_CONTENT',
          severity: 'warning',
          evidence: evidence.ref,
          summary: `${doc.originalFilename} 的 ${sheet} 第 ${row} 行未映射到本轮 CAT Segment`,
          suggestedAction: '向 PM 确认该行是漏包内容还是仅供参考；未经确认不要自行修改 CAT 主文件补段',
        })
      }
    }
    requirements.push({
      evidence: { ...evidence, version: input.db.contextDocs.evidenceVersion(doc.id, segmentIds, assetIds)! },
      purpose: anchors.some((anchor) => anchorIds.includes(anchor.id) && anchor.mediaContextDocId !== undefined)
        ? 'visual-fact'
        : 'client-feedback',
      requiredness,
      scope: linkedSegmentIds.length > 0
        ? { kind: 'segments', segmentIds: linkedSegmentIds }
        : { kind: 'stage' },
      anchorIds,
      rationale: links.length > 0
        ? 'Context anchor 已映射至冻结的 Asset 或 Segment 范围'
        : '已注册但尚未映射到本轮范围的 Context 资料',
    })
  }

  for (const evidence of input.discoveryScope.managedEvidence) {
    if (evidence.ref.kind === 'style-rule') {
      requirements.push({
        evidence,
        purpose: 'style',
        requiredness: 'conditional',
        scope: { kind: 'stage' },
        anchorIds: [],
        rationale: '项目 Style Guide 由 translation context 自动提供',
      })
    } else if (evidence.ref.kind === 'tech-constraint') {
      requirements.push({
        evidence,
        purpose: 'technical-constraint',
        requiredness: 'conditional',
        scope: { kind: 'stage' },
        anchorIds: [],
        rationale: '项目技术约束由既有 QA 与交付门禁共同执行',
      })
    } else if (evidence.ref.kind === 'reference-import') {
      requirements.push({
        evidence,
        purpose: 'terminology',
        requiredness: 'conditional',
        scope: { kind: 'stage' },
        anchorIds: [],
        rationale: 'TM/TB 在 Segment 匹配时按需提供',
      })
    } else if (evidence.ref.kind === 'voice-profile') {
      requirements.push({
        evidence,
        purpose: 'character-voice',
        requiredness: 'conditional',
        scope: { kind: 'stage' },
        anchorIds: [],
        rationale: '存在 speaker 上下文时按需提供 Voice Profile',
      })
    }
  }

  const plan: StageEvidencePlan = {
    stageRunId,
    role: role as StageEvidenceRole,
    stage: ROLE_STAGE[role],
    assetIds,
    segmentIds,
    requirements,
    ...(input.toolCallId === undefined ? {} : { startToolCallId: input.toolCallId }),
  }
  const ruleVersions = requirements
    .filter((item) => item.evidence.ref.kind === 'style-rule' || item.evidence.ref.kind === 'tech-constraint')
    .map((item) => `${refKey(item.evidence)}\u0000${item.evidence.version}`)
  let baseline = createStageEvidenceBaseline({
    stageRunId,
    discoveryScopeHash: hash(requirements.map(item => `${refKey(item.evidence)}:${item.evidence.version}`)),
    mappingRevision: hash(mappingRevisions),
    ruleSetRevision: hash(ruleVersions),
    segmentIds,
    evidence: requirements.map((item) => item.evidence),
  })
  if (existing !== undefined) {
    const sameBaseline = existing.baseline.baselineHash === baseline.baselineHash
    const restart = input.restart && (input.toolCallId === undefined || input.toolCallId !== existing.plan.startToolCallId)
    if (!restart && sameBaseline && existing.status !== 'stale' && existing.plan.decisionEventBoundary !== undefined) return existing
    if (sameScope && !sameBaseline && existing.status !== 'stale') {
      input.db.stageEvidence.markStale(existing.stageRunId, '本轮相关 Evidence、mapping 或规则已变化；需在新轮次重读并确认')
    }
    stageRunId = `stage:${randomUUID()}`
    plan.stageRunId = stageRunId
    baseline = createStageEvidenceBaseline({ ...baseline, stageRunId, segmentIds, evidence: requirements.map(item => item.evidence) })
    for (const gap of stageGaps) gap.id = `gap_${hash([stageRunId, gap.id]).slice(0, 24)}`
  }
  const state = input.db.stageEvidence.create({
    stageRunId,
    sessionId: input.session.id,
    plan,
    baseline,
  })
  input.db.stageEvidence.replaceStageGaps(stageRunId, stageGaps)
  return input.db.stageEvidence.get(stageRunId) ?? state
}
