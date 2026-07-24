import type { TaskRecord } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { ProjectSummary } from "../data/workspace-client.ts";

export type CommandIcon = "batch" | "cat" | "conversation" | "import" | "project" | "settings" | "task";

export type CommandSelection =
  | { kind: "create-chat" }
  | { kind: "create-project" }
  | { kind: "import-batch"; projectId: string }
  | { kind: "open-settings" }
  | { kind: "show-conversation" }
  | { kind: "show-cat" }
  | { kind: "open-project"; projectId: string }
  | { kind: "open-batch"; projectId: string; batchId: string }
  | { kind: "open-task"; projectId: string; taskId: string }
  | { kind: "open-chat"; taskId: string };

export interface CommandItem {
  id: string;
  type: "命令" | "项目" | "Batch" | "Task" | "Chat";
  title: string;
  detail: string;
  icon: CommandIcon;
  priority: number;
  keywords: string;
  selection: CommandSelection;
}

export interface CommandSource {
  projects: readonly ProjectSummary[];
  tasks: readonly TaskRecord[];
  chats?: readonly TaskRecord[];
  projectId: string | null;
  batchId: string | null;
  taskId: string | null;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function projectName(projects: readonly ProjectSummary[], projectId: string): string {
  return projects.find((project) => project.projectId === projectId)?.name ?? projectId;
}

export function commandItems(source: CommandSource): CommandItem[] {
  const selectedProject = source.projects.find((project) => project.projectId === source.projectId);
  const chats = source.chats ?? [];
  const selectedTask = [...source.tasks, ...chats].find((task) => task.id === source.taskId);
  const items: CommandItem[] = [
    {
      id: "command:create-chat",
      type: "命令",
      title: "新建 Chat",
      detail: "开始一个不属于任何项目的通用 Agent 对话",
      icon: "conversation",
      priority: -10,
      keywords: "new chat 无项目 对话 command n",
      selection: { kind: "create-chat" },
    },
    {
      id: "command:create-project",
      type: "命令",
      title: "创建项目",
      detail: "登记项目元数据并选择本机文件夹",
      icon: "project",
      priority: 0,
      keywords: "新建 project command n",
      selection: { kind: "create-project" },
    },
    {
      id: "command:settings",
      type: "命令",
      title: "打开设置",
      detail: "模型、能力连接、通知、权限与高级设置",
      icon: "settings",
      priority: 40,
      keywords: "偏好 preferences command comma",
      selection: { kind: "open-settings" },
    },
  ];

  if (selectedProject) {
    items.splice(1, 0, {
      id: "command:import-batch",
      type: "命令",
      title: "导入 Batch",
      detail: `${selectedProject.name} / 使用系统文件选择器`,
      icon: "import",
      priority: 10,
      keywords: "批次 文件 import command shift i",
      selection: { kind: "import-batch", projectId: selectedProject.projectId },
    });
  }

  if (selectedTask) {
    const selectedProjectId = selectedTask.owner.kind === "project" ? selectedTask.owner.projectId : null;
    const selectedBatchId = selectedTask.scope.kind === "project" ? selectedTask.scope.batchId ?? null : null;
    const scope = [selectedProjectId ? projectName(source.projects, selectedProjectId) : "无项目 Chat", selectedBatchId, selectedTask.title]
      .filter(Boolean)
      .join(" / ");
    items.splice(selectedProject ? 2 : 1, 0,
      {
        id: "command:show-conversation",
        type: "命令",
        title: "打开当前 Task 对话",
        detail: scope,
        icon: "conversation",
        priority: 20,
        keywords: "main agent 聊天 conversation command 1",
        selection: { kind: "show-conversation" },
      },
      ...(selectedBatchId ? [{
        id: "command:show-cat",
        type: "命令" as const,
        title: "打开当前 Task CAT",
        detail: scope,
        icon: "cat" as const,
        priority: 30,
        keywords: "翻译 编辑 句段 cat command 2",
        selection: { kind: "show-cat" as const },
      }] : []),
    );
  }

  for (const project of source.projects) {
    items.push({
      id: `project:${project.projectId}`,
      type: "项目",
      title: project.name,
      detail: `${project.batches.length} 个 Batch / ${project.assetCount} 项资料`,
      icon: "project",
      priority: project.projectId === source.projectId ? 100 : 120,
      keywords: project.projectId,
      selection: { kind: "open-project", projectId: project.projectId },
    });
    for (const batch of project.batches) {
      items.push({
        id: `batch:${project.projectId}:${batch.batchId}`,
        type: "Batch",
        title: batch.batchId,
        detail: `${project.name} / ${batch.sourceLanguage} → ${batch.targetLanguage} / ${batch.segments} 句段`,
        icon: "batch",
        priority: project.projectId === source.projectId && batch.batchId === source.batchId ? 140 : 160,
        keywords: `${project.projectId} ${project.name} ${batch.format} ${batch.sourceLanguage} ${batch.targetLanguage}`,
        selection: { kind: "open-batch", projectId: project.projectId, batchId: batch.batchId },
      });
    }
  }

  for (const task of source.tasks) {
    if (task.owner.kind !== "project" || task.scope.kind !== "project") continue;
    const projectId = task.owner.projectId;
    const project = projectName(source.projects, projectId);
    items.push({
      id: `task:${projectId}:${task.id}`,
      type: "Task",
      title: task.title,
      detail: [project, task.scope.batchId ?? "项目级 Task"].join(" / "),
      icon: "task",
      priority: task.id === source.taskId ? 180 : 200,
      keywords: `${task.id} ${task.intent} ${task.kind} ${task.status} ${task.scope.sourceLocale ?? ""} ${task.scope.targetLocale ?? ""}`,
      selection: { kind: "open-task", projectId, taskId: task.id },
    });
  }

  for (const chat of chats) {
    if (chat.owner.kind !== "standalone") continue;
    items.push({
      id: `chat:${chat.id}`,
      type: "Chat",
      title: chat.title,
      detail: "无项目 Chat",
      icon: "conversation",
      priority: chat.id === source.taskId && source.projectId === null ? 170 : 190,
      keywords: `${chat.id} ${chat.intent} ${chat.status} general chat`,
      selection: { kind: "open-chat", taskId: chat.id },
    });
  }

  return items;
}

export function mergeCommandTasks(...groups: ReadonlyArray<readonly TaskRecord[]>): TaskRecord[] {
  const tasks = new Map<string, TaskRecord>();
  for (const group of groups) {
    for (const task of group) {
      const key = task.owner.kind === "project" ? `project:${task.owner.projectId}:${task.id}` : `standalone:${task.id}`;
      const current = tasks.get(key);
      if (!current || task.updatedAt > current.updatedAt) tasks.set(key, task);
    }
  }
  return [...tasks.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function score(item: CommandItem, query: string): number | null {
  const title = normalized(item.title);
  const detail = normalized(item.detail);
  const searchable = `${title} ${detail} ${normalized(item.type)} ${normalized(item.keywords)}`;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (!tokens.every((token) => searchable.includes(token))) return null;
  if (title === query) return 0;
  if (title.startsWith(query)) return 10;
  if (title.includes(query)) return 20;
  if (detail.includes(query)) return 30;
  return 40;
}

export function searchCommands(items: readonly CommandItem[], value: string): CommandItem[] {
  const query = normalized(value);
  return items
    .map((item, index) => ({ item, index, match: query ? score(item, query) : 0 }))
    .filter((result): result is { item: CommandItem; index: number; match: number } => result.match !== null)
    .sort((left, right) => left.match - right.match || left.item.priority - right.item.priority || left.index - right.index)
    .map(({ item }) => item);
}

export interface CommandResultGroup {
  type: CommandItem["type"];
  items: Array<CommandItem & { index: number }>;
}

/* cmdk 分组顺序:命令优先,其后按工作层级(Chat → 项目 → Batch → Task)。 */
const commandGroupOrder: CommandItem["type"][] = ["命令", "Chat", "项目", "Batch", "Task"];

export function groupCommandResults(results: readonly CommandItem[]): CommandResultGroup[] {
  const groups = new Map<CommandItem["type"], CommandResultGroup>();
  results.forEach((item, index) => {
    let group = groups.get(item.type);
    if (!group) {
      group = { type: item.type, items: [] };
      groups.set(item.type, group);
    }
    group.items.push({ ...item, index });
  });
  return [...groups.values()].sort(
    (left, right) => commandGroupOrder.indexOf(left.type) - commandGroupOrder.indexOf(right.type),
  );
}

export function nextCommandIndex(current: number, key: string, length: number): number {
  if (length <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return current < 0 || current >= length - 1 ? 0 : current + 1;
  if (key === "ArrowUp") return current <= 0 ? length - 1 : current - 1;
  return Math.min(Math.max(current, 0), length - 1);
}
