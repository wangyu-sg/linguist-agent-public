import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import type { AgentProfile } from '@proma/shared'
import { writeJsonFileAtomic } from '../safe-file'

const SESSION_SUBDIRECTORIES = [
  '.context',
  '.claude',
  'scripts',
  'reports',
  'scratch',
  'extracted',
] as const

interface LinguistSessionWorkspaceManifest {
  projectId: string
  sessionId: string
  role: Extract<AgentProfile, { kind: 'linguist' }>['role']
  executionPolicy: Extract<AgentProfile, { kind: 'linguist' }>['executionPolicy']
  createdAt: string
  projectDisplayName: string
}

function assertPathId(value: string, field: 'projectId' | 'sessionId'): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`[Linguist workspace] ${field} 不是安全的稳定 ID`)
  }
}

export function resolveLinguistSessionWorkspacePath(
  configDir: string,
  projectId: string,
  sessionId: string,
): string {
  assertPathId(projectId, 'projectId')
  assertPathId(sessionId, 'sessionId')
  return join(configDir, 'linguist', 'agent-workspaces', projectId, sessionId)
}

/** 首次执行时建立项目专属 cwd；CAT DB 仍留在受管 Project Store。 */
export function ensureLinguistSessionWorkspace(
  configDir: string,
  manifest: LinguistSessionWorkspaceManifest,
): string {
  const cwd = resolveLinguistSessionWorkspacePath(
    configDir,
    manifest.projectId,
    manifest.sessionId,
  )
  mkdirSync(cwd, { recursive: true })
  for (const child of SESSION_SUBDIRECTORIES) {
    mkdirSync(join(cwd, child), { recursive: true })
  }

  const manifestPath = join(cwd, 'SESSION_MANIFEST.json')
  if (existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<LinguistSessionWorkspaceManifest>
    if (
      existing.projectId !== manifest.projectId
      || existing.sessionId !== manifest.sessionId
    ) {
      throw new Error('[Linguist workspace] SESSION_MANIFEST 与目录身份不一致')
    }
  } else {
    writeJsonFileAtomic(manifestPath, manifest, true)
  }
  return cwd
}

/** 会话删除只移动工作目录到受管 Trash，保留恢复可能。 */
export function moveLinguistSessionWorkspaceToTrash(
  configDir: string,
  projectId: string,
  sessionId: string,
  deletedAt = new Date().toISOString(),
): string | null {
  const source = resolveLinguistSessionWorkspacePath(configDir, projectId, sessionId)
  if (!existsSync(source)) return null

  const trashDir = join(configDir, 'linguist', 'trash', 'agent-workspaces', projectId)
  mkdirSync(trashDir, { recursive: true })
  const timestamp = deletedAt.replace(/[^0-9A-Za-z.-]/g, '-')
  const basename = `${sessionId}-${timestamp}`
  let destination = join(trashDir, basename)
  let suffix = 2
  while (existsSync(destination)) destination = join(trashDir, `${basename}-${suffix++}`)
  renameSync(source, destination)
  return destination
}
