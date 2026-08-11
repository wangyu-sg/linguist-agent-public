import { homedir } from 'node:os'
import type { AgentSessionMeta, AgentWorkspace, LinguistRole } from '@proma/shared'
import { resolveAgentProfile } from '@proma/shared'
import { getConfigDir, getAgentSessionWorkspacePath } from '../config-paths'
import { getAgentWorkspace } from '../agent-workspace-manager'
import { ensureLinguistSessionWorkspace } from './session-workspace'

export type AgentExecutionScope =
  | {
      kind: 'agent-workspace'
      workspaceId: string
      workspaceSlug: string
      workspaceName: string
      cwd: string
    }
  | {
      kind: 'linguist-project'
      projectId: string
      linguistRole: LinguistRole
      sessionId: string
      workspaceId?: string
      workspaceSlug?: string
      workspaceName?: string
      cwd: string
    }
  | {
      kind: 'home'
      cwd: string
    }

type ScopeDependencies = {
  homeDir: () => string
  getWorkspace: (workspaceId: string) => AgentWorkspace | undefined
  ensureWorkspaceSession: (workspaceSlug: string, sessionId: string) => string
  ensureLinguistSession: (projectId: string, sessionId: string) => string
}

/** cwd 由 Linguist 绑定决定；workspace 上下文正交保留供宿主能力使用。 */
export function resolveAgentExecutionScope(
  session: AgentSessionMeta,
  overrides: Partial<ScopeDependencies> = {},
): AgentExecutionScope {
  const profile = resolveAgentProfile(session)
  const deps: ScopeDependencies = {
    homeDir: homedir,
    getWorkspace: getAgentWorkspace,
    ensureWorkspaceSession: getAgentSessionWorkspacePath,
    ensureLinguistSession: (projectId, sessionId) => ensureLinguistSessionWorkspace(
      getConfigDir(),
      {
        projectId,
        sessionId,
        projectDisplayName: session.linguistProjectName ?? projectId,
        role: profile.kind === 'linguist' ? profile.role : 'general',
        createdAt: new Date(session.createdAt).toISOString(),
      },
    ),
    ...overrides,
  }

  if (profile.kind === 'linguist') {
    const workspace = session.workspaceId
      ? deps.getWorkspace(session.workspaceId)
      : undefined
    return {
      kind: 'linguist-project',
      projectId: profile.projectId,
      linguistRole: profile.role,
      sessionId: session.id,
      ...(workspace
        ? {
            workspaceId: workspace.id,
            workspaceSlug: workspace.slug,
            workspaceName: workspace.name,
          }
        : {}),
      cwd: deps.ensureLinguistSession(profile.projectId, session.id),
    }
  }

  if (profile.workspaceId) {
    const workspace = deps.getWorkspace(profile.workspaceId)
    if (workspace) {
      return {
        kind: 'agent-workspace',
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
        cwd: deps.ensureWorkspaceSession(workspace.slug, session.id),
      }
    }
  }

  return { kind: 'home', cwd: deps.homeDir() }
}
