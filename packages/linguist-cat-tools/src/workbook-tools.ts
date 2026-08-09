import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'

const mappingColumns = Type.Object({
  key: Type.Optional(Type.String({ minLength: 1 })),
  source: Type.String({ minLength: 1 }),
  target: Type.String({ minLength: 1 }),
  context: Type.Optional(Type.String({ minLength: 1 })),
  speaker: Type.Optional(Type.String({ minLength: 1 })),
  status: Type.Optional(Type.String({ minLength: 1 })),
})

export function createWorkbookTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const previewTool = defineTool({
    name: 'cat_preview_workbook_mapping',
    label: 'CAT preview workbook mapping',
    description: 'Preview an XLSX file for the bound project, including sheets, physical sample rows, cell kinds, merged ranges, deterministic column suggestions, and any reusable mapping profile.',
    promptSnippet: 'Preview an XLSX workbook and suggest bilingual column mappings',
    parameters: Type.Object({
      filePath: Type.String({ minLength: 1, description: 'Absolute path, or a path relative to the current session cwd.' }),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_preview_workbook_mapping', toolCallId)
      if (deps.previewWorkbookMapping === undefined) {
        throw new LinguistCatInvalidArgumentError('filePath', 'workbook mapping preview is unavailable')
      }
      return toolResult(await deps.previewWorkbookMapping(params.filePath), deps.resultProjectId)
    },
  })

  const saveTool = defineTool({
    name: 'cat_save_workbook_mapping',
    label: 'CAT save workbook mapping',
    description: 'Validate an XLSX file again and save a lightweight reusable mapping profile in the bound project. The model never supplies a project id.',
    promptSnippet: 'Confirm and save an XLSX mapping profile for later imports',
    parameters: Type.Object({
      filePath: Type.String({ minLength: 1, description: 'The same readable XLSX path used for preview.' }),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      filenamePattern: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      sheetName: Type.String({ minLength: 1 }),
      columns: mappingColumns,
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_save_workbook_mapping', toolCallId)
      if (deps.saveWorkbookMapping === undefined) {
        throw new LinguistCatInvalidArgumentError('filePath', 'workbook mapping save is unavailable')
      }
      const saved = await deps.saveWorkbookMapping(params.filePath, {
        name: params.name,
        filenamePattern: params.filenamePattern,
        sheetName: params.sheetName,
        columns: params.columns,
      })
      notifyMutation({ kind: 'project-updated' })
      return toolResult(saved, deps.resultProjectId)
    },
  })

  return [previewTool, saveTool] as const
}
