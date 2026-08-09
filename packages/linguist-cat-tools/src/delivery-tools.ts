import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'

/** 生成并保存交付文件；宿主负责目标路径与会话 authority。 */
export function createDeliveryTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime
  return [defineTool({
    name: 'cat_export_asset',
    label: 'CAT export asset',
    description:
      'Export a batch from the bound Linguist project directly to an absolute local file. Verified mode runs delivery preflight; ' +
      'as-is mode permits incomplete content but still performs format round-trip verification. ' +
      'This saves a local file only; it does not upload or send it.',
    promptSnippet: 'Export a verified batch or an explicitly requested as-is batch',
    promptGuidelines: ['Set overwrite=true only when the user explicitly asks to replace the destination file.'],
    parameters: Type.Object({
      assetId: Type.String({ minLength: 1 }),
      destinationPath: Type.String({ minLength: 1, description: 'Absolute local file path, including its filename.' }),
      mode: Type.Optional(Type.Union([Type.Literal('verified'), Type.Literal('as-is')], { default: 'verified' })),
      overwrite: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_export_asset', toolCallId)
      if (deps.exportAsset === undefined) {
        throw new LinguistCatInvalidArgumentError('destinationPath', 'local export is unavailable')
      }
      const result = await deps.exportAsset(
        params.assetId,
        params.destinationPath,
        params.mode ?? 'verified',
        params.overwrite ?? false,
      )
      notifyMutation({ kind: 'project-updated' })
      return toolResult(result, deps.resultProjectId)
    },
  })] as const
}
