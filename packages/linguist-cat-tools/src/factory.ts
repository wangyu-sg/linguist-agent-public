/**
 * CAT Tool 对外工厂。
 *
 * 项目 authority 统一由 runtime 从 Session binding 解析；各领域模块只
 * 创建自己的 ToolDefinition，工厂负责保持公开顺序与独立审计白名单。
 */

import { createProjectTools } from './project-tools'
import { createIntakeTools } from './intake-tools'
import { createProposalTools } from './proposal-tools'
import { createQaTools } from './qa-tools'
import { createReferenceTools } from './reference-tools'
import { createCatToolRuntime } from './tool-runtime'
import type { LinguistCatToolsDeps } from './types'

/**
 * 返回值可直接合并到 Pi queryOptions.customTools。
 * independent-audit 只暴露证据读取，不暴露 QA 结论、提案或写工具。
 */
export function createLinguistCatTools(deps: LinguistCatToolsDeps) {
  const runtime = createCatToolRuntime(deps)
  const [projectSummaryTool, listAssetsTool, getSegmentsTool] =
    createProjectTools(runtime)
  const [listIntakeSourcesTool, importAssetTool] = createIntakeTools(runtime)
  const [
    getTranslationContextTool,
    searchTmTool,
    searchTermsTool,
    searchSentencePatternsTool,
    readContextDocTool,
  ] = createReferenceTools(runtime)
  const [
    getProposalSnapshotTool,
    proposeTranslationsTool,
    submitCriticReviewTool,
    planConsistencyRepairsTool,
    createConsistencyProposalsTool,
  ] = createProposalTools(runtime)
  const [runQaTool, getQaFindingsTool] = createQaTools(runtime)

  const standardTools = [
    projectSummaryTool,
    listAssetsTool,
    getSegmentsTool,
    listIntakeSourcesTool,
    importAssetTool,
    getTranslationContextTool,
    getProposalSnapshotTool,
    searchTmTool,
    searchTermsTool,
    proposeTranslationsTool,
    runQaTool,
    getQaFindingsTool,
    submitCriticReviewTool,
    planConsistencyRepairsTool,
    createConsistencyProposalsTool,
    searchSentencePatternsTool,
    readContextDocTool,
  ]
  if (deps.sessionMode !== 'independent-audit') return standardTools
  return [
    projectSummaryTool,
    listAssetsTool,
    getSegmentsTool,
    getTranslationContextTool,
    searchTmTool,
    searchTermsTool,
    searchSentencePatternsTool,
    readContextDocTool,
  ]
}
