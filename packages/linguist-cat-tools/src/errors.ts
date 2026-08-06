/**
 * Typed errors for the Linguist CAT tools (PB-041). Mirrors the cat-store /
 * cat-formats error pattern: each error carries a stable machine-readable
 * `code` string — codes are part of the public contract and must never
 * change without a migration note.
 *
 * Pi tool-error convention (pi-agent-core AgentTool): tools THROW on
 * failure instead of encoding errors in the result content. The thrown
 * message is what the model sees, so every message is prefixed with
 * `[CODE]` — the code stays visible to the model while `.code` serves
 * programmatic handling.
 *
 * Passthrough convention (same as the service layer): typed store / domain
 * errors (STORE_SQLITE_UNAVAILABLE, STORE_SCHEMA_TOO_NEW, domain errors)
 * propagate through the tools unchanged — never wrapped, never re-coded.
 */

export const LINGUIST_CAT_TOOL_ERROR_CODES = {
  /** The session is not bound to a Linguist project (no linguistProjectId). */
  BINDING_MISSING: 'BINDING_MISSING',
  /** The bound project no longer exists (index/disk gone or unreadable). */
  PROJECT_MISSING: 'PROJECT_MISSING',
  /** A supplied assetId does not exist in the bound project. */
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  /** An argument failed defensive validation inside the tool. */
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  /** 分页期间项目产生了新事件，cursor 绑定的事件快照已漂移，须从首页重拉。 */
  CONTEXT_DRIFT: 'CONTEXT_DRIFT',
  /** Translation scope finalize 被拒：仍有未解释的 pending/failed 段（计数见错误 details）。 */
  TRANSLATION_SCOPE_INCOMPLETE: 'TRANSLATION_SCOPE_INCOMPLETE',
} as const

export type LinguistCatToolErrorCode =
  (typeof LINGUIST_CAT_TOOL_ERROR_CODES)[keyof typeof LINGUIST_CAT_TOOL_ERROR_CODES]

export abstract class LinguistCatToolError extends Error {
  abstract readonly code: LinguistCatToolErrorCode
}

/** The session is not bound to a Linguist project; CAT tools are unavailable. */
export class LinguistCatBindingMissingError extends LinguistCatToolError {
  readonly code = LINGUIST_CAT_TOOL_ERROR_CODES.BINDING_MISSING
  constructor() {
    super(
      `[${LINGUIST_CAT_TOOL_ERROR_CODES.BINDING_MISSING}] This session is not bound to a Linguist project. ` +
        'CAT tools only work inside a project chat; start one from the project view.',
    )
    this.name = 'LinguistCatBindingMissingError'
  }
}

/** The bound project cannot be resolved anymore (deleted / corrupt). */
export class LinguistCatProjectMissingError extends LinguistCatToolError {
  readonly code = LINGUIST_CAT_TOOL_ERROR_CODES.PROJECT_MISSING
  constructor(readonly projectId: string) {
    super(
      `[${LINGUIST_CAT_TOOL_ERROR_CODES.PROJECT_MISSING}] The project bound to this session no longer exists ` +
        `(projectId: ${projectId}). Its data may have been deleted; start a new project chat.`,
    )
    this.name = 'LinguistCatProjectMissingError'
  }
}

/** A supplied assetId does not exist in the bound project. */
export class LinguistCatAssetNotFoundError extends LinguistCatToolError {
  readonly code = LINGUIST_CAT_TOOL_ERROR_CODES.ASSET_NOT_FOUND
  constructor(readonly assetId: string) {
    super(
      `[${LINGUIST_CAT_TOOL_ERROR_CODES.ASSET_NOT_FOUND}] Asset not found in the bound project: ${assetId}. ` +
        'Use cat_list_assets to enumerate valid asset ids.',
    )
    this.name = 'LinguistCatAssetNotFoundError'
  }
}

/**
 * An argument failed defensive validation inside the tool. Pi validates
 * TypeBox schemas before execute(), so this only fires when tools are
 * driven directly (or a caller bypasses schema validation).
 */
export class LinguistCatInvalidArgumentError extends LinguistCatToolError {
  readonly code = LINGUIST_CAT_TOOL_ERROR_CODES.INVALID_ARGUMENT
  constructor(
    readonly argument: string,
    readonly detail: string,
  ) {
    super(`[${LINGUIST_CAT_TOOL_ERROR_CODES.INVALID_ARGUMENT}] Invalid argument "${argument}": ${detail}.`)
    this.name = 'LinguistCatInvalidArgumentError'
  }
}

/**
 * 项目事件序列在分页过程中前进（cat_get_translation_context v2 cursor 绑定的
 * 快照已失效）。模型须丢弃旧 cursor，从第一页重新拉取一致快照。
 */
export class LinguistCatContextDriftError extends LinguistCatToolError {
  readonly code = LINGUIST_CAT_TOOL_ERROR_CODES.CONTEXT_DRIFT
  constructor() {
    super(
      `[${LINGUIST_CAT_TOOL_ERROR_CODES.CONTEXT_DRIFT}] The project changed while paging translation context; ` +
        'the cursor snapshot is stale. Discard it and restart from the first page (omit cursor).',
    )
    this.name = 'LinguistCatContextDriftError'
  }
}

/** LA-TRANS-001 覆盖等式计数（requested = proposalCreated + blocked + skipped + failed + pending）。 */
export interface TranslationScopeCoverageCounts {
  requested: number
  proposalCreated: number
  skipped: number
  blocked: number
  failed: number
  pending: number
}

/**
 * cat_finalize_translation_scope 被拒：存在未解释 pending（无提案也无解释）或
 * 派生 failed（begin 后段被锁定/改写/删除且无解释）的段。counts 为服务端按
 * DB 真值推导的精确计数；消息附前几个待处理段 id 供模型直接行动。
 */
export class LinguistCatTranslationScopeIncompleteError extends LinguistCatToolError {
  readonly code = LINGUIST_CAT_TOOL_ERROR_CODES.TRANSLATION_SCOPE_INCOMPLETE
  constructor(
    readonly counts: TranslationScopeCoverageCounts,
    readonly pendingSegmentIds: readonly string[],
    readonly failedSegmentIds: readonly string[],
  ) {
    super(
      `[${LINGUIST_CAT_TOOL_ERROR_CODES.TRANSLATION_SCOPE_INCOMPLETE}] Translation scope finalize refused: ` +
        `${counts.pending + counts.failed} of ${counts.requested} segment(s) are unexplained ` +
        `(pending=${counts.pending}, failed=${counts.failed}). ` +
        `Derived coverage: requested=${counts.requested}, proposalCreated=${counts.proposalCreated}, ` +
        `skipped=${counts.skipped}, blocked=${counts.blocked}. ` +
        `Unexplained segments: ${[...pendingSegmentIds, ...failedSegmentIds].slice(0, 8).join(', ')}` +
        `${counts.pending + counts.failed > 8 ? ', …' : ''}. ` +
        'Create proposals with cat_propose_translations or declare skipped/blocked explanations, then finalize again.',
    )
    this.name = 'LinguistCatTranslationScopeIncompleteError'
  }
}
