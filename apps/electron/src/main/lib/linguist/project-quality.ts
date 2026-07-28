import {
  InvalidStateTransitionError,
  normalizeQaProfile,
  UnknownSegmentError,
  type QaFindingDisposition,
  type QaFindingSeverity,
  type Segment,
} from '@linguist/cat-core'
import {
  runProjectQa,
  StoreNotFoundError,
  type PersistedQaFinding,
  type ProjectDatabase,
} from '@linguist/cat-store'
import {
  errorCodeOf,
  LinguistProjectArchivedError,
} from './errors'
import type { ProjectModuleContext } from './project-module-context'
import type {
  CatQaFinding,
  CatSegmentContext,
  CatWorkspacePage,
  CatWorkspaceQuery,
  StageMutationBatchResult,
  StageMutationFailure,
  StageMutationItem,
} from './project-service-types'

/**
 * CAT 工作台质量模块：查询、人工编辑/阶段确认与确定性 QA。
 *
 * 模型提案不在这里落盘；所有状态推进仍走 store 的 CAS 与人工动作。
 */
export class ProjectQuality {
  constructor(private readonly context: ProjectModuleContext) {}

  /** CAT Workspace：资产元数据 + 同过滤条件下的分页句段与 COUNT。 */
  queryCatWorkspace(
    projectId: string,
    query: CatWorkspaceQuery,
  ): CatWorkspacePage {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    const filter = {
      assetId: query.assetId,
      status: query.status,
      currentStageState: query.currentStageState,
      search: query.search,
    }
    return this.context.call(
      () => ({
        assets: db.assets.listByProject(),
        segments: db.segments.query({
          ...filter,
          limit: query.limit,
          offset: query.offset,
        }),
        total: db.segments.count(filter),
        segmentIds: query.includeIndex
          ? db.segments.queryIds(filter)
          : [],
      }),
      projectId,
    )
  }

  /** Context Rail：按 opaque id 读取稳定详情，不依赖虚拟 Grid 当前窗口。 */
  getSegmentContext(
    projectId: string,
    segmentId: string,
  ): CatSegmentContext {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const segment = db.segments.getById(segmentId)
      if (segment === undefined) throw new UnknownSegmentError(segmentId)
      const pendingProposal = db.proposals
        .listBySegment(segmentId, 'pending')
        .at(-1)
      return {
        segment,
        ...(pendingProposal !== undefined ? { pendingProposal } : {}),
        tmMatches: db.tmUnits.findMatches({
          source: segment.source,
          sourceLocale: segment.sourceLocale,
          targetLocale: segment.targetLocale,
          threshold: 0.6,
          limit: 5,
        }),
        termMatches: db.termEntries.findMatches({
          text: segment.source,
          limit: 10,
        }),
        stageEvents: db.segments.listStageEvents(segmentId),
        qaFindings: db.qaFindings.list({ segmentId }).map((finding) => ({
          id: finding.id,
          segmentId: finding.segmentId,
          code: finding.code,
          severity: finding.severity,
          issueType: finding.issueType,
          disposition: finding.disposition,
          message: finding.message,
          status: finding.status,
          segmentRevision: finding.segmentRevision,
          currentRevision: segment.revision,
          ...(finding.waiverReason !== undefined
            ? { waiverReason: finding.waiverReason }
            : {}),
        })),
      }
    }, projectId)
  }

  /**
   * 重跑确定性 QA，只替换 open Finding，不改 Segment。
   * forbidden 术语仍为 L1 阻断，preferred 偏离按项目策略定级。
   */
  runQa(projectId: string): CatQaFinding[] {
    const project = this.context.getProject(projectId)
    if (project.archivedAt !== undefined) {
      throw new LinguistProjectArchivedError(projectId)
    }
    const db = this.context.openProject(projectId)
    return this.context.call(
      () => this.toQaFindings(db, runProjectQa(db, {
        glossaryPolicy: project.glossaryPolicy,
        profile: normalizeQaProfile(project.qaProfile),
        ...(project.tagProfile !== undefined
          ? { tagProfile: project.tagProfile }
          : {}),
      })),
      projectId,
    )
  }

  /** Finding 始终携带句段当前 revision，供人工审核界面判定陈旧状态。 */
  listQaFindings(
    projectId: string,
    filter: {
      segmentId?: string
      code?: string
      status?: 'open' | 'resolved' | 'waived'
      severity?: QaFindingSeverity
      disposition?: QaFindingDisposition
      limit?: number
      offset?: number
    } = {},
  ): { items: CatQaFinding[]; total: number } {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => ({
      items: this.toQaFindings(db, db.qaFindings.list(filter)),
      total: db.qaFindings.count(filter),
    }), projectId)
  }

  /** 人工 only：必须先发生译文编辑，才能解决该轮 Finding。 */
  resolveQaFinding(
    projectId: string,
    findingId: string,
  ): CatQaFinding {
    const project = this.context.getProject(projectId)
    if (project.archivedAt !== undefined) {
      throw new LinguistProjectArchivedError(projectId)
    }
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const finding = db.qaFindings.getById(findingId)
      if (finding === undefined) {
        throw new StoreNotFoundError('qa finding', findingId)
      }
      const segment = db.segments.getById(finding.segmentId)
      if (segment === undefined) {
        throw new UnknownSegmentError(finding.segmentId)
      }
      if (segment.revision <= finding.segmentRevision) {
        throw new InvalidStateTransitionError(
          'qa-finding',
          finding.status,
          'resolved-before-edit',
        )
      }
      return this.toQaFindings(
        db,
        [db.qaFindings.transition(finding.id, 'resolved')],
      )[0]!
    }, projectId)
  }

  /** 人工 only：豁免必须持久化原因、操作者与时间。 */
  waiveQaFinding(
    projectId: string,
    findingId: string,
    reason: string,
    operator: string,
  ): CatQaFinding {
    const project = this.context.getProject(projectId)
    if (project.archivedAt !== undefined) {
      throw new LinguistProjectArchivedError(projectId)
    }
    const db = this.context.openProject(projectId)
    return this.context.call(
      () => this.toQaFindings(db, [
        db.qaFindings.transition(findingId, 'waived', {
          reason,
          operator,
          at: this.context.now(),
        }),
      ])[0]!,
      projectId,
    )
  }

  /** 人工 only：按精确 Finding ID 原子批量豁免。 */
  waiveQaFindings(
    projectId: string,
    findingIds: readonly string[],
    reason: string,
    operator: string,
  ): CatQaFinding[] {
    const project = this.context.getProject(projectId)
    if (project.archivedAt !== undefined) {
      throw new LinguistProjectArchivedError(projectId)
    }
    const db = this.context.openProject(projectId)
    return this.context.call(
      () => this.toQaFindings(
        db,
        db.qaFindings.waiveMany(findingIds, {
          reason,
          operator,
          at: this.context.now(),
        }),
      ),
      projectId,
    )
  }

  /** 人工译文编辑：内容写入只走 Repository 的 CAS 事务。 */
  editSegment(
    projectId: string,
    segmentId: string,
    target: string,
    expectedRevision: number,
  ): Segment {
    const project = this.context.getProject(projectId)
    if (project.archivedAt !== undefined) {
      throw new LinguistProjectArchivedError(projectId)
    }
    const db = this.context.openProject(projectId)
    return this.context.call(
      () => db.segments.applyTargetEdit(
        segmentId,
        target,
        expectedRevision,
        {
          source: 'human',
          now: this.context.now(),
        },
      ).segment,
      projectId,
    )
  }

  /** 人工确认当前 T/E/P 阶段；CAS 失败不会前进或覆盖。 */
  confirmCurrentStage(
    projectId: string,
    segmentId: string,
    expectedRevision: number,
  ): Segment {
    this.context.assertProjectWritable(projectId)
    const project = this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(
      () => db.segments.confirmCurrentStage(
        segmentId,
        project.workflowStage ?? 'translation',
        expectedRevision,
        {
          actor: 'local-user',
          now: this.context.now(),
        },
      ).segment,
      projectId,
    )
  }

  /** 人工撤销当前阶段确认；保留目标和历史事件。 */
  unconfirmCurrentStage(
    projectId: string,
    segmentId: string,
    expectedRevision: number,
  ): Segment {
    this.context.assertProjectWritable(projectId)
    const project = this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(
      () => db.segments.unconfirmCurrentStage(
        segmentId,
        project.workflowStage ?? 'translation',
        expectedRevision,
        {
          actor: 'local-user',
          now: this.context.now(),
        },
      ).segment,
      projectId,
    )
  }

  /** 批量确认逐条返回结果；部分失败永不伪装成全量成功。 */
  confirmCurrentStageBulk(
    projectId: string,
    items: readonly StageMutationItem[],
  ): StageMutationBatchResult {
    this.context.assertProjectWritable(projectId)
    const project = this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    const succeeded: Segment[] = []
    const failed: StageMutationFailure[] = []
    const seen = new Set<string>()
    for (const item of items) {
      if (seen.has(item.segmentId)) {
        failed.push({
          segmentId: item.segmentId,
          code: 'DUPLICATE_SEGMENT',
          message: '同一批次不能重复确认同一句段',
        })
        continue
      }
      seen.add(item.segmentId)
      try {
        succeeded.push(db.segments.confirmCurrentStage(
          item.segmentId,
          project.workflowStage ?? 'translation',
          item.expectedRevision,
          {
            actor: 'local-user',
            now: this.context.now(),
          },
        ).segment)
      } catch (error) {
        failed.push({
          segmentId: item.segmentId,
          code: errorCodeOf(error),
          message: error instanceof Error
            ? error.message
            : '阶段确认失败',
        })
      }
    }
    return { succeeded, failed }
  }

  private toQaFindings(
    db: ProjectDatabase,
    findings: readonly PersistedQaFinding[],
  ): CatQaFinding[] {
    return findings.flatMap((finding) => {
      const segment = db.segments.getById(finding.segmentId)
      if (segment === undefined) return []
      return [{
        id: finding.id,
        segmentId: finding.segmentId,
        code: finding.code,
        severity: finding.severity,
        issueType: finding.issueType,
        disposition: finding.disposition,
        message: finding.message,
        status: finding.status,
        segmentRevision: finding.segmentRevision,
        currentRevision: segment.revision,
        ...(finding.waiverReason !== undefined
          ? { waiverReason: finding.waiverReason }
          : {}),
        ...(finding.waivedBy !== undefined
          ? { waivedBy: finding.waivedBy }
          : {}),
        ...(finding.waivedAt !== undefined
          ? { waivedAt: finding.waivedAt }
          : {}),
      }]
    })
  }
}
