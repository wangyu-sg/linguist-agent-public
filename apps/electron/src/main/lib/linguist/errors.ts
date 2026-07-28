/**
 * Linguist 项目服务的类型化错误（PB-030）。
 *
 * 复刻 cat-store / cat-formats 的错误模式：抽象基类 + 稳定机器可读 code。
 * code 是公开契约（PB-031 的 IPC 层将直接序列化），变更必须有迁移说明。
 *
 * 穿透约定（与 cat-store 一致）：store / formats / domain 的类型化错误
 * （STORE_*、FORMAT_*、REVISION_CONFLICT 等）原样穿透，绝不包装；
 * 本层只定义服务语义级错误（项目不存在 / 已归档 / 不健康 / 导入超限）。
 */

import { StoreIndexCorruptError, StoreNotFoundError } from '@linguist/cat-store'

export const LINGUIST_SERVICE_ERROR_CODES = {
  /** 项目 id 不在项目索引中。 */
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  /** 对已归档项目发起写操作（归档项目一律只读，fail closed）。 */
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
  /** 项目磁盘内容缺失/损坏（cat.db、project.json 或索引损坏）。 */
  PROJECT_UNHEALTHY: 'PROJECT_UNHEALTHY',
  /** 导入字节数超过服务上限（50MB）。 */
  IMPORT_TOO_LARGE: 'IMPORT_TOO_LARGE',
  /** 资产仍有 open blocking QA Finding，导出前必须人工解决或填写 waiver。 */
  EXPORT_BLOCKED_BY_QA: 'EXPORT_BLOCKED_BY_QA',
  /** 提案或当前阶段确认尚未收口，不能进入 native Save。 */
  DELIVERY_NOT_READY: 'DELIVERY_NOT_READY',
  /** DOCX 不是有效 OOXML、正文为空或解析器无法读取。 */
  CONTEXT_DOC_EXTRACT_FAILED: 'CONTEXT_DOC_EXTRACT_FAILED',
  /** 删除前必须先归档项目。 */
  PROJECT_DELETE_REQUIRES_ARCHIVE: 'PROJECT_DELETE_REQUIRES_ARCHIVE',
  /** 删除确认名与当前项目名不一致。 */
  PROJECT_DELETE_CONFIRMATION_MISMATCH: 'PROJECT_DELETE_CONFIRMATION_MISMATCH',
} as const

export type LinguistServiceErrorCode =
  (typeof LINGUIST_SERVICE_ERROR_CODES)[keyof typeof LINGUIST_SERVICE_ERROR_CODES]

export abstract class LinguistServiceError extends Error {
  abstract readonly code: LinguistServiceErrorCode
}

/** 项目 id 不在项目索引中。 */
export class LinguistProjectNotFoundError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.PROJECT_NOT_FOUND
  constructor(readonly projectId: string) {
    super(`CAT project not found: ${projectId}.`)
    this.name = 'LinguistProjectNotFoundError'
  }
}

/** 对已归档项目发起写操作。归档项目的 DB 句柄只读，服务层先行拒绝。 */
export class LinguistProjectArchivedError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.PROJECT_ARCHIVED
  constructor(readonly projectId: string) {
    super(`CAT project ${projectId} is archived; writes are rejected (read-only, fail closed).`)
    this.name = 'LinguistProjectArchivedError'
  }
}

/** 可恢复删除仍要求先归档，避免日常编辑中的误操作直接移除项目。 */
export class LinguistProjectDeleteRequiresArchiveError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.PROJECT_DELETE_REQUIRES_ARCHIVE
  constructor(readonly projectId: string) {
    super(`CAT project ${projectId} must be archived before deletion.`)
    this.name = 'LinguistProjectDeleteRequiresArchiveError'
  }
}

/** 项目名确认失败；错误不回显客户项目名。 */
export class LinguistProjectDeleteConfirmationMismatchError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.PROJECT_DELETE_CONFIRMATION_MISMATCH
  constructor(readonly projectId: string) {
    super(`Deletion confirmation does not match CAT project ${projectId}.`)
    this.name = 'LinguistProjectDeleteConfirmationMismatchError'
  }
}

/** 项目磁盘内容缺失/损坏；detail 只含错误码级描述，绝无客户文本。 */
export class LinguistProjectUnhealthyError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.PROJECT_UNHEALTHY
  constructor(
    readonly projectId: string,
    readonly detail: string,
  ) {
    super(`CAT project ${projectId} is unhealthy: ${detail}.`)
    this.name = 'LinguistProjectUnhealthyError'
  }
}

/** 导入字节数超过服务上限。 */
export class LinguistImportTooLargeError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.IMPORT_TOO_LARGE
  constructor(
    readonly sizeBytes: number,
    readonly limitBytes: number,
  ) {
    super(`Import payload of ${sizeBytes} bytes exceeds the ${limitBytes}-byte limit.`)
    this.name = 'LinguistImportTooLargeError'
  }
}

/** 当前资产有阻断级 QA Finding；不接受程序化 bypass，必须走人工 review。 */
export class LinguistExportBlockedByQaError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.EXPORT_BLOCKED_BY_QA
  constructor(
    readonly projectId: string,
    readonly assetId: string,
    readonly openBlockingFindings: number,
  ) {
    super(`Export of asset ${assetId} in project ${projectId} is blocked by ${openBlockingFindings} open blocking QA finding(s).`)
    this.name = 'LinguistExportBlockedByQaError'
  }
}

export class LinguistDeliveryNotReadyError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.DELIVERY_NOT_READY
  constructor(
    readonly projectId: string,
    readonly assetId: string,
    readonly blockerCount: number,
  ) {
    super(
      `Delivery of asset ${assetId} in project ${projectId} is not ready (${blockerCount} blocker(s)).`,
    )
    this.name = 'LinguistDeliveryNotReadyError'
  }
}

export type ContextDocExtractDiagnostic = 'DOCX_PARSE_FAILED' | 'DOCX_EMPTY_TEXT'

const CONTEXT_DOC_EXTRACT_MESSAGES: Record<ContextDocExtractDiagnostic, string> = {
  DOCX_PARSE_FAILED:
    '文件不是可解析的 DOCX/OOXML，可能已损坏或加密。请先用 Word 或 LibreOffice 打开并另存为新的 .docx 后重试；仍失败时请导出为 UTF-8 .txt/.md。',
  DOCX_EMPTY_TEXT:
    '文件可读取，但未发现普通段落正文（可能仅含图片、扫描内容或文本框）。请将正文复制到普通段落后另存为 .docx，或导出为 UTF-8 .txt/.md。',
}

/** Context Doc 抽取失败；message 只含固定诊断，不含路径或客户正文。 */
export class LinguistContextDocExtractError extends LinguistServiceError {
  readonly code = LINGUIST_SERVICE_ERROR_CODES.CONTEXT_DOC_EXTRACT_FAILED
  constructor(readonly diagnostic: ContextDocExtractDiagnostic) {
    super(`DOCX 文本抽取失败（${diagnostic}）：${CONTEXT_DOC_EXTRACT_MESSAGES[diagnostic]}`)
    this.name = 'LinguistContextDocExtractError'
  }
}

/** 取错误的稳定 code；无 code 的普通 Error 归为 'UNKNOWN'（日志/报告用）。 */
export function errorCodeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'UNKNOWN'
}

/**
 * 将 store 层错误映射为服务层语义错误：
 * - project 未找到 → PROJECT_NOT_FOUND；
 * - 项目磁盘内容缺失（project metadata / cat database）→ PROJECT_UNHEALTHY；
 * - 索引损坏 → PROJECT_UNHEALTHY；
 * - 其余类型化错误（STORE_READ_ONLY、FORMAT_*、domain 错误等）原样返回。
 */
export function mapStoreError(err: unknown, projectId?: string): unknown {
  if (err instanceof StoreNotFoundError) {
    if (err.entity === 'project') {
      return new LinguistProjectNotFoundError(err.key)
    }
    if (err.entity === 'project metadata' || err.entity === 'cat database') {
      return new LinguistProjectUnhealthyError(
        projectId ?? 'unknown',
        `${err.entity} missing (STORE_NOT_FOUND)`,
      )
    }
  }
  if (err instanceof StoreIndexCorruptError) {
    return new LinguistProjectUnhealthyError(projectId ?? 'unknown', 'STORE_INDEX_CORRUPT')
  }
  return err
}
