import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'
import type {
  LinguistImportResourceKind,
  LinguistImportResourceItem,
  LinguistImportResourcesResult,
  LinguistProjectEvidenceInventoryResult,
} from './types'
import type { UnknownTagPatternResult } from '@linguist/cat-core'

const IMPORT_KINDS = new Set<LinguistImportResourceKind>(['auto', 'batch', 'tm', 'tb', 'context'])

function tagPatternOverview(patterns: UnknownTagPatternResult[] | undefined) {
  if (patterns === undefined) return undefined
  return {
    count: patterns.length,
    patterns: patterns.map((pattern) => ({
      shape: pattern.patternShape,
      frequency: pattern.frequency,
      exampleCount: pattern.examples.length,
      example: pattern.examples[0],
    })),
    detailTool: 'cat_scan_unknown_tag_patterns',
  }
}

function batchResourceItem({ resourceId, ...item }: LinguistImportResourceItem) {
  return {
    ...item,
    ...(resourceId === undefined ? {} : item.resourceKind === 'batch'
      ? { batchId: resourceId }
      : { resourceId }),
  }
}

function importToolResult<T extends object>(details: T, modelDetails: object, projectId?: string) {
  const result = toolResult(modelDetails, projectId)
  return {
    ...result,
    details: projectId === undefined ? details : { ...details, projectId },
  }
}

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
      const details = {
        ...result,
        items: result.items.map(batchResourceItem),
      }
      return importToolResult(details, {
        ...details,
        items: details.items.map(({ unknownTagSummary, ...item }) => ({
          ...item,
          ...(unknownTagSummary === undefined ? {} : { unknownTagSummary: tagPatternOverview(unknownTagSummary) }),
        })),
      }, deps.resultProjectId)
    },
  })

  const refreshProjectInventoryTool = defineTool({
    name: 'cat_refresh_project_inventory',
    label: 'CAT refresh project inventory',
    description: 'Refresh the inventory of sources and references within the host-authorized project scope. This records inventory facts/gaps but does not import or translate files and is not proof of reading their contents. Use when inventory is missing, inputs changed or relevant references are unaccounted for; reuse a still-current result in the same task. Do not refresh for an explicit no-project-writes request. Distinguish source batches, reference assets, mapping and media; investigate solvable gaps with existing tools. A warning alone does not stop unrelated work or authorize excluding required evidence.',
    promptSnippet: 'Refresh the host-authorized batch and reference inventory before formal stage work',
    parameters: Type.Object({}),
    async execute(toolCallId) {
      resolveBoundProject('cat_refresh_project_inventory', toolCallId)
      if (deps.refreshProjectEvidenceInventory === undefined) {
        throw new LinguistCatInvalidArgumentError('inventory', 'project evidence inventory is unavailable')
      }
      const result: LinguistProjectEvidenceInventoryResult =
        await deps.refreshProjectEvidenceInventory()
      notifyMutation({ kind: 'project-updated' })
      return toolResult({ ...result, items: result.items.map(batchResourceItem) }, deps.resultProjectId)
    },
  })

  return [importResourcesTool, refreshProjectInventoryTool] as const
}
