import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowUp } from "lucide-react";
import { workspaceStore, type WorkspaceState, type WorkspaceStore } from "../data/workspace-store.ts";
import { taskEventNotice } from "../data/task-events.ts";
import {
  AgentComposer,
  ComposerAssetControls,
  ComposerAttachmentTray,
  ComposerModelControls,
  ComposerRecipientChip,
  ComposerScopeDisclosure,
  useComposerData,
} from "../composer/index.ts";
import { Button, IconButton, PaneHeader, StatusLabel, type StatusState } from "../ui";
import { statusPresentation } from "./sidebar-task-state.ts";
import { WorkspaceSidebar } from "./WorkspaceSidebar.tsx";
import { canInstallOrRepairRuntime } from "./runtime-recovery.ts";
import { useWorkspaceScopeMemory } from "./useWorkspaceScopeMemory.ts";
import "./workspace.css";

const bootedStores = new WeakSet<WorkspaceStore>();

export interface WorkspaceTaskContentInput {
  state: WorkspaceState;
  store: WorkspaceStore;
}

export interface WorkspaceToolbarInput extends WorkspaceTaskContentInput {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

export interface WorkspaceProps {
  store?: WorkspaceStore;
  onCreateProject?: () => void;
  onCreateChat?: () => void;
  onImportBatch?: (projectId: string) => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onOpenLibrary?: () => void;
  settingsOpen?: boolean;
  renderSettings?: (input: WorkspaceTaskContentInput) => ReactNode;
  renderStart?: (input: WorkspaceTaskContentInput) => ReactNode;
  renderProject?: (input: WorkspaceTaskContentInput) => ReactNode;
  renderTask?: (input: WorkspaceTaskContentInput) => ReactNode;
  renderToolbar: (input: WorkspaceToolbarInput) => ReactNode;
  showTaskHeader?: boolean;
}

function initialSidebarOpen(): boolean {
  return typeof window === "undefined" || !window.matchMedia("(max-width: 1080px)").matches;
}

function projectName(state: WorkspaceState): string {
  return state.projects.find((project) => project.projectId === state.projectId)?.name ?? "当前项目";
}

function formatName(format: string): string {
  return ({
    phrase_mxliff: "Phrase MXLIFF",
    mqxliff: "memoQ XLIFF",
    sdlxliff: "SDLXLIFF",
    xliff_1_2: "XLIFF 1.2",
    xliff_2_0: "XLIFF 2.0",
    csv_paste: "CSV",
    xlsx_paste: "Excel",
  } as Record<string, string>)[format] ?? format;
}

function firstLineTitle(goal: string): string {
  const line = goal.trim().split(/\r?\n/, 1)[0] ?? goal.trim();
  return Array.from(line).slice(0, 48).join("");
}

function taskStatus(state: WorkspaceState): { label: string; tone: StatusState } {
  const presentation = state.task ? statusPresentation(state.task.task, state) : null;
  return presentation
    ? { label: presentation.label, tone: presentation.state }
    : { label: "就绪", tone: "neutral" };
}

function LoadingState({ label }: { label: string }) {
  return <div className="workspace-state"><StatusLabel live>{label}</StatusLabel></div>;
}

function ErrorState({ title, detail, onRetry }: { title: string; detail?: string | null; onRetry: () => void }) {
  return (
    <div className="workspace-state" role="alert">
      <h1>{title}</h1>
      {detail ? <p>{detail}</p> : null}
      <Button variant="secondary" onClick={onRetry}>重新载入</Button>
    </div>
  );
}

function RuntimeUnavailableState({ state, store }: { state: WorkspaceState; store: WorkspaceStore }) {
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const runtime = state.runtime!;
  const canInstall = canInstallOrRepairRuntime(runtime.status);

  const installOrRepair = async () => {
    if (installing || !canInstall) return;
    setInstalling(true);
    setResult(null);
    try {
      const outcome = await window.linguist.runtime.installOrRepair();
      setResult(outcome.message);
      if (outcome.ok) await store.boot();
    } catch {
      setResult("未能启动 runtime 修复。应用和项目数据没有发生变化。");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className="workspace-state" aria-labelledby="runtime-unavailable-title">
      <h1 id="runtime-unavailable-title">本机 runtime 暂不可用</h1>
      <p>{runtime.message}</p>
      <div className="workspace-state-actions">
        {canInstall ? (
          <Button variant="primary" disabled={installing} onClick={() => void installOrRepair()}>
            {installing ? "正在安装并验证…" : "安装或修复本机 runtime"}
          </Button>
        ) : null}
        <Button variant="secondary" disabled={installing} onClick={() => void store.boot()}>重新检查</Button>
      </div>
      <p className="workspace-state-note">
        {canInstall
          ? "只有点击后才会操作。安装使用应用内已校验的 runtime 包，并保留项目数据和历史备份；本机需要已有 Node.js，首次安装还需要联网下载锁定的依赖。"
          : "项目数据尚未载入。请确认登录钥匙串可用后重新检查；重新安装 runtime 不会绕过本机认证。"}
      </p>
      {result ? <p className="workspace-state-result" role="status" aria-live="polite">{result}</p> : null}
    </section>
  );
}

function StartState({ state, store, onCreateProject, onCreateChat }: {
  state: WorkspaceState;
  store: WorkspaceStore;
  onCreateProject?: () => void;
  onCreateChat?: () => void;
}) {
  const hasProjects = state.projects.length > 0;
  return (
    <section className="workspace-start" aria-labelledby="workspace-start-title">
      <div className="workspace-start-copy">
        <h1 id="workspace-start-title">{hasProjects ? "从最近的工作继续" : "开始一个对话"}</h1>
        <p>{hasProjects
          ? "直接开启无项目 Chat，或选择项目和批次继续本地化工作。"
          : "无项目 Chat 可以直接提问、研究和写作；需要处理文件时再创建本地化项目。"}</p>
        <div className="workspace-start-copy__actions">
          {onCreateChat ? <Button variant="primary" onClick={onCreateChat}>新建 Chat</Button> : null}
          {onCreateProject ? <Button variant="secondary" onClick={onCreateProject}>创建项目</Button> : null}
        </div>
      </div>
      {hasProjects ? (
        <div className="workspace-recents" aria-label="最近项目">
          <h2>最近项目</h2>
          <ul>
            {state.projects.slice(0, 6).map((project) => (
              <li key={project.projectId}>
                <button type="button" onClick={() => void store.selectProject(project.projectId)}>
                  <span>{project.name}</span>
                  <span>{project.batches.length} 批次</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ProjectState({ state, onImportBatch }: { state: WorkspaceState; onImportBatch?: (projectId: string) => void }) {
  const project = state.projects.find((candidate) => candidate.projectId === state.projectId);
  if (!project) return null;
  return (
    <section className="workspace-project" aria-labelledby="workspace-project-title">
      <h1 id="workspace-project-title">{project.name}</h1>
      <p>{project.batches.length
        ? "选择一个批次继续现有工作，或导入新的双语文件。"
        : "还没有批次。导入双语文件后，再向 Main Agent 说明目标。"}</p>
      <dl className="workspace-inline-facts">
        <div><dt>批次</dt><dd>{project.batches.length}</dd></div>
        <div><dt>资料</dt><dd>{project.assetCount}</dd></div>
      </dl>
      {onImportBatch ? <Button variant="primary" onClick={() => onImportBatch(project.projectId)}>导入批次</Button> : null}
    </section>
  );
}

function BatchReady({ state, store, actionError, setActionError, chatCancelRef }: {
  state: WorkspaceState;
  store: WorkspaceStore;
  actionError: string | null;
  setActionError: (value: string | null) => void;
  chatCancelRef: { current: (() => void) | null };
}) {
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const batch = state.batchSummary;
  const project = state.projects.find((candidate) => candidate.projectId === state.projectId) ?? null;
  const composerData = useComposerData(project, null);
  const {
    routeSelection,
    selectedAssetPaths,
    selectedCapabilityIds,
    providerCatalog,
    providerState,
    sessionInfo,
    setRouteSelection,
    resetTransientSelections,
  } = composerData;
  if (!batch || !state.projectId || !state.batchId) return null;

  const submit = async () => {
    const message = goal.trim();
    if (!message || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const snapshot = await store.createTask(state.projectId!, {
        title: firstLineTitle(message),
        intent: message,
        kind: "general",
        initialMessage: message,
        batchId: batch.batchId,
        sourceLocale: batch.sourceLanguage,
        targetLocale: batch.targetLanguage,
      });
      setGoal("");
      chatCancelRef.current?.();
      chatCancelRef.current = store.sendChat(message, {
        ...(snapshot.activeRunId ? { runId: snapshot.activeRunId } : {}),
        ...(routeSelection.modelProvider && routeSelection.modelId ? {
          modelProvider: routeSelection.modelProvider,
          modelId: routeSelection.modelId,
        } : {}),
        ...(routeSelection.thinkingLevel ? { thinkingLevel: routeSelection.thinkingLevel } : {}),
        ...(selectedAssetPaths.length ? { assetPaths: selectedAssetPaths } : {}),
        ...(selectedCapabilityIds.length ? { capabilityIds: selectedCapabilityIds } : {}),
        onState: (stream) => {
          if (stream.status === "closed" || stream.status === "error") chatCancelRef.current = null;
          if (stream.status === "error") setActionError(stream.message ?? "Main Agent 未能开始。消息已经保留在 Task 中。");
        },
      });
      resetTransientSelections();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="workspace-batch-ready" aria-labelledby="workspace-batch-title">
      <div className="workspace-scope-line">{projectName(state)} / {batch.batchId}</div>
      <h1 id="workspace-batch-title">批次已就绪</h1>
      <p>文件已导入，尚未启动 Agent。说明你想完成的结果后，Main Agent 才会开始工作。</p>
      <dl className="workspace-batch-facts">
        <div><dt>格式</dt><dd>{formatName(batch.format)}</dd></div>
        <div><dt>语言</dt><dd>{batch.sourceLanguage} → {batch.targetLanguage}</dd></div>
        <div><dt>句段</dt><dd>{batch.segments}</dd></div>
        <div><dt>状态</dt><dd>{batch.confirmed} 已确认，{batch.draft} 草稿，{batch.new} 新建{batch.locked ? `，${batch.locked} 锁定` : ""}</dd></div>
      </dl>
      <div className="workspace-goal">
        <h2 className="workspace-goal__label">你希望 Main Agent 完成什么？</h2>
        <AgentComposer
          aria-label="告诉 Main Agent 这个 Batch 要完成什么"
          autoFocus
          errorMessage={actionError}
          hint={submitting ? "正在创建 Task…" : "发送后创建 Task"}
          inputId="workspace-main-goal"
          inputLabel="Batch 目标"
          layoutLock="multiline"
          attachments={selectedAssetPaths.length ? <ComposerAttachmentTray paths={selectedAssetPaths} onRemove={composerData.removeAsset} /> : undefined}
          leadingControls={(
            <>
              <ComposerAssetControls data={composerData} />
              <ComposerScopeDisclosure
                projectName={projectName(state)}
                batchLabel={batch.batchId}
                taskTitle={null}
                focusedSegmentId={null}
                recipient={null}
                scopeLabel="当前 Batch"
              />
              <ComposerRecipientChip recipient={null} threads={[]} showDefaultRecipient={false} />
            </>
          )}
          onChange={setGoal}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.metaKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
          placeholder="描述需要完成的工作…"
          trailingControls={(
            <>
              <ComposerModelControls
                session={sessionInfo}
                providers={providerCatalog}
                selection={routeSelection}
                onChange={setRouteSelection}
                disabled={providerState === "error"}
              />
              <IconButton
                className="agent-composer__primary-action"
                data-tooltip={submitting ? "正在创建 Task…" : "创建并发送 (⌘↩)"}
                aria-label={submitting ? "正在创建 Task" : "创建 Task 并发送目标"}
                type="submit"
                disabled={!goal.trim() || submitting}
              >
                <ArrowUp aria-hidden="true" />
              </IconButton>
            </>
          )}
          value={goal}
          variant="first-turn"
        />
        <p className="workspace-goal-note">Command-Return 发送。导入本身不产生模型费用。</p>
      </div>
    </section>
  );
}

function TaskSurface({ state, store, renderTask, actionError, showHeader }: {
  state: WorkspaceState;
  store: WorkspaceStore;
  renderTask?: (input: WorkspaceTaskContentInput) => ReactNode;
  actionError: string | null;
  showHeader: boolean;
}) {
  if (state.taskState === "loading") return <LoadingState label="正在载入 Task…" />;
  if (state.taskState === "error" || !state.task) {
    return <ErrorState title="Task 未能载入" detail={state.error} onRetry={() => {
      if (!state.taskId) return;
      if (state.projectId) void store.openTask(state.projectId, state.taskId);
      else void store.openChat(state.taskId);
    }} />;
  }
  const status = taskStatus(state);
  const eventNotice = taskEventNotice(state);
  return (
    <section className="workspace-task-surface" aria-label={state.task.task.title}>
      {showHeader ? <div className="workspace-task-fallback-header">
        <PaneHeader
          title={state.task.task.title}
          description={`${projectName(state)}${state.batchId ? ` / ${state.batchId}` : ""}`}
          actions={<StatusLabel state={status.tone} live>{status.label}</StatusLabel>}
        />
      </div> : null}
      {actionError ? <p className="workspace-task-error" role="alert">{actionError}</p> : null}
      {eventNotice ? (
        <div
          className="workspace-task-event-notice"
          data-state={state.eventState}
          role={eventNotice.live === "assertive" ? "alert" : "status"}
          aria-live={eventNotice.live}
        >
          <div>
            <strong>{eventNotice.title}</strong>
            <span>{eventNotice.detail}</span>
          </div>
          {eventNotice.action ? (
            <Button variant="secondary" onClick={() => void store.refreshTaskEvents()}>{eventNotice.action}</Button>
          ) : null}
        </div>
      ) : null}
      <div className="workspace-task-slot">
        {renderTask ? renderTask({ state, store }) : (
          <div className="workspace-task-placeholder">
            <h2>Task 内容</h2>
            <p>连续对话、Decision、Specialist 和 Artifact 将在这里接入同一条 canonical 时间线。</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function Workspace({
  store = workspaceStore,
  onCreateProject,
  onCreateChat,
  onImportBatch,
  onOpenSearch,
  onOpenSettings,
  onOpenLibrary,
  settingsOpen = false,
  renderSettings,
  renderStart,
  renderProject,
  renderTask,
  renderToolbar,
  showTaskHeader = true,
}: WorkspaceProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const scopeRestored = useWorkspaceScopeMemory(store, state);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [actionError, setActionError] = useState<string | null>(null);
  const chatCancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!bootedStores.has(store) && store.getState().runtime === null) {
      bootedStores.add(store);
      void store.boot();
    }
  }, [store]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1080px)");
    const update = (event: MediaQueryListEvent) => setSidebarOpen(!event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const toggle = () => setSidebarOpen((open) => !open);
    window.addEventListener("linguist:toggle-sidebar", toggle);
    return () => window.removeEventListener("linguist:toggle-sidebar", toggle);
  }, []);

  useEffect(() => () => chatCancelRef.current?.(), []);

  if (settingsOpen && renderSettings && state.runtime?.status === "ready" && scopeRestored) {
    return (
      <div className="workspace-settings-shell">
        {renderSettings({ state, store })}
      </div>
    );
  }

  let center: ReactNode;
  if (!state.runtime) center = <LoadingState label="正在连接本机 runtime…" />;
  else if (state.runtime.status !== "ready") {
    center = <RuntimeUnavailableState state={state} store={store} />;
  } else if (state.projectsState === "loading" && !state.projects.length) center = <LoadingState label="正在载入项目…" />;
  else if (state.projectsState === "error") center = <ErrorState title="项目未能载入" detail={state.error} onRetry={() => void store.refreshProjects()} />;
  else if (!scopeRestored) center = <LoadingState label="正在恢复上次工作…" />;
  else if (settingsOpen && renderSettings) center = renderSettings({ state, store });
  else if (state.taskId) center = <TaskSurface state={state} store={store} renderTask={renderTask} actionError={actionError} showHeader={showTaskHeader} />;
  else if (!state.projectId) center = renderStart
    ? renderStart({ state, store })
    : <StartState state={state} store={store} onCreateProject={onCreateProject} onCreateChat={onCreateChat} />;
  else if (state.batchId) {
    if (state.batchState === "loading") center = <LoadingState label="正在载入批次…" />;
    else if (state.batchState === "error") center = <ErrorState title="批次未能载入" detail={state.error} onRetry={() => void store.openBatch(state.projectId!, state.batchId!)} />;
    else center = <BatchReady state={state} store={store} actionError={actionError} setActionError={setActionError} chatCancelRef={chatCancelRef} />;
  } else center = renderProject
    ? renderProject({ state, store })
    : <ProjectState state={state} onImportBatch={onImportBatch} />;

  return (
    <div className="workspace-shell" data-sidebar-open={sidebarOpen}>
      <WorkspaceSidebar
        state={state}
        store={store}
        onCreateProject={onCreateProject}
        onOpenSearch={onOpenSearch}
        onOpenSettings={onOpenSettings}
        onOpenLibrary={onOpenLibrary}
        settingsOpen={settingsOpen}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
      />
      <main className="workspace-main">
        {renderToolbar({
          state,
          store,
          sidebarOpen,
          toggleSidebar: () => setSidebarOpen((open) => !open),
        })}
        <div className="workspace-center" role="region" aria-label="工作区内容" tabIndex={-1} data-command-focus-target="center">{center}</div>
      </main>
    </div>
  );
}
