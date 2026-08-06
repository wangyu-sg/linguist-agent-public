/**
 * Linguist typed IPC 的结果信封与输入校验公共件（PB-034 提取自 project-ipc.ts，
 * 供 project-ipc 与 session-ipc 两个处理器模块共用；逻辑零变化，纯搬移）。
 *
 * 契约要点（packages/shared/src/types/linguist.ts）：
 * - 全部通道返回 LinguistIpcResult<T> 信封，绝不抛出（Electron invoke 会
 *   丢弃抛出错误的自定义 code 属性，稳定错误码是计划 §7.4 硬规则）。
 * - 已知类型化错误透传稳定 code 与 message；未知错误一律收敛为
 *   INTERNAL + 通用文案（不泄露 stack / 内部文本；日志只记 name/code）。
 */

import {
  LINGUIST_IPC_ERROR_CODES,
  LINGUIST_PROJECT_ID_PATTERN,
  type LinguistIpcError,
  type LinguistIpcErrorCode,
  type LinguistIpcResult,
} from '@proma/shared'
import { errorCodeOf } from './errors'

/** 校验失败：code = INVALID_INPUT（稳定码，随信封序列化）。 */
export class LinguistIpcInputError extends Error {
  readonly code = LINGUIST_IPC_ERROR_CODES.INVALID_INPUT
}

export function invalid(detail: string): never {
  throw new LinguistIpcInputError(detail)
}

export function assertRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    invalid('input must be an object')
  }
  return input as Record<string, unknown>
}

export function readProjectId(record: Record<string, unknown>): string {
  const value = record.projectId
  if (typeof value !== 'string' || !LINGUIST_PROJECT_ID_PATTERN.test(value)) {
    invalid('projectId must match prj-<16 lowercase hex>')
  }
  return value
}

// ===== 错误映射：类型化错误透传稳定 code；未知 → INTERNAL =====

const KNOWN_CODES: ReadonlySet<string> = new Set<string>(Object.values(LINGUIST_IPC_ERROR_CODES))

export function toIpcError(err: unknown): LinguistIpcError {
  const code = errorCodeOf(err)
  if (KNOWN_CODES.has(code)) {
    const message = err instanceof Error ? err.message : String(err)
    // LA-INTAKE-007：类型化错误可选携带机器可读计数（如 IMPORT_UNDO_BLOCKED
    // 的下游引用计数）。防御性校验：只透传非负整数键值对，其他形状一律丢弃。
    const details = readNumericDetails(err)
    return details === undefined
      ? { code: code as LinguistIpcErrorCode, message }
      : { code: code as LinguistIpcErrorCode, message, details }
  }
  // 未知错误：不泄露 message/stack（可能含内部细节）；日志同样只记 name。
  console.error(
    `[Linguist IPC] 未类型化错误（name=${err instanceof Error ? err.name : typeof err}），按 INTERNAL 返回`,
  )
  return { code: LINGUIST_IPC_ERROR_CODES.INTERNAL, message: 'Unexpected internal error.' }
}

/** 读取错误对象上可选的 details（Record<string, 非负整数>）；不合形状返回 undefined。 */
function readNumericDetails(err: unknown): Record<string, number> | undefined {
  const details = (err as { details?: unknown } | null)?.details
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return undefined
  const entries = Object.entries(details as Record<string, unknown>)
  if (entries.length === 0) return undefined
  const clean: Record<string, number> = {}
  for (const [key, value] of entries) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined
    clean[key] = value
  }
  return clean
}

export async function wrap<T>(fn: () => T | Promise<T>): Promise<LinguistIpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: toIpcError(err) }
  }
}
