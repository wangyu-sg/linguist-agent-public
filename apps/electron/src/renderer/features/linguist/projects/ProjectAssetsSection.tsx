/**
 * ProjectAssetsSection — 项目详情内的「资产（文件）」区（ticket PB-033）
 *
 * 职责：
 * - 「导入文件」入口：点击 → linguistProjectsImport（主进程原生选择器 +
 *   主进程读盘解析，renderer 永不接触路径/字节，计划 §7.4）。归档（只读）
 *   项目禁用并给出原因提示。
 * - 进度：导入是单次 invoke（读取+解析+落库均在主进程内完成），没有分阶段
 *   事件流，故只呈现诚实的 indeterminate 忙碌态（role="status" + 阶段文案
 *   「导入中（读取并解析文件）」），绝不伪造 determinate 进度条。
 * - 结果：成功 → toast + 经 onSummaryRefresh 重拉 getSummary（真源），新资产
 *   出现在列表；列表行 = 文件名 / formatId / 段数 / 截断 SHA-256（可复制
 *   完整值）/ 导入时间（以导入完成即重拉时刻近似——领域 Asset 不携带导入
 *   时间戳，见 shared 契约注释）。adapter 警告只存在于导入结果中（摘要不含），
 *   故仅刚导入的资产行内联展示（可展开）。
 * - 失败：信封错误 → 行内 role="alert" 错误区（中文文案 + 稳定码）+「重试」
 *   （重试 = 重新打开选择器）；用户取消是正常分支（{cancelled:true}），
 *   仅轻提示「已取消导入」，不打扰。
 *
 * 数据纪律（计划 §9.5）：资产列表永远来自 getSummary 的当次拉取结果（父级
 * 持有，导入成功后重拉）；本组件只持有 UI 状态（忙碌/错误/最近导入结果/
 * 警告展开态），均不进 atom。
 */

import * as React from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react'
import type { LinguistAssetInfo, LinguistProjectSummary } from '@proma/shared'
import { LinguistAssetPreview } from './LinguistAssetPreview'
import { describeLinguistIpcError, formatProjectTime, truncateSha256 } from './project-utils'

/** 导入状态机：idle → busy → idle | error（error 可重试，重试重开选择器） */
type ImportState = { status: 'idle' } | { status: 'busy' } | { status: 'error'; message: string }

/** 导出状态机：同一时间只允许一个资产打开系统保存流程 */
type ExportState =
  | { status: 'idle' }
  | { status: 'busy'; assetId: string }
  | { status: 'error'; assetId: string; message: string }

/** 会话内最近一次成功导入（警告 / 导入时间仅存在于导入结果，摘要不含） */
interface LastImport {
  assetId: string
  filename: string
  formatId: string
  segmentCount: number
  warnings: { code: string; message: string; segmentKey?: string }[]
  /** 导入完成（摘要重拉）时刻——「导入时间」的诚实近似 */
  importedAt: string
}

interface ProjectAssetsSectionProps {
  projectId: string
  /** 归档（只读）项目禁用导入 */
  archived: boolean
  /** 当前摘要；null = 摘要拉取失败（资产区降级提示，导入入口仍可用） */
  summary: LinguistProjectSummary | null
  /** 导入成功后重拉摘要（计数格 + 资产列表同步刷新；真源在主进程） */
  onSummaryRefresh: () => Promise<void>
}

export function ProjectAssetsSection({
  projectId,
  archived,
  summary,
  onSummaryRefresh,
}: ProjectAssetsSectionProps): React.ReactElement {
  const [importState, setImportState] = React.useState<ImportState>({ status: 'idle' })
  const [exportState, setExportState] = React.useState<ExportState>({ status: 'idle' })
  /** PB-089 预览目标（非 null = 预览对话框打开；归档项目也允许，纯读操作） */
  const [previewAsset, setPreviewAsset] = React.useState<LinguistAssetInfo | null>(null)
  const [lastImport, setLastImport] = React.useState<LastImport | null>(null)
  const [warningsExpanded, setWarningsExpanded] = React.useState(false)
  /** 组件卸载后不再 setState（invoke 悬置期间用户可能返回列表） */
  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const importBusy = importState.status === 'busy'
  const exportBusy = exportState.status === 'busy'

  const handleImport = async (): Promise<void> => {
    if (importBusy || exportBusy || archived) return
    setImportState({ status: 'busy' })
    let result: Awaited<ReturnType<typeof window.electronAPI.linguistProjectsImport>>
    try {
      result = await window.electronAPI.linguistProjectsImport({ projectId })
    } catch {
      if (aliveRef.current) setImportState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
      return
    }
    if (!aliveRef.current) return
    if (!result.ok) {
      setImportState({ status: 'error', message: describeLinguistIpcError(result.error) })
      return
    }
    if (result.data.cancelled) {
      // 取消是正常分支：轻提示即可，不当作错误
      setImportState({ status: 'idle' })
      toast('已取消导入')
      return
    }
    const data = result.data
    setLastImport({
      assetId: data.assetId,
      filename: data.filename,
      formatId: data.formatId,
      segmentCount: data.segmentCount,
      warnings: data.warnings,
      importedAt: new Date().toISOString(),
    })
    setWarningsExpanded(false)
    setImportState({ status: 'idle' })
    // 真源刷新：新资产经 getSummary 重拉后出现在列表（导入两次则累积两行）
    await onSummaryRefresh()
    if (!aliveRef.current) return
    toast.success(data.status === 'skipped-duplicate' ? `已跳过重复文件「${data.filename}」` : `已导入「${data.filename}」`, {
      description:
        `${data.segmentCount} 段 · ${data.formatId}` +
        (data.status === 'skipped-duplicate' ? ' · 项目中已有同源资产' : '') +
        (data.warnings.length > 0 ? ` · ${data.warnings.length} 条警告` : ''),
    })
  }

  const handleExport = async (asset: LinguistAssetInfo): Promise<void> => {
    if (archived || importBusy || exportBusy) return
    setExportState({ status: 'busy', assetId: asset.assetId })
    let result: Awaited<ReturnType<typeof window.electronAPI.linguistExportsSaveAsset>>
    try {
      result = await window.electronAPI.linguistExportsSaveAsset({
        projectId,
        assetId: asset.assetId,
      })
    } catch {
      if (aliveRef.current) {
        setExportState({
          status: 'error',
          assetId: asset.assetId,
          message: '与主进程通信异常（INTERNAL）',
        })
      }
      return
    }
    if (!aliveRef.current) return
    if (!result.ok) {
      setExportState({
        status: 'error',
        assetId: asset.assetId,
        message: describeLinguistIpcError(result.error),
      })
      return
    }
    if (result.data.cancelled) {
      setExportState({ status: 'idle' })
      toast('已取消导出')
      return
    }
    setExportState({ status: 'idle' })
    toast.success(`已导出「${result.data.filename}」`, {
      description: `${result.data.verifiedSegments} 段 · SHA-256 ${truncateSha256(result.data.artifact.sha256)}`,
    })
  }

  return (
    <section
      aria-label="资产（文件）"
      aria-busy={importBusy || exportBusy}
      className="flex flex-col gap-3"
    >
      {/* 区标题 + 导入入口 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] font-medium text-foreground/55 px-1">
          资产（文件）{summary !== null && <span className="text-foreground/40">（{summary.assetCount}）</span>}
        </div>
        <div className="flex items-center gap-2">
          {archived && (
            <span className="text-[12px] text-foreground/40">已归档项目为只读，无法导入</span>
          )}
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={archived || importBusy || exportBusy}
            title={archived ? '已归档项目为只读，无法导入' : '导入 XLIFF / CSV / TSV / JSON 翻译资产'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm disabled:opacity-45 disabled:pointer-events-none"
          >
            {importBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            <span>{importBusy ? '导入中…' : '导入文件'}</span>
          </button>
        </div>
      </div>

      {/* 忙碌态：诚实的 indeterminate（单次 invoke，无分阶段事件） */}
      {importBusy && (
        <div
          role="status"
          className="rounded-xl border border-border/50 bg-content-area px-4 py-3 flex items-center gap-2 text-[13px] text-foreground/55"
        >
          <Loader2 size={14} className="animate-spin flex-shrink-0" />
          导入中（读取并解析文件）…
        </div>
      )}

      {/* 失败态：行内错误区 + 重试（重开选择器） */}
      {importState.status === 'error' && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-3 flex items-center gap-3"
        >
          <AlertTriangle size={16} className="flex-shrink-0 text-destructive" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-foreground/85">导入失败</p>
            <p className="text-[12px] text-foreground/55">{importState.message}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleImport()}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
          >
            <RefreshCw size={12} />
            <span>重试</span>
          </button>
        </div>
      )}

      {/* 资产列表（真源 = getSummary 当次结果） */}
      {summary === null ? (
        <div className="rounded-xl border border-border/50 bg-content-area px-4 py-3 text-[13px] text-foreground/45">
          资产列表暂不可用（摘要拉取失败）；仍可尝试导入，成功后计数将随摘要恢复刷新。
        </div>
      ) : summary.assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 flex flex-col items-center text-center gap-1.5">
          <FileText size={18} className="text-foreground/30" />
          <p className="text-[13px] text-foreground/50">还没有资产</p>
          <p className="text-[12px] text-foreground/40">
            点击「导入文件」选择 XLIFF / CSV / TSV / JSON 文件，同一项目可累积多个资产。
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {summary.assets.map((asset) => (
            <AssetRow
              key={asset.assetId}
              asset={asset}
              lastImport={lastImport !== null && lastImport.assetId === asset.assetId ? lastImport : null}
              warningsExpanded={warningsExpanded}
              onToggleWarnings={() => setWarningsExpanded((open) => !open)}
              archived={archived}
              exportDisabled={importBusy || exportBusy}
              exportState={
                exportState.status !== 'idle' && exportState.assetId === asset.assetId
                  ? exportState
                  : { status: 'idle' }
              }
              onExport={() => void handleExport(asset)}
              onPreview={() => setPreviewAsset(asset)}
            />
          ))}
        </ul>
      )}

      {/* PB-089 源文件预览对话框（打开期间目标资产不可变，关闭即卸载） */}
      {previewAsset !== null && (
        <LinguistAssetPreview
          projectId={projectId}
          asset={previewAsset}
          onClose={() => setPreviewAsset(null)}
        />
      )}
    </section>
  )
}

/** 单个资产行：文件名 / formatId / 段数 / 截断摘要（可复制）/ 导入时间与警告（仅刚导入行） */
function AssetRow({
  asset,
  lastImport,
  warningsExpanded,
  onToggleWarnings,
  archived,
  exportDisabled,
  exportState,
  onExport,
  onPreview,
}: {
  asset: LinguistAssetInfo
  lastImport: LastImport | null
  warningsExpanded: boolean
  onToggleWarnings: () => void
  archived: boolean
  exportDisabled: boolean
  exportState: ExportState
  onExport: () => void
  onPreview: () => void
}): React.ReactElement {
  const warningCount = lastImport?.warnings.length ?? 0
  const exporting = exportState.status === 'busy'
  return (
    <li className="rounded-xl border border-border/50 bg-content-area px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <FileText size={14} className="flex-shrink-0 text-foreground/40" />
        <span className="text-[13px] font-medium text-foreground truncate">{asset.filename}</span>
        <span className="flex-shrink-0 rounded-full border border-border/60 px-2 py-0.5 text-[11px] font-mono text-foreground/55">
          {asset.formatId}
        </span>
        <span className="ml-auto flex-shrink-0 text-[12px] tabular-nums text-foreground/50">
          {asset.segmentCount} 段
        </span>
        {/* PB-089 预览：纯读操作，归档项目也可用（与导出禁用逻辑不同） */}
        <button
          type="button"
          aria-label={`预览 ${asset.filename}`}
          title="预览源文件"
          onClick={onPreview}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-foreground/65 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
        >
          <Eye size={12} />
          <span>预览</span>
        </button>
        <button
          type="button"
          aria-label={`导出 ${asset.filename}`}
          title={archived ? '已归档项目为只读，无法导出' : '导出翻译文件'}
          onClick={onExport}
          disabled={archived || exportDisabled}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-foreground/65 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          <span>{exporting ? '导出中…' : '导出'}</span>
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[12px] text-foreground/45">
        <span className="font-mono" title={`SHA-256 ${asset.sourceSha256}`}>
          SHA-256 {truncateSha256(asset.sourceSha256)}
        </span>
        <CopyDigestButton sha256={asset.sourceSha256} filename={asset.filename} />
        {lastImport !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>导入于 {formatProjectTime(lastImport.importedAt)}</span>
          </>
        )}
        {warningCount > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              aria-expanded={warningsExpanded}
              onClick={onToggleWarnings}
              className="inline-flex items-center gap-1 text-warning hover:text-warning/80 transition-colors duration-100"
            >
              <AlertTriangle size={11} />
              {warningCount} 条警告
              {warningsExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
          </>
        )}
      </div>
      {warningCount > 0 && warningsExpanded && lastImport !== null && (
        <ul className="mt-0.5 flex flex-col gap-1 rounded-lg border border-warning/25 bg-warning-soft/60 px-3 py-2">
          {lastImport.warnings.map((warning, index) => (
            <li key={`${warning.code}-${index}`} className="text-[12px] leading-relaxed text-foreground/60">
              <span className="font-mono text-foreground/45">{warning.code}</span>
              {'：'}
              {warning.message}
              {warning.segmentKey !== undefined && (
                <span className="font-mono text-foreground/40">（段 {warning.segmentKey}）</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {exportState.status === 'busy' && (
        <div role="status" className="flex items-center gap-2 text-[12px] text-foreground/50">
          <Loader2 size={12} className="animate-spin flex-shrink-0" />
          正在生成并打开系统保存对话框…
        </div>
      )}
      {exportState.status === 'error' && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2 flex items-center gap-3"
        >
          <AlertTriangle size={14} className="flex-shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-foreground/85">导出失败</p>
            <p className="text-[12px] text-foreground/55">{exportState.message}</p>
          </div>
          <button
            type="button"
            onClick={onExport}
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
          >
            <RefreshCw size={12} />
            <span>重试</span>
          </button>
        </div>
      )}
    </li>
  )
}

/** 摘要复制按钮：复制完整 SHA-256（截断仅为展示；aria-label 指明对象） */
function CopyDigestButton({ sha256, filename }: { sha256: string; filename: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sha256)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用（权限/上下文）：静默——悬停 title 仍展示完整值
    }
  }

  return (
    <button
      type="button"
      aria-label={`复制 ${filename} 的 SHA-256 摘要`}
      title={copied ? '已复制' : '复制完整 SHA-256'}
      onClick={() => void handleCopy()}
      className="inline-flex items-center justify-center size-5 rounded text-foreground/40 hover:bg-foreground/[0.07] hover:text-foreground/70 transition-colors duration-100"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
    </button>
  )
}
