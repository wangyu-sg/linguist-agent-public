import {
  applyTaskRunEventPage,
  parseTaskRunEvent,
  TASK_WORKSPACE_SCHEMA_VERSION,
  type TaskRunEvent,
  type TaskWorkspaceSnapshot,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

export class TaskEventGapError extends Error {
  readonly expectedSeq: number;
  readonly receivedSeq: number;

  constructor(expectedSeq: number, receivedSeq: number) {
    super(`Task event gap: expected ${expectedSeq}, received ${receivedSeq}.`);
    this.name = "TaskEventGapError";
    this.expectedSeq = expectedSeq;
    this.receivedSeq = receivedSeq;
  }
}

export interface TaskEventNoticeModel {
  live: "polite" | "assertive";
  title: string;
  detail: string;
  action?: string;
}

export function taskEventNotice(state: {
  eventState: "idle" | "connected" | "reconnecting" | "closed" | "error";
  eventMessage: string | null;
}): TaskEventNoticeModel | null {
  if (state.eventState === "reconnecting") {
    return {
      live: "polite",
      title: "正在恢复 Task 更新",
      detail: state.eventMessage ?? "当前内容保持可读，连接恢复后会继续接收 canonical 更新。",
    };
  }
  if (state.eventState === "error" || state.eventState === "closed") {
    return {
      live: "assertive",
      title: state.eventState === "error" ? "Task 更新已中断" : "Task 更新连接已关闭",
      detail: state.eventMessage ?? "请刷新 canonical Task 快照并重新连接。",
      action: "刷新并重新连接",
    };
  }
  return null;
}

function cursorSeq(cursor: string, taskId: string): number | null {
  const prefix = `${taskId}:`;
  if (!cursor.startsWith(prefix)) return null;
  const value = Number(cursor.slice(prefix.length));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Applies one canonical SSE event without creating a second renderer event model. */
export function applyTaskEvent(
  snapshot: TaskWorkspaceSnapshot,
  input: TaskRunEvent | unknown,
): TaskWorkspaceSnapshot {
  const event = parseTaskRunEvent(input);
  if (event.taskId !== snapshot.task.id) return snapshot;

  const currentSeq = cursorSeq(snapshot.eventCursor, snapshot.task.id);
  if (currentSeq !== null) {
    if (event.seq <= currentSeq) return snapshot;
    if (event.seq !== currentSeq + 1) throw new TaskEventGapError(currentSeq + 1, event.seq);
  }

  return applyTaskRunEventPage(snapshot, {
    schemaVersion: TASK_WORKSPACE_SCHEMA_VERSION,
    taskId: event.taskId,
    runId: event.runId,
    afterCursor: snapshot.eventCursor,
    nextCursor: event.cursor,
    hasMore: false,
    events: [event],
  });
}
