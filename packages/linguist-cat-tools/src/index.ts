/**
 * @linguist/cat-tools — session-bound Linguist CAT tools as Pi ToolDefinitions
 * (PB-041). Depends on @linguist/cat-core (domain) and @linguist/cat-store
 * (persistence); Pi tool types come from @earendil-works/pi-coding-agent.
 * Electron-free: the host injects resolveProject (session binding → open
 * project handle); PB-042 wires the Electron side.
 *
 * The store runs on node:sqlite, so behavior tests run via the package
 * `test` script (node --test, see src/*.nodetest.ts); pure logic tests run
 * under plain bun (src/*.test.ts).
 */

export {
  LINGUIST_CAT_TOOL_ERROR_CODES,
  LinguistCatAssetNotFoundError,
  LinguistCatBindingMissingError,
  LinguistCatInvalidArgumentError,
  LinguistCatProjectMissingError,
  LinguistCatToolError,
  type LinguistCatToolErrorCode,
} from './errors'

export { pageHasMore, resolvePage, type PageLimits, type PageRequest, type ResolvedPage } from './pagination'

export {
  CAT_TOOL_PAGE_LIMITS,
  LINGUIST_CAT_TOOL_NAMES,
  type CatAssetListItem,
  type CatApplyTranslationsResult,
  type CatBatchConsistencyFindingItem,
  type CatBatchConsistencyGroupItem,
  type CatConsistencyPlanResult,
  type CatCreateConsistencyProposalsResult,
  type CatEvidenceRef,
  type CatGetTranslationContextResult,
  type CatProjectSummaryResult,
  type CatProposalReviewSnapshot,
  type CatProposalReviewSnapshotStatus,
  type CatProposeTranslationsResult,
  type CatQaFindingItem,
  type CatReadContextDocResult,
  type CatSearchResult,
  type CatSearchSentencePatternsResult,
  type CatSearchTermsResult,
  type CatSearchTmResult,
  type CatSegmentListItem,
  type CatSegmentBrief,
  type CatWorkerJobProgress,
  type LinguistCatToolCallInfo,
  type LinguistCatToolMutation,
  type LinguistCatToolName,
  type LinguistCatToolsDeps,
  type LinguistIntakeImportResult,
  type LinguistImportResourceItem,
  type LinguistImportResourcesInput,
  type LinguistImportResourcesResult,
  type LinguistExportAssetResult,
  type LinguistIntakeResourceKind,
  type LinguistIntakeXlsxMapping,
  type LinguistSaveWorkbookMappingInput,
  type LinguistWorkbookMappingPreview,
  type LinguistWorkbookMappingSuggestion,
  type LinguistConsistencyWorker,
  type LinguistConsistencyWorkerRequest,
  type LinguistConsistencyWorkerResult,
  type LinguistQaWorker,
  type LinguistQaWorkerRequest,
  type LinguistQaWorkerResult,
  type PagedResult,
  type ResolvedLinguistCatProject,
  type ResolveLinguistCatProject,
  type SegmentTranslationContext,
} from './types'

export {
  runCheckpointedWorkerJob,
  runConsistencyPlanWorkerJob,
  runQaWorkerJob,
  type CheckpointedWorkerJobInput,
  type ConsistencyPlanWorkerJobInput,
  type QaWorkerJobInput,
  type WorkerJobComputation,
  type WorkerJobProgress,
} from './job-runner'

export { createLinguistCatTools } from './factory'
export { createTagTools } from './tag-tools'
export { createTerminologyTools } from './terminology-tools'
