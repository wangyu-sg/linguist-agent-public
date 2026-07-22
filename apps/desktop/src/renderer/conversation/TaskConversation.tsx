import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleStop,
  Copy,
  Ellipsis,
  GitBranch,
  LoaderCircle,
  ListFilter,
  Minimize2,
  Search,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  TaskActivity,
  TaskArtifact,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import { workspaceStore, type WorkspaceStore } from "../data/workspace-store.ts";
import {
  workspaceClient,
  type StreamState,
  type TaskMessageQueue,
  type TaskQueuedMessage,
} from "../data/workspace-client.ts";
import { Button, IconButton } from "../ui/index.ts";
import {
  buildConversationItems,
  filterConversationItems,
  type ConversationFilterKind,
} from "./conversation-model.ts";
import { resolvePersona } from "./personas.ts";
import {
  AgentComposer,
  ComposerAddDisclosure,
  ComposerAttachmentTray,
  ComposerRecipientChip,
  ComposerScopeDisclosure,
  ComposerSlashMenu,
  composerSlashCommands,
  ContextUsageDisclosure,
  deriveAgentComposerPresentation,
  filterComposerSlashCommands,
  ModelDisclosure,
  QueuedMessageList,
  slashQueryFromDraft,
  useComposerData,
  type ComposerSlashCommand,
} from "../composer/index.ts";
import { nextCommandIndex } from "../command/command-model.ts";
import {
  ConversationRow,
  LiveAgentReply,
  PendingHumanMessage,
  PermissionRequestItem,
  activityText,
  estimatedTimelineEntrySize,
  historyKindLabels,
  isAgentDocument,
  isHumanMessage,
  runStatusLabels,
  type LiveReply,
  type PendingMessage,
  type TimelineEntry,
} from "./ConversationItems.tsx";
import { liveReplyMatchesDurableActivity, reduceLiveStreamEvent, type LiveStreamEvent } from "./live-reply-model.ts";
import { CONVERSATION_BOTTOM_THRESHOLD_PX, conversationIsAtBottom } from "./conversation-scroll-model.ts";
import { MaintainerPanel } from "./MaintainerPanel.tsx";
import "./conversation.css";

export interface ConversationRecipient {
  threadId: string;
  displayName: string;
}

export interface SendMessageContext {
  projectId: string;
  taskId: string;
  segmentId?: string;
  recipient: ConversationRecipient;
  onEvent: (event: unknown) => void;
  onState: (state: StreamState) => void;
}

export interface TaskConversationProps {
  store?: WorkspaceStore;
  focusedSegmentId?: string | null;
  recipient?: ConversationRecipient | null;
  onCancelRecipient?: () => void;
  onInspectArtifact?: (artifact: TaskArtifact) => void;
  onInspectActivity?: (activity: TaskActivity) => void;
  onOpenSettings?: () => void;
  onSendMessage?: (message: string, context: SendMessageContext) => () => void;
}


type StreamPayload = LiveStreamEvent & {
  permissionRequest?: unknown;
  messageQueue?: TaskMessageQueue;
};

let pendingSequence = 0;

/* ---------- 空态 Hero(Codex spec 04 §8):轮换中文标题 + 错峰入场的建议卡 ---------- */

const EMPTY_HERO_LINES = [
  "随时可以开始。",
  "今天处理哪件事？",
  "在想什么？",
  "从哪儿开始？",
] as const;

type HeroSuggestion = {
  id: string;
  title: string;
  body: string;
  prompt: string;
};

const PROJECT_HERO_SUGGESTIONS: HeroSuggestion[] = [
  { id: "translate", title: "翻译句段", body: "保持术语与语气一致", prompt: "翻译当前 Batch 的待译句段，保持术语表一致。" },
  { id: "review", title: "审校译文", body: "逐条给出修改意见", prompt: "审校当前 Batch 的译文，标出需要修改的句段并说明理由。" },
  { id: "qa", title: "跑一次 QA", body: "漏译 · 占位符 · 长度", prompt: "对当前 Batch 跑一次 QA：检查漏译、术语、占位符和长度问题。" },
  { id: "delivery", title: "准备交付", body: "评估准备度并导出", prompt: "评估当前 Batch 的交付准备度，并给出交付导出建议。" },
];

const STANDALONE_HERO_SUGGESTIONS: HeroSuggestion[] = [
  { id: "translate-text", title: "翻译一段文本", body: "贴入原文即译", prompt: "帮我翻译这段文本：" },
  { id: "polish", title: "润色文案", body: "更自然的表达", prompt: "帮我润色这段文案，让表达更自然：" },
  { id: "glossary", title: "起草术语表", body: "从样本文本提取", prompt: "从这段文本里提取关键术语并起草一份术语表：" },
  { id: "compare", title: "对比译法", body: "候选方案与取舍", prompt: "给这句话提供几种译法并说明取舍：" },
];

function heroLineIndex(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return Math.abs(hash) % EMPTY_HERO_LINES.length;
}

function EmptyConversationHero({ standalone, seed, onPick }: {
  standalone: boolean;
  seed: string;
  onPick: (prompt: string) => void;
}) {
  const suggestions = standalone ? STANDALONE_HERO_SUGGESTIONS : PROJECT_HERO_SUGGESTIONS;
  return (
    <div className="conversation-hero">
      <h2 className="conversation-hero__title">{EMPTY_HERO_LINES[heroLineIndex(seed)]}</h2>
      <p className="conversation-hero__subtitle">{standalone
        ? "直接开始对话，或明确目标和预期结果。"
        : "Agent 会先确认目标和范围；只有你明确开始后，才会产生模型调用。"}</p>
      <div className="conversation-hero__suggestions">
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion.id}
            type="button"
            className="conversation-hero__suggestion"
            style={{ animationDelay: `${index * 25}ms` }}
            onClick={() => onPick(suggestion.prompt)}
          >
            <span className="conversation-hero__suggestion-title">{suggestion.title}</span>
            <span className="conversation-hero__suggestion-body">{suggestion.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


export function TaskConversation({
  store = workspaceStore,
  focusedSegmentId = null,
  recipient = null,
  onCancelRecipient,
  onInspectArtifact,
  onInspectActivity,
  onOpenSettings,
  onSendMessage,
}: TaskConversationProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const snapshot = state.task;
  const isStandalone = snapshot?.task.owner.kind === "standalone";
  const canonicalItems = useMemo(() => {
    if (!snapshot) return [];
    return buildConversationItems(snapshot);
  }, [snapshot]);
  const [historyToolsOpen, setHistoryToolsOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyKind, setHistoryKind] = useState<ConversationFilterKind>("all");
  const [historyThreadId, setHistoryThreadId] = useState("");
  const [historyRunId, setHistoryRunId] = useState("");
  const deferredHistoryQuery = useDeferredValue(historyQuery);
  const historyFilterActive = Boolean(historyQuery.trim() || historyKind !== "all" || historyThreadId || historyRunId);
  const items = useMemo(() => filterConversationItems(canonicalItems, {
    query: deferredHistoryQuery,
    kind: historyKind,
    threadId: historyThreadId || undefined,
    runId: historyRunId || undefined,
  }), [canonicalItems, deferredHistoryQuery, historyKind, historyRunId, historyThreadId]);
  const [draft, setDraft] = useState("");
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [liveReply, setLiveReply] = useState<LiveReply | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isDelivering, setIsDelivering] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [messageQueue, setMessageQueue] = useState<TaskMessageQueue | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [pausedSubmit, setPausedSubmit] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [liveDelivery, setLiveDelivery] = useState<"steer" | "follow_up">("steer");
  const [selectedBranchThreadId, setSelectedBranchThreadId] = useState("");
  const [branchAction, setBranchAction] = useState<"fork" | "copy" | "compact" | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashListId = useId();
  const modelDisclosureRef = useRef<HTMLDetailsElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [timelineReady, setTimelineReady] = useState(false);
  const setScrollerElement = useCallback((node: HTMLDivElement | null) => {
    scrollerRef.current = node;
    setTimelineReady(Boolean(node));
  }, []);
  const timelineEntries = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = items.map((item) => ({ id: item.id, kind: "canonical", item }));
    for (const request of state.permissionRequests) {
      entries.push({ id: `permission-${request.requestId}`, kind: "permission", request });
    }
    if (state.permissionState === "error" && state.permissionRequests.length === 0) {
      entries.push({ id: "permission-error", kind: "permission-error" });
    }
    for (const message of pendingMessages) {
      entries.push({ id: message.id, kind: "pending", message });
    }
    if (liveReply) entries.push({ id: "live-reply", kind: "live", reply: liveReply });
    return entries;
  }, [items, liveReply, pendingMessages, state.permissionRequests, state.permissionState]);
  const timelineVirtualizer = useVirtualizer({
    count: timelineEntries.length,
    getScrollElement: () => scrollerRef.current,
    getItemKey: (index) => timelineEntries[index]?.id ?? index,
    estimateSize: (index) => estimatedTimelineEntrySize(timelineEntries[index]),
    // Virtualized rows are absolutely positioned, so CSS padding alone cannot
    // create the Codex thread inset. Keep the first row clear of the sticky
    // history action through the virtualizer's own measured geometry.
    paddingStart: 32,
    paddingEnd: 48,
    overscan: 24,
    // TanStack Virtual owns bottom anchoring and measurement compensation.
    // A second ResizeObserver writing scrollTop races its internal geometry
    // and was the source of apparently random jumps during streaming.
    anchorTo: "end",
    followOnAppend: "auto",
    scrollEndThreshold: CONVERSATION_BOTTOM_THRESHOLD_PX,
  });
  const virtualTimelineItems = timelineVirtualizer.getVirtualItems();
  const streamCancelRef = useRef<(() => void) | null>(null);
  const pinnedToBottomRef = useRef(true);
  const forceScrollToEndRef = useRef(true);
  const entryCountRef = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const replyDeltaRef = useRef("");
  const replyFrameRef = useRef<number | null>(null);
  const project = state.projects.find((candidate) => candidate.projectId === state.projectId) ?? null;
  const {
    assetCatalog,
    assetState,
    assetError,
    selectedAssetPaths,
    isImportingAssets,
    capabilityCatalog,
    capabilityState,
    selectedCapabilityIds,
    providerCatalog,
    providerState,
    sessionInfo,
    routeSelection,
    setRouteSelection,
    toggleAsset,
    toggleCapability,
    removeAsset,
    importProjectAssets,
    refreshSession,
    resetTransientSelections,
  } = useComposerData(project, snapshot?.task.id ?? null);

  const clearHistoryFilter = () => {
    setHistoryQuery("");
    setHistoryKind("all");
    setHistoryThreadId("");
    setHistoryRunId("");
  };

  // Persona 卡片整卡点击 → 复用现有 historyThreadId 过滤机制；再次点击恢复。
  const focusThread = useCallback((threadId: string) => {
    setHistoryToolsOpen(true);
    setHistoryThreadId((current) => (current === threadId ? "" : threadId));
  }, []);

  useEffect(() => {
    if (!recipient) return;
    resetTransientSelections();
  }, [recipient?.threadId]);

  const activeRun = snapshot?.runs.find((run) => run.id === snapshot.activeRunId)
    ?? snapshot?.runs.findLast((run) => run.stopAvailable);
  const presentedRun = activeRun ?? snapshot?.runs.at(-1) ?? null;
  const canStop = Boolean(activeRun?.stopAvailable && activeRun.status !== "stopping");
  const permissionDecisionDisabled = !activeRun?.stopAvailable;
  // A Main single Run has the same Pi delivery surface whether its Task owner
  // is standalone or Project. Project scope adds CAT authority, not a weaker
  // conversation transport.
  const supportsLiveDelivery = activeRun?.mode === "single" && activeRun.status === "active";
  const sendInFlight = supportsLiveDelivery ? isDelivering : isSending;
  const selectedTaskLocator = snapshot
    ? snapshot.task.owner.kind === "standalone"
      ? { kind: "standalone" as const, taskId: snapshot.task.id }
      : { kind: "project" as const, projectId: snapshot.task.owner.projectId, taskId: snapshot.task.id }
    : null;
  const projectName = state.projects.find((project) => project.projectId === state.projectId)?.name
    ?? (snapshot?.task.owner.kind === "standalone" ? "无项目 Chat" : state.projectId);
  const batchLabel = state.batch?.batch.batchId
    ?? (snapshot?.task.scope.kind === "project" ? snapshot.task.scope.batchId ?? null : null);
  const routeSelectionIncomplete = Boolean(routeSelection.modelProvider && !routeSelection.modelId);
  const sendDisabledReason = recipient && !onSendMessage
    ? "当前专家追问入口尚未连接，消息不会被静默发送给 Main Agent。"
    : routeSelectionIncomplete
      ? "已选择 Provider，请同时选择一个可用 Model。"
      : null;
  const composerPresentation = deriveAgentComposerPresentation({
    context: "task",
    // A live or locally pending turn is already a conversation. Treating it
    // as an empty Task left the first-turn hero visible above real messages
    // until the canonical projection caught up.
    hasHistory: timelineEntries.length > 0,
    isStandalone,
    focusedSegmentId,
    recipientName: recipient?.displayName,
    runStatus: presentedRun?.status ?? null,
    stopAvailable: canStop,
    hasDraft: Boolean(draft.trim()),
    activeDelivery: supportsLiveDelivery ? liveDelivery : null,
    isSending: sendInFlight,
    isStopping,
  });
  const branchThreads = useMemo(() => {
    if (!snapshot || snapshot.task.owner.kind !== "standalone") return [];
    const parents = new Set(snapshot.agentThreads.map((thread) => thread.parentThreadId).filter((id): id is string => Boolean(id)));
    return snapshot.agentThreads
      .filter((thread) => thread.piSessionFile && !parents.has(thread.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [snapshot]);
  const selectedBranchThread = branchThreads.find((thread) => thread.id === selectedBranchThreadId)
    ?? branchThreads[0]
    ?? null;

  useEffect(() => {
    setLiveDelivery("steer");
    setSelectedBranchThreadId("");
    setBranchAction(null);
    setPausedSubmit(null);
  }, [snapshot?.task.id]);

  useEffect(() => {
    if (!selectedTaskLocator) {
      setMessageQueue(null);
      return;
    }
    let active = true;
    setMessageQueue(null);
    void workspaceClient.fetchTaskMessageQueue(selectedTaskLocator).then((queue) => {
      if (active) setMessageQueue(queue);
    }).catch((cause) => {
      if (active) setComposerError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [selectedTaskLocator?.kind, selectedTaskLocator?.taskId, selectedTaskLocator?.kind === "project" ? selectedTaskLocator.projectId : null]);

  useEffect(() => {
    if (!messageQueue?.paused || messageQueue.messages.length === 0) setPausedSubmit(null);
  }, [messageQueue?.paused, messageQueue?.messages.length]);

  useEffect(() => {
    if (!selectedTaskLocator || !supportsLiveDelivery || queueBusy) return;
    let active = true;
    const refreshQueue = () => {
      void workspaceClient.fetchTaskMessageQueue(selectedTaskLocator).then((queue) => {
        if (!active) return;
        setMessageQueue((current) => !current || queue.updatedAt >= current.updatedAt ? queue : current);
      }).catch(() => undefined);
    };
    const timer = window.setInterval(refreshQueue, 1_250);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    queueBusy,
    selectedTaskLocator?.kind,
    selectedTaskLocator?.taskId,
    selectedTaskLocator?.kind === "project" ? selectedTaskLocator.projectId : null,
    supportsLiveDelivery,
  ]);

  useEffect(() => {
    if (!snapshot || pendingMessages.length === 0) return;
    const humanMessages = snapshot.activities.filter(isHumanMessage);
    setPendingMessages((current) => {
      const next = current.filter((pending) => !humanMessages.some((activity) => (
        activityText(activity) === pending.text && activity.createdAt >= pending.sentAt
      )));
      return next.length === current.length ? current : next;
    });
  }, [snapshot, pendingMessages.length]);

  useEffect(() => {
    if (!snapshot || !liveReply) return;
    const rootAgentThreadId = liveReply.runId
      ? snapshot.runs.find((run) => run.id === liveReply.runId)?.rootAgentThreadId ?? `${liveReply.runId}.main`
      : undefined;
    const durableReply = snapshot.activities.some((activity) => (
      isAgentDocument(activity)
      && liveReplyMatchesDurableActivity(liveReply, activity, rootAgentThreadId)
    ));
    if (durableReply) {
      replyDeltaRef.current = "";
      if (replyFrameRef.current !== null) cancelAnimationFrame(replyFrameRef.current);
      replyFrameRef.current = null;
      setLiveReply(null);
    }
  }, [snapshot, liveReply]);

  useEffect(() => () => {
    streamCancelRef.current?.();
    if (replyFrameRef.current !== null) cancelAnimationFrame(replyFrameRef.current);
  }, []);

  useEffect(() => {
    clearHistoryFilter();
    setHistoryToolsOpen(false);
  }, [snapshot?.task.id]);

  useEffect(() => {
    const count = timelineEntries.length;
    const delta = count - entryCountRef.current;
    if (!pinnedToBottomRef.current && delta > 0) setUnreadCount((current) => current + delta);
    entryCountRef.current = count;
    if (forceScrollToEndRef.current && timelineReady && count > 0) {
      forceScrollToEndRef.current = false;
      timelineVirtualizer.scrollToEnd({ behavior: "auto" });
    }
  }, [timelineEntries.length, timelineReady, timelineVirtualizer]);

  const jumpToLatest = () => {
    if (!scrollerRef.current) return;
    pinnedToBottomRef.current = true;
    setAtBottom(true);
    setUnreadCount(0);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timelineVirtualizer.scrollToEnd({ behavior: reduceMotion ? "auto" : "smooth" });
  };

  const flushReplyDelta = () => {
    replyFrameRef.current = null;
    const text = replyDeltaRef.current;
    replyDeltaRef.current = "";
    if (!text) return;
    setLiveReply((current) => {
      return reduceLiveStreamEvent(current, { type: "assistant_delta", text });
    });
  };

  const applyStreamEvent = (event: unknown, pendingId?: string, claimedQueueMessageId?: string) => {
    if (!event || typeof event !== "object") return;
    const payload = event as StreamPayload;
    if (payload.type === "queue_update" && payload.messageQueue) {
      setMessageQueue(payload.messageQueue);
      return;
    }
    if (payload.type === "permission_request" && payload.permissionRequest) {
      store.acceptPermissionRequest(payload.permissionRequest);
    } else if (payload.type === "turn_start") {
      if (claimedQueueMessageId && selectedTaskLocator) {
        void workspaceClient.deleteTaskQueuedMessage(selectedTaskLocator, claimedQueueMessageId)
          .then(setMessageQueue)
          .catch((cause) => setComposerError(cause instanceof Error ? cause.message : String(cause)));
      }
      replyDeltaRef.current = "";
      if (replyFrameRef.current !== null) cancelAnimationFrame(replyFrameRef.current);
      replyFrameRef.current = null;
      setLiveReply((current) => reduceLiveStreamEvent(current, payload));
    } else if (payload.type === "assistant_delta" && payload.text) {
      replyDeltaRef.current += payload.text;
      if (replyFrameRef.current === null) replyFrameRef.current = requestAnimationFrame(flushReplyDelta);
    } else if (payload.type === "assistant_thinking_started") {
      setLiveReply((current) => reduceLiveStreamEvent(current, payload));
    } else if (payload.type === "assistant_final") {
      if (replyFrameRef.current !== null) cancelAnimationFrame(replyFrameRef.current);
      flushReplyDelta();
      setLiveReply((current) => reduceLiveStreamEvent(current, payload));
    } else if (payload.type === "done") {
      // The standalone transport explicitly emits `done` before closing its
      // SSE response. Do not leave the Composer disabled while the network
      // close and canonical projection race each other.
      if (replyFrameRef.current !== null) cancelAnimationFrame(replyFrameRef.current);
      flushReplyDelta();
      setLiveReply((current) => reduceLiveStreamEvent(current, payload));
      setIsSending(false);
      // `done` acknowledges the stream, but it is not a canonical Task
      // projection. Keep the user's message in the thread until the
      // server-owned human Activity arrives; otherwise a successful first
      // turn visibly vanishes between the stream and the refresh.
      if (pendingId) {
        setPendingMessages((current) => current.map((message) => (
          message.id === pendingId && message.status === "sending" ? { ...message, status: "sent" } : message
        )));
      }
      streamCancelRef.current = null;
      void refreshSession();
    } else if (payload.type === "stopped") {
      if (replyFrameRef.current !== null) cancelAnimationFrame(replyFrameRef.current);
      flushReplyDelta();
      setLiveReply((current) => reduceLiveStreamEvent(current, payload));
      setIsSending(false);
    } else if (payload.type === "error") {
      if (replyFrameRef.current !== null) cancelAnimationFrame(replyFrameRef.current);
      flushReplyDelta();
      setLiveReply((current) => reduceLiveStreamEvent(current, payload));
      const error = payload.errorMessage ?? payload.text ?? "消息发送失败。";
      setIsSending(false);
      if (pendingId) {
        setPendingMessages((current) => current.map((message) => (
          message.id === pendingId ? { ...message, status: "failed", error } : message
        )));
      }
      setComposerError(error);
    }
  };

  const applyStreamState = (pendingId: string, streamState: StreamState, liveDeliveryRequest: boolean) => {
    if (streamState.status === "closed") {
      if (liveDeliveryRequest) setIsDelivering(false);
      else setIsSending(false);
      setPendingMessages((current) => current.map((message) => (
        message.id === pendingId && message.status === "sending" ? { ...message, status: "sent" } : message
      )));
      if (!liveDeliveryRequest) streamCancelRef.current = null;
      void refreshSession();
    } else if (streamState.status === "error") {
      const error = streamState.message ?? "消息发送失败。";
      if (liveDeliveryRequest) setIsDelivering(false);
      else setIsSending(false);
      setPendingMessages((current) => current.map((message) => (
        message.id === pendingId ? { ...message, status: "failed", error } : message
      )));
      if (!liveDeliveryRequest) {
        setLiveReply((current) => current ? { ...current, status: "failed", error } : current);
      }
      setComposerError(error);
      if (!liveDeliveryRequest) streamCancelRef.current = null;
      void refreshSession();
    }
  };

  const sendText = (
    rawText: string,
    claimedQueueMessageId?: string,
    deliveryOverride?: "steer" | "follow_up",
  ) => {
    if (!snapshot || sendInFlight || sendDisabledReason || isStopping) return;
    if (!recipient && activeRun && !supportsLiveDelivery) return;
    const text = rawText.trim();
    if (!text) return;
    const liveDeliveryRequest = Boolean(supportsLiveDelivery && !recipient);
    const requestedLiveDelivery = deliveryOverride ?? liveDelivery;
    const showPendingMessage = !liveDeliveryRequest || requestedLiveDelivery !== "follow_up";
    const pendingId = `pending-${Date.now()}-${++pendingSequence}`;
    const pending: PendingMessage = { id: pendingId, text, sentAt: new Date().toISOString(), status: "sending" };
    if (showPendingMessage) setPendingMessages((current) => [...current, pending]);
    setDraft("");
    setComposerError(null);
    if (liveDeliveryRequest) setIsDelivering(true);
    else setIsSending(true);
    pinnedToBottomRef.current = true;
    forceScrollToEndRef.current = true;
    setAtBottom(true);

    const onState = (streamState: StreamState) => applyStreamState(pendingId, streamState, liveDeliveryRequest);
    try {
      const cancel = recipient && onSendMessage && state.projectId
        ? onSendMessage(text, {
            projectId: state.projectId,
            taskId: snapshot.task.id,
            ...(focusedSegmentId ? { segmentId: focusedSegmentId } : {}),
            recipient,
            onEvent: (streamEvent) => applyStreamEvent(streamEvent, pendingId, claimedQueueMessageId),
            onState,
          })
        : store.sendChat(text, {
            ...(focusedSegmentId ? { segmentId: focusedSegmentId } : {}),
            // Model/effort are next-Run choices. Both standalone and Project
            // live delivery use the already-bound Pi session.
            ...(routeSelection.modelProvider && routeSelection.modelId && !recipient && !supportsLiveDelivery ? {
              modelProvider: routeSelection.modelProvider,
              modelId: routeSelection.modelId,
            } : {}),
            ...(routeSelection.thinkingLevel && !recipient && !supportsLiveDelivery ? { thinkingLevel: routeSelection.thinkingLevel } : {}),
            ...(selectedAssetPaths.length && !recipient ? { assetPaths: selectedAssetPaths } : {}),
            ...(selectedCapabilityIds.length && !recipient ? { capabilityIds: selectedCapabilityIds } : {}),
            ...(supportsLiveDelivery ? { delivery: requestedLiveDelivery } : {}),
            ...(snapshot.task.owner.kind === "standalone" && (activeRun?.rootAgentThreadId ?? selectedBranchThread?.id)
              ? { agentThreadId: activeRun?.rootAgentThreadId ?? selectedBranchThread!.id }
              : {}),
            onEvent: (streamEvent) => applyStreamEvent(streamEvent, pendingId, claimedQueueMessageId),
            onState,
          });
      if (!liveDeliveryRequest) streamCancelRef.current = cancel;
      if (!recipient) {
        resetTransientSelections();
      }
      if (recipient) onCancelRecipient?.();
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      if (liveDeliveryRequest) setIsDelivering(false);
      else setIsSending(false);
      setPendingMessages((current) => current.map((message) => (
        message.id === pendingId ? { ...message, status: "failed", error } : message
      )));
      setComposerError(error);
    }
  };

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (text && !recipient && messageQueue?.paused && messageQueue.messages.length > 0) {
      setPausedSubmit(text);
      return;
    }
    sendText(draft);
  };

  const stop = async () => {
    if (!canStop || isStopping) return;
    setIsStopping(true);
    setComposerError(null);
    try {
      await store.stopTask("user stop");
      streamCancelRef.current?.();
      streamCancelRef.current = null;
      setIsSending(false);
      setIsDelivering(false);
      setLiveReply((current) => current ? { ...current, status: "failed", error: "Agent run stopped." } : current);
      if (selectedTaskLocator) {
        void workspaceClient.fetchTaskMessageQueue(selectedTaskLocator).then(setMessageQueue).catch(() => undefined);
      }
    } catch (cause) {
      setComposerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsStopping(false);
    }
  };

  const runQueueAction = async (action: () => Promise<TaskMessageQueue>) => {
    if (queueBusy) return;
    setQueueBusy(true);
    setComposerError(null);
    try {
      setMessageQueue(await action());
    } catch (cause) {
      setComposerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setQueueBusy(false);
    }
  };

  const editQueuedMessage = (message: TaskQueuedMessage, text: string) => {
    if (!selectedTaskLocator) return;
    void runQueueAction(() => workspaceClient.editTaskQueuedMessage(selectedTaskLocator, message.id, text));
  };
  const deleteQueuedMessage = (message: TaskQueuedMessage) => {
    if (!selectedTaskLocator) return;
    void runQueueAction(() => workspaceClient.deleteTaskQueuedMessage(selectedTaskLocator, message.id));
  };
  const retryQueuedMessage = (message: TaskQueuedMessage) => {
    if (!selectedTaskLocator) return;
    if (!supportsLiveDelivery) {
      sendText(message.text, message.id);
      return;
    }
    void runQueueAction(() => workspaceClient.retryTaskQueuedMessage(selectedTaskLocator, message.id));
  };
  const steerQueuedMessage = (message: TaskQueuedMessage) => {
    if (!selectedTaskLocator) return;
    void runQueueAction(() => workspaceClient.steerTaskQueuedMessage(selectedTaskLocator, message.id));
  };
  const clearQueueAndSubmit = async () => {
    const text = pausedSubmit;
    if (!selectedTaskLocator || !text || queueBusy) return;
    setQueueBusy(true);
    setComposerError(null);
    try {
      const queue = await workspaceClient.clearTaskMessageQueue(selectedTaskLocator);
      setMessageQueue(queue);
      setPausedSubmit(null);
      setQueueBusy(false);
      sendText(text);
    } catch (cause) {
      setComposerError(cause instanceof Error ? cause.message : String(cause));
      setQueueBusy(false);
    }
  };
  const submitDespitePausedQueue = () => {
    const text = pausedSubmit;
    if (!text) return;
    setPausedSubmit(null);
    // An active Pi turn can accept the new instruction immediately while the
    // older follow-ups remain paused. With no active turn this starts a new Run
    // and preserves the old queue for explicit later action.
    sendText(text, undefined, supportsLiveDelivery ? "steer" : undefined);
  };

  const forkFromHere = async () => {
    if (!selectedBranchThread || branchAction || activeRun) return;
    setBranchAction("fork");
    setComposerError(null);
    try {
      const result = await store.forkChat({
        sourceThreadId: selectedBranchThread.id,
        entryId: selectedBranchThread.piEntryId,
        position: "at",
      });
      setSelectedBranchThreadId(result.threadId);
    } catch (cause) {
      setComposerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBranchAction(null);
    }
  };

  const copyAsNewChat = async () => {
    if (branchAction || activeRun) return;
    setBranchAction("copy");
    setComposerError(null);
    try {
      await store.copyChat({
        ...(selectedBranchThread?.latestActivityId ? { throughActivityId: selectedBranchThread.latestActivityId } : {}),
      });
    } catch (cause) {
      setComposerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBranchAction(null);
    }
  };

  const compactBranch = async () => {
    if (!selectedBranchThread || branchAction || activeRun) return;
    setBranchAction("compact");
    setComposerError(null);
    try {
      await store.compactChat(undefined, selectedBranchThread.id);
    } catch (cause) {
      setComposerError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBranchAction(null);
    }
  };

  const retry = (message: PendingMessage) => {
    setPendingMessages((current) => current.filter((candidate) => candidate.id !== message.id));
    setDraft(message.text);
    setComposerError(null);
    textareaRef.current?.focus();
  };

  /* ---------- Slash 命令菜单(Codex spec 03 §5.1):草稿以 "/" 开头触发 ---------- */

  const slashQuery = slashQueryFromDraft(draft);
  const slashCommands = useMemo<ComposerSlashCommand[]>(() => composerSlashCommands({
    canPickRoute: !recipient && providerState !== "error",
    canOpenSettings: Boolean(onOpenSettings),
    canStop,
    canCompact: Boolean(selectedBranchThread) && !activeRun && !branchAction,
    canFork: Boolean(selectedBranchThread) && !activeRun && !branchAction,
    canCopyChat: isStandalone && !activeRun && !branchAction,
    liveDelivery: supportsLiveDelivery ? liveDelivery : null,
    currentThinkingLevel: routeSelection.thinkingLevel,
    actions: {
      openModelPicker: () => {
        if (modelDisclosureRef.current) modelDisclosureRef.current.open = true;
      },
      openSettings: () => onOpenSettings?.(),
      stopRun: () => { void stop(); },
      compact: () => void compactBranch(),
      fork: () => void forkFromHere(),
      copyChat: () => void copyAsNewChat(),
      setDelivery: setLiveDelivery,
      setThinkingLevel: (level) => setRouteSelection({ ...routeSelection, thinkingLevel: level }),
    },
  }), [
    activeRun, branchAction, canStop, isStandalone, liveDelivery, onOpenSettings,
    providerState, recipient, routeSelection, selectedBranchThread, supportsLiveDelivery,
  ]);
  const slashFiltered = useMemo(
    () => (slashQuery === null ? [] : filterComposerSlashCommands(slashCommands, slashQuery)),
    [slashCommands, slashQuery],
  );
  const slashOpen = slashQuery !== null;
  const slashSelectedIndex = slashFiltered.length
    ? Math.min(slashIndex, slashFiltered.length - 1)
    : -1;

  const runSlashCommand = (command: ComposerSlashCommand) => {
    setDraft("");
    setSlashIndex(0);
    setComposerError(null);
    command.run();
    textareaRef.current?.focus();
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setSlashIndex((current) => nextCommandIndex(current, event.key, slashFiltered.length));
        return;
      }
      if (event.key === "Enter" && !event.metaKey) {
        event.preventDefault();
        const command = slashFiltered[slashSelectedIndex];
        if (command) runSlashCommand(command);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDraft("");
        setSlashIndex(0);
        return;
      }
    }
    if (event.key === "Enter" && event.metaKey) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape" && recipient && onCancelRecipient) {
      event.preventDefault();
      onCancelRecipient();
    } else if (event.key === "Escape" && canStop) {
      // spec 03 §7:stop 态内嵌 Esc kbd —— Esc 即停止当前 Run。
      event.preventDefault();
      void stop();
    }
  };

  if (state.taskState === "loading") {
    return <div className="task-conversation task-conversation--state" role="status"><span className="la-loading-shimmer">正在打开任务…</span></div>;
  }
  if (!snapshot) {
    return (
      <div className="task-conversation task-conversation--state">
        <h2>选择一个任务开始协作</h2>
        <p>对话、专家过程、决定和工作成果会汇入同一条完整历史。</p>
        {state.error ? <p className="task-conversation__state-error" role="alert">{state.error}</p> : null}
      </div>
    );
  }

  const generatingReply = liveReply?.status === "streaming" || activeRun?.status === "active";

  return (
    <section className="task-conversation" aria-label={`${snapshot.task.title} 对话`}>
      {isStandalone && (canonicalItems.length > 0 || branchThreads.length > 1) ? (
        <details className="conversation-context-menu">
          <summary aria-label="Chat 分支与上下文操作" title="Chat 分支与上下文操作"><Ellipsis aria-hidden="true" /></summary>
          <div className="conversation-context-menu__panel" aria-label="Chat 分支与上下文操作">
            <label className="conversation-context-menu__branch">
              <span>对话分支</span>
              <select
                value={selectedBranchThread?.id ?? ""}
                disabled={!branchThreads.length || Boolean(activeRun)}
                onChange={(event) => setSelectedBranchThreadId(event.target.value)}
              >
                {!branchThreads.length ? <option value="">尚无可恢复分支</option> : null}
                {branchThreads.map((thread, index) => (
                  <option key={thread.id} value={thread.id}>
                    {thread.branchPointEntryId ? `Branch ${branchThreads.length - index}` : "Current conversation"}
                  </option>
                ))}
              </select>
            </label>
            <div className="conversation-context-menu__actions">
              <Button variant="ghost" disabled={!selectedBranchThread || Boolean(activeRun) || Boolean(branchAction)} onClick={() => void forkFromHere()}>
                <GitBranch aria-hidden="true" /><span>{branchAction === "fork" ? "正在分支…" : "从这里分支"}</span>
              </Button>
              <Button variant="ghost" disabled={Boolean(activeRun) || Boolean(branchAction)} onClick={() => void copyAsNewChat()}>
                <Copy aria-hidden="true" /><span>{branchAction === "copy" ? "正在复制…" : "复制为新 Chat"}</span>
              </Button>
              <Button variant="ghost" disabled={!selectedBranchThread || Boolean(activeRun) || Boolean(branchAction)} onClick={() => void compactBranch()}>
                <Minimize2 aria-hidden="true" /><span>{branchAction === "compact" ? "正在压缩…" : "压缩上下文"}</span>
              </Button>
            </div>
            <MaintainerPanel
              taskId={snapshot.task.id}
              disabled={Boolean(activeRun)}
              onCanonicalUpdate={() => store.openChat(snapshot.task.id)}
            />
          </div>
        </details>
      ) : null}
      <div
        ref={setScrollerElement}
        className="task-conversation__scroller"
        onScroll={(event) => {
          const element = event.currentTarget;
          const pinned = conversationIsAtBottom(element);
          pinnedToBottomRef.current = pinned;
          setAtBottom((current) => (current === pinned ? current : pinned));
          if (pinned) setUnreadCount((current) => (current === 0 ? current : 0));
        }}
      >
        {canonicalItems.length ? (
          <div className="conversation-history-tools">
            <button
              type="button"
              className="conversation-history-tools__toggle"
              aria-expanded={historyToolsOpen}
              aria-controls="conversation-history-filters"
              onClick={() => setHistoryToolsOpen((open) => !open)}
            >
              <ListFilter aria-hidden="true" />
              <span>筛选历史</span>
              {historyFilterActive ? <span className="conversation-history-tools__count">{items.length} / {canonicalItems.length}</span> : null}
            </button>
            {historyToolsOpen ? (
              <div id="conversation-history-filters" className="conversation-history-tools__panel">
                <label className="conversation-history-tools__search">
                  <Search aria-hidden="true" />
                  <span className="la-sr-only">搜索任务历史</span>
                  <input
                    type="search"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      if (historyFilterActive) clearHistoryFilter();
                      else setHistoryToolsOpen(false);
                    }}
                    placeholder="搜索消息、证据、产物或句段…"
                  />
                </label>
                <label>
                  <span className="la-sr-only">按类型筛选</span>
                  <select value={historyKind} onChange={(event) => setHistoryKind(event.target.value as ConversationFilterKind)}>
                    {historyKindLabels.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span className="la-sr-only">按 Agent 筛选</span>
                  <select value={historyThreadId} onChange={(event) => setHistoryThreadId(event.target.value)}>
                    <option value="">全部 Agent</option>
                    {snapshot.agentThreads.map((thread) => {
                      const persona = resolvePersona(thread.identity);
                      return <option key={thread.id} value={thread.id}>{persona.personaName} · {persona.title}</option>;
                    })}
                  </select>
                </label>
                <label>
                  <span className="la-sr-only">按 Run 筛选</span>
                  <select value={historyRunId} onChange={(event) => setHistoryRunId(event.target.value)}>
                    <option value="">全部 Run</option>
                    {snapshot.runs.map((run, index) => (
                      <option key={run.id} value={run.id}>Run {index + 1} · {runStatusLabels[run.status]}</option>
                    ))}
                  </select>
                </label>
                <Button variant="ghost" disabled={!historyFilterActive} onClick={clearHistoryFilter}><X aria-hidden="true" />清除</Button>
              </div>
            ) : null}
            {historyFilterActive ? <p className="conversation-history-tools__summary" role="status">显示 {items.length} 条，共 {canonicalItems.length} 条完整历史</p> : null}
          </div>
        ) : null}
        <ol
          className="task-conversation__timeline"
          aria-label="任务完整历史"
          data-virtualized={timelineReady && canonicalItems.length > 0 && items.length > 0 ? "true" : undefined}
          data-complete-history-count={canonicalItems.length}
          data-total-items={canonicalItems.length > 0 && items.length > 0 ? timelineEntries.length : undefined}
          style={timelineReady && canonicalItems.length > 0 && items.length > 0 ? {
            height: `${timelineVirtualizer.getTotalSize()}px`,
            position: "relative",
          } : undefined}
        >
          {canonicalItems.length > 0 && !timelineReady ? (
            <li className="task-conversation__timeline-loading" role="status"><span className="la-loading-shimmer">正在载入完整历史…</span></li>
          ) : canonicalItems.length === 0 && timelineEntries.length === 0 ? (
            <li className="task-conversation__empty">
              <EmptyConversationHero
                standalone={isStandalone}
                seed={snapshot.task.id}
                onPick={(prompt) => {
                  setDraft(prompt);
                  textareaRef.current?.focus();
                }}
              />
            </li>
          ) : canonicalItems.length === 0 ? (
            <>
              {timelineEntries.map((entry) => (
                <li key={entry.id} className="task-conversation__item">
                  {entry.kind === "permission" ? (
                    <PermissionRequestItem
                      request={entry.request}
                      disabled={permissionDecisionDisabled}
                      onDecide={(requestId, decision, reason) => store.decidePermission(requestId, decision, reason)}
                    />
                  ) : entry.kind === "permission-error" ? (
                    <div className="conversation-permission conversation-permission--load-error" role="alert">
                      <p>{state.permissionError ?? "无法恢复待处理权限请求。"}</p>
                      <Button onClick={() => void store.refreshPermissionRequests()}>重试</Button>
                    </div>
                  ) : entry.kind === "pending" ? (
                    <PendingHumanMessage message={entry.message} onRetry={retry} />
                  ) : entry.kind === "live" ? (
                    <LiveAgentReply reply={entry.reply} />
                  ) : null}
                </li>
              ))}
            </>
          ) : items.length === 0 ? (
            <>
              <li className="task-conversation__filter-empty">
                <h2>没有匹配的历史</h2>
                <p>完整记录仍然保留；调整关键词或筛选条件即可重新显示。</p>
                <Button onClick={clearHistoryFilter}>清除筛选</Button>
              </li>
              {state.permissionRequests.map((request) => (
                <li key={`permission-${request.requestId}`} className="task-conversation__item">
                  <PermissionRequestItem
                    request={request}
                    disabled={permissionDecisionDisabled}
                    onDecide={(requestId, decision, reason) => store.decidePermission(requestId, decision, reason)}
                  />
                </li>
              ))}
              {state.permissionState === "error" && state.permissionRequests.length === 0 ? (
                <li className="task-conversation__item">
                  <div className="conversation-permission conversation-permission--load-error" role="alert">
                    <p>{state.permissionError ?? "无法恢复待处理权限请求。"}</p>
                    <Button onClick={() => void store.refreshPermissionRequests()}>重试</Button>
                  </div>
                </li>
              ) : null}
              {pendingMessages.map((message) => (
                <li key={message.id} className="task-conversation__item">
                  <PendingHumanMessage message={message} onRetry={retry} />
                </li>
              ))}
              {liveReply ? <li className="task-conversation__item"><LiveAgentReply reply={liveReply} /></li> : null}
            </>
          ) : virtualTimelineItems.map((virtualItem) => {
            const entry = timelineEntries[virtualItem.index];
            if (!entry) return null;
            return (
              <li
                key={virtualItem.key}
                ref={timelineVirtualizer.measureElement}
                data-index={virtualItem.index}
                className="task-conversation__item"
                aria-posinset={virtualItem.index + 1}
                aria-setsize={timelineEntries.length}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {entry.kind === "canonical" ? (
                  <ConversationRow
                    item={entry.item}
                    store={store}
                    focusedThreadId={entry.item.kind === "specialist" ? historyThreadId : ""}
                    forceOpenProcess={historyFilterActive}
                    onFocusThread={focusThread}
                    onInspectArtifact={onInspectArtifact}
                    onInspectActivity={onInspectActivity}
                  />
                ) : entry.kind === "permission" ? (
                  <PermissionRequestItem
                    request={entry.request}
                    disabled={permissionDecisionDisabled}
                    onDecide={(requestId, decision, reason) => store.decidePermission(requestId, decision, reason)}
                  />
                ) : entry.kind === "permission-error" ? (
                  <div className="conversation-permission conversation-permission--load-error" role="alert">
                    <p>{state.permissionError ?? "无法恢复待处理权限请求。"}</p>
                    <Button onClick={() => void store.refreshPermissionRequests()}>重试</Button>
                  </div>
                ) : entry.kind === "pending" ? (
                  <PendingHumanMessage message={entry.message} onRetry={retry} />
                ) : (
                  <LiveAgentReply reply={entry.reply} />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="conversation-composer-stack">
        {!atBottom ? (
          <button
            type="button"
            className="conversation-jump-latest"
            onClick={jumpToLatest}
            aria-label={unreadCount > 0 ? `回到最新，${unreadCount} 条新内容` : "回到最新"}
            title="回到最新"
          >
            {generatingReply ? (
              <span className="conversation-jump-latest__dots" aria-hidden="true"><i /><i /><i /></span>
            ) : (
              <ArrowDown aria-hidden="true" />
            )}
            {unreadCount > 0 ? <span className="conversation-jump-latest__badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
          </button>
        ) : null}
        <AgentComposer
          ref={textareaRef}
          className="task-agent-composer"
          aria-label="发送消息给 Linguist Agent"
          autoFocus={canonicalItems.length === 0}
          attachments={selectedAssetPaths.length ? <ComposerAttachmentTray paths={selectedAssetPaths} onRemove={removeAsset} /> : undefined}
          errorMessage={composerError}
          hint={composerPresentation.hint}
          inputLabel="消息"
          inputPopupActiveDescendant={slashOpen && slashSelectedIndex >= 0
            ? `${slashListId}-option-${slashFiltered[slashSelectedIndex]!.id}`
            : undefined}
          inputPopupControls={slashOpen ? slashListId : undefined}
          inputPopupExpanded={slashOpen ? true : undefined}
          layoutLock={composerPresentation.layoutLock}
          topTray={messageQueue?.messages.length ? (
            <QueuedMessageList
              activeRun={supportsLiveDelivery}
              busy={queueBusy || isDelivering || isStopping}
              queue={messageQueue}
              onClear={() => {
                setPausedSubmit(null);
                if (selectedTaskLocator) void runQueueAction(() => workspaceClient.clearTaskMessageQueue(selectedTaskLocator));
              }}
              onDelete={deleteQueuedMessage}
              onEdit={editQueuedMessage}
              onPause={() => {
                if (selectedTaskLocator) void runQueueAction(() => workspaceClient.pauseTaskMessageQueue(selectedTaskLocator));
              }}
              onReorder={(messageIds) => {
                if (selectedTaskLocator) void runQueueAction(() => workspaceClient.reorderTaskMessageQueue(selectedTaskLocator, messageIds));
              }}
              onResume={() => {
                if (selectedTaskLocator) void runQueueAction(() => workspaceClient.resumeTaskMessageQueue(selectedTaskLocator));
              }}
              onRetry={retryQueuedMessage}
              onSteer={steerQueuedMessage}
              pausedSubmitText={pausedSubmit}
              onCancelPausedSubmit={() => setPausedSubmit(null)}
              onClearAndSubmit={() => void clearQueueAndSubmit()}
              onSubmitDespitePause={submitDespitePausedQueue}
            />
          ) : undefined}
          leadingControls={(
            <div className="conversation-composer__primary-bound">
              {!isStandalone ? (
                <ComposerAddDisclosure
                  assets={assetCatalog}
                  assetError={assetError}
                  assetState={assetState}
                  capabilityCatalog={capabilityCatalog}
                  capabilityState={capabilityState}
                  disabled={Boolean(recipient)}
                  isImportingAssets={isImportingAssets}
                  onImportAssets={() => void importProjectAssets()}
                  onToggleAsset={toggleAsset}
                  onToggleCapability={toggleCapability}
                  selectedAssetPaths={selectedAssetPaths}
                  selectedCapabilityIds={selectedCapabilityIds}
                />
              ) : null}
              <ComposerScopeDisclosure
                projectName={projectName ?? "项目"}
                batchLabel={batchLabel}
                defaultRecipientLabel={isStandalone ? "Linguist Agent" : undefined}
                hasBatch={!isStandalone}
                hideProject={isStandalone}
                scopeLabel={isStandalone ? "当前 Chat" : undefined}
                taskLabel={isStandalone ? "Chat" : undefined}
                taskTitle={snapshot.task.title}
                focusedSegmentId={focusedSegmentId}
                recipient={recipient}
              />
              <ComposerRecipientChip
                recipient={recipient}
                threads={snapshot.agentThreads}
                onCancelRecipient={onCancelRecipient}
                showDefaultRecipient={!isStandalone}
              />
            </div>
          )}
          onChange={(value) => { setDraft(value); setSlashIndex(0); }}
          onKeyDown={onComposerKeyDown}
          onSubmit={send}
          overlay={slashOpen ? (
            <ComposerSlashMenu
              commands={slashFiltered}
              listId={slashListId}
              query={slashQuery ?? ""}
              selectedIndex={slashSelectedIndex}
              onRun={runSlashCommand}
              onSelectIndex={setSlashIndex}
            />
          ) : undefined}
          placeholder={composerPresentation.placeholder}
          statusMessage={sendDisabledReason}
          trailingControls={(
            <>
              {supportsLiveDelivery ? (
                <div className="conversation-composer__delivery" role="group" aria-label="当前 Run 消息投递方式">
                  <button
                    type="button"
                    aria-pressed={liveDelivery === "steer"}
                    disabled={isDelivering || isStopping}
                    title="立即调整当前 Pi turn"
                    onClick={() => setLiveDelivery("steer")}
                  >
                    现在调整
                  </button>
                  <button
                    type="button"
                    aria-pressed={liveDelivery === "follow_up"}
                    disabled={isDelivering || isStopping}
                    title="当前 turn 完成后执行"
                    onClick={() => setLiveDelivery("follow_up")}
                  >
                    完成后执行
                  </button>
                </div>
              ) : null}
              <ContextUsageDisclosure session={sessionInfo} taskUsage={snapshot.usage} />
              <ModelDisclosure
                detailsRef={modelDisclosureRef}
                disabled={Boolean(recipient) || providerState === "error"}
                onChange={setRouteSelection}
                onOpenSettings={onOpenSettings}
                providers={providerCatalog}
                selection={routeSelection}
              />
              {/* Codex spec 03 §2/§3 单按钮四态:Send / Stop(内嵌 Esc kbd)/ Queue / Steer */}
              <IconButton
                className="agent-composer__primary-action conversation-composer__send"
                data-send-state={composerPresentation.sendButton.state}
                aria-label={composerPresentation.sendButton.tooltip}
                title={composerPresentation.sendButton.tooltip}
                type={composerPresentation.sendButton.state === "stop" ? "button" : "submit"}
                disabled={slashOpen
                  || (composerPresentation.sendButton.state === "stop" ? false
                    : composerPresentation.sendButton.state === "stopping" || composerPresentation.sendButton.state === "sending" ? true
                    : isDelivering || !draft.trim() || !composerPresentation.canSend || Boolean(sendDisabledReason))}
                onClick={composerPresentation.sendButton.state === "stop" ? () => void stop() : undefined}
              >
                {composerPresentation.sendButton.state === "stop" ? (
                  <span className="agent-composer__send-stop" aria-hidden="true">
                    <CircleStop />
                    <kbd className="agent-composer__send-kbd">{composerPresentation.sendButton.kbd}</kbd>
                  </span>
                ) : composerPresentation.sendButton.state === "stopping" || composerPresentation.sendButton.state === "sending" ? (
                  <LoaderCircle className="conversation-composer__spin" aria-hidden="true" />
                ) : (
                  <ArrowUp aria-hidden="true" />
                )}
              </IconButton>
            </>
          )}
          value={draft}
          variant={canonicalItems.length === 0 ? "first-turn" : "default"}
        />
      </div>
    </section>
  );
}
