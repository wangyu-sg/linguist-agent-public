import { Terminal } from "lucide-react";
import type { ComposerSlashCommand } from "./slash-commands.ts";

/* ============================================================
   Slash 命令菜单(Codex spec 03 §5.1 cmdk 像素规格):
   - 容器圆角 16px + elevation 阴影,锚定在 composer 上方
   - item min-height 24px、padding 4~5px/8px、圆角 12px(radius-lg)
   - 选中态 list-hover 背景;列表 max-height min(300px, …)
   - 键盘 ↑↓ + Enter + Esc 由 composer 的 textarea onKeyDown 驱动
   ============================================================ */

export function ComposerSlashMenu({
  commands,
  listId,
  query,
  selectedIndex,
  onRun,
  onSelectIndex,
}: {
  commands: ComposerSlashCommand[];
  listId: string;
  query: string;
  selectedIndex: number;
  onRun: (command: ComposerSlashCommand) => void;
  onSelectIndex: (index: number) => void;
}) {
  return (
    <div className="agent-composer__slash-menu" role="presentation">
      <div className="agent-composer__slash-menu-header" aria-hidden="true">
        <Terminal />
        <span>命令</span>
        {query ? <span className="agent-composer__slash-menu-query">/{query}</span> : null}
      </div>
      <div
        className="agent-composer__slash-menu-list"
        id={listId}
        role="listbox"
        aria-label="Slash 命令菜单"
      >
        {commands.length === 0 ? (
          <div className="agent-composer__slash-menu-empty" role="status">没有匹配的命令</div>
        ) : commands.map((command, index) => (
          <div
            key={command.id}
            id={`${listId}-option-${command.id}`}
            role="option"
            aria-selected={index === selectedIndex}
            className="agent-composer__slash-item"
            data-selected={index === selectedIndex || undefined}
            onMouseEnter={() => onSelectIndex(index)}
            onMouseDown={(event) => {
              // 保持 textarea 焦点,键盘态不丢;click 再真正执行。
              event.preventDefault();
            }}
            onClick={() => onRun(command)}
          >
            <span className="agent-composer__slash-item-title">{command.title}</span>
            <span className="agent-composer__slash-item-detail">{command.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
