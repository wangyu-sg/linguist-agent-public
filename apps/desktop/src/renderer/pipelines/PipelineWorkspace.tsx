import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, History } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  TaskArtifact,
  TaskRun,
  TaskWorkspaceSnapshot,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import {
  workspaceClient,
  type BatchFormat,
  type DeliveryQaFindingDTO,
  type EvalDimensionDTO,
  type HumanScoreRowDTO,
  type PrivateEvalBlindJudgmentInputDTO,
  type PrivateEvalBlindPairDTO,
  type PrivateEvalBlindReviewDTO,
  type PrivateEvalBlindReviewSummaryDTO,
  type PrivateEvalIssueTierDTO,
  type PrivateEvalRunDTO,
  type PrivateEvalRunOutputDTO,
  type PrivateEvalSetDTO,
  type QualityFindingDTO,
} from "../data/workspace-client.ts";
import { Button, PaneHeader, StatusLabel, useDismissibleDetails, type StatusState } from "../ui";
import {
  executeCanonicalPipelineAction,
  type CanonicalPipelineAction,
  type CanonicalPipelineClient,
  type DeliveryExportFormat,
  type DeliveryQaReviewChoice,
  type PipelineScope,
} from "./pipeline-actions.ts";
import {
  deliveryAuthority,
  exportFormatForBatch,
  readDeliveryExport,
  readDeliveryQaReport,
  readDeliveryReadiness,
  readEvalComparison,
  readEvalScorecard,
  readQualityReport,
} from "./pipeline-content.ts";
import {
  buildPipelineSnapshotView,
  type OwnedPipelineArtifact,
  type PipelineRunView,
} from "./pipeline-model.ts";
import {
  buildBlindReviewInput,
  completedEvalRuns,
  EVAL_DIMENSIONS,
  parseIssueCategories,
} from "./eval-write-model.ts";
import "./pipelines.css";

export type PipelineMode = "review" | "qa" | "delivery" | "eval";

type EvalClient = Pick<typeof workspaceClient,
  | "listPrivateEvalSets"
  | "listPrivateEvalRuns"
  | "fetchPrivateEvalRunOutputs"
  | "launchPrivateEval"
  | "stopPrivateEval"
  | "listPrivateEvalBlindReviews"
  | "createPrivateEvalBlindReview"
  | "fetchPrivateEvalBlindReview"
  | "submitPrivateEvalBlindJudgments"
  | "fetchPrivateEvalScorecard"
  | "writePrivateEvalScorecard"
>;

export interface PipelineWorkspaceProps {
  snapshot: TaskWorkspaceSnapshot;
  batchFormat?: BatchFormat;
  selectedArtifactId?: string | null;
  client?: CanonicalPipelineClient & EvalClient;
  initialMode?: PipelineMode;
  mode?: PipelineMode;
  onModeChange?: (mode: PipelineMode) => void;
  showModeTabs?: boolean;
  showRunHistory?: boolean;
  onOpenSegment?: (segmentId: string) => void;
  onOpenTask: (projectId: string, taskId: string) => void | Promise<void>;
}

interface ActionState {
  key: string;
  label: string;
}

const TABS: Array<{ id: PipelineMode; label: string }> = [
  { id: "review", label: "审阅" },
  { id: "qa", label: "QA" },
  { id: "delivery", label: "交付" },
  { id: "eval", label: "评估" },
];

function reportTone(status: "pass" | "warn" | "fail"): StatusState {
  return status === "pass" ? "complete" : status === "warn" ? "waiting" : "failed";
}

function reportLabel(status: "pass" | "warn" | "fail"): string {
  return status === "pass" ? "通过" : status === "warn" ? "需复核" : "未通过";
}

function artifactMode(snapshot: TaskWorkspaceSnapshot, artifactId: string | null | undefined): PipelineMode | null {
  if (!artifactId) return null;
  const artifact = snapshot.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) return null;
  if (artifact.type === "delivery_readiness" || artifact.type === "delivery_export") return "delivery";
  if (artifact.type === "eval_output" || artifact.type === "eval_scorecard" || artifact.type === "eval_comparison") return "eval";
  const view = buildPipelineSnapshotView(snapshot);
  if (artifact.type === "qa_report") {
    const operation = view.runs.find((row) => row.run.id === artifact.runId)?.operation;
    return operation === "delivery_qa" || operation === "delivery_qa_review" ? "review" : "qa";
  }
  return null;
}

function tabKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']"));
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0 || !tabs.length) return;
  const next = event.key === "Home" ? 0
    : event.key === "End" ? tabs.length - 1
    : event.key === "ArrowRight" ? (current + 1) % tabs.length
    : (current - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}

function EmptyResult({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pipeline-empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function DefinitionMetrics({ children }: { children: ReactNode }) {
  return <dl className="pipeline-metrics">{children}</dl>;
}

function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

function RunHistoryDisclosure({ runs }: { runs: PipelineRunView[] }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(detailsRef);
  return (
    <details className="pipeline-run-history" ref={detailsRef}>
      <summary aria-label={`查看当前 Task 的专业 Run 记录，共 ${runs.length} 条`}>
        <History aria-hidden="true" />
        <span>Run 记录</span>
        <span className="pipeline-run-history__count">{runs.length}</span>
        <ChevronDown className="pipeline-run-history__chevron" aria-hidden="true" />
      </summary>
      <div className="pipeline-run-history__popover">
        <header>
          <strong>专业 Run</strong>
          <span>每次复核、QA、交付或评估都保留为独立的 canonical Run。</span>
        </header>
        {!runs.length ? <p>当前 Task 还没有专业 Run。</p> : (
          <ol>
            {runs.map((row) => (
              <li key={row.run.id}>
                <div>
                  <strong>{row.label}</strong>
                  <StatusLabel state={row.presentation.tone}>{row.presentation.label}</StatusLabel>
                </div>
                <time dateTime={row.run.updatedAt}>{new Date(row.run.updatedAt).toLocaleString()}</time>
                <span>{canonicalUsage(row.run)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

function DecisionRecord({ owned }: { owned: OwnedPipelineArtifact | null }) {
  if (!owned?.decisions.length) return null;
  return (
    <section className="pipeline-decision-records" aria-label="已记录决定">
      <h4>已记录决定</h4>
      {owned.decisions.map((decision) => (
        <div key={decision.id} className="pipeline-decision-record">
          <span>{decision.prompt}</span>
          <strong>{decision.options.find((option) => option.id === decision.selectedOptionId)?.label ?? decision.selectedOptionId ?? "已记录"}</strong>
          {decision.reason ? <p>{decision.reason}</p> : null}
        </div>
      ))}
    </section>
  );
}

function QualityFindingRow({ finding, busy, onSubmit, onOpenSegment }: {
  finding: QualityFindingDTO;
  busy: boolean;
  onSubmit: (reason: string) => Promise<void>;
  onOpenSegment?: (segmentId: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <details className="pipeline-finding" data-severity={finding.severity}>
      <summary>
        <span className="pipeline-finding-code">{finding.code}</span>
        <span>{finding.message}</span>
        <span>{finding.segmentId}</span>
      </summary>
      <div className="pipeline-finding-body">
        <dl className="pipeline-evidence-values">
          <div><dt>源文</dt><dd>{finding.source}</dd></div>
          <div><dt>译文</dt><dd>{finding.target || "—"}</dd></div>
          {finding.expectedTarget || finding.sourceTerm ? <div><dt>期望</dt><dd>{finding.expectedTarget ?? finding.sourceTerm}</dd></div> : null}
        </dl>
        {finding.evidenceSources.length ? <p className="pipeline-evidence-line">证据：{finding.evidenceSources.join(" · ")}</p> : null}
        {onOpenSegment ? <Button variant="ghost" onClick={() => onOpenSegment(finding.segmentId)}>在 CAT 中定位</Button> : null}
        {finding.status === "ignored" ? (
          <div className="pipeline-recorded-decision">
            <StatusLabel state="waiting">风险已由用户接受</StatusLabel>
            {finding.ignoredReason ? <p>{finding.ignoredReason}</p> : null}
          </div>
        ) : (
          <form className="pipeline-inline-decision" onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(reason).then(() => setReason(""));
          }}>
            <label htmlFor={`quality-reason-${finding.id}`}>接受此风险的理由</label>
            <textarea id={`quality-reason-${finding.id}`} value={reason} rows={2} onChange={(event) => setReason(event.target.value)} placeholder="说明为何此项可以保留；空理由不会提交。" />
            <Button type="submit" variant="destructive" loading={busy} loadingLabel="正在提交…" disabled={!reason.trim()}>接受风险</Button>
          </form>
        )}
      </div>
    </details>
  );
}

function ReviewFindingRow({ reportId, finding, reviewed, busy, onSubmit, onOpenSegment }: {
  reportId: string;
  finding: DeliveryQaFindingDTO;
  reviewed?: { reviewDecision: DeliveryQaReviewChoice; reviewReason: string };
  busy: boolean;
  onSubmit: (input: { reportId: string; findingId: string; decision: DeliveryQaReviewChoice; reason: string }) => Promise<void>;
  onOpenSegment?: (segmentId: string) => void;
}) {
  const [choice, setChoice] = useState<DeliveryQaReviewChoice>("fix_required");
  const [reason, setReason] = useState("");
  return (
    <details className="pipeline-finding" data-severity={finding.severity}>
      <summary>
        <span className="pipeline-finding-code">{finding.type}</span>
        <span>{finding.message}</span>
        <span>{finding.segmentId ?? "整批"}</span>
      </summary>
      <div className="pipeline-finding-body">
        {finding.source ? <dl className="pipeline-evidence-values"><div><dt>源文</dt><dd>{finding.source}</dd></div><div><dt>译文</dt><dd>{finding.target || "—"}</dd></div></dl> : null}
        {finding.evidence.length ? <p className="pipeline-evidence-line">证据：{finding.evidence.join(" · ")}</p> : null}
        {finding.segmentId && onOpenSegment ? <Button variant="ghost" onClick={() => onOpenSegment(finding.segmentId!)}>在 CAT 中定位</Button> : null}
        {reviewed ? (
          <div className="pipeline-recorded-decision">
            <StatusLabel state={reviewed.reviewDecision === "fix_required" ? "failed" : reviewed.reviewDecision === "query" ? "waiting" : "complete"}>
              {reviewed.reviewDecision}
            </StatusLabel>
            <p>{reviewed.reviewReason}</p>
          </div>
        ) : (
          <form className="pipeline-inline-decision" onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({ reportId, findingId: finding.id, decision: choice, reason }).then(() => setReason(""));
          }}>
            <label htmlFor={`review-choice-${finding.id}`}>处理决定</label>
            <select id={`review-choice-${finding.id}`} value={choice} onChange={(event) => setChoice(event.target.value as DeliveryQaReviewChoice)}>
              <option value="fix_required">需要修复</option>
              <option value="query">需要确认</option>
              <option value="ignore_with_reason">有理由忽略</option>
              <option value="accepted_risk">接受风险</option>
            </select>
            <label htmlFor={`review-reason-${finding.id}`}>理由</label>
            <textarea id={`review-reason-${finding.id}`} value={reason} rows={2} onChange={(event) => setReason(event.target.value)} placeholder="每个决定都必须说明理由。" />
            <Button type="submit" variant={choice === "accepted_risk" || choice === "ignore_with_reason" ? "destructive" : "secondary"} loading={busy} loadingLabel="正在提交…" disabled={!reason.trim()}>记录决定</Button>
          </form>
        )}
      </div>
    </details>
  );
}

function ReviewPanel({ view, action, actionState, onOpenSegment }: {
  view: ReturnType<typeof buildPipelineSnapshotView>;
  action: (action: CanonicalPipelineAction, label: string, key?: string) => Promise<void>;
  actionState: ActionState | null;
  onOpenSegment?: (segmentId: string) => void;
}) {
  const content = readDeliveryQaReport(view.review?.artifact ?? null);
  const reviewed = new Map(content?.review?.findings.map((finding) => [finding.id, finding]) ?? []);
  return (
    <section className="pipeline-panel" aria-label="交付复核">
      <PaneHeader
        className="pipeline-pane-header"
        title="交付复核"
        description="检查批次在最终交付前的机械和内容风险；处理决定会写入 canonical Decision。"
        actions={<><RunHistoryDisclosure runs={view.runs} /><Button variant="primary" loading={actionState?.key === "delivery-qa"} loadingLabel="正在请求…" onClick={() => void action({ kind: "delivery-qa" }, "运行交付复核", "delivery-qa")}>运行复核</Button></>}
      />
      <div className="pipeline-panel-body">
        {!content ? <EmptyResult title="尚无交付复核结果">运行复核后，报告会作为当前 Task 的新 Artifact 出现在这里。</EmptyResult> : (
          <>
            <div className="pipeline-result-heading">
              <div><h3 id="pipeline-review-title">{content.report.reportId}</h3><p>{new Date(content.report.generatedAt).toLocaleString()}</p></div>
              <StatusLabel state={content.report.summary.blockers ? "failed" : content.report.summary.warnings ? "waiting" : "complete"}>
                {content.report.summary.blockers ? "有阻塞项" : content.report.summary.warnings ? "需要复核" : "无待处理风险"}
              </StatusLabel>
            </div>
            <DefinitionMetrics>
              <Metric label="阻塞" value={content.report.summary.blockers} />
              <Metric label="警告" value={content.report.summary.warnings} />
              <Metric label="建议" value={content.report.summary.advisories} />
              <Metric label="发现" value={content.report.findings.length} />
            </DefinitionMetrics>
            <div className="pipeline-findings" aria-label="交付复核发现">
              {content.report.findings.map((finding) => (
                <ReviewFindingRow
                  key={finding.id}
                  reportId={content.report.reportId}
                  finding={finding}
                  reviewed={reviewed.get(finding.id)}
                  busy={actionState?.key === `review:${finding.id}`}
                  onOpenSegment={onOpenSegment}
                  onSubmit={(input) => action({ kind: "delivery-qa-review", input }, "记录复核决定", `review:${finding.id}`)}
                />
              ))}
            </div>
            <DecisionRecord owned={view.review} />
          </>
        )}
      </div>
    </section>
  );
}

function QualityPanel({ view, action, actionState, onOpenSegment }: {
  view: ReturnType<typeof buildPipelineSnapshotView>;
  action: (action: CanonicalPipelineAction, label: string, key?: string) => Promise<void>;
  actionState: ActionState | null;
  onOpenSegment?: (segmentId: string) => void;
}) {
  const report = readQualityReport(view.quality?.artifact ?? null);
  return (
    <section className="pipeline-panel" aria-label="质量审计">
      <PaneHeader
        className="pipeline-pane-header"
        title="质量审计"
        description="确定性检查术语、格式、数字、一致性和项目约束；不会自动接受风险。"
        actions={<><RunHistoryDisclosure runs={view.runs} /><Button variant="primary" loading={actionState?.key === "quality-audit"} loadingLabel="正在请求…" onClick={() => void action({ kind: "quality-audit" }, "运行质量审计", "quality-audit")}>运行 QA</Button></>}
      />
      <div className="pipeline-panel-body">
        {!report ? <EmptyResult title="尚无质量审计">运行 QA 后，完整报告会成为当前 Task 上独立 Pipeline Run 的 Artifact。</EmptyResult> : (
          <>
            <div className="pipeline-result-heading">
              <div><h3 id="pipeline-quality-title">最近一次结果</h3><p>{new Date(report.checkedAt).toLocaleString()}</p></div>
              <StatusLabel state={reportTone(report.status)}>{reportLabel(report.status)}</StatusLabel>
            </div>
            <DefinitionMetrics>
              <Metric label="已检查" value={report.summary.checkedSegments} />
              <Metric label="阻塞" value={report.summary.openBlockers} />
              <Metric label="警告" value={report.summary.openWarnings} />
              <Metric label="已接受" value={report.summary.ignored} detail="仅 canonical waiver" />
            </DefinitionMetrics>
            <div className="pipeline-findings" aria-label="质量发现">
              {report.findings.length ? report.findings.map((finding) => (
                <QualityFindingRow
                  key={finding.id}
                  finding={finding}
                  busy={actionState?.key === `waiver:${finding.id}`}
                  onOpenSegment={onOpenSegment}
                  onSubmit={(reason) => action({
                    kind: "quality-waiver",
                    input: { segmentId: finding.segmentId, findingId: finding.id, code: finding.code, reason },
                  }, "记录质量决定", `waiver:${finding.id}`)}
                />
              )) : <p className="pipeline-success-copy">没有待处理质量发现。</p>}
            </div>
            <DecisionRecord owned={view.quality} />
          </>
        )}
      </div>
    </section>
  );
}

function DeliveryPanel({ view, batchFormat, action, actionState }: {
  view: ReturnType<typeof buildPipelineSnapshotView>;
  batchFormat?: BatchFormat;
  action: (action: CanonicalPipelineAction, label: string, key?: string) => Promise<void>;
  actionState: ActionState | null;
}) {
  const readiness = readDeliveryReadiness(view.readiness?.artifact ?? null);
  const latestExport = readDeliveryExport(view.latestExport?.artifact ?? null);
  const authority = deliveryAuthority(view.latestExport?.artifact ?? null);
  const [format, setFormat] = useState<DeliveryExportFormat>(() => batchFormat ? exportFormatForBatch(batchFormat) : "xliff");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (batchFormat) setFormat(exportFormatForBatch(batchFormat));
  }, [batchFormat]);
  return (
    <section className="pipeline-panel" aria-label="交付">
      <PaneHeader
        className="pipeline-pane-header"
        title="交付"
        description="准备度是诊断结果；最终导出授权只由服务器在导出时读取 QualityDecisionLedger 决定。"
        actions={<><RunHistoryDisclosure runs={view.runs} /><Button variant="primary" loading={actionState?.key === "delivery-readiness"} loadingLabel="正在请求…" onClick={() => void action({ kind: "delivery-readiness" }, "检查交付准备度", "delivery-readiness")}>检查准备度</Button></>}
      />
      <div className="pipeline-panel-body">
        <div className="pipeline-result-heading">
          <div><h3 id="pipeline-delivery-title">交付准备度</h3><p>{readiness ? new Date(readiness.checkedAt).toLocaleString() : "尚未检查"}</p></div>
          {readiness ? <StatusLabel state={reportTone(readiness.status)}>{reportLabel(readiness.status)}</StatusLabel> : <StatusLabel>未检查</StatusLabel>}
        </div>
        {readiness ? (
          <>
            <DefinitionMetrics>
              <Metric label="交付阻塞" value={readiness.delivery.blockers.length} />
              <Metric label="QA 阻塞" value={readiness.quality.summary.openBlockers} />
              <Metric label="QA 警告" value={readiness.quality.summary.openWarnings} />
              <Metric label="待处理提案" value={readiness.proposals.proposed} />
              <Metric label="导出审计" value={readiness.exportAuditCount} />
            </DefinitionMetrics>
            <section className="pipeline-next-actions"><h4>下一步</h4><ol>{readiness.nextActions.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ol></section>
          </>
        ) : <EmptyResult title="还没有准备度报告">先运行检查；这不会产生模型费用，也不会授权导出。</EmptyResult>}

        <section className="pipeline-export-section" aria-labelledby="pipeline-export-title">
          <div className="pipeline-section-heading">
            <div><h3 id="pipeline-export-title">导出交付文件</h3><p>普通导出不会使用 force override。服务器仍会再次执行权威质量门。</p></div>
            {latestExport ? <StatusLabel state={authority === "authorized" ? "complete" : authority === "blocked_override" ? "failed" : "waiting"}>
              {authority === "authorized" ? "已授权导出" : authority === "blocked_override" ? "曾使用强制覆盖" : "授权信息缺失"}
            </StatusLabel> : null}
          </div>
          {latestExport ? <p className="pipeline-export-result">最近导出：{latestExport.outputPath} · {latestExport.updatedSegments} 句段 · {latestExport.missingIds.length} 缺失</p> : null}
          <div className="pipeline-export-controls">
            <label htmlFor="pipeline-export-format">格式</label>
            <select id="pipeline-export-format" value={format} onChange={(event) => setFormat(event.target.value as DeliveryExportFormat)}>
              <option value="phrase_mxliff">Phrase MXLIFF</option>
              <option value="mqxliff">memoQ MQXLIFF</option>
              <option value="sdlxliff">SDLXLIFF</option>
              <option value="xliff">XLIFF</option>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel</option>
            </select>
            {!confirming ? <Button variant="secondary" onClick={() => setConfirming(true)}>准备导出…</Button> : null}
          </div>
          {confirming ? (
            <div className="pipeline-export-confirm" role="group" aria-label="确认导出">
              <p>确认创建新的交付文件？Linguist Agent 不会自动接受未解决风险，也不会请求强制覆盖。</p>
              <div>
                <Button variant="ghost" onClick={() => setConfirming(false)}>取消</Button>
                <Button variant="primary" loading={actionState?.key === "delivery-export"} loadingLabel="正在请求…" onClick={() => void action({ kind: "delivery-export", input: { format } }, "导出交付文件", "delivery-export").then(() => setConfirming(false))}>确认导出</Button>
              </div>
            </div>
          ) : null}
        </section>
        <DecisionRecord owned={view.latestExport} />
      </div>
    </section>
  );
}

function scorecardRows(artifacts: TaskArtifact[]) {
  return artifacts.flatMap((artifact) => readEvalScorecard(artifact)?.rows ?? []);
}

function evalSetIdFromArtifacts(view: ReturnType<typeof buildPipelineSnapshotView>): string | null {
  for (const artifact of [...view.eval.comparisons, ...view.eval.scorecards, ...view.eval.outputs]) {
    const value = artifact.content.evalSetId;
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

const EVAL_ISSUE_TIERS: PrivateEvalIssueTierDTO[] = ["OK", "A", "B", "C"];

function evalRunLabel(run: PrivateEvalRunDTO): string {
  const mode = run.mode === "single_agent" ? "Single" : "Team";
  return `${mode} · ${run.runId}`;
}

function BlindJudgmentForm({ pair, disabled, saving, onSubmit }: {
  pair: PrivateEvalBlindPairDTO;
  disabled: boolean;
  saving: boolean;
  onSubmit: (input: PrivateEvalBlindJudgmentInputDTO) => Promise<void>;
}) {
  const [preference, setPreference] = useState<PrivateEvalBlindJudgmentInputDTO["preference"]>(pair.judgment?.preference ?? "a");
  const [tierA, setTierA] = useState<PrivateEvalIssueTierDTO>(pair.judgment?.issueTierA ?? "OK");
  const [tierB, setTierB] = useState<PrivateEvalIssueTierDTO>(pair.judgment?.issueTierB ?? "OK");
  const [categoriesA, setCategoriesA] = useState(pair.judgment?.issueCategoriesA.join(", ") ?? "");
  const [categoriesB, setCategoriesB] = useState(pair.judgment?.issueCategoriesB.join(", ") ?? "");
  const [comment, setComment] = useState(pair.judgment?.comment ?? "");
  const fieldId = pair.pairId.replace(/[^A-Za-z0-9_-]/g, "-");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit({
      pairId: pair.pairId,
      preference,
      issueTierA: tierA,
      issueTierB: tierB,
      issueCategoriesA: parseIssueCategories(categoriesA),
      issueCategoriesB: parseIssueCategories(categoriesB),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    });
  };

  return (
    <details className="pipeline-blind-pair">
      <summary><span>{pair.segmentId}</span><span>{pair.judgment ? "已判断" : "等待判断"}</span></summary>
      <dl className="pipeline-evidence-values">
        <div><dt>源文</dt><dd>{pair.source}</dd></div>
        <div><dt>候选 A</dt><dd>{pair.candidateA}</dd></div>
        <div><dt>候选 B</dt><dd>{pair.candidateB}</dd></div>
      </dl>
      {pair.riskTypes.length || pair.tmRefs.length || pair.termRefs.length ? (
        <p className="pipeline-evidence-line">
          {pair.riskTypes.length ? `风险：${pair.riskTypes.join(" · ")}` : ""}
          {pair.tmRefs.length ? ` · TM ${pair.tmRefs.length}` : ""}
          {pair.termRefs.length ? ` · 术语 ${pair.termRefs.length}` : ""}
        </p>
      ) : null}
      <form className="pipeline-eval-form pipeline-judgment-form" onSubmit={(event) => void submit(event)}>
        <label htmlFor={`${fieldId}-preference`}>判断</label>
        <select id={`${fieldId}-preference`} value={preference} disabled={disabled} onChange={(event) => setPreference(event.target.value as typeof preference)}>
          <option value="a">候选 A 更好</option>
          <option value="b">候选 B 更好</option>
          <option value="tie">两者相当</option>
          <option value="both_fail">两者都不可用</option>
        </select>
        <label htmlFor={`${fieldId}-tier-a`}>候选 A 等级</label>
        <select id={`${fieldId}-tier-a`} value={tierA} disabled={disabled} onChange={(event) => setTierA(event.target.value as PrivateEvalIssueTierDTO)}>
          {EVAL_ISSUE_TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
        </select>
        <label htmlFor={`${fieldId}-tier-b`}>候选 B 等级</label>
        <select id={`${fieldId}-tier-b`} value={tierB} disabled={disabled} onChange={(event) => setTierB(event.target.value as PrivateEvalIssueTierDTO)}>
          {EVAL_ISSUE_TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
        </select>
        <label htmlFor={`${fieldId}-categories-a`}>A 问题分类</label>
        <input id={`${fieldId}-categories-a`} value={categoriesA} disabled={disabled} placeholder="逗号分隔，可留空" onChange={(event) => setCategoriesA(event.target.value)} />
        <label htmlFor={`${fieldId}-categories-b`}>B 问题分类</label>
        <input id={`${fieldId}-categories-b`} value={categoriesB} disabled={disabled} placeholder="逗号分隔，可留空" onChange={(event) => setCategoriesB(event.target.value)} />
        <label htmlFor={`${fieldId}-comment`}>评语</label>
        <textarea id={`${fieldId}-comment`} value={comment} disabled={disabled} placeholder="可选" onChange={(event) => setComment(event.target.value)} />
        <Button type="submit" variant="primary" disabled={disabled} loading={saving} loadingLabel="正在保存…">{pair.judgment ? "更新判断" : "保存判断"}</Button>
      </form>
    </details>
  );
}

function ScorecardEntryForm({ runId, outputs, disabled, saving, onSubmit }: {
  runId: string;
  outputs: PrivateEvalRunOutputDTO[];
  disabled: boolean;
  saving: boolean;
  onSubmit: (row: HumanScoreRowDTO) => Promise<void>;
}) {
  const eligibleOutputs = useMemo(() => outputs.filter((row) => row.status === "completed" && Boolean(row.target?.trim())), [outputs]);
  const [segmentId, setSegmentId] = useState(eligibleOutputs[0]?.segmentId ?? "");
  const [dimension, setDimension] = useState<EvalDimensionDTO>("adequacy");
  const [score, setScore] = useState<HumanScoreRowDTO["score"]>(4);
  const [issueTier, setIssueTier] = useState<PrivateEvalIssueTierDTO>("OK");
  const [issueCategories, setIssueCategories] = useState("");
  const [accepted, setAccepted] = useState<"" | "true" | "false">("");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!eligibleOutputs.some((row) => row.segmentId === segmentId)) {
      setSegmentId(eligibleOutputs[0]?.segmentId ?? "");
    }
  }, [eligibleOutputs, segmentId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!segmentId) return;
    await onSubmit({
      runId,
      segmentId,
      dimension,
      score,
      judge: "human:reviewer",
      issueTier,
      issueCategories: parseIssueCategories(issueCategories),
      ...(accepted === "" ? {} : { accepted: accepted === "true" }),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    });
  };

  if (!eligibleOutputs.length) {
    return <EmptyResult title="没有可评分输出">这个 Run 没有带译文的 completed Segment；Electron 不会让用户手写不存在的 Segment ID。</EmptyResult>;
  }

  return (
    <form className="pipeline-eval-form pipeline-scorecard-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="pipeline-scorecard-segment">句段</label>
      <select id="pipeline-scorecard-segment" value={segmentId} disabled={disabled} onChange={(event) => setSegmentId(event.target.value)}>
        {eligibleOutputs.map((row) => <option key={row.segmentId} value={row.segmentId}>{row.segmentId} · {row.source}</option>)}
      </select>
      <label htmlFor="pipeline-scorecard-dimension">维度</label>
      <select id="pipeline-scorecard-dimension" value={dimension} disabled={disabled} onChange={(event) => setDimension(event.target.value as EvalDimensionDTO)}>
        {EVAL_DIMENSIONS.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
      </select>
      <label htmlFor="pipeline-scorecard-score">分数</label>
      <select id="pipeline-scorecard-score" value={score} disabled={disabled} onChange={(event) => setScore(Number(event.target.value) as HumanScoreRowDTO["score"])}>
        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <label htmlFor="pipeline-scorecard-tier">问题等级</label>
      <select id="pipeline-scorecard-tier" value={issueTier} disabled={disabled} onChange={(event) => setIssueTier(event.target.value as PrivateEvalIssueTierDTO)}>
        {EVAL_ISSUE_TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
      </select>
      <label htmlFor="pipeline-scorecard-categories">问题分类</label>
      <input id="pipeline-scorecard-categories" value={issueCategories} disabled={disabled} placeholder="逗号分隔，可留空" onChange={(event) => setIssueCategories(event.target.value)} />
      <label htmlFor="pipeline-scorecard-accepted">是否接受</label>
      <select id="pipeline-scorecard-accepted" value={accepted} disabled={disabled} onChange={(event) => setAccepted(event.target.value as typeof accepted)}>
        <option value="">未指定</option>
        <option value="true">接受</option>
        <option value="false">不接受</option>
      </select>
      <label htmlFor="pipeline-scorecard-comment">备注</label>
      <textarea id="pipeline-scorecard-comment" value={comment} disabled={disabled} placeholder="可选" onChange={(event) => setComment(event.target.value)} />
      <div className="pipeline-eval-form-footer">
        <span>评审人：human:reviewer</span>
        <Button type="submit" variant="primary" disabled={disabled} loading={saving} loadingLabel="正在保存…">保存评分</Button>
      </div>
    </form>
  );
}

function EvalPanel({ snapshot, view, client, actionState, setActionState, setError, onOpenTask }: {
  snapshot: TaskWorkspaceSnapshot;
  view: ReturnType<typeof buildPipelineSnapshotView>;
  client: CanonicalPipelineClient & EvalClient;
  actionState: ActionState | null;
  setActionState: (state: ActionState | null) => void;
  setError: (message: string | null) => void;
  onOpenTask: (projectId: string, taskId: string) => void | Promise<void>;
}) {
  const [sets, setSets] = useState<PrivateEvalSetDTO[]>([]);
  const [setsState, setSetsState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedSetId, setSelectedSetId] = useState(evalSetIdFromArtifacts(view) ?? "");
  const [mode, setMode] = useState<"single_agent" | "team_workflow">("single_agent");
  const [runIndex, setRunIndex] = useState<Map<string, PrivateEvalRunDTO>>(new Map());
  const [singleRunId, setSingleRunId] = useState("");
  const [teamRunId, setTeamRunId] = useState("");
  const [reviewSeed, setReviewSeed] = useState("");
  const [reviewSampleSize, setReviewSampleSize] = useState("");
  const [blindSummaries, setBlindSummaries] = useState<PrivateEvalBlindReviewSummaryDTO[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [blindReview, setBlindReview] = useState<PrivateEvalBlindReviewDTO | null>(null);
  const [blindState, setBlindState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [scoreRunId, setScoreRunId] = useState("");
  const [scoreOutputs, setScoreOutputs] = useState<PrivateEvalRunOutputDTO[]>([]);
  const [savedScoreRows, setSavedScoreRows] = useState<HumanScoreRowDTO[]>([]);
  const [scoreState, setScoreState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const projectId = snapshot.task.owner.kind === "project" ? snapshot.task.owner.projectId : "";
  const batchId = snapshot.task.scope.kind === "project" ? snapshot.task.scope.batchId ?? null : null;
  const evalRunStatusKey = useMemo(
    () => view.runs.filter((row) => row.operation === "eval").map((row) => `${row.run.id}:${row.run.status}`).sort().join("|"),
    [view.runs],
  );

  useEffect(() => {
    let cancelled = false;
    setSets([]);
    setRunIndex(new Map());
    setSetsState("loading");
    void client.listPrivateEvalSets().then(async ({ rows }) => {
      if (cancelled) return;
      setSets(rows);
      setSetsState("ready");
      setSelectedSetId((current) => current || rows[0]?.evalSetId || "");
      if (snapshot.task.kind !== "eval") return;
      const runRows = await Promise.all(rows.map(async (set) => (await client.listPrivateEvalRuns(set.evalSetId)).rows));
      if (cancelled) return;
      setRunIndex(new Map(runRows.flat().filter((run) => run.taskId === snapshot.task.id).map((run) => [run.runId, run])));
    }).catch((reason) => {
      if (cancelled) return;
      setSetsState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [client, evalRunStatusKey, setError, snapshot.task.id, snapshot.task.kind]);

  const artifactEvalSetId = evalSetIdFromArtifacts(view);
  useEffect(() => {
    if (artifactEvalSetId) setSelectedSetId(artifactEvalSetId);
  }, [artifactEvalSetId]);

  const completedRuns = useMemo(
    () => completedEvalRuns(runIndex.values(), selectedSetId, projectId, snapshot.task.id),
    [projectId, runIndex, selectedSetId, snapshot.task.id],
  );
  const scoreRunChoices = useMemo(
    () => [...completedRuns.single, ...completedRuns.team],
    [completedRuns],
  );

  useEffect(() => {
    setSingleRunId((current) => completedRuns.single.some((run) => run.runId === current) ? current : completedRuns.single[0]?.runId ?? "");
    setTeamRunId((current) => completedRuns.team.some((run) => run.runId === current) ? current : completedRuns.team[0]?.runId ?? "");
    setScoreRunId((current) => scoreRunChoices.some((run) => run.runId === current) ? current : scoreRunChoices[0]?.runId ?? "");
  }, [completedRuns, scoreRunChoices]);

  useEffect(() => {
    let cancelled = false;
    setBlindSummaries([]);
    setSelectedReviewId("");
    setBlindReview(null);
    if (!selectedSetId) {
      setBlindState("idle");
      return () => { cancelled = true; };
    }
    setBlindState("loading");
    void client.listPrivateEvalBlindReviews(selectedSetId).then(async ({ rows }) => {
      if (cancelled) return;
      const summaries = [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      setBlindSummaries(summaries);
      const reviewId = summaries[0]?.reviewId;
      if (!reviewId) {
        setBlindState("ready");
        return;
      }
      setSelectedReviewId(reviewId);
      const review = await client.fetchPrivateEvalBlindReview(selectedSetId, reviewId);
      if (cancelled) return;
      setBlindReview(review);
      setBlindState("ready");
    }).catch((reason) => {
      if (cancelled) return;
      setBlindState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [client, selectedSetId, setError]);

  useEffect(() => {
    let cancelled = false;
    setScoreOutputs([]);
    setSavedScoreRows([]);
    if (!selectedSetId || !scoreRunId || !scoreRunChoices.some((run) => run.runId === scoreRunId)) {
      setScoreState("idle");
      return () => { cancelled = true; };
    }
    setScoreState("loading");
    void Promise.all([
      client.fetchPrivateEvalRunOutputs(selectedSetId, scoreRunId),
      client.fetchPrivateEvalScorecard(selectedSetId, scoreRunId),
    ]).then(([outputResponse, scorecardResponse]) => {
      if (cancelled) return;
      setScoreOutputs(outputResponse.rows);
      setSavedScoreRows(scorecardResponse.rows);
      setScoreState("ready");
    }).catch((reason) => {
      if (cancelled) return;
      setScoreState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [client, scoreRunChoices, scoreRunId, selectedSetId, setError]);

  const openBlindReview = async (reviewId: string) => {
    if (!selectedSetId || !reviewId) return;
    setSelectedReviewId(reviewId);
    setBlindReview(null);
    setBlindState("loading");
    setError(null);
    try {
      setBlindReview(await client.fetchPrivateEvalBlindReview(selectedSetId, reviewId));
      setBlindState("ready");
    } catch (reason) {
      setBlindState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const createBlindReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSetId) return;
    let input;
    try {
      input = buildBlindReviewInput(runIndex.values(), projectId, snapshot.task.id, {
        evalSetId: selectedSetId,
        singleRunId,
        teamRunId,
        seed: reviewSeed,
        ...(reviewSampleSize.trim() ? { sampleSize: Number(reviewSampleSize) } : {}),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    setActionState({ key: "eval-blind-create", label: "创建盲评" });
    setError(null);
    try {
      const review = await client.createPrivateEvalBlindReview(selectedSetId, input);
      setBlindReview(review);
      setSelectedReviewId(review.reviewId);
      setBlindState("ready");
      setBlindSummaries((current) => [{
        reviewId: review.reviewId,
        evalSetId: review.evalSetId,
        createdAt: review.createdAt,
        total: review.total,
        judged: review.judged,
        complete: review.complete,
      }, ...current.filter((row) => row.reviewId !== review.reviewId)]);
    } catch (reason) {
      setBlindState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionState(null);
    }
  };

  const submitBlindJudgment = async (input: PrivateEvalBlindJudgmentInputDTO) => {
    if (!selectedSetId || !blindReview) return;
    const reviewId = blindReview.reviewId;
    setActionState({ key: `eval-blind-judge:${input.pairId}`, label: "保存盲评判断" });
    setError(null);
    try {
      const review = await client.submitPrivateEvalBlindJudgments(selectedSetId, reviewId, [input]);
      setBlindReview(review);
      setBlindSummaries((current) => current.map((row) => row.reviewId === review.reviewId ? {
        ...row,
        judged: review.judged,
        total: review.total,
        complete: review.complete,
      } : row));
    } catch (reason) {
      try {
        setBlindReview(await client.fetchPrivateEvalBlindReview(selectedSetId, reviewId));
      } catch {
        // Preserve the original write error; a failed reconcile must not replace it.
      }
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionState(null);
    }
  };

  const submitScoreRow = async (row: HumanScoreRowDTO) => {
    if (!selectedSetId || !scoreRunId) return;
    setActionState({ key: "eval-scorecard-write", label: "保存人工评分" });
    setError(null);
    try {
      await client.writePrivateEvalScorecard(selectedSetId, scoreRunId, [row]);
      setSavedScoreRows((await client.fetchPrivateEvalScorecard(selectedSetId, scoreRunId)).rows);
    } catch (reason) {
      try {
        setSavedScoreRows((await client.fetchPrivateEvalScorecard(selectedSetId, scoreRunId)).rows);
      } catch {
        // Preserve the original write error; a failed reconcile must not replace it.
      }
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionState(null);
    }
  };

  const launch = async () => {
    if (!batchId || !selectedSetId) return;
    setActionState({ key: "eval-launch", label: "启动评估" });
    setError(null);
    try {
      const result = await client.launchPrivateEval({ evalSetId: selectedSetId, projectId, batchId, mode });
      if (!result.run.taskId) throw new Error("服务器没有返回 canonical Eval Task。");
      await onOpenTask(projectId, result.run.taskId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionState(null);
    }
  };

  const stop = async (run: TaskRun) => {
    const resolved = runIndex.get(run.id);
    if (!resolved) {
      setError("尚未从服务器解析到这个 Eval Run 的 evalSetId，无法安全发送 Stop。");
      return;
    }
    setActionState({ key: `eval-stop:${run.id}`, label: "停止评估" });
    setError(null);
    try {
      await client.stopPrivateEval(resolved.evalSetId, run.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionState(null);
    }
  };

  const artifactScoreRows = scorecardRows(view.eval.scorecards);
  const rows = scoreRunId && scoreState === "ready"
    ? savedScoreRows
    : scoreRunId
      ? artifactScoreRows.filter((row) => row.runId === scoreRunId)
      : artifactScoreRows;
  const comparisons = view.eval.comparisons.flatMap((artifact) => {
    const report = readEvalComparison(artifact);
    return report ? [{ artifact, report }] : [];
  });
  const evalRuns = view.runs.filter((row) => row.operation === "eval");
  const canCreateBlindReview = Boolean(
    selectedSetId
    && singleRunId
    && teamRunId
    && reviewSeed.trim()
    && (!reviewSampleSize.trim() || (Number.isInteger(Number(reviewSampleSize)) && Number(reviewSampleSize) > 0)),
  );
  return (
    <section className="pipeline-panel" aria-label="评估">
      <PaneHeader className="pipeline-pane-header" title="评估" description="从当前 Project / Batch 进入；服务器创建或复用唯一 canonical Eval Task，Run 不混入当前 Task。" actions={<RunHistoryDisclosure runs={view.runs} />} />
      <div className="pipeline-panel-body">
        <section className="pipeline-eval-launch" aria-labelledby="pipeline-eval-title">
          <div className="pipeline-section-heading"><div><h3 id="pipeline-eval-title">启动质量评估</h3><p>评估集、执行模式、Task 和 Run 都由真实服务端 contract 记录。</p></div></div>
          {setsState === "loading" ? <StatusLabel live>正在载入评估集…</StatusLabel> : null}
          {setsState === "error" ? <p className="pipeline-inline-error">评估集未能载入。</p> : null}
          {setsState === "ready" && !sets.length ? <EmptyResult title="没有评估集">先在高级评估设置中创建真实 eval set；这里不会伪造样例。</EmptyResult> : null}
          {sets.length ? (
            <div className="pipeline-eval-controls">
              <label htmlFor="pipeline-eval-set">评估集</label>
              <select id="pipeline-eval-set" value={selectedSetId} onChange={(event) => setSelectedSetId(event.target.value)}>
                {sets.map((set) => <option key={set.evalSetId} value={set.evalSetId}>{set.label} · {set.segmentCount} 句段</option>)}
              </select>
              <label htmlFor="pipeline-eval-mode">运行方式</label>
              <select id="pipeline-eval-mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                <option value="single_agent">Single Agent</option>
                <option value="team_workflow">Team</option>
              </select>
              <Button variant="primary" loading={actionState?.key === "eval-launch"} loadingLabel="正在请求…" disabled={!batchId || !selectedSetId} onClick={() => void launch()}>创建 Eval Run</Button>
            </div>
          ) : null}
          {!batchId ? <p className="pipeline-inline-error">当前 Task 没有 Batch scope，不能启动 Eval。</p> : null}
        </section>

        <section className="pipeline-eval-runs" aria-labelledby="pipeline-eval-runs-title">
          <div className="pipeline-section-heading"><div><h3 id="pipeline-eval-runs-title">当前 Eval Task</h3><p>只显示 snapshot 中真实存在的 Eval Run。</p></div></div>
          {!evalRuns.length ? <EmptyResult title="当前 Task 没有 Eval Run">启动后会进入服务器返回的 canonical Eval Task。</EmptyResult> : evalRuns.map((row) => (
            <div className="pipeline-eval-run" key={row.run.id}>
              <div><strong>{row.run.id}</strong><StatusLabel state={row.presentation.tone}>{row.presentation.label}</StatusLabel></div>
              {row.run.stopAvailable ? <Button variant="destructive" loading={actionState?.key === `eval-stop:${row.run.id}`} loadingLabel="正在停止…" onClick={() => void stop(row.run)}>停止</Button> : null}
            </div>
          ))}
        </section>

        <section className="pipeline-blind-authoring" aria-labelledby="pipeline-blind-title">
          <div className="pipeline-section-heading">
            <div><h3 id="pipeline-blind-title">盲评</h3><p>从当前 Eval Task 选择一个已完成的 Single Run 和一个已完成的 Team Run；候选身份在全部判断完成前保持隐藏。</p></div>
          </div>
          {!completedRuns.single.length || !completedRuns.team.length ? (
            <EmptyResult title="还不能创建盲评">当前 Eval Task 需要至少一个 completed Single Run 和一个 completed Team Run。</EmptyResult>
          ) : (
            <form className="pipeline-eval-form pipeline-blind-create" onSubmit={(event) => void createBlindReview(event)}>
              <label htmlFor="pipeline-blind-single">Single Run</label>
              <select id="pipeline-blind-single" value={singleRunId} disabled={Boolean(actionState)} onChange={(event) => setSingleRunId(event.target.value)}>
                {completedRuns.single.map((run) => <option key={run.runId} value={run.runId}>{evalRunLabel(run)}</option>)}
              </select>
              <label htmlFor="pipeline-blind-team">Team Run</label>
              <select id="pipeline-blind-team" value={teamRunId} disabled={Boolean(actionState)} onChange={(event) => setTeamRunId(event.target.value)}>
                {completedRuns.team.map((run) => <option key={run.runId} value={run.runId}>{evalRunLabel(run)}</option>)}
              </select>
              <label htmlFor="pipeline-blind-seed">随机种子</label>
              <input id="pipeline-blind-seed" value={reviewSeed} disabled={Boolean(actionState)} placeholder="用于可重复的盲评顺序" required onChange={(event) => setReviewSeed(event.target.value)} />
              <label htmlFor="pipeline-blind-sample">抽样句段数</label>
              <input id="pipeline-blind-sample" type="number" min="1" step="1" inputMode="numeric" value={reviewSampleSize} disabled={Boolean(actionState)} placeholder="留空使用全部共同句段" onChange={(event) => setReviewSampleSize(event.target.value)} />
              <Button type="submit" variant="primary" disabled={!canCreateBlindReview || Boolean(actionState)} loading={actionState?.key === "eval-blind-create"} loadingLabel="正在创建…">创建盲评</Button>
            </form>
          )}

          {blindState === "loading" ? <StatusLabel live>正在载入盲评记录…</StatusLabel> : null}
          {blindState === "error" ? <p className="pipeline-inline-error">盲评记录未能完整载入；请根据上方错误重试。</p> : null}
          {blindSummaries.length ? (
            <div className="pipeline-eval-record-picker">
              <label htmlFor="pipeline-blind-review">盲评记录</label>
              <select id="pipeline-blind-review" value={selectedReviewId} disabled={blindState === "loading" || Boolean(actionState)} onChange={(event) => void openBlindReview(event.target.value)}>
                {blindSummaries.map((row) => <option key={row.reviewId} value={row.reviewId}>{row.reviewId} · {row.judged}/{row.total}{row.complete ? " · 已完成" : ""}</option>)}
              </select>
            </div>
          ) : blindState === "ready" ? <p className="pipeline-supporting-copy">这个评估集还没有盲评记录。</p> : null}

          {blindReview ? (
            <article className="pipeline-blind-review" aria-labelledby="pipeline-current-blind-title">
              <div className="pipeline-result-heading">
                <div><h4 id="pipeline-current-blind-title">{blindReview.reviewId}</h4><p>seed {blindReview.seed}</p></div>
                <StatusLabel state={blindReview.complete ? "complete" : "waiting"}>{blindReview.judged}/{blindReview.total} 已评</StatusLabel>
              </div>
              {blindReview.complete && blindReview.revealedRuns?.length ? (
                <dl className="pipeline-revealed-runs" aria-label="盲评完成后的 Run 身份">
                  {blindReview.revealedRuns.map((run) => <div key={run.runId}><dt>{run.mode === "single_agent" ? "Single" : "Team"}</dt><dd>{run.runId} · {run.wins} 胜</dd></div>)}
                </dl>
              ) : <p className="pipeline-supporting-copy">完成全部句段后，服务器才会揭示 A/B 对应的 Run。</p>}
              <div className="pipeline-blind-pairs">
                {blindReview.pairs.map((pair) => (
                  <BlindJudgmentForm
                    key={pair.pairId}
                    pair={pair}
                    disabled={Boolean(actionState)}
                    saving={actionState?.key === `eval-blind-judge:${pair.pairId}`}
                    onSubmit={submitBlindJudgment}
                  />
                ))}
              </div>
            </article>
          ) : null}
        </section>

        <section className="pipeline-scorecard" aria-labelledby="pipeline-scorecard-title">
          <div className="pipeline-section-heading"><div><h3 id="pipeline-scorecard-title">人工 Scorecard</h3><p>句段只能来自所选 completed Run 的真实输出；保存后由服务器合并并投影 canonical Artifact。</p></div></div>
          {!scoreRunChoices.length ? <EmptyResult title="没有可评分 Run">完成 Eval Run 后才能写入人工评分。</EmptyResult> : (
            <>
              <div className="pipeline-eval-record-picker">
                <label htmlFor="pipeline-scorecard-run">评分 Run</label>
                <select id="pipeline-scorecard-run" value={scoreRunId} disabled={scoreState === "loading" || Boolean(actionState)} onChange={(event) => setScoreRunId(event.target.value)}>
                  {scoreRunChoices.map((run) => <option key={run.runId} value={run.runId}>{evalRunLabel(run)}</option>)}
                </select>
              </div>
              {scoreState === "loading" ? <StatusLabel live>正在载入 Run 输出与 Scorecard…</StatusLabel> : null}
              {scoreState === "error" ? <p className="pipeline-inline-error">Run 输出或 Scorecard 未能载入。</p> : null}
              {scoreState === "ready" ? (
                <ScorecardEntryForm
                  key={scoreRunId}
                  runId={scoreRunId}
                  outputs={scoreOutputs}
                  disabled={Boolean(actionState)}
                  saving={actionState?.key === "eval-scorecard-write"}
                  onSubmit={submitScoreRow}
                />
              ) : null}
            </>
          )}
          {!rows.length ? <EmptyResult title="尚无人工评分">保存真实评分后，服务器返回的合并 Scorecard 会出现在这里。</EmptyResult> : (
            <div className="pipeline-table-scroll">
              <table>
                <thead><tr><th>句段</th><th>维度</th><th>分数</th><th>等级</th><th>判断</th><th>备注</th></tr></thead>
                <tbody>{rows.map((row, index) => <tr key={`${row.runId}:${row.segmentId}:${row.dimension}:${index}`}><td>{row.segmentId}</td><td>{row.dimension}</td><td>{row.score}</td><td>{row.issueTier}</td><td>{row.accepted === undefined ? "—" : row.accepted ? "接受" : "不接受"}</td><td>{row.comment ?? "—"}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className="pipeline-comparison" aria-labelledby="pipeline-comparison-title">
          <div className="pipeline-section-heading"><div><h3 id="pipeline-comparison-title">Comparison</h3><p>来自服务端生成的 eval_comparison Artifact。</p></div></div>
          {!comparisons.length ? <EmptyResult title="尚无对照报告">完成可比较 Run 或盲评后，服务端会生成对照 Artifact。</EmptyResult> : comparisons.map(({ artifact, report }) => (
            <article key={artifact.id} className="pipeline-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown}</ReactMarkdown>
              <p className="pipeline-report-path">{report.reportPath}</p>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

function canonicalUsage(run: TaskRun): string {
  const usage = run.usage;
  if (!usage) return "用量 —";
  const parts: string[] = [];
  if (usage.modelCalls !== undefined) parts.push(`${usage.modelCalls.toLocaleString()} 次调用`);
  if (usage.totalTokens !== undefined) parts.push(`${usage.totalTokens.toLocaleString()} tokens`);
  if (usage.costUSD !== undefined) parts.push(`US$${usage.costUSD.toFixed(4)}`);
  return parts.length ? parts.join(" · ") : "用量 —";
}

function RunHistory({ runs }: { runs: PipelineRunView[] }) {
  return (
    <aside className="pipeline-history" aria-labelledby="pipeline-history-title">
      <h2 id="pipeline-history-title">Runs</h2>
      {!runs.length ? <p>当前 Task 还没有 Quality、Delivery 或 Eval Run。</p> : (
        <ol>
          {runs.map((row) => (
            <li key={row.run.id}>
              <div><strong>{row.label}</strong><StatusLabel state={row.presentation.tone}>{row.presentation.label}</StatusLabel></div>
              <span>{new Date(row.run.updatedAt).toLocaleString()}</span>
              <span>{canonicalUsage(row.run)}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

export function PipelineWorkspace({
  snapshot,
  batchFormat,
  selectedArtifactId,
  client = workspaceClient,
  initialMode = "review",
  mode: controlledMode,
  onModeChange,
  showModeTabs = true,
  showRunHistory = true,
  onOpenSegment,
  onOpenTask,
}: PipelineWorkspaceProps) {
  const [internalMode, setInternalMode] = useState<PipelineMode>(() => artifactMode(snapshot, selectedArtifactId) ?? initialMode);
  const mode = controlledMode ?? internalMode;
  const setMode = (nextMode: PipelineMode) => {
    if (controlledMode === undefined) setInternalMode(nextMode);
    onModeChange?.(nextMode);
  };
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = useMemo(() => buildPipelineSnapshotView(snapshot), [snapshot]);
  const projectId = snapshot.task.owner.kind === "project" ? snapshot.task.owner.projectId : null;
  const batchId = snapshot.task.scope.kind === "project" ? snapshot.task.scope.batchId ?? null : null;
  const scope: PipelineScope | null = projectId && batchId ? { projectId, batchId, taskId: snapshot.task.id } : null;

  useEffect(() => {
    const selectedMode = artifactMode(snapshot, selectedArtifactId);
    if (selectedMode) setMode(selectedMode);
  }, [selectedArtifactId, snapshot]);

  const action = async (value: CanonicalPipelineAction, label: string, key: string = value.kind): Promise<void> => {
    if (!scope) {
      setError("当前 Task 没有 Batch scope，不能运行此操作。");
      return;
    }
    setActionState({ key, label });
    setError(null);
    try {
      await executeCanonicalPipelineAction(scope, value, client);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionState(null);
    }
  };

  return (
    <div className="pipeline-workspace" data-run-history={showRunHistory}>
      <div className="pipeline-primary">
        {showModeTabs ? <div className="pipeline-tabs" role="tablist" aria-label="质量与交付工作区" onKeyDown={tabKeyboard}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`pipeline-tab-${tab.id}`}
              aria-controls={`pipeline-panel-${tab.id}`}
              aria-selected={mode === tab.id}
              tabIndex={mode === tab.id ? 0 : -1}
              onClick={() => setMode(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div> : null}
        {actionState ? <div className="pipeline-request-state" role="status">正在向服务器请求{actionState.label}；Run 状态以右侧 canonical 时间线为准。</div> : null}
        {error ? <div className="pipeline-error" role="alert"><strong>操作未完成</strong><p>{error}</p></div> : null}
        <div
          id={`pipeline-panel-${mode}`}
          role={showModeTabs ? "tabpanel" : "region"}
          aria-labelledby={showModeTabs ? `pipeline-tab-${mode}` : undefined}
          aria-label={showModeTabs ? undefined : `${TABS.find((tab) => tab.id === mode)?.label ?? mode}工作区`}
          className="pipeline-active-panel"
        >
          {mode === "review" ? <ReviewPanel view={view} action={action} actionState={actionState} onOpenSegment={onOpenSegment} /> : null}
          {mode === "qa" ? <QualityPanel view={view} action={action} actionState={actionState} onOpenSegment={onOpenSegment} /> : null}
          {mode === "delivery" ? <DeliveryPanel view={view} batchFormat={batchFormat} action={action} actionState={actionState} /> : null}
          {mode === "eval" ? <EvalPanel snapshot={snapshot} view={view} client={client} actionState={actionState} setActionState={setActionState} setError={setError} onOpenTask={onOpenTask} /> : null}
        </div>
      </div>
      {showRunHistory ? <RunHistory runs={view.runs} /> : null}
    </div>
  );
}
