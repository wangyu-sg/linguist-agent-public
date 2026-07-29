import * as React from 'react'
import { useAtomValue } from 'jotai'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  LinguistDiagnosticBundlePreviewResult,
  LinguistDiagnosticsStatus,
  LinguistPromptStatusInfo,
} from '@proma/shared'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { Button } from '@/components/ui/button'
import { describeLinguistIpcError } from './project-utils'

type DiagnosticsState = {
  loading: boolean
  error?: string
  status?: LinguistDiagnosticsStatus
  previewing: boolean
  preview?: LinguistDiagnosticBundlePreviewResult
  exporting: boolean
}

const FALLBACK_LABELS: Record<
  LinguistPromptStatusInfo['fallbackLayers'][number],
  string
> = {
  role: 'Role',
  strategy: 'Strategy',
  project_digest: 'Project Digest',
}

function shortHash(value: string): string {
  return `${value.slice(0, 12)}…`
}

export function PromptStatusCard({
  prompt,
  loading,
  onRetry,
}: {
  prompt?: LinguistPromptStatusInfo
  loading: boolean
  onRetry: () => void
}): React.ReactElement {
  return (
    <section aria-label="Prompt 状态" className="rounded-xl bg-muted/50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Prompt 状态</h3>
          {prompt === undefined ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {loading ? '正在探测真实 Prompt 构建链…' : '打开诊断页后探测。'}
            </p>
          ) : prompt.degraded ? (
            <div className="mt-2 space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Prompt 已降级
              </p>
              <p className="text-xs text-muted-foreground">
                fallback_layers：
                {prompt.fallbackLayers.map((layer) => FALLBACK_LABELS[layer]).join('、')}
              </p>
              <p className="text-xs text-muted-foreground">
                retryable：{String(prompt.retryable)}
              </p>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Profile / Role / Strategy / Project Digest 均使用当前资源
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={onRetry}
        >
          {loading
            ? <Loader2 className="mr-1.5 size-3.5 animate-spin motion-reduce:hidden" />
            : <RefreshCw className="mr-1.5 size-3.5" />}
          重新探测{prompt?.retryable ? ' / 重试' : ''}
        </Button>
      </div>
      {prompt !== undefined && (
        <dl className="mt-3 grid gap-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-3">
            <dt>Prompt Version</dt>
            <dd className="font-mono text-foreground">{prompt.profileVersion}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Prompt Digest</dt>
            <dd className="font-mono text-foreground" title={prompt.promptHash}>
              {shortHash(prompt.promptHash)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Project Digest</dt>
            <dd className="font-mono text-foreground" title={prompt.projectDigestHash}>
              {prompt.projectDigestStatus} · {shortHash(prompt.projectDigestHash)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function DevDiagnostics({
  status,
}: {
  status: LinguistDiagnosticsStatus
}): React.ReactElement | null {
  const dev = status.dev
  if (dev === undefined) return null
  const profile = dev.profile === undefined
    ? '无已选项目会话'
    : `${dev.profile.role} / ${dev.profile.strategy}`
  const recentJob = dev.recentJob.status === 'not_available'
    ? '尚未观测到 Job'
    : `${dev.recentJob.status} · ${dev.recentJob.cursor}/${dev.recentJob.total} · ${dev.recentJob.jobId}`
  return (
    <section aria-label="Dev Diagnostics" className="rounded-xl bg-muted/50 p-4 shadow-sm">
      <h3 className="text-sm font-medium text-foreground">Dev Diagnostics</h3>
      <dl className="mt-3 grid gap-2 text-xs">
        <DiagnosticRow label="Agent Profile" value={profile} />
        <DiagnosticRow
          label="Base / Overlay Tools"
          value={`${dev.tools.base ?? 'Runtime 未公开'} / ${dev.tools.overlay}`}
        />
        <DiagnosticRow label="Session CWD" value={dev.sessionCwd ?? '无已选项目会话'} mono />
        <DiagnosticRow label="Project Revision" value={status.projectRevision} mono />
        <DiagnosticRow label="Event Seq" value={String(dev.trace.eventSequence)} />
        <DiagnosticRow label="Recent Job" value={recentJob} mono />
        <DiagnosticRow label="Cache Size" value={String(dev.promptCacheSize)} />
        <DiagnosticRow
          label="Worker"
          value={`${dev.worker.mode} / ${dev.worker.status}`}
        />
        <DiagnosticRow
          label="Trace"
          value={`可用 ${dev.trace.availableFields.join(', ')}；未提供 ${dev.trace.unavailableFields.join(', ')}`}
        />
        <DiagnosticRow
          label="Probe Metrics"
          value={`${dev.metrics.promptProbeLatencyMs.toFixed(2)} ms · ${dev.metrics.promptProbeResultBytes} bytes`}
        />
        <DiagnosticRow
          label="QA Metrics"
          value={`errors ${dev.metrics.qa.openErrors} · warnings ${dev.metrics.qa.openWarnings} · pending proposals ${dev.metrics.qa.pendingProposals}`}
        />
        <DiagnosticRow
          label="Retry"
          value={`${dev.metrics.retry.attempts} 次${dev.metrics.retry.lastRecovered === undefined ? '' : ` · recovered ${String(dev.metrics.retry.lastRecovered)}`}`}
        />
        <DiagnosticRow
          label="Event Gap"
          value={`${dev.metrics.eventGap.pending} pending · ack ${dev.metrics.eventGap.acknowledgedSequence}/${dev.metrics.eventGap.latestSequence}`}
        />
      </dl>
    </section>
  )
}

function DiagnosticRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-foreground' : 'text-foreground'}>
        {value}
      </dd>
    </div>
  )
}

export function ProjectDiagnosticsSettings({
  projectId,
}: {
  projectId: string
}): React.ReactElement {
  const sessionId = useAtomValue(projectCurrentAgentSessionIdMapAtom).get(projectId)
  const [state, setState] = React.useState<DiagnosticsState>({
    loading: false,
    previewing: false,
    exporting: false,
  })

  const loadStatus = React.useCallback(async (retry = false): Promise<void> => {
    setState((current) => ({
      ...current,
      loading: true,
      error: undefined,
      preview: undefined,
    }))
    try {
      const result = await window.electronAPI.linguistDiagnosticsGetStatus({
        projectId,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(retry ? { retry: true } : {}),
      })
      setState((current) => result.ok
        ? { ...current, loading: false, status: result.data, error: undefined }
        : {
          ...current,
          loading: false,
          error: describeLinguistIpcError(result.error),
        })
    } catch {
      setState((current) => ({
        ...current,
        loading: false,
        error: '与主进程通信异常（INTERNAL）',
      }))
    }
  }, [projectId, sessionId, setState])

  React.useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const previewBundle = React.useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, previewing: true }))
    try {
      const result = await window.electronAPI.linguistDiagnosticsPreviewBundle({
        projectId,
        ...(sessionId === undefined ? {} : { sessionId }),
      })
      if (!result.ok) {
        toast.error('诊断包预览失败', {
          description: describeLinguistIpcError(result.error),
        })
      }
      setState((current) => ({
        ...current,
        previewing: false,
        ...(result.ok ? { preview: result.data } : {}),
      }))
    } catch {
      setState((current) => ({ ...current, previewing: false }))
      toast.error('诊断包预览失败', { description: '与主进程通信异常（INTERNAL）' })
    }
  }, [projectId, sessionId, setState])

  const exportBundle = React.useCallback(async (): Promise<void> => {
    if (state.preview === undefined) return
    setState((current) => ({ ...current, exporting: true }))
    try {
      const result = await window.electronAPI.linguistDiagnosticsExportBundle({
        projectId,
        ...(sessionId === undefined ? {} : { sessionId }),
      })
      if (!result.ok) {
        toast.error('诊断包导出失败', {
          description: describeLinguistIpcError(result.error),
        })
      } else if (!result.data.cancelled) {
        toast.success(`已导出「${result.data.filename}」`, {
          description: `${result.data.sizeBytes} bytes · SHA-256 ${shortHash(result.data.sha256)} · 不会自动上传`,
        })
      }
    } catch {
      toast.error('诊断包导出失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setState((current) => ({ ...current, exporting: false }))
    }
  }, [projectId, sessionId, setState, state.preview])

  return (
    <section aria-label="项目诊断" className="space-y-3 py-1">
      <PromptStatusCard
        prompt={state.status?.prompt}
        loading={state.loading}
        onRetry={() => void loadStatus(true)}
      />
      {state.error !== undefined && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state.status !== undefined && <DevDiagnostics status={state.status} />}
      <section aria-label="隐私诊断包" className="rounded-xl bg-muted/50 p-4 shadow-sm">
        <h3 className="text-sm font-medium text-foreground">隐私诊断包</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          必须先预览再显式导出。默认不含客户正文、文件名、绝对路径、API Key 或隐藏推理；应用不会自动上传。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state.previewing || state.exporting}
            onClick={() => void previewBundle()}
          >
            {state.previewing
              ? <Loader2 className="mr-1.5 size-3.5 animate-spin motion-reduce:hidden" />
              : <Eye className="mr-1.5 size-3.5" />}
            预览脱敏内容
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title={state.preview === undefined ? '请先预览脱敏内容' : '导出诊断包'}
            disabled={state.preview === undefined || state.previewing || state.exporting}
            onClick={() => void exportBundle()}
          >
            {state.exporting
              ? <Loader2 className="mr-1.5 size-3.5 animate-spin motion-reduce:hidden" />
              : <Download className="mr-1.5 size-3.5" />}
            导出诊断包…
          </Button>
        </div>
        {state.preview !== undefined && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              预览大小 {state.preview.sizeBytes} bytes · filenames=false ·
              contentSnippets=false · absolutePaths=false · autoUpload=false
            </p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-background/70 p-3 text-[11px] leading-relaxed text-foreground">
              {JSON.stringify(state.preview.bundle, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </section>
  )
}
