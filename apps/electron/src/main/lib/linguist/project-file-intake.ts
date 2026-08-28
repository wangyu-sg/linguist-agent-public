import { open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import {
  normalizeDelimitedHeader,
  parseDelimitedTable,
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
import { createDefaultCatFormatRegistry } from './format-registry'
import type { LinguistProjectService } from './project-service'

const CONTEXT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.rtf', '.pptx', '.md', '.markdown', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
])
const TM_EXTENSIONS = new Set(['.tmx', '.sdltm'])
const TB_EXTENSIONS = new Set(['.tbx', '.sdltb'])
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
      warnings: [],
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
  if (extname(entry.filename).toLowerCase() === '.mxliff') {
    throw new LinguistCatInvalidArgumentError(
      'filePath',
      'Phrase split MXLIFF requires cat_import_resources with its master XLIFF',
    )
  }
  if (extname(entry.filename).toLowerCase() === '.xlsx' && xlsxMapping === undefined) {
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
  service.openProject(projectId)
  const { entries, failures, truncated } = await scanEntries(cwd, input.paths, input.recursive)
  const registry = createDefaultCatFormatRegistry()
  const items: LinguistImportResourceItem[] = [...failures]
  const phraseSplits = entries.filter((entry) => extname(entry.filename).toLowerCase() === '.mxliff')
  const phraseMasters = entries.filter((entry) => ['.xlf', '.xliff'].includes(extname(entry.filename).toLowerCase()))
  const phrasePairs = new Map<string, IntakeEntry>()
  const phrasePairMessages = new Map<string, string>()
  const phraseIssues = new Map<string, string>()
  const phraseCandidateMasters = new Set<string>()
  const usedMasters = new Set<string>()
  for (const split of phraseSplits) {
    let splitBytes: Uint8Array
    try {
      splitBytes = (await readPickedFileWithinLimit(split.path, LINGUIST_IMPORT_MAX_BYTES)).bytes
    } catch {
      phraseIssues.set(split.path, 'Phrase split 文件不可读')
      continue
    }
    const ranked = []
    for (const master of phraseMasters) {
      try {
        const probe = await probePhraseMasterPair(
          splitBytes,
          split.filename,
          (await readPickedFileWithinLimit(master.path, LINGUIST_IMPORT_MAX_BYTES)).bytes,
          master.filename,
        )
        if (probe.score > 0) ranked.push({ master, probe })
      } catch {
        // 单个候选不可读/不可解析不阻断其他候选。
      }
    }
    ranked.sort((left, right) => right.probe.score - left.probe.score)
    const best = ranked[0]
    if (best === undefined) {
      phraseIssues.set(split.path, 'Phrase split 缺少可匹配的 master XLIFF')
    } else if (best.probe.score === ranked[1]?.probe.score) {
      const tied = ranked.filter((item) => item.probe.score === best.probe.score)
      for (const item of tied) phraseCandidateMasters.add(item.master.path)
      phraseIssues.set(
        split.path,
        `Phrase split 存在多个同分 master 候选：${tied.map((item) => item.master.filename).join('、')}`,
      )
    } else if (best.probe.config.unmatchedSegments > 0 || best.probe.config.ambiguousSegments > 0) {
      phraseCandidateMasters.add(best.master.path)
      phraseIssues.set(
        split.path,
        `Phrase master ${best.master.filename} 的 Tag Mapping 不完整或有歧义：匹配 ${best.probe.config.matchedSegments}/${best.probe.config.placeholderSegments}，未匹配 ${best.probe.config.unmatchedSegments}，歧义 ${best.probe.config.ambiguousSegments}`,
      )
    } else {
      phraseCandidateMasters.add(best.master.path)
      phrasePairs.set(split.path, best.master)
      phrasePairMessages.set(
        split.path,
        `已与 master ${best.master.filename} 唯一配对；Tag Mapping ${best.probe.config.matchedSegments}/${best.probe.config.placeholderSegments}`,
      )
      usedMasters.add(best.master.path)
    }
  }

  const masterResourceIds = new Map<string, string>()
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
          if (CONTEXT_EXTENSIONS.has(extension)) resourceKind = 'context'
        }
      }
      if (resourceKind === undefined) {
        items.push({ filename, status: 'unsupported', sourceSha256: sha256Hex(bytes!) })
        continue
      }
      let xlsxMapping = input.xlsxMapping
      if (extension === '.xlsx' && xlsxMapping === undefined) {
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
      if (input.dryRun) {
        const maxBytes = resourceKind === 'batch'
          ? LINGUIST_IMPORT_MAX_BYTES
          : LINGUIST_RESOURCE_IMPORT_MAX_BYTES
        bytes ??= (await readPickedFileWithinLimit(entry.path, maxBytes)).bytes
        items.push({ filename, status: 'ready', resourceKind, sourceSha256: sha256Hex(bytes) })
        continue
      }
      const master = phrasePairs.get(entry.path)
      const imported = await importEntry(service, projectId, entry, resourceKind, xlsxMapping, master)
      if (master !== undefined) masterResourceIds.set(master.path, imported.resourceId)
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
  if (phraseSplits.length > 0) {
    for (const master of phraseMasters.filter((entry) => phraseCandidateMasters.has(entry.path))) {
      const resourceId = masterResourceIds.get(master.path)
      const paired = usedMasters.has(master.path)
      items.push({
        filename: master.filename,
        status: input.dryRun && paired ? 'ready' : resourceId === undefined ? 'needs-input' : 'imported',
        resourceKind: 'batch',
        ...(resourceId === undefined ? {} : { resourceId }),
        message: paired ? 'Phrase master companion (content-verified)' : 'Phrase master 未能唯一配对 split MXLIFF',
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
