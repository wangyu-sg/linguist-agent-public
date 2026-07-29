import * as React from 'react'
import { Loader2 } from 'lucide-react'
import type {
  AgentSessionMeta,
  LinguistProjectInfo,
  LinguistSessionCopyEligibilityResult,
} from '@proma/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { describeLinguistIpcError } from '../projects/project-utils'

export function copyTargetCandidates(
  projects: readonly LinguistProjectInfo[],
  sourceProjectId: string | undefined,
): LinguistProjectInfo[] {
  return projects.filter((project) =>
    project.archivedAt === undefined && project.id !== sourceProjectId,
  )
}

export function hasLanguageDirectionMismatch(
  source: LinguistProjectInfo | undefined,
  target: LinguistProjectInfo | undefined,
): boolean {
  return Boolean(
    source
    && target
    && (
      source.sourceLocale !== target.sourceLocale
      || source.targetLocale !== target.targetLocale
    ),
  )
}

type EligibilityState =
  | { status: 'loading' }
  | { status: 'ready'; result: LinguistSessionCopyEligibilityResult }
  | { status: 'error'; message: string }

export function CopyLinguistSessionDialog({
  session,
  projects,
  onClose,
  onCopied,
}: {
  session: AgentSessionMeta | null
  projects: readonly LinguistProjectInfo[]
  onClose: () => void
  onCopied: (copy: AgentSessionMeta, target: LinguistProjectInfo) => void
}): React.ReactElement {
  const [eligibility, setEligibility] = React.useState<EligibilityState>({ status: 'loading' })
  const [healthyTargets, setHealthyTargets] = React.useState<LinguistProjectInfo[]>([])
  const [targetProjectId, setTargetProjectId] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!session) return
    let cancelled = false
    setEligibility({ status: 'loading' })
    setHealthyTargets([])
    setTargetProjectId('')
    setError(null)
    const candidates = copyTargetCandidates(projects, session.linguistProjectId)
    void Promise.all([
      window.electronAPI.linguistSessionsGetCopyEligibility({ sessionId: session.id }),
      Promise.all(candidates.map(async (project) => {
        const opened = await window.electronAPI.linguistProjectsOpen({ projectId: project.id })
          .catch(() => null)
        return opened?.ok && opened.data.health.healthy ? project : null
      })),
    ]).then(([eligibilityResult, checkedTargets]) => {
      if (cancelled) return
      setEligibility(eligibilityResult.ok
        ? { status: 'ready', result: eligibilityResult.data }
        : { status: 'error', message: describeLinguistIpcError(eligibilityResult.error) })
      setHealthyTargets(checkedTargets.filter(
        (project): project is LinguistProjectInfo => project !== null,
      ))
    }).catch(() => {
      if (!cancelled) {
        setEligibility({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
      }
    })
    return () => {
      cancelled = true
    }
  }, [projects, session])

  const sourceProject = projects.find((project) => project.id === session?.linguistProjectId)
  const targetProject = healthyTargets.find((project) => project.id === targetProjectId)
  const eligible = eligibility.status === 'ready' && eligibility.result.eligible

  const copy = async (): Promise<void> => {
    if (!session || !targetProject || !eligible || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await window.electronAPI.linguistSessionsCopyToProject({
        sessionId: session.id,
        targetProjectId: targetProject.id,
      })
      if (!result.ok) {
        setError(describeLinguistIpcError(result.error))
        return
      }
      onCopied(result.data, targetProject)
      onClose()
    } catch {
      setError('与主进程通信异常（INTERNAL）')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={session !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>复制到其他项目</DialogTitle>
          <DialogDescription>
            复制完整对话分支和运行配置；源会话与项目文件保持不变。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {eligibility.status === 'loading' && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              正在检查会话历史…
            </p>
          )}
          {eligibility.status === 'error' && (
            <p role="alert" className="text-sm text-destructive">{eligibility.message}</p>
          )}
          {eligibility.status === 'ready' && !eligibility.result.eligible && (
            <p role="alert" className="text-sm text-destructive">
              {eligibility.result.message}
            </p>
          )}
          {eligible && healthyTargets.length === 0 && (
            <p className="text-sm text-muted-foreground">没有其他活跃且健康的目标项目。</p>
          )}
          {eligible && healthyTargets.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-medium">目标项目</legend>
              {healthyTargets.map((project) => (
                <label
                  key={project.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 px-3 py-2 hover:bg-accent/50"
                >
                  <input
                    type="radio"
                    name="linguist-copy-target"
                    value={project.id}
                    checked={targetProjectId === project.id}
                    onChange={() => setTargetProjectId(project.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{project.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {project.sourceLocale} → {project.targetLocale}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {hasLanguageDirectionMismatch(sourceProject, targetProject) && (
            <p role="status" className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              目标项目的语言方向与源项目不同；仍可复制，但后续上下文将使用目标项目策略。
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!eligible || !targetProject || submitting}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            复制
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
