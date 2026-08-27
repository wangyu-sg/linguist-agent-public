import * as React from 'react'
import { ChevronRight, FolderOpen, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

export interface ProjectSessionTreeGroupHeaderProps {
  projectId: string
  name: string
  current: boolean
  collapsed: boolean
  onSelect: () => void
  onToggleCollapse?: () => void
  ariaLabel?: string
  title?: string
  icon?: React.ReactNode
  trailing?: React.ReactNode
  editor?: React.ReactNode
  actions?: React.ReactNode
  hint?: React.ReactNode
  draggable?: boolean
  onDragStart?: React.DragEventHandler<HTMLSpanElement>
  contextMenuItems?: React.ReactNode
  nameButtonClassName?: string
  /** null 表示会话列表由虚拟列表承载，当前 DOM 中没有可关联的控制区域。 */
  controlsId?: string | null
}

/**
 * Agent 与 Linguist 项目/会话树共用的紧凑项目头。
 *
 * 项目选择、折叠、菜单和排序的业务语义全部由调用方注入；这里仅负责
 * 两种模式必须一致的 DOM 密度、图标位置、当前项目标记与交互槽位。
 */
export function ProjectSessionTreeGroupHeader({
  projectId,
  name,
  current,
  collapsed,
  onSelect,
  onToggleCollapse,
  ariaLabel,
  title,
  icon,
  trailing,
  editor,
  actions,
  hint,
  draggable = false,
  onDragStart,
  contextMenuItems,
  nameButtonClassName,
  controlsId,
}: ProjectSessionTreeGroupHeaderProps): React.ReactElement {
  const sessionControlsId = controlsId === null
    ? undefined
    : controlsId ?? `project-sessions-${projectId}`
  const headerContent = (
    <>
      {draggable && (
        <span
          draggable
          onDragStart={onDragStart}
          title="拖拽排序"
          className="absolute -left-0.5 top-1/2 z-10 flex size-[18px] -translate-y-1/2 cursor-grab items-center justify-center text-foreground/20 opacity-0 transition-opacity group-hover/project:opacity-100 active:cursor-grabbing"
          aria-hidden="true"
        >
          <GripVertical size={12} />
        </span>
      )}

      {onToggleCollapse && (
        <button
          type="button"
          aria-label={`${collapsed ? '展开' : '折叠'}项目 ${name}`}
          aria-expanded={!collapsed}
          aria-controls={sessionControlsId}
          onClick={(event) => {
            event.stopPropagation()
            onToggleCollapse()
          }}
          className="absolute left-1 z-10 flex size-5 items-center justify-center rounded text-foreground/40 opacity-0 transition-opacity hover:bg-foreground/[0.055] group-hover/project:opacity-100"
        >
          <ChevronRight
            size={13}
            className={cn(
              'transition-transform duration-150',
              collapsed ? '-rotate-90' : 'rotate-90',
            )}
          />
        </button>
      )}

      {editor ? (
        <div
          className={cn(
            'relative flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 pl-[9px] pr-1 text-left titlebar-no-drag',
            onToggleCollapse && 'group-hover/project:pl-7',
            current ? 'agent-project-item-current text-foreground' : 'text-foreground/65',
          )}
        >
          {icon ?? <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />}
          {editor}
        </div>
      ) : (
        <button
          type="button"
          aria-label={ariaLabel ?? `打开项目 ${name}`}
          aria-current={current ? 'page' : undefined}
          aria-expanded={!collapsed}
          aria-controls={sessionControlsId}
          onClick={(event) => {
            event.stopPropagation()
            onSelect()
          }}
          title={title}
          className={cn(
            'relative flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 pl-[9px] pr-1 text-left transition-[padding,color,background-color] titlebar-no-drag hover:bg-foreground/[0.025]',
            onToggleCollapse && 'group-hover/project:pl-7',
            current
              ? 'agent-project-item-current text-foreground'
              : 'text-foreground/65 hover:text-foreground/88',
            nameButtonClassName,
          )}
        >
          {icon ?? <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />}
          <span className="flex min-w-0 items-center">
            <span className="min-w-0 truncate text-[13px] font-medium leading-[18px]">{name}</span>
            {current && <span className="workspace-selected-triangle flex-shrink-0" aria-hidden="true" />}
          </span>
          <span className="min-w-[4px] flex-1" aria-hidden="true" />
          {trailing}
        </button>
      )}

      {hint}
    </>
  )

  return (
    <div className="group/project relative flex translate-x-[2px] items-center">
      {contextMenuItems ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex min-w-0 flex-1 items-center">
              {headerContent}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-40 p-0.5">
            {contextMenuItems}
          </ContextMenuContent>
        </ContextMenu>
      ) : headerContent}
      {actions}
    </div>
  )
}
