import {
  createAsset,
  nativeStatusForStage,
  normalizeWorkflowStage,
  type QaFindingSeverity,
} from '@linguist/cat-core'
import { FormatUnsupportedError } from '@linguist/cat-formats'
import {
  stageAssetExport,
  StoreNotFoundError,
} from '@linguist/cat-store'
import {
  LinguistExportBlockedByQaError,
  LinguistImportTooLargeError,
  LinguistProjectArchivedError,
  mapStoreError,
} from './errors'
import { recordLinguistExportManifest } from './export-manifest'
import { buildDeliveryReport } from './project-delivery-report'
import type { ProjectModuleContext } from './project-module-context'
import { computeLinguistProjectRevision } from './project-revision'
import type {
  ImportAssetInput,
  ImportAssetResult,
  LinguistDeliveryBlocker,
  LinguistDeliveryPreflight,
  LinguistDeliveryQaSummary,
  LinguistDeliveryVerification,
  LinguistPreparedDelivery,
  LinguistStagedExport,
} from './project-service-types'

/** 导入体积上限：50MB。 */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024

/** 交付预检、确定性导出验证与源资产导入。 */
export class ProjectDelivery {
  constructor(private readonly context: ProjectModuleContext) {}

  /**
   * 先汇总提案、QA 与当前阶段；只有无阻断时才生成并重新导入验证。
   */
  async prepareDelivery(
    projectId: string,
    assetId: string,
  ): Promise<LinguistPreparedDelivery> {
    const project = this.context.getProject(projectId)
    if (project.archivedAt !== undefined) {
      throw new LinguistProjectArchivedError(projectId)
    }
    const db = this.context.openProject(projectId)
    const asset = this.context.call(() => db.assets.get(assetId), projectId)
    if (asset === undefined) throw new StoreNotFoundError('asset', assetId)

    const stageCounts = this.context.call(
      () => db.segments.countByAssetAndCurrentStageState().get(assetId) ?? {
        untouched: 0,
        draft: 0,
        confirmed: 0,
      },
      projectId,
    )
    const lockedSegments = this.context.call(
      () => db.segments.countLockedByAsset(assetId),
      projectId,
    )
    const unconfirmedUnlockedSegments = this.context.call(
      () => db.segments.countUnconfirmedUnlockedByAsset(assetId),
      projectId,
    )
    const pendingProposalCount = this.context.call(
      () => db.proposals.countPendingByAsset(assetId),
      projectId,
    )
    const bySeverity: Record<QaFindingSeverity, number> = {
      L0: this.context.call(
        () => db.qaFindings.count({
          assetId,
          status: 'open',
          severity: 'L0',
        }),
        projectId,
      ),
      L1: this.context.call(
        () => db.qaFindings.count({
          assetId,
          status: 'open',
          severity: 'L1',
        }),
        projectId,
      ),
      L2: this.context.call(
        () => db.qaFindings.count({
          assetId,
          status: 'open',
          severity: 'L2',
        }),
        projectId,
      ),
      L3: this.context.call(
        () => db.qaFindings.count({
          assetId,
          status: 'open',
          severity: 'L3',
        }),
        projectId,
      ),
      L4: this.context.call(
        () => db.qaFindings.count({
          assetId,
          status: 'open',
          severity: 'L4',
        }),
        projectId,
      ),
    }
    const qa: LinguistDeliveryQaSummary = {
      openErrors: bySeverity.L0 + bySeverity.L1,
      openWarnings: bySeverity.L2 + bySeverity.L3 + bySeverity.L4,
      waived: this.context.call(
        () => db.qaFindings.count({ assetId, status: 'waived' }),
        projectId,
      ),
      bySeverity,
    }
    const blockers: LinguistDeliveryBlocker[] = []
    if (pendingProposalCount > 0) {
      blockers.push({
        code: 'PENDING_PROPOSALS',
        count: pendingProposalCount,
        message: `仍有 ${pendingProposalCount} 条待处理提案`,
      })
    }
    if (unconfirmedUnlockedSegments > 0) {
      blockers.push({
        code: 'UNCONFIRMED_SEGMENTS',
        count: unconfirmedUnlockedSegments,
        message: `仍有 ${unconfirmedUnlockedSegments} 个可编辑句段未确认当前阶段`,
      })
    }
    if (qa.openErrors > 0) {
      blockers.push({
        code: 'OPEN_QA_ERRORS',
        count: qa.openErrors,
        message: `仍有 ${qa.openErrors} 条开放的阻断/严重 QA`,
      })
    }
    const workflowStage = normalizeWorkflowStage(project.workflowStage)
    const expectedNativeStatus = nativeStatusForStage(
      workflowStage,
      asset.formatId,
      project.outputStatusPolicy,
    )
    const preflight: LinguistDeliveryPreflight = {
      projectId,
      assetId,
      filename: asset.originalFilename,
      formatId: asset.formatId,
      workflowStage,
      ...(expectedNativeStatus !== undefined
        ? { expectedNativeStatus }
        : {}),
      segmentCount: asset.segmentCount,
      stageCounts,
      lockedSegments,
      unconfirmedUnlockedSegments,
      pendingProposalCount,
      qa,
      ready: blockers.length === 0,
      blockers,
    }
    if (!preflight.ready) {
      return {
        preflight,
        reportMarkdown: buildDeliveryReport(project, preflight),
      }
    }

    const staged = await this.stageExport(projectId, assetId)
    const verification: LinguistDeliveryVerification = {
      verifiedSegments: staged.verifiedSegments,
      ...staged.verification,
      sha256: staged.artifact.sha256,
      suggestedFilename: staged.suggestedFilename,
    }
    return {
      preflight,
      verification,
      reportMarkdown: buildDeliveryReport(
        project,
        preflight,
        verification,
      ),
      staged,
    }
  }

  /**
   * 只从 source blob 生成项目 exports/ staging；开放 L0/L1 Finding 时
   * fail closed，且不接受任何 bypass 参数。
   */
  async stageExport(
    projectId: string,
    assetId: string,
  ): Promise<LinguistStagedExport> {
    const project = this.context.getProject(projectId)
    if (project.archivedAt !== undefined) {
      throw new LinguistProjectArchivedError(projectId)
    }
    const db = this.context.openProject(projectId)
    const blocking = this.context.call(
      () => db.qaFindings.count({
        assetId,
        status: 'open',
        severity: 'L0',
      }) + db.qaFindings.count({
        assetId,
        status: 'open',
        severity: 'L1',
      }),
      projectId,
    )
    if (blocking > 0) {
      throw new LinguistExportBlockedByQaError(
        projectId,
        assetId,
        blocking,
      )
    }
    const asset = this.context.call(() => db.assets.get(assetId), projectId)
    if (asset === undefined) throw new StoreNotFoundError('asset', assetId)
    const adapter = this.context.registry.get(asset.formatId)
    if (adapter === undefined) {
      throw new FormatUnsupportedError(
        asset.formatId,
        this.context.registry.list().map((item) => item.id),
      )
    }
    try {
      const staged = await stageAssetExport({
        project,
        projectDir: this.context.getProjectPaths(projectId).projectDir,
        db,
        assetId,
        adapter,
      })
      recordLinguistExportManifest({
        exportsDir: this.context.getProjectPaths(projectId).exportsDir,
        stagingPath: staged.stagingPath,
        artifact: staged.artifact,
        projectRevision: computeLinguistProjectRevision(project, db),
      })
      return staged
    } catch (err) {
      throw mapStoreError(err, projectId)
    }
  }

  /**
   * bytes + filename → 格式探测 → 解析 → source blob → 单事务插入。
   * asset id 内容寻址，先落盘只可能留下可幂等覆盖的孤儿 blob。
   */
  async importAsset(
    projectId: string,
    input: ImportAssetInput,
  ): Promise<ImportAssetResult> {
    const project = this.context.getProject(projectId)
    if (project.archivedAt !== undefined) {
      throw new LinguistProjectArchivedError(projectId)
    }
    if (input.bytes.byteLength > MAX_IMPORT_BYTES) {
      throw new LinguistImportTooLargeError(
        input.bytes.byteLength,
        MAX_IMPORT_BYTES,
      )
    }
    const adapter = await this.context.registry.detectBest(
      input.bytes,
      input.filename,
    )
    const imported = await adapter.import({
      bytes: input.bytes,
      filename: input.filename,
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
    })
    const db = this.context.openProject(projectId)
    const assetPreview = createAsset({
      projectId: project.id,
      formatId: imported.asset.formatId,
      originalFilename: imported.asset.originalFilename,
      sourceSha256: imported.asset.sourceSha256,
      segmentCount: imported.asset.segmentCount,
    })
    this.context.call(
      () => db.saveAssetSourceForImport(assetPreview, input.bytes),
      projectId,
    )
    const { asset } = this.context.call(
      () => db.assets.insertImported(imported),
      projectId,
    )
    console.log(
      `[Linguist] 已导入资产: 项目 ${projectId} 资产 ${asset.id}（${adapter.id}，${imported.segments.length} 段，${imported.warnings.length} 警告）`,
    )
    return {
      assetId: asset.id,
      formatId: adapter.id,
      segmentCount: imported.segments.length,
      warnings: imported.warnings,
      sourceSha256: imported.asset.sourceSha256,
    }
  }
}
