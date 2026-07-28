import * as React from 'react'
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistProjectHealthReport, LinguistProjectInfo } from '@proma/shared'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { ProjectArchiveAction } from './ProjectArchiveAction'
import { ProjectBackupsSection } from './ProjectBackupsSection'
import {
  describeHealthCheckId,
  describeLinguistIpcError,
  failedHealthChecks,
} from './project-utils'

interface ProjectMaintenanceSettingsProps {
  project: LinguistProjectInfo
  onSummaryRefresh: () => void
  onClose: () => void
  onProjectArchived?: (project: LinguistProjectInfo) => void
  onProjectDeleted?: (projectId: string) => void
}

type ProjectHealthState =
  | { status: 'loading' }
  | { status: 'ready'; health: LinguistProjectHealthReport }
  | { status: 'error'; message: string }

/** LF-072：维护页只组合既有备份、健康、归档能力，不复制项目数据。 */
export function ProjectMaintenanceSettings({
  project,
  onSummaryRefresh,
  onClose,
  onProjectArchived,
  onProjectDeleted,
}: ProjectMaintenanceSettingsProps): React.ReactElement {
  const [healthState, setHealthState] = React.useState<ProjectHealthState>({ status: 'loading' })
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [confirmationName, setConfirmationName] = React.useState('')
  const [deleting, setDeleting] = React.useState(false)
  const archived = project.archivedAt !== undefined

  React.useEffect(() => {
    let cancelled = false
    setHealthState({ status: 'loading' })
    void window.electronAPI.linguistProjectsOpen({ projectId: project.id })
      .then((result) => {
        if (cancelled) return
        setHealthState(result.ok
          ? { status: 'ready', health: result.data.health }
          : { status: 'error', message: describeLinguistIpcError(result.error) })
      })
      .catch(() => {
        if (!cancelled) setHealthState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  const deleteProject = React.useCallback(async (): Promise<void> => {
    if (!archived || confirmationName !== project.name || deleting) return
    setDeleting(true)
    try {
      const result = await window.electronAPI.linguistProjectsDelete({
        projectId: project.id,
        confirmationName,
      })
      if (!result.ok) {
        toast.error('删除失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      toast.success(`已将「${project.name}」移入可恢复删除区`, {
        description: result.data.recoveryName === undefined
          ? '项目索引已清理。'
          : `恢复目录：${result.data.recoveryName}`,
      })
      setDeleteOpen(false)
      onProjectDeleted?.(project.id)
      onClose()
    } catch {
      toast.error('删除失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setDeleting(false)
    }
  }, [archived, confirmationName, deleting, onClose, onProjectDeleted, project.id, project.name])

  return (
    <section aria-label="项目维护" className="space-y-3 py-1">
      <ProjectBackupsSection
        projectId={project.id}
        archived={archived}
        onRestored={onSummaryRefresh}
      />
      <ProjectHealthSection state={healthState} />
      <ProjectArchiveAction
        project={project}
        onArchived={(updated) => {
          onProjectArchived?.(updated)
          onSummaryRefresh()
          onClose()
        }}
      />
      <section aria-label="删除项目" className="rounded-xl bg-muted/50 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-foreground">删除项目</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {archived
                ? '删除后完整项目目录会移入本地可恢复删除区，不会清除历史 Agent Session。'
                : '请先归档项目；只有只读的已归档项目可以删除。'}
            </p>
          </div>
          <button
            type="button"
            disabled={!archived}
            title={archived ? '删除项目' : '请先归档项目'}
            onClick={() => setDeleteOpen(true)}
            className={cn(
              'shrink-0 inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90',
              !archived && 'cursor-not-allowed opacity-50 hover:bg-destructive',
            )}
          >
            <Trash2 className="size-3" aria-hidden="true" />
            删除…
          </button>
        </div>
      </section>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) setConfirmationName('')
        }}
        title={`删除项目「${project.name}」？`}
        confirmLabel="移入可恢复删除区"
        loadingLabel="正在删除…"
        loading={deleting}
        confirmDisabled={confirmationName !== project.name}
        onConfirm={() => void deleteProject()}
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>此操作会从项目列表移除项目。请输入完整项目名称确认：</p>
          <label className="block space-y-1">
            <span className="font-medium text-foreground">{project.name}</span>
            <input
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              aria-label="输入项目名称以确认删除"
              autoComplete="off"
              className="w-full rounded-md bg-background px-3 py-2 text-foreground shadow-sm outline-none ring-1 ring-border focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
      </ConfirmDialog>
    </section>
  )
}

function ProjectHealthSection({ state }: { state: ProjectHealthState }): React.ReactElement {
  if (state.status === 'loading') {
    return <p className="text-xs text-muted-foreground">正在检查项目健康状态…</p>
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertTriangle className="size-3" />
        健康检查不可用：{state.message}
      </p>
    )
  }

  const failed = failedHealthChecks(state.health)
  return (
    <section aria-label="项目健康" className="rounded-xl bg-muted/50 p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {state.health.healthy ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-warning" />}
        {state.health.healthy ? '项目健康' : '项目需要修复'}
      </div>
      {failed.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {failed.map((check) => (
            <li key={check.id}>
              {describeHealthCheckId(check.id)}
              {check.detail !== undefined && <span className="font-mono">（{check.detail}）</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
