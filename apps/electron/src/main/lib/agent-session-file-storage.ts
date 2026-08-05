import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { MAX_ATTACHMENT_SIZE } from '@proma/shared'
import type { AgentSaveFilesInput, AgentSavedFile, AgentSessionMeta } from '@proma/shared'

export type ManagedSessionUploadScope =
  | { kind: 'agent-workspace' | 'linguist-project'; cwd: string }
  | { kind: 'home'; cwd: string }

export interface ManagedSessionUploadDependencies {
  getSessionMeta(sessionId: string): AgentSessionMeta | undefined
  resolveExecutionScope(session: AgentSessionMeta): ManagedSessionUploadScope
  assertSessionWritable?(session: AgentSessionMeta): void
}

type ValidatedUpload = {
  filename: string
  data: string
}

type PlannedUpload = ValidatedUpload & {
  targetPath: string
}

function invalidUploadInput(message: string): never {
  throw new Error(`会话附件输入无效：${message}`)
}

function validateFilename(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    invalidUploadInput('文件名不安全')
  }

  // 同时按 POSIX / Windows 规则检查，避免跨平台 session 文件被路径分隔符绕过。
  if (
    value === '.'
    || value === '..'
    || value !== basename(value)
    || value !== win32.basename(value)
    || isAbsolute(value)
    || win32.isAbsolute(value)
  ) {
    invalidUploadInput('文件名不安全')
  }

  return value
}

function isStrictBase64(value: string): boolean {
  if (value.length === 0) return true
  // FileReader.readAsDataURL() 产生标准 padding base64；不接受宽松解码，
  // 避免 Buffer.from 静默丢弃非法字符后仍落盘。
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false
  const paddingLength = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const bodyLength = value.length - paddingLength
  return paddingLength === 0
    ? bodyLength % 4 === 0
    : paddingLength === 1
      ? bodyLength % 4 === 3
      : bodyLength % 4 === 2
}

function validateInput(input: AgentSaveFilesInput): { sessionId: string; files: ValidatedUpload[] } {
  if (!input || typeof input !== 'object') {
    invalidUploadInput('请求不是对象')
  }

  const rawInput = input as unknown as Record<string, unknown>
  if (typeof rawInput.sessionId !== 'string' || rawInput.sessionId.length === 0) {
    invalidUploadInput('会话 ID 无效')
  }
  if (!Array.isArray(rawInput.files) || rawInput.files.length === 0) {
    invalidUploadInput('没有可保存的附件')
  }

  const files = rawInput.files.map((rawFile, index): ValidatedUpload => {
    if (!rawFile || typeof rawFile !== 'object') {
      invalidUploadInput(`第 ${index + 1} 个附件无效`)
    }
    const file = rawFile as Record<string, unknown>
    const filename = validateFilename(file.filename)
    if (typeof file.data !== 'string') {
      invalidUploadInput(`第 ${index + 1} 个附件数据无效`)
    }
    if (!isStrictBase64(file.data)) {
      invalidUploadInput(`第 ${index + 1} 个附件数据不是合法 base64`)
    }
    return { filename, data: file.data }
  })

  return { sessionId: rawInput.sessionId, files }
}

function resolveContainedFilePath(sessionDir: string, filename: string): string {
  const targetPath = resolve(sessionDir, filename)
  const relativePath = relative(sessionDir, targetPath)
  const escapesRoot = relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
    || win32.isAbsolute(relativePath)

  if (!relativePath || escapesRoot) {
    invalidUploadInput('文件名不安全')
  }

  return targetPath
}

function findAvailablePath(sessionDir: string, filename: string, usedPaths: Set<string>): string {
  let targetPath = resolveContainedFilePath(sessionDir, filename)
  if (!usedPaths.has(targetPath) && !existsSync(targetPath)) {
    return targetPath
  }

  const extension = extname(filename)
  const baseName = extension ? filename.slice(0, -extension.length) : filename
  let counter = 1
  do {
    targetPath = resolveContainedFilePath(sessionDir, `${baseName}-${counter}${extension}`)
    counter++
  } while (usedPaths.has(targetPath) || existsSync(targetPath))
  return targetPath
}

/**
 * 把附件写入由会话元数据决定的受管目录。
 *
 * renderer 传入的 workspaceSlug 仅为 IPC 协议兼容字段，绝不参与目录授权。
 * 所有输入先完成结构与路径校验，再解析 scope 或创建目录，以避免无效批次产生部分写入。
 */
export function saveFilesToManagedAgentSession(
  input: AgentSaveFilesInput,
  dependencies: ManagedSessionUploadDependencies,
): AgentSavedFile[] {
  const { sessionId, files } = validateInput(input)
  const session = dependencies.getSessionMeta(sessionId)
  if (!session) {
    throw new Error('会话不存在，拒绝保存附件')
  }

  dependencies.assertSessionWritable?.(session)
  // 身份与可写性确认后，所有附件再完成同一轮大小筛选；不会先写前项后才发现后项超限。
  const filesToSave = files.filter((file) => {
    if (file.data.length * 0.75 <= MAX_ATTACHMENT_SIZE) return true
    console.warn(`[Agent 服务] 文件超过 100MB 限制，跳过: ${file.filename} (预估 ${(file.data.length * 0.75 / 1024 / 1024).toFixed(1)}MB)`)
    return false
  })
  if (filesToSave.length === 0) return []

  const scope = dependencies.resolveExecutionScope(session)
  if (scope.kind === 'home') {
    throw new Error('当前会话没有受管附件目录，拒绝保存附件')
  }
  if (!scope.cwd || typeof scope.cwd !== 'string') {
    throw new Error('当前会话的受管附件目录无效，拒绝保存附件')
  }

  const sessionDir = resolve(scope.cwd)
  const usedPaths = new Set<string>()
  const plannedUploads: PlannedUpload[] = []
  for (const file of filesToSave) {
    const targetPath = findAvailablePath(sessionDir, file.filename, usedPaths)
    usedPaths.add(targetPath)
    plannedUploads.push({ ...file, targetPath })
  }

  // 到这里路径、会话身份及 Linguist 可写性均已确认，才允许创建受管目录。
  mkdirSync(sessionDir, { recursive: true })

  const results: AgentSavedFile[] = []
  for (const file of plannedUploads) {
    const buffer = Buffer.from(file.data, 'base64')
    writeFileSync(file.targetPath, buffer)
    results.push({ filename: relative(sessionDir, file.targetPath), targetPath: file.targetPath })
    console.log(`[Agent 服务] 文件已保存: ${file.targetPath} (${buffer.length} bytes)`)
  }

  return results
}
