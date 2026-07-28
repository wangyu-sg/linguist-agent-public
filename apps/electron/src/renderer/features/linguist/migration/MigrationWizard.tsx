/**
 * MigrationWizard — legacy data migration wizard (PB-094; plan §22).
 *
 * Six-step full-page flow (rendered temporarily in place of the ProjectsView
 * management home):
 *   扫描 Scan   — native directory picker in main + read-only scan (§7.4:
 *                 the renderer never submits a path; cancel is a no-op).
 *   预览 Preview — scan projection: root/totals/health + per-project cards.
 *   选择 Select — project multi-select + external-source / salvage options.
 *   导入 Import — batch import with per-project progress events.
 *   验证 Verify — same running phase; the stepper follows the event phase.
 *   报告 Report — aggregated report (disposition count cards + per-project
 *                 expandable rows incl. verify checks + rollback text);
 *                 memory-rendered only, never persisted.
 *
 * Degraded sqlite: the service refuses with STORE_SQLITE_UNAVAILABLE, which
 * switches the whole wizard into a blocking "unavailable" notice (the entry
 * is effectively disabled). Data discipline: atoms hold nothing here — all
 * state is local to the wizard; the project list is re-fetched by the
 * caller on exit (dirty = an import ran).
 */

import * as React from 'react'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderSearch,
  HardDriveDownload,
  Loader2,
  X,
  XCircle,
} from 'lucide-react'
import type {
  LinguistMigrationProgress,
  LinguistMigrationProjectReport,
  LinguistMigrationReport,
  LinguistMigrationScanResult,
  LinguistMigrationScannedProject,
} from '@proma/shared'
import { cn } from '@/lib/utils'
import { describeLinguistIpcError } from '../projects/project-utils'
import {
  defaultSelectedProjectIds,
  groupProjectReports,
  MIGRATION_DISPOSITION_LABELS,
  MIGRATION_DISPOSITION_ORDER,
  MIGRATION_DISPOSITION_TONES,
  MIGRATION_WIZARD_STEP_LABELS,
  migrationProgressPercent,
  wizardActiveStepIndex,
  type MigrationDispositionTone,
  type MigrationRunningPhase,
  type MigrationWizardPhase,
} from './migration-wizard-utils'

interface MigrationWizardProps {
  /** Close the wizard; dirty = an import ran (caller re-fetches the project list). */
  onExit: (dirty: boolean) => void
}

type ScanData = LinguistMigrationScanResult & { rootPath: string }

const TONE_ICON: Record<MigrationDispositionTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  muted: Archive,
  error: XCircle,
}

const TONE_CLASSES: Record<MigrationDispositionTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  muted: 'text-foreground/45',
  error: 'text-destructive',
}

export function MigrationWizard({ onExit }: MigrationWizardProps): React.ReactElement {
  const [phase, setPhase] = React.useState<MigrationWizardPhase>('scan')
  const [scan, setScan] = React.useState<ScanData | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  /** Degraded-mode blocking notice (STORE_SQLITE_UNAVAILABLE); entry disabled. */
  const [unavailable, setUnavailable] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [externalSource, setExternalSource] = React.useState<'copy' | 'reference'>('copy')
  const [salvageOrphan, setSalvageOrphan] = React.useState(false)
  const [progress, setProgress] = React.useState<LinguistMigrationProgress | null>(null)
  const [report, setReport] = React.useState<LinguistMigrationReport | null>(null)
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set())

  const runningPhase: MigrationRunningPhase = progress?.phase ?? 'import'
  const activeStep = wizardActiveStepIndex(phase, runningPhase)
  const dirty = report !== null

  const handlePickAndScan = async (): Promise<void> => {
    if (scanning) return
    setScanning(true)
    setError(null)
    try {
      const result = await window.electronAPI.linguistMigrationPickAndScan()
      if (!result.ok) {
        const description = describeLinguistIpcError(result.error)
        if (result.error.code === 'STORE_SQLITE_UNAVAILABLE') {
          setUnavailable(description)
        } else {
          setError(description)
        }
        return
      }
      if (result.data.cancelled) return
      const { rootPath, ...projection } = result.data
      setScan({ ...projection, rootPath })
      setSelected(new Set(defaultSelectedProjectIds(projection.projects)))
      setPhase('preview')
    } catch {
      setError('与主进程通信异常（INTERNAL）')
    } finally {
      setScanning(false)
    }
  }

  // Running phase: subscribe progress, then run the batch import once. The
  // selection/options are captured when the phase is entered (no way back
  // while running), so the effect intentionally depends on `phase` only.
  React.useEffect(() => {
    if (phase !== 'running') return
    let cancelled = false
    const unsubscribe = window.electronAPI.onLinguistMigrationProgress((event) => {
      if (!cancelled) setProgress(event)
    })
    void (async () => {
      try {
        const result = await window.electronAPI.linguistMigrationImport({
          projectIds: [...selected],
          options: { externalSource, salvageOrphan },
        })
        if (cancelled) return
        if (result.ok) {
          setReport(result.data)
          setPhase('report')
        } else {
          setError(describeLinguistIpcError(result.error))
          setPhase('select')
        }
      } catch {
        if (!cancelled) {
          setError('与主进程通信异常（INTERNAL）')
          setPhase('select')
        }
      }
    })()
    return () => {
      cancelled = true
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const toggleSelected = (projectId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const toggleExpanded = (legacyProjectId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(legacyProjectId)) next.delete(legacyProjectId)
      else next.add(legacyProjectId)
      return next
    })
  }

  // ===== degraded blocking state =====
  if (unavailable !== null) {
    return (
      <WizardShell activeStep={activeStep} onExit={() => onExit(dirty)} exitDisabled={false}>
        <div className="h-full flex flex-col items-center justify-center gap-3 px-8 pb-16 text-center">
          <div className="size-14 flex items-center justify-center rounded-2xl bg-destructive/[0.08] text-destructive">
            <AlertTriangle size={26} />
          </div>
          <p className="text-[15px] font-medium text-foreground/70">迁移功能不可用</p>
          <p className="max-w-md text-[13px] leading-relaxed text-foreground/45">{unavailable}</p>
          <button
            type="button"
            onClick={() => onExit(dirty)}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-foreground/70 hover:bg-foreground/[0.07] transition-colors duration-100"
          >
            返回项目列表
          </button>
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell activeStep={activeStep} onExit={() => onExit(dirty)} exitDisabled={phase === 'running'}>
      {phase === 'scan' && (
        <ScanStep scanning={scanning} error={error} onPick={() => void handlePickAndScan()} />
      )}
      {phase === 'preview' && scan !== null && (
        <PreviewStep scan={scan} onBack={() => setPhase('scan')} onNext={() => setPhase('select')} />
      )}
      {phase === 'select' && scan !== null && (
        <SelectStep
          scan={scan}
          selected={selected}
          externalSource={externalSource}
          salvageOrphan={salvageOrphan}
          error={error}
          onToggle={toggleSelected}
          onExternalSource={setExternalSource}
          onSalvageOrphan={setSalvageOrphan}
          onBack={() => setPhase('preview')}
          onRun={() => {
            setError(null)
            setProgress(null)
            setPhase('running')
          }}
        />
      )}
      {phase === 'running' && <RunningStep progress={progress} />}
      {phase === 'report' && report !== null && (
        <ReportStep report={report} expanded={expanded} onToggleExpanded={toggleExpanded} onDone={() => onExit(true)} />
      )}
    </WizardShell>
  )
}

// ---------------------------------------------------------------------------
// shell (titlebar + stepper)

function WizardShell({
  activeStep,
  exitDisabled,
  onExit,
  children,
}: {
  activeStep: number
  exitDisabled: boolean
  onExit: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="titlebar-drag-region flex items-center justify-between max-w-5xl w-full mx-auto px-8 pt-8 pb-6 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold text-foreground">迁移向导</h1>
          <ol className="flex items-center gap-1.5" aria-label="迁移步骤">
            {MIGRATION_WIZARD_STEP_LABELS.map((label, index) => (
              <li
                key={label}
                aria-current={index === activeStep ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px]',
                  index === activeStep
                    ? 'bg-primary/10 text-primary font-medium'
                    : index < activeStep
                      ? 'text-foreground/45'
                      : 'text-foreground/30',
                )}
              >
                {index < activeStep ? <CheckCircle2 size={12} /> : null}
                {label}
              </li>
            ))}
          </ol>
        </div>
        <button
          type="button"
          aria-label="退出迁移向导"
          disabled={exitDisabled}
          onClick={onExit}
          title={exitDisabled ? '迁移进行中，完成后方可退出' : '退出迁移向导'}
          className="titlebar-no-drag flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// step 1: scan

function ScanStep({
  scanning,
  error,
  onPick,
}: {
  scanning: boolean
  error: string | null
  onPick: () => void
}): React.ReactElement {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-8 pb-16 text-center">
      <div className="size-14 flex items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/35">
        <HardDriveDownload size={26} />
      </div>
      <p className="text-[15px] font-medium text-foreground/70">从旧版 Linguist Agent 迁移</p>
      <p className="max-w-lg text-[13px] leading-relaxed text-foreground/45">
        选择旧版数据根目录（包含 data/ 子目录的副本）后，向导将只读扫描其中的项目、
        翻译记忆、术语库与聊天记录；确认后迁移到当前项目列表。扫描不会修改旧目录，
        旧聊天历史将以只读归档转录保留。
      </p>
      {error !== null && (
        <div
          role="alert"
          className="max-w-lg rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-2.5 text-[12px] text-destructive"
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={onPick}
        disabled={scanning}
        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm disabled:opacity-60"
      >
        {scanning ? <Loader2 size={14} className="animate-spin" /> : <FolderSearch size={14} />}
        <span>{scanning ? '扫描中…' : '选择旧版数据根目录'}</span>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// step 2: preview

function PreviewStep({
  scan,
  onBack,
  onNext,
}: {
  scan: ScanData
  onBack: () => void
  onNext: () => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 max-w-5xl w-full mx-auto px-8 pb-8">
      <div className="rounded-xl border border-border/50 bg-content-area px-4 py-3 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[13px] font-medium text-foreground/85">
          已选择旧版数据根
          <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-foreground/55">
            schema v{scan.schemaVersion}
          </span>
        </div>
        <div className="text-[12px] font-mono text-foreground/45 break-all">{scan.rootPath}</div>
        <div className="text-[12px] text-foreground/55">
          共 {scan.totals.projects} 个项目 · {scan.totals.batches} 个批次 · {scan.totals.segments} 段
        </div>
        {scan.health.length > 0 && (
          <ul className="mt-1 flex flex-col gap-1">
            {scan.health.map((signal, index) => (
              <li key={index} className="flex items-start gap-1.5 text-[12px] text-foreground/55">
                <AlertTriangle
                  size={12}
                  className={cn('mt-0.5 flex-shrink-0', signal.severity === 'error' ? 'text-destructive' : 'text-warning')}
                />
                <span>{signal.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {scan.projects.length === 0 ? (
        <p className="text-[13px] text-foreground/45 px-1">该数据根中没有可迁移的项目。</p>
      ) : (
        <div className="flex flex-col gap-2">
          {scan.projects.map((project) => (
            <ScannedProjectCard key={project.projectId} project={project} />
          ))}
        </div>
      )}

      <StepFooter
        back={{ label: '上一步', onClick: onBack }}
        next={{ label: '下一步', onClick: onNext, disabled: scan.projects.length === 0 }}
      />
    </div>
  )
}

function ScannedProjectCard({ project }: { project: LinguistMigrationScannedProject }): React.ReactElement {
  const warnings = project.health.filter((signal) => signal.severity !== 'info')
  return (
    <div className="rounded-xl border border-border/50 bg-content-area px-4 py-3 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-foreground/85">{project.name}</span>
        <span className="text-[11px] font-mono text-foreground/40">{project.projectId}</span>
        {project.orphan && (
          <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
            无清单（默认隔离）
          </span>
        )}
        {project.chatPresent && (
          <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-foreground/55">含聊天记录</span>
        )}
      </div>
      <div className="text-[12px] text-foreground/55">
        {project.sourceLocale ?? '?'} → {project.targetLocale ?? '?'} · 批次 {project.batches} · 段 {project.segments}
        {project.tmEntries !== null && ` · TM ${project.tmEntries}`}
        {project.termEntries !== null && ` · 术语 ${project.termEntries}`}
      </div>
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {warnings.map((signal, index) => (
            <li key={index} className="flex items-start gap-1.5 text-[12px] text-foreground/45">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-warning" />
              <span>{signal.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// step 3: select

function SelectStep({
  scan,
  selected,
  externalSource,
  salvageOrphan,
  error,
  onToggle,
  onExternalSource,
  onSalvageOrphan,
  onBack,
  onRun,
}: {
  scan: ScanData
  selected: ReadonlySet<string>
  externalSource: 'copy' | 'reference'
  salvageOrphan: boolean
  error: string | null
  onToggle: (projectId: string) => void
  onExternalSource: (value: 'copy' | 'reference') => void
  onSalvageOrphan: (value: boolean) => void
  onBack: () => void
  onRun: () => void
}): React.ReactElement {
  const hasOrphan = scan.projects.some((project) => project.orphan)
  return (
    <div className="flex flex-col gap-4 max-w-5xl w-full mx-auto px-8 pb-8">
      <div className="flex flex-col gap-2">
        <div className="text-[13px] font-medium text-foreground/55 px-1">
          选择要迁移的项目（{selected.size}/{scan.projects.length}）
        </div>
        {scan.projects.map((project) => (
          <label
            key={project.projectId}
            className="rounded-xl border border-border/50 bg-content-area px-4 py-3 flex items-center gap-3 cursor-pointer hover:border-border transition-colors duration-100"
          >
            <input
              type="checkbox"
              checked={selected.has(project.projectId)}
              onChange={() => onToggle(project.projectId)}
              className="size-4 accent-[var(--primary)]"
            />
            <span className="flex-1 min-w-0 text-[13px] text-foreground/85 truncate">
              {project.name}
              <span className="ml-2 text-[11px] font-mono text-foreground/40">{project.projectId}</span>
            </span>
            {project.orphan && (
              <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
                {salvageOrphan ? '将抢救导入' : '将隔离（零写入）'}
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="rounded-xl border border-border/50 bg-content-area px-4 py-3 flex flex-col gap-2">
        <div className="text-[13px] font-medium text-foreground/85">迁移选项</div>
        <label className="flex items-start gap-2 text-[12px] text-foreground/70 cursor-pointer">
          <input
            type="radio"
            name="migration-external-source"
            checked={externalSource === 'copy'}
            onChange={() => onExternalSource('copy')}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            <span className="font-medium">复制外部源文（默认）</span>
            <span className="block text-foreground/45">源文件仍在原位置时读取其字节并随项目保存。</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[12px] text-foreground/70 cursor-pointer">
          <input
            type="radio"
            name="migration-external-source"
            checked={externalSource === 'reference'}
            onChange={() => onExternalSource('reference')}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            <span className="font-medium">仅引用，不读取外部字节</span>
            <span className="block text-foreground/45">外部源文回退为受管副本；仍不可用时标记为丢失。</span>
          </span>
        </label>
        {hasOrphan && (
          <label className="flex items-start gap-2 text-[12px] text-foreground/70 cursor-pointer pt-1 border-t border-border/40">
            <input
              type="checkbox"
              checked={salvageOrphan}
              onChange={(event) => onSalvageOrphan(event.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              <span className="font-medium">抢救无清单的孤儿项目</span>
              <span className="block text-foreground/45">
                从批次载荷推断语言对并以目录名导入；不勾选时仅出具隔离报告（零写入）。
              </span>
            </span>
          </label>
        )}
      </div>

      {error !== null && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-2.5 text-[12px] text-destructive"
        >
          {error}
        </div>
      )}

      <StepFooter
        back={{ label: '上一步', onClick: onBack }}
        next={{ label: `开始迁移（${selected.size}）`, onClick: onRun, disabled: selected.size === 0 }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// steps 4-5: running (import + verify phases)

function RunningStep({ progress }: { progress: LinguistMigrationProgress | null }): React.ReactElement {
  const percent = migrationProgressPercent(progress)
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-8 pb-16">
      <Loader2 size={26} className="animate-spin text-foreground/35" />
      <div className="w-full max-w-md flex flex-col gap-2">
        <div className="h-1.5 w-full rounded-full bg-foreground/[0.08] overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${String(percent)}%` }}
          />
        </div>
        <div className="text-center text-[13px] text-foreground/70">
          {progress === null
            ? '准备中…'
            : `${progress.phase === 'import' ? '导入中' : '验证中'}（${progress.index}/${progress.total}）：${progress.projectId}`}
        </div>
        <p className="text-center text-[12px] text-foreground/40">迁移期间请勿关闭窗口；单个超大项目可能耗时较长。</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// step 6: report

function ReportStep({
  report,
  expanded,
  onToggleExpanded,
  onDone,
}: {
  report: LinguistMigrationReport
  expanded: ReadonlySet<string>
  onToggleExpanded: (legacyProjectId: string) => void
  onDone: () => void
}): React.ReactElement {
  const groups = groupProjectReports(report.projects)
  const anyVerifyFailed = report.projects.some((project) => project.verify.status === 'failed')
  return (
    <div className="flex flex-col gap-6 max-w-5xl w-full mx-auto px-8 pb-8">
      {/* disposition count cards */}
      <div className="grid grid-cols-5 gap-2">
        {MIGRATION_DISPOSITION_ORDER.map((disposition) => {
          const tone = MIGRATION_DISPOSITION_TONES[disposition]
          const Icon = TONE_ICON[tone]
          return (
            <div
              key={disposition}
              className="rounded-xl border border-border/50 bg-content-area px-3 py-2.5 flex flex-col gap-1"
            >
              <span className={cn('flex items-center gap-1 text-[12px]', TONE_CLASSES[tone])}>
                <Icon size={12} />
                {MIGRATION_DISPOSITION_LABELS[disposition]}
              </span>
              <span className="text-xl font-semibold text-foreground/85">{report.counts[disposition]}</span>
            </div>
          )
        })}
      </div>

      {anyVerifyFailed && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-4 py-2.5 text-[12px] text-destructive"
        >
          有项目未通过迁移后验证，请展开对应项目查看检查项明细，必要时按回滚指引清理后重试。
        </div>
      )}

      {/* grouped per-project rows */}
      {groups.map((group) => {
        const tone = MIGRATION_DISPOSITION_TONES[group.disposition]
        const Icon = TONE_ICON[tone]
        return (
          <div key={group.disposition} className="flex flex-col gap-2">
            <div className="text-[13px] font-medium text-foreground/55 px-1">
              {MIGRATION_DISPOSITION_LABELS[group.disposition]}（{group.projects.length}）
            </div>
            <div className="flex flex-col gap-2">
              {group.projects.map((project) => (
                <ReportRow
                  key={project.legacyProjectId}
                  project={project}
                  icon={<Icon size={14} className={cn('flex-shrink-0', TONE_CLASSES[tone])} />}
                  expanded={expanded.has(project.legacyProjectId)}
                  onToggle={() => onToggleExpanded(project.legacyProjectId)}
                />
              ))}
            </div>
          </div>
        )
      })}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onDone}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm"
        >
          完成
        </button>
      </div>
    </div>
  )
}

function ReportRow({
  project,
  icon,
  expanded,
  onToggle,
}: {
  project: LinguistMigrationProjectReport
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border/50 bg-content-area">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full px-4 py-3 flex items-center gap-2.5 text-left"
      >
        {expanded ? (
          <ChevronDown size={14} className="flex-shrink-0 text-foreground/40" />
        ) : (
          <ChevronRight size={14} className="flex-shrink-0 text-foreground/40" />
        )}
        {icon}
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium text-foreground/85">
          {project.projectName}
          <span className="ml-2 text-[11px] font-mono text-foreground/40">{project.legacyProjectId}</span>
        </span>
        {project.targetConflict && (
          <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-foreground/55">
            已存在，本次未写入
          </span>
        )}
        <VerifyBadge status={project.verify.status} />
      </button>
      {expanded && <ReportRowDetail project={project} />}
    </div>
  )
}

function VerifyBadge({ status }: { status: LinguistMigrationProjectReport['verify']['status'] }): React.ReactElement {
  if (status === 'passed') {
    return <span className="rounded bg-success/10 px-1.5 py-0.5 text-[11px] text-success">验证通过</span>
  }
  if (status === 'failed') {
    return <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive">验证失败</span>
  }
  return <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-foreground/45">验证跳过</span>
}

const VERIFY_CHECK_LABELS: Record<string, string> = {
  'transcript-rerender': '转录重渲染比对',
  'transcript-bytes': '转录字节完整性',
  'store-reopen': '数据库只读重开',
  'store-assets': '资产 / 段计数',
  'store-references': 'TM / 术语计数',
  'store-qa': 'QA 计数',
}

function ReportRowDetail({ project }: { project: LinguistMigrationProjectReport }): React.ReactElement {
  return (
    <div className="px-4 pb-3 pt-1 border-t border-border/40 flex flex-col gap-2.5 text-[12px] text-foreground/60">
      <div>
        新项目 <span className="font-mono text-foreground/45">{project.newProjectId}</span> · 资产 {project.totals.assets} ·
        段 {project.totals.segments} · TM {project.totals.tmImported} · 术语 {project.totals.termsImported} · QA（开{' '}
        {project.totals.qaOpen} / 豁免 {project.totals.qaWaived}）· 归档件 {project.archivesWritten}
      </div>
      {project.refusal !== null && (
        <div className="flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0 text-warning" />
          <span>隔离原因：{project.refusal.reason}</span>
        </div>
      )}
      {project.transcript !== null && (
        <div className="flex flex-col gap-0.5">
          <div>
            只读聊天转录：<span className="font-mono text-foreground/45">{project.transcript.path}</span>
          </div>
          <div className="text-foreground/40">
            {project.transcript.sessions} 个会话 · {project.transcript.rows} 行 · sha256{' '}
            <span className="font-mono">{project.transcript.sha256.slice(0, 16)}…</span>
          </div>
        </div>
      )}
      {project.verify.checks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {project.verify.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-1.5">
              {check.ok ? (
                <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-success" />
              ) : (
                <XCircle size={12} className="mt-0.5 flex-shrink-0 text-destructive" />
              )}
              <span>
                <span className="font-medium">{VERIFY_CHECK_LABELS[check.id] ?? check.id}</span>
                <span className="text-foreground/40"> — {check.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {project.notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-foreground/45">
          {project.notes.map((note, index) => (
            <li key={index}>· {note}</li>
          ))}
        </ul>
      )}
      {project.rollback.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="font-medium text-foreground/55">回滚指引</div>
          {project.rollback.map((line, index) => (
            <div key={index} className="font-mono text-[11px] text-foreground/40 break-all">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// shared footer

function StepFooter({
  back,
  next,
}: {
  back: { label: string; onClick: () => void }
  next: { label: string; onClick: () => void; disabled?: boolean }
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        type="button"
        onClick={back.onClick}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium text-foreground/60 hover:bg-foreground/[0.07] hover:text-foreground transition-colors duration-100"
      >
        {back.label}
      </button>
      <button
        type="button"
        onClick={next.onClick}
        disabled={next.disabled ?? false}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm disabled:opacity-50"
      >
        {next.label}
      </button>
    </div>
  )
}
