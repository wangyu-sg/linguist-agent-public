import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type RefObject } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { Link2, Lock } from "lucide-react";
import {
  workspaceClient,
  type BatchSegment,
  type CatBatch,
  type SegmentRenderToken,
  type SegmentTagContract,
} from "../data/workspace-client.ts";
import { workspaceStore, type WorkspaceStore } from "../data/workspace-store.ts";
import { Button, StatusLabel } from "../ui";
import {
  adjacentSegmentId,
  batchSegmentStats,
  filterSegments,
  nextEditableSegmentId,
  segmentIssueCount,
  segmentNumber,
  tokensFromDetectedTags,
  wordCount,
} from "./cat-model.ts";
import { ChipEditor, type ChipEditorHandle } from "./ChipEditor.tsx";
import { MatchDock } from "./MatchDock.tsx";
import { guardDraftUnload, SegmentDraftController, type SegmentDraftSnapshot } from "./segment-draft.ts";
import "./cat.css";

export interface CatWorkspaceProps {
  store?: WorkspaceStore;
  focusedSegmentId?: string | null;
  onFocusedSegmentChange?: (segment: BatchSegment | null) => void;
}

type Selection = {
  segmentId: string;
  controller: SegmentDraftController;
};

function statusName(status: BatchSegment["status"]): string {
  if (status === "confirmed") return "已确认";
  if (status === "draft") return "草稿";
  return "新建";
}

function draftStatus(snapshot: SegmentDraftSnapshot): { label: string; state: "neutral" | "info" | "waiting" | "complete" | "failed" } {
  switch (snapshot.phase) {
    case "dirty": return { label: "未保存", state: "waiting" };
    case "saving": return { label: "正在保存", state: "info" };
    case "conflict": return { label: "版本冲突", state: "failed" };
    case "error": return { label: "保存失败", state: "failed" };
    default: return { label: "已保存", state: "complete" };
  }
}

function TagText({ text, tokens }: { text: string; tokens?: SegmentRenderToken[] }) {
  if (!tokens?.length) return <>{text || <span className="cat-empty-target">未翻译</span>}</>;
  return (
    <span className="cat-token-stream">
      {tokens.map((token, index) => token.kind === "text" ? token.value : (
        <span
          className="cat-tag-token"
          data-tone={token.tag.tone}
          title={token.tag.literal}
          key={`${token.tag.pairKey}:${token.tag.index}:${index}`}
        >
          {token.tag.label}
        </span>
      ))}
    </span>
  );
}

function targetTokens(segment: BatchSegment, tagView?: SegmentTagContract): SegmentRenderToken[] | undefined {
  if (!tagView || tagView.target !== segment.target) return undefined;
  return tokensFromDetectedTags(segment.target, tagView.validation.targetTags);
}

function SegmentBadges({ segment, duplicate }: { segment: BatchSegment; duplicate: boolean }) {
  const issueCount = segmentIssueCount(segment);
  return (
    <div className="cat-segment-badges" aria-label="句段状态">
      <span className="cat-state-badge" data-state={segment.status}>{statusName(segment.status)}</span>
      {segment.locked ? <span className="cat-state-badge" data-state="locked">锁定</span> : null}
      {duplicate ? <span className="cat-state-badge" data-state="duplicate">重复</span> : null}
      {issueCount ? <span className="cat-state-badge" data-state="qa">QA {issueCount}</span> : null}
    </div>
  );
}

interface SegmentRowProps {
  batch: CatBatch;
  navigationSegments: BatchSegment[];
  segment: BatchSegment;
  duplicate: boolean;
  selected: boolean;
  editing: boolean;
  draft: SegmentDraftSnapshot;
  counts: { source: number; target: number } | null;
  editorRef: RefObject<ChipEditorHandle | null>;
  pendingInsertRef: MutableRefObject<string | null>;
  virtualItem: VirtualItem;
  measureElement: (node: HTMLDivElement | null) => void;
  registerSelectedRow: (node: HTMLDivElement | null) => void;
  onSelect(segmentId: string, edit: boolean, focus: boolean): Promise<void>;
  onEdit(value: string): void;
  onCancel(): void;
  onConfirm(): Promise<void>;
  onFlush(): Promise<boolean>;
  onRetry(): Promise<void>;
  onUseServer(): void;
}

function SegmentRow({
  batch,
  navigationSegments,
  segment,
  duplicate,
  selected,
  editing,
  draft,
  counts,
  editorRef,
  pendingInsertRef,
  virtualItem,
  measureElement,
  registerSelectedRow,
  onSelect,
  onEdit,
  onCancel,
  onConfirm,
  onFlush,
  onRetry,
  onUseServer,
}: SegmentRowProps) {
  const tagView = batch.tagViews?.[segment.id];
  const sourceTokens = tagView?.source === segment.source ? tagView.text.tokens : undefined;
  const shownTarget = selected ? draft.canonical.target : segment.target;
  const shownSegment = selected ? draft.canonical : segment;
  return (
    <div
      ref={(node) => {
        measureElement(node);
        if (selected) registerSelectedRow(node);
      }}
      className="cat-segment-row"
      data-index={virtualItem.index}
      data-selected={selected || undefined}
      data-locked={shownSegment.locked || undefined}
      data-segment-id={segment.id}
      role="row"
      aria-rowindex={virtualItem.index + 2}
      aria-selected={selected}
      aria-label={`句段 ${segmentNumber(segment)}，${statusName(shownSegment.status)}${shownSegment.locked ? "，已锁定" : ""}`}
      tabIndex={selected ? 0 : -1}
      style={{ transform: `translateY(${virtualItem.start}px)` }}
      onClick={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("button, input, textarea, [contenteditable]")) return;
        void onSelect(segment.id, false, false);
      }}
      onDoubleClick={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("button, input, textarea, [contenteditable]")) return;
        if (!shownSegment.locked) void onSelect(segment.id, true, true);
      }}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return;
        if (event.target instanceof HTMLElement && event.target.closest("[contenteditable]")) return;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const delta = event.key === "ArrowUp" ? -1 : 1;
          const sibling = adjacentSegmentId(navigationSegments, segment.id, delta);
          if (sibling) void onSelect(sibling, false, true);
        } else if (event.key === "Enter" && !shownSegment.locked && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void onSelect(segment.id, true, false);
        }
      }}
    >
      <div className="cat-segment-number" role="rowheader">
        <span>{segmentNumber(segment)}</span>
        {shownSegment.locked ? (
          <span className="cat-segment-flag" data-kind="locked" title="锁定句段,不可编辑"><Lock aria-hidden="true" /></span>
        ) : null}
        {duplicate ? (
          <span className="cat-segment-flag" data-kind="duplicate" title={`重复句段,组内 ${segment.duplicateGroupSize ?? 2} 条`}><Link2 aria-hidden="true" /></span>
        ) : null}
      </div>
      <div className="cat-segment-cell cat-segment-source" role="gridcell">
        <TagText text={segment.source} tokens={sourceTokens} />
      </div>
      <div className="cat-segment-cell cat-segment-target" role="gridcell">
        {selected && editing && !shownSegment.locked ? (
          <ChipEditor
            ref={editorRef}
            value={draft.buffer}
            tagDefs={tagView?.validation.targetTags ?? []}
            ariaLabel={`编辑句段 ${segmentNumber(segment)} 的译文`}
            pendingInsertRef={pendingInsertRef}
            onChange={onEdit}
            onFlush={() => { void onFlush(); }}
            onCancel={onCancel}
            onConfirm={() => { void onConfirm(); }}
          />
        ) : (
          <TagText text={shownTarget} tokens={targetTokens(shownSegment, tagView)} />
        )}
        {selected && draft.phase === "conflict" ? (
          <div className="cat-write-notice" data-state="conflict" role="alert">
            <span>服务端版本已更新。本地修改仍然保留。</span>
            <div className="cat-write-notice-actions">
              <Button variant="ghost" onClick={onUseServer}>使用服务端</Button>
              <Button variant="secondary" onClick={() => void onRetry()}>保留本地并重试</Button>
            </div>
          </div>
        ) : null}
        {selected && draft.phase === "error" ? (
          <div className="cat-write-notice" data-state="error" role="alert">
            <span>{draft.error ?? "译文没有保存。本地修改仍然保留。"}</span>
            <div className="cat-write-notice-actions">
              <Button variant="ghost" onClick={onCancel}>放弃修改</Button>
              <Button variant="secondary" onClick={() => void onRetry()}>重试保存</Button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="cat-segment-status" role="gridcell">
        <SegmentBadges segment={shownSegment} duplicate={duplicate} />
        {selected && counts ? (
          <div className="cat-segment-counts" aria-label={`源文 ${counts.source} 词，译文 ${counts.target} 词`}>
            源 {counts.source} · 译 {counts.target}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyBatch() {
  return (
    <div className="cat-state" role="status">
      <h2>这个批次没有句段</h2>
      <p>重新导入有效的双语文件后，句段会完整显示在这里。</p>
    </div>
  );
}

function PopulatedCatWorkspace({
  batch,
  store,
  onFocusedSegmentChange,
  focusedSegmentId,
}: {
  batch: CatBatch;
  store: WorkspaceStore;
  onFocusedSegmentChange?: (segment: BatchSegment | null) => void;
  focusedSegmentId?: string | null;
}) {
  const projectId = batch.projectId;
  const batchId = batch.batchId;
  const makeController = (segment: BatchSegment) => new SegmentDraftController({
    segment,
    save: (input) => workspaceClient.saveSegment(projectId, batchId, segment.id, input),
    onCanonical: (canonical, batchUpdatedAt) => {
      store.applyCanonicalSegment(projectId, batchId, canonical, batchUpdatedAt);
      void workspaceClient.fetchSegmentTagContract(projectId, canonical.source, canonical.target)
        .then((contract) => store.applySegmentTagContract(
          projectId,
          batchId,
          canonical.id,
          canonical.updatedAt ?? null,
          contract,
        ))
        .catch(() => undefined);
    },
  });
  const [selection, setSelection] = useState<Selection>(() => {
    const segment = batch.segments[0]!;
    return { segmentId: segment.id, controller: makeController(segment) };
  });
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const draft = useSyncExternalStore(selection.controller.subscribe, selection.controller.getState, selection.controller.getState);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  const shouldFocusSelectedRow = useRef(false);
  const onFocusedSegmentChangeRef = useRef(onFocusedSegmentChange);
  const chipEditorRef = useRef<ChipEditorHandle | null>(null);
  const pendingInsertRef = useRef<string | null>(null);

  const matchingSegments = useMemo(() => filterSegments(batch.segments, deferredQuery), [batch.segments, deferredQuery]);
  const canonicalSelected = batch.segments.find((segment) => segment.id === selection.segmentId);
  const displaySegments = useMemo(() => {
    if (
      !canonicalSelected
      || matchingSegments.some((segment) => segment.id === canonicalSelected.id)
      || draft.phase === "clean"
    ) return matchingSegments;
    return [canonicalSelected, ...matchingSegments];
  }, [canonicalSelected, draft.phase, matchingSegments]);
  const duplicates = useMemo(
    () => new Set((batch.duplicateSourceGroups ?? []).flatMap((group) => group.segmentIds)),
    [batch.duplicateSourceGroups],
  );
  const selectedTagView = batch.tagViews?.[selection.segmentId];
  const selectedCounts = useMemo(() => ({
    source: wordCount(
      draft.canonical.source,
      selectedTagView?.source === draft.canonical.source ? selectedTagView.text.tags : undefined,
    ),
    target: wordCount(draft.buffer, selectedTagView?.validation.targetTags),
  }), [draft.buffer, draft.canonical.source, selectedTagView]);
  const batchStats = useMemo(
    () => batchSegmentStats(batch.segments, batch.tagViews, {
      id: selection.segmentId,
      status: draft.canonical.status,
      target: draft.buffer,
    }),
    [batch.segments, batch.tagViews, selection.segmentId, draft.canonical.status, draft.buffer],
  );
  const positionIndex = useMemo(
    () => batch.segments.findIndex((segment) => segment.id === selection.segmentId),
    [batch.segments, selection.segmentId],
  );
  const confirmedCount = useMemo(
    () => batch.segments.reduce(
      (count, segment) => count + (segment.id === selection.segmentId
        ? (draft.canonical.status === "confirmed" ? 1 : 0)
        : (segment.status === "confirmed" ? 1 : 0)),
      0,
    ),
    [batch.segments, draft.canonical.status, selection.segmentId],
  );
  const virtualizer = useVirtualizer({
    count: displaySegments.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => displaySegments[index]?.id ?? index,
    estimateSize: () => 76,
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const controller = selection.controller;
    const removeScopeGuard = store.setBeforeScopeTransition(() => controller.flush(false));
    const beforeUnload = (event: BeforeUnloadEvent) => guardDraftUnload(controller, event);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      removeScopeGuard();
      window.removeEventListener("beforeunload", beforeUnload);
      void controller.flush(false).finally(() => controller.dispose());
    };
  }, [selection.controller, store]);

  useEffect(() => {
    onFocusedSegmentChangeRef.current = onFocusedSegmentChange;
  }, [onFocusedSegmentChange]);

  useEffect(() => {
    onFocusedSegmentChangeRef.current?.(batch.segments[0] ?? null);
    return () => onFocusedSegmentChangeRef.current?.(null);
  }, []);

  useEffect(() => {
    void store.loadSegmentEvidence(projectId, batchId, selection.segmentId);
  }, [batchId, projectId, selection.segmentId, store]);

  useEffect(() => {
    if (!focusedSegmentId || focusedSegmentId === selection.segmentId) return;
    if (batch.segments.some((segment) => segment.id === focusedSegmentId)) {
      void selectSegment(focusedSegmentId, false, true);
    }
  }, [batch.segments, focusedSegmentId, selection.segmentId]);

  useEffect(() => {
    if (canonicalSelected) selection.controller.syncCanonical(canonicalSelected, batch.updatedAt);
  }, [batch.updatedAt, canonicalSelected, selection.controller]);

  useEffect(() => {
    const index = displaySegments.findIndex((segment) => segment.id === selection.segmentId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [displaySegments, selection.segmentId, virtualizer]);

  const registerSelectedRow = (node: HTMLDivElement | null) => {
    selectedRowRef.current = node;
    if (node && shouldFocusSelectedRow.current) {
      shouldFocusSelectedRow.current = false;
      node.focus({ preventScroll: true });
    }
  };

  const selectSegment = async (segmentId: string, edit: boolean, focus: boolean): Promise<void> => {
    if (segmentId === selection.segmentId) {
      setEditing(edit && !draft.canonical.locked);
      if (focus && !edit) selectedRowRef.current?.focus({ preventScroll: true });
      return;
    }
    const saved = await selection.controller.flush(false);
    if (!saved) return;
    const next = batch.segments.find((segment) => segment.id === segmentId);
    if (!next) return;
    const visibleIndex = displaySegments.findIndex((segment) => segment.id === segmentId);
    if (visibleIndex >= 0) virtualizer.scrollToIndex(visibleIndex, { align: "auto" });
    shouldFocusSelectedRow.current = focus && !edit;
    setEditing(edit && !next.locked);
    setSelection({ segmentId, controller: makeController(next) });
    onFocusedSegmentChangeRef.current?.(next);
  };

  useEffect(() => {
    if (matchingSegments.length && !matchingSegments.some((segment) => segment.id === selection.segmentId)) {
      void selectSegment(matchingSegments[0]!.id, false, false);
    }
  }, [matchingSegments, selection.segmentId]);

  const confirmAndAdvance = async (): Promise<void> => {
    const confirmed = await selection.controller.flush(true);
    if (!confirmed) return;
    const settled = selection.controller.getState();
    if (
      settled.phase !== "clean"
      || settled.canonical.status !== "confirmed"
      || settled.buffer !== settled.canonical.target
    ) return;
    const nextId = nextEditableSegmentId(displaySegments, selection.segmentId);
    if (nextId) await selectSegment(nextId, true, false);
    else setEditing(false);
  };

  const cancelEditing = () => {
    selection.controller.cancel();
    setEditing(false);
    shouldFocusSelectedRow.current = true;
    selectedRowRef.current?.focus({ preventScroll: true });
  };

  const insertMatchText = (literal: string): void => {
    if (!literal || draft.canonical.locked) return;
    if (editing) {
      chipEditorRef.current?.insertText(literal);
      return;
    }
    pendingInsertRef.current = literal;
    setEditing(true);
  };

  const replaceDraftText = (literal: string): void => {
    if (!literal || draft.canonical.locked) return;
    selection.controller.edit(literal);
    if (!editing) setEditing(true);
  };

  const status = draftStatus(draft);
  const alreadyConfirmed = draft.phase === "clean"
    && draft.canonical.status === "confirmed"
    && draft.buffer === draft.canonical.target;
  return (
    <section className="cat-workspace" aria-label={`CAT 批次 ${batch.batchId}`}>
      <header className="cat-toolbar">
        <div className="cat-batch-title">
          <strong>{batch.batchId}</strong>
          <span>{batch.sourceLanguage} → {batch.targetLanguage}</span>
        </div>
        <label className="cat-search">
          <span className="la-sr-only">搜索源文、译文或句段 ID</span>
          <input
            type="search"
            value={query}
            placeholder="搜索源文、译文或 ID"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="cat-result-count" aria-live="polite">{matchingSegments.length} / {batch.segments.length}</span>
        <StatusLabel state={status.state} live>{status.label}</StatusLabel>
        <div className="cat-toolbar-actions">
          <Button
            variant="secondary"
            disabled={draft.canonical.locked || draft.phase === "saving" || draft.phase === "conflict"}
            onClick={() => setEditing(true)}
          >
            编辑
          </Button>
          <Button
            variant="primary"
            disabled={draft.canonical.locked || draft.phase === "conflict" || alreadyConfirmed}
            onClick={() => void confirmAndAdvance()}
          >
            确认并前进
          </Button>
        </div>
      </header>

      <div
        className="cat-grid"
        role="grid"
        aria-label="CAT 句段"
        aria-colcount={4}
        aria-rowcount={displaySegments.length + 1}
      >
        <div className="cat-grid-header" role="row" aria-rowindex={1}>
          <span role="columnheader">ID</span>
          <span role="columnheader">源文 {batch.sourceLanguage}</span>
          <span role="columnheader">译文 {batch.targetLanguage}</span>
          <span role="columnheader">状态</span>
        </div>

        {displaySegments.length ? (
          <div
            ref={scrollRef}
            className="cat-grid-scroll"
            role="rowgroup"
          >
            <div
              className="cat-grid-virtual-space"
              role="presentation"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualItems.map((virtualItem) => {
                const segment = displaySegments[virtualItem.index];
                if (!segment) return null;
                return (
                  <SegmentRow
                    key={virtualItem.key}
                    batch={batch}
                    navigationSegments={displaySegments}
                    segment={segment}
                    duplicate={duplicates.has(segment.id) || (segment.duplicateGroupSize ?? 1) > 1 || segment.duplicateRole === "first" || segment.duplicateRole === "repeat"}
                    selected={segment.id === selection.segmentId}
                    editing={editing && segment.id === selection.segmentId}
                    draft={draft}
                    counts={segment.id === selection.segmentId ? selectedCounts : null}
                    editorRef={chipEditorRef}
                    pendingInsertRef={pendingInsertRef}
                    virtualItem={virtualItem}
                    measureElement={virtualizer.measureElement}
                    registerSelectedRow={registerSelectedRow}
                    onSelect={selectSegment}
                    onEdit={(value) => selection.controller.edit(value)}
                    onCancel={cancelEditing}
                    onConfirm={confirmAndAdvance}
                    onFlush={() => selection.controller.flush(false)}
                    onRetry={async () => { await selection.controller.retry(); }}
                    onUseServer={() => selection.controller.useServer()}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <div className="cat-state cat-grid-empty" role="row" aria-rowindex={2}>
            <div role="gridcell" aria-colspan={4}>
              <h2>没有匹配的句段</h2>
              <p>搜索不会删除或截断历史。清空搜索即可恢复全部 {batch.segments.length} 条句段。</p>
            </div>
          </div>
        )}
      </div>

      <MatchDock
        store={store}
        segmentId={selection.segmentId}
        sourceText={draft.canonical.source}
        draftText={draft.buffer}
        tagView={selectedTagView}
        disabled={draft.canonical.locked}
        onInsert={insertMatchText}
        onReplace={replaceDraftText}
      />

      <footer className="cat-statusbar" aria-label="批次状态" data-complete={confirmedCount === batch.segments.length || undefined}>
        <span className="cat-statusbar__metric" aria-label={`已确认 ${confirmedCount} / ${batch.segments.length} 句段`}>
          <span className="cat-statusbar__label">已确认</span>
          <strong>{confirmedCount}<span className="cat-statusbar__total">/{batch.segments.length}</span></strong>
          <span className="cat-progress-track" aria-hidden="true">
            <span
              className="cat-progress-bar"
              style={{ width: `${(confirmedCount / Math.max(1, batch.segments.length)) * 100}%` }}
            />
          </span>
          {confirmedCount === batch.segments.length ? <span className="cat-statusbar__ready">就绪</span> : null}
        </span>
        <span
          className="cat-statusbar__metric"
          title="已确认句段的源文词数 / 批次总源文词数（tag 不计入）"
          aria-label={`词数 ${batchStats.confirmedSourceWords} / ${batchStats.sourceWords}`}
        >
          <span className="cat-statusbar__label">词数</span>
          <strong>
            {batchStats.confirmedSourceWords.toLocaleString()}
            <span className="cat-statusbar__total">/{batchStats.sourceWords.toLocaleString()}</span>
          </strong>
        </span>
        <span className="cat-statusbar__fact">草稿 {batchStats.draft}</span>
        <span className="cat-statusbar__fact">新建 {batchStats.fresh}</span>
        {batchStats.tagged ? <span className="cat-statusbar__fact">含 tag {batchStats.tagged}</span> : null}
        {batchStats.locked ? <span className="cat-statusbar__fact">锁定 {batchStats.locked}</span> : null}
        <span className="cat-statusbar__spacer" />
        <span className="cat-statusbar__shortcuts" aria-label="键盘快捷键">↑↓ 选择 · Return 编辑 · ⌘Return 确认 · Esc 放弃</span>
        <span className="cat-statusbar__position" aria-label={`句段位置 ${positionIndex + 1} / ${batch.segments.length}`}>
          段 {String(positionIndex + 1).padStart(3, "0")}<span className="cat-statusbar__total">/{batch.segments.length}</span>
        </span>
      </footer>
    </section>
  );
}

export function CatWorkspace({ store = workspaceStore, focusedSegmentId, onFocusedSegmentChange }: CatWorkspaceProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => {
    if (state.projectId && state.batchId && !state.batch && (state.batchState === "idle" || state.batchState === "ready")) {
      void store.ensureBatchLoaded();
    }
  }, [state.batch, state.batchId, state.batchState, state.projectId, store]);

  if (state.batchState === "loading" || (state.batchState !== "error" && state.batchId && !state.batch)) {
    return <div className="cat-state"><StatusLabel live>正在载入完整批次</StatusLabel></div>;
  }
  if (state.batchState === "error") {
    return (
      <div className="cat-state" role="alert">
        <h2>批次未能载入</h2>
        <p>{state.error ?? "请检查本地 runtime 后重试。"}</p>
        {state.projectId && state.batchId ? (
          <Button onClick={() => void store.ensureBatchLoaded()}>重新载入</Button>
        ) : null}
      </div>
    );
  }
  const batch = state.batch?.batch;
  if (!batch) {
    return (
      <div className="cat-state">
        <h2>选择一个批次</h2>
        <p>CAT 与对话共享同一个 Task scope。选择批次后，这里会显示全部句段。</p>
      </div>
    );
  }
  if (!batch.segments.length) return <EmptyBatch />;
  return (
    <PopulatedCatWorkspace
      key={`${batch.projectId}:${batch.batchId}`}
      batch={batch}
      store={store}
      focusedSegmentId={focusedSegmentId}
      onFocusedSegmentChange={onFocusedSegmentChange}
    />
  );
}
