import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'
import type {
  LinguistIntakeImportResult,
  LinguistIntakeResourceKind,
} from './types'

const RESOURCE_KINDS = new Set<LinguistIntakeResourceKind>(['batch', 'tm', 'terms', 'context'])

/** 路径只在宿主按会话授权根校验后使用，永不进入结果 DTO。 */
export function createIntakeTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const importAssetTool = defineTool({
    name: 'cat_import_asset',
    label: 'CAT import asset',
    description:
      'Import a batch, translation memory, termbase, or Context document from the current session workspace ' +
      'or a file/directory explicitly authorized for this bound Linguist session. The host validates the path ' +
      'against those roots and never accepts a project id. TM/TB imports create searchable internal evidence ids.',
    promptSnippet: 'Register an authorized file as a batch, TM, termbase, or Context resource',
    parameters: Type.Object({
      filePath: Type.String({ minLength: 1, description: 'Absolute authorized path, or a path relative to the session workspace.' }),
      resourceKind: Type.Union([
        Type.Literal('batch'),
        Type.Literal('tm'),
        Type.Literal('terms'),
        Type.Literal('context'),
      ]),
      xlsxMapping: Type.Optional(Type.Object({
        sheetName: Type.String({ minLength: 1 }),
        columns: Type.Object({
          source: Type.String({ minLength: 1 }),
          target: Type.String({ minLength: 1 }),
        }),
      })),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_import_asset', toolCallId)
      if (deps.importIntakeAsset === undefined) {
        throw new LinguistCatInvalidArgumentError(
          'filePath',
          'session intake is unavailable',
        )
      }
      if (typeof params.filePath !== 'string' || params.filePath.trim() === '') {
        throw new LinguistCatInvalidArgumentError('filePath', 'must be a non-blank path')
      }
      if (!RESOURCE_KINDS.has(params.resourceKind as LinguistIntakeResourceKind)) {
        throw new LinguistCatInvalidArgumentError('resourceKind', 'must be batch, tm, terms, or context')
      }
      const result: LinguistIntakeImportResult = await deps.importIntakeAsset(
        params.filePath,
        params.resourceKind as LinguistIntakeResourceKind,
        params.xlsxMapping,
      )
      notifyMutation({ kind: 'project-updated' })
      return toolResult(result, deps.resultProjectId)
    },
  })

  return [importAssetTool] as const
}
