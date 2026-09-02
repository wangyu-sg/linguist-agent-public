/** 折叠侧栏的项目快速切换弹层；Agent 与 Linguist 共用悬停、列表和焦点行为。 */

import * as React from 'react'
import { FolderInput, FolderOpen, Plus } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useProjectActions } from '@/hooks/useProjectActions'
import { cn } from '@/lib/utils'
import { LocalProjectBadge } from './LocalProjectBadge'

const HOVER_CLOSE_DELAY = 150

interface CollapsedProjectPopoverItem {
  id: string
  name: string
  trailing?: React.ReactNode
}

interface CollapsedProjectPopoverProps {
  children: React.ReactNode
  title: string
  items: readonly CollapsedProjectPopoverItem[]
  currentProjectId?: string | null
  emptyLabel: string
  onSelect: (projectId: string) => void
  onCreate?: (name: string) => Promise<boolean>
  onCreateFromFolder?: () => void
  onCreateRequested?: () => void
}

export function CollapsedProjectPopover({
  children,
  title,
  items,
  currentProjectId,
  emptyLabel,
  onSelect,
  onCreate,
  onCreateFromFolder,
  onCreateRequested,
}: CollapsedProjectPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const closeTimerRef = React.useRef<number | null>(null)
  const createInputRef = React.useRef<HTMLInputElement>(null)

  const cancelClose = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = React.useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY)
  }, [cancelClose])

  React.useEffect(() => () => cancelClose(), [cancelClose])

  const handleStartCreate = (event: React.MouseEvent): void => {
    event.stopPropagation()
    if (onCreateRequested !== undefined) {
      onCreateRequested()
      setOpen(false)
      return
    }
    setCreating(true)
    setNewName('')
    requestAnimationFrame(() => createInputRef.current?.focus())
  }

  const handleCreate = async (): Promise<void> => {
    const trimmed = newName.trim()
    if (!trimmed || onCreate === undefined) {
      setCreating(false)
      return
    }
    const created = await onCreate(trimmed)
    setCreating(false)
    if (created) setOpen(false)
  }

  const handleCreateKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter') {
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      void handleCreate()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setCreating(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      if (!nextOpen) setCreating(false)
    }}>
      <PopoverAnchor asChild>
        <span
          onMouseEnter={() => {
            cancelClose()
            setOpen(true)
          }}
          onMouseLeave={scheduleClose}
          onClickCapture={() => {
            cancelClose()
            setOpen(false)
          }}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-56 overflow-hidden p-0"
        onMouseEnter={cancelClose}
        onMouseLeave={() => {
          if (!creating) scheduleClose()
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between border-b border-border/40 px-2.5 py-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">
            {title}
          </span>
          <div className="flex items-center gap-0.5">
            {onCreateFromFolder !== undefined && (
              <button
                type="button"
                onClick={onCreateFromFolder}
                className="rounded p-1 text-foreground/35 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/60"
                title="从本地文件夹创建项目"
              >
                <FolderInput size={13} />
              </button>
            )}
            {(onCreate !== undefined || onCreateRequested !== undefined) && (
              <button
                type="button"
                onClick={handleStartCreate}
                className="rounded p-1 text-foreground/35 transition-colors hover:bg-foreground/[0.06] hover:text-foreground/60"
                title="新建项目"
              >
                <Plus size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="flex max-h-[320px] flex-col overflow-y-auto p-1 scrollbar-thin">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] transition-colors duration-100',
                item.id === currentProjectId
                  ? 'bg-foreground/[0.08] text-foreground shadow-[0_1px_2px_0_rgba(0,0,0,0.05)]'
                  : 'text-foreground/70 hover:bg-foreground/[0.04]',
              )}
            >
              <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.trailing}
            </button>
          ))}

          {items.length === 0 && !creating && (
            <div className="px-2 py-3 text-center text-xs text-foreground/40">{emptyLabel}</div>
          )}

          {creating && (
            <div className="flex items-center gap-2 px-2 py-[5px]">
              <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />
              <input
                ref={createInputRef}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={handleCreateKeyDown}
                onBlur={() => setCreating(false)}
                placeholder="项目名称..."
                className="min-w-0 flex-1 border-b border-primary/50 bg-transparent px-0.5 text-[13px] text-foreground outline-none"
                maxLength={50}
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function CollapsedWorkspacePopover({ children }: { children: React.ReactNode }): React.ReactElement {
  const { workspaces, currentWorkspaceId, selectProject, createProject, createProjectFromFolder } = useProjectActions()

  return (
    <CollapsedProjectPopover
      title="Agent 模式 · 项目"
      items={workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        trailing: (
          <LocalProjectBadge
            projectRootPath={workspace.projectRootPath}
            projectRootStatus={workspace.projectRootStatus}
          />
        ),
      }))}
      currentProjectId={currentWorkspaceId}
      emptyLabel="暂无 Agent 项目"
      onSelect={selectProject}
      onCreate={async (name) => (await createProject(name)) !== undefined}
      onCreateFromFolder={() => { void createProjectFromFolder() }}
    >
      {children}
    </CollapsedProjectPopover>
  )
}
