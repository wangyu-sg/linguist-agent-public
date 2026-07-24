import type { TaskRun, TaskWorkspaceSnapshot } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { PiProviderCatalog } from "../data/workspace-client.ts";

export function availableModels(catalog: PiProviderCatalog | null, providerId: string) {
  return (catalog?.providers.find((provider) => provider.id === providerId)?.models ?? [])
    .filter((model) => model.available)
    .sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id));
}

export function latestManifestRun(snapshot: TaskWorkspaceSnapshot | null): TaskRun | null {
  return [...(snapshot?.runs ?? [])]
    .filter((run) => run.resourceManifest)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0] ?? null;
}

export function displayHash(value?: string | null): string {
  return value || "未记录";
}

export function formatUptime(seconds?: number): string {
  if (seconds === undefined) return "未报告";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "未报告";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
