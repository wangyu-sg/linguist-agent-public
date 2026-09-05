import {
  createAsset,
  DETERMINISTIC_HARD_RULE_CODES,
  nativeStatusForStage,
  normalizeWorkflowStage,
  runDeterministicHardRules,
  scanUnknownTagPatterns,
  type Asset,
  type LinguistProject,
  type UnknownTagPatternResult,
  type QaFindingSeverity,
  type WorkflowStage,
} from '@linguist/cat-core'
import {
  FormatExportError,
  FormatParseError,
  FormatUnsupportedError,
  PHRASE_MXLIFF_ADAPTER_ID,
  parsePhraseMxliffFormatConfig,
  probePhraseMasterPair,
  serializePhraseMxliffFormatConfig,
  parseXlsxFormatConfig,
  serializeXlsxFormatConfig,
  sha256Hex,
  XLSX_ADAPTER_ID,
} from '@linguist/cat-formats'
import {
  assetSourceFileName,
  stageAssetExport,
  StoreNotFoundError,
  type ProjectDatabase,
} from '@linguist/cat-store'
import { lstatSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  LinguistExportBlockedByQaError,
  LinguistImportTooLargeError,
  LinguistImportUndoBlockedError,
  LinguistImportVerificationFailedError,
  LinguistDeliveryNotReadyError,
  LinguistProjectArchivedError,
  mapStoreError,
} from './errors'
import {
  readLinguistExportManifests,
  recordLinguistExportManifest,
} from './export-manifest'
import { copyFileVerified, SecureExportError } from './secure-export'
import { buildDeliveryReport } from './project-delivery-report'
import type { ProjectModuleContext } from './project-module-context'
import { computeLinguistProjectRevision } from './project-revision'
import type {
  ImportAssetInput,
  ImportAssetResult,
  ImportUndoReferences,
  ImportVerificationCheck,
  ImportVerificationReport,
  LinguistDeliveryBlocker,
  LinguistDeliveryEvidenceSummary,
  LinguistDeliveryPreflight,
  LinguistDeliveryQaSummary,
  LinguistDeliveryVerification,
  LinguistLocalExportResult,
  LinguistPreparedDelivery,
  LinguistPreparedDeliverySaveResult,
  LinguistStagedExport,
  UndoImportAssetResult,
} from './project-service-types'

/** 导入体积上限：50MB。 */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024

const EXPORT_HARD_RULES = new Set<string>([
  DETERMINISTIC_HARD_RULE_CODES.INVALID_TARGET_ENCODING,
  DETERMINISTIC_HARD_RULE_CODES.PLACEHOLDER_SIGNATURE_MISMATCH,
  DETERMINISTIC_HARD_RULE_CODES.TAG_PLACEHOLDER_FAMILY_MISMATCH,
  DETERMINISTIC_HARD_RULE_CODES.TAG_SIGNATURE_MISMATCH,
  DETERMINISTIC_HARD_RULE_CODES.TAG_FAMILY_MISMATCH,
  DETERMINISTIC_HARD_RULE_CODES.TAG_PAIRING_MISMATCH,
  DETERMINISTIC_HARD_RULE_CODES.ICU_SYNTAX_INVALID,
  DETERMINISTIC_HARD_RULE_CODES.ICU_SIGNATURE_MISMATCH,
  DETERMINISTIC_HARD_RULE_CODES.REQUIRED_TERMINOLOGY_MISSING,
  DETERMINISTIC_HARD_RULE_CODES.FORBIDDEN_TERM_PRESENT,
])

export function summarizeDeliveryEvidence(
  db: ProjectDatabase,
  assetId: string,
  stage: WorkflowStage,
): LinguistDeliveryEvidenceSummary {
  const assetSegments = new Set(db.segments.queryIds({ assetId }))
  const claimed = new Set<string>()
  const completions = []
  for (const state of db.stageEvidence.list(stage)) {
    const ids = state.plan.segmentIds.filter(id => assetSegments.has(id) && !claimed.has(id))
    if (ids.length === 0) continue
    ids.forEach(id => claimed.add(id))
    completions.push(db.stageEvidence.getCompletion(state.stageRunId, ids))
  }
  if (completions.length === 0) {
    return { status: 'not-applicable', stageRuns: 0, required: 0, presented: 0, pending: 0, gaps: [] }
  }
  const gaps = new Map<string, LinguistDeliveryEvidenceSummary['gaps'][number]>()
  for (const completion of completions) {
    for (const gap of [...completion.blockingGaps, ...completion.warnings]) {
      gaps.set(gap.id, {
        code: gap.code,
        severity: gap.severity,
        summary: gap.summary,
        suggestedAction: gap.suggestedAction,
      })
    }
  }
  const statuses = completions.map((completion) => completion.status)
  return {
    status: statuses.includes('stale')
      ? 'stale'
      : statuses.includes('blocked')
        ? 'blocked'
        : statuses.includes('in_progress')
          ? 'in-progress'
          : 'complete',
    stageRuns: completions.length,
    required: completions.reduce((sum, item) => sum + item.presentation.required, 0),
    presented: completions.reduce((sum, item) => sum + item.presentation.presented, 0),
    pending: completions.reduce((sum, item) => sum + item.presentation.pending.length, 0),
    gaps: [...gaps.values()],
  }
}

/** 交付预检、确定性导出验证与源资产导入。 */
export class ProjectDelivery {
  constructor(private readonly context: ProjectModuleContext) {}

  private hardRuleFailures(
    project: LinguistProject,
    db: ProjectDatabase,
    asset: Asset,
  ): Array<{ segmentId: string; codes: string[] }> {
    return this.context.call(
      () => db.segments.query({ assetId: asset.id, limit: asset.segmentCount }).flatMap((segment) => {
        const terms = db.termEntries.evaluateSegment(segment).matches
        const codes = runDeterministicHardRules({
          segment,
          proposedTarget: segment.target,
          requiredTerminology: terms
            .filter((item) => item.enforcement === 'hard' && item.match.status === 'required')
            .map(({ match }) => ({
              sourceTerm: match.term,
              targetTerm: match.translation,
              caseSensitive: match.caseSensitive,
            })),
          forbiddenTerms: terms
            .filter((item) => item.enforcement === 'hard' && item.match.status === 'forbidden')
            .map(({ match }) => ({
              sourceTerm: match.term,
              term: match.translation,
              caseSensitive: match.caseSensitive,
            })),
          ...(project.tagProfile === undefined ? {} : { tagProfile: project.tagProfile }),
        }).violations
          .map((violation) => violation.code)
          .filter((code) => EXPORT_HARD_RULES.has(code))
        return codes.length === 0 ? [] : [{ segmentId: segment.id, codes }]
      }),
      project.id,
    )
  }

  /**
   * 先汇总提案、QA 与当前阶段；只有无阻断时才生成并重新导入验证。
   */
  async prepareDelivery(
    projectId: string,
    assetId: string,
    validation: 'verified' | 'as-is' = 'verified',
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
    if (asset.formatId === PHRASE_MXLIFF_ADAPTER_ID) {
      const config = parsePhraseMxliffFormatConfig(asset.formatConfigJson, asset.originalFilename)
      const missingMappings = config === undefined
        ? this.context.call(
            () => db.segments.query({ assetId, limit: asset.segmentCount })
              .filter((segment) => /\{\d+\}|\{\d+>\}|<\d+\}/.test(segment.source)).length,
            projectId,
          )
        : config.unmatchedSegments + config.ambiguousSegments
      if (missingMappings > 0) {
        blockers.push({
          code: 'PHRASE_MASTER_MAPPING',
          count: missingMappings,
          message: `Phrase master Tag Mapping 缺失或不唯一：${missingMappings} 段`,
        })
      }
    }
    const hardRuleFailures = this.hardRuleFailures(project, db, asset)
    if (hardRuleFailures.length > 0) {
      const examples = hardRuleFailures
        .slice(0, 3)
        .map((failure) => `${failure.segmentId}: ${failure.codes.join('/')}`)
        .join('；')
      blockers.push({
        code: 'STRUCTURAL_RULES',
        count: hardRuleFailures.length,
        message: `确定性硬规则未通过 ${hardRuleFailures.length} 段（${examples}）`,
      })
    }
    const workflowStage = normalizeWorkflowStage(project.workflowStage)
    const evidence = this.context.call(
      () => summarizeDeliveryEvidence(db, assetId, workflowStage),
      projectId,
    )
    const blockingEvidenceGaps = evidence.gaps.filter((gap) => gap.severity === 'blocking').length
    if (evidence.status === 'stale') {
      blockers.push({
        code: 'EVIDENCE_STAGE_STALE',
        count: 1,
        message: '本轮参考资料、映射、规则或授权范围已变化，请刷新后重新确认',
      })
    }
    if (evidence.pending > 0) {
      blockers.push({
        code: 'EVIDENCE_REQUIRED_PENDING',
        count: evidence.pending,
        message: `仍有 ${evidence.pending} 项已声明必需的证据尚未进入模型请求`,
      })
    }
    if (blockingEvidenceGaps > 0) {
      blockers.push({
        code: 'EVIDENCE_BLOCKING_GAPS',
        count: blockingEvidenceGaps,
        message: `仍有 ${blockingEvidenceGaps} 项显式阻断的证据缺口`,
      })
    }
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
      evidence,
      ready: blockers.length === 0,
      blockers,
    }
    if (!preflight.ready && validation === 'verified') {
      return {
        validation,
        preflight,
        reportMarkdown: buildDeliveryReport(project, preflight),
      }
    }

    const staged = await this.stageExport(
      projectId,
      assetId,
      validation === 'as-is'
        ? { allowBlockingQa: true, allowHardRuleViolations: true, validation }
        : { validation },
    )
    const verification: LinguistDeliveryVerification = {
      verifiedSegments: staged.verifiedSegments,
      ...staged.verification,
      sha256: staged.artifact.sha256,
      suggestedFilename: staged.suggestedFilename,
    }
    return {
      validation,
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

  async exportAssetToPath(
    projectId: string,
    assetId: string,
    destinationPath: string,
    mode: 'verified' | 'as-is',
    overwrite: boolean,
  ): Promise<LinguistLocalExportResult> {
    const prepared = await this.prepareDelivery(projectId, assetId, mode)
    if (prepared.staged === undefined) {
      throw new FormatExportError(
        prepared.preflight.formatId,
        prepared.preflight.blockers
          .map((blocker) => `${blocker.code}: ${blocker.message}`)
          .join('; '),
      )
    }
    const { artifact: _, projectRevision: __, ...result } = this.savePreparedDeliveryToPath(
      prepared,
      destinationPath,
      overwrite,
    )
    return result
  }

  savePreparedDeliveryToPath(
    prepared: LinguistPreparedDelivery,
    destinationPath: string,
    overwrite = false,
  ): LinguistPreparedDeliverySaveResult {
    const { validation, preflight, staged, verification } = prepared
    if (staged === undefined || verification === undefined) {
      if (preflight.qa.openErrors > 0) {
        throw new LinguistExportBlockedByQaError(
          preflight.projectId,
          preflight.assetId,
          preflight.qa.openErrors,
        )
      }
      throw new LinguistDeliveryNotReadyError(
        preflight.projectId,
        preflight.assetId,
        preflight.blockers.length,
      )
    }
    return this.saveStagedDeliveryToPath(
      preflight.projectId,
      preflight.assetId,
      staged,
      destinationPath,
      validation,
      overwrite,
    )
  }

  private saveStagedDeliveryToPath(
    projectId: string,
    assetId: string,
    staged: LinguistStagedExport,
    destinationPath: string,
    mode: 'verified' | 'as-is',
    overwrite: boolean,
  ): LinguistPreparedDeliverySaveResult {
    const manifest = readLinguistExportManifests(
      this.context.getProjectPaths(projectId).exportsDir,
    ).get(staged.artifact.id)
    const stagedFile = lstatSync(staged.stagingPath, { throwIfNoEntry: false })
    if (
      stagedFile === undefined
      || stagedFile.isSymbolicLink()
      || !stagedFile.isFile()
    ) {
      throw new SecureExportError('导出源文件不可用或是符号链接')
    }
    if (
      manifest === undefined
      || manifest.sha256 !== staged.artifact.sha256
      || manifest.assetId !== staged.artifact.assetId
      || manifest.sizeBytes !== stagedFile.size
      || staged.artifact.assetId !== assetId
    ) {
      throw new SecureExportError('导出审计清单不可用，请重新生成交付物')
    }
    return {
      filename: basename(destinationPath),
      artifact: staged.artifact,
      ...copyFileVerified({
        managedRoot: this.context.rootDir,
        sourcePath: staged.stagingPath,
        destinationPath,
        expectedSha256: staged.artifact.sha256,
        overwrite,
      }),
      projectRevision: manifest.projectRevision,
      verifiedSegments: staged.verifiedSegments,
      mode,
    }
  }

  /**
   * 只从 source blob 生成项目 exports/ staging；开放 L0/L1 Finding 时
   * fail closed，且不接受任何 bypass 参数。
   */
  async stageExport(
    projectId: string,
    assetId: string,
    options: {
      allowBlockingQa?: boolean
      allowHardRuleViolations?: boolean
      validation?: 'verified' | 'as-is'
    } = {},
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
    if (blocking > 0 && options.allowBlockingQa !== true) {
      throw new LinguistExportBlockedByQaError(
        projectId,
        assetId,
        blocking,
      )
    }
    const asset = this.context.call(() => db.assets.get(assetId), projectId)
    if (asset === undefined) throw new StoreNotFoundError('asset', assetId)
    if (options.allowHardRuleViolations !== true) {
      const failures = this.hardRuleFailures(project, db, asset)
      if (failures.length > 0) {
        throw new FormatExportError(asset.formatId, `${failures.length} segments failed deterministic hard rules`)
      }
    }
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
        validation: options.validation ?? 'verified',
        evidence: summarizeDeliveryEvidence(db, assetId, normalizeWorkflowStage(project.workflowStage)),
      })
      return staged
    } catch (err) {
      throw mapStoreError(err, projectId)
    }
  }

  /**
   * bytes + filename → 格式探测 → 解析 → source blob → 单事务插入 +
   * 同事务回读验证（LA-INTAKE-007：段数/格式/语言对/source hash 任一项
   * 失败即抛 IMPORT_VERIFICATION_FAILED，整批回滚）。
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
    // 重复检测之前也先要求映射：否则同字节 XLSX 会绕过显式授权边界。
    if (adapter.id === XLSX_ADAPTER_ID && input.xlsxMapping === undefined) {
      throw new FormatParseError(
        XLSX_ADAPTER_ID,
        input.filename,
        'XLSX imports require an explicit sheet and source/target column mapping confirmation',
      )
    }
    if (adapter.id !== XLSX_ADAPTER_ID && input.xlsxMapping !== undefined) {
      throw new FormatParseError(adapter.id, input.filename, 'an XLSX mapping was supplied for a non-XLSX file')
    }
    let formatConfigJson = input.xlsxMapping === undefined
      ? undefined
      : serializeXlsxFormatConfig({
          version: 1,
          sheetName: input.xlsxMapping.sheetName,
          columns: input.xlsxMapping.columns,
        })
    if (formatConfigJson !== undefined) parseXlsxFormatConfig(formatConfigJson, input.filename)
    if (input.phraseMaster !== undefined) {
      if (adapter.id !== PHRASE_MXLIFF_ADAPTER_ID) {
        throw new FormatParseError(adapter.id, input.filename, 'a Phrase master companion was supplied for a non-Phrase file')
      }
      const probe = await probePhraseMasterPair(
        input.bytes,
        input.filename,
        input.phraseMaster.bytes,
        input.phraseMaster.filename,
      )
      if (probe.config.placeholderSegments > 0 && probe.config.matchedSegments === 0) {
        throw new FormatParseError(adapter.id, input.filename, 'Phrase master companion matched none of the split placeholder segments')
      }
      formatConfigJson = serializePhraseMxliffFormatConfig(probe.config)
    }
    const sourceSha256 = sha256Hex(input.bytes)
    const db = this.context.openProject(projectId)
    // ponytail: O(n) scan is enough for the current single-file Alpha; add an indexed lookup with batch intake.
    const duplicate = this.context.call(
      () => db.assets.listByProject().find((asset) => asset.sourceSha256 === sourceSha256),
      projectId,
    )
    if (duplicate !== undefined) {
      if (duplicate.formatConfigJson !== formatConfigJson) {
        throw new FormatParseError(
          adapter.id,
          input.filename,
          'source bytes are already imported with a different mapping; undo the existing batch before importing with a new mapping',
        )
      }
      console.log(
        `[Linguist] 跳过项目内重复资产: 项目 ${projectId} 资产 ${duplicate.id}`,
      )
      // 重复跳过零写入：回读验证仍跑一遍并随结果带回（只读；不抛——
      // 本调用没有可回滚的写入，既有批次的问题由健康检查/完整性扫描负责）。
      const verification = this.context.call(
        () => this.verifyImport(db, project, duplicate, duplicate.segmentCount),
        projectId,
      )
      return {
        status: 'skipped-duplicate',
        assetId: duplicate.id,
        formatId: duplicate.formatId,
        segmentCount: duplicate.segmentCount,
        warnings: [],
        sourceSha256,
        verification,
        unknownTagSummary: [],
      }
    }
    const imported = await adapter.import({
      bytes: input.bytes,
      filename: input.filename,
      sourceLocale: project.sourceLocale,
      targetLocale: project.targetLocale,
      ...(formatConfigJson === undefined ? {} : { formatConfigJson }),
    })
    const assetPreview = createAsset({
      projectId: project.id,
      formatId: imported.asset.formatId,
      originalFilename: imported.asset.originalFilename,
      sourceSha256: imported.asset.sourceSha256,
      segmentCount: imported.asset.segmentCount,
      ...(imported.asset.formatConfigJson === undefined
        ? {}
        : { formatConfigJson: imported.asset.formatConfigJson }),
    })
    this.context.call(
      () => db.saveAssetSourceForImport(assetPreview, input.bytes),
      projectId,
    )
    // 插入 + 回读验证同一事务：验证失败抛 typed error，整批回滚，
    // 项目内绝不留「半个批次」（崩溃窗口只留可幂等覆盖的孤儿 blob）。
    const { asset, verification } = this.context.call(
      () =>
        db.catDb.transaction(`import + verify asset`, () => {
          const inserted = db.assets.insertImported(imported)
          const report = this.verifyImport(
            db,
            project,
            inserted.asset,
            inserted.segments.length,
          )
          if (!report.ok) {
            throw new LinguistImportVerificationFailedError(
              projectId,
              report.checks.filter((check) => !check.passed).map((check) => check.id),
            )
          }
          return { asset: inserted.asset, verification: report }
        }),
      projectId,
    )
    console.log(
      `[Linguist] 已导入资产: 项目 ${projectId} 资产 ${asset.id}（${adapter.id}，${imported.segments.length} 段，${imported.warnings.length} 警告）`,
    )
    const unknownTagSummary = await this.scanImportedAsset(db, project, asset)
    return {
      status: 'imported',
      assetId: asset.id,
      formatId: adapter.id,
      segmentCount: imported.segments.length,
      warnings: imported.warnings,
      sourceSha256: imported.asset.sourceSha256,
      verification,
      unknownTagSummary,
    }
  }

  private async scanImportedAsset(
    db: ProjectDatabase,
    project: LinguistProject,
    asset: Asset,
  ): Promise<UnknownTagPatternResult[]> {
    const samples: Array<{ id: string; source: string; target: string }> = []
    const pageSize = 1_000
    for (let offset = 0; offset < asset.segmentCount; offset += pageSize) {
      samples.push(...db.segments.query({ assetId: asset.id, offset, limit: pageSize }).map((segment) => ({
        id: segment.id as string,
        source: segment.source,
        target: segment.target,
      })))
      if (offset + pageSize < asset.segmentCount) await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return scanUnknownTagPatterns(samples, project.tagProfile)
  }

  /**
   * LA-INTAKE-007 导入回读验证（调用方负责放进插入同事务）：
   * 段数 / 格式 / 语言对 / source hash 逐项 passed/failed。
   * detail 只含计数、哈希与格式 id，绝无客户文本。
   */
  private verifyImport(
    db: ProjectDatabase,
    project: LinguistProject,
    asset: Asset,
    importedSegmentCount: number,
  ): ImportVerificationReport {
    const checks: ImportVerificationCheck[] = []
    // 段数：回读 COUNT 与插入批次、资产行一致
    const storedSegments = db.segments.count({ assetId: asset.id })
    checks.push({
      id: 'segment-count',
      passed: storedSegments === importedSegmentCount && asset.segmentCount === importedSegmentCount,
      detail: `expected=${importedSegmentCount} stored=${storedSegments} declared=${asset.segmentCount}`,
    })
    // 格式：资产行 formatId 与探测 adapter 推导一致
    const storedAsset = db.assets.get(asset.id)
    checks.push({
      id: 'format',
      passed: storedAsset?.formatId === asset.formatId,
      detail: `expected=${asset.formatId} stored=${storedAsset?.formatId ?? 'missing'}`,
    })
    // 语言对：库内不存在与项目语言对不一致的段（聚合 COUNT，不加载段行）
    const mismatched = db.segments.countMismatchedLocalesByAsset(
      asset.id,
      project.sourceLocale,
      project.targetLocale,
    )
    checks.push({
      id: 'language-pair',
      passed: mismatched === 0,
      detail: `mismatched=${mismatched}`,
    })
    // source hash：回读 source blob，sha256 与资产行一致
    let sourceHashPassed = false
    let sourceHashDetail = 'blob-missing'
    try {
      const actual = sha256Hex(db.readAssetSource(asset.id))
      sourceHashPassed = actual === asset.sourceSha256
      sourceHashDetail = sourceHashPassed
        ? 'match'
        : `expected=${asset.sourceSha256} actual=${actual}`
    } catch {
      // blob 缺失或 mismatch（StoreNotFoundError / StoreAssetSourceMismatchError）
      // 统一记为失败检查项；回滚由调用方抛出 typed error 触发
    }
    checks.push({ id: 'source-hash', passed: sourceHashPassed, detail: sourceHashDetail })
    return { ok: checks.every((check) => check.passed), checks }
  }

  /**
   * LA-INTAKE-007 撤销一次导入。先查下游引用（Proposal / QA / 历史评审件 /
   * 导出 / 人工编辑痕迹 / durable job），任一非零即抛 IMPORT_UNDO_BLOCKED（detail 只含
   * 计数）；全零 → 单事务删行 → 再删 source blob（文件删除失败只留可
   * 幂等覆盖的孤儿 blob，与导入崩溃窗口同语义）。归档项目 fail closed。
   */
  undoImportAsset(projectId: string, assetId: string): UndoImportAssetResult {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    const asset = this.context.call(() => db.assets.get(assetId), projectId)
    if (asset === undefined) throw new StoreNotFoundError('asset', assetId)

    const references: ImportUndoReferences = {
      proposals: this.context.call(() => db.proposals.countByAsset(assetId), projectId),
      qaFindings: this.context.call(() => db.qaFindings.count({ assetId }), projectId),
      legacyCriticArtifacts: this.context.call(() => db.legacyCriticArtifacts.countByAsset(assetId), projectId),
      exports: this.context.call(() => db.exports.listByAsset(assetId).length, projectId),
      editedSegments: this.context.call(() => db.segments.countEditedByAsset(assetId), projectId),
      jobs: this.context.call(() => db.runs.countReferencingAsset(assetId), projectId),
    }
    if (Object.values(references).some((count) => count > 0)) {
      throw new LinguistImportUndoBlockedError(projectId, assetId, references)
    }

    const deletedSegments = this.context.call(() => {
      const count = db.segments.count({ assetId })
      db.assets.deleteWithSegments(assetId)
      return count
    }, projectId)

    // source blob 在行删除之后清尾；失败只留孤儿 blob（健康检查不扫、
    // 重导入幂等覆盖），绝不阻碍已完成的行级撤销
    let sourceBlobRemoved = false
    try {
      rmSync(join(db.sourceDir, assetSourceFileName(asset)), { force: true })
      sourceBlobRemoved = true
    } catch {
      console.warn(`[Linguist] 撤销导入的 source blob 清尾失败（留孤儿 blob）: 项目 ${projectId} 资产 ${assetId}`)
    }
    console.log(`[Linguist] 已撤销导入: 项目 ${projectId} 资产 ${assetId}（${deletedSegments} 段）`)
    return { assetId, deletedSegments, sourceBlobRemoved }
  }
}
