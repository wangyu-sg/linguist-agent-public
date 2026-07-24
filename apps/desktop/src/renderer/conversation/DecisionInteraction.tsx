import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  TaskAgentThread,
  TaskDecision,
  TaskDecisionOption,
  TaskRun,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { DecisionInteractionInput, TaskDecisionInput } from "../data/workspace-client.ts";
import { Button, IconButton } from "../ui/index.ts";

type AnswerDraft = {
  selectedOptionIds: string[];
  responseText: string;
};

export interface DecisionInteractionProps {
  interactionId: string | null;
  decisions: TaskDecision[];
  requester?: TaskAgentThread;
  onCommit: (interactionId: string, input: DecisionInteractionInput) => Promise<void>;
}

function selectedIds(decision: TaskDecision): string[] {
  if (decision.selectedOptionIds?.length) return decision.selectedOptionIds;
  return decision.selectedOptionId ? [decision.selectedOptionId] : [];
}

function initialDraft(decision: TaskDecision): AnswerDraft {
  return {
    selectedOptionIds: selectedIds(decision),
    responseText: decision.responseText ?? "",
  };
}

function optionLabel(decision: TaskDecision, optionId: string): string {
  return decision.options.find((option) => option.id === optionId)?.label ?? optionId;
}

function hasFreeformOption(decision: TaskDecision): boolean {
  return decision.selectionMode === "freeform" || decision.options.some((option) => option.id === "freeform");
}

function answerIsValid(decision: TaskDecision, draft: AnswerDraft): boolean {
  const mode = decision.selectionMode ?? "single";
  if (mode === "freeform") return draft.responseText.trim().length > 0;
  if (draft.selectedOptionIds.length === 0) return false;
  if (draft.selectedOptionIds.includes("freeform")) return draft.responseText.trim().length > 0;
  return true;
}

function resolvedAnswer(decision: TaskDecision): string[] {
  const values = selectedIds(decision).map((id) => optionLabel(decision, id));
  if (decision.responseText?.trim()) values.push(decision.responseText.trim());
  return values;
}

function OptionPreview({ option }: { option: TaskDecisionOption }) {
  if (!option.preview) return null;
  return (
    <details className="decision-option__preview">
      <summary>预览</summary>
      <p>{option.preview}</p>
    </details>
  );
}

const actionLabels: Record<TaskDecisionOption["action"], string> = {
  answer: "提交回答",
  approve: "批准",
  reject: "拒绝",
  request_change: "请求修改",
  waive: "接受风险",
  apply: "应用到 CAT",
  authorize_delivery: "授权交付",
};

function decisionScopeLabel(decision: TaskDecision): string {
  if (decision.scope.kind === "standalone") return "此 Chat 的已授权工作区";
  const segments = decision.scope.segmentIds.length ? ` · ${decision.scope.segmentIds.join("、")}` : "";
  return `${decision.scope.batchId ?? "项目范围"}${segments}`;
}

/** Presentation only: all values are issued by the canonical server Decision. */
function DecisionBindingFacts({ decision }: { decision: TaskDecision }) {
  const binding = decision.decisionBinding;
  if (!binding) {
    return <p className="decision-binding-facts__blocked">这条历史决定缺少服务器执行绑定，需由服务器重新创建。</p>;
  }
  return (
    <dl className="decision-binding-facts">
      <div><dt>影响范围</dt><dd>{decisionScopeLabel(decision)}</dd></div>
      <div><dt>内容摘要</dt><dd><code>{binding.contentHash}</code></dd></div>
      <div><dt>计划摘要</dt><dd><code>{binding.planHash}</code></dd></div>
      <div><dt>有效至</dt><dd><time dateTime={binding.expiresAt}>{binding.expiresAt}</time></dd></div>
    </dl>
  );
}

export interface CanonicalDecisionProps {
  decision: TaskDecision;
  run?: TaskRun;
  participantCount: number;
  requester?: TaskAgentThread;
  onCommit: (decisionId: string, input: TaskDecisionInput) => Promise<void>;
  onRunTeam: (
    workflowId: string,
    options?: { forceAllRoles?: boolean; changeDecision?: { decisionId: string; optionId: string; reason: string } },
  ) => Promise<void>;
}

export function CanonicalDecision({
  decision,
  run,
  participantCount,
  requester,
  onCommit,
  onRunTeam,
}: CanonicalDecisionProps) {
  const [selectedOptionId, setSelectedOptionId] = useState(decision.selectedOptionId ?? "");
  const [reason, setReason] = useState(decision.reason ?? "");
  const [changingTeamPlan, setChangingTeamPlan] = useState(false);
  const [busy, setBusy] = useState<"decision" | "team" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedOption = decision.options.find((option) => option.id === selectedOptionId);
  const teamStartOption = decision.options.find((option) => option.action === "approve");
  const teamChangeOption = decision.options.find((option) => option.action === "request_change");
  const isTeamPreflight = decision.kind === "approval" && run?.mode === "team" && Boolean(run.planHash) && Boolean(teamStartOption);
  const canExecute = Boolean(decision.decisionBinding);

  const commit = async () => {
    if (!selectedOption || !reason.trim()) return;
    setBusy("decision");
    setError(null);
    try {
      await onCommit(decision.id, { optionId: selectedOption.id, reason: reason.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const runTeam = async (forceAllRoles = false) => {
    if (!run) return;
    if (forceAllRoles && (!teamChangeOption || !reason.trim())) return;
    setBusy("team");
    setError(null);
    try {
      await onRunTeam(run.id, forceAllRoles ? {
        forceAllRoles: true,
        changeDecision: { decisionId: decision.id, optionId: teamChangeOption!.id, reason: reason.trim() },
      } : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  if (decision.status !== "required") {
    const resolved = resolvedAnswer(decision);
    return (
      <section className="decision-interaction" aria-labelledby={`decision-${decision.id}`}>
        <header className="decision-interaction__header">
          <div>
            <p className="decision-interaction__eyebrow">{requester?.identity.displayName ?? "Linguist Agent"} 的决定</p>
            <h3 id={`decision-${decision.id}`}>{decision.prompt}</h3>
          </div>
        </header>
        <DecisionBindingFacts decision={decision} />
        <div className="decision-question__resolution">
          <span className="decision-question__status">
            {decision.status === "recorded" ? "已记录" : decision.status === "cancelled" ? "已取消" : "已替代"}
          </span>
          {resolved.length ? <p>{resolved.join(" · ")}</p> : null}
          {decision.reason ? <p className="decision-question__reason">{decision.reason}</p> : null}
        </div>
      </section>
    );
  }

  if (isTeamPreflight) {
    const routes = [...new Set(Object.values(run?.modelRoutes ?? {}))];
    const canStart = run?.status === "awaiting_input" && canExecute;
    return (
      <section className="decision-interaction decision-interaction--team" aria-labelledby={`decision-${decision.id}`}>
        <header className="decision-interaction__header">
          <div>
            <p className="decision-interaction__eyebrow">Team 运行计划</p>
            <h3 id={`decision-${decision.id}`}>{decision.prompt}</h3>
          </div>
          <span className="decision-interaction__progress">{canStart ? "等待确认" : "当前不可启动"}</span>
        </header>
        <DecisionBindingFacts decision={decision} />
        <p className="decision-team__summary">
          已选择 {participantCount} 个专家与系统角色，预计 {run?.estimatedCalls ?? 0} 次模型调用
          {routes.length ? ` · ${routes.join(" · ")}` : ""}。CAT 写入仍需单独通过 proposal/apply gate。
        </p>
        {changingTeamPlan ? (
          <div className="decision-team__change">
            <p>当前服务端支持的明确调整是启用所有已配置角色。运行前会重新预检并校验最新 planHash。</p>
            <label className="decision-question__text-label">
              <span>调整理由（必填）</span>
              <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="为什么需要完整专家组？" autoFocus />
            </label>
          </div>
        ) : null}
        {error ? <p className="decision-interaction__error" role="alert">{error}</p> : null}
        <footer className="decision-interaction__actions">
          {teamChangeOption ? (
            <Button variant="ghost" disabled={busy !== null} onClick={() => { setChangingTeamPlan((current) => !current); setError(null); }}>
              {changingTeamPlan ? "取消调整" : "调整计划"}
            </Button>
          ) : null}
          <span className="decision-interaction__action-spacer" />
          {changingTeamPlan ? (
            <Button variant="primary" loading={busy === "team"} disabled={!reason.trim() || !canStart} onClick={() => void runTeam(true)}>
              启用全部角色并运行
            </Button>
          ) : (
            <Button variant="primary" loading={busy === "team"} disabled={!canStart} onClick={() => void runTeam(false)}>
              开始运行
            </Button>
          )}
        </footer>
      </section>
    );
  }

  return (
    <section className="decision-interaction" aria-labelledby={`decision-${decision.id}`}>
      <header className="decision-interaction__header">
        <div>
          <p className="decision-interaction__eyebrow">{requester?.identity.displayName ?? "Linguist Agent"} 需要你的决定</p>
          <h3 id={`decision-${decision.id}`}>{decision.prompt}</h3>
        </div>
      </header>
      <DecisionBindingFacts decision={decision} />
      <fieldset className="decision-question" disabled={busy !== null || !canExecute}>
        <legend className="la-sr-only">可选操作</legend>
        <div className="decision-question__options">
          {decision.options.map((option) => (
            <div key={option.id} className="decision-option" data-checked={selectedOptionId === option.id || undefined} data-destructive={option.destructive || undefined}>
              <label>
                <input type="radio" name={`decision-${decision.id}`} value={option.id} checked={selectedOptionId === option.id} onChange={() => { setSelectedOptionId(option.id); setError(null); }} />
                <span className="decision-option__copy">
                  <span className="decision-option__label">{option.label}</span>
                  {option.description ? <span className="decision-option__description">{option.description}</span> : null}
                </span>
              </label>
              <OptionPreview option={option} />
            </div>
          ))}
        </div>
        <label className="decision-question__text-label">
          <span>理由（必填）</span>
          <textarea rows={3} value={reason} onChange={(event) => { setReason(event.target.value); setError(null); }} placeholder="记录这次选择的依据…" />
        </label>
      </fieldset>
      {error ? <p className="decision-interaction__error" role="alert">{error}</p> : null}
      <footer className="decision-interaction__actions">
        <span className="decision-interaction__action-spacer" />
        <Button
          variant={selectedOption?.destructive ? "destructive" : "primary"}
          loading={busy === "decision"}
          disabled={!selectedOption || !reason.trim() || !canExecute}
          onClick={() => void commit()}
        >
          {selectedOption ? actionLabels[selectedOption.action] : "选择一个操作"}
        </Button>
      </footer>
    </section>
  );
}

export function DecisionInteraction({
  interactionId,
  decisions,
  requester,
  onCommit,
}: DecisionInteractionProps) {
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>(() => Object.fromEntries(
    decisions.map((decision) => [decision.id, initialDraft(decision)]),
  ));
  const [elaboratingDecisionId, setElaboratingDecisionId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"submit" | "elaborate" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(() => {
    const firstRequired = decisions.findIndex((decision) => decision.status === "required");
    return firstRequired >= 0 ? firstRequired : 0;
  });

  const required = useMemo(
    () => decisions.filter((decision) => decision.status === "required"),
    [decisions],
  );
  const answerable = interactionId !== null && decisions.filter((decision) => decision.status === "required").every((decision) => decision.decisionBinding);
  const validAnswers = required.flatMap((decision) => {
    const draft = drafts[decision.id] ?? initialDraft(decision);
    return answerIsValid(decision, draft)
      ? [{
          decisionId: decision.id,
          selectedOptionIds: draft.selectedOptionIds,
          responseText: draft.responseText.trim() || undefined,
        }]
      : [];
  });
  const resolvedCount = decisions.length - required.length;
  const activeDecision = decisions[activeQuestionIndex] ?? decisions[0];
  const activeDraft = activeDecision ? drafts[activeDecision.id] ?? initialDraft(activeDecision) : null;

  useEffect(() => {
    setActiveQuestionIndex((current) => {
      if (!decisions.length) return 0;
      const bounded = Math.min(current, decisions.length - 1);
      if (decisions[bounded]?.status === "required") return bounded;
      const firstRequired = decisions.findIndex((decision) => decision.status === "required");
      return firstRequired >= 0 ? firstRequired : bounded;
    });
  }, [decisions]);

  const updateDraft = (decisionId: string, update: (draft: AnswerDraft) => AnswerDraft) => {
    setDrafts((current) => ({
      ...current,
      [decisionId]: update(current[decisionId] ?? initialDraft(decisions.find((row) => row.id === decisionId)!)),
    }));
    setError(null);
  };

  const showQuestion = (index: number) => {
    setActiveQuestionIndex(Math.max(0, Math.min(index, decisions.length - 1)));
    setElaboratingDecisionId(null);
    setError(null);
  };

  const commit = async (action: "submit" | "elaborate" | "cancel") => {
    if (!interactionId) return;
    setBusyAction(action);
    setError(null);
    try {
      if (action === "cancel") {
        await onCommit(interactionId, { action: "cancel", reason: "用户取消了这组问题" });
        return;
      }
      if (action === "elaborate") {
        const decision = required.find((row) => row.id === elaboratingDecisionId);
        if (!decision) return;
        const responseText = (drafts[decision.id]?.responseText ?? "").trim();
        if (!responseText) {
          setError("请先写下需要补充的说明。");
          return;
        }
        await onCommit(interactionId, {
          action: "elaborate",
          answers: [{ decisionId: decision.id, selectedOptionIds: ["freeform"], responseText }],
        });
        setElaboratingDecisionId(null);
        return;
      }
      if (validAnswers.length === 0) {
        setError("请至少回答一个问题。");
        return;
      }
      await onCommit(interactionId, { action: "submit", answers: validAnswers });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="decision-interaction" aria-labelledby={`decision-${activeDecision?.id ?? "interaction"}`}>
      <header className="decision-interaction__header">
        <div>
          <p className="decision-interaction__eyebrow">
            {requester?.identity.displayName ?? "Linguist Agent"} 需要你的决定
          </p>
          <h3 id={`decision-${activeDecision?.id ?? "interaction"}`}>
            {activeDecision?.prompt ?? "请确认下一步"}
          </h3>
        </div>
        {decisions.length > 1 ? (
          <div className="decision-interaction__navigation" aria-label={`问题 ${activeQuestionIndex + 1}，共 ${decisions.length} 个；已处理 ${resolvedCount} 个`}>
            <IconButton
              size="compact"
              aria-label="上一个问题"
              title="上一个问题"
              disabled={activeQuestionIndex === 0}
              onClick={() => showQuestion(activeQuestionIndex - 1)}
            ><ChevronLeft /></IconButton>
            <span className="decision-interaction__progress">{activeQuestionIndex + 1} / {decisions.length}</span>
            <IconButton
              size="compact"
              aria-label="下一个问题"
              title="下一个问题"
              disabled={activeQuestionIndex === decisions.length - 1}
              onClick={() => showQuestion(activeQuestionIndex + 1)}
            ><ChevronRight /></IconButton>
          </div>
        ) : null}
      </header>
      {activeDecision ? <DecisionBindingFacts decision={activeDecision} /> : null}

      <div className="decision-interaction__questions">
        {activeDecision && activeDraft ? (() => {
          const decision = activeDecision;
          const draft = activeDraft;
          const mode = decision.selectionMode ?? "single";
          const isRequired = decision.status === "required";
          const resolved = resolvedAnswer(decision);
          const isElaborating = elaboratingDecisionId === decision.id;
          return (
            <fieldset key={decision.id} className="decision-question" disabled={busyAction !== null || !answerable || !isRequired}>
              <legend className="la-sr-only">{decision.prompt}</legend>

              {!isRequired ? (
                <div className="decision-question__resolution">
                  <span className="decision-question__status">
                    {decision.status === "recorded" ? "已回答" : decision.status === "cancelled" ? "已取消" : "已替代"}
                  </span>
                  {resolved.length ? <p>{resolved.join(" · ")}</p> : null}
                  {decision.reason ? <p className="decision-question__reason">{decision.reason}</p> : null}
                </div>
              ) : mode === "freeform" ? (
                <label className="decision-question__text-label">
                  <span className="la-sr-only">回答</span>
                  <textarea
                    rows={3}
                    value={draft.responseText}
                    onChange={(event) => updateDraft(decision.id, (current) => ({ ...current, responseText: event.target.value }))}
                    placeholder="输入你的回答…"
                  />
                </label>
              ) : (
                <div className="decision-question__options">
                  {decision.options.map((option) => {
                    const checked = draft.selectedOptionIds.includes(option.id);
                    return (
                      <div key={option.id} className="decision-option" data-checked={checked || undefined} data-destructive={option.destructive || undefined}>
                        <label>
                          <input
                            type={mode === "multiple" ? "checkbox" : "radio"}
                            name={`decision-${decision.id}`}
                            value={option.id}
                            checked={checked}
                            onChange={(event) => updateDraft(decision.id, (current) => ({
                              ...current,
                              selectedOptionIds: mode === "multiple"
                                ? (event.target.checked
                                    ? [...current.selectedOptionIds, option.id]
                                    : current.selectedOptionIds.filter((id) => id !== option.id))
                                : [option.id],
                            }))}
                          />
                          <span className="decision-option__copy">
                            <span className="decision-option__label">{option.label}</span>
                            {option.description ? <span className="decision-option__description">{option.description}</span> : null}
                          </span>
                        </label>
                        <OptionPreview option={option} />
                      </div>
                    );
                  })}
                  {draft.selectedOptionIds.includes("freeform") ? (
                    <label className="decision-question__text-label">
                      <span>补充说明</span>
                      <textarea
                        rows={3}
                        value={draft.responseText}
                        onChange={(event) => updateDraft(decision.id, (current) => ({ ...current, responseText: event.target.value }))}
                        placeholder="说明你的选择…"
                      />
                    </label>
                  ) : null}
                </div>
              )}

              {answerable && isRequired && hasFreeformOption(decision) && mode !== "freeform" ? (
                <div className="decision-question__elaborate">
                  <Button
                    variant="ghost"
                    onClick={() => setElaboratingDecisionId(isElaborating ? null : decision.id)}
                  >
                    {isElaborating ? "返回选项" : "补充说明"}
                  </Button>
                  {isElaborating ? (
                    <label className="decision-question__text-label">
                      <span className="la-sr-only">补充说明</span>
                      <textarea
                        rows={3}
                        value={draft.responseText}
                        onChange={(event) => updateDraft(decision.id, (current) => ({ ...current, responseText: event.target.value }))}
                        placeholder="告诉 Agent 还应考虑什么…"
                        autoFocus
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </fieldset>
          );
        })() : null}
      </div>

      {!answerable && required.length ? (
        <p className="decision-interaction__legacy-note">这是一条历史授权记录或缺少服务器执行绑定；当前客户端不会把它伪装成可提交的交互。</p>
      ) : null}
      {error ? <p className="decision-interaction__error" role="alert">{error}</p> : null}
      {answerable && required.length ? (
        <footer className="decision-interaction__actions">
          <Button variant="ghost" disabled={busyAction !== null} onClick={() => void commit("cancel")}>取消请求</Button>
          <span className="decision-interaction__action-spacer" />
          {elaboratingDecisionId ? (
            <Button variant="primary" loading={busyAction === "elaborate"} onClick={() => void commit("elaborate")}>
              发送补充说明
            </Button>
          ) : (
            <Button variant="primary" loading={busyAction === "submit"} disabled={validAnswers.length === 0} onClick={() => void commit("submit")}>
              {validAnswers.length < required.length ? "发送已答" : "发送答案"}
            </Button>
          )}
        </footer>
      ) : null}
    </section>
  );
}
