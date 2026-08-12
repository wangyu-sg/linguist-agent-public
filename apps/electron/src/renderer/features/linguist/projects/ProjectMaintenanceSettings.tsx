import * as React from 'react'
import { useAtom } from 'jotai'
import { AlertTriangle, CheckCircle2, Download, Loader2, ShieldCheck, Trash2, X } from 'lucide-react'
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
import {
  projectIntegrityStateAtomFamily,
  reduceProjectIntegrityEvent,
  subscribeToProjectIntegrity,
  type ProjectIntegrityState,
} from './project-integrity-atoms'

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
  const [integrityState, setIntegrityState] = useAtom(projectIntegrityStateAtomFamily(project.id))
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

  React.useEffect(
    () => subscribeToProjectIntegrity(project.id, (event) => {
      setIntegrityState((current) => reduceProjectIntegrityEvent(project.id, current, event))
    }),
    [project.id, setIntegrityState],
  )

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
          ? '项目索引已清理；Agent Session 及其工作目录已保留。'
          : `恢复目录：${result.data.recoveryName}；Agent Session 及其工作目录已保留。`,
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
      <FullIntegrityScrubSection
        projectId={project.id}
        state={integrityState}
        setState={setIntegrityState}
      />
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
                ? '删除后仅 CAT 项目目录会移入本地可恢复删除区（受管 Trash）。历史 Agent Session 及其工作目录默认保留，不会一并移入；如需清理，请在 Agent 模式单独处理。'
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
          <p>
            此操作只会将 CAT 项目目录移入受管 Trash；Agent Session
            及其工作目录默认保留，不会按普通 Agent Workspace 删除。
          </p>
          <p>请输入完整项目名称确认：</p>
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

const INTEGRITY_CHECK_LABELS: Record<string, string> = {
  project_manifest: '项目清单',
  schema_version: '数据库 schema',
  source_digests: '全部 source digest',
  blob_digests: '全部 blob digest',
  sqlite_integrity: 'SQLite integrity_check',
  foreign_keys: 'foreign_key_check',
  orphans: '孤儿与项目作用域',
  proposal_references: '建议引用',
  qa_references: 'QA 引用与历史',
  review_references: 'Review 引用',
  event_sequence: '项目事件序列',
  job_lineage: '任务 checkpoint lineage',
  run_lineage: '运行变更 lineage',
  export_manifests: '导出清单',
}

function FullIntegrityScrubSection({
  projectId,
  state,
  setState,
}: {
  projectId: string
  state: ProjectIntegrityState
  setState: React.Dispatch<React.SetStateAction<ProjectIntegrityState>>
}): React.ReactElement {
  const running = state.status === 'starting' || state.status === 'running'

  const start = async (): Promise<void> => {
    if (running) return
    setState({ status: 'starting' })
    try {
      const result = await window.electronAPI.linguistIntegrityStart({ projectId })
      setState((current) => current.status !== 'starting'
        ? current
        : result.ok
          ? { status: 'running', jobId: result.data.jobId }
          : { status: 'error', message: describeLinguistIpcError(result.error) })
    } catch {
      setState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
    }
  }

  const cancel = async (): Promise<void> => {
    if (state.status !== 'running') return
    try {
      const result = await window.electronAPI.linguistIntegrityCancel({
        projectId,
        jobId: state.jobId,
      })
      if (!result.ok) setState({ status: 'error', message: describeLinguistIpcError(result.error) })
    } catch {
      setState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
    }
  }

  const save = async (): Promise<void> => {
    if (state.status !== 'completed') return
    try {
      const result = await window.electronAPI.linguistIntegrityExportReport({
        projectId,
        jobId: state.jobId,
      })
      if (!result.ok) {
        toast.error('保存完整性报告失败', { description: describeLinguistIpcError(result.error) })
      } else if (!result.data.cancelled) {
        toast.success(`已保存脱敏报告：${result.data.filename}`)
      }
    } catch {
      toast.error('保存完整性报告失败', { description: '与主进程通信异常（INTERNAL）' })
    }
  }

  return (
    <section aria-label="Full Integrity Scrub" className="rounded-xl bg-muted/50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Full Integrity Scrub
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            在独立 Worker 中逐项全量检查 source/blob、SQLite、建议/QA/Review、事件与 job/run lineage、导出清单及 Session Workspace；无法可靠验证的项会明确标为 unavailable。
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {state.status === 'running' && (
            <button
              type="button"
              onClick={() => void cancel()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-foreground/[0.05]"
            >
              <X className="size-3" aria-hidden="true" />
              取消
            </button>
          )}
          {state.status === 'completed' && (
            <button
              type="button"
              onClick={() => void save()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-foreground/[0.05]"
            >
              <Download className="size-3" aria-hidden="true" />
              保存脱敏报告
            </button>
          )}
          <button
            type="button"
            disabled={running}
            onClick={() => void start()}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
            {state.status === 'completed' ? '重新扫描' : running ? '扫描中' : '开始全量扫描'}
          </button>
        </div>
      </div>
      {state.status === 'running' && state.progress !== undefined && (
        <div className="mt-3 space-y-1">
          <div
            role="progressbar"
            aria-label="完整性扫描进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.progress.percent}
            className="h-1.5 overflow-hidden rounded-full bg-border"
          >
            <div className="h-full bg-primary" style={{ width: `${state.progress.percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {INTEGRITY_CHECK_LABELS[state.progress.checkId] ?? state.progress.checkId} · {state.progress.percent}%
          </p>
        </div>
      )}
      {state.status === 'cancelled' && (
        <p className="mt-2 text-xs text-muted-foreground">扫描已取消，未生成报告。</p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="mt-2 text-xs text-destructive">扫描失败：{state.message}</p>
      )}
      {state.status === 'completed' && (
        <div className="mt-3 space-y-2">
          <p className={state.report.outcome === 'passed' ? 'text-xs text-success' : 'text-xs text-warning'}>
            {state.report.outcome === 'passed'
              ? '全量检查通过'
              : state.report.outcome === 'incomplete'
                ? '扫描完成，但存在无法可靠验证的项目'
                : '扫描发现完整性问题'}
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {state.report.checks
              .filter((check) => check.status !== 'passed')
              .map((check) => (
                <li key={check.id}>
                  {INTEGRITY_CHECK_LABELS[check.id] ?? check.id}：
                  {check.status === 'failed' ? 'failed' : 'unavailable'}
                  {check.problems.length > 0 && `（${check.problems.map((problem) => `${problem.code} × ${problem.count}`).join('、')}）`}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function ProjectHealthSection({ state }: { state: ProjectHealthState }): React.ReactElement {
  if (state.status === 'loading') {
    return (
      <section aria-label="Quick Health" className="rounded-xl bg-muted/50 p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">正在运行 Quick Health…</p>
        <p className="mt-1 text-xs text-muted-foreground">
          仅检查数据库可打开、项目清单、schema 与最多 20 个 source blob，不代表完整性全检。
        </p>
      </section>
    )
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertTriangle className="size-3" />
        Quick Health 不可用：{state.message}
      </p>
    )
  }

  const failed = failedHealthChecks(state.health)
  return (
    <section aria-label="Quick Health" className="rounded-xl bg-muted/50 p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {state.health.healthy ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-warning" />}
        {state.health.healthy ? 'Quick Health 未发现问题' : 'Quick Health 发现异常'}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        仅检查数据库可打开、项目清单、schema 与最多 20 个 source blob，不代表完整性全检。
      </p>
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
