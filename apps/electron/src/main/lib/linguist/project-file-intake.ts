import { open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import {
  FormatParseError,
  normalizeDelimitedHeader,
  parseDelimitedTable,
  PHRASE_MXLIFF_ADAPTER_ID,
  inspectPhraseRecovery,
  parsePhraseMxliffFormatConfig,
  probePhraseMasterPair,
} from '@linguist/cat-formats'
import { sha256Hex } from '@linguist/cat-core'
import {
  LINGUIST_IMPORT_MAX_BYTES,
  LINGUIST_RESOURCE_IMPORT_MAX_BYTES,
} from '@proma/shared'
import type {
  LinguistImportResourceItem,
  LinguistImportResourcesInput,
  LinguistImportResourcesResult,
  LinguistIntakeImportResult,
  LinguistIntakeResourceKind,
  LinguistIntakeXlsxMapping,
} from '@linguist/cat-tools'
import { LinguistCatInvalidArgumentError } from '@linguist/cat-tools'
import { errorCodeOf, LinguistImportTooLargeError } from './errors'
import { runLinguistContextPrepareWorker } from './cat-job-worker-client'
import { createDefaultCatFormatRegistry } from './format-registry'
import { parseTermReference, parseTmReference } from './project-resource-parsers'
import type { LinguistProjectService } from './project-service'

const CONTEXT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.rtf', '.pptx', '.md', '.markdown', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
])
const TM_EXTENSIONS = new Set(['.tmx', '.sdltm'])
const TB_EXTENSIONS = new Set(['.tbx', '.sdltb'])
const BATCH_EXTENSIONS = new Set(['.mxliff', '.xlf', '.xliff', '.mqxliff', '.sdlxliff', '.csv', '.tsv', '.json', '.xlsx'])
const FILE_LIMIT = 500
const SAFE_FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const AUTO_CSV_TERM_HEADERS = new Set(['term', '术语', '源术语'].map(normalizeDelimitedHeader))
const AUTO_CSV_SOURCE_HEADERS = new Set(['source', 'src', 'sourcetext', 'source text', '源文', '原文'].map(normalizeDelimitedHeader))
const AUTO_CSV_TARGET_HEADERS = new Set(['target', 'tgt', 'translation', 'targettext', 'target text', '译文', '翻译'].map(normalizeDelimitedHeader))
const AUTO_CSV_BATCH_HEADERS = new Set([
  'key', 'id', 'segmentid', 'uniquekey', '唯一键',
  'locked', 'lock', '锁定',
  'context', 'note', 'notes', 'comment', '备注',
].map(normalizeDelimitedHeader))

interface IntakeEntry {
  path: string
  filename: string
  sizeBytes: number
}

function safeImportFailureMessage(error: unknown): string {
  const code = errorCodeOf(error)
  const publicCode = code !== 'UNKNOWN' && SAFE_FAILURE_CODE.test(code) ? code : 'INTERNAL'
  if (error instanceof FormatParseError) {
    return `导入失败（${publicCode} / ${error.adapterId}）：${error.detail.slice(0, 240)}`
  }
  return `导入失败（${publicCode}）`
}

function autoCsvKind(
  bytes: Uint8Array,
  filename: string,
): 'terms' | 'batch' | 'batch-or-tm' | undefined {
  let headers: Set<string>
  try {
    headers = new Set(
      parseDelimitedTable(bytes, filename).headers.map(normalizeDelimitedHeader),
    )
  } catch {
    return undefined
  }
  const has = (aliases: ReadonlySet<string>): boolean =>
    [...aliases].some((alias) => headers.has(alias))
  const hasTarget = has(AUTO_CSV_TARGET_HEADERS)
  const batchOrTm = has(AUTO_CSV_SOURCE_HEADERS) && hasTarget
  if (!batchOrTm && has(AUTO_CSV_TERM_HEADERS) && hasTarget) {
    return 'terms'
  }
  if (!batchOrTm) return undefined
  return has(AUTO_CSV_BATCH_HEADERS) ? 'batch' : 'batch-or-tm'
}

/** 原生 picker 选中文件的主进程读取边界；同一 fd 完成大小检查与读盘。 */
export async function readPickedFileWithinLimit(
  filePath: string,
  limitBytes: number,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const file = await open(filePath, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('picked path is not a regular file')
    if (info.size > limitBytes) {
      throw new LinguistImportTooLargeError(info.size, limitBytes)
    }
    const bytes = await file.readFile()
    if (bytes.byteLength > limitBytes) {
      throw new LinguistImportTooLargeError(bytes.byteLength, limitBytes)
    }
    return { bytes, filename: basename(filePath) }
  } finally {
    await file.close()
  }
}

async function resolveEntry(cwd: string, inputPath: string): Promise<IntakeEntry> {
  const path = await realpath(isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath))
  const info = await stat(path)
  if (!info.isFile()) throw new Error('not a file')
  return { path, filename: basename(path), sizeBytes: info.size }
}

async function scanEntries(
  cwd: string,
  inputPaths: readonly string[],
  recursive: boolean,
): Promise<{ entries: IntakeEntry[]; failures: LinguistImportResourceItem[]; truncated: boolean }> {
  const entries: IntakeEntry[] = []
  const failures: LinguistImportResourceItem[] = []
  const seen = new Set<string>()
  let truncated = false
  const addFile = async (path: string): Promise<void> => {
    if (seen.has(path)) return
    if (entries.length >= FILE_LIMIT) {
      truncated = true
      return
    }
    const info = await stat(path)
    if (!info.isFile()) return
    seen.add(path)
    entries.push({ path, filename: basename(path), sizeBytes: info.size })
  }
  const visit = async (inputPath: string): Promise<void> => {
    const path = await realpath(isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath))
    const info = await stat(path)
    if (info.isFile()) return addFile(path)
    if (!info.isDirectory()) throw new Error('not a file or directory')
    const children = (await readdir(path, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      if (truncated) break
      const childPath = resolve(path, child.name)
      try {
        if (child.isFile()) await addFile(childPath)
        else if (recursive && child.isDirectory()) await visit(childPath)
      } catch {
        failures.push({ filename: child.name, status: 'failed', message: '路径不可读' })
      }
    }
  }
  for (const inputPath of inputPaths) {
    try {
      await visit(inputPath)
    } catch {
      failures.push({ filename: basename(inputPath) || 'unreadable', status: 'failed', message: '路径不可读' })
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return { entries, failures, truncated }
}

async function importEntry(
  service: LinguistProjectService,
  projectId: string,
  entry: IntakeEntry,
  resourceKind: LinguistIntakeResourceKind,
  xlsxMapping?: LinguistIntakeXlsxMapping,
  phraseMaster?: IntakeEntry,
): Promise<LinguistIntakeImportResult> {
  const maxBytes = resourceKind === 'batch'
    ? LINGUIST_IMPORT_MAX_BYTES
    : LINGUIST_RESOURCE_IMPORT_MAX_BYTES
  assertEntryWithinLimit(entry, resourceKind, maxBytes)
  const { bytes } = await readPickedFileWithinLimit(entry.path, maxBytes)
  if (resourceKind === 'batch') {
    if (phraseMaster !== undefined && phraseMaster.sizeBytes > LINGUIST_IMPORT_MAX_BYTES) {
      throw new LinguistCatInvalidArgumentError('paths', 'Phrase master companion exceeds the batch intake limit')
    }
    const result = await service.importAsset(projectId, {
      bytes,
      filename: entry.filename,
      xlsxMapping,
      ...(phraseMaster === undefined ? {} : {
        phraseMaster: {
          bytes: (await readPickedFileWithinLimit(phraseMaster.path, LINGUIST_IMPORT_MAX_BYTES)).bytes,
          filename: phraseMaster.filename,
        },
      }),
    })
    return {
      resourceKind,
      filename: entry.filename,
      status: result.status,
      resourceId: result.assetId,
      importedCount: result.segmentCount,
      unchangedCount: result.status === 'skipped-duplicate' ? result.segmentCount : 0,
      sourceSha256: result.sourceSha256,
      warnings: result.warnings.map((warning) => warning.message),
      unknownTagSummary: result.unknownTagSummary,
    }
  }
  if (resourceKind === 'context') {
    const doc = await service.importContextDoc(projectId, { bytes, filename: entry.filename })
    return {
      resourceKind,
      filename: entry.filename,
      status: 'imported',
      resourceId: doc.id,
      importedCount: 1,
      unchangedCount: 0,
      sourceSha256: doc.sha256 ?? sha256Hex(bytes),
      warnings: doc.extractionWarnings.map((warning) => warning.message),
    }
  }
  const result = await service.importReference(projectId, resourceKind, {
    bytes,
    filename: entry.filename,
    ...(xlsxMapping === undefined ? {} : { xlsxMapping }),
  })
  if (result.source === undefined) throw new Error('导入成功但缺少来源登记')
  return {
    resourceKind,
    filename: entry.filename,
    status: result.imported > 0 ? 'imported' : 'skipped-duplicate',
    resourceId: result.source.id,
    importedCount: result.imported,
    unchangedCount: result.unchanged,
    sourceSha256: result.source.sourceSha256,
    warnings: result.warnings,
  }
}

function assertEntryWithinLimit(
  entry: IntakeEntry,
  resourceKind: LinguistIntakeResourceKind,
  maxBytes = resourceKind === 'batch'
    ? LINGUIST_IMPORT_MAX_BYTES
    : LINGUIST_RESOURCE_IMPORT_MAX_BYTES,
): void {
  if (entry.sizeBytes <= maxBytes) return
  throw new LinguistCatInvalidArgumentError(
    'paths',
    `file exceeds the ${Math.floor(maxBytes / 1024 / 1024)}MB ${resourceKind} intake limit`,
  )
}

export async function importProjectFile(
  service: LinguistProjectService,
  projectId: string,
  cwd: string,
  filePath: string,
  resourceKind: LinguistIntakeResourceKind,
  xlsxMapping?: LinguistIntakeXlsxMapping,
): Promise<LinguistIntakeImportResult> {
  let entry: IntakeEntry
  try {
    entry = await resolveEntry(cwd, filePath)
  } catch {
    throw new LinguistCatInvalidArgumentError('filePath', 'must resolve to a readable file')
  }
  if (
    resourceKind !== 'context'
    && extname(entry.filename).toLowerCase() === '.xlsx'
    && xlsxMapping === undefined
  ) {
    xlsxMapping = await service.resolveWorkbookMapping(
      projectId,
      await readFile(entry.path),
      entry.filename,
    )
    if (xlsxMapping === undefined) {
      throw new LinguistCatInvalidArgumentError(
        'xlsxMapping',
        'no saved mapping matches this workbook; preview and save a mapping first',
      )
    }
  }
  return importEntry(service, projectId, entry, resourceKind, xlsxMapping)
}

export async function importProjectResources(
  service: LinguistProjectService,
  projectId: string,
  cwd: string,
  input: LinguistImportResourcesInput,
): Promise<LinguistImportResourcesResult> {
  // 项目级失败不能伪装成某一个文件的 partial failure；也不要先读用户文件再
  // 发现项目已归档或 cat.db 不健康。
  service.assertProjectWritable(projectId)
  const db = service.openProject(projectId)
  const { entries, failures, truncated } = await scanEntries(cwd, input.paths, input.recursive)
  const registry = createDefaultCatFormatRegistry()
  const items: LinguistImportResourceItem[] = [...failures]
  const phraseSplits: IntakeEntry[] = []
  const phraseFiles = new Set<string>()
  const phraseIssues = new Map<string, string>()
  const project = service.getProject(projectId)
  const importedAssetsByHash = new Map(db.assets.listByProject().map((asset) => [asset.sourceSha256, asset]))
  const duplicateMasterHashes = new Set<string>()
  for (const entry of entries) {
    if (!['.mxliff', '.xlf', '.xliff'].includes(extname(entry.filename).toLowerCase())) continue
    try {
      const bytes = (await readPickedFileWithinLimit(entry.path, LINGUIST_IMPORT_MAX_BYTES)).bytes
      const adapter = await registry.detectBest(bytes, entry.filename)
      if (adapter.id !== PHRASE_MXLIFF_ADAPTER_ID) continue
      phraseFiles.add(entry.path)
      const duplicate = importedAssetsByHash.get(sha256Hex(bytes))
      if (duplicate !== undefined) {
        const config = parsePhraseMxliffFormatConfig(duplicate.formatConfigJson, duplicate.originalFilename)
        if (config !== undefined) duplicateMasterHashes.add(config.masterSha256)
        continue
      }
      const parsed = await adapter.import({
        bytes, filename: entry.filename,
        sourceLocale: project.sourceLocale, targetLocale: project.targetLocale,
      })
      const recovery = inspectPhraseRecovery(parsed.segments)
      if (recovery.status === 'unsupported-representation') {
        phraseIssues.set(entry.path, `Phrase 包含仅在 Target 出现或未配对的标记：${recovery.keys.join('、')}`)
      } else if (recovery.status === 'needs-master') {
        phraseSplits.push(entry)
      }
    } catch {
      // 格式错误由下方真实导入/预检返回；不把坏文件误作 master 候选。
      if (extname(entry.filename).toLowerCase() === '.mxliff') phraseFiles.add(entry.path)
    }
  }
  const phraseMasters = entries.filter((entry) =>
    ['.xlf', '.xliff'].includes(extname(entry.filename).toLowerCase()) && !phraseFiles.has(entry.path))
  const phrasePairs = new Map<string, IntakeEntry>()
  const phrasePairMessages = new Map<string, string>()
  const phraseCandidateMasters = new Set<string>()
  const usedMasters = new Set<string>()
  // 与待恢复 Phrase 同批选中的 XLIFF 可能是 master；未唯一配对前不能自动当独立批次导入。
  if (phraseSplits.length > 0 || phraseIssues.size > 0 || duplicateMasterHashes.size > 0) {
    for (const master of phraseMasters) phraseCandidateMasters.add(master.path)
  }
  for (const master of phraseMasters) {
    if (!phraseCandidateMasters.has(master.path)) continue
    try {
      const bytes = (await readPickedFileWithinLimit(master.path, LINGUIST_IMPORT_MAX_BYTES)).bytes
      if (duplicateMasterHashes.has(sha256Hex(bytes))) usedMasters.add(master.path)
    } catch {
      // 下方统一返回 needs-input；不可读的配套文件不自动当独立源批次导入。
    }
  }
  for (const split of phraseSplits) {
    let splitBytes: Uint8Array
    try {
      splitBytes = (await readPickedFileWithinLimit(split.path, LINGUIST_IMPORT_MAX_BYTES)).bytes
    } catch {
      phraseIssues.set(split.path, 'Phrase split 文件不可读')
      continue
    }
    const ranked = []
    const rejected: string[] = []
    for (const master of phraseMasters) {
      try {
        const probe = await probePhraseMasterPair(
          splitBytes,
          split.filename,
          (await readPickedFileWithinLimit(master.path, LINGUIST_IMPORT_MAX_BYTES)).bytes,
          master.filename,
        )
        if (probe.status === 'matched' || (probe.status === 'not-required' && probe.literalSegments > 0)) {
          ranked.push({ master, probe })
        } else {
          if (rejected.length < 3) rejected.push(`${master.filename}: ${probe.status}${probe.sampleKeys.length > 0 ? ` [${probe.sampleKeys.join(', ')}]` : ''}`)
        }
      } catch {
        if (rejected.length < 3) rejected.push(`${master.filename}: parse-error`)
      }
    }
    const best = ranked[0]
    if (best === undefined) {
      phraseIssues.set(split.path, `Phrase split 缺少可匹配的 master XLIFF${rejected.length > 0 ? `（${rejected.join('；')}）` : ''}`)
    } else if (ranked.length > 1) {
      const sampleKeys = [...new Set(ranked.flatMap((item) => [
        ...item.probe.sampleKeys,
        ...Object.keys(item.probe.config.mappings),
      ]))].slice(0, 5)
      phraseIssues.set(
        split.path,
        `Phrase split 存在多个可接受但解释不唯一的 master 候选：${ranked.map((item) => item.master.filename).join('、')}${sampleKeys.length > 0 ? ` [${sampleKeys.join(', ')}]` : ''}`,
      )
    } else {
      phrasePairs.set(split.path, best.master)
      phrasePairMessages.set(
        split.path,
        `已与 master ${best.master.filename} 唯一配对；Tag Mapping ${best.probe.config.matchedSegments}/${best.probe.config.placeholderSegments}，字面变量 ${best.probe.literalSegments}`,
      )
      usedMasters.add(best.master.path)
    }
  }

  for (const entry of entries) {
    if (phraseCandidateMasters.has(entry.path)) continue
    const filename = entry.filename
    const extension = extname(filename).toLowerCase()
    const phraseIssue = phraseIssues.get(entry.path)
    if (phraseIssue !== undefined) {
      items.push({ filename, status: 'needs-input', resourceKind: 'batch', message: phraseIssue })
      continue
    }
    let resourceKind: LinguistIntakeResourceKind | undefined
    try {
      let bytes: Uint8Array | undefined
      if (input.kind === 'auto' && extension === '.csv') {
        bytes = (await readPickedFileWithinLimit(entry.path, LINGUIST_RESOURCE_IMPORT_MAX_BYTES)).bytes
        const csvKind = autoCsvKind(bytes, filename)
        if (csvKind === 'terms') {
          resourceKind = 'terms'
        } else if (csvKind === 'batch') {
          resourceKind = 'batch'
        } else if (csvKind === 'batch-or-tm') {
          items.push({
            filename,
            status: 'needs-input',
            sourceSha256: sha256Hex(bytes),
            message: 'CSV 只有 Source/Target，无法判断是批次还是翻译记忆；若是 TM，请在“TM / 术语库 / 句式管理”导入；若是批次，请补充 ID/Key 列，或让项目 Agent 明确按批次导入',
          })
          continue
        }
      }
      resourceKind = input.kind === 'auto'
        ? resourceKind ?? (TM_EXTENSIONS.has(extension)
          ? 'tm'
          : TB_EXTENSIONS.has(extension)
            ? 'terms'
            : undefined)
        : input.kind === 'tb' ? 'terms' : input.kind
      if (resourceKind === undefined) {
        bytes = (await readPickedFileWithinLimit(entry.path, LINGUIST_RESOURCE_IMPORT_MAX_BYTES)).bytes
        try {
          await registry.detectBest(bytes, filename)
          resourceKind = 'batch'
        } catch {
          if (BATCH_EXTENSIONS.has(extension)) resourceKind = 'batch'
          else if (CONTEXT_EXTENSIONS.has(extension)) resourceKind = 'context'
        }
      }
      if (resourceKind === undefined) {
        items.push({ filename, status: 'unsupported', sourceSha256: sha256Hex(bytes!) })
        continue
      }
      let xlsxMapping = input.xlsxMapping
      if (resourceKind !== 'context' && extension === '.xlsx' && xlsxMapping === undefined) {
        bytes ??= (await readPickedFileWithinLimit(entry.path, LINGUIST_IMPORT_MAX_BYTES)).bytes
        xlsxMapping = await service.resolveWorkbookMapping(projectId, bytes, filename)
        if (xlsxMapping === undefined) {
          items.push({
            filename,
            status: 'needs-input',
            resourceKind,
            sourceSha256: sha256Hex(bytes),
            message: '需要确认 Sheet 与列映射',
          })
          continue
        }
      }
      assertEntryWithinLimit(entry, resourceKind)
      const master = phrasePairs.get(entry.path)
      if (input.dryRun) {
        const maxBytes = resourceKind === 'batch'
          ? LINGUIST_IMPORT_MAX_BYTES
          : LINGUIST_RESOURCE_IMPORT_MAX_BYTES
        bytes ??= (await readPickedFileWithinLimit(entry.path, maxBytes)).bytes
        let status: LinguistImportResourceItem['status'] = 'ready'
        let resourceId: string | undefined
        if (resourceKind === 'batch') {
          const preview = await service.previewAssetImport(projectId, {
            bytes,
            filename,
            xlsxMapping,
            ...(master === undefined ? {} : {
              phraseMaster: {
                bytes: (await readPickedFileWithinLimit(master.path, LINGUIST_IMPORT_MAX_BYTES)).bytes,
                filename: master.filename,
              },
            }),
          })
          status = preview.status
          resourceId = preview.assetId
        } else if (resourceKind === 'context') {
          await runLinguistContextPrepareWorker({ bytes, filename })
        } else {
          const project = service.getProject(projectId)
          const reference = { bytes, filename, xlsxMapping }
          if (resourceKind === 'tm') {
            await parseTmReference(reference, project.sourceLocale, project.targetLocale)
          } else {
            await parseTermReference(reference, project.sourceLocale, project.targetLocale)
          }
        }
        items.push({ filename, status, resourceKind, sourceSha256: sha256Hex(bytes),
          ...(resourceId === undefined ? {} : { resourceId }) })
        continue
      }
      const imported = await importEntry(service, projectId, entry, resourceKind, xlsxMapping, master)
      items.push({
        filename,
        status: imported.status,
        resourceKind,
        resourceId: imported.resourceId,
        sourceSha256: imported.sourceSha256,
        ...(phrasePairMessages.get(entry.path) === undefined ? {} : { message: phrasePairMessages.get(entry.path) }),
        ...(imported.unknownTagSummary === undefined ? {} : { unknownTagSummary: imported.unknownTagSummary }),
      })
    } catch (error) {
      items.push({
        filename,
        status: 'failed',
        resourceKind,
        message: safeImportFailureMessage(error),
      })
    }
  }
  if (phraseCandidateMasters.size > 0) {
    for (const master of phraseMasters.filter((entry) => phraseCandidateMasters.has(entry.path))) {
      const paired = usedMasters.has(master.path)
      items.push({
        filename: master.filename,
        status: paired ? 'supporting' : 'needs-input',
        resourceKind: 'batch',
        message: paired ? 'Phrase master companion (content-verified)' : '此 XLIFF 与待恢复 Phrase 文件同批选中，但无法确认配对；若是独立批次，请单独导入',
      })
    }
  }
  const count = (status: LinguistImportResourceItem['status']): number =>
    items.filter((item) => item.status === status).length
  return {
    found: entries.length + failures.length,
    ready: count('ready'),
    imported: count('imported'),
    skippedDuplicate: count('skipped-duplicate'),
    needsInput: count('needs-input'),
    unsupported: count('unsupported'),
    failed: count('failed'),
    truncated,
    items,
  }
}
