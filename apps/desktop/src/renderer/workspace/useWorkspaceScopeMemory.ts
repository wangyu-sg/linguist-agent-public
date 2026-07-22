import { useEffect, useState } from "react";
import type { TaskRecord } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { ProjectSummary } from "../data/workspace-client.ts";
import type { WorkspaceState, WorkspaceStore } from "../data/workspace-store.ts";
import {
  parseRememberedWorkspaceScope,
  resolveRememberedWorkspaceScope,
  serializeRememberedWorkspaceScope,
  WORKSPACE_SCOPE_STORAGE_KEY,
  type RememberedWorkspaceScope,
} from "./workspace-scope-memory.ts";

interface WorkspaceScopeStore {
  getState(): Pick<WorkspaceState, "projectId" | "batchId" | "taskId" | "tasks">;
  selectProject(projectId: string): Promise<void>;
  openBatch(projectId: string, batchId: string): Promise<void>;
  openTask(projectId: string, taskId: string): Promise<void>;
}

interface ScopeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function taskIdentity(task: TaskRecord) {
  if (task.owner.kind !== "project" || task.scope.kind !== "project") return null;
  return { id: task.id, projectId: task.owner.projectId, batchId: task.scope.batchId ?? null };
}

export async function restoreRememberedWorkspaceScope(
  store: WorkspaceScopeStore,
  projects: readonly ProjectSummary[],
  remembered: RememberedWorkspaceScope | null,
): Promise<void> {
  if (store.getState().projectId || !remembered) return;
  const project = projects.find((candidate) => candidate.projectId === remembered.projectId);
  if (!project) return;

  await store.selectProject(project.projectId);
  const selected = store.getState();
  // A user selection that races restoration always wins.
  if (selected.projectId !== project.projectId) return;

  const resolved = resolveRememberedWorkspaceScope(
    remembered,
    projects,
    selected.tasks.map(taskIdentity).filter((task): task is NonNullable<typeof task> => task !== null),
  );
  if (!resolved) return;
  if (resolved.taskId) {
    await store.openTask(resolved.projectId, resolved.taskId);
  } else if (resolved.batchId) {
    await store.openBatch(resolved.projectId, resolved.batchId);
  }
}

function readScope(storage: ScopeStorage): RememberedWorkspaceScope | null {
  try {
    return parseRememberedWorkspaceScope(storage.getItem(WORKSPACE_SCOPE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeScope(storage: ScopeStorage, state: Pick<WorkspaceState, "projectId" | "batchId" | "taskId">): void {
  try {
    const value = serializeRememberedWorkspaceScope({
      projectId: state.projectId ?? "",
      batchId: state.batchId,
      taskId: state.taskId,
    });
    if (value) storage.setItem(WORKSPACE_SCOPE_STORAGE_KEY, value);
    else storage.removeItem(WORKSPACE_SCOPE_STORAGE_KEY);
  } catch {
    // Scope memory is convenience only. Canonical runtime state remains usable
    // when browser storage is unavailable or disabled.
  }
}

const restoredStores = new WeakSet<WorkspaceStore>();
const restorationPromises = new WeakMap<WorkspaceStore, Promise<void>>();

/** Restores product IDs only after the runtime has returned canonical objects. */
export function useWorkspaceScopeMemory(store: WorkspaceStore, state: WorkspaceState): boolean {
  const [restored, setRestored] = useState(() => restoredStores.has(store));

  useEffect(() => {
    if (restored || state.runtime?.status !== "ready" || state.projectsState !== "ready") return;
    let active = true;
    let restoration = restorationPromises.get(store);
    if (!restoration) {
      restoration = restoreRememberedWorkspaceScope(store, state.projects, readScope(window.localStorage))
        .finally(() => {
          restoredStores.add(store);
          restorationPromises.delete(store);
        });
      restorationPromises.set(store, restoration);
    }
    void restoration.finally(() => {
      if (active) setRestored(true);
    });
    return () => { active = false; };
  }, [restored, state.projects, state.projectsState, state.runtime?.status, store]);

  useEffect(() => {
    if (!restored) return;
    writeScope(window.localStorage, state);
  }, [restored, state.batchId, state.projectId, state.taskId]);

  return restored;
}
