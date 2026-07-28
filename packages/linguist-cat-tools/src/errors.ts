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
