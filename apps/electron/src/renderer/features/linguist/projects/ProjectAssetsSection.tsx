/**
 * ProjectAssetsSection — 项目详情内的「批次（文件）」区（ticket PB-033）
 *
 * 职责：
 * - 「导入文件」入口：点击 → linguistProjectsImport（主进程原生选择器 +
 *   主进程读盘解析，renderer 永不接触路径/字节，计划 §7.4）。归档（只读）
 *   项目禁用并给出原因提示。
 * - 进度：导入是单次 invoke（读取+解析+落库均在主进程内完成），没有分阶段
 *   事件流，故只呈现诚实的 indeterminate 忙碌态（role="status" + 阶段文案
 *   「导入中（读取并解析文件）」），绝不伪造 determinate 进度条。
 * - 结果：成功 → toast + 经 onSummaryRefresh 重拉 getSummary（真源），新批次
 *   出现在列表；列表行 = 文件名 / formatId / 段数 / 截断 SHA-256（可复制
 *   完整值）/ 导入时间（以导入完成即重拉时刻近似——领域 Batch 不携带导入
 *   时间戳，见 shared 契约注释）。adapter 警告与 LA-INTAKE-007 验证报告只
 *   存在于导入结果中（摘要不含），故仅刚导入的批次行内联展示（警告可展开，
 *   验证报告逐项 ✓/✗）。
 * - 撤销导入（LA-INTAKE-007）：批次行「撤销导入」按钮一键发起；主进程先判
 *   五类下游引用，被拒（IMPORT_UNDO_BLOCKED）时 toast 展示分类计数（提案/
 *   QA/评审/导出/人工编辑段），成功则重拉摘要真源。归档（只读）项目禁用。
 * - 失败：信封错误 → 行内 role="alert" 错误区（中文文案 + 稳定码）+「重试」
 *   （重试 = 重新打开选择器）；用户取消是正常分支（{cancelled:true}），
 *   仅轻提示「已取消导入」，不打扰。
 *
 * 数据纪律（计划 §9.5）：批次列表永远来自 getSummary 的当次拉取结果（父级
 * 持有，导入成功后重拉）；本组件只持有 UI 状态（忙碌/错误/最近导入结果/
 * 警告展开态），均不进 atom。
 *
 * 领域命名：一次导入的双语文件 = 批次（Batch），见 shared 类型 LinguistBatchInfo；
 * 内部标识符沿用存储层兼容命名 asset*，不做全仓重命名。
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
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import type {
  LinguistAssetInfo,
  LinguistImportVerificationCheck,
  LinguistProjectConfirmXlsxMappingRequest,
  LinguistProjectImportResult,
  LinguistProjectSummary,
} from '@proma/shared'
import { useOpenLinguistPreview } from './linguist-preview-open'
import {
  describeImportUndoBlockedCounts,
  describeLinguistIpcError,
  formatProjectTime,
  truncateSha256,
} from './project-utils'

/** 导入状态机：idle → busy → idle | error（error 可重试，重试重开选择器） */
type ImportState = { status: 'idle' } | { status: 'busy' } | { status: 'error'; message: string }

/** 导出状态机：同一时间只允许一个批次打开系统保存流程 */
type ExportState =
  | { status: 'idle' }
  | { status: 'busy'; assetId: string }
  | { status: 'error'; assetId: string; message: string }

/** 撤销导入状态机：同一时间只允许撤销一个批次（结果一律走 toast） */
type UndoImportState = { status: 'idle' } | { status: 'busy'; assetId: string }

/** 会话内最近一次成功导入（警告 / 验证报告 / 导入时间仅存在于导入结果，摘要不含） */
interface LastImport {
  assetId: string
  filename: string
  formatId: string
  segmentCount: number
  warnings: { code: string; message: string; segmentKey?: string }[]
  /** LA-INTAKE-007：导入回读验证报告（段数/格式/语言对/source hash 逐项） */
  verification: { ok: boolean; checks: LinguistImportVerificationCheck[] }
  /** 导入完成（摘要重拉）时刻——「导入时间」的诚实近似 */
  importedAt: string
}

type CompletedImport = Extract<LinguistProjectImportResult, { requiresXlsxMapping: false }>

type PendingXlsxMapping = Omit<
  Extract<LinguistProjectImportResult, { requiresXlsxMapping: true }>,
  'cancelled' | 'requiresXlsxMapping'
> & Pick<LinguistProjectConfirmXlsxMappingRequest, 'sheetName' | 'columns'>

/** 验证检查项 id → 中文标签（与 shared 契约的四项一一对应） */
const VERIFICATION_CHECK_LABELS: Record<LinguistImportVerificationCheck['id'], string> = {
  'segment-count': '段数',
  format: '格式',
  'language-pair': '语言对',
  'source-hash': 'source hash',
}

interface ProjectAssetsSectionProps {
  projectId: string
  /** 归档（只读）项目禁用导入 */
  archived: boolean
  /** 当前摘要；null = 摘要拉取失败（批次区降级提示，导入入口仍可用） */
  summary: LinguistProjectSummary | null
  /** 导入成功后重拉摘要（计数格 + 批次列表同步刷新；真源在主进程） */
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
  const [undoState, setUndoState] = React.useState<UndoImportState>({ status: 'idle' })
  const [lastImport, setLastImport] = React.useState<LastImport | null>(null)
  const [xlsxMapping, setXlsxMapping] = React.useState<PendingXlsxMapping | null>(null)
  const [warningsExpanded, setWarningsExpanded] = React.useState(false)
  /** 批次源文件预览统一进 Proma Preview Tab（不再弹第二套 LA modal）。 */
  const openLinguistPreview = useOpenLinguistPreview()
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
  const undoBusy = undoState.status === 'busy'

  const completeImport = async (data: CompletedImport): Promise<void> => {
    setLastImport({
      assetId: data.assetId,
      filename: data.filename,
      formatId: data.formatId,
      segmentCount: data.segmentCount,
      warnings: data.warnings,
      verification: data.verification,
      importedAt: new Date().toISOString(),
    })
    setWarningsExpanded(false)
    setImportState({ status: 'idle' })
    await onSummaryRefresh()
    if (!aliveRef.current) return
    toast.success(data.status === 'skipped-duplicate' ? `已跳过重复文件「${data.filename}」` : `已导入「${data.filename}」`, {
      description:
        `${data.segmentCount} 段 · ${data.formatId}` +
        (data.status === 'skipped-duplicate' ? ' · 项目中已有同源批次' : '') +
        (data.warnings.length > 0 ? ` · ${data.warnings.length} 条警告` : ''),
    })
  }

  const handleImport = async (): Promise<void> => {
    if (importBusy || exportBusy || undoBusy || archived) return
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
    if (result.data.requiresXlsxMapping) {
      const sheetName = result.data.preview.sheets.find((sheet) => sheet.state === 'visible')?.name
        ?? result.data.preview.sheets[0]?.name
        ?? ''
      setXlsxMapping({
        filename: result.data.filename,
        mappingId: result.data.mappingId,
        sourceSha256: result.data.sourceSha256,
        preview: result.data.preview,
        sheetName,
        columns: { source: '', target: '' },
      })
      setImportState({ status: 'idle' })
      toast('请选择工作表及源文、译文列后确认导入')
      return
    }
    const data = result.data
    await completeImport(data)
  }

  const handleConfirmXlsxMapping = async (): Promise<void> => {
    if (
      xlsxMapping === null
      || xlsxMapping.columns.source === ''
      || xlsxMapping.columns.target === ''
      || importBusy
      || archived
    ) return
    setImportState({ status: 'busy' })
    let result: Awaited<ReturnType<typeof window.electronAPI.linguistProjectsConfirmXlsxMapping>>
    try {
      result = await window.electronAPI.linguistProjectsConfirmXlsxMapping({
        projectId,
        mappingId: xlsxMapping.mappingId,
        sourceSha256: xlsxMapping.sourceSha256,
        sheetName: xlsxMapping.sheetName,
        columns: xlsxMapping.columns,
      })
    } catch {
      if (aliveRef.current) setImportState({ status: 'error', message: '与主进程通信异常（INTERNAL）' })
      return
    }
    if (!aliveRef.current) return
    if (!result.ok) {
      setImportState({ status: 'error', message: describeLinguistIpcError(result.error) })
      return
    }
    setXlsxMapping(null)
    await completeImport(result.data)
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

  /**
   * LA-INTAKE-007 撤销导入：一键发起，主进程先做五类下游引用判定；
   * 被拒（IMPORT_UNDO_BLOCKED）toast 展示分类计数，成功则重拉摘要真源。
   */
  const handleUndoImport = async (asset: LinguistAssetInfo): Promise<void> => {
    if (archived || importBusy || exportBusy || undoBusy) return
    setUndoState({ status: 'busy', assetId: asset.assetId })
    let result: Awaited<ReturnType<typeof window.electronAPI.linguistProjectsUndoImportAsset>>
    try {
      result = await window.electronAPI.linguistProjectsUndoImportAsset({
        projectId,
        assetId: asset.assetId,
      })
    } catch {
      if (aliveRef.current) {
        setUndoState({ status: 'idle' })
        toast.error('撤销导入失败', { description: '与主进程通信异常（INTERNAL）' })
      }
      return
    }
    if (!aliveRef.current) return
    setUndoState({ status: 'idle' })
    if (!result.ok) {
      if (result.error.code === 'IMPORT_UNDO_BLOCKED') {
        const counts = describeImportUndoBlockedCounts(result.error.details)
        toast.error('无法撤销导入', {
          description: counts !== null
            ? `该批次已有下游工作：${counts}。请先处理这些内容再撤销。`
            : describeLinguistIpcError(result.error),
        })
      } else {
        toast.error('撤销导入失败', { description: describeLinguistIpcError(result.error) })
      }
      return
    }
    // 被撤销的批次若正是最近导入行，清掉会话内展示态
    if (lastImport?.assetId === asset.assetId) setLastImport(null)
    await onSummaryRefresh()
    if (!aliveRef.current) return
    toast.success(`已撤销导入「${asset.filename}」`, {
      description:
        `${result.data.deletedSegments} 段已移除` +
        (result.data.sourceBlobRemoved ? '' : '（源文件残留将由下次导入覆盖）'),
    })
  }

  /** PB-089 预览：纯读操作，归档项目也可用（与导出禁用逻辑不同）。 */
  const handlePreview = (asset: LinguistAssetInfo): void => {
    const opened = openLinguistPreview({
      kind: 'batch',
      projectId,
      assetId: asset.assetId,
      filename: asset.filename,
      formatId: asset.formatId,
      segmentCount: asset.segmentCount,
      ...(summary !== null
        ? {
            sourceLocale: summary.project.sourceLocale,
            targetLocale: summary.project.targetLocale,
          }
        : {}),
      segmentCounts: asset.segmentCounts,
      currentStageCounts: asset.currentStageCounts,
      openQaCount: asset.openQaCount,
    })
    if (!opened) toast('项目会话尚未就绪，请稍后重试')
  }

  return (
    <section
      aria-label="批次（文件）"
      aria-busy={importBusy || exportBusy}
      className="flex flex-col gap-3"
    >
      {/* 区标题 + 导入入口 */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] font-medium text-foreground/55 px-1">
          批次（文件）{summary !== null && <span className="text-foreground/40">（{summary.assetCount}）</span>}
        </div>
        <div className="flex items-center gap-2">
          {archived && (
            <span className="text-[12px] text-foreground/40">已归档项目为只读，无法导入</span>
          )}
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={archived || importBusy || exportBusy || undoBusy || xlsxMapping !== null}
            title={archived ? '已归档项目为只读，无法导入' : xlsxMapping !== null ? '请先确认或取消当前 XLSX 映射' : '导入 XLIFF / CSV / TSV / JSON 批次文件'}
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

      {xlsxMapping !== null && (
        <XlsxMappingConfirmPanel
          mapping={xlsxMapping}
          disabled={archived || importBusy}
          onChangeSheet={(sheetName) => {
            setXlsxMapping((current) => current === null
              ? null
              : { ...current, sheetName, columns: { source: '', target: '' } })
          }}
          onChangeColumn={(role, value) => {
            setXlsxMapping((current) => {
              if (current === null) return null
              if (role === 'source' || role === 'target') {
                return { ...current, columns: { ...current.columns, [role]: value } }
              }
              return { ...current, columns: { ...current.columns, [role]: value || undefined } }
            })
          }}
          onConfirm={() => void handleConfirmXlsxMapping()}
          onCancel={() => {
            setXlsxMapping(null)
            setImportState({ status: 'idle' })
          }}
        />
      )}

      {/* 批次列表（真源 = getSummary 当次结果） */}
      {summary === null ? (
        <div className="rounded-xl border border-border/50 bg-content-area px-4 py-3 text-[13px] text-foreground/45">
          批次列表暂不可用（摘要拉取失败）；仍可尝试导入，成功后计数将随摘要恢复刷新。
        </div>
      ) : summary.assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 flex flex-col items-center text-center gap-1.5">
          <FileText size={18} className="text-foreground/30" />
          <p className="text-[13px] text-foreground/50">还没有批次</p>
          <p className="text-[12px] text-foreground/40">
            点击「导入文件」选择 XLIFF / CSV / TSV / JSON 文件，同一项目可累积多个批次。
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
              onPreview={() => handlePreview(asset)}
              undoDisabled={importBusy || exportBusy || undoBusy}
              undoing={undoState.status === 'busy' && undoState.assetId === asset.assetId}
              onUndoImport={() => void handleUndoImport(asset)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

type XlsxMappingColumnRole = keyof PendingXlsxMapping['columns']

/** XLSX 只在主进程扫描；这里仅显示证据并提交用户明确选择的名称。 */
function XlsxMappingConfirmPanel({
  mapping,
  disabled,
  onChangeSheet,
  onChangeColumn,
  onConfirm,
  onCancel,
}: {
  mapping: PendingXlsxMapping
  disabled: boolean
  onChangeSheet: (sheetName: string) => void
  onChangeColumn: (role: XlsxMappingColumnRole, value: string) => void
  onConfirm: () => void
  onCancel: () => void
}): React.ReactElement {
  const sheet = mapping.preview.sheets.find((item) => item.name === mapping.sheetName)
  const columns = sheet?.columns.filter((column) => column.selectable) ?? []
  const requiredMissing = mapping.columns.source === '' || mapping.columns.target === ''
  const distortion = sheet === undefined
    ? []
    : [
        sheet.distortion.formulaCells > 0 ? `公式 ${sheet.distortion.formulaCells}` : null,
        sheet.distortion.errorCells > 0 ? `错误单元格 ${sheet.distortion.errorCells}` : null,
        sheet.distortion.mergedRanges > 0 ? `合并区域 ${sheet.distortion.mergedRanges}` : null,
      ].filter((item): item is string => item !== null)
  const select = (role: XlsxMappingColumnRole, label: string, required = false) => (
    <label className="flex min-w-0 flex-col gap-1 text-[12px] text-foreground/55">
      <span>{label}{required ? '（必填）' : '（可选）'}</span>
      <select
        aria-label={label}
        value={mapping.columns[role] ?? ''}
        disabled={disabled || sheet === undefined}
        onChange={(event) => onChangeColumn(role, event.target.value)}
        className="h-8 min-w-0 rounded-md border border-border/60 bg-background px-2 pr-7 text-[12px] text-foreground outline-none focus:border-primary/60 disabled:opacity-45"
      >
        <option value="">未映射</option>
        {columns.map((column) => (
          <option key={`${column.index}-${column.header}`} value={column.header}>
            第 {column.index + 1} 列 · {column.header}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <section aria-label="XLSX 映射确认" className="rounded-xl border border-primary/25 bg-primary/[0.035] px-4 py-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground/85">确认 XLSX 批次映射</p>
          <p className="text-[12px] text-foreground/55 truncate">{mapping.filename} · 映射只会在你确认后写入项目</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="flex-shrink-0 rounded-md px-2 py-1 text-[12px] text-foreground/55 hover:bg-foreground/[0.07] disabled:opacity-45"
        >
          取消
        </button>
      </div>

      <label className="flex max-w-sm flex-col gap-1 text-[12px] text-foreground/55">
        <span>工作表（必选）</span>
        <select
          aria-label="XLSX 工作表"
          value={mapping.sheetName}
          disabled={disabled}
          onChange={(event) => onChangeSheet(event.target.value)}
          className="h-8 rounded-md border border-border/60 bg-background px-2 pr-7 text-[12px] text-foreground outline-none focus:border-primary/60 disabled:opacity-45"
        >
          {mapping.preview.sheets.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}{item.state === 'visible' ? '' : `（${item.state}）`}
            </option>
          ))}
        </select>
      </label>

      {sheet === undefined ? (
        <p className="text-[12px] text-destructive">该工作表不再可用，请取消后重新选择文件。</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {select('source', '源文列', true)}
            {select('target', '译文列', true)}
            {select('key', '唯一键列')}
            {select('context', '备注列')}
            {select('locked', '锁定列')}
          </div>
          <details className="rounded-lg border border-border/45 bg-background/50 px-3 py-2 text-[12px] text-foreground/55">
            <summary className="cursor-pointer select-none">解析证据：表头行 {sheet.headerRowNumbers.join('、') || '未识别'} · 样本 {sheet.coverage.shownSampleRows}/{sheet.coverage.dataRows}</summary>
            <div className="mt-2 flex flex-col gap-1.5">
              <p>物理行 {sheet.coverage.physicalRows} · 非空数据 {sheet.coverage.nonEmptyDataRows} · 空行 {sheet.coverage.emptyDataRows}{sheet.coverage.truncated ? ' · 样本已截断' : ''}</p>
              {distortion.length > 0 && <p>注意：{distortion.join('、')}</p>}
              {sheet.sampleRows.map((row) => (
                <p key={row.rowNo} className="break-words">第 {row.rowNo} 行：{row.cells.map((cell) => {
                  const header = sheet.columns.find((column) => column.index === cell.columnIndex)?.header || `列 ${cell.columnIndex + 1}`
                  return `${header}=${cell.value}${cell.truncated ? '…' : ''}`
                }).join(' · ')}</p>
              ))}
            </div>
          </details>
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-foreground/45">主进程会再次校验文件哈希、工作表和列名。</span>
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled || sheet === undefined || requiredMissing}
          className="flex-shrink-0 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-45"
        >
          确认并导入
        </button>
      </div>
    </section>
  )
}

/** 单个批次行：文件名 / formatId / 段数 / 截断摘要（可复制）/ 导入时间与警告（仅刚导入行） */
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
  undoDisabled,
  undoing,
  onUndoImport,
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
  /** LA-INTAKE-007：其他导入/导出/撤销进行中时禁用 */
  undoDisabled: boolean
  undoing: boolean
  onUndoImport: () => void
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
          title="预览批次概览"
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
        {/* LA-INTAKE-007 撤销导入：归档只读禁用；被拒时 toast 展示分类计数 */}
        <button
          type="button"
          aria-label={`撤销导入 ${asset.filename}`}
          title={archived ? '已归档项目为只读，无法撤销导入' : '撤销此批次的导入（已有下游工作时会被拒绝）'}
          onClick={onUndoImport}
          disabled={archived || undoDisabled}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium text-foreground/65 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100 disabled:pointer-events-none disabled:opacity-45"
        >
          {undoing ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
          <span>{undoing ? '撤销中…' : '撤销导入'}</span>
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
      {/* LA-INTAKE-007 导入验证报告（仅刚导入行；逐项 ✓/✗，detail 悬停可见） */}
      {lastImport !== null && (
        <div
          aria-label="导入验证"
          className="flex items-center gap-3 flex-wrap text-[12px]"
        >
          <span className={lastImport.verification.ok ? 'text-success' : 'text-destructive'}>
            {lastImport.verification.ok ? '验证通过' : '验证未通过'}
          </span>
          {lastImport.verification.checks.map((check) => (
            <span
              key={check.id}
              title={check.detail}
              className={`inline-flex items-center gap-1 ${
                check.passed ? 'text-foreground/50' : 'text-destructive'
              }`}
            >
              {check.passed ? (
                <Check size={11} className="text-success" />
              ) : (
                <X size={11} className="text-destructive" />
              )}
              {VERIFICATION_CHECK_LABELS[check.id]}
            </span>
          ))}
        </div>
      )}
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
