import * as React from 'react'
import { MessageSquare, MoreHorizontal, Pin } from 'lucide-react'
import type { AgentSessionMeta } from '@proma/shared'
import { AgentSessionActionsMenu } from '@/components/session-tree/AgentSessionActionsMenu'
import {
  AgentSessionTreeItem,
  type AgentSessionTreeItemHandle,
} from '@/components/session-tree/AgentSessionTreeItem'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface LinguistSessionTreeItemProps {
  session: AgentSessionMeta
  selected: boolean
  onSelect: () => void
  onRename: (title: string) => void | Promise<void>
  onTogglePin: () => void | Promise<void>
  onToggleArchive: () => void | Promise<void>
  onDelete: () => void
}

export function LinguistSessionTreeItem({
  session,
  selected,
  onSelect,
  onRename,
  onTogglePin,
  onToggleArchive,
  onDelete,
}: LinguistSessionTreeItemProps): React.ReactElement {
  const itemRef = React.useRef<AgentSessionTreeItemHandle>(null)
  const actions = (variant: 'context' | 'dropdown'): React.ReactElement => (
    <AgentSessionActionsMenu
      variant={variant}
      session={session}
      onTogglePin={() => { void onTogglePin() }}
      onRename={() => itemRef.current?.startRename()}
      onToggleArchive={() => { void onToggleArchive() }}
      onDelete={onDelete}
    />
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex items-center rounded-lg transition-colors',
            selected
              ? 'bg-primary/[0.1] text-foreground'
              : 'text-foreground/55 hover:bg-foreground/[0.05] hover:text-foreground/75',
          )}
        >
          <AgentSessionTreeItem
            ref={itemRef}
            session={session}
            ariaLabel={`选择会话 ${session.title}`}
            ariaCurrent={selected}
            onSelect={onSelect}
            onRename={onRename}
            buttonClassName="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            inputClassName="ml-2.5 px-0 py-1.5 text-xs"
            beforeTitle={session.pinned
              ? <Pin size={12} className="flex-shrink-0" aria-hidden="true" />
              : <MessageSquare size={12} className="flex-shrink-0" aria-hidden="true" />}
            afterTitle={(
              <>
                {session.linguistSessionRole === 'reviewer' && (
                  <span className="flex-shrink-0 rounded-full bg-review/10 px-1.5 py-0.5 text-[10px] text-review">
                    评审
                  </span>
                )}
                {session.linguistSessionRole === 'auditor' && (
                  <span className="flex-shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    盲审
                  </span>
                )}
              </>
            )}
            actions={(
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`管理会话 ${session.title}`}
                    className="mr-1 flex size-7 flex-shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40 p-0.5">
                  {actions('dropdown')}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 p-0.5">
        {actions('context')}
      </ContextMenuContent>
    </ContextMenu>
  )
}
