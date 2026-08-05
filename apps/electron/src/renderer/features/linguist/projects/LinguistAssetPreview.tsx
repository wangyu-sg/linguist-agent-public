/**
 * LinguistAssetPreview — CAT 资产源文件预览对话框（PB-089）
 *
 * 职责：
 * - 打开即经 linguistProjectsPreviewAssetSource 拉取预览（主进程围栏解析
 *   source/ blob 后三态分派；零字节/零路径过 IPC，PB-110 纪律）。归档项目
 *   允许预览（纯读操作，与导出禁用逻辑不同）。
 * - 三态渲染：text → 等宽纯文本（截断护栏命中时给出诚实提示）；html →
 *   office-preview-host 容器直渲（复用 Proma 预览栈的 docx/xlsx 转换产物，
 *   样式见 globals.css .office-preview-host）；url → proma-file:// 不透明
 *   token URL 经 iframe 直渲染（未知扩展名降级）。
 * - 状态机照搬 ProjectAssetsSection 的 ImportState/ExportState 形状
 *   （busy/error/ready + retry + aliveRef）；组件卸载后不再 setState。
 *
 * 本组件只持有 UI 状态，不进 atom；关闭由父级卸载完成。
 */

import * as React from 'react'
import { AlertTriangle, FileText, Loader2, RefreshCw } from 'lucide-react'
import DOMPurify from 'dompurify'
import type { LinguistAssetInfo, LinguistAssetPreviewResult } from '@proma/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { describeLinguistIpcError } from './project-utils'

/** 预览状态机：busy → ready | error（error 可重试，重试重新 invoke） */
type PreviewState =
  | { status: 'busy' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: LinguistAssetPreviewResult }

interface LinguistAssetPreviewProps {
  projectId: string
  /** 预览目标资产（文件名/格式仅作展示元数据；通道只提交 opaque id） */
  asset: LinguistAssetInfo
  onClose: () => void
}

interface LinguistAssetPreviewSurfaceProps {
  projectId: string
  asset: LinguistAssetInfo
  embedded?: boolean
}

export function LinguistAssetPreview({
  projectId,
  asset,
  onClose,
}: LinguistAssetPreviewProps): React.ReactElement {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>预览源文件</DialogTitle>
          <DialogDescription>
            {asset.filename} · {asset.formatId} · {asset.segmentCount} 段
          </DialogDescription>
        </DialogHeader>
        <LinguistAssetPreviewSurface projectId={projectId} asset={asset} />
      </DialogContent>
    </Dialog>
  )
}

/** LF-055：Dialog 与 Bottom Dock 复用同一只读、主进程围栏预览链。 */
export function LinguistAssetPreviewSurface({
  projectId,
  asset,
  embedded = false,
}: LinguistAssetPreviewSurfaceProps): React.ReactElement {
  const [state, setState] = React.useState<PreviewState>({ status: 'busy' })
  /** 组件卸载后不再 setState（invoke 悬置期间用户可能关闭对话框） */
  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const load = React.useCallback(async (): Promise<void> => {
    setState({ status: 'busy' })
    let result: Awaited<ReturnType<typeof window.electronAPI.linguistProjectsPreviewAssetSource>>
    try {
      result = await window.electronAPI.linguistProjectsPreviewAssetSource({
        projectId,
        assetId: asset.assetId,
      })
    } catch {
      if (aliveRef.current) setState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
      return
    }
    if (!aliveRef.current) return
    if (!result.ok) {
      setState({ status: 'error', message: describeLinguistIpcError(result.error) })
      return
    }
    setState({ status: 'ready', result: result.data })
  }, [projectId, asset.assetId])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className={embedded ? 'flex h-full min-h-0 flex-col gap-2' : undefined}>
      {embedded && (
        <div className="flex shrink-0 items-center justify-between gap-3 text-xs">
          <span className="truncate font-medium text-foreground">{asset.filename}</span>
          <span className="shrink-0 text-muted-foreground">{asset.formatId} · 只读</span>
        </div>
      )}
      {state.status === 'busy' && (
        <div
          role="status"
          className="flex min-h-28 flex-1 items-center justify-center gap-2 rounded-lg bg-content-area px-4 text-[13px] text-foreground/55 shadow-sm"
        >
          <Loader2 size={14} className="animate-spin flex-shrink-0" />
          正在生成预览…
        </div>
      )}

      {state.status === 'error' && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-lg bg-destructive/[0.06] px-4 py-3 shadow-sm"
        >
          <AlertTriangle size={16} className="flex-shrink-0 text-destructive" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-foreground/85">预览失败</p>
            <p className="text-[12px] text-foreground/55">{state.message}</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
          >
            <RefreshCw size={12} />
            <span>重试</span>
          </button>
        </div>
      )}

      {state.status === 'ready' && <PreviewContent result={state.result} embedded={embedded} />}
    </div>
  )
}

/** 三态内容渲染（text / html / url） */
function PreviewContent({
  result,
  embedded,
}: {
  result: LinguistAssetPreviewResult
  embedded: boolean
}): React.ReactElement {
  if (result.kind === 'text') {
    return (
      <div className={`${embedded ? 'min-h-0 flex-1' : 'max-h-[60vh]'} overflow-auto rounded-lg bg-content-area shadow-sm`}>
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
      <div className={`${embedded ? 'min-h-0 flex-1' : 'max-h-[60vh]'} overflow-auto rounded-lg bg-content-area shadow-sm`}>
        {/* docx/xlsx 转换产物（主进程生成，但源文件是用户导入内容，按
            DiffTabContent 先例 DOMPurify 消毒）；样式复用 .office-preview-host */}
        <div
          className="office-preview-host"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.html) }}
        />
      </div>
    )
  }

  // url 态：未知扩展名降级，proma-file:// 不透明 token URL 直渲染
  return (
    <div className={`${embedded ? 'min-h-0 flex-1' : ''} rounded-lg bg-content-area p-3 flex flex-col gap-2 shadow-sm`}>
      <div className="flex items-center gap-2 text-[12px] text-foreground/55">
        <FileText size={13} className="flex-shrink-0 text-foreground/40" />
        <span>
          {result.ext === '' ? '未知格式' : `.${result.ext}`} 暂不支持内联转换，按原始文件直渲染
        </span>
      </div>
      <iframe
        src={result.url}
        className={`${embedded ? 'min-h-32 flex-1' : 'h-[50vh]'} w-full rounded-md border border-border/40 bg-background`}
        title={result.filename}
      />
    </div>
  )
}
