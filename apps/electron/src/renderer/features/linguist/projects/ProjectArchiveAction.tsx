import * as React from 'react'
import { Archive } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistProjectInfo } from '@proma/shared'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { describeLinguistIpcError } from './project-utils'

interface ArchiveDialogState {
  project: LinguistProjectInfo | null
  archiving: boolean
}

export function reduceArchiveDialogState(
  state: ArchiveDialogState,
  event: 'cancel' | 'complete' | 'finish' | { type: 'request'; project: LinguistProjectInfo } | 'start',
): ArchiveDialogState {
  if (event === 'cancel' || event === 'complete') return { project: null, archiving: false }
  if (event === 'finish') return state.project === null ? state : { ...state, archiving: false }
  if (event === 'start') return state.project === null ? state : { ...state, archiving: true }
  return { project: event.project, archiving: false }
}

interface UseProjectArchiveOptions {
  onArchived: (project: LinguistProjectInfo) => void
}

/** 两个旧/新入口共用归档确认、IPC、错误展示和完成回调。 */
export function useProjectArchive({ onArchived }: UseProjectArchiveOptions): {
  requestArchive: (project: LinguistProjectInfo) => void
  archiveDialog: React.ReactNode
} {
  const [state, dispatch] = React.useReducer(reduceArchiveDialogState, {
    project: null,
    archiving: false,
  })

  const handleConfirm = React.useCallback(async (): Promise<void> => {
    if (state.project === null || state.archiving) return
    dispatch('start')
    try {
      const result = await window.electronAPI.linguistProjectsArchive({ projectId: state.project.id })
      if (!result.ok) {
        toast.error('归档失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      toast.success(`已归档「${state.project.name}」`, {
        description: '归档项目以只读方式保留，仍可打开查看。',
      })
      onArchived(result.data)
      dispatch('complete')
    } catch {
      toast.error('归档失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      dispatch('finish')
    }
  }, [onArchived, state.archiving, state.project])

  return {
    requestArchive: (project) => dispatch({ type: 'request', project }),
    archiveDialog: (
      <ConfirmDialog
        open={state.project !== null}
        onOpenChange={(open) => {
          if (!open && !state.archiving) dispatch('cancel')
        }}
        title={`归档项目「${state.project?.name ?? ''}」？`}
        description="归档后项目从活跃列表移入「已归档」分组，数据以只读方式保留，仍可打开查看。"
        confirmLabel="归档"
        loadingLabel="归档中…"
        variant="destructive"
        loading={state.archiving}
        onConfirm={() => void handleConfirm()}
      />
    ),
  }
}

interface ProjectArchiveActionProps {
  project: LinguistProjectInfo
  onArchived: (project: LinguistProjectInfo) => void
}

/** 维护页的归档动作；归档项目不再提供重复写入入口。 */
export function ProjectArchiveAction({
  project,
  onArchived,
}: ProjectArchiveActionProps): React.ReactElement {
  const { requestArchive, archiveDialog } = useProjectArchive({ onArchived })
  const archived = project.archivedAt !== undefined

  return (
    <section aria-label="归档项目" className="rounded-xl bg-muted/50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">归档项目</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {archived ? '该项目已归档，数据以只读方式保留。' : '归档后项目将以只读方式保留，仍可打开查看和备份。'}
          </p>
        </div>
        <button
          type="button"
          disabled={archived}
          onClick={() => requestArchive(project)}
          className={cn(
            'shrink-0 inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90',
            archived && 'cursor-not-allowed opacity-50 hover:bg-destructive',
          )}
        >
          <Archive className="size-3" aria-hidden="true" />
          {archived ? '已归档' : '归档…'}
        </button>
      </div>
      {archiveDialog}
    </section>
  )
}
