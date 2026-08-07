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
      'Export a delivery-ready batch from the bound Linguist project directly to a new absolute local file. ' +
      'The host revalidates the session binding, QA/preflight, destination, non-overwrite rule, and file digest. ' +
      'This saves a local file only; it does not upload or send it.',
    promptSnippet: 'Export a verified batch to a new absolute local file',
    parameters: Type.Object({
      assetId: Type.String({ minLength: 1 }),
      destinationPath: Type.String({ minLength: 1, description: 'Absolute path for a new local file, including its filename.' }),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_export_asset', toolCallId)
      if (deps.exportAsset === undefined) {
        throw new LinguistCatInvalidArgumentError('destinationPath', 'local export is unavailable')
      }
      const result = await deps.exportAsset(params.assetId, params.destinationPath)
      notifyMutation({ kind: 'project-updated' })
      return toolResult(result, deps.resultProjectId)
    },
  })] as const
}
