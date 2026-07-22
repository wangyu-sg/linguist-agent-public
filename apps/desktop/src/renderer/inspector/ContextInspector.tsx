import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import {
  Activity,
  CircleHelp,
  FileText,
  Languages,
  Maximize2,
  MessageSquareReply,
  Minimize2,
  X,
} from "lucide-react";
import type {
  TaskActivity,
  TaskAgentThread,
  TaskArtifact,
  TaskDecision,
  TaskDecisionAction,
  TaskScope,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { SegmentEvidenceSnapshot } from "../data/workspace-client.ts";
import {
  workspaceStore,
  type SegmentEvidenceState,
  type WorkspaceStore,
} from "../data/workspace-store.ts";
import { Button, IconButton, StatusLabel, type StatusState } from "../ui/index.ts";
import { PersonaAvatar } from "../conversation/PersonaAvatar.tsx";
import { personaStatusForRunStatus, resolvePersona } from "../conversation/personas.ts";
import {
  activityDetailBody,
  artifactEvidence,
  followUpTargetForSelection,
  inspectorFieldLabel,
  segmentLinkedItems,
  type InspectorFollowUpTarget,
  type InspectorLinkedSelection,
  type InspectorSelection,
} from "./inspector-model.ts";
import {
  segmentEvidenceGroups,
  segmentEvidenceSummaryRows,
  type SegmentEvidenceGroup,
} from "./segment-evidence-model.ts";
import { RichArtifactPreview } from "./RichArtifactPreview.tsx";
import "./inspector.css";

export interface ContextInspectorProps {
  selection: InspectorSelection | null;
  store?: WorkspaceStore;
  threads?: readonly TaskAgentThread[];
  onClose: () => void;
  onAskSpecialist?: (target: InspectorFollowUpTarget) => void;
  onSelectLinkedItem?: (selection: InspectorLinkedSelection) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  className?: string;
}

const actionLabels: Record<TaskDecisionAction, string> = {
  answer: "回答问题",
  approve: "批准产物",
  reject: "拒绝产物",
  request_change: "请求修改",
  waive: "接受风险",
  apply: "通过 CAT 应用",
  authorize_delivery: "授权交付",
};

const artifactTypeLabels: Record<TaskArtifact["type"], string> = {
  segment_proposal: "句段建议",
  segment_diff: "句段变更",
  evidence_pack: "证据包",
  agent_query: "Agent 问题",
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

const activityTypeLabels: Record<TaskActivity["type"], string> = {
  message: "消息",
  acknowledgement: "任务确认",
  plan: "计划",
  progress: "进展",
  evidence_read: "证据读取",
  tool_action: "工具操作",
  artifact_update: "产物更新",
  handoff: "专家交接",
  elicitation: "等待决定",
  decision: "决定",
  usage: "用量",
  error: "错误",
  final_response: "回复",
};

const decisionKindLabels: Record<TaskDecision["kind"], string> = {
  answer: "回答",
  approval: "审批",
  proposal_review: "建议审阅",
  waiver: "风险决定",
  apply: "应用决定",
  delivery_authorization: "交付授权",
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : dateFormatter.format(date);
}

function selectionTitle(selection: InspectorSelection): { title: string; type: string; icon: ReactNode } {
  if (selection.kind === "artifact") {
    return { title: selection.artifact.title, type: artifactTypeLabels[selection.artifact.type], icon: <FileText /> };
  }
  if (selection.kind === "activity") {
    return { title: selection.activity.title, type: activityTypeLabels[selection.activity.type], icon: <Activity /> };
  }
  if (selection.kind === "decision") {
    return { title: selection.decision.prompt, type: decisionKindLabels[selection.decision.kind], icon: <CircleHelp /> };
  }
  return {
    title: `句段 ${String(selection.segment.index).padStart(3, "0")}`,
    type: "CAT 上下文",
    icon: <Languages />,
  };
}

function statusState(status: string): StatusState {
  if (["accepted", "final", "recorded", "done", "confirmed"].includes(status)) return "complete";
  if (["required", "pending", "running", "draft"].includes(status)) return "waiting";
  if (["rejected", "error", "cancelled"].includes(status)) return "failed";
  return "neutral";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    new: "新建",
    draft: "草稿",
    pending: "准备中",
    running: "运行中",
    done: "已完成",
    blocked: "已阻塞",
    stale: "已过期",
    error: "失败",
    reviewable: "可审阅",
    accepted: "已接受",
    rejected: "已拒绝",
    superseded: "已替代",
    final: "最终版",
    required: "等待决定",
    recorded: "已记录",
    cancelled: "已取消",
    confirmed: "已确认",
  };
  return labels[status] ?? status;
}

function ScopeSection({ scope, id }: { scope: TaskScope; id: string }) {
  const rows = (scope.kind === "project" ? [
    ["Batch", scope.batchId],
    ["语言", scope.sourceLocale && scope.targetLocale ? `${scope.sourceLocale} → ${scope.targetLocale}` : scope.sourceLocale ?? scope.targetLocale],
    ["句段", scope.segmentIds.length ? scope.segmentIds.join("、") : null],
  ] : [
    ["范围", "无项目 Chat"],
    ["工作目录授权", scope.workingDirectoryGrantId],
    ["文件授权", scope.fileGrantIds.length ? `${scope.fileGrantIds.length} 项` : null],
  ]).filter((row): row is [string, string] => Boolean(row[1]));
  if (!rows.length) return null;
  return (
    <InspectorSection id={id} title="范围">
      <dl className="context-inspector__facts">
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd><code>{value}</code></dd></div>
        ))}
      </dl>
    </InspectorSection>
  );
}

function InspectorSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="context-inspector__section" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

function ValueView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined || value === "") return <span className="context-inspector__empty-value">—</span>;
  if (typeof value === "string") return <p className="context-inspector__text-value">{value}</p>;
  if (typeof value === "number" || typeof value === "boolean") return <code>{String(value)}</code>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="context-inspector__empty-value">无</span>;
    return (
      <ul className="context-inspector__value-list">
        {value.map((entry, index) => <li key={index}><ValueView value={entry} depth={depth + 1} /></li>)}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return <span className="context-inspector__empty-value">无</span>;
    return (
      <dl className="context-inspector__value-object" data-depth={depth}>
        {entries.map(([key, entry]) => (
          <div key={key}>
            <dt>{inspectorFieldLabel(key)}</dt>
            <dd><ValueView value={entry} depth={depth + 1} /></dd>
          </div>
        ))}
      </dl>
    );
  }
  return <code>{String(value)}</code>;
}

function ThreadName({ threadId, threads }: { threadId: string; threads: readonly TaskAgentThread[] }) {
  const thread = threads.find((candidate) => candidate.id === threadId);
  if (!thread) return <code>{threadId}</code>;
  const persona = resolvePersona(thread.identity);
  return (
    <span className="context-inspector__persona">
      <PersonaAvatar persona={persona} size="sm" status={personaStatusForRunStatus(thread.status)} />
      <span>{thread.identity.displayName}<small>{thread.identity.roleLabel}</small></span>
    </span>
  );
}

function ArtifactInspector({ artifact, threads, prefix }: {
  artifact: TaskArtifact;
  threads: readonly TaskAgentThread[];
  prefix: string;
}) {
  const evidence = artifactEvidence(artifact);
  const document = artifact.content.document;
  const content = Object.fromEntries(Object.entries(artifact.content).filter(([key]) => !["constraints", "document", "evidence", "evidenceRefs"].includes(key)));
  const constraints = artifact.content.constraints;
  return (
    <>
      {document !== undefined ? (
        <InspectorSection id={`${prefix}-preview`} title="预览与导出"><RichArtifactPreview value={document} /></InspectorSection>
      ) : null}
      {Object.keys(content).length ? (
        <InspectorSection id={`${prefix}-content`} title="内容"><ValueView value={content} /></InspectorSection>
      ) : null}
      {constraints !== undefined ? (
        <InspectorSection id={`${prefix}-constraints`} title="约束"><ValueView value={constraints} /></InspectorSection>
      ) : null}
      {(evidence.refs.length || evidence.content !== undefined) ? (
        <InspectorSection id={`${prefix}-evidence`} title="证据">
          {evidence.refs.length ? (
            <ul className="context-inspector__reference-list">
              {evidence.refs.map((reference) => <li key={reference}><code>{reference}</code></li>)}
            </ul>
          ) : null}
          {evidence.content !== undefined ? <ValueView value={evidence.content} /> : null}
        </InspectorSection>
      ) : null}
      <ScopeSection scope={artifact.scope} id={`${prefix}-scope`} />
      <InspectorSection id={`${prefix}-provenance`} title="来源">
        <dl className="context-inspector__facts">
          <div><dt>创建者</dt><dd><ThreadName threadId={artifact.provenance.agentThreadId} threads={threads} /></dd></div>
          {artifact.provenance.activityId ? <div><dt>Activity</dt><dd><code>{artifact.provenance.activityId}</code></dd></div> : null}
          {artifact.provenance.parentArtifactIds.length ? (
            <div><dt>上游产物</dt><dd>{artifact.provenance.parentArtifactIds.map((id) => <code key={id}>{id}</code>)}</dd></div>
          ) : null}
          <div><dt>版本</dt><dd><code>v{artifact.version}</code></dd></div>
        </dl>
      </InspectorSection>
      {artifact.availableDecisions.length ? (
        <InspectorSection id={`${prefix}-actions`} title="可用决定">
          <ul className="context-inspector__plain-list">
            {artifact.availableDecisions.map((action) => <li key={action}>{actionLabels[action]}</li>)}
          </ul>
          <p className="context-inspector__hint">决定需要在对话中的原始请求处完成。</p>
        </InspectorSection>
      ) : null}
    </>
  );
}

function ActivityInspector({ activity, threads, prefix }: {
  activity: TaskActivity;
  threads: readonly TaskAgentThread[];
  prefix: string;
}) {
  const detail = activityDetailBody(activity);
  const segmentIds = activity.refs.segmentIds ?? [];
  return (
    <>
      {detail ? <InspectorSection id={`${prefix}-detail`} title="详情"><p className="context-inspector__body-copy">{detail}</p></InspectorSection> : null}
      {activity.tool ? (
        <InspectorSection id={`${prefix}-tool`} title="工具">
          <dl className="context-inspector__facts">
            <div><dt>名称</dt><dd><code>{activity.tool.name}</code></dd></div>
            <div><dt>影响</dt><dd>{activity.tool.effect === "read" ? "读取" : activity.tool.effect === "write" ? "写入" : "执行"}</dd></div>
            {activity.tool.target ? <div><dt>对象</dt><dd><code>{activity.tool.target}</code></dd></div> : null}
            {activity.tool.outcome ? <div><dt>结果</dt><dd>{activity.tool.outcome}</dd></div> : null}
          </dl>
        </InspectorSection>
      ) : null}
      {activity.refs.evidenceRefs.length ? (
        <InspectorSection id={`${prefix}-evidence`} title="证据">
          <ul className="context-inspector__reference-list">
            {activity.refs.evidenceRefs.map((reference) => <li key={reference}><code>{reference}</code></li>)}
          </ul>
        </InspectorSection>
      ) : null}
      {(activity.refs.artifactIds.length || activity.refs.decisionIds.length) ? (
        <InspectorSection id={`${prefix}-linked`} title="关联对象">
          <dl className="context-inspector__facts">
            {activity.refs.artifactIds.length ? <div><dt>产物</dt><dd>{activity.refs.artifactIds.map((id) => <code key={id}>{id}</code>)}</dd></div> : null}
            {activity.refs.decisionIds.length ? <div><dt>决定</dt><dd>{activity.refs.decisionIds.map((id) => <code key={id}>{id}</code>)}</dd></div> : null}
          </dl>
        </InspectorSection>
      ) : null}
      {segmentIds.length ? (
        <InspectorSection id={`${prefix}-scope`} title="范围"><p>{segmentIds.join("、")}</p></InspectorSection>
      ) : null}
      <InspectorSection id={`${prefix}-provenance`} title="来源">
        <dl className="context-inspector__facts">
          <div><dt>执行者</dt><dd><ThreadName threadId={activity.agentThreadId} threads={threads} /></dd></div>
          <div><dt>Run</dt><dd><code>{activity.runId}</code></dd></div>
          <div><dt>序号</dt><dd><code>{activity.seq}</code></dd></div>
        </dl>
      </InspectorSection>
    </>
  );
}

function DecisionInspector({ decision, threads, prefix }: {
  decision: TaskDecision;
  threads: readonly TaskAgentThread[];
  prefix: string;
}) {
  const selectedIds = decision.selectedOptionIds?.length
    ? decision.selectedOptionIds
    : decision.selectedOptionId ? [decision.selectedOptionId] : [];
  const selectedLabels = selectedIds.map((id) => decision.options.find((option) => option.id === id)?.label ?? id);
  return (
    <>
      <InspectorSection id={`${prefix}-answer`} title="记录">
        {selectedLabels.length || decision.responseText || decision.reason ? (
          <dl className="context-inspector__facts">
            {selectedLabels.length ? <div><dt>选择</dt><dd>{selectedLabels.join("、")}</dd></div> : null}
            {decision.responseText ? <div><dt>补充说明</dt><dd>{decision.responseText}</dd></div> : null}
            {decision.reason ? <div><dt>原因</dt><dd>{decision.reason}</dd></div> : null}
            {decision.decidedAt ? <div><dt>记录时间</dt><dd><time dateTime={decision.decidedAt}>{timeLabel(decision.decidedAt)}</time></dd></div> : null}
          </dl>
        ) : <p className="context-inspector__hint">等待你在对话中的原始请求处回答。</p>}
      </InspectorSection>
      <InspectorSection id={`${prefix}-options`} title="可用决定">
        <ul className="context-inspector__option-list">
          {decision.options.map((option) => (
            <li key={option.id} data-selected={selectedIds.includes(option.id) || undefined}>
              <strong>{option.label}</strong>
              {option.description ? <span>{option.description}</span> : null}
              {option.preview ? <blockquote>{option.preview}</blockquote> : null}
            </li>
          ))}
        </ul>
        <p className="context-inspector__hint">这里仅显示记录，不提供重复回答控件。</p>
      </InspectorSection>
      <ScopeSection scope={decision.scope} id={`${prefix}-scope`} />
      <InspectorSection id={`${prefix}-provenance`} title="来源">
        <dl className="context-inspector__facts">
          <div><dt>请求者</dt><dd><ThreadName threadId={decision.requestedByThreadId} threads={threads} /></dd></div>
          {decision.requestProvenance ? (
            <>
              <div><dt>Package</dt><dd><code>{decision.requestProvenance.packageName}@{decision.requestProvenance.packageVersion}</code></dd></div>
              <div><dt>来源</dt><dd><code>{decision.requestProvenance.packageSource}</code></dd></div>
              <div><dt>资源</dt><dd><code>{decision.requestProvenance.resourceId}</code></dd></div>
              <div><dt>摘要</dt><dd><code>{decision.requestProvenance.integrity}</code></dd></div>
              <div><dt>传输</dt><dd><code>{decision.requestProvenance.transport}</code></dd></div>
            </>
          ) : null}
          {decision.artifactId ? <div><dt>关联产物</dt><dd><code>{decision.artifactId}</code></dd></div> : null}
          {decision.interactionId ? <div><dt>交互</dt><dd><code>{decision.interactionId}</code></dd></div> : null}
        </dl>
      </InspectorSection>
    </>
  );
}

type TmEvidenceMatch = SegmentEvidenceSnapshot["tmMatches"][number];
type TermbaseEvidenceMatch = SegmentEvidenceSnapshot["termbaseMatches"][number];
type GlossaryEvidenceMatch = SegmentEvidenceSnapshot["glossaryMatches"][number];

const evidenceMatchLabels = {
  exact: "精确",
  contains: "包含",
  fuzzy: "模糊",
} as const;

function scoreLabel(score: number): string {
  return `${Number((score * 100).toFixed(1))}%`;
}

function EvidenceEntryHeader({ index, id }: { index: number; id: string }) {
  return (
    <h5>
      <span aria-hidden="true">{index + 1}.</span>
      <code>{id}</code>
    </h5>
  );
}

function TmEvidenceList({ matches }: { matches: readonly TmEvidenceMatch[] }) {
  if (!matches.length) return <p className="context-inspector__hint">无 TM 匹配。</p>;
  return (
    <ol className="context-inspector__evidence-list" aria-label={`TM 匹配，共 ${matches.length} 条`}>
      {matches.map((match, index) => (
        <li key={`${match.id}:${index}`}>
          <EvidenceEntryHeader index={index} id={match.id} />
          <dl className="context-inspector__evidence-fields">
            <div><dt>匹配源文</dt><dd>{match.source}</dd></div>
            <div><dt>匹配译文</dt><dd>{match.target}</dd></div>
            <div><dt>匹配</dt><dd>{evidenceMatchLabels[match.matchType]} <code>{match.matchType}</code></dd></div>
            <div><dt>Score</dt><dd>{scoreLabel(match.score)}</dd></div>
            <div><dt>Authority</dt><dd><code>{match.effectiveAuthority ?? "未提供"}</code></dd></div>
            <div><dt>来源</dt><dd><code>{[match.sourceKind, match.origin].filter(Boolean).join(" · ")}</code></dd></div>
            <div><dt>语言</dt><dd><code>{match.srcLang} → {match.tgtLang}</code></dd></div>
            {typeof match.quality === "number" ? <div><dt>质量</dt><dd>{match.quality}</dd></div> : null}
            {match.project ? <div><dt>Project</dt><dd><code>{match.project}</code></dd></div> : null}
            {match.sourceBatchId ? <div><dt>来源 Batch</dt><dd><code>{match.sourceBatchId}</code></dd></div> : null}
            {match.sourceSegmentId ? <div><dt>来源句段</dt><dd><code>{match.sourceSegmentId}</code></dd></div> : null}
            {match.note ? <div><dt>备注</dt><dd>{match.note}</dd></div> : null}
            {match.createdAt ? <div><dt>创建时间</dt><dd><time dateTime={match.createdAt}>{timeLabel(match.createdAt)}</time></dd></div> : null}
            {match.updatedAt ? <div><dt>更新时间</dt><dd><time dateTime={match.updatedAt}>{timeLabel(match.updatedAt)}</time></dd></div> : null}
          </dl>
        </li>
      ))}
    </ol>
  );
}

function TermbaseEvidenceList({ matches }: { matches: readonly TermbaseEvidenceMatch[] }) {
  if (!matches.length) return <p className="context-inspector__hint">无 Termbase 匹配。</p>;
  return (
    <ol className="context-inspector__evidence-list" aria-label={`Termbase 匹配，共 ${matches.length} 条`}>
      {matches.map((match, index) => (
        <li key={`${match.id}:${index}`}>
          <EvidenceEntryHeader index={index} id={match.id} />
          <dl className="context-inspector__evidence-fields">
            <div><dt>术语</dt><dd>{match.source}</dd></div>
            <div><dt>译法</dt><dd>{match.target}</dd></div>
            <div><dt>匹配</dt><dd>{evidenceMatchLabels[match.matchType]} <code>{match.matchType}</code></dd></div>
            <div><dt>Score</dt><dd className="context-inspector__empty-value">未提供</dd></div>
            <div><dt>Authority</dt><dd><code>{match.resolution ?? "未提供"}</code></dd></div>
            <div><dt>来源</dt><dd><code>{match.sourceFile}:{match.rowNo} · {match.origin}</code></dd></div>
            <div><dt>语言</dt><dd><code>{match.srcLang} → {match.tgtLang}</code></dd></div>
            {match.sheetName ? <div><dt>工作表</dt><dd>{match.sheetName}</dd></div> : null}
            {typeof match.conceptId === "number" ? <div><dt>Concept</dt><dd><code>{match.conceptId}</code></dd></div> : null}
            {match.note ? <div><dt>备注</dt><dd>{match.note}</dd></div> : null}
            {match.conflictTargets?.length ? <div><dt>冲突译法</dt><dd><ValueView value={match.conflictTargets} /></dd></div> : null}
            {match.overriddenBy ? <div><dt>覆盖译法</dt><dd>{match.overriddenBy}</dd></div> : null}
            {match.fields && Object.keys(match.fields).length ? <div><dt>字段</dt><dd><ValueView value={match.fields} /></dd></div> : null}
          </dl>
        </li>
      ))}
    </ol>
  );
}

function GlossaryEvidenceList({ matches }: { matches: readonly GlossaryEvidenceMatch[] }) {
  if (!matches.length) return <p className="context-inspector__hint">无 Glossary 匹配。</p>;
  return (
    <ol className="context-inspector__evidence-list" aria-label={`Glossary 匹配，共 ${matches.length} 条`}>
      {matches.map((match, index) => (
        <li key={`${match.id}:${index}`}>
          <EvidenceEntryHeader index={index} id={match.id} />
          <dl className="context-inspector__evidence-fields">
            <div><dt>词条</dt><dd>{match.source}</dd></div>
            <div><dt>译法</dt><dd>{match.target}</dd></div>
            <div><dt>匹配</dt><dd>{evidenceMatchLabels[match.matchType]} <code>{match.matchType}</code></dd></div>
            <div><dt>Score</dt><dd className="context-inspector__empty-value">未提供</dd></div>
            <div><dt>Authority</dt><dd className="context-inspector__empty-value">未提供</dd></div>
            <div><dt>来源</dt><dd><code>{match.sourceFile}:{match.rowNo}</code></dd></div>
            {match.note ? <div><dt>备注</dt><dd>{match.note}</dd></div> : null}
          </dl>
        </li>
      ))}
    </ol>
  );
}

function EvidenceGroupSection({ group, prefix }: { group: SegmentEvidenceGroup; prefix: string }) {
  const headingId = `${prefix}-evidence-${group.kind}`;
  return (
    <section className="context-inspector__evidence-group" aria-labelledby={headingId}>
      <h4 id={headingId}>{group.label} <span>{group.matches.length}</span></h4>
      {group.kind === "tm" ? <TmEvidenceList matches={group.matches} /> : null}
      {group.kind === "termbase" ? <TermbaseEvidenceList matches={group.matches} /> : null}
      {group.kind === "glossary" ? <GlossaryEvidenceList matches={group.matches} /> : null}
    </section>
  );
}

function SegmentEvidenceInspector({ evidence, segmentId, prefix, onRetry }: {
  evidence: SegmentEvidenceState;
  segmentId: string;
  prefix: string;
  onRetry: () => void;
}) {
  const current = evidence.scope?.segmentId === segmentId ? evidence : null;
  let body: ReactNode;
  if (!current || current.status === "idle") {
    body = <p className="context-inspector__evidence-state" role="status">正在准备当前句段证据…</p>;
  } else if (current.status === "loading") {
    body = <p className="context-inspector__evidence-state" role="status" aria-live="polite">正在读取 TM、Termbase 与 Glossary…</p>;
  } else if (current.status === "error") {
    body = (
      <div className="context-inspector__evidence-error" role="alert">
        <p>{current.error}</p>
        <Button variant="secondary" onClick={onRetry}>重试读取</Button>
      </div>
    );
  } else {
    const groups = segmentEvidenceGroups(current.snapshot);
    const empty = groups.every((group) => group.matches.length === 0);
    body = (
      <>
        <dl className="context-inspector__evidence-summary" aria-label="证据计数">
          {segmentEvidenceSummaryRows(current.snapshot).map((row) => (
            <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
          ))}
        </dl>
        {empty ? <p className="context-inspector__evidence-state" role="status">当前句段没有 TM、Termbase 或 Glossary 匹配。</p> : (
          groups.map((group) => <EvidenceGroupSection key={group.kind} group={group} prefix={prefix} />)
        )}
      </>
    );
  }
  return <InspectorSection id={`${prefix}-evidence`} title="结构化证据">{body}</InspectorSection>;
}

function linkedItemLabel(selection: InspectorLinkedSelection): { kind: string; title: string; status: string } {
  if (selection.kind === "artifact") return { kind: artifactTypeLabels[selection.artifact.type], title: selection.artifact.title, status: selection.artifact.status };
  if (selection.kind === "activity") return { kind: activityTypeLabels[selection.activity.type], title: selection.activity.title, status: selection.activity.status };
  return { kind: decisionKindLabels[selection.decision.kind], title: selection.decision.prompt, status: selection.decision.status };
}

function SegmentInspector({ selection, evidence, onRetryEvidence, onSelectLinkedItem, prefix }: {
  selection: Extract<InspectorSelection, { kind: "segment" }>;
  evidence: SegmentEvidenceState;
  onRetryEvidence: () => void;
  onSelectLinkedItem?: (selection: InspectorLinkedSelection) => void;
  prefix: string;
}) {
  const { segment, tagView } = selection;
  const linked = segmentLinkedItems(segment.id, selection.taskItems);
  const issueRows = [
    segment.locked ? "该句段已锁定，不能写入" : null,
    ...(tagView?.validation.missing.map((tag) => `缺少标签 ${tag.literal}`) ?? []),
    ...(tagView?.validation.extra.map((tag) => `多余标签 ${tag.literal}`) ?? []),
    ...(segment.unresolvedPlaceholders ?? []).map((value) => `未解析占位符 ${value}`),
    ...(segment.unresolvedRuntimePlaceholders ?? []).map((value) => `未解析运行时占位符 ${value}`),
    ...(segment.unresolvedTagPlaceholders ?? []).map((value) => `未解析标签 ${value}`),
  ].filter((row): row is string => Boolean(row));
  return (
    <>
      <SegmentEvidenceInspector evidence={evidence} segmentId={segment.id} prefix={prefix} onRetry={onRetryEvidence} />
      {segment.contextNote ? (
        <InspectorSection id={`${prefix}-context`} title="上下文"><p className="context-inspector__body-copy">{segment.contextNote}</p></InspectorSection>
      ) : null}
      {issueRows.length ? (
        <InspectorSection id={`${prefix}-constraints`} title="约束与检查">
          <ul className="context-inspector__plain-list">{issueRows.map((row) => <li key={row}>{row}</li>)}</ul>
        </InspectorSection>
      ) : null}
      {tagView ? (
        <InspectorSection id={`${prefix}-tags`} title="标签">
          <dl className="context-inspector__facts">
            <div><dt>源文</dt><dd>{tagView.validation.sourceTags.length}</dd></div>
            <div><dt>译文</dt><dd>{tagView.validation.targetTags.length}</dd></div>
            <div><dt>写入门</dt><dd>{tagView.validation.blocked ? "已阻止" : "通过"}</dd></div>
          </dl>
        </InspectorSection>
      ) : null}
      {linked.length ? (
        <InspectorSection id={`${prefix}-linked`} title="相关 Task 项目">
          <ul className="context-inspector__linked-list">
            {linked.map((item) => {
              const label = linkedItemLabel(item);
              const id = item.kind === "artifact" ? item.artifact.id : item.kind === "activity" ? item.activity.id : item.decision.id;
              const content = (
                <>
                  <span>{label.kind}</span>
                  <strong>{label.title}</strong>
                  <StatusLabel state={statusState(label.status)}>{statusLabel(label.status)}</StatusLabel>
                </>
              );
              return <li key={`${item.kind}:${id}`}>{onSelectLinkedItem ? <button type="button" onClick={() => onSelectLinkedItem(item)}>{content}</button> : <div>{content}</div>}</li>;
            })}
          </ul>
        </InspectorSection>
      ) : null}
    </>
  );
}

export function ContextInspector({
  selection,
  store = workspaceStore,
  threads = [],
  onClose,
  onAskSpecialist,
  onSelectLinkedItem,
  expanded = false,
  onToggleExpanded,
  className,
}: ContextInspectorProps) {
  const headingId = useId();
  const prefix = useId().replaceAll(":", "");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceState = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
  }, []);
  if (!selection) return null;
  const heading = selectionTitle(selection);
  const followUp = followUpTargetForSelection(selection, threads);
  const classNames = ["context-inspector", className].filter(Boolean).join(" ");
  const status = selection.kind === "artifact" ? selection.artifact.status
    : selection.kind === "activity" ? selection.activity.status
      : selection.kind === "decision" ? selection.decision.status
        : selection.segment.status;
  const updatedAt = selection.kind === "artifact" ? selection.artifact.updatedAt
    : selection.kind === "activity" ? selection.activity.updatedAt
      : selection.kind === "decision" ? selection.decision.decidedAt ?? selection.decision.createdAt
        : selection.segment.updatedAt;

  return (
    <aside
      className={classNames}
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.target instanceof HTMLElement && event.currentTarget.contains(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="context-inspector__header">
        <span className="context-inspector__header-icon" aria-hidden="true">{heading.icon}</span>
        <div>
          <span>{heading.type}</span>
          <h2 id={headingId}>{heading.title}</h2>
          <div className="context-inspector__meta">
            <StatusLabel state={statusState(status)}>{statusLabel(status)}</StatusLabel>
            {updatedAt ? <time dateTime={updatedAt}>{timeLabel(updatedAt)}</time> : null}
          </div>
        </div>
        <div className="context-inspector__header-actions">
          {onToggleExpanded ? (
            <IconButton
              aria-label={expanded ? "恢复上下文检查器宽度" : "展开上下文检查器"}
              title={expanded ? "恢复面板宽度" : "展开面板"}
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </IconButton>
          ) : null}
          <IconButton ref={closeButtonRef} aria-label="关闭上下文检查器" title="关闭上下文检查器" onClick={onClose}><X /></IconButton>
        </div>
      </header>
      <div className="context-inspector__scroll">
        {selection.kind === "artifact" ? <ArtifactInspector artifact={selection.artifact} threads={threads} prefix={prefix} /> : null}
        {selection.kind === "activity" ? <ActivityInspector activity={selection.activity} threads={threads} prefix={prefix} /> : null}
        {selection.kind === "decision" ? <DecisionInspector decision={selection.decision} threads={threads} prefix={prefix} /> : null}
        {selection.kind === "segment" ? (
          <SegmentInspector
            selection={selection}
            evidence={workspaceState.segmentEvidence}
            onRetryEvidence={() => {
              if (workspaceState.projectId && workspaceState.batchId) {
                void store.loadSegmentEvidence(workspaceState.projectId, workspaceState.batchId, selection.segment.id);
              }
            }}
            onSelectLinkedItem={onSelectLinkedItem}
            prefix={prefix}
          />
        ) : null}
      </div>
      {followUp && onAskSpecialist ? (
        <footer className="context-inspector__footer">
          <Button variant="secondary" onClick={() => onAskSpecialist(followUp)}>
            <MessageSquareReply aria-hidden="true" />
            询问 {followUp.displayName}
          </Button>
          <span>仅下一条消息定向给该专家</span>
        </footer>
      ) : null}
    </aside>
  );
}
