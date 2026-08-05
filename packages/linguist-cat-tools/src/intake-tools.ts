import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'
import type {
  LinguistIntakeImportResult,
  LinguistIntakeSource,
} from './types'

/** 会话附件的最小导入桥；路径 authority 留在宿主，CAT tool 只接 opaque token。 */
export function createIntakeTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject } = runtime

  const listIntakeSourcesTool = defineTool({
    name: 'cat_list_intake_sources',
    label: 'CAT list intake sources',
    description:
      'List files explicitly attached to the bound Linguist session for single-file intake. ' +
      'Each item has an opaque sourceToken, basename, size, and readiness; no filesystem path ' +
      'is exposed. Directory scanning is not available in this Alpha.',
    promptSnippet: 'List attached files available for CAT intake',
    parameters: Type.Object({}),
    async execute(toolCallId) {
      resolveBoundProject('cat_list_intake_sources', toolCallId)
      const sources = deps.listIntakeSources?.() ?? []
      return toolResult({
        sources: sources.map((source): LinguistIntakeSource => ({ ...source })),
        ...(sources.length === 0
          ? { note: 'No session-attached files are available for intake.' }
          : {}),
      }, deps.resultProjectId)
    },
  })

  const importAssetTool = defineTool({
    name: 'cat_import_asset',
    label: 'CAT import asset',
    description:
      'Import one explicitly attached file into the bound CAT project. Pass only a sourceToken ' +
      'returned by cat_list_intake_sources; never pass a path or project id. The host revalidates ' +
      'the attachment and reuses the same ProjectDelivery import pipeline as the UI, including ' +
      'size, format, and exact-duplicate checks.',
    promptSnippet: 'Import one attached CAT source file',
    parameters: Type.Object({
      sourceToken: Type.String({ description: 'Opaque token from cat_list_intake_sources.' }),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_import_asset', toolCallId)
      if (deps.importIntakeAsset === undefined) {
        throw new LinguistCatInvalidArgumentError(
          'sourceToken',
          'session intake is unavailable',
        )
      }
      const sourceToken = params.sourceToken
      if (typeof sourceToken !== 'string' || sourceToken.trim() === '') {
        throw new LinguistCatInvalidArgumentError('sourceToken', 'must be a non-blank opaque token')
      }
      const result: LinguistIntakeImportResult = await deps.importIntakeAsset(sourceToken)
      return toolResult(result, deps.resultProjectId)
    },
  })

  return [listIntakeSourcesTool, importAssetTool] as const
}
