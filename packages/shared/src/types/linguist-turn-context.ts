import {
  LINGUIST_ASSET_ID_PATTERN,
  LINGUIST_PROJECT_ID_PATTERN,
  LINGUIST_QA_FINDING_ID_PATTERN,
  LINGUIST_SEGMENT_ID_PATTERN,
} from './linguist'

export const LINGUIST_TURN_CONTEXT_SCHEMA_VERSION = 1 as const
export const LINGUIST_TURN_CONTEXT_SELECTED_SEGMENT_LIMIT = 100

export interface LinguistTurnContextV1 {
  schemaVersion: 1
  projectId: string
  assetId?: string
  activeSegmentId?: string
  selectedSegmentIds: readonly string[]
  activeQaFindingId?: string
  capturedAt: string
  uiRevision: number
}

export interface LinguistTurnContextParseResult {
  context: Readonly<LinguistTurnContextV1>
  selectionTruncated: boolean
}

export interface CreateLinguistTurnContextV1Input {
  projectId: string
  assetId?: string
  activeSegmentId?: string
  selectedSegmentIds: readonly string[]
  activeQaFindingId?: string
  capturedAt: string
  uiRevision: number
}

export class LinguistTurnContextValidationError extends Error {
  override readonly name = 'LinguistTurnContextValidationError'
}

const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'projectId',
  'assetId',
  'activeSegmentId',
  'selectedSegmentIds',
  'activeQaFindingId',
  'capturedAt',
  'uiRevision',
])

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LinguistTurnContextValidationError('context must be an object')
  }
  const record = value as Record<string, unknown>
  const unknownField = Object.keys(record).find((key) => !ALLOWED_FIELDS.has(key))
  if (unknownField !== undefined) {
    throw new LinguistTurnContextValidationError(`unknown field: ${unknownField}`)
  }
  return record
}

function readId(
  record: Record<string, unknown>,
  field: string,
  pattern: RegExp,
  optional = false,
): string | undefined {
  const value = record[field]
  if (optional && !Object.prototype.hasOwnProperty.call(record, field)) return undefined
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new LinguistTurnContextValidationError(`${field} must be an opaque Linguist ID`)
  }
  return value
}

function readCapturedAt(value: unknown): string {
  if (
    typeof value !== 'string'
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new LinguistTurnContextValidationError('capturedAt must be a canonical ISO timestamp')
  }
  return value
}

function readUiRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new LinguistTurnContextValidationError('uiRevision must be a non-negative safe integer')
  }
  return value as number
}

function readSelectedSegmentIds(
  value: unknown,
): { ids: readonly string[]; truncated: boolean } {
  if (!Array.isArray(value)) {
    throw new LinguistTurnContextValidationError('selectedSegmentIds must be an array')
  }
  const truncated = value.length > LINGUIST_TURN_CONTEXT_SELECTED_SEGMENT_LIMIT
  const ids = value
    .slice(0, LINGUIST_TURN_CONTEXT_SELECTED_SEGMENT_LIMIT)
    .map((id, index) => {
      if (typeof id !== 'string' || !LINGUIST_SEGMENT_ID_PATTERN.test(id)) {
        throw new LinguistTurnContextValidationError(
          `selectedSegmentIds[${index}] must be an opaque Segment ID`,
        )
      }
      return id
    })
  if (new Set(ids).size !== ids.length) {
    throw new LinguistTurnContextValidationError('selectedSegmentIds must not contain duplicates')
  }
  return {
    ids: Object.freeze(ids),
    truncated,
  }
}

/**
 * LF-060：把不可信 wire value 收敛成固定键序、深冻结的 V1 快照。
 * 超量选择只保留前 N 个，并通过返回值显式标记；其它不合法输入一律拒绝。
 */
export function parseLinguistTurnContextV1(value: unknown): LinguistTurnContextParseResult {
  const record = readRecord(value)
  if (record.schemaVersion !== LINGUIST_TURN_CONTEXT_SCHEMA_VERSION) {
    throw new LinguistTurnContextValidationError('schemaVersion must be 1')
  }

  const projectId = readId(record, 'projectId', LINGUIST_PROJECT_ID_PATTERN)!
  const assetId = readId(record, 'assetId', LINGUIST_ASSET_ID_PATTERN, true)
  const activeSegmentId = readId(
    record,
    'activeSegmentId',
    LINGUIST_SEGMENT_ID_PATTERN,
    true,
  )
  const selected = readSelectedSegmentIds(record.selectedSegmentIds)
  const activeQaFindingId = readId(
    record,
    'activeQaFindingId',
    LINGUIST_QA_FINDING_ID_PATTERN,
    true,
  )
  const capturedAt = readCapturedAt(record.capturedAt)
  const uiRevision = readUiRevision(record.uiRevision)

  const context: LinguistTurnContextV1 = {
    schemaVersion: LINGUIST_TURN_CONTEXT_SCHEMA_VERSION,
    projectId,
    ...(assetId !== undefined ? { assetId } : {}),
    ...(activeSegmentId !== undefined ? { activeSegmentId } : {}),
    selectedSegmentIds: selected.ids,
    ...(activeQaFindingId !== undefined ? { activeQaFindingId } : {}),
    capturedAt,
    uiRevision,
  }
  return {
    context: Object.freeze(context),
    selectionTruncated: selected.truncated,
  }
}

/** Workbench → Turn Context 的唯一构建 seam；只投影契约字段。 */
export function createLinguistTurnContextV1(
  input: CreateLinguistTurnContextV1Input,
): LinguistTurnContextParseResult {
  return parseLinguistTurnContextV1({
    schemaVersion: LINGUIST_TURN_CONTEXT_SCHEMA_VERSION,
    projectId: input.projectId,
    ...(input.assetId !== undefined ? { assetId: input.assetId } : {}),
    ...(input.activeSegmentId !== undefined
      ? { activeSegmentId: input.activeSegmentId }
      : {}),
    selectedSegmentIds: input.selectedSegmentIds,
    ...(input.activeQaFindingId !== undefined
      ? { activeQaFindingId: input.activeQaFindingId }
      : {}),
    capturedAt: input.capturedAt,
    uiRevision: input.uiRevision,
  })
}

/** 固定键序 JSON；相同语义输入产生相同字节。 */
export function serializeLinguistTurnContextV1(value: unknown): string {
  return JSON.stringify(parseLinguistTurnContextV1(value).context)
}
