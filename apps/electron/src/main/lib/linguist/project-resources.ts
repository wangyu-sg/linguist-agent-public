import { existsSync, realpathSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import type { ContextAnchorLocator } from '@linguist/cat-core'
import {
  assetSourceFileName,
  removeProjectBlob,
  saveProjectBlob,
  StoreNotFoundError,
  type ContextDoc,
  type ReferenceImport,
  type SentencePattern,
  type SentencePatternUpsertInput,
  type StyleGuideRule,
  type StyleGuideRuleUpsertInput,
  type TechConstraint,
  type TechConstraintUpsertInput,
  type TermEntryImportInput,
  type TermEntryConflict,
  type TermEntryUpsertInput,
  type TermMatchOptions,
  type TermValidationResult,
  type TmUnitImportInput,
  type VoiceProfile,
  type VoiceProfileUpsertInput,
} from '@linguist/cat-store'
import { extractContext, formatContextExtractionText } from './context-extractor'
import type { ProjectModuleContext } from './project-module-context'
import {
  isContextDocImageExtension,
  parseSentencePatternReference,
  parseTermReference,
  parseTmReference,
} from './project-resource-parsers'
import type {
  ImportContextDocInput,
  ImportReferenceInput,
  ImportReferenceResult,
  LinguistProjectAssetKind,
  LinguistReferenceKind,
  ProjectAssetInfo,
  ProjectAssetsQuery,
  ReferenceImportQueryPage,
  ReferenceQuery,
  ReferenceQueryPage,
  TermReferenceInfo,
  TmReferenceInfo,
} from './project-service-types'

/** 解析项目 blobs/ 下的受管文件；符号链接/路径穿越一律拒绝。 */
function resolveManagedBlobPath(blobsDir: string, blobRelpath: string): string | undefined {
  try {
    const blobsRoot = realpathSync(blobsDir)
    const target = realpathSync(
      resolve(blobsRoot, blobRelpath.replace(/^blobs\//, '')),
    )
    if (target === blobsRoot || !target.startsWith(blobsRoot + sep)) return undefined
    return statSync(target).isFile() ? target : undefined
  } catch {
    return undefined
  }
}

/**
 * 项目参考资料与语言资产模块。
 *
 * 只负责 TM/TB、风格/句式/上下文文档等资源行为；项目句柄与归档守卫由
 * 外层服务提供，确保拆分不产生第二套生命周期。
 */
export class ProjectResources {
  constructor(private readonly context: ProjectModuleContext) {}

  /** TM 管理列表仍保留原有 source/target literal concordance 语义。 */
  queryTmReferences(
    projectId: string,
    query: ReferenceQuery,
  ): ReferenceImportQueryPage<TmReferenceInfo> {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const items = db.tmUnits.list(query)
      const total = db.tmUnits.count(query)
      return {
        items,
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + items.length < total,
        imports: db.referenceImports.list('tm'),
      }
    }, projectId)
  }

  queryTermReferences(
    projectId: string,
    query: ReferenceQuery,
  ): ReferenceImportQueryPage<TermReferenceInfo> {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const items = db.termEntries.list(query)
      const total = db.termEntries.count(query)
      return {
        items,
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + items.length < total,
        imports: db.referenceImports.list('terms'),
      }
    }, projectId)
  }

  /**
   * 全文件解析/验证完成后才写入。原件只落一份受管 blobs/ 文件，再在同一
   * SQLite 事务内登记来源和导入所有行；失败时 DB 回滚且新 blob 清尾。
   */
  async importReference(
    projectId: string,
    kind: LinguistReferenceKind,
    input: ImportReferenceInput,
  ): Promise<ImportReferenceResult> {
    this.context.assertProjectWritable(projectId)
    const project = this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    const parsed = kind === 'tm'
      ? await parseTmReference(input, project.sourceLocale, project.targetLocale)
      : await parseTermReference(input, project.sourceLocale, project.targetLocale)
    return this.context.call(() => {
      const sourceSha256 = sha256Hex(input.bytes)
      const blobName = `ref-${sourceSha256}`
      const blobRelpath = `blobs/${blobName}`
      const blobExisted = existsSync(join(db.blobsDir, blobName))
      saveProjectBlob(db.blobsDir, blobName, input.bytes)
      let source: ReferenceImport
      let result: { imported: number; unchanged: number }
      try {
        ({ source, result } = db.catDb.transaction(`import ${kind} reference source`, () => ({
          source: db.referenceImports.insert({
            kind,
            originalFilename: input.filename,
            sourceSha256,
            blobRelpath,
          }),
          result: kind === 'tm'
            ? db.tmUnits.importMany(parsed.entries as TmUnitImportInput[])
            : db.termEntries.importMany(parsed.entries as TermEntryImportInput[]),
        })))
      } catch (error) {
        // 只清理本次新建的 blob；既有同 hash blob 可能仍被另一来源引用。
        if (!blobExisted) removeProjectBlob(db.blobsDir, blobName)
        throw error
      }
      console.log(
        `[Linguist] 已导入 ${kind === 'tm' ? 'TM' : '术语库'}: 项目 ${projectId}（${result.imported} 新增，${result.unchanged} 未变）`,
      )
      return { ...result, warnings: parsed.warnings, source }
    }, projectId)
  }

  upsertTermReference(
    projectId: string,
    input: TermEntryUpsertInput,
  ): TermReferenceInfo {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => db.termEntries.upsert(input), projectId)
  }

  upsertTermReferences(projectId: string, inputs: readonly TermEntryUpsertInput[]): TermReferenceInfo[] {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => db.catDb.transaction('upsert terminology batch', () =>
      inputs.map((input) => db.termEntries.upsert(input))), projectId)
  }

  deleteTermReferences(projectId: string, ids: readonly string[]): void {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    this.context.call(() => db.catDb.transaction('delete terminology batch', () => {
      for (const id of ids) db.termEntries.delete(id)
    }), projectId)
  }

  listTermConflicts(
    projectId: string,
    options: Pick<TermMatchOptions, 'statuses' | 'module' | 'category'>,
  ): TermEntryConflict[] {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => db.termEntries.listConflicts(options), projectId)
  }

  validateTerms(projectId: string, segmentIds: readonly string[]): TermValidationResult {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const segments = db.segments.getByIds(segmentIds)
      const found = new Set(segments.map((segment) => segment.id as string))
      const missing = segmentIds.find((id) => !found.has(id))
      if (missing !== undefined) throw new StoreNotFoundError('segment', missing)
      return db.termEntries.validateSegments(segments)
    }, projectId)
  }

  deleteReference(
    projectId: string,
    kind: LinguistReferenceKind,
    id: string,
  ): void {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    this.context.call(() => {
      if (kind === 'tm') db.tmUnits.delete(id)
      else db.termEntries.delete(id)
    }, projectId)
  }

  /** 按 kind 分页查询（项目隔离在 store 仓储层；归档项目只读仍可查）。 */
  queryProjectAssets(
    projectId: string,
    kind: LinguistProjectAssetKind,
    query: ProjectAssetsQuery,
  ): ReferenceQueryPage<ProjectAssetInfo> {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const text = query.query
      const page = <T>(items: T[], total: number): ReferenceQueryPage<T> => ({
        items,
        total,
        limit: query.limit,
        offset: query.offset,
        hasMore: query.offset + items.length < total,
      })
      switch (kind) {
        case 'styleGuideRules': {
          const filter = { ...(text !== undefined ? { query: text } : {}) }
          return page(
            db.styleGuideRules.list({
              ...filter,
              limit: query.limit,
              offset: query.offset,
            }),
            db.styleGuideRules.count(filter),
          )
        }
        case 'sentencePatterns': {
          const filter = {
            ...(text !== undefined ? { query: text } : {}),
            ...(query.status !== undefined ? { status: query.status } : {}),
          }
          return page(
            db.sentencePatterns.list({
              ...filter,
              limit: query.limit,
              offset: query.offset,
            }),
            db.sentencePatterns.count(filter),
          )
        }
        case 'contextDocs': {
          const filter = {
            ...(text !== undefined ? { query: text } : {}),
            ...(query.segmentId !== undefined ? { segmentId: query.segmentId } : {}),
          }
          return page(
            db.contextDocs.list({
              ...filter,
              limit: query.limit,
              offset: query.offset,
            }),
            db.contextDocs.count(filter),
          )
        }
        case 'techConstraints':
          return page(
            db.techConstraints.list({
              limit: query.limit,
              offset: query.offset,
            }),
            db.techConstraints.count(),
          )
        case 'voiceProfiles': {
          const filter = { ...(text !== undefined ? { query: text } : {}) }
          return page(
            db.voiceProfiles.list({
              ...filter,
              limit: query.limit,
              offset: query.offset,
            }),
            db.voiceProfiles.count(filter),
          )
        }
      }
    }, projectId)
  }

  upsertProjectAsset(
    projectId: string,
    kind: 'styleGuideRules',
    item: StyleGuideRuleUpsertInput,
  ): StyleGuideRule
  upsertProjectAsset(
    projectId: string,
    kind: 'sentencePatterns',
    item: SentencePatternUpsertInput,
  ): SentencePattern
  upsertProjectAsset(
    projectId: string,
    kind: 'contextDocs',
    item: { id: string; note?: string },
  ): ContextDoc
  upsertProjectAsset(
    projectId: string,
    kind: 'techConstraints',
    item: TechConstraintUpsertInput,
  ): TechConstraint
  upsertProjectAsset(
    projectId: string,
    kind: 'voiceProfiles',
    item: VoiceProfileUpsertInput,
  ): VoiceProfile
  upsertProjectAsset(
    projectId: string,
    kind: LinguistProjectAssetKind,
    item:
      | StyleGuideRuleUpsertInput
      | SentencePatternUpsertInput
      | { id: string; note?: string }
      | TechConstraintUpsertInput
      | VoiceProfileUpsertInput,
  ): ProjectAssetInfo
  upsertProjectAsset(
    projectId: string,
    kind: LinguistProjectAssetKind,
    item:
      | StyleGuideRuleUpsertInput
      | SentencePatternUpsertInput
      | { id: string; note?: string }
      | TechConstraintUpsertInput
      | VoiceProfileUpsertInput,
  ): ProjectAssetInfo {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      switch (kind) {
        case 'styleGuideRules':
          return db.styleGuideRules.upsert(item as StyleGuideRuleUpsertInput)
        case 'sentencePatterns':
          return db.sentencePatterns.upsert(item as SentencePatternUpsertInput)
        case 'contextDocs': {
          const noteUpdate = item as { id: string; note?: string }
          return db.contextDocs.updateNote(noteUpdate.id, noteUpdate.note)
        }
        case 'techConstraints':
          return db.techConstraints.upsert(item as TechConstraintUpsertInput)
        case 'voiceProfiles':
          return db.voiceProfiles.upsert(item as VoiceProfileUpsertInput)
      }
    }, projectId)
  }

  setContextDocSegmentLink(
    projectId: string,
    docId: string,
    segmentId: string,
    linked: boolean,
  ): void {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    this.context.call(() => db.contextDocs.setSegmentLink(docId, segmentId, linked), projectId)
  }

  /** 删除（归档先拒绝）；contextDocs 级联清尾 blob 文件（尽力而为）。 */
  deleteProjectAsset(
    projectId: string,
    kind: LinguistProjectAssetKind,
    id: string,
  ): void {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    this.context.call(() => {
      switch (kind) {
        case 'styleGuideRules':
          db.styleGuideRules.delete(id)
          return
        case 'sentencePatterns':
          db.sentencePatterns.delete(id)
          return
        case 'contextDocs': {
          const doc = db.contextDocs.get(id)
          const extractedMedia = db.contextDocs.listExtractedMedia(id)
          db.contextDocs.delete(id)
          for (const item of doc === undefined ? extractedMedia : [doc, ...extractedMedia]) {
            if (db.contextDocs.isBlobReferenced(item.blobRelpath)) continue
            removeProjectBlob(
              db.blobsDir,
              item.blobRelpath.replace(/^blobs\//, ''),
            )
          }
          return
        }
        case 'techConstraints':
          db.techConstraints.delete(id)
          return
        case 'voiceProfiles':
          db.voiceProfiles.delete(id)
      }
    }, projectId)
  }

  /**
   * Context 文档 blob 的盘上绝对路径，仅供主进程注册预览 URL。
   * realpath 后必须仍在项目 blobs/ 内，绝不向 renderer 暴露路径。
   */
  resolveContextDocBlobPath(
    projectId: string,
    blobRelpath: string,
  ): string | undefined {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      return resolveManagedBlobPath(db.blobsDir, blobRelpath)
    }, projectId)
  }

  /** TM/TB 原始导入文件的围栏路径，仅供主进程 preview conversion stack 使用。 */
  resolveReferenceImportPreviewPath(
    projectId: string,
    importId: string,
  ): { sourcePath: string; originalFilename: string } {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const source = db.referenceImports.get(importId)
      if (source === undefined) throw new StoreNotFoundError('reference import', importId)
      const sourcePath = resolveManagedBlobPath(db.blobsDir, source.blobRelpath)
      if (sourcePath === undefined) throw new StoreNotFoundError('reference import blob', source.id)
      return { sourcePath, originalFilename: source.originalFilename }
    }, projectId)
  }

  /** CAT 资产 source blob 的主进程路径；缺失或越界时 fail closed。 */
  resolveAssetSourcePath(
    projectId: string,
    assetId: string,
  ): { sourcePath: string; originalFilename: string } {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const asset = db.assets.get(assetId)
      if (asset === undefined) throw new StoreNotFoundError('asset', assetId)
      const fileName = assetSourceFileName(asset)
      try {
        const sourceRoot = realpathSync(db.sourceDir)
        const target = realpathSync(resolve(sourceRoot, fileName))
        if (target !== sourceRoot && !target.startsWith(sourceRoot + sep)) {
          throw new StoreNotFoundError('asset source blob', fileName)
        }
        if (!statSync(target).isFile()) {
          throw new StoreNotFoundError('asset source blob', fileName)
        }
        return {
          sourcePath: target,
          originalFilename: asset.originalFilename,
        }
      } catch (err) {
        if (err instanceof StoreNotFoundError) throw err
        throw new StoreNotFoundError('asset source blob', fileName)
      }
    }, projectId)
  }

  /**
   * 单条 Context 文档 blob 预览的主进程解析：doc 记录 + 围栏后的绝对路径
   * （realpath 必须仍在项目 blobs/ 内），缺失或越界时 fail closed，
   * 绝不向 renderer 暴露路径。与 resolveAssetSourcePath 同一纪律。
   */
  resolveContextDocPreviewPath(
    projectId: string,
    docId: string,
  ): { sourcePath: string; originalFilename: string } {
    this.context.getProject(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const doc = db.contextDocs.get(docId)
      if (doc === undefined) throw new StoreNotFoundError('context doc', docId)
      const sourcePath = resolveManagedBlobPath(db.blobsDir, doc.blobRelpath)
      if (sourcePath === undefined) throw new StoreNotFoundError('context doc blob', doc.blobRelpath)
      return { sourcePath, originalFilename: doc.originalFilename }
    }, projectId)
  }

  /**
   * 可读 Context 文档先完成文本抽取，再写 blob 与元数据，避免半成品。
   */
  async importContextDoc(
    projectId: string,
    input: ImportContextDocInput,
  ): Promise<ContextDoc> {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    const sha256 = sha256Hex(input.bytes)
    const extension = extname(input.filename).toLowerCase()
    const kind: ContextDoc['kind'] = isContextDocImageExtension(extension)
      ? 'image'
      : 'doc'
    const extraction = await extractContext(input.bytes, input.filename)
    const textExtract = formatContextExtractionText(extraction)
    return this.context.call(() => {
      return db.catDb.transaction(`import Context extraction ${input.filename}`, () => {
        const blobName = `ctx-${sha256.slice(0, 16)}${extension}`
        saveProjectBlob(db.blobsDir, blobName, input.bytes)
        const doc = db.contextDocs.insert({
          kind,
          originalFilename: input.filename,
          blobRelpath: `blobs/${blobName}`,
          sha256,
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(textExtract !== undefined ? { textExtract } : {}),
          extractionWarnings: extraction.warnings,
        })
        const mediaDocIds = new Map<string, string>()
        for (const media of extraction.media) {
          if (kind === 'image' && media.sha256 === sha256) {
            mediaDocIds.set(media.id, doc.id)
            continue
          }
          const mediaExtension = extname(media.filename).toLowerCase()
          const mediaBlobName = `ctx-${media.sha256.slice(0, 16)}${mediaExtension}`
          saveProjectBlob(db.blobsDir, mediaBlobName, media.bytes)
          const mediaDoc = db.contextDocs.insert({
            kind: 'image',
            originalFilename: media.filename,
            blobRelpath: `blobs/${mediaBlobName}`,
            sha256: media.sha256,
            note: `从 ${input.filename} 提取的视觉附件`,
            parentContextDocId: doc.id,
          })
          mediaDocIds.set(media.id, mediaDoc.id)
        }
        const sections = new Map(extraction.textSections.map((section) => [section.id, section.text]))
        db.contextDocs.replaceExtraction(doc.id, extraction.anchors.map((anchor) => {
          const extractedMediaId = anchor.mediaId
            ?? (anchor.locator.kind === 'image' ? anchor.locator.mediaId : undefined)
          const mediaContextDocId = extractedMediaId === undefined
            ? undefined
            : mediaDocIds.get(extractedMediaId)
          if (extractedMediaId !== undefined && mediaContextDocId === undefined) {
            throw new Error(`Context extraction anchor ${anchor.id} references unknown media`)
          }
          const locator: ContextAnchorLocator = anchor.locator.kind === 'image'
            ? { ...anchor.locator, mediaId: mediaContextDocId as string }
            : anchor.locator
          return {
            id: anchor.id,
            locator,
            ...(anchor.label === undefined ? {} : { label: anchor.label }),
            ...(anchor.textSectionId === undefined ? {} : { text: sections.get(anchor.textSectionId) }),
            ...(mediaContextDocId === undefined ? {} : { mediaContextDocId }),
          }
        }))
        db.contextDocs.linkExtractionByExactText(doc.id, `exact-v1:${sha256}`)
        console.log(
          `[Linguist] 已导入 context 文档: 项目 ${projectId}（kind=${kind}，${input.bytes.length} 字节，媒体 ${extraction.media.length}）`,
        )
        return doc
      })
    }, projectId)
  }

  /** 导入句式 CSV；全文件解析后才开启 repository 事务。 */
  importSentencePatterns(
    projectId: string,
    input: ImportReferenceInput,
  ): ImportReferenceResult {
    this.context.assertProjectWritable(projectId)
    const db = this.context.openProject(projectId)
    return this.context.call(() => {
      const parsed = parseSentencePatternReference(input)
      const result = db.sentencePatterns.importMany(parsed.entries)
      console.log(
        `[Linguist] 已导入句式库: 项目 ${projectId}（${result.imported} 新增，${result.unchanged} 未变）`,
      )
      return { ...result, warnings: parsed.warnings }
    }, projectId)
  }
}
