/**
 * CAT Tool 对外工厂。
 *
 * 项目 authority 统一由 runtime 从 Session binding 解析；各领域模块只
 * 创建自己的 ToolDefinition，工厂只负责保持公开顺序。
 */

import { createProjectTools } from './project-tools'
import { createIntakeTools } from './intake-tools'
import { createProposalTools } from './proposal-tools'
import { createQaTools } from './qa-tools'
import { createReferenceTools } from './reference-tools'
import { createDeliveryTools } from './delivery-tools'
import { createTagTools } from './tag-tools'
import { createTerminologyTools } from './terminology-tools'
import { createWorkbookTools } from './workbook-tools'
import { createVoiceTools } from './voice-tools'
import { createStageTools } from './stage-tools'
import { createCatToolRuntime } from './tool-runtime'
import type { LinguistCatToolsDeps } from './types'

/**
 * 返回值可直接合并到 Pi queryOptions.customTools；所有 Linguist 岗位共享同一集合。
 */
export function createLinguistCatTools(deps: LinguistCatToolsDeps) {
  const runtime = createCatToolRuntime(deps)
  const [projectSummaryTool, listAssetsTool, getSegmentsTool] =
    createProjectTools(runtime)
  const [importResourcesTool, importAssetTool] = createIntakeTools(runtime)
  const [previewWorkbookMappingTool, saveWorkbookMappingTool] = createWorkbookTools(runtime)
  const [upsertVoiceProfileTool, addApprovedExemplarTool, getVoiceContextTool] = createVoiceTools(runtime)
  const [exportAssetTool] = createDeliveryTools(runtime)
  const [scanUnknownTagPatternsTool, saveTagProfileCandidateTool] = createTagTools(runtime)
  const [upsertTermsTool, deleteTermsTool, listTermConflictsTool, validateTermsTool] =
    createTerminologyTools(runtime)
  const [
    getTranslationContextTool,
    searchTmTool,
    searchTermsTool,
    searchSentencePatternsTool,
    readContextDocTool,
  ] = createReferenceTools(runtime)
  const [
    getProposalSnapshotTool,
    applyTranslationsTool,
    proposeTranslationsTool,
    acceptProposalsTool,
    planConsistencyRepairsTool,
    createConsistencyProposalsTool,
  ] = createProposalTools(runtime)
  const [runQaTool, getQaFindingsTool] = createQaTools(runtime)
  const [confirmSegmentsTool] = createStageTools(runtime)
  return [
    projectSummaryTool,
    listAssetsTool,
    getSegmentsTool,
    importResourcesTool,
    importAssetTool,
    previewWorkbookMappingTool,
    saveWorkbookMappingTool,
    upsertVoiceProfileTool,
    addApprovedExemplarTool,
    getVoiceContextTool,
    scanUnknownTagPatternsTool,
    saveTagProfileCandidateTool,
    exportAssetTool,
    getTranslationContextTool,
    getProposalSnapshotTool,
    applyTranslationsTool,
    confirmSegmentsTool,
    searchTmTool,
    searchTermsTool,
    upsertTermsTool,
    deleteTermsTool,
    listTermConflictsTool,
    validateTermsTool,
    proposeTranslationsTool,
    acceptProposalsTool,
    runQaTool,
    getQaFindingsTool,
    planConsistencyRepairsTool,
    createConsistencyProposalsTool,
    searchSentencePatternsTool,
    readContextDocTool,
  ]
}
