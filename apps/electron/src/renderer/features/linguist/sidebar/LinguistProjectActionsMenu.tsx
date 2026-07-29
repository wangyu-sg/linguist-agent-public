import { FolderOpen, MessageSquarePlus, MoreHorizontal, Settings } from 'lucide-react'
import type { LinguistProjectInfo } from '@proma/shared'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface LinguistProjectActionsMenuProps {
  project: LinguistProjectInfo
  onOpen: () => void
  onCreateSession: () => void
  onOpenSettings: () => void
  children: React.ReactNode
}

export function LinguistProjectActionsMenu({
  project,
  onOpen,
  onCreateSession,
  onOpenSettings,
  children,
}: LinguistProjectActionsMenuProps): React.ReactElement {
  const items = (variant: 'context' | 'dropdown'): React.ReactElement => {
    const Item = variant === 'context' ? ContextMenuItem : DropdownMenuItem
    return (
      <>
        <Item className="py-1 text-xs" onSelect={onOpen}>
          <FolderOpen size={14} />
          打开项目
        </Item>
        <Item className="py-1 text-xs" onSelect={onCreateSession}>
          <MessageSquarePlus size={14} />
          新建助理会话
        </Item>
        <Item className="py-1 text-xs" onSelect={onOpenSettings}>
          <Settings size={14} />
          项目设置
        </Item>
      </>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex items-center">
          {children}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`管理项目 ${project.name}`}
                className="mr-1 flex size-7 flex-shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <MoreHorizontal size={14} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 p-0.5">
              {items('dropdown')}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40 p-0.5">
        {items('context')}
      </ContextMenuContent>
    </ContextMenu>
  )
}
