import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'
import type {
  LinguistImportResourceKind,
  LinguistImportResourcesResult,
  LinguistIntakeImportResult,
  LinguistIntakeResourceKind,
  LinguistProjectEvidenceInventoryResult,
} from './types'

const RESOURCE_KINDS = new Set<LinguistIntakeResourceKind>(['batch', 'tm', 'terms', 'context'])
const IMPORT_KINDS = new Set<LinguistImportResourceKind>(['auto', 'batch', 'tm', 'tb', 'context'])

/** 路径只在宿主按会话授权根校验后使用，永不进入结果 DTO。 */
export function createIntakeTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const importResourcesTool = defineTool({
    name: 'cat_import_resources',
    label: 'CAT import resources',
    description: 'Import files or directories into the bound project. Paths follow the current Proma session permissions. Auto mode classifies batches, TM, TB, and Context; ambiguous mappings are returned as needsInput and a 500-file scan returns truncated=true.',
    promptSnippet: 'Import one or more project resources from files or directories',
    parameters: Type.Object({
      paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 }),
      recursive: Type.Optional(Type.Boolean()),
      kind: Type.Optional(Type.Union([
        Type.Literal('auto'),
        Type.Literal('batch'),
        Type.Literal('tm'),
        Type.Literal('tb'),
        Type.Literal('context'),
      ])),
      dryRun: Type.Optional(Type.Boolean()),
      xlsxMapping: Type.Optional(Type.Object({
        sheetName: Type.String({ minLength: 1 }),
        columns: Type.Object({
          key: Type.Optional(Type.String({ minLength: 1 })),
          source: Type.String({ minLength: 1 }),
          target: Type.String({ minLength: 1 }),
          locked: Type.Optional(Type.String({ minLength: 1 })),
          context: Type.Optional(Type.String({ minLength: 1 })),
        }),
      })),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_import_resources', toolCallId)
      if (deps.importResources === undefined) {
        throw new LinguistCatInvalidArgumentError('paths', 'resource intake is unavailable')
      }
      const kind = (params.kind ?? 'auto') as LinguistImportResourceKind
      if (!IMPORT_KINDS.has(kind)) {
        throw new LinguistCatInvalidArgumentError('kind', 'must be auto, batch, tm, tb, or context')
      }
      const result: LinguistImportResourcesResult = await deps.importResources({
        paths: params.paths,
        recursive: params.recursive ?? false,
        kind,
        dryRun: params.dryRun ?? false,
        xlsxMapping: params.xlsxMapping,
      })
      if (result.imported > 0) notifyMutation({ kind: 'project-updated' })
      return toolResult(result, deps.resultProjectId)
    },
  })

  const importAssetTool = defineTool({
    name: 'cat_import_asset',
    label: 'CAT import asset',
    description:
      'Compatibility alias for importing one batch, translation memory, termbase, or Context document into the bound project. ' +
      'Paths follow the current Proma session permissions; the model never supplies a project id.',
    promptSnippet: 'Register a readable file as a batch, TM, termbase, or Context resource',
    parameters: Type.Object({
      filePath: Type.String({ minLength: 1, description: 'Absolute path, or a path relative to the current session cwd.' }),
      resourceKind: Type.Union([
        Type.Literal('batch'),
        Type.Literal('tm'),
        Type.Literal('terms'),
        Type.Literal('context'),
      ]),
      xlsxMapping: Type.Optional(Type.Object({
        sheetName: Type.String({ minLength: 1 }),
        columns: Type.Object({
          key: Type.Optional(Type.String({ minLength: 1 })),
          source: Type.String({ minLength: 1 }),
          target: Type.String({ minLength: 1 }),
          locked: Type.Optional(Type.String({ minLength: 1 })),
          context: Type.Optional(Type.String({ minLength: 1 })),
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

  const refreshProjectInventoryTool = defineTool({
    name: 'cat_refresh_project_inventory',
    label: 'CAT refresh project inventory',
    description: 'Refresh the bound project evidence inventory across host-authorized workspace and attachment locations. The model cannot provide scan paths. Returns host-persisted gaps for unreadable, ambiguous, unsupported, truncated, or version-conflicting evidence.',
    promptSnippet: 'Refresh the host-authorized project asset and evidence inventory before formal stage work',
    parameters: Type.Object({}),
    async execute(toolCallId) {
      resolveBoundProject('cat_refresh_project_inventory', toolCallId)
      if (deps.refreshProjectEvidenceInventory === undefined) {
        throw new LinguistCatInvalidArgumentError('inventory', 'project evidence inventory is unavailable')
      }
      const result: LinguistProjectEvidenceInventoryResult =
        await deps.refreshProjectEvidenceInventory()
      notifyMutation({ kind: 'project-updated' })
      return toolResult(result, deps.resultProjectId)
    },
  })

  return [importResourcesTool, refreshProjectInventoryTool, importAssetTool] as const
}
