/**
 * Linguist CAT customTools 装配（PB-042；计划 §7.2/§7.3「会话绑定的 CAT 工具」）。
 *
 * 把 CAT 读取、PB-051 Proposal、PB-071 QA、PB-083 评审与 PB-084 批量一致性
 * 工具（@linguist/cat-tools）经会话绑定解析器装配进 Pi 会话的 customTools 缝
 * （orchestrator sendMessage）。
 *
 * 装配规则（每次发送重建工具数组；绑定状态绝不缓存）：
 * - 普通会话（无 linguistProjectId）→ []（硬规则：普通 Chat 的 Tool 列表无 CAT）；
 * - 项目绑定会话（active / archived / missing 均装配）→ 19 个工具。projectId 永远
 *   来自冻结的会话绑定（PB-034），工具入参不含 projectId——计划 §7.2「Tool 每次都
 *   验证 Session projectId 与输入 projectId 一致」由构造满足（根本没有该输入）；
 * - 绑定 missing 仍装配工具（而非不装配，如实记录的选择）：调用时解析器返回
 *   LinguistCatProjectMissingError，工厂按 Pi 约定抛出，模型看到 [PROJECT_MISSING]
 *   明确失败——降级会话中 CAT 能力的缺席原因对模型保持可读；若改为不装配，模型
 *   无从得知 CAT 能力存在过，失败不可读；
 * - archived 仍装配；读取可用，写入由 Store 只读语义拒绝；
 * - resolveProject 在每次工具调用时实时重解析（resolveLinguistBindingStatus +
 *   getProject + openProject）：归档/删除目录即刻反映，重启/resume 走同一构造
 *   自然一致（与 PB-040 Skill 解析同一模式）；
 * - 句柄所有权：openProject 返回服务按 projectId 缓存的句柄（ResolvedLinguistCatProject
 *   是 borrowed handle），工具借用，绝不 close。
 *
 * 错误穿透约定（与 PB-041 工厂一致）：typed store/service 错误（含 code，如
 * STORE_SQLITE_UNAVAILABLE / PROJECT_NOT_FOUND）原样穿透不包装；服务暂不可解析
 * 等意外异常同样穿透（Pi 会把工具异常消息呈现给模型，绝不掀翻 Agent 循环）。
 *
 * 本模块刻意不 import electron：node --test 直接驱动（同 session-binding.ts）；
 * bun 单测经 mock.module('electron') + 假服务驱动（同 agent-session-manager.test.ts）。
 */

import type { AgentSessionMeta, LinguistProjectMutationEvent } from '@proma/shared'
import { LINGUIST_IMPORT_MAX_BYTES, LINGUIST_RESOURCE_IMPORT_MAX_BYTES } from '@proma/shared'
import { sha256Hex, type LinguistGenerationProvenance } from '@linguist/cat-core'
import {
  createLinguistCatTools,
  LinguistCatInvalidArgumentError,
  LinguistCatProjectMissingError,
  type LinguistIntakeImportResult,
  type LinguistImportResourceItem,
  type LinguistImportResourcesInput,
  type LinguistImportResourcesResult,
  type LinguistIntakeResourceKind,
  type LinguistIntakeXlsxMapping,
  type ResolveLinguistCatProject,
} from '@linguist/cat-tools'
import { readFileSync, realpathSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import { getAgentSessionMeta } from '../agent-session-manager'
import { resolveAgentExecutionScope } from './agent-execution-scope'
import { resolveLinguistBindingStatus, type LinguistServiceResolver } from './session-binding'
import {
  runLinguistConsistencyWorker,
  runLinguistQaWorker,
} from './cat-job-worker-client'
import type { LinguistProjectService } from './project-service'
import { copyFileVerified } from './secure-export'
import { createDefaultCatFormatRegistry } from './format-registry'
import { probePhraseMasterPair } from '@linguist/cat-formats'

export type LinguistProjectMutationSink = (event: LinguistProjectMutationEvent) => void

const projectMutationRevisions = new Map<string, number>()

function resolveAuthorizedIntakeFile(sessionId: string, projectId: string, filePath: string): {
  path: string
  filename: string
  sizeBytes: number
} {
  const session = getAgentSessionMeta(sessionId)
  if (session?.linguistProjectId !== projectId) {
    throw new LinguistCatInvalidArgumentError('filePath', 'session is no longer bound to this project')
  }
  try {
    const workspace = resolveAgentExecutionScope(session).cwd
    const target = realpathSync(isAbsolute(filePath) ? filePath : resolve(workspace, filePath))
    const stats = statSync(target)
    if (!stats.isFile()) throw new Error('not a file')
    return { path: target, filename: basename(target), sizeBytes: stats.size }
  } catch {
    throw new LinguistCatInvalidArgumentError(
      'filePath',
      'must resolve to a readable file',
    )
  }
}

const CONTEXT_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.rtf', '.pptx', '.md', '.markdown', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
])
const TM_EXTENSIONS = new Set(['.tmx', '.sdltm'])
const TB_EXTENSIONS = new Set(['.tbx', '.sdltb'])
const MULTI_IMPORT_FILE_LIMIT = 500

function resolveIntakeEntries(
  sessionId: string,
  projectId: string,
  paths: readonly string[],
  recursive: boolean,
): string[] {
  const session = getAgentSessionMeta(sessionId)
  if (session?.linguistProjectId !== projectId) {
    throw new LinguistCatInvalidArgumentError('paths', 'session is no longer bound to this project')
  }
  const cwd = resolveAgentExecutionScope(session).cwd
  const files: string[] = []
  const visit = (inputPath: string): void => {
    const target = realpathSync(isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath))
    const stats = statSync(target)
    if (stats.isFile()) {
      files.push(target)
      return
    }
    if (!stats.isDirectory()) return
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      const child = resolve(target, entry.name)
      if (entry.isFile()) files.push(child)
      else if (recursive && entry.isDirectory()) visit(child)
      if (files.length > MULTI_IMPORT_FILE_LIMIT) {
        throw new LinguistCatInvalidArgumentError('paths', `directory contains more than ${MULTI_IMPORT_FILE_LIMIT} files`)
      }
    }
  }
  try {
    for (const path of paths) visit(path)
  } catch (error) {
    if (error instanceof LinguistCatInvalidArgumentError) throw error
    throw new LinguistCatInvalidArgumentError('paths', 'must resolve to readable files or directories')
  }
  return [...new Set(files)].sort()
}

function createSessionIntakeBridge(
  sessionId: string,
  projectId: string,
  getService: LinguistServiceResolver,
): {
  importIntakeAsset: (
    filePath: string,
    resourceKind: LinguistIntakeResourceKind,
    xlsxMapping?: LinguistIntakeXlsxMapping,
  ) => Promise<LinguistIntakeImportResult>
  importResources: (input: LinguistImportResourcesInput) => Promise<LinguistImportResourcesResult>
} {
  const importEntry = async (
    entry: { path: string; filename: string; sizeBytes: number },
    resourceKind: LinguistIntakeResourceKind,
    xlsxMapping?: LinguistIntakeXlsxMapping,
    phraseMaster?: { path: string; filename: string; sizeBytes: number },
  ): Promise<LinguistIntakeImportResult> => {
    const maxBytes = resourceKind === 'batch'
      ? LINGUIST_IMPORT_MAX_BYTES
      : LINGUIST_RESOURCE_IMPORT_MAX_BYTES
    if (entry.sizeBytes > maxBytes) {
      throw new LinguistCatInvalidArgumentError(
        'paths',
        `file exceeds the ${Math.floor(maxBytes / 1024 / 1024)}MB ${resourceKind} intake limit`,
      )
    }
    const service: LinguistProjectService = getService()
    const bytes = readFileSync(entry.path)
    if (resourceKind === 'batch') {
      if (phraseMaster !== undefined && phraseMaster.sizeBytes > LINGUIST_IMPORT_MAX_BYTES) {
        throw new LinguistCatInvalidArgumentError('paths', 'Phrase master companion exceeds the batch intake limit')
      }
      const result = await service.importAsset(projectId, {
        bytes,
        filename: entry.filename,
        xlsxMapping,
        ...(phraseMaster === undefined ? {} : {
          phraseMaster: { bytes: readFileSync(phraseMaster.path), filename: phraseMaster.filename },
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

  return {
    async importIntakeAsset(filePath, resourceKind, xlsxMapping) {
      const entry = resolveAuthorizedIntakeFile(sessionId, projectId, filePath)
      return importEntry(entry, resourceKind, xlsxMapping)
    },
    async importResources(input) {
      const paths = resolveIntakeEntries(sessionId, projectId, input.paths, input.recursive)
      const registry = createDefaultCatFormatRegistry()
      const items: LinguistImportResourceItem[] = []
      const phraseSplits = paths.filter((path) => extname(path).toLowerCase() === '.mxliff')
      const phraseMasters = paths.filter((path) => ['.xlf', '.xliff'].includes(extname(path).toLowerCase()))
      const phrasePairs = new Map<string, string>()
      const usedMasters = new Set<string>()
      for (const splitPath of phraseSplits) {
        const probes = await Promise.all(phraseMasters.map(async (masterPath) => ({
          masterPath,
          probe: await probePhraseMasterPair(
            readFileSync(splitPath),
            basename(splitPath),
            readFileSync(masterPath),
            basename(masterPath),
          ),
        })))
        const ranked = probes.filter((item) => item.probe.score > 0).sort((left, right) => right.probe.score - left.probe.score)
        if (ranked[0] !== undefined && ranked[0].probe.score > (ranked[1]?.probe.score ?? -1)) {
          phrasePairs.set(splitPath, ranked[0].masterPath)
          usedMasters.add(ranked[0].masterPath)
        }
      }
      const masterResourceIds = new Map<string, string>()
      for (const path of paths) {
        if (usedMasters.has(path)) continue
        const filename = basename(path)
        const extension = extname(filename).toLowerCase()
        const entry = { path, filename, sizeBytes: statSync(path).size }
        let resourceKind: LinguistIntakeResourceKind | undefined = input.kind === 'auto'
          ? TM_EXTENSIONS.has(extension)
            ? 'tm'
            : TB_EXTENSIONS.has(extension)
              ? 'terms'
              : undefined
          : input.kind === 'tb' ? 'terms' : input.kind
        if (resourceKind === undefined) {
          try {
            await registry.detectBest(readFileSync(path), filename)
            resourceKind = 'batch'
          } catch {
            if (CONTEXT_EXTENSIONS.has(extension)) resourceKind = 'context'
          }
        }
        if (resourceKind === undefined) {
          items.push({ filename, status: 'unsupported' })
          continue
        }
        if (resourceKind === 'batch' && extension === '.xlsx' && input.xlsxMapping === undefined) {
          items.push({ filename, status: 'needs-input', resourceKind, message: '需要确认 Sheet 与 Source/Target 列映射' })
          continue
        }
        if (input.dryRun) {
          items.push({ filename, status: 'supported', resourceKind })
          continue
        }
        try {
          const masterPath = phrasePairs.get(path)
          const imported = await importEntry(
            entry,
            resourceKind,
            input.xlsxMapping,
            masterPath === undefined ? undefined : {
              path: masterPath,
              filename: basename(masterPath),
              sizeBytes: statSync(masterPath).size,
            },
          )
          if (masterPath !== undefined) masterResourceIds.set(masterPath, imported.resourceId)
          items.push({
            filename,
            status: imported.status,
            resourceKind,
            resourceId: imported.resourceId,
          })
        } catch (error) {
          const message = error instanceof Error
            ? error.message.replaceAll(path, filename)
            : '导入失败'
          items.push({ filename, status: 'failed', resourceKind, message })
        }
      }
      for (const masterPath of usedMasters) {
        const resourceId = masterResourceIds.get(masterPath)
        items.push({
          filename: basename(masterPath),
          status: input.dryRun || resourceId === undefined ? 'supported' : 'imported',
          resourceKind: 'batch',
          ...(resourceId === undefined ? {} : { resourceId }),
          message: 'Phrase master companion (content-verified)',
        })
      }
      const count = (status: LinguistImportResourceItem['status']): number =>
        items.filter((item) => item.status === status).length
      return {
        found: paths.length,
        supported: items.filter((item) => item.status !== 'unsupported').length,
        imported: count('imported'),
        skippedDuplicate: count('skipped-duplicate'),
        needsInput: count('needs-input'),
        unsupported: count('unsupported'),
        failed: count('failed'),
        items,
      }
    },
  }
}

function createSessionExportBridge(
  sessionId: string,
  projectId: string,
  getService: LinguistServiceResolver,
) {
  return async (
    assetId: string,
    destinationPath: string,
    mode: 'final' | 'draft',
    overwrite: boolean,
  ) => {
    if (getAgentSessionMeta(sessionId)?.linguistProjectId !== projectId) {
      throw new LinguistCatInvalidArgumentError('assetId', 'session is no longer bound to this project')
    }
    const service: LinguistProjectService = getService()
    const staged = mode === 'draft'
      ? await service.stageDraftExport(projectId, assetId)
      : (await service.prepareDelivery(projectId, assetId)).staged
    if (staged === undefined) throw new LinguistCatInvalidArgumentError('assetId', 'batch is not ready for final delivery')
    const written = copyFileVerified({
      managedRoot: service.rootDir,
      sourcePath: staged.stagingPath,
      destinationPath,
      expectedSha256: staged.artifact.sha256,
      overwrite,
    })
    return {
      filename: basename(destinationPath),
      ...written,
      verifiedSegments: staged.verifiedSegments,
      mode,
    }
  }
}

export function getLinguistProjectMutationRevision(projectId: string): number {
  return projectMutationRevisions.get(projectId) ?? 0
}

export function createLinguistProjectMutationEvent(
  projectId: string,
  mutation: Omit<LinguistProjectMutationEvent, 'projectId' | 'revision'>,
): LinguistProjectMutationEvent {
  const revision = Math.max(
    (projectMutationRevisions.get(projectId) ?? 0) + 1,
    mutation.sequence ?? 0,
  )
  projectMutationRevisions.set(projectId, revision)
  return { projectId, revision, ...mutation }
}

/**
 * 计算会话应装配的 Linguist CAT 工具（0 或 19 个），供 orchestrator 合并进
 * Pi queryOptions.customTools。规则见模块头注释；本函数自身不触碰服务
 * （构建工具数组是纯操作），服务只在工具被调用时经 resolver 触达。
 */
export function resolveLinguistSessionCatTools(
  session: Pick<
    AgentSessionMeta,
    'id' | 'modelId' | 'linguistProjectId'
  > | undefined,
  getService: LinguistServiceResolver,
  onProjectMutation?: LinguistProjectMutationSink,
  generationProvenance?: (toolCallId: string) => LinguistGenerationProvenance,
) {
  const projectId = session?.linguistProjectId
  if (!projectId) return []
  const resolveProject: ResolveLinguistCatProject = () => {
    const service = getService()
    // 每次调用实时重判定：missing（索引无此项目 / project.json 缺失或不可解析）
    // → 类型化 PROJECT_MISSING，工厂抛出后对模型可读；active/archived 正常打开
    // （归档由 openProject 强制只读，六个只读工具与 check-only 模式语义安全）。
    if (resolveLinguistBindingStatus(projectId, service) === 'missing') {
      return new LinguistCatProjectMissingError(projectId)
    }
    return { project: service.getProject(projectId), db: service.openProject(projectId) }
  }
  const intake = createSessionIntakeBridge(session.id, projectId, getService)
  const exportAsset = createSessionExportBridge(session.id, projectId, getService)
  return createLinguistCatTools({
    resolveProject,
    resultProjectId: projectId,
    sessionId: session.id,
    consistencyWorker: runLinguistConsistencyWorker,
    qaWorker: runLinguistQaWorker,
    importIntakeAsset: intake.importIntakeAsset,
    importResources: intake.importResources,
    exportAsset,
    scanUnknownTagPatterns: (assetIds, sampleLimit) =>
      getService().scanUnknownTagPatterns(projectId, assetIds, sampleLimit),
    saveTagProfileCandidate: (input, activate) => {
      const saved = getService().saveTagProfileCandidate(projectId, input)
      if (!saved.candidate || !saved.validation) throw new Error('Tag Profile candidate save returned no candidate')
      if (activate) getService().updateTagProfile(projectId, saved.candidate.id, 'activate')
      return {
        candidateId: saved.candidate.id,
        status: activate ? 'active' : 'candidate',
        validation: saved.validation,
      }
    },
    onMutation: (mutation) => {
      const event = createLinguistProjectMutationEvent(projectId, mutation)
      onProjectMutation?.(event)
    },
    ...(session.modelId !== undefined ? { modelId: session.modelId } : {}),
    ...(generationProvenance === undefined ? {} : { generationProvenance }),
  })
}

/**
 * customTools 名称冲突防线（init 时 fail loud）：cat_* 必须是本轮查询
 * customTools 列表中的全局唯一名。与既有工具（内建/桥接 MCP）撞名是编程错误
 * ——静默覆盖会让模型调到错误实现，宁可 loudly 终止本轮查询也不带病装配。
 */
export function assertNoLinguistCatToolNameConflict(
  existingToolNames: Iterable<string>,
  catTools: readonly { name: string }[],
): void {
  if (catTools.length === 0) return
  const existing = new Set(existingToolNames)
  for (const tool of catTools) {
    if (existing.has(tool.name)) {
      throw new Error(
        `[Linguist CAT] customTools 名称冲突: ${tool.name} 已被既有工具占用（cat_* 必须全局唯一，拒绝装配本轮查询）`,
      )
    }
  }
}
