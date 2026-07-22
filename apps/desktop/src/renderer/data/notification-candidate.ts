import type { NotificationCategory } from "./workspace-client.ts";

export interface NotificationCandidate {
  id: string;
  category: NotificationCategory;
  projectId: string;
  taskId: string;
  runId: string;
  occurredAt: string;
  title: string;
  body: string;
}

const categories = new Set<NotificationCategory>(["waiting", "failed", "completed", "permission"]);

export function parseNotificationCandidate(value: unknown): NotificationCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id.trim() || typeof candidate.category !== "string" || !categories.has(candidate.category as NotificationCategory)) return null;
  if (typeof candidate.projectId !== "string" || !candidate.projectId.trim() || typeof candidate.taskId !== "string" || !candidate.taskId.trim() || typeof candidate.runId !== "string" || !candidate.runId.trim()) return null;
  if (typeof candidate.occurredAt !== "string" || !Number.isFinite(new Date(candidate.occurredAt).valueOf())) return null;
  if (typeof candidate.title !== "string" || !candidate.title.trim() || typeof candidate.body !== "string" || !candidate.body.trim()) return null;
  return {
    id: candidate.id,
    category: candidate.category as NotificationCategory,
    projectId: candidate.projectId,
    taskId: candidate.taskId,
    runId: candidate.runId,
    occurredAt: candidate.occurredAt,
    title: candidate.title,
    body: candidate.body,
  };
}

const copy: Record<NotificationCategory, { title: string; body: string }> = {
  waiting: { title: "Linguist Agent 等待你的决定", body: "当前 Task 需要你的输入才能继续。" },
  failed: { title: "Linguist Agent 运行失败", body: "当前 Run 已失败，可回到 Task 查看详情并重试。" },
  completed: { title: "Linguist Agent 已完成", body: "当前 Run 已完成，请查看结果与 Artifact。" },
  permission: { title: "Linguist Agent 需要权限", body: "当前 Run 请求一个需要确认的能力。" },
};

export function notificationCandidateForTaskEvent(projectId: string, value: unknown): NotificationCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const id = typeof event.id === "string" ? event.id : null;
  const taskId = typeof event.taskId === "string" ? event.taskId : null;
  const runId = typeof event.runId === "string" ? event.runId : null;
  const occurredAt = typeof event.occurredAt === "string" ? event.occurredAt : null;
  if (!id || !taskId || !runId || !occurredAt || !projectId) return null;
  let category: NotificationCategory | null = null;
  if (event.type === "run_upsert") {
    const status = (event.run as Record<string, unknown> | undefined)?.status;
    if (status === "awaiting_input" || status === "waiting") category = "waiting";
    else if (status === "failed") category = "failed";
    else if (status === "complete") category = "completed";
  } else if (event.type === "activity_append") {
    const activity = event.activity as Record<string, unknown> | undefined;
    if (activity?.type === "elicitation" && activity.status === "blocked") category = "permission";
  }
  if (!category) return null;
  return {
    id: `${projectId}:${id}`,
    category,
    projectId,
    taskId,
    runId,
    occurredAt,
    ...copy[category],
  };
}
