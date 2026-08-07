import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'

/** 当前 Agent 使用确定性扫描结果判断 Tag，不嵌套第二个模型。 */
export function createTagTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject } = runtime

  const scanTool = defineTool({
    name: 'cat_scan_unknown_tag_patterns',
    label: 'Scan unknown tag patterns',
    description: 'Deterministically scan the bound project for unregistered bracket, brace, angle, dollar and custom escape shapes. Returns examples and preservation evidence; never activates a profile.',
    promptSnippet: 'Scan unknown tag-like patterns before proposing a project Tag Profile',
    parameters: Type.Object({
      assetIds: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
      sampleLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_scan_unknown_tag_patterns', toolCallId)
      if (!deps.scanUnknownTagPatterns) {
        throw new LinguistCatInvalidArgumentError('assetIds', 'unknown Tag scanning is unavailable in this host')
      }
      return toolResult(
        { patterns: deps.scanUnknownTagPatterns(params.assetIds, params.sampleLimit), activated: false },
        deps.resultProjectId,
      )
    },
  })

  const saveTool = defineTool({
    name: 'cat_save_tag_profile_candidate',
    label: 'Save tag profile candidate',
    description: 'Validate and save a Tag Profile candidate in the bound project from scan evidence. It remains soft-protected unless activate=true was explicitly requested by the user.',
    promptSnippet: 'Save a validated project Tag Profile candidate',
    promptGuidelines: [
      'Do not set activate=true unless the user explicitly asked to automatically identify and lock high-confidence tags.',
    ],
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 80 }),
      regex: Type.String({ minLength: 1, maxLength: 240 }),
      kind: Type.Union([Type.Literal('standalone'), Type.Literal('opening'), Type.Literal('closing')]),
      pairKey: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
      evidenceExampleIds: Type.Array(Type.String(), { minItems: 1, maxItems: 50 }),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      explanation: Type.String({ minLength: 1, maxLength: 500 }),
      activate: Type.Optional(Type.Boolean()),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_save_tag_profile_candidate', toolCallId)
      if (!deps.saveTagProfileCandidate) {
        throw new LinguistCatInvalidArgumentError('regex', 'Tag Profile persistence is unavailable in this host')
      }
      const result = deps.saveTagProfileCandidate({
        name: params.name,
        regex: params.regex,
        kind: params.kind,
        ...(params.pairKey === undefined ? {} : { pairKey: params.pairKey }),
        evidenceExampleIds: params.evidenceExampleIds,
        confidence: params.confidence,
        explanation: params.explanation,
      }, params.activate ?? false)
      runtime.notifyMutation({ kind: 'project-updated' })
      return toolResult(result, deps.resultProjectId)
    },
  })

  return [scanTool, saveTool] as const
}
