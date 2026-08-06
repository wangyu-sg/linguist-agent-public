/**
 * LinguistPreviewBody — Proma Preview Tab / 分屏内的 Linguist 预览体。
 *
 * 由 PreviewTabContent / PreviewPanel 在 PreviewFile.linguist 存在时挂载，
 * 复用原生预览 Tab 的打开 / 关闭 / 切换 / 复用生命周期（本组件不持有任何
 * Tab 状态）。数据全部走 linguist IPC（opaque id 进；路径 / 字节 authority
 * 留在主进程围栏）：
 *
 * - 批次（Batch）：默认「批次概览」语义预览——格式 / 语言对 / 段数 /
 *   打开时统计快照 + linguist.cat.query 分页拉取的双语片段（标签 / 占位符
 *   渲染为 chip，本页告警诚实标注非完整 QA）；原始 XML 只经显式
 *   「查看原始文件」进入三态 raw 层次（previewAssetSource，截断护栏诚实
 *   提示），不再默认把整文件泼进 renderer。
 * - Context 文档：previewContextDoc 三态直渲即是格式可读预览本身
 *   （docx → HTML、文本类直读、图片 / PDF → proma-file:// 原生渲染）。
 *
 * 状态机沿用既有 busy/error/ready + retry + aliveRef 形状；组件卸载后不再
 * setState。归档项目可用（所有通道均为纯读）。
 */

import * as React from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import DOMPurify from 'dompurify'
import type {
  LinguistAssetPreviewResult,
  LinguistIpcResult,
  LinguistSegmentInfo,
} from '@proma/shared'
import type {
  LinguistBatchPreviewTarget,
  LinguistContextDocPreviewTarget,
  LinguistPreviewTarget,
  LinguistReferenceCandidatePreviewTarget,
  LinguistReferenceImportPreviewTarget,
} from '@/atoms/preview-atoms'
import { splitProtectedText } from './TargetEditor'
import { describeLinguistIpcError } from './project-utils'
import {
  CURRENT_STAGE_STATE_LABELS,
  SEGMENT_STATUS_LABELS,
  findMissingProtectedTokens,
  formatCountBreakdown,
  formatPageRange,
} from './linguist-preview-utils'

/** 语义预览分页大小（大文件经分页浏览，不做整文件加载）。 */
const SEGMENT_PAGE_SIZE = 50
/** 告警区最多展开的片段行数。 */
const WARNING_LIST_MAX = 5

type LoadState<T> =
  | { status: 'busy' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }

/** invoke 通用装载：信封错误 → error（可重试）；组件卸载后不再 setState。 */
function useLinguistPreviewLoad<T>(
  invoke: () => Promise<LinguistIpcResult<T>>,
  deps: readonly unknown[],
): { state: LoadState<T>; retry: () => void } {
  const [state, setState] = React.useState<LoadState<T>>({ status: 'busy' })
  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const load = React.useCallback(async (): Promise<void> => {
    setState({ status: 'busy' })
    let result: LinguistIpcResult<T>
    try {
      result = await invoke()
    } catch {
      if (aliveRef.current) setState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
      return
    }
    if (!aliveRef.current) return
    if (!result.ok) {
      setState({ status: 'error', message: describeLinguistIpcError(result.error) })
      return
    }
    setState({ status: 'ready', data: result.data })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  React.useEffect(() => {
    void load()
  }, [load])

  return { state, retry: () => void load() }
}

function BusyBlock(): React.ReactElement {
  return (
    <div
      role="status"
      className="flex min-h-28 flex-1 items-center justify-center gap-2 rounded-lg bg-content-area px-4 text-[13px] text-foreground/55 shadow-sm"
    >
      <Loader2 size={14} className="animate-spin flex-shrink-0" />
      正在生成预览…
    </div>
  )
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }): React.ReactElement {
  return (
    <div
      role="alert"
      className="flex items-center gap-3 rounded-lg bg-destructive/[0.06] px-4 py-3 shadow-sm"
    >
      <AlertTriangle size={16} className="flex-shrink-0 text-destructive" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground/85">预览失败</p>
        <p className="text-[12px] text-foreground/55">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
      >
        <RefreshCw size={12} />
        <span>重试</span>
      </button>
    </div>
  )
}

/**
 * 三态 raw / 可读内容渲染（text / html / url）。主进程围栏产物：
 * text 直读（截断护栏诚实提示）；html 为 docx/xlsx 转换产物（源文件是
 * 用户导入内容，按 DiffTabContent 先例 DOMPurify 消毒，样式复用
 * .office-preview-host）；url 为 proma-file:// 不透明 token URL 直渲染。
 */
function ThreeStatePreviewContent({ result }: { result: LinguistAssetPreviewResult }): React.ReactElement {
  if (result.kind === 'text') {
    return (
      <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-content-area shadow-sm">
        {result.truncated && (
          <div className="sticky top-0 border-b border-border/45 bg-muted/40 px-4 py-2 text-[11px] text-foreground/55">
            文件过大，仅显示前 200,000 字符
          </div>
        )}
        <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground/80">
          {result.text}
        </pre>
      </div>
    )
  }

  if (result.kind === 'html') {
    return (
      <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-content-area shadow-sm">
        <div
          className="office-preview-host"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.html) }}
        />
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 rounded-lg bg-content-area p-3 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center gap-2 text-[12px] text-foreground/55">
        <FileText size={13} className="flex-shrink-0 text-foreground/40" />
        <span>
          {result.ext === '' ? '未知格式' : `.${result.ext}`} 按原始文件直渲染
        </span>
      </div>
      <iframe
        src={result.url}
        className="min-h-32 flex-1 w-full rounded-md border border-border/40 bg-background"
        title={result.filename}
      />
    </div>
  )
}

/** 源文 / 译文文本：标签与占位符渲染为 chip（与编辑器同一 token 判定）。 */
function ProtectedText({ text }: { text: string }): React.ReactElement {
  const parts = splitProtectedText(text)
  return (
    <p className="whitespace-pre-wrap break-words leading-relaxed">
      {parts.map((part, index) =>
        part.kind === 'token' ? (
          <code
            key={index}
            className="mx-0.5 rounded bg-foreground/[0.07] px-1 py-px font-mono text-[11px] text-foreground/70"
          >
            {part.value}
          </code>
        ) : (
          <React.Fragment key={index}>{part.value}</React.Fragment>
        ),
      )}
    </p>
  )
}

/** 批次概览的统计快照行（打开时刻 getSummary 的展示元数据）。 */
function BatchSnapshotLine({ target }: { target: LinguistBatchPreviewTarget }): React.ReactElement | null {
  const statusLine = target.segmentCounts
    ? formatCountBreakdown(SEGMENT_STATUS_LABELS, target.segmentCounts)
    : null
  const stageLine = target.currentStageCounts
    ? formatCountBreakdown(CURRENT_STAGE_STATE_LABELS, target.currentStageCounts)
    : null
  const qaLine = target.openQaCount !== undefined && target.openQaCount > 0
    ? `开放 QA ${target.openQaCount}`
    : null
  const parts = [statusLine, stageLine, qaLine].filter((part): part is string => part !== null)
  if (parts.length === 0) return null
  return (
    <p className="text-[11px] text-foreground/45">
      {parts.join('；')}
      <span className="ml-1 text-foreground/35">（打开时统计快照）</span>
    </p>
  )
}

/** 分页双语片段列表 + 本页标签 / 占位符告警。 */
function BatchSegmentPage({
  target,
  offset,
  onPageChange,
}: {
  target: LinguistBatchPreviewTarget
  offset: number
  onPageChange: (offset: number) => void
}): React.ReactElement {
  const { state, retry } = useLinguistPreviewLoad(
    () => window.electronAPI.linguistCatQuery({
      projectId: target.projectId,
      assetId: target.assetId,
      limit: SEGMENT_PAGE_SIZE,
      offset,
    }),
    [target.projectId, target.assetId, offset],
  )

  if (state.status === 'busy') return <BusyBlock />
  if (state.status === 'error') return <ErrorBlock message={state.message} onRetry={retry} />

  const result = state.data
  const warnings = findMissingProtectedTokens(result.segments)
  const previousOffset = Math.max(0, offset - SEGMENT_PAGE_SIZE)
  const nextOffset = offset + SEGMENT_PAGE_SIZE

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {warnings.length > 0 && (
        <div className="rounded-lg border border-warning/25 bg-warning-soft/60 px-3 py-2 text-[12px] text-foreground/70">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={12} className="text-warning" />
            本页 {warnings.length} 段译文未完整保留源文标签 / 占位符（仅检查当前页，非完整 QA）
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {warnings.slice(0, WARNING_LIST_MAX).map((warning) => (
              <li key={warning.segmentId} className="text-foreground/55">
                段 #{warning.ordinal + 1} 缺失：
                {warning.missingTokens.map((token, index) => (
                  <code key={index} className="mx-0.5 rounded bg-foreground/[0.07] px-1 font-mono text-[11px]">
                    {token}
                  </code>
                ))}
              </li>
            ))}
            {warnings.length > WARNING_LIST_MAX && (
              <li className="text-foreground/40">… 其余 {warnings.length - WARNING_LIST_MAX} 段从略</li>
            )}
          </ul>
        </div>
      )}

      {result.segments.length === 0 ? (
        <p className="rounded-lg bg-content-area px-4 py-6 text-center text-[12px] text-foreground/45 shadow-sm">
          该批次没有可显示的片段
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-0.5">
          {result.segments.map((segment: LinguistSegmentInfo) => (
            <li
              key={segment.id}
              className="rounded-lg bg-content-area px-3 py-2 shadow-sm"
            >
              <div className="flex items-center gap-2 text-[11px] text-foreground/45">
                <span className="font-mono">#{segment.ordinal + 1}</span>
                {segment.key !== undefined && (
                  <span className="truncate font-mono text-foreground/40">{segment.key}</span>
                )}
                <span className="ml-auto flex-shrink-0 rounded-full border border-border/60 px-2 py-px">
                  {SEGMENT_STATUS_LABELS[segment.status]}
                </span>
              </div>
              <div className="mt-1 grid gap-1 text-[12px] text-foreground/80">
                <ProtectedText text={segment.source} />
                {segment.target === '' ? (
                  <p className="text-foreground/35">（尚无译文）</p>
                  ) : (
                  <ProtectedText text={segment.target} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 text-[12px] text-foreground/55">
        <span>{formatPageRange(offset, SEGMENT_PAGE_SIZE, result.total)}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="上一页"
            disabled={offset === 0}
            onClick={() => onPageChange(previousOffset)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-foreground/[0.07] disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft size={12} />
            上一页
          </button>
          <button
            type="button"
            aria-label="下一页"
            disabled={!result.hasMore}
            onClick={() => onPageChange(nextOffset)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-foreground/[0.07] disabled:pointer-events-none disabled:opacity-40"
          >
            下一页
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** 批次预览：默认语义概览；「查看原始文件」进入 raw 三态层次。 */
function BatchPreview({ target }: { target: LinguistBatchPreviewTarget }): React.ReactElement {
  const [mode, setMode] = React.useState<'semantic' | 'raw'>('semantic')
  const [offset, setOffset] = React.useState(0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <span className="truncate font-medium text-foreground">{target.filename}</span>
        <span className="flex-shrink-0 rounded-full border border-border/60 px-2 py-0.5 font-mono text-[11px] text-foreground/55">
          {target.formatId}
        </span>
        <span className="flex-shrink-0 tabular-nums text-foreground/50">{target.segmentCount} 段</span>
        {target.sourceLocale !== undefined && target.targetLocale !== undefined && (
          <span className="flex-shrink-0 font-mono text-[11px] text-foreground/45">
            {target.sourceLocale} → {target.targetLocale}
          </span>
        )}
        <span className="flex-shrink-0 text-foreground/40">只读</span>
        {mode === 'semantic' ? (
          <button
            type="button"
            onClick={() => setMode('raw')}
            className="ml-auto flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-foreground/65 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
          >
            <FileCode2 size={12} />
            查看原始文件
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setMode('semantic')}
            className="ml-auto flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-foreground/65 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
          >
            <ArrowLeft size={12} />
            返回批次概览
          </button>
        )}
      </div>

      {mode === 'semantic' ? (
        <>
          <BatchSnapshotLine target={target} />
          <div aria-label="批次语义预览" className="flex min-h-0 flex-1 flex-col">
            <BatchSegmentPage target={target} offset={offset} onPageChange={setOffset} />
          </div>
        </>
      ) : (
        <div aria-label="原始文件预览" className="flex min-h-0 flex-1 flex-col">
          <BatchRawPreview target={target} />
        </div>
      )}
    </div>
  )
}

/** 批次 raw 层次：previewAssetSource 三态（显式「查看原始文件」才进入）。 */
function BatchRawPreview({ target }: { target: LinguistBatchPreviewTarget }): React.ReactElement {
  const { state, retry } = useLinguistPreviewLoad(
    () => window.electronAPI.linguistProjectsPreviewAssetSource({
      projectId: target.projectId,
      assetId: target.assetId,
    }),
    [target.projectId, target.assetId],
  )
  if (state.status === 'busy') return <BusyBlock />
  if (state.status === 'error') return <ErrorBlock message={state.message} onRetry={retry} />
  return <ThreeStatePreviewContent result={state.data} />
}

function ReadonlySourcePreview({
  filename,
  label,
  invoke,
  deps,
}: {
  filename: string
  label: string
  invoke: () => Promise<LinguistIpcResult<LinguistAssetPreviewResult>>
  deps: readonly unknown[]
}): React.ReactElement {
  const { state, retry } = useLinguistPreviewLoad(invoke, deps)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <span className="truncate font-medium text-foreground">{filename}</span>
        <span className="flex-shrink-0 text-foreground/40">{label}</span>
      </div>
      <div aria-label={`${label.split(' · ')[0]}预览`} className="flex min-h-0 flex-1 flex-col">
        {state.status === 'busy' && <BusyBlock />}
        {state.status === 'error' && <ErrorBlock message={state.message} onRetry={retry} />}
        {state.status === 'ready' && <ThreeStatePreviewContent result={state.data} />}
      </div>
    </div>
  )
}

/** Context 文档预览：三态直渲即格式可读预览（docx HTML / 文本 / 原生）。 */
function ContextDocPreview({ target }: { target: LinguistContextDocPreviewTarget }): React.ReactElement {
  return <ReadonlySourcePreview
    filename={target.filename}
    label="Context 文档 · 只读"
    invoke={() => window.electronAPI.linguistAssetsPreviewContextDoc({
      projectId: target.projectId,
      docId: target.docId,
    })}
    deps={[target.projectId, target.docId]}
  />
}

/** TM/TB 文件导入原件：只展示原文件的安全三态，不伪装成可编辑语言资产。 */
function ReferenceImportPreview({ target }: { target: LinguistReferenceImportPreviewTarget }): React.ReactElement {
  const label = target.referenceKind === 'tm' ? '翻译记忆原件' : '术语库原件'
  return <ReadonlySourcePreview
    filename={target.filename}
    label={`${label} · 只读`}
    invoke={() => window.electronAPI.linguistProjectsPreviewReferenceImport({
      projectId: target.projectId,
      importId: target.importId,
    })}
    deps={[target.projectId, target.importId]}
  />
}

/** 未确认候选：同一个 Proma Preview Tab，只向主进程提交绑定 token。 */
function ReferenceCandidatePreview({ target }: { target: LinguistReferenceCandidatePreviewTarget }): React.ReactElement {
  const label = target.referenceKind === 'tm' ? '翻译记忆候选原件' : '术语库候选原件'
  return <ReadonlySourcePreview
    filename={target.filename}
    label={`${label} · 未确认 · 只读`}
    invoke={() => window.electronAPI.linguistReferencesPreviewCandidate({
      projectId: target.projectId,
      kind: target.referenceKind,
      candidateId: target.candidateId,
      sourceSha256: target.sourceSha256,
    })}
    deps={[target.projectId, target.referenceKind, target.candidateId, target.sourceSha256]}
  />
}

export function LinguistPreviewBody({ target }: { target: LinguistPreviewTarget }): React.ReactElement {
  switch (target.kind) {
    case 'batch': return <BatchPreview target={target} />
    case 'contextDoc': return <ContextDocPreview target={target} />
    case 'referenceImport': return <ReferenceImportPreview target={target} />
    case 'referenceCandidate': return <ReferenceCandidatePreview target={target} />
  }
}
