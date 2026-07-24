import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { CatWorkspace, LibraryPersistence } from "@linguist-agent/cat-data";
import { createAssetBlocksBuildTool, createAssetBlockSearchTool } from "./asset_block_tools.js";
import { createAssistantLibraryTools } from "./assistant-library-tools.js";
import { createRecordDecisionTool } from "./decision_tools.js";
import {
  createBatchImportCsvTool,
  createBatchImportMqxliffTool,
  createBatchImportPhraseTool,
  createBatchImportSdlxliffTool,
  createBatchImportXliffTool,
  createBatchImportXlsxTool,
  createBatchReadTool,
  createBatchSetTargetsTool,
  createSegmentSetTargetTool,
} from "./batch_workspace.js";
import {
  createDeliveryAcceptRiskTool,
  createDeliveryCheckTool,
  createDeliveryReadinessTool,
  createExportCsvTool,
  createExportPhraseDocxTool,
  createExportPhraseMxliffTool,
  createExportMqxliffTool,
  createExportSdlxliffTool,
  createExportXliffTool,
  createExportXlsxTool,
} from "./delivery_tools.js";
import { createDeliveryQaTool } from "./delivery_qa_tools.js";
import { createAssetGrepTool, createAssetReadTool, createGlossaryImportTool, createGlossaryLookupTool } from "./evidence_tools.js";
import { createCustomerReturnLearnTool } from "./customer_return_tools.js";
import { createEvidencePackTool } from "./evidence_pack_tools.js";
import { createPhraseQaRunTool, createPlatformBackfillRunTool } from "./platform_ops_tools.js";
import { createProposalApplyTool, createProposalCreateTool, createProposalReadTool, createProposalReportTool } from "./proposal_tools.js";
import { createQualityAuditTool, createQualityWaiverTool, createExpressiveAuditTool, createConstraintPackTool } from "./quality_tools.js";
import { createProjectContextTool, createProjectHealthTool, createProjectOnboardTool, createProjectReadTool, createProjectRefreshTool } from "./project_onboard.js";
import {
  createTermbaseConflictAuditTool,
  createTermbaseImportSdltbTool,
  createTermbaseImportTableTool,
  createTermbaseImportTbxTool,
  createTermbaseLookupTool,
  createTermbaseOverrideTool,
} from "./termbase_tools.js";
import { createTmConcordanceTool, createTmImportSdltmTool, createTmImportTableTool, createTmImportTmxTool, createTmLookupTool } from "./tm_lookup.js";
import { createCatToolsListTool } from "./tool_catalog.js";
import { applyCatToolPolicies } from "./tool_policy.js";
import { createExemplarAddTool, createExemplarLookupTool, createVoiceProfileBuildTool, createVoiceProfileConfirmTool } from "./voice_tools.js";
import { createWebFetchTool, createWebSearchTool } from "./web_bridge_tools.js";
import {
  createAssetMappingProfileSaveTool,
  createAssetMappingSuggestTool,
  createAssetParsePreviewTool,
  createWorkbookAssetImportTool,
  createWorkbookAssetPlanTool,
  createWorkbookMappingCandidatesTool,
  createWorkbookPreviewTool,
} from "./workbook_tools.js";

export interface BuildCatToolsOptions {
  includeWebBridges?: boolean;
  libraryPersistence?: LibraryPersistence;
}

export function buildCatTools(
  workspace: CatWorkspace,
  options: BuildCatToolsOptions = {},
): ToolDefinition[] {
  const includeWebBridges = options.includeWebBridges ?? true;
  const tools = [
    createCatToolsListTool(),
    ...(includeWebBridges ? [createWebSearchTool(), createWebFetchTool()] : []),
    createProjectOnboardTool(),
    createProjectReadTool(),
    createProjectRefreshTool(),
    createProjectHealthTool(),
    createProjectContextTool(),
    createBatchImportPhraseTool(),
    createBatchImportMqxliffTool(),
    createBatchImportSdlxliffTool(),
    createBatchImportXliffTool(),
    createBatchImportCsvTool(),
    createBatchImportXlsxTool(),
    createBatchReadTool(),
    createBatchSetTargetsTool(),
    createSegmentSetTargetTool(),
    createDeliveryCheckTool(),
    createDeliveryReadinessTool(),
    createDeliveryQaTool(workspace),
    createDeliveryAcceptRiskTool(),
    createExportPhraseMxliffTool(),
    createExportPhraseDocxTool(),
    createExportMqxliffTool(),
    createExportSdlxliffTool(),
    createExportXliffTool(),
    createExportCsvTool(),
    createExportXlsxTool(),
    createAssetParsePreviewTool(),
    createAssetMappingSuggestTool(),
    createAssetMappingProfileSaveTool(),
    createWorkbookMappingCandidatesTool(),
    createWorkbookPreviewTool(),
    createWorkbookAssetPlanTool(),
    createWorkbookAssetImportTool(),
    createTermbaseImportTableTool(),
    createTermbaseImportTbxTool(),
    createTermbaseImportSdltbTool(),
    createTermbaseOverrideTool(),
    createTermbaseConflictAuditTool(),
    createTermbaseLookupTool(),
    createTmImportTableTool(),
    createTmImportTmxTool(),
    createTmImportSdltmTool(),
    createTmConcordanceTool(workspace),
    createGlossaryImportTool(),
    createGlossaryLookupTool(),
    createEvidencePackTool(workspace),
    createAssetBlocksBuildTool(),
    createAssetBlockSearchTool(),
    ...createAssistantLibraryTools({ runtimeRoot: workspace.root, scope: { kind: "project", projectId: workspace.projectId }, includePersonal: true, persistence: options.libraryPersistence }),
    createAssetGrepTool(),
    createAssetReadTool(),
    createProposalCreateTool(),
    createProposalReadTool(),
    createProposalReportTool(),
    createProposalApplyTool(),
    createPlatformBackfillRunTool(workspace),
    createPhraseQaRunTool(workspace),
    createRecordDecisionTool(workspace),
    createCustomerReturnLearnTool(workspace),
    createQualityAuditTool(workspace),
    createQualityWaiverTool(workspace),
    createExpressiveAuditTool(workspace),
    createConstraintPackTool(workspace),
    createVoiceProfileBuildTool(workspace),
    createVoiceProfileConfirmTool(workspace),
    createExemplarLookupTool(workspace),
    createExemplarAddTool(workspace),
    createTmLookupTool(workspace),
  ];
  return applyCatToolPolicies(tools);
}

export {
  createBatchImportCsvTool,
  createBatchImportMqxliffTool,
  createBatchImportPhraseTool,
  createBatchImportSdlxliffTool,
  createBatchImportXliffTool,
  createBatchImportXlsxTool,
  createBatchReadTool,
  createBatchSetTargetsTool,
  createSegmentSetTargetTool,
};
export {
  createDeliveryAcceptRiskTool,
  createDeliveryCheckTool,
  createDeliveryQaTool,
  createDeliveryReadinessTool,
  createExportCsvTool,
  createExportPhraseDocxTool,
  createExportPhraseMxliffTool,
  createExportMqxliffTool,
  createExportSdlxliffTool,
  createExportXliffTool,
  createExportXlsxTool,
};
export { createAssetBlocksBuildTool, createAssetBlockSearchTool };
export { createUpdatePlanTool } from "./update-plan-tool.js";
export { createPresentAnswerTool } from "./present-answer-tool.js";
export { createAssetGrepTool, createAssetReadTool, createGlossaryImportTool, createGlossaryLookupTool };
export { createCustomerReturnLearnTool };
export { createEvidencePackTool };
export { createProposalApplyTool, createProposalCreateTool, createProposalReadTool, createProposalReportTool };
export { createPhraseQaRunTool, createPlatformBackfillRunTool };
export { createQualityAuditTool, createQualityWaiverTool, createExpressiveAuditTool, createConstraintPackTool };
export { createProjectContextTool, createProjectHealthTool, createProjectOnboardTool, createProjectReadTool, createProjectRefreshTool };
export { createTermbaseConflictAuditTool, createTermbaseImportSdltbTool, createTermbaseImportTableTool, createTermbaseImportTbxTool, createTermbaseLookupTool, createTermbaseOverrideTool };
export { createTmConcordanceTool, createTmImportSdltmTool, createTmImportTableTool, createTmImportTmxTool, createTmLookupTool };
export { createExemplarAddTool, createExemplarLookupTool, createVoiceProfileBuildTool, createVoiceProfileConfirmTool };
export { catToolMetadataFor, createCatToolsListTool, listCatToolMetadata, renderCatToolCatalog, type CatToolMetadata } from "./tool_catalog.js";
export { applyCatToolPolicies, applyCatToolPolicy, catEvidenceViolations, prepareCatToolArguments, type CatToolPolicyDetails } from "./tool_policy.js";
export { buildTeamEvidenceTools, type TeamEvidenceScopeResolver } from "./team_evidence_tools.js";
export { WEB_BRIDGE_USER_AGENT } from "./web_bridge_tools.js";
export { authorizeStoredWebCredentialReference, createWebFetchTool, createWebSearchTool } from "./web_bridge_tools.js";
export {
  createAssetMappingProfileSaveTool,
  createAssetMappingSuggestTool,
  createAssetParsePreviewTool,
  createWorkbookAssetImportTool,
  createWorkbookAssetPlanTool,
  createWorkbookMappingCandidatesTool,
  createWorkbookPreviewTool,
};
export { createAssistantMemoryTools } from "./assistant-memory-tools.js";
export { legacyTdaiMemoryRuntimeStatus } from "./memory-tools.js";
export { createAssistantLibraryTools } from "./assistant-library-tools.js";
export { createStandaloneDocumentTools } from "./document-capability-tools.js";
