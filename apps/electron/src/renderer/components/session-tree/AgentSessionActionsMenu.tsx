import { Archive, ArchiveRestore, ArrowRightLeft, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import type { AgentSessionMeta } from '@proma/shared'
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

interface AgentSessionActionsMenuProps {
  variant: 'context' | 'dropdown'
  session: Pick<AgentSessionMeta, 'pinned' | 'archived'>
  childCount?: number
  canMove?: boolean
  onTogglePin: (cascade: boolean) => void
  onMove?: () => void
  onRename: () => void
  onToggleArchive: () => void
  onDelete: () => void
}

export function AgentSessionActionsMenu({
  variant,
  session,
  childCount = 0,
  canMove = false,
  onTogglePin,
  onMove,
  onRename,
  onToggleArchive,
  onDelete,
}: AgentSessionActionsMenuProps): React.ReactElement {
  const Item = variant === 'context' ? ContextMenuItem : DropdownMenuItem
  const Separator = variant === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
  const pinLabel = session.pinned ? '取消置顶' : '置顶会话'

  return (
    <>
      {childCount > 0 ? (
        <>
          <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={() => onTogglePin(false)}>
            {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            仅{pinLabel}
          </Item>
          <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={() => onTogglePin(true)}>
            {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {session.pinned ? '取消置顶' : '置顶会话'}(含 {childCount} 个子会话)
          </Item>
        </>
      ) : (
        <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={() => onTogglePin(true)}>
          {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
          {pinLabel}
        </Item>
      )}
      {canMove && onMove && (
        <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={onMove}>
          <ArrowRightLeft size={14} />
          迁移到其他项目
        </Item>
      )}
      <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={onRename}>
        <Pencil size={14} />
        重命名
      </Item>
      <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={onToggleArchive}>
        {session.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
        {session.archived ? '取消归档' : '归档'}
      </Item>
      <Separator className="my-0.5" />
      <Item
        className="py-1 text-xs text-destructive [&>svg]:size-3.5"
        onSelect={onDelete}
      >
        <Trash2 size={14} />
        删除会话
      </Item>
    </>
  )
}
