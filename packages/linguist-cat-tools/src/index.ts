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
  type CatBatchConsistencyFindingItem,
  type CatBatchConsistencyGroupItem,
  type CatProjectSummaryResult,
  type CatProposeTranslationsResult,
  type CatReadContextDocResult,
  type CatRunBatchConsistencyResult,
  type CatSearchResult,
  type CatSearchSentencePatternsResult,
  type CatSearchTermsResult,
  type CatSearchTmResult,
  type CatSegmentListItem,
  type CatSubmitCriticReviewResult,
  type LinguistCatToolCallInfo,
  type LinguistCatToolMutation,
  type LinguistCatToolName,
  type LinguistCatToolsDeps,
  type PagedResult,
  type ResolvedLinguistCatProject,
  type ResolveLinguistCatProject,
} from './types'

export { createLinguistCatTools } from './factory'
