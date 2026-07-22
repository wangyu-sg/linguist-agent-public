import {
  taskActiveRunSummary,
  type TaskActiveRunSummary,
  type TaskRecord,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { WorkspaceState } from "../data/workspace-store.ts";
import type { StatusState } from "../ui";

export interface StatusPresentation {
  label: string;
  state: StatusState;
}

function activeRunSummary(task: TaskRecord, state: WorkspaceState): TaskActiveRunSummary | null {
  const selected = state.task?.task;
  if (
    selected?.id === task.id
    && selected.owner.kind === task.owner.kind
    && (selected.owner.kind === "standalone" || (
      task.owner.kind === "project" && selected.owner.projectId === task.owner.projectId
    ))
  ) return taskActiveRunSummary(state.task!);
  return task.owner.kind === "standalone"
    ? state.chatActiveRunsByTaskId[task.id] ?? null
    : state.activeRunsByTaskId[task.id] ?? null;
}

export function statusPresentation(task: TaskRecord, state: WorkspaceState): StatusPresentation | null {
  const runStatus = activeRunSummary(task, state)?.status;
  switch (runStatus) {
    case "pending": return { label: "准备中", state: "neutral" };
    case "active": return { label: "运行中", state: "running" };
    case "awaiting_input": return { label: "需要输入", state: "waiting" };
    case "waiting": return { label: "等待中", state: "waiting" };
    case "stopping": return { label: "正在停止", state: "stopping" };
    case "stopped": return { label: "已停止", state: "stopped" };
    case "failed":
    case "stale": return { label: "失败", state: "failed" };
    case "complete": return { label: "完成", state: "complete" };
    default: break;
  }
  switch (task.status) {
    case "active": return { label: "进行中", state: "neutral" };
    case "awaiting_input": return { label: "需要输入", state: "waiting" };
    case "failed": return { label: "失败", state: "failed" };
    case "stopped": return { label: "已停止", state: "stopped" };
    case "complete": return { label: "完成", state: "complete" };
    case "draft": return { label: "草稿", state: "neutral" };
    case "archived": return { label: "已归档", state: "neutral" };
    default: return null;
  }
}

export function taskBucket(task: TaskRecord, state: WorkspaceState): "attention" | "running" | "recent" {
  const runStatus = activeRunSummary(task, state)?.status;
  if (task.status === "awaiting_input" || task.status === "failed" || runStatus === "awaiting_input" || runStatus === "failed" || runStatus === "stale") {
    return "attention";
  }
  if (runStatus === "active" || runStatus === "stopping") return "running";
  return "recent";
}

export function sortSidebarTasks(tasks: TaskRecord[], state: WorkspaceState): TaskRecord[] {
  return [...tasks].sort((left, right) => {
    const leftUpdatedAt = activeRunSummary(left, state)?.updatedAt ?? left.updatedAt;
    const rightUpdatedAt = activeRunSummary(right, state)?.updatedAt ?? right.updatedAt;
    return rightUpdatedAt.localeCompare(leftUpdatedAt) || left.id.localeCompare(right.id);
  });
}
