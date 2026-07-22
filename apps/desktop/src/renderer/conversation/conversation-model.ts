import type {
  TaskActivity,
  TaskAgentThread,
  TaskArtifact,
  TaskDecision,
  TaskRun,
  TaskWorkspaceSnapshot,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

type BaseItem = {
  id: string;
  occurredAt: string;
  order: number;
};

export type ConversationItem =
  | (BaseItem & { kind: "activity"; activity: TaskActivity; thread?: TaskAgentThread })
  | (BaseItem & { kind: "process"; activities: TaskActivity[]; thread?: TaskAgentThread })
  | (BaseItem & { kind: "artifact"; artifact: TaskArtifact; thread?: TaskAgentThread })
  | (BaseItem & { kind: "decision"; interactionId: string | null; decisions: TaskDecision[]; thread?: TaskAgentThread })
  | (BaseItem & { kind: "specialist"; thread: TaskAgentThread })
  | (BaseItem & { kind: "run"; phase: "started" | "status"; run: TaskRun; thread?: TaskAgentThread });

export type ConversationFilterKind = "all" | "messages" | "process" | "artifacts" | "decisions";

export interface ConversationFilter {
  query?: string;
  kind?: ConversationFilterKind;
  threadId?: string;
  runId?: string;
}

/**
 * Permission audit Activities remain in canonical server history while the
 * pending request is rendered as its dedicated interactive card. Keeping the
 * audit line out of chat prevents a resolved request from reappearing as a
 * fake unresolved message after Task reopen or event-gap recovery.
 */
export function isPermissionAuditActivity(activity: TaskActivity): boolean {
  return activity.type === "elicitation"
    && activity.id.includes(".permission.")
    && activity.title.startsWith("Permission required · ");
}

const terminalRunStatuses = new Set(["stopping", "stopped", "failed", "stale", "complete"]);

function earliest(values: string[]): string {
  return values.reduce((left, right) => left.localeCompare(right) <= 0 ? left : right);
}

/**
 * Builds one chronology from canonical objects. Activity wrappers that only
 * announce an Artifact or Decision are suppressed because the typed object is
 * rendered at that same chronological position.
 */
export function buildConversationItems(snapshot: TaskWorkspaceSnapshot): ConversationItem[] {
  const threads = new Map(snapshot.agentThreads.map((thread) => [thread.id, thread]));
  const runs = new Map(snapshot.runs.map((run) => [run.id, run]));
  const artifactIds = new Set(snapshot.artifacts.map((artifact) => artifact.id));
  const decisionIds = new Set(snapshot.decisions.map((decision) => decision.id));
  const items: ConversationItem[] = [];
  const firstRootReplyByRun = new Map<string, TaskActivity>();
  for (const activity of snapshot.activities) {
    const run = runs.get(activity.runId);
    if (
      activity.type !== "final_response"
      || !run
      || activity.agentThreadId !== run.rootAgentThreadId
    ) continue;
    const current = firstRootReplyByRun.get(run.id);
    if (!current || activity.createdAt < current.createdAt) firstRootReplyByRun.set(run.id, activity);
  }

  for (const run of snapshot.runs) {
    const thread = threads.get(run.rootAgentThreadId);
    if (run.startedAt) {
      items.push({ id: `run:${run.id}:started`, kind: "run", phase: "started", run, thread, occurredAt: run.startedAt, order: 0 });
    }
    if (terminalRunStatuses.has(run.status)) {
      const firstRootReply = firstRootReplyByRun.get(run.id);
      items.push({
        id: `run:${run.id}:${run.status}`,
        kind: "run",
        phase: "status",
        run,
        thread,
        occurredAt: firstRootReply?.createdAt ?? run.completedAt ?? run.updatedAt,
        // Codex places Worked between the process trace and the root reply.
        // Canonical completion is recorded later, so presentation anchors the
        // divider to the first durable Main reply without rewriting history.
        order: firstRootReply ? 29 : 90,
      });
    }
  }

  for (const thread of snapshot.agentThreads) {
    if (thread.identity.kind !== "specialist") continue;
    items.push({
      id: `specialist:${thread.id}`,
      kind: "specialist",
      thread,
      occurredAt: thread.createdAt,
      order: 20,
    });
  }

  for (const activity of snapshot.activities) {
    if (isPermissionAuditActivity(activity)) continue;
    const replacedByArtifact = activity.type === "artifact_update" && activity.refs.artifactIds.some((id) => artifactIds.has(id));
    const replacedByDecision = (activity.type === "elicitation" || activity.type === "decision")
      && activity.refs.decisionIds.some((id) => decisionIds.has(id));
    if (replacedByArtifact || replacedByDecision) continue;
    items.push({
      id: `activity:${activity.id}`,
      kind: "activity",
      activity,
      thread: threads.get(activity.agentThreadId),
      occurredAt: activity.createdAt,
      order: activity.actor.kind === "human" ? 10 : activity.type === "final_response" ? 30 : 25,
    });
  }

  for (const artifact of snapshot.artifacts) {
    items.push({
      id: `artifact:${artifact.id}`,
      kind: "artifact",
      artifact,
      thread: threads.get(artifact.provenance.agentThreadId),
      occurredAt: artifact.createdAt,
      order: 40,
    });
  }

  const decisions = new Map<string, { interactionId: string | null; rows: TaskDecision[] }>();
  for (const decision of snapshot.decisions) {
    const key = decision.interactionId ?? `decision:${decision.id}`;
    const group = decisions.get(key) ?? { interactionId: decision.interactionId ?? null, rows: [] };
    group.rows.push(decision);
    decisions.set(key, group);
  }
  for (const [key, group] of decisions) {
    const rows = group.rows.sort((left, right) => (left.questionIndex ?? 0) - (right.questionIndex ?? 0) || left.createdAt.localeCompare(right.createdAt));
    items.push({
      id: `decision-group:${key}`,
      kind: "decision",
      interactionId: group.interactionId,
      decisions: rows,
      thread: threads.get(rows[0]!.requestedByThreadId),
      occurredAt: earliest(rows.map((decision) => decision.createdAt)),
      order: 45,
    });
  }

  return groupProcessActivities(
    items.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.order - right.order || left.id.localeCompare(right.id)),
  );
}

type ActivityItem_ = BaseItem & { kind: "activity"; activity: TaskActivity; thread?: TaskAgentThread };

export interface ProcessActivitySummary {
  title: string;
  detail: string | null;
  repeatCount: number;
}

/**
 * 过程类活动:工具调用、进展、查阅、确认等——聊天里折叠成组。
 * 人类消息、Agent 文档与错误永远保持独立可见。
 */
function isProcessActivityItem(item: ConversationItem): item is ActivityItem_ {
  return item.kind === "activity"
    && item.activity.actor.kind !== "human"
    && item.activity.type !== "final_response"
    && item.activity.type !== "message"
    && item.activity.type !== "error";
}

function processActivitySignature(activity: TaskActivity): string {
  if (activity.tool) return `tool:${activity.tool.effect}:${activity.tool.name}`;
  if (activity.type === "evidence_read") return "evidence_read";
  return `${activity.type}:${activity.title}`;
}

function boundedProcessDetail(value: string | null | undefined): string | null {
  const detail = value?.trim();
  if (!detail || /^\s*[{[]/.test(detail)) return null;
  return detail.length > 160 ? `${detail.slice(0, 157)}…` : detail;
}

/** Codex-style semantic activity line instead of a generic "N steps" card. */
export function summarizeProcessActivities(activities: TaskActivity[], live = false): ProcessActivitySummary {
  const focus = activities.findLast((activity) => activity.status === "running" || activity.status === "pending")
    ?? activities.at(-1);
  if (!focus) return { title: live ? "正在工作" : "已完成工作", detail: null, repeatCount: 0 };

  if (focus.tool) {
    const verbs = {
      read: live ? "正在读取" : "已读取",
      write: live ? "正在写入" : "已写入",
      execute: live ? "正在运行" : "已运行",
    } as const;
    const targets = [...new Set(activities.flatMap((activity) => {
      const target = boundedProcessDetail(activity.tool?.target) ?? activity.tool?.name?.trim();
      return target ? [target] : [];
    }))];
    const shown = targets.slice(0, 2).join(" · ");
    return {
      title: verbs[focus.tool.effect],
      detail: shown ? `${shown}${targets.length > 2 ? ` +${targets.length - 2}` : ""}` : null,
      repeatCount: activities.length,
    };
  }

  const titles: Partial<Record<TaskActivity["type"], [string, string]>> = {
    acknowledgement: ["正在接收任务", "已接收任务"],
    plan: ["正在制定计划", "已制定计划"],
    progress: ["正在处理", "已完成处理"],
    evidence_read: ["正在查阅证据", "已查阅证据"],
    artifact_update: ["正在更新产物", "已更新产物"],
    handoff: ["正在协调专家", "已协调专家"],
    elicitation: ["正在等待决定", "等待决定"],
    decision: ["正在记录决定", "已记录决定"],
    usage: ["正在记录用量", "已记录用量"],
  };
  const pair = titles[focus.type];
  return {
    title: pair ? pair[live ? 0 : 1] : focus.title,
    detail: boundedProcessDetail(focus.body) ?? boundedProcessDetail(focus.title),
    repeatCount: activities.length,
  };
}

/**
 * Collapses runs of consecutive process activities into one collapsible
 * group so tool chatter never floods the conversation. Groups never mix
 * threads; a lone process activity renders on its own.
 */
function groupProcessActivities(sorted: ConversationItem[]): ConversationItem[] {
  const grouped: ConversationItem[] = [];
  let pending: ActivityItem_[] = [];
  const flush = () => {
    if (!pending.length) return;
    const first = pending[0]!;
    grouped.push({
      id: `process:${first.activity.id}`,
      kind: "process",
      activities: pending.map((item) => item.activity),
      thread: first.thread,
      occurredAt: first.occurredAt,
      order: first.order,
    });
    pending = [];
  };
  for (const item of sorted) {
    if (isProcessActivityItem(item)) {
      const previous = pending[pending.length - 1];
      if (previous && (
        (previous.thread?.id ?? "") !== (item.thread?.id ?? "")
        || processActivitySignature(previous.activity) !== processActivitySignature(item.activity)
      )) flush();
      pending.push(item);
    } else {
      flush();
      grouped.push(item);
    }
  }
  flush();
  return grouped;
}

function itemThreadId(item: ConversationItem): string | undefined {
  switch (item.kind) {
    case "activity": return item.activity.agentThreadId;
    case "process": return item.activities[0]?.agentThreadId;
    case "artifact": return item.artifact.provenance.agentThreadId;
    case "decision": return item.decisions[0]?.requestedByThreadId;
    case "specialist": return item.thread.id;
    case "run": return item.run.rootAgentThreadId;
  }
}

function itemRunId(item: ConversationItem): string | undefined {
  switch (item.kind) {
    case "activity": return item.activity.runId;
    case "process": return item.activities[0]?.runId;
    case "artifact": return item.artifact.runId;
    case "decision": return item.decisions[0]?.runId;
    case "specialist": return item.thread.runId;
    case "run": return item.run.id;
  }
}

function itemMatchesKind(item: ConversationItem, kind: ConversationFilterKind): boolean {
  if (kind === "all") return true;
  if (kind === "messages") {
    return item.kind === "activity"
      && (item.activity.type === "message" || item.activity.type === "final_response");
  }
  if (kind === "artifacts") return item.kind === "artifact";
  if (kind === "decisions") return item.kind === "decision";
  return item.kind === "run"
    || item.kind === "specialist"
    || item.kind === "process"
    || (item.kind === "activity" && item.activity.type !== "message" && item.activity.type !== "final_response");
}

function activitySearchText(activity: TaskActivity, thread?: TaskAgentThread): string {
  return [
    activity.title,
    activity.body,
    activity.actor.displayName,
    thread?.identity.displayName,
    thread?.identity.roleLabel,
    activity.type,
    activity.status,
    activity.tool?.name,
    activity.tool?.target,
    activity.tool?.outcome,
    ...activity.refs.artifactIds,
    ...activity.refs.evidenceRefs,
    ...activity.refs.decisionIds,
    ...(activity.refs.segmentIds ?? []),
  ].filter(Boolean).join(" ");
}

function itemSearchText(item: ConversationItem): string {
  switch (item.kind) {
    case "activity":
      return activitySearchText(item.activity, item.thread);
    case "process":
      return item.activities.map((activity) => activitySearchText(activity, item.thread)).join(" ");
    case "artifact":
      return [
        item.artifact.title,
        item.artifact.summary,
        item.artifact.type,
        item.artifact.status,
        item.thread?.identity.displayName,
        item.thread?.identity.roleLabel,
        ...item.artifact.provenance.evidenceRefs,
        ...(item.artifact.scope.kind === "project" ? item.artifact.scope.segmentIds : []),
      ].filter(Boolean).join(" ");
    case "decision":
      return item.decisions.flatMap((decision) => [
        decision.prompt,
        decision.kind,
        decision.status,
        decision.responseText,
        ...(decision.selectedOptionIds ?? []),
        ...decision.options.flatMap((option) => [option.label, option.description, option.preview]),
      ]).filter(Boolean).join(" ");
    case "specialist":
      return [item.thread.identity.displayName, item.thread.identity.roleLabel, item.thread.handoffSummary, item.thread.status].filter(Boolean).join(" ");
    case "run":
      return [item.run.id, item.run.mode, item.run.status, item.thread?.identity.displayName, item.thread?.identity.roleLabel].filter(Boolean).join(" ");
  }
}

/**
 * Non-destructive, in-memory filtering over the already complete canonical
 * chronology. The server remains the only history owner and no rows are
 * paged, truncated, or rewritten for this view.
 */
export function filterConversationItems(items: ConversationItem[], filter: ConversationFilter): ConversationItem[] {
  const kind = filter.kind ?? "all";
  const tokens = (filter.query ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  return items.filter((item) => {
    if (!itemMatchesKind(item, kind)) return false;
    if (filter.threadId && itemThreadId(item) !== filter.threadId) return false;
    if (filter.runId && itemRunId(item) !== filter.runId) return false;
    if (!tokens.length) return true;
    const haystack = itemSearchText(item).normalize("NFKC").toLocaleLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * Specialist/deterministic threads of one Run, in canonical join order.
 * Powers the Team Run cast strip; read-only over the snapshot.
 */
export function runCastThreads(snapshot: TaskWorkspaceSnapshot, runId: string): TaskAgentThread[] {
  return snapshot.agentThreads
    .filter((thread) => thread.runId === runId && thread.identity.kind !== "main")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

/**
 * threadId → latest durable activity title, derived from the canonical
 * activity log (highest seq wins). Used for "当前活动" persona captions.
 */
export function latestActivityTitles(snapshot: TaskWorkspaceSnapshot): Map<string, string> {
  const latest = new Map<string, TaskActivity>();
  for (const activity of snapshot.activities) {
    const current = latest.get(activity.agentThreadId);
    if (!current || activity.seq >= current.seq) latest.set(activity.agentThreadId, activity);
  }
  return new Map([...latest].map(([threadId, activity]) => [threadId, activity.title]));
}

/**
 * True when an artifact's summary is just a truncated copy of a
 * final_response already rendered as a document in the same Run —
 * the timeline then shows a slim card instead of a duplicated preview.
 */
export function artifactSummaryDuplicatesReply(artifact: TaskArtifact, activities: TaskActivity[]): boolean {
  const clean = (value: string) => value.replace(/[*`>#\-[\]()]/g, "").replace(/\s+/g, " ").trim();
  const probe = clean(artifact.summary ?? "").slice(0, 40);
  if (probe.length < 24) return false;
  return activities.some((activity) => (
    activity.runId === artifact.runId
    && activity.type === "final_response"
    && clean(activity.body ?? "").includes(probe)
  ));
}
