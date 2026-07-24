import { parseRichArtifactDocument, type RichArtifactTodoItemV1 } from "../../../../../packages/cat-data/src/rich_artifact.ts";
import type { TaskArtifact, TaskWorkspaceSnapshot } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

export type AgentPlanTodos = {
  artifactId: string;
  version: number;
  title: string;
  items: RichArtifactTodoItemV1[];
};

export type AgentPlanProgress = {
  completed: number;
  total: number;
  /** 首个 in_progress 的序号(1-based);否则首个 pending;全部完成时为 total。 */
  currentStep: number;
  allComplete: boolean;
};

/** 每个 Task 最多一个 canonical 工作计划(agent-plan:<taskId>),取最新版本。 */
export function latestAgentPlan(snapshot: Pick<TaskWorkspaceSnapshot, "artifacts"> | null | undefined): AgentPlanTodos | null {
  if (!snapshot) return null;
  const artifact = [...(snapshot.artifacts ?? [])]
    .filter((entry) => entry.type === "agent_plan")
    .sort((left, right) => right.version - left.version)[0] as TaskArtifact | undefined;
  if (!artifact) return null;
  try {
    const document = parseRichArtifactDocument(artifact.content.document);
    const block = document.blocks.find((entry) => entry.type === "todo_list");
    if (!block || block.type !== "todo_list") return null;
    return { artifactId: artifact.id, version: artifact.version, title: artifact.title, items: block.items };
  } catch {
    return null;
  }
}

export function planProgress(items: readonly RichArtifactTodoItemV1[]): AgentPlanProgress {
  const total = items.length;
  const completed = items.filter((item) => item.status === "completed").length;
  const inProgressIndex = items.findIndex((item) => item.status === "in_progress");
  const pendingIndex = items.findIndex((item) => item.status === "pending");
  const currentStep = inProgressIndex >= 0 ? inProgressIndex + 1 : pendingIndex >= 0 ? pendingIndex + 1 : total;
  return { completed, total, currentStep, allComplete: total > 0 && completed === total };
}

/** 进度环几何:0..1 完成度对应的 SVG dashoffset(周长 100)。 */
export function planRingDashoffset(progress: AgentPlanProgress): number {
  const ratio = progress.total === 0 ? 0 : progress.completed / progress.total;
  return Math.round((1 - Math.min(1, Math.max(0, ratio))) * 1000) / 10;
}
