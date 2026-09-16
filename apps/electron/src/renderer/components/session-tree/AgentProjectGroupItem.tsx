import * as React from 'react'
import { toast } from 'sonner'
import { Clock, ChevronRight, Plus, MoreHorizontal, FolderOpen, Languages, Pencil, Settings, FolderInput, FolderPlus, Trash2 } from 'lucide-react'
import type { AgentWorkspace, AgentSessionMeta, LinguistProjectInfo, LinguistRole } from '@proma/shared'
import { cn } from '@/lib/utils'
import { ProjectSessionTreeGroupHeader } from './ProjectSessionTreeGroupHeader'
import { LinguistWorkspaceBadge } from '@/features/linguist/projects/LinguistWorkspaceBadge'
import { LinguistProjectActionItems, LinguistCreateSessionMenu } from '@/features/linguist/sidebar/LinguistProjectActionsMenu'
import type { useLinguistSidebarActions } from '@/features/linguist/sidebar/useLinguistSidebarActions'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { LocalProjectBadge } from '@/components/agent/LocalProjectBadge'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { ShortcutKeycaps } from '@/components/shortcuts/ShortcutKeycaps'

interface AgentProjectGroupItemProps {
  group: { workspace: AgentWorkspace; sessions: AgentSessionMeta[] }
  currentWorkspaceId: string | null
  /** 合成「自动任务」只读组：隐藏拖拽 / 新建会话 / 项目菜单等 workspace 专属操作，会话显示来源工作区角标 */
  isAutomationGroup?: boolean
  /** 绑定了 Linguist 项目的 Workspace：项目头显示 Linguist 标记，项目菜单提供「打开 Linguist」 */
  domainMode?: boolean
  domainActions?: ReturnType<typeof useLinguistSidebarActions>
  linguistProject?: LinguistProjectInfo
  /** 打开该 Workspace 对应 Linguist 项目的 Workbench */
  onOpenLinguist?: (projectId: string) => void
  collapsed: boolean
  dragging: boolean
  dropPosition: 'before' | 'after' | null
  onSelectProject: (workspaceId: string) => void
  onNewSession: (workspaceId: string) => Promise<void>
  onDragStart: (e: React.DragEvent, workspaceId: string) => void
  onDragOver: (e: React.DragEvent, workspaceId: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, workspaceId: string) => void
  onDragEnd: () => void
  onConfigureProject: (workspaceId: string) => void
  onRenameWorkspace: (workspaceId: string, newName: string) => Promise<void>
  onRelinkProjectRoot: (workspaceId: string) => Promise<void>
  onRequestRestoreProjectRoot: (workspaceId: string) => void
  onRequestDeleteWorkspace: (workspaceId: string) => void
  canDeleteWorkspace: boolean
}

export const AgentProjectGroupItem = React.memo(function AgentProjectGroupItem({
  group,
  currentWorkspaceId,
  isAutomationGroup = false,
  linguistProject,
  domainMode = false,
  domainActions,
  onOpenLinguist,
  collapsed,
  dragging,
  dropPosition,
  onSelectProject,
  onNewSession,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onConfigureProject,
  onRenameWorkspace,
  onRelinkProjectRoot,
  onRequestRestoreProjectRoot,
  onRequestDeleteWorkspace,
  canDeleteWorkspace,
}: AgentProjectGroupItemProps): React.ReactElement {
  const isCurrent = group.workspace.id === currentWorkspaceId
  const newSessionShortcutLabel = getAcceleratorDisplay(getActiveAccelerator('new-session'))
  const hasUnavailableProjectRoot = Boolean(
    group.workspace.projectRootPath
    && group.workspace.projectRootStatus
    && group.workspace.projectRootStatus !== 'available',
  )

  const [renamingWorkspace, setRenamingWorkspace] = React.useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = React.useState(false)
  const [workspaceEditName, setWorkspaceEditName] = React.useState('')
  const workspaceEditRef = React.useRef<HTMLInputElement>(null)
  const justStartedRenamingRef = React.useRef(false)

  const handleStartWorkspaceRename = (): void => {
    setWorkspaceEditName(group.workspace.name)
    setRenamingWorkspace(true)
    justStartedRenamingRef.current = true
    setTimeout(() => {
      justStartedRenamingRef.current = false
      workspaceEditRef.current?.focus()
      workspaceEditRef.current?.select()
    }, 300)
  }

  const handleWorkspaceRenameCommit = async (): Promise<void> => {
    if (justStartedRenamingRef.current) return
    const trimmed = workspaceEditName.trim()
    if (!trimmed || trimmed === group.workspace.name) {
      setRenamingWorkspace(false)
      return
    }
    try {
      await onRenameWorkspace(group.workspace.id, trimmed)
      setRenamingWorkspace(false)
    } catch (error) {
      toast.error('重命名项目失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleWorkspaceRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      void handleWorkspaceRenameCommit()
    } else if (e.key === 'Escape') {
      setRenamingWorkspace(false)
    }
  }

  const domainProps = domainMode && linguistProject && domainActions ? {
    project: linguistProject,
    onOpen: () => domainActions.open(linguistProject.id),
    onCreateSession: (role: LinguistRole) => { void domainActions.createSession(linguistProject.id, role) },
    onRename: handleStartWorkspaceRename,
    onArchive: () => domainActions.archive(linguistProject),
    onOpenSettings: () => { void domainActions.settings(linguistProject.id) },
    onDelete: () => domainActions.requestDelete(linguistProject),
    canMoveUp: domainActions.projects.filter(project => project.archivedAt === undefined).findIndex(project => project.id === linguistProject.id) > 0,
    canMoveDown: domainActions.projects.filter(project => project.archivedAt === undefined).at(-1)?.id !== linguistProject.id,
    onMoveUp: () => { void domainActions.move(linguistProject.id, -1) },
    onMoveDown: () => { void domainActions.move(linguistProject.id, 1) },
  } : undefined

  return (
    <section
      onDragOver={(e) => onDragOver(e, group.workspace.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, group.workspace.id)}
      onDragEnd={onDragEnd}
      className={cn('relative py-0.5 rounded-md transition-opacity', dragging && 'opacity-45')}
    >
      {dropPosition === 'before' && (
        <div className="absolute -top-0.5 left-3 right-3 h-0.5 translate-x-[2px] rounded-full bg-primary z-10" />
      )}

      <ProjectSessionTreeGroupHeader
        projectId={group.workspace.id}
        controlsId={null}
        name={group.workspace.name}
        current={isCurrent}
        collapsed={collapsed}
        onSelect={() => onSelectProject(group.workspace.id)}
        onToggleCollapse={isAutomationGroup
          ? undefined
          : () => onSelectProject(group.workspace.id)}
        icon={isAutomationGroup
          ? <Clock size={13} className="flex-shrink-0 text-foreground/40" />
          : undefined}
        trailing={(
          <>
            {!isAutomationGroup && (
              <LocalProjectBadge
                projectRootPath={group.workspace.projectRootPath}
                projectRootStatus={group.workspace.projectRootStatus}
              />
            )}
            {linguistProject && <LinguistWorkspaceBadge />}
            {isAutomationGroup && (
              <ChevronRight
                size={12}
                className={cn(
                  'flex-shrink-0 text-foreground/30 transition-transform duration-150',
                  collapsed ? '-rotate-90' : 'rotate-90',
                )}
              />
            )}
          </>
        )}
        contextMenuItems={domainProps ? <LinguistProjectActionItems {...domainProps} variant="context" /> : undefined}
        draggable={!domainProps?.project.archivedAt}
        onDragStart={(event) => onDragStart(event, group.workspace.id)}
        nameButtonClassName={cn('pr-12', isCurrent && 'pr-32')}
        editor={renamingWorkspace ? (
          <input
            ref={workspaceEditRef}
            value={workspaceEditName}
            onChange={(event) => setWorkspaceEditName(event.target.value)}
            onKeyDown={handleWorkspaceRenameKeyDown}
            onBlur={() => void handleWorkspaceRenameCommit()}
            className="min-w-0 flex-1 border-b border-primary/50 bg-transparent px-0.5 text-[13px] font-medium leading-[18px] text-foreground outline-none"
            maxLength={50}
          />
        ) : undefined}
        hint={isCurrent && !isAutomationGroup && !projectMenuOpen ? (
          <ShortcutKeycaps
            shortcutId="new-session"
            className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 !flex-nowrap opacity-65 transition-opacity group-hover/project:opacity-0"
            keycapClassName="h-4 min-w-4 rounded-[3px] border-border/60 px-0.5 text-[9px] shadow-none"
            separatorClassName="text-[8px]"
          />
        ) : undefined}
        actions={!isAutomationGroup ? (
          <>
            {domainProps ? (domainProps.project.archivedAt === undefined && <LinguistCreateSessionMenu project={domainProps.project} creating={domainActions?.creatingProjectId === domainProps.project.id} onCreateSession={domainProps.onCreateSession} />) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`在「${group.workspace.name}」中新建会话`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void onNewSession(group.workspace.id)
                  }}
                  className="absolute right-0 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-foreground/[0.055] hover:text-foreground/65 titlebar-no-drag"
                >
                  <Plus size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {`在此项目中新建会话${newSessionShortcutLabel ? ` (${newSessionShortcutLabel})` : ''}`}
              </TooltipContent>
            </Tooltip>
            )}
            <DropdownMenu onOpenChange={setProjectMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="项目菜单"
                  className="absolute right-5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-foreground/30 opacity-0 transition-colors hover:bg-foreground/[0.055] hover:text-foreground/60 group-hover/project:opacity-100 data-[state=open]:opacity-100 titlebar-no-drag"
                >
                  <MoreHorizontal size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="z-[9999] w-44 min-w-0 p-0.5">
                {domainProps ? <LinguistProjectActionItems {...domainProps} variant="dropdown" /> : <>
                <DropdownMenuItem
                  className="py-1 text-xs [&>svg]:size-3.5"
                  onSelect={() => onSelectProject(group.workspace.id)}
                >
                  <FolderOpen size={14} />
                  设为当前项目
                </DropdownMenuItem>
                {linguistProject && onOpenLinguist && (
                  <DropdownMenuItem
                    className="py-1 text-xs [&>svg]:size-3.5"
                    onSelect={() => onOpenLinguist(linguistProject.id)}
                  >
                    <Languages size={14} />
                    打开 Linguist
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="py-1 text-xs [&>svg]:size-3.5"
                  onSelect={handleStartWorkspaceRename}
                >
                  <Pencil size={14} />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="py-1 text-xs [&>svg]:size-3.5"
                  onSelect={() => onConfigureProject(group.workspace.id)}
                >
                  <Settings size={14} />
                  配置 MCP 与 Skills
                </DropdownMenuItem>
                {hasUnavailableProjectRoot && (
                  <>
                    <DropdownMenuSeparator className="my-0.5" />
                    <DropdownMenuItem
                      className="py-1 text-xs [&>svg]:size-3.5"
                      onSelect={() => void onRelinkProjectRoot(group.workspace.id)}
                    >
                      <FolderInput size={14} />
                      重新选择文件夹
                    </DropdownMenuItem>
                    {group.workspace.projectRootStatus === 'missing' && (
                      <DropdownMenuItem
                        className="py-1 text-xs [&>svg]:size-3.5"
                        onSelect={() => onRequestRestoreProjectRoot(group.workspace.id)}
                      >
                        <FolderPlus size={14} />
                        在原路径新建空文件夹
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                <DropdownMenuSeparator className="my-0.5" />
                <DropdownMenuItem
                  disabled={!canDeleteWorkspace}
                  className={cn(
                    'py-1 text-xs [&>svg]:size-3.5',
                    canDeleteWorkspace && 'text-destructive focus:text-destructive',
                  )}
                  onSelect={() => onRequestDeleteWorkspace(group.workspace.id)}
                >
                  <Trash2 size={14} />
                  删除项目
                </DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : undefined}
      />

      {dropPosition === 'after' && (
        <div className="absolute -bottom-0.5 left-3 right-3 h-0.5 rounded-full bg-primary z-10" />
      )}
    </section>
  )
})
