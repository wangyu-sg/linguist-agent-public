import {
  cpSync,
  existsSync,
  lstatSync,
  readdirSync,
} from 'node:fs'
import { basename, join } from 'node:path'

const LEGACY_DIRECTORIES = new Set([
  '.context',
  'scripts',
  'reports',
  'scratch',
  'extracted',
])
const LEGACY_EXCLUDED_ENTRIES = new Set([
  '.claude',
  'memory',
  'SESSION_MANIFEST.json',
])

function assertPathId(value: string, field: 'projectId' | 'sessionId'): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`[Linguist workspace] ${field} 不是安全的稳定 ID`)
  }
}

/** 仅用于识别个人 Alpha 的历史目录；新会话不得再把这里作为 cwd。 */
export function resolveLegacyLinguistSessionWorkspacePath(
  configDir: string,
  projectId: string,
  sessionId: string,
): string {
  assertPathId(projectId, 'projectId')
  assertPathId(sessionId, 'sessionId')
  return join(configDir, 'linguist', 'agent-workspaces', projectId, sessionId)
}

/**
 * 原生 workbench 为空时，尽力复制旧用户产物；不覆盖、不删除旧目录，也不迁移旧运行配置。
 */
export function migrateLegacyLinguistSessionWorkspace(
  configDir: string,
  projectId: string,
  sessionId: string,
  destination: string,
): void {
  const source = resolveLegacyLinguistSessionWorkspacePath(configDir, projectId, sessionId)
  if (!existsSync(source) || !lstatSync(source).isDirectory()) return
  if (readdirSync(destination).length > 0) {
    console.warn(`[Linguist workspace] 原生 workbench 非空，保留旧目录供手动处理: ${sessionId}`)
    return
  }

  const failed: string[] = []
  for (const entry of readdirSync(source)) {
    if (LEGACY_EXCLUDED_ENTRIES.has(entry)) continue
    const sourcePath = join(source, entry)
    const stat = lstatSync(sourcePath)
    if ((!LEGACY_DIRECTORIES.has(entry) || !stat.isDirectory()) && !stat.isFile()) continue
    const destinationPath = join(destination, basename(entry))
    if (existsSync(destinationPath)) {
      failed.push(entry)
      continue
    }
    try {
      cpSync(sourcePath, destinationPath, {
        recursive: stat.isDirectory(),
        errorOnExist: true,
        force: false,
        filter: (path) => !lstatSync(path).isSymbolicLink(),
      })
    } catch {
      failed.push(entry)
    }
  }

  if (failed.length > 0) {
    console.warn(`[Linguist workspace] 部分旧产物未迁移，旧目录已保留: ${sessionId} (${failed.join(', ')})`)
  }
}
