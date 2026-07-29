import {
  Archive,
  ArrowDown,
  ArrowUp,
  FolderOpen,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Settings,
  Trash2,
} from 'lucide-react'
import type { LinguistProjectInfo } from '@proma/shared'
import {
  ContextMenuItem,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface LinguistProjectActionsMenuProps {
  project: LinguistProjectInfo
  onOpen: () => void
  onCreateSession?: () => void
  onRename?: () => void
  onArchive?: () => void
  onOpenSettings: () => void
  onDelete?: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
}

export function LinguistProjectActionItems({
  project,
  onOpen,
  onCreateSession,
  onRename,
  onArchive,
  onOpenSettings,
  onDelete,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  variant,
}: LinguistProjectActionsMenuProps & {
  variant: 'context' | 'dropdown'
}): React.ReactElement {
  const Item = variant === 'context' ? ContextMenuItem : DropdownMenuItem
  const archived = project.archivedAt !== undefined
  return (
    <>
      {archived ? (
        <Item className="py-1 text-xs" onSelect={onOpen}>
          <FolderOpen size={14} />
          只读打开
        </Item>
      ) : (
        <>
          <Item className="py-1 text-xs" onSelect={onCreateSession}>
            <MessageSquarePlus size={14} />
            新建会话
          </Item>
          <Item className="py-1 text-xs" onSelect={onRename}>
            <Pencil size={14} />
            重命名
          </Item>
          <Item className="py-1 text-xs" disabled={!canMoveUp} onSelect={onMoveUp}>
            <ArrowUp size={14} />
            上移项目
          </Item>
          <Item className="py-1 text-xs" disabled={!canMoveDown} onSelect={onMoveDown}>
            <ArrowDown size={14} />
            下移项目
          </Item>
        </>
      )}
      <Item className="py-1 text-xs" onSelect={onOpenSettings}>
        <Settings size={14} />
        项目设置
      </Item>
      {archived ? (
        <Item className="py-1 text-xs text-destructive" onSelect={onDelete}>
          <Trash2 size={14} />
          删除项目
        </Item>
      ) : (
        <Item className="py-1 text-xs text-destructive" onSelect={onArchive}>
          <Archive size={14} />
          归档项目
        </Item>
      )}
    </>
  )
}

export function LinguistProjectActionsMenu(
  props: LinguistProjectActionsMenuProps,
): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`管理项目 ${props.project.name}`}
          className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/35 opacity-0 transition-colors hover:bg-foreground/[0.055] hover:text-foreground/65 group-hover/project:opacity-100 data-[state=open]:opacity-100 titlebar-no-drag"
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[9999] w-40 p-0.5">
        <LinguistProjectActionItems {...props} variant="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
