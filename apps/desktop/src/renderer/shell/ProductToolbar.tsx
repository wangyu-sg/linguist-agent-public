import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Ellipsis,
  Folder,
  GitBranch,
  Languages,
  LibraryBig,
  MessageSquareText,
  Minimize2,
  PackageCheck,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PencilLine,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { Button, IconButton } from "../ui/index.ts";
import type { WorkspaceToolbarInput } from "../workspace/index.ts";
import { projectFor, type ProductSurface, type TaskWorkspaceMode } from "./product-surface.ts";

const taskModes: Array<{ id: TaskWorkspaceMode; label: string; icon: typeof MessageSquareText }> = [
  { id: "conversation", label: "对话", icon: MessageSquareText },
  { id: "cat", label: "CAT", icon: Languages },
  { id: "review", label: "审阅", icon: SearchCheck },
  { id: "qa", label: "QA", icon: ShieldCheck },
  { id: "delivery", label: "交付", icon: PackageCheck },
];

const pipelineModes = taskModes.filter((mode) => mode.id !== "conversation" && mode.id !== "cat");

const surfaceLabels: Record<ProductSurface, string> = {
  conversation: "对话",
  cat: "CAT",
  review: "审阅",
  qa: "QA",
  delivery: "交付",
  assets: "资料库",
  library: "Library",
  settings: "设置",
};
export function ProductToolbar({
  input,
  surface,
  onSurfaceChange,
  catCompanionOpen,
  onToggleCatCompanion,
  onImportBatch,
}: {
  input: WorkspaceToolbarInput;
  surface: ProductSurface;
  onSurfaceChange: (surface: ProductSurface) => void;
  catCompanionOpen: boolean;
  onToggleCatCompanion: () => void;
  onImportBatch: (projectId: string) => void;
}) {
  const { state } = input;
  const taskMenuRef = useRef<HTMLDetailsElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(state.task?.task.title ?? "");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [selectedChatThreadId, setSelectedChatThreadId] = useState("");
  const [chatAction, setChatAction] = useState<"fork" | "copy" | "compact" | "archive" | "restore" | null>(null);
  const [chatActionError, setChatActionError] = useState<string | null>(null);
  const project = projectFor(state);
  const standalone = state.task?.task.owner.kind === "standalone";
  const chatBranches = useMemo(() => {
    if (!standalone || !state.task) return [];
    const parents = new Set(state.task.agentThreads.map((thread) => thread.parentThreadId).filter((id): id is string => Boolean(id)));
    return state.task.agentThreads
      .filter((thread) => thread.piSessionFile && !parents.has(thread.id))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [standalone, state.task]);
  const selectedChatBranch = chatBranches.find((thread) => thread.id === selectedChatThreadId) ?? chatBranches[0] ?? null;
  const chatActiveRun = state.task?.runs.find((run) => run.id === state.task?.activeRunId)
    ?? state.task?.runs.findLast((run) => run.stopAvailable);
  const chatActionsBlocked = Boolean(chatActiveRun);
  const batchReady = Boolean(project && state.batchId && !state.taskId);
  const activePipelineMode = pipelineModes.find((mode) => mode.id === surface) ?? null;
  const title = surface === "settings"
    ? "设置"
    : surface === "library"
      ? "Library"
    : surface === "assets"
      ? project?.name ?? "资料库"
    : batchReady
      ? project?.name ?? state.batchId ?? "当前项目"
    : state.task?.task.title ?? state.batchId ?? project?.name ?? "Linguist Agent";
  const subtitle = surface === "settings"
    ? "Linguist Agent"
    : surface === "library"
      ? "Documents, memory, and managed retrieval"
    : batchReady
      ? state.batchId ?? "当前 Batch"
    : project
      ? [project.name, state.batchId, surfaceLabels[surface]].filter(Boolean).join(" / ")
      : standalone ? "无项目 Chat" : "本地化工作台";

  useEffect(() => {
    setRenaming(false);
    setTitleDraft(state.task?.task.title ?? "");
    setRenameBusy(false);
    setRenameError(null);
    setSelectedChatThreadId("");
    setChatAction(null);
    setChatActionError(null);
  }, [state.taskId]);

  useEffect(() => {
    if (!renaming) setTitleDraft(state.task?.task.title ?? "");
  }, [renaming, state.task?.task.title]);

  useEffect(() => {
    const closeForOutsidePointer = (event: PointerEvent) => {
      const details = taskMenuRef.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      details.open = false;
      setRenaming(false);
      setRenameError(null);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      const details = taskMenuRef.current;
      if (event.key !== "Escape" || event.defaultPrevented || !details?.open) return;
      event.preventDefault();
      details.open = false;
      setRenaming(false);
      setRenameError(null);
      details.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", closeForOutsidePointer);
    document.addEventListener("keydown", closeForEscape);
    return () => {
      document.removeEventListener("pointerdown", closeForOutsidePointer);
      document.removeEventListener("keydown", closeForEscape);
    };
  }, []);

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (renameBusy) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      await input.store.renameTask(titleDraft);
      setRenaming(false);
      if (taskMenuRef.current) taskMenuRef.current.open = false;
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRenameBusy(false);
    }
  };

  const closeTaskMenu = () => {
    if (taskMenuRef.current) taskMenuRef.current.open = false;
  };

  const runChatAction = async (
    action: NonNullable<typeof chatAction>,
    work: () => Promise<void>,
  ) => {
    if (chatAction || chatActionsBlocked) return;
    setChatAction(action);
    setChatActionError(null);
    try {
      await work();
      closeTaskMenu();
    } catch (cause) {
      setChatActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChatAction(null);
    }
  };

  return (
    <header className="product-toolbar" aria-label="工作区工具栏">
      <div className="product-toolbar__slot product-toolbar__slot--start">
        {!input.sidebarOpen ? (
          <IconButton
            className="product-toolbar__show-sidebar"
            aria-label="显示项目侧边栏"
            title="显示项目侧边栏"
            onClick={input.toggleSidebar}
          >
            <PanelLeftOpen />
          </IconButton>
        ) : null}
        {standalone ? <MessageSquareText className="product-toolbar__scope-icon" aria-hidden="true" /> : <Folder className="product-toolbar__scope-icon" aria-hidden="true" />}
        <div className="product-toolbar__scope" aria-label={subtitle ? `${title}，${subtitle}` : title}>
          <strong title={title}>{title}</strong>
        </div>
        {state.taskId && surface !== "settings" && surface !== "assets" && surface !== "library" ? (
          <details className="product-task-menu" ref={taskMenuRef}>
            <summary aria-label={standalone ? "更多 Chat 操作" : "更多 Task 操作"} title={standalone ? "更多 Chat 操作" : "更多 Task 操作"}><Ellipsis aria-hidden="true" /></summary>
            <div className="product-task-menu__popover" aria-label={standalone ? "Chat 操作" : "Task 操作"}>
              {!renaming ? (
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(state.task?.task.title ?? "");
                    setRenameError(null);
                    setRenaming(true);
                  }}
                >
                  <PencilLine aria-hidden="true" />
                  <span>{standalone ? "重命名 Chat" : "重命名 Task"}</span>
                </button>
              ) : (
                <form className="product-task-menu__rename" onSubmit={submitRename}>
                  <label htmlFor="product-task-title">Task 名称</label>
                  <input
                    id="product-task-title"
                    value={titleDraft}
                    maxLength={120}
                    autoFocus
                    disabled={renameBusy}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      event.preventDefault();
                      setRenaming(false);
                      setRenameError(null);
                    }}
                  />
                  {renameError ? <p role="alert">{renameError}</p> : null}
                  <div>
                    <button type="button" disabled={renameBusy} onClick={() => { setRenaming(false); setRenameError(null); }}>取消</button>
                    <button type="submit" disabled={renameBusy || !titleDraft.trim()}>{renameBusy ? "保存中" : "保存"}</button>
                  </div>
                </form>
              )}
              {standalone ? (
                <>
                  <div className="product-task-menu__divider" />
                  <div className="product-task-menu__section-label">对话</div>
                  <label className="product-task-menu__branch">
                    <span>当前分支</span>
                    <select
                      value={selectedChatBranch?.id ?? ""}
                      disabled={chatActionsBlocked || chatAction !== null || chatBranches.length === 0}
                      onChange={(event) => setSelectedChatThreadId(event.target.value)}
                    >
                      {chatBranches.length === 0 ? <option value="">尚无可操作分支</option> : null}
                      {chatBranches.map((thread, index) => (
                        <option key={thread.id} value={thread.id}>{index === 0 ? "当前分支" : `分支 ${index + 1}`}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!selectedChatBranch || chatActionsBlocked || chatAction !== null}
                    onClick={() => void runChatAction("fork", async () => {
                      if (!selectedChatBranch) return;
                      await input.store.forkChat({
                        sourceThreadId: selectedChatBranch.id,
                        entryId: selectedChatBranch.piEntryId,
                        position: "at",
                      });
                    })}
                  >
                    <GitBranch aria-hidden="true" /><span>{chatAction === "fork" ? "正在创建分支…" : "从这里分支"}</span>
                  </button>
                  <button
                    type="button"
                    disabled={chatActionsBlocked || chatAction !== null}
                    onClick={() => void runChatAction("copy", async () => {
                      await input.store.copyChat({
                        ...(selectedChatBranch?.latestActivityId ? { throughActivityId: selectedChatBranch.latestActivityId } : {}),
                      });
                    })}
                  >
                    <Copy aria-hidden="true" /><span>{chatAction === "copy" ? "正在复制…" : "复制为新 Chat"}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!selectedChatBranch || chatActionsBlocked || chatAction !== null}
                    onClick={() => void runChatAction("compact", async () => {
                      if (!selectedChatBranch) return;
                      await input.store.compactChat(undefined, selectedChatBranch.id);
                    })}
                  >
                    <Minimize2 aria-hidden="true" /><span>{chatAction === "compact" ? "正在压缩…" : "压缩上下文"}</span>
                  </button>
                  <button
                    type="button"
                    disabled={chatActionsBlocked || chatAction !== null}
                    onClick={() => void runChatAction(state.task?.task.status === "archived" ? "restore" : "archive", async () => {
                      if (!state.task) return;
                      if (state.task.task.status === "archived") await input.store.restoreChat(state.task.task.id);
                      else await input.store.archiveChat(state.task.task.id);
                    })}
                  >
                    {state.task?.task.status === "archived" ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                    <span>{chatAction === "archive" || chatAction === "restore"
                      ? state.task?.task.status === "archived" ? "正在恢复…" : "正在归档…"
                      : state.task?.task.status === "archived" ? "恢复 Chat" : "归档 Chat"}</span>
                  </button>
                  {chatActionsBlocked ? <p className="product-task-menu__hint">Run 进行中；完成或停止后可管理分支与归档。</p> : null}
                  {chatActionError ? <p className="product-task-menu__error" role="alert">{chatActionError}</p> : null}
                </>
              ) : null}
              {!standalone ? <div className="product-task-menu__divider" /> : null}
              {!standalone ? <div className="product-task-menu__section-label">专业工作区</div> : null}
              {!standalone ? pipelineModes.map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="menuitem"
                    aria-current={surface === mode.id ? "page" : undefined}
                    onClick={(event) => {
                      onSurfaceChange(mode.id);
                      const details = event.currentTarget.closest("details");
                      if (details) details.open = false;
                    }}
                  >
                    <Icon aria-hidden="true" />
                    <span>{mode.label}</span>
                  </button>
                );
              }) : null}
            </div>
          </details>
        ) : null}
      </div>

      <div className="product-toolbar__slot product-toolbar__slot--center">
        {state.taskId && surface !== "settings" && surface !== "library" ? (
          <nav className="product-toolbar__views" aria-label="Task 工作区">
            <button
              type="button"
              aria-label="打开对话"
              title="对话（⌘1）"
              aria-pressed={surface === "conversation"}
              onClick={() => onSurfaceChange("conversation")}
            >
              <MessageSquareText aria-hidden="true" /><span>对话</span>
            </button>
            {!standalone ? <button
              type="button"
              aria-label="打开 CAT"
              title="CAT（⌘2）"
              aria-pressed={surface === "cat"}
              disabled={!state.batchId}
              onClick={() => onSurfaceChange("cat")}
            >
              <Languages aria-hidden="true" /><span>CAT</span>
            </button> : null}
            {!standalone ? <button
              type="button"
              aria-label="打开资料库"
              title="资料库"
              aria-pressed={surface === "assets"}
              onClick={() => onSurfaceChange("assets")}
            >
              <LibraryBig aria-hidden="true" /><span>资料库</span>
            </button> : null}
            {!standalone && activePipelineMode ? (
              <>
                <span className="product-toolbar__views-divider" aria-hidden="true" />
                <button
                  type="button"
                  aria-label={`当前专业工作区：${activePipelineMode.label}`}
                  title={activePipelineMode.label}
                  aria-pressed="true"
                  onClick={() => onSurfaceChange(activePipelineMode.id)}
                >
                  <activePipelineMode.icon aria-hidden="true" /><span>{activePipelineMode.label}</span>
                </button>
              </>
            ) : null}
          </nav>
        ) : surface === "assets" && project ? (
          <div className="product-toolbar__mode-label"><LibraryBig aria-hidden="true" />资料库</div>
        ) : surface === "library" ? (
          <div className="product-toolbar__mode-label"><LibraryBig aria-hidden="true" />Library</div>
        ) : null}
      </div>

      <div className="product-toolbar__slot product-toolbar__slot--end">
        {surface === "cat" ? (
          <IconButton
            className="product-toolbar__toggle-companion"
            aria-label={catCompanionOpen ? "关闭当前句段 Agent 伴随区" : "打开当前句段 Agent 伴随区"}
            title={catCompanionOpen ? "关闭句段伴随区" : "打开句段伴随区"}
            pressed={catCompanionOpen}
            onClick={onToggleCatCompanion}
          >
            {catCompanionOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </IconButton>
        ) : null}
        {surface === "assets" && project && !state.batchId && !state.taskId ? (
          <Button variant="primary" onClick={() => onImportBatch(project.projectId)}>导入批次</Button>
        ) : null}
      </div>
    </header>
  );
}
