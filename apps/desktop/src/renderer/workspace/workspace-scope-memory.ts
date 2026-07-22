import type { ProjectSummary } from "../data/workspace-client.ts";

export const WORKSPACE_SCOPE_STORAGE_KEY = "linguist-agent:last-workspace-scope:v1";

export interface RememberedWorkspaceScope {
  projectId: string;
  batchId?: string;
  taskId?: string;
}

export interface ResolvedWorkspaceScope {
  projectId: string;
  batchId: string | null;
  taskId: string | null;
}

export interface ScopeTaskIdentity {
  id: string;
  projectId: string;
  batchId: string | null;
}

function cleanId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseRememberedWorkspaceScope(value: string | null): RememberedWorkspaceScope | null {
  if (!value) return null;
  try {
    const row = JSON.parse(value) as Record<string, unknown>;
    const projectId = cleanId(row.projectId);
    if (!projectId) return null;
    const batchId = cleanId(row.batchId);
    const taskId = cleanId(row.taskId);
    return { projectId, ...(batchId ? { batchId } : {}), ...(taskId ? { taskId } : {}) };
  } catch {
    return null;
  }
}

export function serializeRememberedWorkspaceScope(scope: ResolvedWorkspaceScope): string | null {
  if (!scope.projectId) return null;
  return JSON.stringify({
    projectId: scope.projectId,
    ...(scope.batchId ? { batchId: scope.batchId } : {}),
    ...(scope.taskId ? { taskId: scope.taskId } : {}),
  } satisfies RememberedWorkspaceScope);
}

/**
 * Resolve only against canonical objects already returned by the runtime.
 * A missing child falls back to its nearest still-valid parent; IDs are never
 * invented from local storage.
 */
export function resolveRememberedWorkspaceScope(
  remembered: RememberedWorkspaceScope | null,
  projects: readonly ProjectSummary[],
  tasks: readonly ScopeTaskIdentity[],
): ResolvedWorkspaceScope | null {
  if (!remembered) return null;
  const project = projects.find((candidate) => candidate.projectId === remembered.projectId);
  if (!project) return null;

  const task = remembered.taskId
    ? tasks.find((candidate) => candidate.id === remembered.taskId && candidate.projectId === project.projectId)
    : undefined;
  if (task) {
    const taskBatchExists = !task.batchId || project.batches.some((batch) => batch.batchId === task.batchId);
    if (taskBatchExists) return { projectId: project.projectId, batchId: task.batchId, taskId: task.id };
  }

  const batch = remembered.batchId
    ? project.batches.find((candidate) => candidate.batchId === remembered.batchId)
    : undefined;
  return {
    projectId: project.projectId,
    batchId: batch?.batchId ?? null,
    taskId: null,
  };
}
