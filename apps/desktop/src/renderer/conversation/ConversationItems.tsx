import {
  memo,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Activity as ActivityIcon,
  Brain,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleStop,
  Clock3,
  FileText,
  GitBranch,
  LoaderCircle,
  MessageSquareText,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  TaskActivity,
  TaskAgentThread,
  TaskArtifact,
  TaskRun,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { TaskPermissionRequest } from "../data/workspace-client.ts";
import type { WorkspaceStore } from "../data/workspace-store.ts";
import { Button, StatusLabel } from "../ui/index.ts";
import {
  artifactSummaryDuplicatesReply,
  latestActivityTitles,
  runCastThreads,
  summarizeProcessActivities,
  type ConversationFilterKind,
  type ConversationItem,
} from "./conversation-model.ts";
import { PersonaAvatar } from "./PersonaAvatar.tsx";
import {
  personaStatusForRunStatus,
  resolvePersona,
  type Persona,
} from "./personas.ts";
import { formatRunElapsed } from "../composer/index.ts";
import { CanonicalDecision, DecisionInteraction } from "./DecisionInteraction.tsx";
import { approvalKeyAction } from "./approval-keys.ts";

export type PendingMessage = {
  id: string;
  text: string;
  sentAt: string;
  // A successfully closed stream is not necessarily in the next canonical
  // Task projection yet. Preserve the user's turn as a normal-looking local
  // message until the server-owned Activity confirms it.
  status: "sending" | "sent" | "failed";
  error?: string;
};

export type TimelineEntry =
  | { id: string; kind: "canonical"; item: ConversationItem }
  | { id: string; kind: "permission"; request: TaskPermissionRequest }
  | { id: string; kind: "permission-error" }
  | { id: string; kind: "pending"; message: PendingMessage }
  | { id: string; kind: "live"; reply: LiveReply };

export type LiveReply = {
  startedAt: string;
  runId?: string;
  text: string;
  // Content-free signal only; hidden reasoning never enters renderer state.
  thinking: boolean;
  status: "streaming" | "complete" | "failed";
  error?: string;
};
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const runStatusLabels: Record<TaskRun["status"], string> = {
  pending: "准备中",
  active: "运行中",
  awaiting_input: "等待你的决定",
  waiting: "等待中",
  stopping: "正在停止",
  stopped: "已停止",
  failed: "失败",
  stale: "已失效",
  complete: "已完成",
};

const activityLabels: Record<TaskActivity["type"], string> = {
  message: "消息",
  acknowledgement: "已接收任务",
  plan: "计划",
  progress: "进展",
  evidence_read: "查阅证据",
  tool_action: "执行工具",
  artifact_update: "更新产物",
  handoff: "专家协作",
  elicitation: "等待决定",
  decision: "决定",
  usage: "用量",
  error: "错误",
  final_response: "回复",
};

const activityStatusLabels: Record<TaskActivity["status"], string> = {
  pending: "等待开始",
  running: "进行中",
  done: "已完成",
  blocked: "等待处理",
  stale: "已失效",
  error: "失败",
};

export function estimatedTimelineEntrySize(entry: TimelineEntry | undefined): number {
  if (!entry) return 88;
  if (entry.kind === "pending") return 72;
  if (entry.kind === "live") return 256;
  if (entry.kind === "permission" || entry.kind === "permission-error") return 220;
  switch (entry.item.kind) {
    case "activity":
      return isHumanMessage(entry.item.activity) ? 84 : isAgentDocument(entry.item.activity) ? 120 : 40;
    case "process":
      return 44;
    case "artifact": return 104;
    case "decision": return 180;
    case "specialist": return 96;
    case "run": return 72;
  }
}

const activityIcons: Record<TaskActivity["type"], typeof ActivityIcon> = {
  message: MessageSquareText,
  acknowledgement: CircleCheck,
  plan: ActivityIcon,
  progress: LoaderCircle,
  evidence_read: Search,
  tool_action: Wrench,
  artifact_update: FileText,
  handoff: GitBranch,
  elicitation: CircleHelp,
  decision: CircleCheck,
  usage: ActivityIcon,
  error: CircleAlert,
  final_response: MessageSquareText,
};

const artifactTypeLabels: Record<TaskArtifact["type"], string> = {
  segment_proposal: "句段建议",
  segment_diff: "句段变更",
  evidence_pack: "证据包",
  agent_query: "Agent 查询",
  qa_finding: "QA 发现",
  qa_report: "QA 报告",
  delivery_readiness: "交付准备度",
  delivery_export: "交付文件",
  eval_output: "评估输出",
  eval_scorecard: "评估评分",
  eval_comparison: "评估对比",
  context_handoff: "上下文交接",
  memory: "记忆",
  guidance: "工作指南",
  document_evidence: "文档证据",
  rich_document: "富文档",
  maintenance_plan: "维护计划",
  package_audit: "Package 审计",
  file: "文件",
  preview: "预览",
};

export const historyKindLabels: Array<{ value: ConversationFilterKind; label: string }> = [
  { value: "all", label: "全部类型" },
  { value: "messages", label: "对话消息" },
  { value: "process", label: "工作过程" },
  { value: "artifacts", label: "产物" },
  { value: "decisions", label: "决定" },
];

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : dateFormatter.format(date);
}

function runDurationLabel(run: TaskRun): string | null {
  if (!run.startedAt) return null;
  const start = new Date(run.startedAt).valueOf();
  const end = new Date(run.completedAt ?? run.updatedAt).valueOf();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function statusState(status: TaskRun["status"]): "neutral" | "running" | "waiting" | "stopping" | "stopped" | "complete" | "failed" {
  if (status === "active" || status === "pending") return "running";
  if (status === "awaiting_input" || status === "waiting") return "waiting";
  if (status === "complete") return "complete";
  if (status === "failed" || status === "stale") return "failed";
  if (status === "stopping") return "stopping";
  if (status === "stopped") return "stopped";
  return "neutral";
}

function runStatusIcon(status: TaskRun["status"]): ReactElement {
  if (status === "active" || status === "pending") return <LoaderCircle />;
  if (status === "awaiting_input" || status === "waiting") return <Clock3 />;
  if (status === "complete") return <CircleCheck />;
  if (status === "failed" || status === "stale") return <CircleAlert />;
  return <CircleStop />;
}

function documentBody(body: string): ReactNode {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
      {body.trim()}
    </ReactMarkdown>
  );
}

export function activityText(activity: TaskActivity): string {
  return activity.body?.trim() || activity.title;
}

export function isAgentDocument(activity: TaskActivity): boolean {
  return activity.actor.kind === "agent" && (activity.type === "final_response" || activity.type === "message");
}

export function isHumanMessage(activity: TaskActivity): boolean {
  return activity.actor.kind === "human" && activity.type === "message";
}

function PersonaDocumentHeader({ activity, persona }: { activity: TaskActivity; persona: Persona }) {
  return (
    <header className="conversation-document__header">
      <PersonaAvatar persona={persona} size="sm" />
      <span className="conversation-document__identity" id={`activity-${activity.id}`}>
        <strong>{persona.personaName}</strong>
        <span className="conversation-document__role">{persona.title}</span>
      </span>
      <time dateTime={activity.createdAt}>{timeLabel(activity.createdAt)}</time>
    </header>
  );
}

function ActivityItem({ activity, thread, onInspect }: { activity: TaskActivity; thread?: TaskAgentThread; onInspect?: (activity: TaskActivity) => void }) {
  if (isHumanMessage(activity)) {
    return (
      <article className="conversation-human">
        <header>
          <span className="conversation-human__label">你</span>
          <time dateTime={activity.createdAt}>{timeLabel(activity.createdAt)}</time>
        </header>
        <p>{activityText(activity)}</p>
        <span className="la-sr-only">你发送的消息</span>
      </article>
    );
  }

  if (isAgentDocument(activity)) {
    const persona = resolvePersona(thread?.identity ?? null);
    return (
      <article className="conversation-document" data-status={activity.status} data-hue={persona.hueKey} aria-labelledby={`activity-${activity.id}`}>
        <PersonaDocumentHeader activity={activity} persona={persona} />
        {activity.title && activity.title !== "Task complete" ? <h3>{activity.title}</h3> : null}
        <div className="conversation-document__body">{documentBody(activityText(activity))}</div>
      </article>
    );
  }

  const label = activityLabels[activity.type];
  const persona = thread ? resolvePersona(thread.identity) : null;
  const Icon = activity.status === "error" || activity.type === "error" ? CircleAlert : activityIcons[activity.type];
  const body = activity.body?.trim() || "";
  // 原始 JSON 参数/结果不进时间线——噪音;仍可从"查看上下文"检查。
  const showBody = Boolean(body) && body !== activity.title && !/^\s*[{[]/.test(body);
  return (
    <article className="conversation-activity" data-status={activity.status} data-type={activity.type} aria-labelledby={`activity-${activity.id}`}>
      <span className="conversation-activity__lead" aria-hidden="true">
        <span className="conversation-activity__mark"><Icon /></span>
      </span>
      <div className="conversation-activity__content">
        <header>
          <span id={`activity-${activity.id}`} className="conversation-activity__headline">
            <span className="la-sr-only">{label}，</span>
            {persona ? <span className="conversation-activity__author">{persona.personaName}</span> : <span className="conversation-activity__author">{activity.actor.displayName}</span>}
            <span className="conversation-activity__title">{activity.title}</span>
          </span>
          <span className="la-sr-only">{activityStatusLabels[activity.status]}</span>
          {activity.tool ? <code className="conversation-activity__tool-name" title={activity.tool.target ?? activity.tool.name}>{activity.tool.name}</code> : null}
          <time dateTime={activity.createdAt}>{timeLabel(activity.createdAt)}</time>
          {onInspect ? <Button className="conversation-activity__inspect" variant="ghost" onClick={() => onInspect(activity)}>查看上下文</Button> : null}
        </header>
        {showBody ? <p className="conversation-activity__detail">{body}</p> : null}
        {activity.tool ? (
          <p className="conversation-activity__tool">
            <span>{activity.tool.effect === "read" ? "读取" : activity.tool.effect === "write" ? "写入" : "执行"}</span>
            {activity.tool.outcome ? <span>{activity.tool.outcome}</span> : null}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * 过程组:同一执行者连续的工具/进展活动折叠成一行摘要。
 * live 只看"Run 进行中且有未完成活动"——历史遗留的 pending
 * 活动不会让老过程组永远转圈。运行中自动展开,完成后自动收起;
 * 筛选历史时强制展开。
 */
function ProcessGroup({ activities, thread, runActive = false, forceOpen = false, onInspect }: {
  activities: TaskActivity[];
  thread?: TaskAgentThread;
  runActive?: boolean;
  forceOpen?: boolean;
  onInspect?: (activity: TaskActivity) => void;
}) {
  const live = runActive && activities.some((activity) => activity.status === "running" || activity.status === "pending");
  const [toggledOpen, setToggledOpen] = useState<boolean | null>(null);
  const open = forceOpen || live || (toggledOpen ?? false);
  const processSummary = summarizeProcessActivities(activities, live);
  const last = activities[activities.length - 1]!;
  return (
    <details
      className="conversation-process"
      data-live={live || undefined}
      open={open}
      onToggle={(event) => setToggledOpen(event.currentTarget.open)}
    >
      <summary aria-label={`${processSummary.title}${processSummary.detail ? `，${processSummary.detail}` : ""}${processSummary.repeatCount > 1 ? `，${processSummary.repeatCount} 次` : ""}，${open ? "点击收起" : "点击展开"}`}>
        <ChevronRight className="conversation-process__chevron" aria-hidden="true" />
        <span className={live ? "conversation-process__label la-loading-shimmer" : "conversation-process__label"}>{processSummary.title}</span>
        {processSummary.detail ? <span className="conversation-process__detail">{processSummary.detail}</span> : null}
        {processSummary.repeatCount > 1 ? <span className="conversation-process__repeat">· {processSummary.repeatCount} 次</span> : null}
        {live ? (
          <span className="conversation-process__running"><LoaderCircle aria-hidden="true" /><span className="la-sr-only">运行中</span></span>
        ) : (
          <time dateTime={last.createdAt}>{timeLabel(last.createdAt)}</time>
        )}
      </summary>
      <div className="conversation-process__steps">
        {activities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} thread={thread} onInspect={onInspect} />
        ))}
      </div>
    </details>
  );
}

function ArtifactItem({ artifact, thread, duplicateOfReply = false, onInspect }: {
  artifact: TaskArtifact;
  thread?: TaskAgentThread;
  duplicateOfReply?: boolean;
  onInspect?: (artifact: TaskArtifact) => void;
}) {
  const scope = artifact.scope.kind === "project"
    ? [
        artifact.scope.batchId ? `Batch ${artifact.scope.batchId}` : null,
        artifact.scope.segmentIds.length ? `${artifact.scope.segmentIds.length} 个句段` : null,
      ].filter(Boolean).join(" · ")
    : artifact.scope.workingDirectoryGrantId ? "工作目录已授权" : "无项目 Chat";
  const persona = resolvePersona(thread?.identity ?? null);
  if (duplicateOfReply) {
    // 内容就是上方回复正文,收成一行,不再占一张卡。
    return (
      <div className="conversation-artifact--slim" data-hue={persona.hueKey}>
        <FileText aria-hidden="true" />
        <span className="conversation-artifact--slim__title">{artifact.title} · v{artifact.version}</span>
        <span className="conversation-artifact--slim__meta">{persona.personaName}{scope ? ` · ${scope}` : ""}</span>
        {onInspect ? <Button variant="ghost" size="small" onClick={() => onInspect(artifact)}>查看详情</Button> : null}
      </div>
    );
  }
  return (
    <article className="conversation-artifact" data-hue={persona.hueKey} aria-labelledby={`artifact-${artifact.id}`}>
      <span className="conversation-artifact__icon" aria-hidden="true"><FileText /></span>
      <div className="conversation-artifact__copy">
        <header>
          <span className="conversation-artifact__type">{artifactTypeLabels[artifact.type]}</span>
          <span>v{artifact.version}</span>
          <span className="conversation-artifact__author">{persona.personaName}</span>
          <time dateTime={artifact.createdAt}>{timeLabel(artifact.createdAt)}</time>
        </header>
        <h3 id={`artifact-${artifact.id}`}>{artifact.title}</h3>
        {artifact.summary ? <p>{artifact.summary}</p> : null}
        {scope ? <p className="conversation-artifact__scope">{scope}</p> : null}
      </div>
      {onInspect ? <Button variant="ghost" onClick={() => onInspect(artifact)}>查看详情</Button> : null}
    </article>
  );
}

function SpecialistItem({ thread, latestActivityTitle, focused, onFocusThread }: {
  thread: TaskAgentThread;
  latestActivityTitle?: string;
  focused: boolean;
  onFocusThread?: (threadId: string) => void;
}) {
  const persona = resolvePersona(thread.identity);
  const statusLabel = runStatusLabels[thread.status];
  const rawElapsed = formatRunElapsed(thread.createdAt, thread.updatedAt);
  const elapsed = rawElapsed && rawElapsed !== "0s" ? rawElapsed : null;
  const currentActivity = latestActivityTitle ?? thread.handoffSummary ?? null;
  const caption = `${persona.personaName}，${persona.title}，${statusLabel}`;
  return (
    <button
      type="button"
      className="conversation-specialist"
      data-hue={persona.hueKey}
      data-deterministic={persona.deterministic || undefined}
      data-active={focused || undefined}
      aria-pressed={focused}
      aria-label={focused ? `${caption}，正在筛选该成员的过程，点击恢复完整时间线` : `${caption}，点击只看该成员的过程`}
      title={persona.blurb || caption}
      onClick={() => onFocusThread?.(thread.id)}
    >
      <PersonaAvatar persona={persona} size="md" status={personaStatusForRunStatus(thread.status)} />
      <span className="conversation-specialist__body">
        <span className="conversation-specialist__heading">
          <strong>{persona.personaName}</strong>
          <span className="conversation-specialist__title">{persona.title}</span>
          {persona.deterministic ? <span className="conversation-specialist__system">System</span> : null}
        </span>
        {currentActivity ? <span className="conversation-specialist__activity">{currentActivity}</span> : null}
      </span>
      <span className="conversation-specialist__meta">
        <StatusLabel state={statusState(thread.status)} icon={runStatusIcon(thread.status)}>{statusLabel}</StatusLabel>
        {elapsed ? <time dateTime={thread.createdAt}>{elapsed}</time> : null}
      </span>
    </button>
  );
}

type CastMember = { thread: TaskAgentThread; latestActivityTitle?: string };

function TeamCastStrip({ cast }: { cast: CastMember[] }) {
  return (
    <div className="conversation-cast" aria-label="本次 Team 协作的成员阵容">
      {cast.map(({ thread, latestActivityTitle }) => {
        const persona = resolvePersona(thread.identity);
        const statusLabel = runStatusLabels[thread.status];
        const caption = `${persona.personaName} · ${persona.title} · ${latestActivityTitle ?? statusLabel}`;
        return (
          <span key={thread.id} className="conversation-cast__member" title={caption}>
            <PersonaAvatar persona={persona} size="sm" status={personaStatusForRunStatus(thread.status)} />
            <span className="la-sr-only">{caption}</span>
          </span>
        );
      })}
    </div>
  );
}

function RunBoundary({ run, phase, thread, cast, onResumeTeam }: {
  run: TaskRun;
  phase: "started" | "status";
  thread?: TaskAgentThread;
  cast?: CastMember[];
  onResumeTeam?: (workflowId: string) => Promise<void>;
}) {
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const duration = runDurationLabel(run);
  const label = phase === "started"
    ? `${thread?.identity.displayName ?? "Linguist Agent"} 开始${run.mode === "team" ? "协作" : "处理"}`
    : run.status === "complete"
      ? duration ? `Worked for ${duration}` : "Completed"
      : duration ? `${runStatusLabels[run.status]} · ${duration}` : runStatusLabels[run.status];
  const canResumeTeam = phase === "status" && run.mode === "team" && run.resumeAvailable && onResumeTeam;
  const startedLive = phase === "started" && (run.status === "active" || run.status === "pending");
  const resume = async () => {
    if (!canResumeTeam || isResuming) return;
    setIsResuming(true);
    setError(null);
    try {
      await onResumeTeam(run.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsResuming(false);
    }
  };
  return (
    <div className="conversation-run-boundary-wrap">
      {/* Codex spec 04 §4.2:turn 结束分界 = 灰字标签 + 通栏 1px 线(列方向 gap-2);
         开始边界保留标签 + 尾随短线的行内形态。 */}
      <div
        className={phase === "status" ? "conversation-run-boundary conversation-run-boundary--worked" : "conversation-run-boundary"}
        data-status={run.status}
        role="separator"
        aria-label={label}
      >
        <StatusLabel
          state={startedLive ? "running" : statusState(run.status)}
          icon={startedLive ? <LoaderCircle /> : runStatusIcon(run.status)}
        >
          {label}
        </StatusLabel>
        {phase === "status" ? <span className="conversation-run-boundary__rule" aria-hidden="true" /> : null}
      </div>
      {phase === "started" && run.mode === "team" && cast?.length ? <TeamCastStrip cast={cast} /> : null}
      {canResumeTeam ? (
        <div className="conversation-run-resume">
          <span>从停止的专家继续；不会跳过当前角色。</span>
          <Button loading={isResuming} onClick={() => void resume()}>继续 Team</Button>
        </div>
      ) : null}
      {error ? <p className="conversation-run-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function PendingHumanMessage({ message, onRetry }: { message: PendingMessage; onRetry: (message: PendingMessage) => void }) {
  const label = message.status === "failed"
    ? "发送失败"
    : message.status === "sending"
      ? "发送中"
      : "已发送";
  return (
    <article className="conversation-human conversation-human--pending" data-status={message.status} aria-label={`你的消息，${label}`}>
      <p>{message.text}</p>
      {message.status !== "sent" ? (
        <footer>
          <span role={message.status === "failed" ? "alert" : "status"}>
            {message.status === "failed" ? message.error ?? "发送失败" : "发送中…"}
          </span>
          {message.status === "failed" ? <Button variant="ghost" onClick={() => onRetry(message)}>重试</Button> : null}
        </footer>
      ) : null}
    </article>
  );
}

/** Content-free private-reasoning status; reviewable work is in Activity. */
function LiveReasoningBlock({ reply }: { reply: LiveReply }) {
  const isStreaming = reply.status === "streaming";
  const startMs = Date.parse(reply.startedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isStreaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  const elapsed = Number.isFinite(startMs) ? formatRunElapsed(reply.startedAt, null, now) : null;
  const label = isStreaming ? "正在思考…" : "已思考";
  return (
    <section
      className="conversation-reasoning"
      data-streaming={isStreaming || undefined}
      role="status"
      aria-label={`${label}${elapsed ? `，用时 ${elapsed}` : ""}`}
    >
      <div className="conversation-reasoning__header">
        <Brain aria-hidden="true" />
        <span className={isStreaming ? "conversation-reasoning__label la-loading-shimmer" : "conversation-reasoning__label"}>{label}</span>
        {elapsed ? <span className="conversation-reasoning__elapsed">{elapsed}</span> : null}
      </div>
    </section>
  );
}

export function LiveAgentReply({ reply }: { reply: LiveReply }) {
  const persona = resolvePersona(null);
  const isStreaming = reply.status === "streaming";
  const isFailed = reply.status === "failed";
  const label = isStreaming ? "主理人正在回复" : isFailed ? "主理人回复中断" : "主理人回复完成";
  return (
    <article
      className="conversation-document conversation-document--live"
      data-hue={persona.hueKey}
      data-streaming={isStreaming || undefined}
      aria-label={label}
      aria-busy={isStreaming}
    >
      <header className="conversation-document__header">
        <PersonaAvatar persona={persona} size="sm" status={isStreaming ? "running" : isFailed ? "failed" : "done"} />
        <span className="conversation-document__identity">
          <strong>{persona.personaName}</strong>
          <span className="conversation-document__role">{persona.title}</span>
        </span>
        {isStreaming || isFailed ? (
          <StatusLabel live={isStreaming} state={isStreaming ? "running" : "failed"} icon={isFailed ? <CircleAlert /> : <LoaderCircle />}>
            {isStreaming ? "正在回复" : "回复中断"}
          </StatusLabel>
        ) : null}
      </header>
      {reply.thinking ? <LiveReasoningBlock reply={reply} /> : null}
      {reply.text ? <div className="conversation-document__body">{documentBody(reply.text)}</div> : (
        <p className={isStreaming ? "conversation-live-placeholder la-loading-shimmer" : "conversation-live-placeholder"}>正在回复…</p>
      )}
      {reply.error ? <p className="conversation-live-error" role="alert">{reply.error}</p> : null}
    </article>
  );
}

const permissionDomainLabels: Record<TaskPermissionRequest["domain"], string> = {
  fileRead: "读取本地文件",
  fileWrite: "写入普通文件",
  webRead: "访问网络",
  bash: "运行命令",
  bridge: "使用外部连接",
};

const permissionRiskLabels: Record<TaskPermissionRequest["riskClass"], string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  protected: "受保护",
  non_picker: "系统规则",
};

export function PermissionRequestItem({
  request,
  disabled,
  onDecide,
}: {
  request: TaskPermissionRequest;
  disabled: boolean;
  onDecide: (requestId: string, decision: "approve" | "deny", reason?: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewCollapsible, setPreviewCollapsible] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLPreElement>(null);
  const isResourceTrust = request.toolName === "Trust Pi Extension executable code"
    || request.toolName === "Trust working-directory Pi resources";
  const expiresAt = Date.parse(request.expiresAt);
  const expired = request.status === "expired" || Number.isFinite(expiresAt) && clock >= expiresAt;
  const status = expired ? "expired" : request.status;
  const canDecide = !disabled && (status === "pending" || status === "error");

  useEffect(() => {
    if (status !== "pending" || !Number.isFinite(expiresAt)) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.max(0, expiresAt - Date.now()) + 10);
    return () => window.clearTimeout(timer);
  }, [expiresAt, status]);

  // Codex spec 05 §1.3:参数预览折叠阈值 3 行;内容不超过 3 行时不显示展开钮。
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || previewExpanded) return;
    setPreviewCollapsible(preview.scrollHeight - preview.clientHeight > 1);
  }, [request.argsSummary, previewExpanded]);

  const decide = async (decision: "approve" | "deny") => {
    if (!canDecide || busy) return;
    setBusy(decision);
    try {
      await onDecide(request.requestId, decision, reason.trim() || undefined);
    } catch {
      // WorkspaceStore keeps the typed request in its canonical error state.
    } finally {
      setBusy(null);
    }
  };

  // Codex spec 05 §1.2:Enter = approve / Esc = decline。守卫规则在
  // approval-keys.ts;多张待决卡同时可见时,只有时间线里最上方(最早)
  // 那张可决卡响应键盘,其余保持按钮操作。
  const decideRef = useRef(decide);
  decideRef.current = decide;
  useEffect(() => {
    if (!canDecide) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = approvalKeyAction(event, event.target as HTMLElement | null);
      if (!action) return;
      const card = cardRef.current;
      if (!card) return;
      const firstDecidable = document.querySelector(".conversation-permission[data-decidable='true']");
      if (firstDecidable !== card) return;
      event.preventDefault();
      void decideRef.current(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canDecide, request.requestId]);

  const statusCopy = status === "approved"
    ? "已批准"
    : status === "denied"
      ? "已拒绝"
      : status === "expired"
        ? "已过期"
        : status === "error"
          ? "处理失败，可重试"
          : disabled
            ? "当前运行已不可处理"
            : "等待你的决定";
  return (
    <article
      ref={cardRef}
      className="conversation-permission"
      data-status={status}
      data-decidable={canDecide ? "true" : undefined}
      aria-labelledby={`permission-${request.requestId}`}
    >
      <header>
        <span className="conversation-permission__icon" aria-hidden="true"><ShieldAlert /></span>
        <div>
          <p className="conversation-permission__eyebrow">{isResourceTrust ? "Pi 资源信任" : "Agent 权限请求"} · {permissionRiskLabels[request.riskClass]}</p>
          <h3 id={`permission-${request.requestId}`}>{request.toolName}</h3>
        </div>
        <StatusLabel state={status === "approved" ? "complete" : status === "error" ? "failed" : status === "pending" && !disabled ? "waiting" : "stopped"}>
          {statusCopy}
        </StatusLabel>
      </header>
      <p>{isResourceTrust ? "在 Run 开始前审查并固定 Pi 资源；摘要变化会再次请求确认。" : permissionDomainLabels[request.domain]}</p>
      {request.argsSummary ? (
        <div className="conversation-permission__preview" data-expanded={previewExpanded || undefined}>
          <pre ref={previewRef}><code>{request.argsSummary}</code></pre>
          {previewCollapsible || previewExpanded ? (
            <div className="conversation-permission__preview-actions">
              <Button
                variant="ghost"
                className="conversation-permission__preview-toggle"
                aria-expanded={previewExpanded}
                onClick={() => setPreviewExpanded((expanded) => !expanded)}
              >
                {previewExpanded ? "收起" : "展开"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {request.error ? <p className="conversation-permission__error" role="alert">{request.error}</p> : null}
      {canDecide ? (
        <>
          <label className="decision-question__text-label">
            <span>说明（可选）</span>
            <textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="记录批准或拒绝的原因…" />
          </label>
          <footer>
            <Button variant="secondary" loading={busy === "deny"} disabled={busy !== null} onClick={() => void decide("deny")}>拒绝</Button>
            <Button variant="primary" loading={busy === "approve"} disabled={busy !== null} onClick={() => void decide("approve")}>{isResourceTrust ? "信任此摘要" : "批准一次"}</Button>
          </footer>
        </>
      ) : null}
    </article>
  );
}

export const ConversationRow = memo(function ConversationRow({
  item,
  store,
  focusedThreadId = "",
  forceOpenProcess = false,
  onFocusThread,
  onInspectArtifact,
  onInspectActivity,
}: {
  item: ConversationItem;
  store: WorkspaceStore;
  focusedThreadId?: string;
  forceOpenProcess?: boolean;
  onFocusThread?: (threadId: string) => void;
  onInspectArtifact?: (artifact: TaskArtifact) => void;
  onInspectActivity?: (activity: TaskActivity) => void;
}) {
  switch (item.kind) {
    case "activity":
      return <ActivityItem activity={item.activity} thread={item.thread} onInspect={onInspectActivity} />;
    case "process": {
      const run = store.getState().task?.runs.find((candidate) => candidate.id === item.activities[0]?.runId);
      const runActive = run?.status === "active" || run?.status === "pending";
      return <ProcessGroup activities={item.activities} thread={item.thread} runActive={runActive} forceOpen={forceOpenProcess} onInspect={onInspectActivity} />;
    }
    case "artifact": {
      const activities = store.getState().task?.activities ?? [];
      return (
        <ArtifactItem
          artifact={item.artifact}
          thread={item.thread}
          duplicateOfReply={artifactSummaryDuplicatesReply(item.artifact, activities)}
          onInspect={onInspectArtifact}
        />
      );
    }
    case "decision":
      if (item.interactionId) return (
        <DecisionInteraction
          interactionId={item.interactionId}
          decisions={item.decisions}
          requester={item.thread}
          onCommit={(interactionId, input) => store.commitDecisionInteraction(interactionId, input)}
        />
      );
      return item.decisions.map((decision) => {
        const snapshot = store.getState().task;
        const run = snapshot?.runs.find((candidate) => candidate.id === decision.runId);
        const participantCount = snapshot?.agentThreads.filter((thread) => (
          thread.runId === decision.runId && (thread.identity.kind === "specialist" || thread.identity.kind === "deterministic")
        )).length ?? 0;
        return (
          <CanonicalDecision
            key={decision.id}
            decision={decision}
            run={run}
            participantCount={participantCount}
            requester={item.thread}
            onCommit={(decisionId, input) => store.commitTaskDecision(decisionId, input)}
            onRunTeam={(workflowId, options) => store.runTeamWorkflow(workflowId, "start", options)}
          />
        );
      });
    case "specialist": {
      const snapshot = store.getState().task;
      const latestTitle = snapshot ? latestActivityTitles(snapshot).get(item.thread.id) : undefined;
      return (
        <SpecialistItem
          thread={item.thread}
          latestActivityTitle={latestTitle}
          focused={focusedThreadId === item.thread.id}
          onFocusThread={onFocusThread}
        />
      );
    }
    case "run": {
      const snapshot = store.getState().task;
      const cast: CastMember[] = item.phase === "started" && item.run.mode === "team" && snapshot
        ? (() => {
            const titles = latestActivityTitles(snapshot);
            return runCastThreads(snapshot, item.run.id).map((thread) => ({
              thread,
              latestActivityTitle: titles.get(thread.id),
            }));
          })()
        : [];
      return (
        <RunBoundary
          run={item.run}
          phase={item.phase}
          thread={item.thread}
          cast={cast}
          onResumeTeam={(workflowId) => store.runTeamWorkflow(workflowId, "resume")}
        />
      );
    }
  }
});
