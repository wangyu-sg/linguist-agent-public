import type { AgentThinkingLevel } from "../data/workspace-client.ts";
import { COMPOSER_POWER_LEVELS, thinkingLevelLabels } from "./composer-power.ts";

/* ============================================================
   Composer Slash 命令菜单纯模型(Codex spec 03 §5.1):
   草稿以 "/" 开头时弹出 cmdk 风格菜单,filter-as-you-type,
   ↑↓ 导航 + Enter 执行 + Esc 关闭(导航复用 command-model 的
   nextCommandIndex)。命令清单只列当前上下文真实可用的动作。
   ============================================================ */

export interface ComposerSlashCommand {
  id: string;
  title: string;
  detail: string;
  keywords: string;
  enabled: boolean;
  run: () => void;
}

export interface ComposerSlashSource {
  /** 选择模型弹层不可用(如追问专家时)则隐藏模型/级别命令。 */
  canPickRoute: boolean;
  canOpenSettings: boolean;
  canStop: boolean;
  canCompact: boolean;
  canFork: boolean;
  canCopyChat: boolean;
  currentThinkingLevel?: AgentThinkingLevel;
  actions: {
    openModelPicker: () => void;
    openSettings: () => void;
    stopRun: () => void;
    compact: () => void;
    fork: () => void;
    copyChat: () => void;
    setThinkingLevel: (level: AgentThinkingLevel | undefined) => void;
  };
}

/** 草稿是否处于 slash 触发态:以 "/" 开头、无换行。 */
export function slashQueryFromDraft(draft: string): string | null {
  if (!draft.startsWith("/") || /[\r\n]/.test(draft)) return null;
  return draft.slice(1);
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

export function composerSlashCommands(source: ComposerSlashSource): ComposerSlashCommand[] {
  const { actions } = source;
  const commands: ComposerSlashCommand[] = [
    {
      id: "model",
      title: "选择模型…",
      detail: "为下一次 Run 选择 Provider 与模型",
      keywords: "model provider 模型 选择",
      enabled: source.canPickRoute,
      run: actions.openModelPicker,
    },
    {
      id: "thinking-auto",
      title: "思考级别:使用默认值",
      detail: "清除当前 Task 的固定级别,回到默认设置",
      keywords: "thinking effort reset 思考 级别 复位 默认",
      enabled: source.canPickRoute && source.currentThinkingLevel !== undefined,
      run: () => actions.setThinkingLevel(undefined),
    },
    ...COMPOSER_POWER_LEVELS.map((level): ComposerSlashCommand => ({
      id: `thinking-${level}`,
      title: `思考级别:${thinkingLevelLabels[level]}`,
      detail: level === source.currentThinkingLevel ? "当前已固定为该级别" : "固定当前 Task 的思考级别,从下一条新 Run 生效",
      keywords: `thinking effort power 思考 级别 ${level} ${thinkingLevelLabels[level]}`,
      enabled: source.canPickRoute,
      run: () => actions.setThinkingLevel(level),
    })),
    {
      id: "stop",
      title: "停止当前 Run",
      detail: "中断正在进行的 Agent 运行(Esc)",
      keywords: "stop abort esc 停止 中断",
      enabled: source.canStop,
      run: actions.stopRun,
    },
    {
      id: "compact",
      title: "压缩当前分支上下文",
      detail: "压缩当前对话分支的 Pi session 上下文",
      keywords: "compact context 压缩 上下文",
      enabled: source.canCompact,
      run: actions.compact,
    },
    {
      id: "fork",
      title: "从这里分支",
      detail: "以当前分支位置为起点创建新分支",
      keywords: "fork branch 分支",
      enabled: source.canFork,
      run: actions.fork,
    },
    {
      id: "copy-chat",
      title: "复制为新 Chat",
      detail: "把当前对话复制成一个独立的新 Chat",
      keywords: "copy duplicate chat 复制 新 对话",
      enabled: source.canCopyChat,
      run: actions.copyChat,
    },
    {
      id: "settings",
      title: "打开模型与能力设置",
      detail: "Provider、能力连接与权限设置",
      keywords: "settings preferences 设置 模型 能力",
      enabled: source.canOpenSettings,
      run: actions.openSettings,
    },
  ];
  return commands.filter((command) => command.enabled);
}

function slashScore(command: ComposerSlashCommand, query: string): number | null {
  const title = normalized(command.title);
  const searchable = `${title} ${normalized(command.detail)} ${normalized(command.keywords)}`;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (!tokens.every((token) => searchable.includes(token))) return null;
  if (title === query) return 0;
  if (title.startsWith(query)) return 10;
  if (title.includes(query)) return 20;
  return 30;
}

/** filter-as-you-type:空查询返回全部可用命令,保持原始顺序。 */
export function filterComposerSlashCommands(
  commands: readonly ComposerSlashCommand[],
  rawQuery: string,
): ComposerSlashCommand[] {
  const query = normalized(rawQuery);
  return commands
    .map((command, index) => ({ command, index, match: query ? slashScore(command, query) : 0 }))
    .filter((result): result is { command: ComposerSlashCommand; index: number; match: number } => result.match !== null)
    .sort((left, right) => left.match - right.match || left.index - right.index)
    .map(({ command }) => command);
}
