/**
 * permission-scope — 权限请求作用域摘要（纯函数）
 *
 * 从 PermissionRequest 的 toolName + toolInput 中提取「这次操作要动什么」，
 * 供 PermissionBanner 在工具名下方渲染一行作用域摘要。
 */

import type { PermissionRequest } from '@proma/shared'

/** 作用域类别 */
export type PermissionScopeKind =
  | 'command'
  | 'file'
  | 'search'
  | 'web'
  | 'task'
  | 'other'

/** 作用域摘要 */
export interface PermissionScopeSummary {
  kind: PermissionScopeKind
  /** 主要目标（命令 / 文件路径 / pattern / url / 描述） */
  primary: string
  /** 补充信息（如 search 的 path） */
  detail?: string
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/** 提取权限请求的作用域摘要；无法提取时返回 null */
export function summarizePermissionScope(
  request: Pick<PermissionRequest, 'toolName' | 'toolInput' | 'description' | 'command'>,
): PermissionScopeSummary | null {
  const { toolName, toolInput, description, command } = request

  // Bash 等命令行工具：以 command 字段或 toolInput.command 为准
  const commandText = asNonEmptyString(command) ?? asNonEmptyString(toolInput.command)
  if (toolName === 'Bash' || toolName === 'bash') {
    return commandText
      ? { kind: 'command', primary: commandText }
      : fallbackDescription(description)
  }

  // 文件读写类工具
  if (['Read', 'Write', 'Edit', 'NotebookEdit'].includes(toolName)) {
    const filePath = asNonEmptyString(toolInput.file_path)
    return filePath
      ? { kind: 'file', primary: filePath }
      : fallbackDescription(description)
  }

  // 搜索类工具
  if (toolName === 'Glob' || toolName === 'Grep') {
    const pattern = asNonEmptyString(toolInput.pattern)
    const path = asNonEmptyString(toolInput.path)
    if (pattern) {
      return { kind: 'search', primary: pattern, detail: path }
    }
    return fallbackDescription(description)
  }

  // Web 访问类工具
  if (toolName === 'WebFetch') {
    const url = asNonEmptyString(toolInput.url)
    return url ? { kind: 'web', primary: url } : fallbackDescription(description)
  }
  if (toolName === 'WebSearch') {
    const query = asNonEmptyString(toolInput.query)
    return query ? { kind: 'web', primary: query } : fallbackDescription(description)
  }

  // 子 Agent / 任务类工具
  if (toolName === 'Task' || toolName === 'Agent') {
    const taskDescription = asNonEmptyString(toolInput.description)
    return taskDescription
      ? { kind: 'task', primary: taskDescription }
      : fallbackDescription(description)
  }

  return fallbackDescription(description)
}

function fallbackDescription(description: string): PermissionScopeSummary | null {
  return description.trim().length > 0
    ? { kind: 'other', primary: description }
    : null
}
