/**
 * 会话绑定的 CAT Tool 装配层。
 *
 * 本文件只解析 Session authority、调用项目服务、投影通知；文件遍历、导入、
 * Phrase 配对和导出业务都在项目服务子模块中。
 */

import type { AgentSessionMeta, LinguistProjectMutationEvent, LinguistTurnContextV1 } from '@proma/shared'
import type { LinguistGenerationProvenance } from '@linguist/cat-core'
import {
  createLinguistCatTools,
  LinguistCatInvalidArgumentError,
  LinguistCatProjectMissingError,
  type ResolveLinguistCatProject,
} from '@linguist/cat-tools'
import { getAgentSessionMeta } from '../agent-session-manager'
import { resolveAgentExecutionScope } from './agent-execution-scope'
import { resolveProjectDiscoveryScope } from './project-discovery-scope'
import {
  runLinguistConsistencyWorker,
  runLinguistQaWorker,
} from './cat-job-worker-client'
import { resolveLinguistBindingStatus, type LinguistServiceResolver } from './session-binding'

export type LinguistProjectMutationSink = (event: LinguistProjectMutationEvent) => void

const projectMutationRevisions = new Map<string, number>()

function currentBoundSession(sessionId: string, projectId: string, field: string): AgentSessionMeta {
  const current = getAgentSessionMeta(sessionId)
  if (current?.linguistProjectId !== projectId) {
    throw new LinguistCatInvalidArgumentError(field, 'session is no longer bound to this project')
  }
  return current
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

export function resolveLinguistSessionCatTools(
  session: Pick<
    AgentSessionMeta,
    | 'id'
    | 'modelId'
    | 'linguistProjectId'
    | 'linguistRole'
    | 'linguistDelegatedScope'
  > | undefined,
  getService: LinguistServiceResolver,
  onProjectMutation?: LinguistProjectMutationSink,
  generationProvenance?: (toolCallId: string) => LinguistGenerationProvenance,
  turnContext?: Pick<LinguistTurnContextV1, 'assetId'>,
) {
  const projectId = session?.linguistProjectId
  if (!projectId) return []
  const resolveProject: ResolveLinguistCatProject = () => {
    const service = getService()
    if (resolveLinguistBindingStatus(projectId, service) === 'missing') {
      return new LinguistCatProjectMissingError(projectId)
    }
    return { project: service.getProject(projectId), db: service.openProject(projectId) }
  }
  return createLinguistCatTools({
    resolveProject,
    resultProjectId: projectId,
    sessionId: session.id,
    ...(session.linguistRole === undefined ? {} : { linguistRole: session.linguistRole }),
    ...(session.linguistDelegatedScope !== undefined
      ? { reviewScopeSegmentIds: session.linguistDelegatedScope.segmentIds }
      : turnContext?.assetId === undefined
        ? {}
        : {
            reviewScopeSegmentIds: getService()
              .openProject(projectId)
              .segments.queryIds({ assetId: turnContext.assetId }),
          }),
    readContextImage: async (docId) => {
      currentBoundSession(session.id, projectId, 'docId')
      try {
        const { sourcePath } = getService().resolveContextDocPreviewPath(projectId, docId)
        const { createReadToolDefinition } = await import('@earendil-works/pi-coding-agent')
        const managedContextImageReader = createReadToolDefinition(process.cwd())
        const result = await managedContextImageReader.execute(
          'cat-context-image',
          { path: sourcePath },
          undefined,
          undefined,
          {} as never,
        )
        const image = result.content.find((block) => block.type === 'image')
        if (image === undefined) throw new Error('not an inline image')
        return { data: image.data, mimeType: image.mimeType }
      } catch {
        throw new LinguistCatInvalidArgumentError(
          'docId',
          'managed context image is unavailable or not supported',
        )
      }
    },
    consistencyWorker: runLinguistConsistencyWorker,
    qaWorker: runLinguistQaWorker,
    importIntakeAsset: (filePath, resourceKind, xlsxMapping) => {
      const current = currentBoundSession(session.id, projectId, 'filePath')
      return getService().importFileResource(
        projectId,
        resolveAgentExecutionScope(current).cwd,
        filePath,
        resourceKind,
        xlsxMapping,
      )
    },
    importResources: (input) => {
      const current = currentBoundSession(session.id, projectId, 'paths')
      return getService().importResourcesFromPaths(
        projectId,
        resolveAgentExecutionScope(current).cwd,
        input,
      )
    },
    refreshProjectEvidenceInventory: () => {
      const current = currentBoundSession(session.id, projectId, 'inventory')
      const service = getService()
      return service.refreshEvidenceInventory(
        projectId,
        resolveProjectDiscoveryScope({ session: current }),
      )
    },
    previewWorkbookMapping: (filePath) => {
      const current = currentBoundSession(session.id, projectId, 'filePath')
      return getService().previewWorkbookMapping(
        projectId,
        resolveAgentExecutionScope(current).cwd,
        filePath,
      )
    },
    saveWorkbookMapping: (filePath, input) => {
      const current = currentBoundSession(session.id, projectId, 'filePath')
      return getService().saveWorkbookMapping(
        projectId,
        resolveAgentExecutionScope(current).cwd,
        filePath,
        input,
      )
    },
    exportAsset: async (assetId, destinationPath, validation, overwrite) => {
      currentBoundSession(session.id, projectId, 'assetId')
      const { mode, ...result } = await getService().exportAssetToPath(
        projectId,
        assetId,
        destinationPath,
        validation,
        overwrite,
      )
      return { ...result, validation: mode }
    },
    scanUnknownTagPatterns: (assetIds, sampleLimit) =>
      getService().scanUnknownTagPatterns(projectId, assetIds, sampleLimit),
    saveTagProfileCandidate: (input, activate) => {
      const service = getService()
      const saved = service.saveTagProfileCandidate(projectId, input, undefined, activate)
      if (!saved.candidate || !saved.validation) throw new Error('Tag Profile candidate save returned no candidate')
      return {
        candidateId: saved.candidate.id,
        status: activate ? 'active' : 'candidate',
        validation: saved.validation,
      }
    },
    onMutation: (mutation) => {
      onProjectMutation?.(createLinguistProjectMutationEvent(projectId, mutation))
    },
    ...(session.modelId === undefined ? {} : { modelId: session.modelId }),
    ...(generationProvenance === undefined ? {} : { generationProvenance }),
  })
}

/** cat_* 与本轮其他工具撞名时 fail closed。 */
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
