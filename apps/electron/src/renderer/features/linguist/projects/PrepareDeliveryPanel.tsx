import * as React from 'react'
import { CheckCircle2, Clipboard, Download, Loader2, PackageCheck, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type {
  LinguistAssetInfo,
  LinguistPrepareDeliveryResult,
} from '@proma/shared'
import { cn } from '@/lib/utils'
import { describeLinguistIpcError } from './project-utils'
import { stageProgressSummary } from './workflow-ui'

interface PrepareDeliveryPanelProps {
  projectId: string
  assets: readonly LinguistAssetInfo[]
  initialAssetId?: string
  archived: boolean
  onChanged?: () => void
}

type PreparationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: LinguistPrepareDeliveryResult }

export function PrepareDeliveryPanel({
  projectId,
  assets,
  initialAssetId,
  archived,
  onChanged,
}: PrepareDeliveryPanelProps): React.ReactElement {
  const [assetId, setAssetId] = React.useState(initialAssetId ?? assets[0]?.assetId ?? '')
  const [state, setState] = React.useState<PreparationState>({ status: 'idle' })
  const [saving, setSaving] = React.useState(false)
  const selectedAsset = assets.find((asset) => asset.assetId === assetId)

  React.useEffect(() => {
    if (assets.some((asset) => asset.assetId === assetId)) return
    setAssetId(initialAssetId ?? assets[0]?.assetId ?? '')
    setState({ status: 'idle' })
  }, [assetId, assets, initialAssetId])

  const prepare = React.useCallback(async (): Promise<void> => {
    if (assetId === '' || archived) return
    setState({ status: 'loading' })
    try {
      const result = await window.electronAPI.linguistExportsPrepareAsset({
        projectId,
        assetId,
      })
      if (!result.ok) {
        setState({ status: 'error', message: describeLinguistIpcError(result.error) })
        return
      }
      setState({ status: 'ready', result: result.data })
      onChanged?.()
    } catch {
      setState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
    }
  }, [archived, assetId, onChanged, projectId])

  const save = React.useCallback(async (): Promise<void> => {
    if (
      assetId === ''
      || archived
      || saving
      || state.status !== 'ready'
      || !state.result.preflight.ready
    ) return
    setSaving(true)
    try {
      const result = await window.electronAPI.linguistExportsSaveAsset({
        projectId,
        assetId,
      })
      if (!result.ok) {
        toast.error('保存交付副本失败', {
          description: describeLinguistIpcError(result.error),
        })
        await prepare()
        return
      }
      if (result.data.cancelled) return
      setState({ status: 'ready', result: result.data.preparation })
      toast.success(`已保存「${result.data.filename}」`, {
        description: `${result.data.verifiedSegments} 段已重新导入验证；原文件未覆盖`,
      })
      onChanged?.()
    } catch {
      toast.error('保存交付副本失败', {
        description: '与主进程通信异常（INTERNAL）',
      })
    } finally {
      setSaving(false)
    }
  }, [archived, assetId, onChanged, prepare, projectId, saving, state])

  const copyReport = React.useCallback(async (): Promise<void> => {
    if (state.status !== 'ready') return
    try {
      await navigator.clipboard.writeText(state.result.reportMarkdown)
      toast.success('审校报告已复制')
    } catch {
      toast.error('无法复制审校报告')
    }
  }, [state])

  return (
    <section aria-label="准备交付" className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-64 flex-1 text-[11px] text-foreground/55">
          交付资产
          <select
            value={assetId}
            disabled={archived || assets.length === 0}
            onChange={(event) => {
              setAssetId(event.target.value)
              setState({ status: 'idle' })
            }}
            className="mt-1 h-8 w-full rounded-md bg-background px-2 text-xs text-foreground ring-1 ring-border/50"
          >
            {assets.length === 0 && <option value="">尚未导入资产</option>}
            {assets.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>{asset.filename}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={archived || assetId === '' || state.status === 'loading'}
          onClick={() => void prepare()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-45"
        >
          {state.status === 'loading'
            ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            : <PackageCheck aria-hidden="true" className="size-3.5" />}
          运行交付预检
        </button>
      </div>

      <p className="text-[11px] leading-5 text-foreground/50">
        输出使用新文件名并以排他复制保存；已存在的文件和受管数据目录都不会被覆盖。
      </p>
      {archived && (
        <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          项目已归档，只能查看历史交付物，不能重新准备交付。
        </p>
      )}
      {state.status === 'error' && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{state.message}</span>
          <button type="button" onClick={() => void prepare()} className="inline-flex items-center gap-1">
            <RefreshCw aria-hidden="true" className="size-3" />重试
          </button>
        </div>
      )}
      {state.status === 'idle' && selectedAsset !== undefined && (
        <p className="rounded-xl bg-foreground/[0.035] px-3 py-4 text-center text-xs text-foreground/50">
          选择“运行交付预检”，核对提案、QA、本轮状态、格式回写与导出完整性。
        </p>
      )}
      {state.status === 'ready' && (
        <DeliveryResult
          result={state.result}
          saving={saving}
          onSave={() => void save()}
          onCopyReport={() => void copyReport()}
        />
      )}
    </section>
  )
}

function DeliveryResult({
  result,
  saving,
  onSave,
  onCopyReport,
}: {
  result: LinguistPrepareDeliveryResult
  saving: boolean
  onSave: () => void
  onCopyReport: () => void
}): React.ReactElement {
  const { preflight, verification } = result
  return (
    <div className="space-y-3">
      <div
        role="status"
        className={cn(
          'flex items-start gap-2 rounded-xl px-3 py-2.5',
          preflight.ready ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
        )}
      >
        {preflight.ready
          ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          : <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
        <div>
          <p className="text-xs font-semibold">{preflight.ready ? '交付预检通过' : '交付预检未通过'}</p>
          <p className="mt-0.5 text-[11px] opacity-80">
            {stageProgressSummary(preflight.workflowStage, preflight.stageCounts)}
            {' · '}
            {preflight.segmentCount} 段
          </p>
        </div>
      </div>

      <dl className="grid gap-2 text-[11px] sm:grid-cols-3">
        <Metric label="待处理提案" value={preflight.pendingProposalCount} />
        <Metric label="开放 QA 错误" value={preflight.qa.openErrors} />
        <Metric label="QA 警告 / 已豁免" value={`${preflight.qa.openWarnings} / ${preflight.qa.waived}`} />
      </dl>
      {preflight.expectedNativeStatus !== undefined && (
        <p className="text-[11px] text-foreground/60">
          原生状态回写：<code className="rounded bg-foreground/[0.06] px-1 py-0.5">{preflight.expectedNativeStatus}</code>
        </p>
      )}
      {preflight.blockers.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-destructive/[0.06] px-3 py-2 text-[11px] text-destructive">
          {preflight.blockers.map((blocker) => (
            <li key={blocker.code}>• {blocker.message}</li>
          ))}
        </ul>
      )}
      {verification !== undefined && (
        <div className="space-y-2 rounded-xl bg-success/[0.06] p-3 text-[11px] text-foreground/65">
          <p className="font-medium text-foreground">重新导入验证已完成</p>
          <p>
            源文 {verification.verifiedSourceSegments} · 译文 {verification.verifiedTargetSegments}
            {' · '}原生状态 {verification.verifiedNativeStatusSegments}
            {' · '}标签/占位符已保留
          </p>
          <p>
            译文变化 {verification.changedTargetSegments} 段 · 状态变化 {verification.changedNativeStatusSegments} 段
          </p>
          <p className="break-all font-mono text-[10px]">SHA-256 {verification.sha256}</p>
          <p>默认文件名：{verification.suggestedFilename}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!preflight.ready || verification === undefined || saving}
          onClick={onSave}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-45"
        >
          {saving
            ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            : <Download aria-hidden="true" className="size-3.5" />}
          保存交付副本
        </button>
        <button
          type="button"
          onClick={onCopyReport}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground/[0.06] px-3 text-xs text-foreground"
        >
          <Clipboard aria-hidden="true" className="size-3.5" />
          复制 PM 审校报告
        </button>
      </div>
      <details className="rounded-xl bg-foreground/[0.035] px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-foreground">审校报告预览</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-5 text-foreground/60">
          {result.reportMarkdown}
        </pre>
      </details>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | number }): React.ReactElement {
  return (
    <div className="rounded-lg bg-foreground/[0.04] px-2.5 py-2">
      <dt className="text-foreground/45">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  )
}
