import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { TaskRecord, TaskRun } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import { CommandPalette, type CommandSelection } from "../command/index.ts";
import { workspaceStore, type WorkspaceState, type WorkspaceStore } from "../data/workspace-store.ts";
import { InspectorPane } from "../inspector/InspectorPane.tsx";
import type { InspectorFollowUpTarget, InspectorSelection } from "../inspector/index.ts";
import { Workspace, type WorkspaceToolbarInput } from "../workspace/index.ts";
import { ProductToolbar } from "./ProductToolbar.tsx";
import { SegmentCompanion } from "./SegmentCompanion.tsx";
import { projectFor, type ProductSurface, type TaskWorkspaceMode } from "./product-surface.ts";
import "./product-workspace.css";

export type { ProductSurface, TaskWorkspaceMode } from "./product-surface.ts";

const ProjectAssets = lazy(() => import("../assets/ProjectAssets.tsx").then((module) => ({ default: module.ProjectAssets })));
const CatWorkspace = lazy(() => import("../cat/CatWorkspace.tsx").then((module) => ({ default: module.CatWorkspace })));
const PipelineWorkspace = lazy(() => import("../pipelines/PipelineWorkspace.tsx").then((module) => ({ default: module.PipelineWorkspace })));
const TaskConversation = lazy(() => import("../conversation/index.ts").then((module) => ({ default: module.TaskConversation })));
const SettingsWorkspace = lazy(() => import("../settings/SettingsWorkspace.tsx").then((module) => ({ default: module.SettingsWorkspace })));
const ContextInspector = lazy(() => import("../inspector/ContextInspector.tsx").then((module) => ({ default: module.ContextInspector })));
const LibraryWorkspace = lazy(() => import("../library/index.ts").then((module) => ({ default: module.LibraryWorkspace })));

export interface ProductWorkspaceProps {
  store?: WorkspaceStore;
  onCreateProject: () => void;
  onImportBatch: (projectId: string) => void;
  renderPipeline?: (mode: Exclude<TaskWorkspaceMode, "conversation" | "cat">, state: WorkspaceState, store: WorkspaceStore) => ReactNode;
  renderSettings?: (state: WorkspaceState, store: WorkspaceStore) => ReactNode;
}


function selectedBatchFormat(state: WorkspaceState) {
  return state.batch?.batch.format
    ?? state.batchSummary?.format
    ?? projectFor(state)?.batches.find((batch) => batch.batchId === state.batchId)?.format;
}

function activeRun(state: WorkspaceState): TaskRun | null {
  if (!state.task) return null;
  return state.task.runs.find((run) => run.id === state.task?.activeRunId)
    ?? state.task.runs.findLast((run) => run.stopAvailable)
    ?? state.task.runs.at(-1)
    ?? null;
}

function taskModeStorageKey(task: TaskRecord): string {
  const owner = task.owner.kind === "standalone" ? "standalone" : `project:${task.owner.projectId}`;
  return `linguist-agent:task-mode:${owner}:${task.id}`;
}

function rememberedTaskMode(task: TaskRecord): "conversation" | "cat" {
  if (task.owner.kind === "standalone") return "conversation";
  return window.localStorage.getItem(taskModeStorageKey(task)) === "cat" ? "cat" : "conversation";
}

function rememberTaskMode(task: TaskRecord, mode: TaskWorkspaceMode): void {
  if (mode === "conversation" || mode === "cat") window.localStorage.setItem(taskModeStorageKey(task), mode);
}

function focusWorkspaceCenter(): void {
  window.requestAnimationFrame(() => {
    const center = document.querySelector<HTMLElement>("[data-command-focus-target='center']");
    if (!center || center.contains(document.activeElement)) return;
    center.focus({ preventScroll: true });
  });
}

function SurfaceLoading({ label }: { label: string }) {
  return (
    <div className="product-surface-loading" role="status" aria-live="polite">
      <LoaderCircle className="product-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}


export function ProductWorkspace({
  store = workspaceStore,
  onCreateProject,
  onImportBatch,
  renderPipeline,
  renderSettings,
}: ProductWorkspaceProps) {
  const [surface, setSurface] = useState<ProductSurface>("conversation");
  const [requestedSegmentId, setRequestedSegmentId] = useState<string | null>(null);
  const [inspectorSelection, setInspectorSelection] = useState<InspectorSelection | null>(null);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const [recipientTarget, setRecipientTarget] = useState<InspectorFollowUpTarget | null>(null);
  const [catCompanionOpen, setCatCompanionOpen] = useState(() => window.innerWidth >= 1320);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const previousScope = useRef({ projectId: null as string | null, batchId: null as string | null, taskId: null as string | null });
  const previousSurface = useRef<ProductSurface>("conversation");
  const inspectorOrigin = useRef<HTMLElement | null>(null);
  const lastInspectorSelection = useRef<InspectorSelection | null>(null);

  const openInspector = (selection: InspectorSelection) => {
    if (document.activeElement instanceof HTMLElement && !document.activeElement.closest(".context-inspector")) {
      inspectorOrigin.current = document.activeElement;
    }
    lastInspectorSelection.current = selection;
    setInspectorSelection(selection);
  };

  const closeInspector = (restoreFocus = true) => {
    const origin = inspectorOrigin.current;
    inspectorOrigin.current = null;
    if (inspectorSelection) lastInspectorSelection.current = inspectorSelection;
    setInspectorSelection(null);
    setInspectorExpanded(false);
    if (restoreFocus && origin?.isConnected) {
      window.requestAnimationFrame(() => origin.focus({ preventScroll: true }));
    }
  };

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getState();
      const previous = previousScope.current;
      if (state.taskId !== previous.taskId && state.taskId) {
        inspectorOrigin.current = null;
        lastInspectorSelection.current = null;
        setInspectorSelection(null);
        setInspectorExpanded(false);
        setRecipientTarget(null);
        setRequestedSegmentId(null);
        const selectedTask = state.task?.task
          ?? state.chats.find((task) => task.id === state.taskId)
          ?? state.tasks.find((task) => task.id === state.taskId);
        setSurface(selectedTask ? rememberedTaskMode(selectedTask) : "conversation");
      } else if (!state.taskId && (state.projectId !== previous.projectId || state.batchId !== previous.batchId)) {
        inspectorOrigin.current = null;
        lastInspectorSelection.current = null;
        setInspectorSelection(null);
        setRecipientTarget(null);
        setRequestedSegmentId(null);
        setSurface(state.projectId && !state.batchId ? "assets" : "conversation");
      }
      previousScope.current = { projectId: state.projectId, batchId: state.batchId, taskId: state.taskId };
    });
    const state = store.getState();
    previousScope.current = { projectId: state.projectId, batchId: state.batchId, taskId: state.taskId };
    return unsubscribe;
  }, [store]);

  const changeSurface = async (next: ProductSurface): Promise<void> => {
    if (next !== surface && !await store.prepareScopeTransition()) return;
    const state = store.getState();
    if (next !== surface && inspectorSelection) closeInspector(false);
    if (next === "settings") {
      if (surface !== "settings") previousSurface.current = surface;
      setSurface("settings");
      return;
    }
    if (state.task && next !== "assets" && next !== "library") rememberTaskMode(state.task.task, next as TaskWorkspaceMode);
    setSurface(next);
  };

  useEffect(() => window.linguist.system.onCommand((command) => {
      const state = store.getState();
      if (command !== "show-command-palette") setCommandPaletteOpen(false);
      if (command === "new-project") {
        onCreateProject();
      } else if (command === "import-batch" && state.projectId) {
        onImportBatch(state.projectId);
      } else if (command === "show-conversation" && state.taskId) {
        changeSurface("conversation");
      } else if (command === "show-cat" && state.taskId && state.batchId) {
        changeSurface("cat");
      } else if (command === "show-settings") {
        if (surface !== "settings") changeSurface("settings");
      } else if (command === "show-command-palette") {
        if (!document.querySelector("dialog[open]")) setCommandPaletteOpen(true);
      } else if (command === "toggle-sidebar") {
        window.dispatchEvent(new Event("linguist:toggle-sidebar"));
      } else if (command === "toggle-inspector") {
        if (inspectorSelection) closeInspector();
        else if (lastInspectorSelection.current) openInspector(lastInspectorSelection.current);
      } else if (command === "stop-run" && state.taskId && activeRun(state)?.stopAvailable) {
        void store.stopTask("user stop from application menu");
      }
  }), [onCreateProject, onImportBatch, store, surface]);

  const selectCommand = async (selection: CommandSelection): Promise<void> => {
    const state = store.getState();
    switch (selection.kind) {
      case "create-chat":
        await store.createChat();
        focusWorkspaceCenter();
        return;
      case "create-project":
        onCreateProject();
        return;
      case "import-batch":
        onImportBatch(selection.projectId);
        return;
      case "open-settings":
        await changeSurface("settings");
        focusWorkspaceCenter();
        return;
      case "show-conversation":
        if (!state.taskId) return;
        await changeSurface("conversation");
        focusWorkspaceCenter();
        return;
      case "show-cat":
        if (!state.taskId || !state.batchId) return;
        await changeSurface("cat");
        focusWorkspaceCenter();
        return;
      case "open-project":
        await store.selectProject(selection.projectId);
        if (store.getState().projectId === selection.projectId) focusWorkspaceCenter();
        return;
      case "open-batch":
        if (state.projectId !== selection.projectId) await store.selectProject(selection.projectId);
        if (store.getState().projectId !== selection.projectId) return;
        await store.openBatch(selection.projectId, selection.batchId);
        if (store.getState().batchId === selection.batchId) focusWorkspaceCenter();
        return;
      case "open-task":
        if (state.projectId !== selection.projectId) await store.selectProject(selection.projectId);
        if (store.getState().projectId !== selection.projectId) return;
        await store.openTask(selection.projectId, selection.taskId);
        if (store.getState().taskId === selection.taskId) focusWorkspaceCenter();
        return;
      case "open-chat":
        await store.openChat(selection.taskId);
        if (store.getState().taskId === selection.taskId && store.getState().projectId === null) focusWorkspaceCenter();
    }
  };

  const pipelineMode = surface === "review" || surface === "qa" || surface === "delivery" ? surface : null;
  const toolbar = useMemo(() => (input: WorkspaceToolbarInput) => (
    <ProductToolbar
      input={input}
      surface={surface}
      onSurfaceChange={changeSurface}
      catCompanionOpen={catCompanionOpen}
      onToggleCatCompanion={() => setCatCompanionOpen((open) => !open)}
      onImportBatch={onImportBatch}
    />
  ), [catCompanionOpen, onImportBatch, surface]);

  return (
    <>
      <Workspace
      store={store}
      onCreateProject={onCreateProject}
      onCreateChat={() => { void store.createChat().then(focusWorkspaceCenter); }}
      onImportBatch={onImportBatch}
      onOpenSearch={() => setCommandPaletteOpen(true)}
      onOpenSettings={() => changeSurface(surface === "settings" ? previousSurface.current : "settings")}
      onOpenLibrary={() => { void changeSurface("library"); }}
      settingsOpen={surface === "settings"}
      showTaskHeader={false}
      renderToolbar={toolbar}
      renderSettings={({ state, store: currentStore }) => renderSettings?.(state, currentStore) ?? (
        <Suspense fallback={<SurfaceLoading label="正在打开设置" />}>
          <SettingsWorkspace
            store={currentStore}
            onClose={() => void changeSurface(previousSurface.current)}
          />
        </Suspense>
      )}
      renderStart={surface === "library" ? ({ state, store: currentStore }) => (
        <Suspense fallback={<SurfaceLoading label="正在打开 Library" />}>
          <LibraryWorkspace projectId={state.projectId} taskId={state.taskId} />
        </Suspense>
      ) : undefined}
      renderProject={({ state, store: currentStore }) => surface === "library" ? (
        <Suspense fallback={<SurfaceLoading label="正在打开 Library" />}>
          <LibraryWorkspace projectId={state.projectId} taskId={state.taskId} />
        </Suspense>
      ) : (
        <Suspense fallback={<SurfaceLoading label="正在打开资料库" />}>
          <ProjectAssets
            project={projectFor(state)}
            onCatalogChange={() => void currentStore.refreshProjects()}
          />
        </Suspense>
      )}
      renderTask={({ state, store: currentStore }) => {
        let content: ReactNode;
        if (surface === "library") {
          content = (
            <Suspense fallback={<SurfaceLoading label="正在打开 Library" />}>
              <LibraryWorkspace projectId={state.projectId} taskId={state.taskId} />
            </Suspense>
          );
        } else if (surface === "assets") {
          content = (
            <Suspense fallback={<SurfaceLoading label="正在打开资料库" />}>
              <ProjectAssets
                project={projectFor(state)}
                onCatalogChange={() => void currentStore.refreshProjects()}
              />
            </Suspense>
          );
        } else if (surface === "cat") {
          const focusedSegment = state.batch?.batch.segments.find((segment) => segment.id === requestedSegmentId)
            ?? state.batch?.batch.segments[0]
            ?? null;
          content = (
            <Suspense fallback={<SurfaceLoading label="正在打开 CAT" />}>
              <div className="product-cat-surface" data-companion-open={catCompanionOpen}>
                <CatWorkspace
                  store={currentStore}
                  focusedSegmentId={requestedSegmentId}
                  onFocusedSegmentChange={(segment) => {
                    if (segment) setRequestedSegmentId(segment.id);
                    if (segment) {
                      setInspectorSelection((current) => current?.kind === "segment" ? {
                        ...current,
                        segment,
                        tagView: state.batch?.batch.tagViews?.[segment.id],
                      } : current);
                    }
                  }}
                />
                <SegmentCompanion
                  segment={focusedSegment}
                  store={currentStore}
                  onOpenHistory={() => changeSurface("conversation")}
                  onInspectActivity={(activity) => openInspector({ kind: "activity", activity })}
                  onInspectArtifact={(artifact) => openInspector({ kind: "artifact", artifact })}
                  onInspectSegment={(segment) => {
                    setCatCompanionOpen(false);
                    openInspector({
                      kind: "segment",
                      segment,
                      tagView: state.batch?.batch.tagViews?.[segment.id],
                      taskItems: state.task ? {
                        activities: state.task.activities,
                        artifacts: state.task.artifacts,
                        decisions: state.task.decisions,
                      } : undefined,
                    });
                  }}
                />
              </div>
            </Suspense>
          );
        } else if (pipelineMode) content = renderPipeline?.(pipelineMode, state, currentStore) ?? (
          <Suspense fallback={<SurfaceLoading label="正在打开工作区" />}>
            <PipelineWorkspace
              snapshot={state.task!}
              batchFormat={selectedBatchFormat(state)}
              mode={pipelineMode}
              showModeTabs={false}
              showRunHistory={false}
              onModeChange={(nextMode) => {
                if (nextMode !== "eval") changeSurface(nextMode);
              }}
              onOpenSegment={(segmentId) => {
                setRequestedSegmentId(segmentId);
                setCatCompanionOpen(true);
                changeSurface("cat");
              }}
              onOpenTask={(projectId, taskId) => currentStore.openTask(projectId, taskId)}
            />
          </Suspense>
        );
        else content = (
          <Suspense fallback={<SurfaceLoading label="正在打开对话" />}>
            <TaskConversation
              key={`${state.projectId ?? "standalone"}:${state.task!.task.id}`}
              store={currentStore}
              focusedSegmentId={requestedSegmentId}
              recipient={recipientTarget ? { threadId: recipientTarget.threadId, displayName: recipientTarget.displayName } : null}
              onCancelRecipient={() => setRecipientTarget(null)}
              onInspectArtifact={(artifact) => openInspector({ kind: "artifact", artifact })}
              onInspectActivity={(activity) => openInspector({ kind: "activity", activity })}
              onOpenSettings={() => void changeSurface("settings")}
              onSendMessage={recipientTarget ? (message, context) => {
                let cancelled = false;
                context.onState({ status: "connected" });
                void currentStore.startSpecialistFollowUp(recipientTarget.threadId, message, {
                  ...(recipientTarget.artifactId ? { artifactId: recipientTarget.artifactId } : {}),
                  ...(recipientTarget.activityId ? { activityId: recipientTarget.activityId } : {}),
                }).then(() => {
                  if (!cancelled) context.onState({ status: "closed" });
                }).catch((cause) => {
                  if (!cancelled) context.onState({ status: "error", message: cause instanceof Error ? cause.message : String(cause) });
                });
                return () => { cancelled = true; };
              } : undefined}
            />
          </Suspense>
        );

        return (
          <div
            className="product-task-frame"
            data-inspector-open={Boolean(inspectorSelection)}
            data-inspector-expanded={inspectorExpanded}
          >
            <div className="product-task-content">{content}</div>
            <InspectorPane
              open={Boolean(inspectorSelection)}
              expanded={inspectorExpanded}
              onToggleExpanded={() => setInspectorExpanded((expanded) => !expanded)}
            >
              {inspectorSelection ? (
                <Suspense fallback={null}>
                  <ContextInspector
                    selection={inspectorSelection}
                    store={currentStore}
                    threads={state.task?.agentThreads ?? []}
                    expanded={inspectorExpanded}
                    onToggleExpanded={() => setInspectorExpanded((expanded) => !expanded)}
                    onClose={() => closeInspector()}
                    onSelectLinkedItem={openInspector}
                    onAskSpecialist={(target) => {
                      setRecipientTarget(target);
                      closeInspector(false);
                      changeSurface("conversation");
                    }}
                  />
                </Suspense>
              ) : null}
            </InspectorPane>
          </div>
        );
      }}
      />
      {commandPaletteOpen ? (
        <CommandPalette
          store={store}
          onDismiss={() => setCommandPaletteOpen(false)}
          onSelect={(selection) => void selectCommand(selection)}
        />
      ) : null}
    </>
  );
}
