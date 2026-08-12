import { homedir } from 'node:os'
import type { AgentSessionMeta, AgentWorkspace, LinguistRole } from '@proma/shared'
import { resolveAgentProfile } from '@proma/shared'
import { getConfigDir, getAgentSessionWorkspacePath } from '../config-paths'
import { getAgentWorkspace } from '../agent-workspace-manager'
import { migrateLegacyLinguistSessionWorkspace } from './session-workspace'

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
  configDir: () => string
  getWorkspace: (workspaceId: string) => AgentWorkspace | undefined
  ensureWorkspaceSession: (workspaceSlug: string, sessionId: string) => string
  migrateLegacySession: (
    configDir: string,
    projectId: string,
    sessionId: string,
    destination: string,
  ) => void
}

/** Workspace 决定宿主能力与 cwd；Linguist binding 只叠加 CAT 身份。 */
export function resolveAgentExecutionScope(
  session: AgentSessionMeta,
  overrides: Partial<ScopeDependencies> = {},
): AgentExecutionScope {
  const profile = resolveAgentProfile(session)
  const deps: ScopeDependencies = {
    homeDir: homedir,
    configDir: getConfigDir,
    getWorkspace: getAgentWorkspace,
    ensureWorkspaceSession: getAgentSessionWorkspacePath,
    migrateLegacySession: migrateLegacyLinguistSessionWorkspace,
    ...overrides,
  }

  if (profile.kind === 'linguist') {
    const workspace = session.workspaceId
      ? deps.getWorkspace(session.workspaceId)
      : undefined
    const cwd = workspace
      ? deps.ensureWorkspaceSession(workspace.slug, session.id)
      : deps.homeDir()
    if (workspace) {
      deps.migrateLegacySession(
        deps.configDir(),
        profile.projectId,
        session.id,
        cwd,
      )
    }
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
      cwd,
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
