import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import { probePhraseMasterPair } from '@linguist/cat-formats'
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
import { createDefaultCatFormatRegistry } from './format-registry'
import type { LinguistProjectService } from './project-service'

const CONTEXT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.rtf', '.pptx', '.md', '.markdown', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
])
const TM_EXTENSIONS = new Set(['.tmx', '.sdltm'])
const TB_EXTENSIONS = new Set(['.tbx', '.sdltb'])
const FILE_LIMIT = 500

interface IntakeEntry {
  path: string
  filename: string
  sizeBytes: number
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
      if (child.isFile()) await addFile(childPath)
      else if (recursive && child.isDirectory()) await visit(childPath)
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
  if (entry.sizeBytes > maxBytes) {
    throw new LinguistCatInvalidArgumentError(
      'paths',
      `file exceeds the ${Math.floor(maxBytes / 1024 / 1024)}MB ${resourceKind} intake limit`,
    )
  }
  const bytes = await readFile(entry.path)
  if (resourceKind === 'batch') {
    if (phraseMaster !== undefined && phraseMaster.sizeBytes > LINGUIST_IMPORT_MAX_BYTES) {
      throw new LinguistCatInvalidArgumentError('paths', 'Phrase master companion exceeds the batch intake limit')
    }
    const result = await service.importAsset(projectId, {
      bytes,
      filename: entry.filename,
      xlsxMapping,
      ...(phraseMaster === undefined ? {} : {
        phraseMaster: { bytes: await readFile(phraseMaster.path), filename: phraseMaster.filename },
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
  const { entries, failures, truncated } = await scanEntries(cwd, input.paths, input.recursive)
  const registry = createDefaultCatFormatRegistry()
  const items: LinguistImportResourceItem[] = [...failures]
  const phraseSplits = entries.filter((entry) => extname(entry.filename).toLowerCase() === '.mxliff')
  const phraseMasters = entries.filter((entry) => ['.xlf', '.xliff'].includes(extname(entry.filename).toLowerCase()))
  const phrasePairs = new Map<string, IntakeEntry>()
  const phraseIssues = new Map<string, string>()
  const usedMasters = new Set<string>()
  for (const split of phraseSplits) {
    const splitBytes = await readFile(split.path)
    const ranked = []
    for (const master of phraseMasters) {
      try {
        const probe = await probePhraseMasterPair(
          splitBytes,
          split.filename,
          await readFile(master.path),
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
      phraseIssues.set(split.path, 'Phrase split 存在多个同分 master 候选')
    } else if (best.probe.config.unmatchedSegments > 0 || best.probe.config.ambiguousSegments > 0) {
      phraseIssues.set(split.path, 'Phrase master Tag Mapping 不完整或有歧义')
    } else {
      phrasePairs.set(split.path, best.master)
      usedMasters.add(best.master.path)
    }
  }

  const masterResourceIds = new Map<string, string>()
  for (const entry of entries) {
    if (phraseSplits.length > 0 && phraseMasters.some((master) => master.path === entry.path)) continue
    const filename = entry.filename
    const extension = extname(filename).toLowerCase()
    const phraseIssue = phraseIssues.get(entry.path)
    if (phraseIssue !== undefined) {
      items.push({ filename, status: 'needs-input', resourceKind: 'batch', message: phraseIssue })
      continue
    }
    let resourceKind: LinguistIntakeResourceKind | undefined = input.kind === 'auto'
      ? TM_EXTENSIONS.has(extension)
        ? 'tm'
        : TB_EXTENSIONS.has(extension)
          ? 'terms'
          : undefined
      : input.kind === 'tb' ? 'terms' : input.kind
    let bytes: Uint8Array | undefined
    if (resourceKind === undefined) {
      try {
        bytes = await readFile(entry.path)
        await registry.detectBest(bytes, filename)
        resourceKind = 'batch'
      } catch {
        if (CONTEXT_EXTENSIONS.has(extension)) resourceKind = 'context'
      }
    }
    if (resourceKind === undefined) {
      items.push({ filename, status: 'unsupported' })
      continue
    }
    let xlsxMapping = input.xlsxMapping
    if (extension === '.xlsx' && xlsxMapping === undefined) {
      bytes ??= await readFile(entry.path)
      xlsxMapping = await service.resolveWorkbookMapping(projectId, bytes, filename)
      if (xlsxMapping === undefined) {
        items.push({ filename, status: 'needs-input', resourceKind, message: '需要确认 Sheet 与列映射' })
        continue
      }
    }
    if (input.dryRun) {
      items.push({ filename, status: 'ready', resourceKind })
      continue
    }
    try {
      const master = phrasePairs.get(entry.path)
      const imported = await importEntry(service, projectId, entry, resourceKind, xlsxMapping, master)
      if (master !== undefined) masterResourceIds.set(master.path, imported.resourceId)
      items.push({
        filename,
        status: imported.status,
        resourceKind,
        resourceId: imported.resourceId,
      })
    } catch (error) {
      items.push({
        filename,
        status: 'failed',
        resourceKind,
        message: error instanceof Error ? error.message.replaceAll(entry.path, filename) : '导入失败',
      })
    }
  }
  if (phraseSplits.length > 0) {
    for (const master of phraseMasters) {
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
