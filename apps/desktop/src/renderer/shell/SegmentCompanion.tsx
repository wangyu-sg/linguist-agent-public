import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, ExternalLink, LoaderCircle, ScanSearch } from "lucide-react";
import type { TaskActivity, TaskArtifact } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { BatchSegment, StreamState } from "../data/workspace-client.ts";
import type { WorkspaceStore } from "../data/workspace-store.ts";
import { segmentNumber } from "../cat/cat-model.ts";
import { ConversationRow } from "../conversation/ConversationItems.tsx";
import { buildConversationItems, conversationItemsForSegment } from "../conversation/conversation-model.ts";
import "../conversation/conversation.css";
import {
  AgentComposer,
  ComposerAddDisclosure,
  ComposerAttachmentTray,
  ComposerRecipientChip,
  ContextUsageDisclosure,
  ModelDisclosure,
  useComposerData,
} from "../composer/index.ts";
import { Button, IconButton } from "../ui/index.ts";

interface SegmentCompanionProps {
  segment: BatchSegment | null;
  store: WorkspaceStore;
  onOpenHistory: () => void;
  onInspectSegment: (segment: BatchSegment) => void;
  onInspectActivity: (activity: TaskActivity) => void;
  onInspectArtifact: (artifact: TaskArtifact) => void;
}

export function SegmentCompanion({ segment, store, onOpenHistory, onInspectSegment, onInspectActivity, onInspectArtifact }: SegmentCompanionProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamCancel = useRef<(() => void) | null>(null);
  const project = state.projects.find((candidate) => candidate.projectId === state.projectId) ?? null;
  const taskId = state.task?.task.id ?? null;
  const composerData = useComposerData(project, taskId);
  const {
    routeSelection,
    selectedAssetPaths,
    selectedCapabilityIds,
    providerCatalog,
    providerState,
    sessionInfo,
    setRouteSelection,
    resetTransientSelections,
    refreshSession,
  } = composerData;
  const presentedRun = state.task?.runs.find((run) => run.id === state.task?.activeRunId)
    ?? state.task?.runs.at(-1)
    ?? null;
  const runIsActive = presentedRun?.status === "active" || presentedRun?.status === "pending";
  const items = useMemo(
    () => segment && state.task ? conversationItemsForSegment(buildConversationItems(state.task), segment.id) : [],
    [segment, state.task],
  );

  const send = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !segment || !state.task || sending || runIsActive) return;
    setDraft("");
    setSending(true);
    setError(null);
    try {
      streamCancel.current?.();
      streamCancel.current = store.sendChat(message, {
        segmentId: segment.id,
        ...(routeSelection.modelProvider && routeSelection.modelId ? {
          modelProvider: routeSelection.modelProvider,
          modelId: routeSelection.modelId,
        } : {}),
        ...(routeSelection.thinkingLevel ? { thinkingLevel: routeSelection.thinkingLevel } : {}),
        ...(selectedAssetPaths.length ? { assetPaths: selectedAssetPaths } : {}),
        ...(selectedCapabilityIds.length ? { capabilityIds: selectedCapabilityIds } : {}),
        onState: (streamState: StreamState) => {
          if (streamState.status === "closed") {
            setSending(false);
            streamCancel.current = null;
            void refreshSession();
          } else if (streamState.status === "error") {
            setSending(false);
            setDraft(message);
            setError(streamState.message ?? "问题没有发送。你的文字仍在这里。");
            streamCancel.current = null;
            void refreshSession();
          }
        },
      });
      resetTransientSelections();
    } catch (cause) {
      setSending(false);
      setDraft(message);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <aside className="segment-companion" aria-label="当前句段 Agent 伴随区">
      <header className="segment-companion__header">
        <div>
          <span>当前句段</span>
          <strong>{segment ? segmentNumber(segment) : "—"}</strong>
        </div>
        <div className="segment-companion__header-actions">
          {segment ? (
            <Button variant="ghost" onClick={() => onInspectSegment(segment)}>
              <ScanSearch aria-hidden="true" />
              上下文
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onOpenHistory}>
            <ExternalLink aria-hidden="true" />
            完整对话
          </Button>
        </div>
      </header>

      {segment ? (
        <>
          <div className="segment-companion__source">
            <span>源文</span>
            <p>{segment.source}</p>
          </div>
          <div className="segment-companion__history" aria-label="与当前句段相关的对话">
            {items.length ? (
              <ol className="segment-companion__timeline">
                {items.map((item) => (
                  <li key={item.id} className="task-conversation__item">
                    <ConversationRow
                      item={item}
                      store={store}
                      onInspectActivity={onInspectActivity}
                      onInspectArtifact={onInspectArtifact}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <div className="segment-companion__empty">
                <p>还没有与这个句段相关的对话。</p>
                <span>你可以询问语义、术语、标签或上下文;回答会保留在当前 Task 的完整历史中。</span>
              </div>
            )}
          </div>
          <div className="segment-companion__composer">
            <AgentComposer
              aria-label={`询问 Main Agent,句段 ${segment.index}`}
              inputLabel="询问 Main Agent"
              layoutLock="multiline"
              attachments={selectedAssetPaths.length ? <ComposerAttachmentTray paths={selectedAssetPaths} onRemove={composerData.removeAsset} /> : undefined}
              leadingControls={(
                <>
                  <ComposerAddDisclosure
                    assets={composerData.assetCatalog}
                    assetError={composerData.assetError}
                    assetState={composerData.assetState}
                    capabilityCatalog={composerData.capabilityCatalog}
                    capabilityState={composerData.capabilityState}
                    isImportingAssets={composerData.isImportingAssets}
                    onImportAssets={() => void composerData.importProjectAssets()}
                    onToggleAsset={composerData.toggleAsset}
                    onToggleCapability={composerData.toggleCapability}
                    selectedAssetPaths={selectedAssetPaths}
                    selectedCapabilityIds={selectedCapabilityIds}
                  />
                  <span className="segment-companion__scope" title={`当前句段 ${segmentNumber(segment)}`}>
                    段 {segmentNumber(segment)}
                  </span>
                  <ComposerRecipientChip recipient={null} threads={state.task?.agentThreads ?? []} />
                </>
              )}
              hint="⌘↩ 发送"
              errorMessage={error}
              statusMessage={runIsActive ? "当前 Run 正在处理，完成后才能继续发…" : sending ? "正在发送…" : null}
              onChange={setDraft}
              onKeyDown={onComposerKeyDown}
              onSubmit={send}
              placeholder="问这一句:语气贴不贴角色?术语对不对?"
              trailingControls={(
                <>
                  <ContextUsageDisclosure session={sessionInfo} taskUsage={state.task?.usage} />
                  <ModelDisclosure
                    disabled={providerState === "error"}
                    onChange={setRouteSelection}
                    providers={providerCatalog}
                    selection={routeSelection}
                  />
                  <IconButton
                    className="agent-composer__primary-action"
                    aria-label={sending ? "正在发送" : "发送"}
                    title={runIsActive ? "当前 Run 正在处理" : "发送(⌘↩)"}
                    type="submit"
                    disabled={!draft.trim() || sending || runIsActive}
                  >
                    {sending
                      ? <LoaderCircle className="conversation-composer__spin" aria-hidden="true" />
                      : <ArrowUp aria-hidden="true" />}
                  </IconButton>
                </>
              )}
              value={draft}
            />
          </div>
        </>
      ) : (
        <div className="segment-companion__empty"><p>选择一个句段查看上下文。</p></div>
      )}
    </aside>
  );
}
