import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type TransitionEvent } from "react";
import {
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleStop,
  Clock3,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  LibraryBig,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  SquarePen,
} from "lucide-react";
import type { WorkspaceState, WorkspaceStore } from "../data/workspace-store.ts";
import { workspaceClient } from "../data/workspace-client.ts";
import { Button, IconButton, type StatusState } from "../ui";
import { sortSidebarTasks, statusPresentation, taskBucket } from "./sidebar-task-state.ts";

type SidebarTask = WorkspaceState["tasks"][number];

interface WorkspaceSidebarProps {
  state: WorkspaceState;
  store: WorkspaceStore;
  onCreateProject?: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onOpenLibrary?: () => void;
  settingsOpen?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

function batchKey(projectId: string, batchId: string): string {
  return `batch:${projectId}:${batchId}`;
}

function projectKey(projectId: string): string {
  return `project:${projectId}`;
}

/* ---------- 右键管理菜单:打开 / 重命名 / Finder 显示 / 复制 ID ---------- */

type SidebarMenuTarget =
  | { kind: "project"; projectId: string }
  | { kind: "batch"; projectId: string; batchId: string }
  | { kind: "task"; projectId: string; taskId: string }
  | { kind: "chat"; taskId: string };

function SidebarContextMenu({ target, x, y, state, store, onClose }: {
  target: SidebarMenuTarget;
  x: number;
  y: number;
  state: WorkspaceState;
  store: WorkspaceStore;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const task = target.kind === "task"
    ? state.tasks.find((candidate) => candidate.id === target.taskId)
    : target.kind === "chat"
      ? state.chats.find((candidate) => candidate.id === target.taskId)
      : null;
  const projectId = target.kind === "chat" ? null : target.projectId;
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  const idLabel = target.kind === "project" ? target.projectId : target.kind === "batch" ? target.batchId : target.taskId;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(idLabel);
    } catch {
      // 剪贴板权限被拒时静默失败,菜单照常关闭。
    }
    onClose();
  };

  const openTarget = () => {
    if (target.kind === "project") void store.selectProject(target.projectId);
    else if (target.kind === "batch") void store.openBatch(target.projectId, target.batchId);
    else if (target.kind === "task") void store.openTask(target.projectId, target.taskId);
    else void store.openChat(target.taskId);
    onClose();
  };

  const reveal = () => {
    if (project?.root) void window.linguist.system.revealPath(project.root);
    onClose();
  };

  const submitRename = async () => {
    if ((target.kind !== "task" && target.kind !== "chat") || busy) return;
    const value = title.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      if (target.kind === "task") await store.renameTaskById(target.projectId, target.taskId, value);
      else await store.renameChatById(target.taskId, value);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (target.kind !== "project" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const deletedId = target.projectId;
      await workspaceClient.deleteProject(deletedId);
      await store.refreshProjects();
      if (state.projectId === deletedId) {
        const remaining = store.getState().projects;
        if (remaining.length) await store.selectProject(remaining[0]!.projectId);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const menuWidth = 200;
  const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - 200));

  return (
    <div
      ref={ref}
      className="workspace-context-menu"
      role="menu"
      style={{ left, top, width: menuWidth }}
    >
      {renaming && (target.kind === "task" || target.kind === "chat") ? (
        <form
          className="workspace-context-menu__rename"
          onSubmit={(event) => {
            event.preventDefault();
            void submitRename();
          }}
        >
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={title}
            maxLength={120}
            disabled={busy}
            placeholder="Task 名称"
            onChange={(event) => setTitle(event.target.value)}
          />
          <div>
            <button type="button" onClick={() => setRenaming(false)} disabled={busy}>取消</button>
            <button type="submit" disabled={busy || !title.trim()}>{busy ? "保存中…" : "保存"}</button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      ) : confirmingDelete && target.kind === "project" ? (
        <div className="workspace-context-menu__rename">
          <p className="workspace-context-menu__confirm-text">删除项目「{project?.name ?? target.projectId}」?磁盘目录将被移除,不可撤销。</p>
          <div>
            <button type="button" onClick={() => setConfirmingDelete(false)} disabled={busy}>取消</button>
            <button type="button" data-tone="danger" disabled={busy} onClick={() => void confirmDelete()}>{busy ? "删除中…" : "确认删除"}</button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={openTarget}>打开</button>
          {target.kind === "task" || target.kind === "chat" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setTitle(task?.title ?? "");
                setRenaming(true);
              }}
            >
              重命名…
            </button>
          ) : null}
          {target.kind === "project" && project?.root ? (
            <button type="button" role="menuitem" onClick={reveal}>在 Finder 中显示</button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => void copyId()}>复制 ID</button>
          {target.kind === "chat" ? (
            <button type="button" role="menuitem" onClick={() => {
              void (task?.status === "archived" ? store.restoreChat(target.taskId) : store.archiveChat(target.taskId));
              onClose();
            }}>{task?.status === "archived" ? "恢复" : "归档"}</button>
          ) : null}
          {target.kind === "project" ? (
            <button type="button" role="menuitem" data-tone="danger" onClick={() => setConfirmingDelete(true)}>删除项目…</button>
          ) : null}
        </>
      )}
    </div>
  );
}

function taskStatusIcon(state: StatusState) {
  if (state === "running" || state === "stopping") return LoaderCircle;
  if (state === "waiting") return Clock3;
  if (state === "failed") return CircleAlert;
  if (state === "complete") return CircleCheck;
  if (state === "stopped") return CircleStop;
  return Circle;
}

function CollapsibleTreeGroup({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const [rendered, setRendered] = useState(open);
  const [expanded, setExpanded] = useState(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setExpanded(false);
      // 双 rAF:保证先以 0fr 挂载一帧,再翻到 1fr,过渡一定触发。
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return () => cancelAnimationFrame(raf);
    }
    setExpanded(false);
    return undefined;
  }, [open]);

  if (!rendered) return null;

  const finishCollapse = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "grid-template-rows" || open) return;
    setRendered(false);
  };

  return (
    <div
      className={["workspace-tree-collapse", className].filter(Boolean).join(" ")}
      data-open={expanded}
      aria-hidden={!expanded}
      inert={!expanded}
      onTransitionEnd={finishCollapse}
    >
      <div className="workspace-tree-collapse__clip">{children}</div>
    </div>
  );
}

function TaskRow({ task, state, store, level, parentKey }: {
  task: SidebarTask;
  state: WorkspaceState;
  store: WorkspaceStore;
  level: number;
  parentKey: string;
}) {
  const status = statusPresentation(task, state);
  const selected = state.taskId === task.id
    && (task.owner.kind === "standalone" ? state.projectId === null : state.projectId === task.owner.projectId);
  const StatusIcon = status ? taskStatusIcon(status.state) : null;
  const rowKey = task.owner.kind === "standalone" ? `chat:${task.id}` : `task:${task.id}`;
  return (
    <li role="none">
      <button
        type="button"
        data-sidebar-navigation="true"
        role="treeitem"
        aria-level={level}
        aria-selected={selected}
        aria-current={selected ? "page" : undefined}
        className="workspace-tree-row workspace-task-row"
        data-workspace-tree-item="true"
        data-tree-key={rowKey}
        data-parent-key={parentKey}
        data-tree-kind={task.owner.kind === "standalone" ? "chat" : "task"}
        title={task.title}
        onClick={() => {
          if (task.owner.kind === "standalone") void store.openChat(task.id);
          else void store.openTask(task.owner.projectId, task.id);
        }}
      >
        <span className="workspace-tree-label">{task.title}</span>
        {status && StatusIcon ? (
          <span className="workspace-task-status" data-state={status.state} title={status.label}>
            <StatusIcon aria-hidden="true" />
            <span className="la-sr-only">{status.label}</span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

function TaskGroup({ label, tasks, state, store, level, parentKey }: {
  label: string;
  tasks: SidebarTask[];
  state: WorkspaceState;
  store: WorkspaceStore;
  level: number;
  parentKey: string;
}) {
  const labelId = useId();
  if (!tasks.length) return null;
  return (
    <li role="none" className="workspace-task-group">
      <div id={labelId} className="workspace-task-group-label" data-level={level}>{label}</div>
      <ul role="group" aria-labelledby={labelId}>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} state={state} store={store} level={level} parentKey={parentKey} />
        ))}
      </ul>
    </li>
  );
}

function TaskBuckets({ tasks, state, store, level, parentKey }: {
  tasks: SidebarTask[];
  state: WorkspaceState;
  store: WorkspaceStore;
  level: number;
  parentKey: string;
}) {
  const sorted = sortSidebarTasks(tasks, state);
  const attention = sorted.filter((task) => taskBucket(task, state) === "attention");
  const running = sorted.filter((task) => taskBucket(task, state) === "running");
  const recent = sorted.filter((task) => taskBucket(task, state) === "recent");
  return (
    <>
      <TaskGroup label="需要处理" tasks={attention} state={state} store={store} level={level} parentKey={parentKey} />
      <TaskGroup label="运行中" tasks={running} state={state} store={store} level={level} parentKey={parentKey} />
      <TaskGroup label="最近" tasks={recent} state={state} store={store} level={level} parentKey={parentKey} />
    </>
  );
}

function moveTreeFocus(event: KeyboardEvent<HTMLElement>): void {
  const target = (event.target as Element).closest<HTMLButtonElement>("[data-workspace-tree-item='true']");
  if (!target) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-workspace-tree-item='true']"))
    .filter((item) => item.offsetParent !== null && item.closest("[aria-hidden='true']") === null);
  const index = items.indexOf(target);
  let next: HTMLButtonElement | undefined;
  if (event.key === "ArrowDown") next = items[index + 1] ?? items[0];
  if (event.key === "ArrowUp") next = items[index - 1] ?? items.at(-1);
  if (event.key === "Home") next = items[0];
  if (event.key === "End") next = items.at(-1);
  if (event.key === "ArrowRight") next = items.find((item) => item.dataset.parentKey === target.dataset.treeKey);
  if (event.key === "ArrowLeft" && target.dataset.parentKey) {
    next = items.find((item) => item.dataset.treeKey === target.dataset.parentKey);
  }
  if (!next) return;
  event.preventDefault();
  next.focus();
}

export function WorkspaceSidebar({
  state,
  store,
  onCreateProject,
  onOpenSearch,
  onOpenSettings,
  onOpenLibrary,
  settingsOpen = false,
  sidebarOpen = true,
  onToggleSidebar,
}: WorkspaceSidebarProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: SidebarMenuTarget } | null>(null);
  const activeChats = state.chats.filter((chat) => chat.status !== "archived");
  const archivedChats = sortSidebarTasks(state.chats.filter((chat) => chat.status === "archived"), state);

  useEffect(() => {
    if (state.projectId) setExpandedProjects((current) => new Set(current).add(state.projectId!));
  }, [state.projectId]);

  useEffect(() => {
    if (state.projectId && state.batchId) {
      setExpandedBatches((current) => new Set(current).add(batchKey(state.projectId!, state.batchId!)));
    }
  }, [state.batchId, state.projectId]);

  const openBatch = async (projectId: string, id: string): Promise<void> => {
    if (state.projectId !== projectId) await store.selectProject(projectId);
    await store.openBatch(projectId, id);
  };

  const openContextMenu = (event: ReactMouseEvent<HTMLElement>): void => {
    const row = (event.target as Element).closest<HTMLButtonElement>("[data-workspace-tree-item='true']");
    if (!row) return;
    event.preventDefault();
    const kind = row.dataset.treeKind;
    const key = row.dataset.treeKey ?? "";
    let target: SidebarMenuTarget | null = null;
    if (kind === "project") {
      target = { kind: "project", projectId: key.replace(/^project:/, "") };
    } else if (kind === "batch") {
      const [, projectId, batchId] = key.split(":");
      if (projectId && batchId) target = { kind: "batch", projectId, batchId };
    } else if (kind === "task") {
      const taskId = key.replace(/^task:/, "");
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (task?.owner.kind === "project") target = { kind: "task", projectId: task.owner.projectId, taskId };
    } else if (kind === "chat") {
      const taskId = key.replace(/^chat:/, "");
      if (state.chats.some((candidate) => candidate.id === taskId)) target = { kind: "chat", taskId };
    }
    if (target) setContextMenu({ x: event.clientX, y: event.clientY, target });
  };

  const dismissMobileOverlayAfterNavigation = (event: ReactMouseEvent<HTMLElement>): void => {
    if (!sidebarOpen || !onToggleSidebar || !window.matchMedia("(max-width: 760px)").matches) return;
    const control = (event.target as Element).closest<HTMLButtonElement>("[data-sidebar-navigation='true']");
    if (!control || control.disabled) return;
    onToggleSidebar();
  };

  return (
    <aside className="workspace-sidebar" aria-label="项目导航" onClickCapture={dismissMobileOverlayAfterNavigation}>
      <div className="workspace-sidebar-chrome" aria-label="侧边栏控制">
        {onToggleSidebar && sidebarOpen ? (
          <IconButton
            className="workspace-sidebar-toggle"
            aria-label="隐藏项目侧边栏"
            title="隐藏项目侧边栏"
            onClick={onToggleSidebar}
          >
            <PanelLeftClose aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      <header className="workspace-sidebar-header">
        <div className="workspace-sidebar-title">Linguist Agent</div>
        <div className="workspace-sidebar-header__actions">
          <IconButton data-sidebar-navigation="true" className="workspace-sidebar-new-chat" aria-label="新建 Chat" title="新建 Chat" onClick={() => void store.createChat()}>
            <SquarePen aria-hidden="true" />
          </IconButton>
          {onOpenSearch ? (
            <IconButton className="workspace-sidebar-search" aria-label="搜索项目与 Task" title="搜索（⌘K）" onClick={onOpenSearch}>
              <Search aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </header>
      <nav className="workspace-sidebar-actions" aria-label="工作区目的地">
        {onOpenLibrary ? (
          <button type="button" data-sidebar-navigation="true" onClick={onOpenLibrary}>
            <LibraryBig aria-hidden="true" />
            <span>Library</span>
          </button>
        ) : null}
      </nav>
      <div className="workspace-sidebar-section-heading">
        <span>Chats</span>
      </div>
      <nav
        className="workspace-chat-list"
        aria-label="无项目 Chats"
        aria-busy={state.chatsState === "loading"}
        onKeyDown={moveTreeFocus}
        onContextMenu={openContextMenu}
      >
        {state.chatsState === "loading" ? <p className="workspace-sidebar-message">正在载入 Chats…</p> : null}
        {state.chatsState === "error" ? (
          <div className="workspace-sidebar-message" role="alert">
            <p>Chats 未能载入。</p>
            <Button variant="secondary" onClick={() => void store.refreshChats()}>重新载入</Button>
          </div>
        ) : null}
        <ul role="tree" aria-label="Chat 历史">
          <TaskBuckets tasks={activeChats} state={state} store={store} level={1} parentKey="chats" />
          <TaskGroup label="已归档" tasks={archivedChats} state={state} store={store} level={1} parentKey="chats" />
        </ul>
      </nav>
      <div className="workspace-sidebar-section-heading">
        <span>项目</span>
        {onCreateProject ? (
          <IconButton data-sidebar-navigation="true" aria-label="创建项目" title="创建项目" onClick={onCreateProject}>
            <Plus aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      <nav
        className="workspace-tree-scroll"
        aria-label="项目、批次和任务"
        aria-busy={state.projectsState === "loading" || state.tasksState === "loading"}
        onKeyDown={moveTreeFocus}
        onContextMenu={openContextMenu}
      >
        {state.projectsState === "loading" ? <p className="workspace-sidebar-message">正在载入项目…</p> : null}
        {state.projectsState === "error" ? (
          <div className="workspace-sidebar-message" role="alert">
            <p>项目未能载入。</p>
            <Button variant="secondary" onClick={() => void store.refreshProjects()}>重新载入</Button>
          </div>
        ) : null}
        <ul role="tree" aria-label="工作层级">
          {state.projects.map((project) => {
            const expanded = expandedProjects.has(project.projectId);
            const selectedProject = state.projectId === project.projectId;
            const exactProject = selectedProject && !state.batchId && !state.taskId;
            const projectTasks = selectedProject ? state.tasks : [];
            const knownBatchIds = new Set(project.batches.map((batch) => batch.batchId));
            const projectLevelTasks = projectTasks.filter((task) => (
              task.scope.kind === "project" && (!task.scope.batchId || !knownBatchIds.has(task.scope.batchId))
            ));
            const hasChildren = project.batches.length > 0 || projectLevelTasks.length > 0;
            return (
              <li key={project.projectId} role="none" className="workspace-project-node">
                  <button
                    type="button"
                    data-sidebar-navigation="true"
                    role="treeitem"
                    aria-level={1}
                    aria-expanded={hasChildren ? expanded : undefined}
                    aria-selected={exactProject}
                    aria-current={exactProject ? "page" : undefined}
                    className="workspace-tree-row workspace-project-row"
                    data-workspace-tree-item="true"
                    data-tree-key={projectKey(project.projectId)}
                    data-tree-kind="project"
                    onClick={() => {
                      if (hasChildren) setExpandedProjects((current) => {
                        const next = new Set(current);
                        if (next.has(project.projectId)) next.delete(project.projectId); else next.add(project.projectId);
                        return next;
                      });
                      if (!exactProject) void store.selectProject(project.projectId);
                    }}
                    onKeyDown={(event) => {
                      if (!hasChildren) return;
                      if (event.key === "ArrowRight" && !expanded) {
                        event.preventDefault();
                        event.stopPropagation();
                        setExpandedProjects((current) => new Set(current).add(project.projectId));
                      } else if (event.key === "ArrowLeft" && expanded) {
                        event.preventDefault();
                        event.stopPropagation();
                        setExpandedProjects((current) => {
                          const next = new Set(current);
                          next.delete(project.projectId);
                          return next;
                        });
                      }
                    }}
                  >
                    <span className="workspace-tree-leading" aria-hidden="true">
                      {expanded ? <FolderOpen className="workspace-folder-icon" /> : <Folder className="workspace-folder-icon" />}
                    </span>
                    <span className="workspace-tree-row-content">
                      <span className="workspace-tree-label">{project.name}</span>
                      <span className="workspace-tree-meta">{project.batches.length} 批次</span>
                    </span>
                    {hasChildren ? <ChevronRight className="workspace-disclosure" aria-hidden="true" /> : <span className="workspace-disclosure-spacer" />}
                  </button>
                <CollapsibleTreeGroup open={expanded} className="workspace-project-children">
                  <ul role="group">
                    {selectedProject && state.tasksState === "error" ? <li role="none" className="workspace-tree-note">Task 未能载入</li> : null}
                    {projectLevelTasks.length ? (
                      <li role="none" className="workspace-project-task-node">
                        <div className="workspace-tree-section-label">项目任务</div>
                        <ul role="group">
                          <TaskBuckets tasks={projectLevelTasks} state={state} store={store} level={2} parentKey={projectKey(project.projectId)} />
                        </ul>
                      </li>
                    ) : null}
                    {project.batches.map((batch) => {
                      const key = batchKey(project.projectId, batch.batchId);
                      const batchTasks = projectTasks.filter((task) => task.scope.kind === "project" && task.scope.batchId === batch.batchId);
                      const batchExpanded = expandedBatches.has(key);
                      const exactBatch = selectedProject && state.batchId === batch.batchId && !state.taskId;
                      return (
                        <li key={batch.batchId} role="none" className="workspace-batch-node">
                            <button
                              type="button"
                              data-sidebar-navigation="true"
                              role="treeitem"
                              aria-level={2}
                              aria-expanded={batchTasks.length ? batchExpanded : undefined}
                              aria-selected={exactBatch}
                              aria-current={exactBatch ? "page" : undefined}
                              className="workspace-tree-row workspace-batch-row"
                              data-workspace-tree-item="true"
                              data-tree-key={key}
                              data-parent-key={projectKey(project.projectId)}
                              data-tree-kind="batch"
                              title={batch.batchId}
                              onClick={() => {
                                if (batchTasks.length) setExpandedBatches((current) => {
                                  const next = new Set(current);
                                  if (next.has(key)) next.delete(key); else next.add(key);
                                  return next;
                                });
                                if (!exactBatch) void openBatch(project.projectId, batch.batchId);
                              }}
                              onKeyDown={(event) => {
                                if (!batchTasks.length) return;
                                if (event.key === "ArrowRight" && !batchExpanded) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setExpandedBatches((current) => new Set(current).add(key));
                                } else if (event.key === "ArrowLeft" && batchExpanded) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setExpandedBatches((current) => {
                                    const next = new Set(current);
                                    next.delete(key);
                                    return next;
                                  });
                                }
                              }}
                            >
                              <span className="workspace-tree-leading" aria-hidden="true"><FileText /></span>
                              <span className="workspace-tree-row-content">
                                <span className="workspace-tree-label">{batch.batchId}</span>
                                <span className="workspace-tree-meta">{batch.segments} 句段</span>
                              </span>
                              {batchTasks.length ? <ChevronRight className="workspace-disclosure" aria-hidden="true" /> : <span className="workspace-disclosure-spacer" />}
                            </button>
                          {batchTasks.length ? (
                            <CollapsibleTreeGroup open={batchExpanded} className="workspace-batch-children">
                              <ul role="group">
                              <TaskBuckets tasks={batchTasks} state={state} store={store} level={3} parentKey={key} />
                              </ul>
                            </CollapsibleTreeGroup>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </CollapsibleTreeGroup>
              </li>
            );
          })}
        </ul>
      </nav>
      {onOpenSettings ? (
        <footer className="workspace-sidebar-footer">
          <button
            type="button"
            data-sidebar-navigation="true"
            className="workspace-sidebar-settings"
            aria-current={settingsOpen ? "page" : undefined}
            onClick={onOpenSettings}
          >
            <span className="workspace-sidebar-settings__label"><Settings2 aria-hidden="true" />设置</span>
            <span aria-hidden="true">⌘,</span>
          </button>
        </footer>
      ) : null}
      {contextMenu ? (
        <SidebarContextMenu
          target={contextMenu.target}
          x={contextMenu.x}
          y={contextMenu.y}
          state={state}
          store={store}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </aside>
  );
}
