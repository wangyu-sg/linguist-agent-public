import { Archive, ArchiveRestore, ArrowRightLeft, MessageSquare, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
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
  transferLabel?: string
  transferDisabledReason?: string
  historyOnly?: boolean
  onReference: () => void
  onTogglePin: (cascade: boolean) => void
  onMove?: () => void
  onRename: () => void
  onToggleArchive: () => void
  onDelete: () => void
}

export function getAgentSessionTransferLabel(label?: string): string {
  return label ?? '迁移到其他项目'
}

export function getAgentSessionTransferPresentation({
  canMove,
  transferLabel,
  hasAction,
  disabledReason,
}: {
  canMove: boolean
  transferLabel?: string
  hasAction: boolean
  disabledReason?: string
}): {
  visible: boolean
  disabled: boolean
  label: string
  disabledReason?: string
} {
  const disabled = !canMove
  return {
    // 普通 Agent 沿用原行为：运行中不显示迁移。Linguist 注入复制语义后
    // 始终保留入口，避免用户误以为不支持跨项目复制。
    visible: hasAction && (canMove || transferLabel !== undefined),
    disabled,
    label: getAgentSessionTransferLabel(transferLabel),
    disabledReason: disabled ? disabledReason : undefined,
  }
}

export function AgentSessionActionsMenu({
  variant,
  session,
  childCount = 0,
  canMove = false,
  transferLabel,
  transferDisabledReason,
  historyOnly = false,
  onReference,
  onTogglePin,
  onMove,
  onRename,
  onToggleArchive,
  onDelete,
}: AgentSessionActionsMenuProps): React.ReactElement {
  const Item = variant === 'context' ? ContextMenuItem : DropdownMenuItem
  const Separator = variant === 'context' ? ContextMenuSeparator : DropdownMenuSeparator
  const pinLabel = session.pinned ? '取消置顶' : '置顶会话'
  const transfer = getAgentSessionTransferPresentation({
    canMove,
    transferLabel,
    hasAction: onMove !== undefined,
    disabledReason: transferDisabledReason,
  })

  return (
    <>
      <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={onReference}>
        <MessageSquare size={14} />
        引用此会话
      </Item>
      <Separator className="my-0.5" />
      {!historyOnly && (childCount > 0 ? (
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
      ))}
      {transfer.visible && (
        <Item
          className="py-1 text-xs [&>svg]:size-3.5"
          disabled={transfer.disabled}
          title={transfer.disabledReason}
          aria-label={transfer.disabledReason
            ? `${transfer.label}：${transfer.disabledReason}`
            : transfer.label}
          onSelect={transfer.disabled ? undefined : onMove}
        >
          <ArrowRightLeft size={14} />
          {transfer.label}
          {transfer.disabledReason && <span className="sr-only">：{transfer.disabledReason}</span>}
        </Item>
      )}
      {!historyOnly && (
        <>
          <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={onRename}>
            <Pencil size={14} />
            重命名
          </Item>
          <Item className="py-1 text-xs [&>svg]:size-3.5" onSelect={onToggleArchive}>
            {session.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {session.archived ? '取消归档' : '归档'}
          </Item>
        </>
      )}
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
