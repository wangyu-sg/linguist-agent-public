import type { ProjectSummary } from "../data/workspace-client.ts";
import type { WorkspaceState } from "../data/workspace-store.ts";

export type TaskWorkspaceMode = "conversation" | "cat" | "review" | "qa" | "delivery" | "eval";
export type ProductSurface = TaskWorkspaceMode | "assets" | "library" | "settings";

export function projectFor(state: WorkspaceState): ProjectSummary | null {
  return state.projects.find((project) => project.projectId === state.projectId) ?? null;
}
