import { useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { BatchSegment, SegmentEvidenceSnapshot, SegmentTagContract } from "../data/workspace-client.ts";
import type { WorkspaceStore } from "../data/workspace-store.ts";
import { Button } from "../ui";
import { markAddedTokens, relocateDetectedTags, tokensFromDetectedTags } from "./cat-model.ts";

export interface MatchDockProps {
  store: WorkspaceStore;
  segmentId: string;
  /** Current canonical source of the selected segment (fuzzy diff baseline). */
  sourceText: string;
  /** Live draft buffer of the selected segment (diff + preview). */
  draftText: string;
  /** Server-owned tag contract of the selected segment (preview tab). */
  tagView?: SegmentTagContract;
  disabled?: boolean;
  onInsert(literal: string): void;
  /** Replace the whole draft with the matched target (exact-match primary action). */
  onReplace(literal: string): void;
}

type DockTab = "tm" | "termbase" | "glossary" | "preview";

const MIN_HEIGHT = 180;
const MAX_HEIGHT = 320;
const DEFAULT_HEIGHT = 224;

function clampHeight(value: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(value)));
}

const AUTHORITY_LABELS: Record<string, string> = {
  reviewed_tm: "已审校",
  working_tm: "工作 TM",
  client_tm: "客户 TM",
  imported_tm: "导入 TM",
  mt: "MT",
  unknown_tm: "未知来源",
};

const ORIGIN_LABELS: Record<string, string> = {
  reviewed: "已审校",
  client_tm: "客户 TM",
  mt: "MT",
  imported: "导入",
  unknown: "未知来源",
};

function tmOriginLabel(match: SegmentEvidenceSnapshot["tmMatches"][number]): string {
  if (match.effectiveAuthority) return AUTHORITY_LABELS[match.effectiveAuthority] ?? "未知来源";
  return ORIGIN_LABELS[match.origin] ?? "未知来源";
}

function scorePercent(score: number): string {
  const percent = score <= 1 ? score * 100 : score;
  return `${Math.round(percent)}%`;
}

function InsertButton({ disabled, onInsert }: { disabled?: boolean; onInsert(): void }) {
  return (
    <Button
      variant="ghost"
      size="small"
      disabled={disabled}
      // Keep the editor's focus and caret so the insertion lands at the caret.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onInsert}
    >
      插入
    </Button>
  );
}

/** Tokens in `candidate` that the baseline does not cover get a diff mark. */
function DiffText({ baseline, candidate, className, title }: {
  baseline: string;
  candidate: string;
  className?: string;
  title?: string;
}) {
  const marks = markAddedTokens(baseline, candidate);
  return (
    <div className={className} title={title ?? candidate}>
      {marks.map((part, index) => part.added
        ? <mark className="cat-match-diff" key={index}>{part.token}</mark>
        : <span key={index}>{part.token}</span>)}
    </div>
  );
}

function TmRow({ match, sourceText, draftText, disabled, onInsert, onReplace }: {
  match: SegmentEvidenceSnapshot["tmMatches"][number];
  sourceText: string;
  draftText: string;
  disabled?: boolean;
  onInsert(literal: string): void;
  onReplace(literal: string): void;
}) {
  const exact = match.matchType === "exact";
  return (
    <div className="cat-match-row">
      <span
        className="cat-match-score"
        data-kind={exact ? "exact" : "fuzzy"}
        aria-label={exact ? "精确匹配" : "模糊匹配"}
      >
        {scorePercent(match.score)}
      </span>
      <div className="cat-match-texts">
        <DiffText className="cat-match-source" baseline={sourceText} candidate={match.source} title={match.source} />
        <DiffText className="cat-match-target" baseline={draftText} candidate={match.target} title={match.target} />
      </div>
      <span className="cat-match-origin">{tmOriginLabel(match)}</span>
      <span className="cat-match-actions">
        <Button
          variant={exact ? "secondary" : "ghost"}
          size="small"
          disabled={disabled}
          title="用该命中整体替换当前译文"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onReplace(match.target)}
        >
          替换
        </Button>
        <InsertButton disabled={disabled} onInsert={() => onInsert(match.target)} />
      </span>
    </div>
  );
}

function TermRow({ match, disabled, onInsert }: {
  match: SegmentEvidenceSnapshot["termbaseMatches"][number];
  disabled?: boolean;
  onInsert(literal: string): void;
}) {
  return (
    <div className="cat-match-row">
      <div className="cat-match-texts">
        <div className="cat-match-target">
          {match.source}
          <span className="cat-match-term-arrow" aria-hidden="true"> → </span>
          {match.target}
        </div>
        {match.note ? <div className="cat-match-source" title={match.note}>{match.note}</div> : null}
      </div>
      {match.resolution === "conflict" ? (
        <span
          className="cat-match-flag"
          data-kind="conflict"
          title={match.conflictTargets?.length ? `冲突译法：${match.conflictTargets.join("、")}` : undefined}
        >
          冲突
        </span>
      ) : null}
      {match.resolution === "overridden" ? (
        <span
          className="cat-match-flag"
          data-kind="overridden"
          title={match.overriddenBy ? `已被「${match.overriddenBy}」覆盖` : undefined}
        >
          已被覆盖
        </span>
      ) : null}
      <InsertButton disabled={disabled} onInsert={() => onInsert(match.target)} />
    </div>
  );
}

function GlossaryRow({ match, disabled, onInsert }: {
  match: SegmentEvidenceSnapshot["glossaryMatches"][number];
  disabled?: boolean;
  onInsert(literal: string): void;
}) {
  return (
    <div className="cat-match-row">
      <div className="cat-match-texts">
        <div className="cat-match-target">
          {match.source}
          <span className="cat-match-term-arrow" aria-hidden="true"> → </span>
          {match.target}
        </div>
        {match.note ? <div className="cat-match-source" title={match.note}>{match.note}</div> : null}
      </div>
      <InsertButton disabled={disabled} onInsert={() => onInsert(match.target)} />
    </div>
  );
}

/** 字幕效果预览:tag 按格式还原,源文/译文各一张"屏幕"。 */
function PreviewPane({ segment, draftText, tagView }: {
  segment: BatchSegment | undefined;
  draftText: string;
  tagView?: SegmentTagContract;
}) {
  if (!segment) return <div className="cat-match-empty">选择一个句段查看预览</div>;
  const sourceTokens = tagView && tagView.source === segment.source ? tagView.text.tokens : null;
  const targetTags = tagView?.validation.targetTags ?? [];
  const targetTokens = tokensFromDetectedTags(draftText, relocateDetectedTags(draftText, targetTags));
  const strip = (tokens: Array<{ kind: string; value?: string }>) => tokens
    .filter((token) => token.kind === "text")
    .map((token) => token.value)
    .join("");
  const sourcePlain = sourceTokens ? strip(sourceTokens) : segment.source;
  const targetPlain = strip(targetTokens);
  const sourceTagCount = sourceTokens?.filter((token) => token.kind === "tag").length ?? 0;
  const targetTagCount = targetTokens.filter((token) => token.kind === "tag").length;
  return (
    <div className="cat-preview">
      <figure className="cat-preview__screen">
        <figcaption>源文 · {sourceTagCount ? `${sourceTagCount} 个 tag 已还原` : "无 tag"}</figcaption>
        <p>{sourcePlain || <span className="cat-preview__empty">（空）</span>}</p>
      </figure>
      <figure className="cat-preview__screen" data-tone="target">
        <figcaption>译文（当前草稿） · {targetTagCount ? `${targetTagCount} 个 tag 已还原` : "无 tag"}</figcaption>
        <p>{targetPlain || <span className="cat-preview__empty">尚未翻译</span>}</p>
      </figure>
    </div>
  );
}

const EMPTY_LABELS: Record<Exclude<DockTab, "preview">, string> = {
  tm: "该句段暂无 TM 匹配",
  termbase: "该句段暂无术语命中",
  glossary: "该句段暂无词汇命中",
};

export function MatchDock({ store, segmentId, sourceText, draftText, tagView, disabled, onInsert, onReplace }: MatchDockProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const evidence = state.segmentEvidence;
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [tab, setTab] = useState<DockTab>("tm");

  const scoped = evidence.scope?.segmentId === segmentId ? evidence : null;
  const snapshot = scoped?.status === "ready" ? scoped.snapshot : null;
  const segment = state.batch?.batch.segments.find((candidate) => candidate.id === segmentId);
  const counts = {
    tm: snapshot?.tmMatches.length ?? 0,
    termbase: snapshot?.termbaseMatches.length ?? 0,
    glossary: snapshot?.glossaryMatches.length ?? 0,
  };

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (move: PointerEvent): void => {
      setHeight(clampHeight(startHeight + (startY - move.clientY)));
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
  };

  const tabs: Array<{ id: DockTab; label: string; count: number | null }> = [
    { id: "tm", label: "TM 匹配", count: counts.tm },
    { id: "termbase", label: "术语", count: counts.termbase },
    { id: "glossary", label: "词汇", count: counts.glossary },
    { id: "preview", label: "预览", count: null },
  ];

  let body: ReactNode;
  if (tab === "preview") {
    body = <PreviewPane segment={segment} draftText={draftText} tagView={tagView} />;
  } else if (!scoped || scoped.status === "loading") {
    body = <div className="cat-match-empty" role="status">正在载入匹配…</div>;
  } else if (scoped.status === "error") {
    body = (
      <div className="cat-match-empty" role="alert">
        <span>匹配加载失败:{scoped.error}</span>
        <Button
          variant="ghost"
          size="small"
          onClick={() => void store.loadSegmentEvidence(scoped.scope.projectId, scoped.scope.batchId, scoped.scope.segmentId)}
        >
          重试
        </Button>
      </div>
    );
  } else if (!snapshot) {
    body = <div className="cat-match-empty">暂无匹配数据</div>;
  } else if (tab === "tm") {
    body = snapshot.tmMatches.length
      ? snapshot.tmMatches.map((match) => (
        <TmRow
          key={match.id}
          match={match}
          sourceText={sourceText}
          draftText={draftText}
          disabled={disabled}
          onInsert={onInsert}
          onReplace={onReplace}
        />
      ))
      : <div className="cat-match-empty">{EMPTY_LABELS.tm}</div>;
  } else if (tab === "termbase") {
    body = snapshot.termbaseMatches.length
      ? snapshot.termbaseMatches.map((match) => <TermRow key={match.id} match={match} disabled={disabled} onInsert={onInsert} />)
      : <div className="cat-match-empty">{EMPTY_LABELS.termbase}</div>;
  } else {
    body = snapshot.glossaryMatches.length
      ? snapshot.glossaryMatches.map((match) => <GlossaryRow key={match.id} match={match} disabled={disabled} onInsert={onInsert} />)
      : <div className="cat-match-empty">{EMPTY_LABELS.glossary}</div>;
  }

  return (
    <section
      className="cat-match-dock"
      aria-label="匹配面板"
      data-collapsed={collapsed || undefined}
      style={collapsed ? undefined : { height }}
    >
      {collapsed ? null : (
        <div
          className="cat-match-dock-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖拽调整匹配面板高度"
          onPointerDown={onResizeStart}
        />
      )}
      <header className="cat-match-dock-header">
        <div className="cat-match-dock-tabs" role="tablist" aria-label="匹配与术语">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              data-active={tab === item.id || undefined}
              className="cat-match-tab"
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.count === null ? null : <span className="cat-match-count">{item.count}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="cat-match-dock-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开匹配面板" : "折叠匹配面板"}
          title={collapsed ? "展开匹配面板" : "折叠匹配面板"}
          onClick={() => setCollapsed((current) => !current)}
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </header>
      {collapsed ? null : (
        <div className="cat-match-dock-body" role="tabpanel">
          {body}
        </div>
      )}
    </section>
  );
}
