import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import {
  FileText,
  Folder,
  FolderInput,
  Languages,
  MessageSquareText,
  Search,
  Settings2,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import type { TaskRecord } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import { workspaceClient } from "../data/workspace-client.ts";
import type { WorkspaceStore } from "../data/workspace-store.ts";
import { IconButton } from "../ui/index.ts";
import { commandItems, mergeCommandTasks, nextCommandIndex, searchCommands, type CommandIcon, type CommandSelection } from "./command-model.ts";
import "./command-palette.css";

const taskCache = new Map<string, TaskRecord[]>();

const icons: Record<CommandIcon, LucideIcon> = {
  batch: FileText,
  cat: Languages,
  conversation: MessageSquareText,
  import: FolderInput,
  project: Folder,
  settings: Settings2,
  task: SquarePen,
};

export interface CommandPaletteProps {
  store: WorkspaceStore;
  onDismiss: () => void;
  onSelect: (selection: CommandSelection) => void;
}

export function CommandPalette({ store, onDismiss, onSelect }: CommandPaletteProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectTasks, setProjectTasks] = useState<Record<string, TaskRecord[]>>(() => Object.fromEntries(taskCache));
  const [taskLoadState, setTaskLoadState] = useState<"loading" | "ready" | "partial">("loading");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  const listId = useId();
  const allTasks = useMemo(() => {
    const projectIds = new Set(state.projects.map((project) => project.projectId));
    return mergeCommandTasks(state.tasks, ...Object.values(projectTasks)).filter((task) => (
      task.owner.kind === "project" && projectIds.has(task.owner.projectId)
    ));
  }, [projectTasks, state.projects, state.tasks]);
  const items = useMemo(() => commandItems({ ...state, tasks: allTasks, chats: state.chats }), [allTasks, state]);
  const results = useMemo(() => searchCommands(items, query), [items, query]);
  const requestedIndex = activeId ? results.findIndex((item) => item.id === activeId) : -1;
  const resolvedActiveIndex = requestedIndex >= 0 ? requestedIndex : results.length ? 0 : -1;
  const activeResult = results[resolvedActiveIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      const target = previousFocus.current;
      if (restoreFocus.current && target?.isConnected) target.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let failures = 0;
    setTaskLoadState(state.projects.length ? "loading" : "ready");
    void Promise.all(state.projects.map(async (project) => {
      try {
        const { tasks } = await workspaceClient.listTasks(project.projectId);
        if (cancelled) return;
        taskCache.set(project.projectId, tasks);
        setProjectTasks((current) => ({ ...current, [project.projectId]: tasks }));
      } catch {
        failures += 1;
      }
    })).then(() => {
      if (!cancelled) setTaskLoadState(failures ? "partial" : "ready");
    });
    return () => { cancelled = true; };
  }, [state.projects]);

  useEffect(() => {
    if (!activeResult) return;
    document.getElementById(`command-result-${resolvedActiveIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeResult, resolvedActiveIndex]);

  const choose = (selection: CommandSelection) => {
    restoreFocus.current = false;
    onDismiss();
    onSelect(selection);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = nextCommandIndex(resolvedActiveIndex, event.key, results.length);
      setActiveId(results[next]?.id ?? null);
      inputRef.current?.focus();
      return;
    }
    if (event.key === "Enter" && event.target === inputRef.current && activeResult) {
      event.preventDefault();
      choose(activeResult.selection);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="command-palette"
      aria-label="搜索项目、Batch、Task 或命令"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="command-palette__query">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded="true"
          aria-activedescendant={activeResult ? `command-result-${resolvedActiveIndex}` : undefined}
          aria-label="搜索项目、Batch、Task 或命令"
          placeholder="搜索项目、Batch、Task 或命令"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
          }}
        />
        <IconButton size="compact" aria-label="关闭命令面板" onClick={onDismiss}><X /></IconButton>
      </div>

      <div className="command-palette__results" id={listId} role="listbox" aria-label="搜索结果">
        {results.length ? results.map((item, index) => {
          const Icon = icons[item.icon];
          return (
            <button
              key={item.id}
              id={`command-result-${index}`}
              type="button"
              role="option"
              aria-selected={index === resolvedActiveIndex}
              aria-label={`${item.type}，${item.title}，${item.detail}`}
              title={`${item.type} · ${item.title}\n${item.detail}`}
              data-active={index === resolvedActiveIndex || undefined}
              className="command-palette__result"
              onPointerMove={() => setActiveId(item.id)}
              onFocus={() => setActiveId(item.id)}
              onClick={() => choose(item.selection)}
            >
              <span className="command-palette__result-icon"><Icon aria-hidden="true" /></span>
              <span className="command-palette__result-copy">
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </span>
              <span className="command-palette__result-type">{item.type}</span>
            </button>
          );
        }) : (
          <p className="command-palette__empty" role="status">没有匹配的项目、Batch、Task 或命令。</p>
        )}
      </div>

      <footer className="command-palette__footer">
        <span className="command-palette__load-state" role="status" aria-live="polite">
          {taskLoadState === "loading" ? "正在载入全部项目的 Task…" : taskLoadState === "partial" ? "部分 Task 未载入；当前结果仍可用，重新打开可重试" : ""}
        </span>
        <span aria-hidden="true">↑↓ 选择</span>
        <span aria-hidden="true">Return 打开</span>
        <span aria-hidden="true">Esc 关闭</span>
      </footer>
    </dialog>
  );
}
