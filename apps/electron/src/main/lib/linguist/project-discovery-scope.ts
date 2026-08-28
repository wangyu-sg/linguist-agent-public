import { createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { VersionedStageEvidenceRef } from '@linguist/cat-core'
import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'
import {
  getAgentWorkspace,
  getProjectFilesPath,
  getWorkspaceAttachedDirectories,
  getWorkspaceAttachedFiles,
} from '../agent-workspace-manager'
import { getLinguistProjectService } from './project-service'

export type ProjectDiscoverySourceKind =
  | 'workspace-root'
  | 'session-attached-directory'
  | 'workspace-attached-directory'
  | 'session-attached-file'
  | 'workspace-attached-file'

export interface ProjectDiscoveryLocation {
  kind: ProjectDiscoverySourceKind
  /** 主进程私有；不得进入 Tool 或 Renderer DTO。 */
  path: string
}

export interface UnavailableProjectDiscoveryLocation {
  kind: ProjectDiscoverySourceKind
  name: string
  reason: 'missing' | 'not-directory' | 'not-file' | 'unreadable'
}

export interface ProjectDiscoveryScope {
  roots: ProjectDiscoveryLocation[]
  files: ProjectDiscoveryLocation[]
  unavailable: UnavailableProjectDiscoveryLocation[]
  managedEvidence: VersionedStageEvidenceRef[]
  hash: string
}

type DiscoverySession = Pick<
  AgentSessionMeta,
  'workspaceId' | 'linguistProjectId' | 'attachedDirectories' | 'attachedFiles'
>

interface ProjectDiscoveryScopeDependencies {
  getWorkspace: (workspaceId: string) => AgentWorkspace | undefined
  getProjectFilesPath: (workspaceSlug: string) => string
  getWorkspaceAttachedDirectories: (workspaceSlug: string) => string[]
  getWorkspaceAttachedFiles: (workspaceSlug: string) => string[]
  listManagedEvidence: (projectId: string) => VersionedStageEvidenceRef[]
}

const DEFAULT_DEPENDENCIES: ProjectDiscoveryScopeDependencies = {
  getWorkspace: getAgentWorkspace,
  getProjectFilesPath,
  getWorkspaceAttachedDirectories,
  getWorkspaceAttachedFiles,
  listManagedEvidence: (projectId) => {
    const db = getLinguistProjectService().openProject(projectId)
    return [
      ...db.assets.listByProject().map((asset) => ({
        ref: { kind: 'asset' as const, id: asset.id as string },
        version: asset.sourceSha256,
      })),
      ...db.contextDocs.list({ limit: db.contextDocs.count() }).map((doc) => ({
        ref: { kind: 'context-doc' as const, id: doc.id },
        version: doc.sha256 ?? doc.createdAt,
      })),
      ...(['tm', 'terms'] as const).flatMap((kind) =>
        db.referenceImports.list(kind).map((item) => ({
          ref: { kind: 'reference-import' as const, id: item.id },
          version: item.sourceSha256,
        }))),
      ...db.styleGuideRules.list({ limit: db.styleGuideRules.count() }).map((rule) => ({
        ref: { kind: 'style-rule' as const, id: rule.id },
        version: rule.updatedAt,
      })),
      ...db.techConstraints.list({ limit: db.techConstraints.count() }).map((constraint) => ({
        ref: { kind: 'tech-constraint' as const, id: constraint.id },
        version: constraint.updatedAt,
      })),
      ...db.voiceProfiles.list({ limit: db.voiceProfiles.count() }).map((profile) => ({
        ref: { kind: 'voice-profile' as const, id: profile.id },
        version: profile.updatedAt,
      })),
    ]
  },
}

function locationKey(location: ProjectDiscoveryLocation): string {
  return `${location.kind}\u0000${location.path}`
}

function scopeHash(
  roots: readonly ProjectDiscoveryLocation[],
  files: readonly ProjectDiscoveryLocation[],
  unavailable: readonly UnavailableProjectDiscoveryLocation[],
): string {
  const canonical = {
    roots: roots.map(locationKey).sort(),
    files: files.map(locationKey).sort(),
    unavailable: unavailable
      .map((item) => `${item.kind}\u0000${item.name}\u0000${item.reason}`)
      .sort(),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** 宿主把 Workspace 与显式附件收敛成唯一授权扫描范围；Agent 不提供路径。 */
export function resolveProjectDiscoveryScope(input: {
  session: DiscoverySession
  dependencies?: ProjectDiscoveryScopeDependencies
}): ProjectDiscoveryScope {
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES
  const roots: ProjectDiscoveryLocation[] = []
  const files: ProjectDiscoveryLocation[] = []
  const unavailable: UnavailableProjectDiscoveryLocation[] = []
  const seen = new Set<string>()

  const add = (kind: ProjectDiscoverySourceKind, path: string, expected: 'directory' | 'file'): void => {
    let resolved: string
    try {
      if (!existsSync(path)) {
        unavailable.push({ kind, name: basename(path), reason: 'missing' })
        return
      }
      resolved = realpathSync(path)
      const info = statSync(resolved)
      if (expected === 'directory' && !info.isDirectory()) {
        unavailable.push({ kind, name: basename(path), reason: 'not-directory' })
        return
      }
      if (expected === 'file' && !info.isFile()) {
        unavailable.push({ kind, name: basename(path), reason: 'not-file' })
        return
      }
    } catch {
      unavailable.push({ kind, name: basename(path), reason: 'unreadable' })
      return
    }
    if (seen.has(resolved)) return
    seen.add(resolved)
    const location = { kind, path: resolved }
    if (expected === 'directory') roots.push(location)
    else files.push(location)
  }

  const workspace = input.session.workspaceId === undefined
    ? undefined
    : dependencies.getWorkspace(input.session.workspaceId)
  if (workspace !== undefined) {
    add('workspace-root', dependencies.getProjectFilesPath(workspace.slug), 'directory')
  }
  for (const path of input.session.attachedDirectories ?? []) {
    add('session-attached-directory', path, 'directory')
  }
  if (workspace !== undefined) {
    for (const path of dependencies.getWorkspaceAttachedDirectories(workspace.slug)) {
      add('workspace-attached-directory', path, 'directory')
    }
  }
  for (const path of input.session.attachedFiles ?? []) {
    add('session-attached-file', path, 'file')
  }
  if (workspace !== undefined) {
    for (const path of dependencies.getWorkspaceAttachedFiles(workspace.slug)) {
      add('workspace-attached-file', path, 'file')
    }
  }

  const managedEvidence = input.session.linguistProjectId === undefined
    ? []
    : [...dependencies.listManagedEvidence(input.session.linguistProjectId)]
      .sort((left, right) => {
        const leftKey = `${left.ref.kind}\u0000${left.ref.id}\u0000${left.version}`
        const rightKey = `${right.ref.kind}\u0000${right.ref.id}\u0000${right.version}`
        return leftKey.localeCompare(rightKey)
      })
  return {
    roots,
    files,
    unavailable,
    managedEvidence,
    hash: scopeHash(roots, files, unavailable),
  }
}
