/**
 * ProjectBackupsSection — 项目详情「备份」区（PB-111，计划 §24）
 *
 * 职责：
 * - 「新建备份」按钮（归档项目也可备份——备份是只读语义）→ 成功 toast
 *   （含 vacuum_into/backup_api 方法）；
 * - 备份列表（linguistBackupsList：名称/时间/大小/manifest 摘要，最新在前；
 *   只读操作，归档项目同样可列）；
 * - 每行「恢复…」→ 恢复预览对话框（linguistBackupsPreviewRestore：verify
 *   状态 + 备份/当前摘要对比 + schema 版本 + 迁移标注）→ 二次确认文案
 *   （当前状态将先快照到 pre-restore-<ts>）→ linguistBackupsRestore →
 *   成功 toast（含快照名）+ 通知父级刷新摘要；
 * - 归档项目：恢复按钮禁用（title 说明归档项目不可恢复）；旧格式
 *   （legacy）备份可打开预览但确认恢复禁用（restorable=false）。
 *
 * 信任边界（计划 §7.4）：全部经 IPC，renderer 只提交 projectId + backupName
 * （白名单形状），零路径上行；响应绝无绝对路径。
 */

import * as React from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  HardDriveDownload,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import type {
  LinguistBackupInfo,
  LinguistRestorePreviewResult,
} from '@proma/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { describeLinguistIpcError, formatProjectTime } from './project-utils'

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

interface ProjectBackupsSectionProps {
  projectId: string
  archived: boolean
  /** 恢复成功后调用（父级刷新摘要/计数）。 */
  onRestored: () => Promise<void> | void
}

export function ProjectBackupsSection({
  projectId,
  archived,
  onRestored,
}: ProjectBackupsSectionProps): React.ReactElement {
  const [backups, setBackups] = React.useState<LinguistBackupInfo[] | null>(null)
  const [listError, setListError] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [restoreTarget, setRestoreTarget] = React.useState<LinguistBackupInfo | null>(null)

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.linguistBackupsList({ projectId })
      if (!result.ok) {
        setListError(describeLinguistIpcError(result.error))
        return
      }
      setListError(null)
      setBackups(result.data)
    } catch {
      setListError('与主进程通信异常（INTERNAL）')
    }
  }, [projectId])

  React.useEffect(() => {
    setBackups(null)
    setListError(null)
    void refresh()
  }, [refresh])

  const handleBackup = React.useCallback(async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      const result = await window.electronAPI.linguistProjectsBackup({ projectId })
      if (!result.ok) {
        toast.error('备份失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      toast.success(`已创建备份 ${result.data.backupName}`, {
        description: `${result.data.method === 'vacuum_into' ? 'VACUUM INTO' : 'Backup API'} · ${result.data.fileCount} 个文件 · ${formatSize(result.data.totalSizeBytes)}`,
      })
      void refresh()
    } catch {
      toast.error('备份失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setCreating(false)
    }
  }, [creating, projectId, refresh])

  return (
    <section aria-label="备份与恢复" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/70">
          <HardDriveDownload size={13} className="text-foreground/45" />
          备份{backups !== null && backups.length > 0 ? `（${backups.length}）` : ''}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="刷新备份列表"
          title="刷新备份列表"
          onClick={() => void refresh()}
          className="flex items-center justify-center size-6 rounded-md text-foreground/45 hover:bg-foreground/[0.06] hover:text-foreground transition-colors duration-100"
        >
          <RefreshCw size={12} />
        </button>
        <button
          type="button"
          onClick={() => void handleBackup()}
          disabled={creating}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-100 shadow-sm',
            creating && 'cursor-not-allowed opacity-60',
          )}
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <HardDriveDownload size={12} />}
          新建备份
        </button>
      </div>

      {listError !== null ? (
        <p role="alert" className="flex items-center gap-1.5 text-[12px] text-destructive">
          <AlertTriangle size={12} />
          {listError}
        </p>
      ) : backups === null ? (
        <div className="flex items-center gap-1.5 text-[12px] text-foreground/45 py-1">
          <Loader2 size={12} className="animate-spin" />
          正在加载备份列表…
        </div>
      ) : backups.length === 0 ? (
        <p className="text-[12px] text-foreground/45 py-1">
          尚无备份。备份包含翻译数据库、项目元数据与全部源文件，可用于整体恢复。
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {backups.map((backup) => (
            <li
              key={backup.name}
              className="flex items-center gap-2 rounded-lg border border-border/50 bg-content-area px-3 py-2"
            >
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/80 truncate">
                  {backup.createdAt !== undefined ? formatProjectTime(backup.createdAt) : backup.name}
                  {backup.format === 'legacy' && (
                    <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-1.5 py-px text-[10px] text-warning">
                      旧格式
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-foreground/45 truncate">
                  {backup.name}
                  {' · '}
                  {formatSize(backup.sizeBytes)}
                  {backup.fileCount !== undefined && ` · ${backup.fileCount} 个文件`}
                  {backup.schemaVersion !== undefined && ` · schema v${backup.schemaVersion}`}
                </span>
              </div>
              <button
                type="button"
                disabled={archived}
                title={archived ? '已归档项目不可恢复（归档为只读语义）' : '预览并从此备份恢复'}
                onClick={() => setRestoreTarget(backup)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground transition-colors duration-100 flex-shrink-0',
                  archived && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-foreground/70',
                )}
              >
                <ArchiveRestore size={12} />
                恢复…
              </button>
            </li>
          ))}
        </ul>
      )}

      {restoreTarget !== null && (
        <RestorePreviewDialog
          projectId={projectId}
          backup={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onRestored={async () => {
            setRestoreTarget(null)
            await onRestored()
            void refresh()
          }}
        />
      )}
    </section>
  )
}

/** 恢复预览对话框：previewRestore 数据展示 + 二次确认 + 执行恢复。 */
function RestorePreviewDialog({
  projectId,
  backup,
  onClose,
  onRestored,
}: {
  projectId: string
  backup: LinguistBackupInfo
  onClose: () => void
  onRestored: () => Promise<void>
}): React.ReactElement {
  const [preview, setPreview] = React.useState<LinguistRestorePreviewResult | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [restoring, setRestoring] = React.useState(false)
  const [restoreError, setRestoreError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await window.electronAPI.linguistBackupsPreviewRestore({
          projectId,
          backupName: backup.name,
        })
        if (cancelled) return
        if (!result.ok) {
          setPreviewError(describeLinguistIpcError(result.error))
          return
        }
        setPreview(result.data)
      } catch {
        if (!cancelled) setPreviewError('与主进程通信异常（INTERNAL）')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, backup.name])

  const handleRestore = React.useCallback(async (): Promise<void> => {
    if (restoring) return
    setRestoring(true)
    setRestoreError(null)
    try {
      const result = await window.electronAPI.linguistBackupsRestore({
        projectId,
        backupName: backup.name,
      })
      if (!result.ok) {
        setRestoreError(describeLinguistIpcError(result.error))
        setRestoring(false)
        return
      }
      toast.success(`已从 ${result.data.backupName} 恢复`, {
        description: `恢复前状态已快照为 ${result.data.preRestoreName}（schema v${result.data.schemaVersion}）`,
      })
      await onRestored()
    } catch {
      setRestoreError('与主进程通信异常（INTERNAL）')
      setRestoring(false)
    }
  }, [restoring, projectId, backup.name, onRestored])

  const restorable = preview?.restorable === true
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !restoring) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>从备份恢复</DialogTitle>
          <DialogDescription>
            {backup.name}
            {backup.createdAt !== undefined && `（${formatProjectTime(backup.createdAt)}）`}
          </DialogDescription>
        </DialogHeader>

        {previewError !== null ? (
          <p role="alert" className="flex items-center gap-1.5 text-[12px] text-destructive">
            <AlertTriangle size={12} />
            {previewError}
          </p>
        ) : preview === null ? (
          <div className="flex items-center gap-1.5 text-[12px] text-foreground/45 py-2">
            <Loader2 size={12} className="animate-spin" />
            正在校验备份并生成预览…
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-[12px]">
            {/* verify 状态 */}
            {preview.verification !== undefined && (
              <div
                className={cn(
                  'flex items-start gap-1.5 rounded-lg border px-3 py-2',
                  preview.verification.ok
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-destructive/40 bg-destructive/10 text-destructive',
                )}
              >
                {preview.verification.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                <div className="flex flex-col gap-0.5">
                  <span>{preview.verification.ok ? '完整性校验通过（manifest 全文件 sha256 + 数据库检查）' : '完整性校验未通过'}</span>
                  {!preview.verification.ok && (
                    <ul className="text-[11px] opacity-80 flex flex-col gap-px">
                      {preview.verification.problems.slice(0, 5).map((problem) => (
                        <li key={problem} className="font-mono">{problem}</li>
                      ))}
                      {preview.verification.problems.length > 5 && (
                        <li>…共 {preview.verification.problems.length} 项问题</li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* schema 版本 + 迁移标注 */}
            <p className="text-foreground/60">
              备份 schema：{preview.backupSchemaVersion !== undefined ? `v${preview.backupSchemaVersion}` : '未知'}
              {' · '}当前应用：v{preview.currentSchemaVersion}
              {preview.willMigrate && '（旧版备份，恢复后首次打开将自动迁移）'}
            </p>

            {/* 摘要对比 */}
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/50 bg-content-area px-3 py-2">
              <span className="text-foreground/45" />
              <span className="text-foreground/45 text-right">备份</span>
              <span className="text-foreground/45 text-right">当前</span>
              <SummaryRow label="资产" backup={preview.backupSummary?.assetCount} current={preview.currentSummary?.assetCount} />
              <SummaryRow label="总段数" backup={preview.backupSummary?.totalSegments} current={preview.currentSummary?.totalSegments} />
              <SummaryRow label="未翻译" backup={preview.backupSummary?.segmentCounts.untranslated} current={preview.currentSummary?.segmentCounts.untranslated} />
              <SummaryRow label="草稿" backup={preview.backupSummary?.segmentCounts.draft} current={preview.currentSummary?.segmentCounts.draft} />
              <SummaryRow label="兼容状态 translated" backup={preview.backupSummary?.segmentCounts.translated} current={preview.currentSummary?.segmentCounts.translated} />
              <SummaryRow label="兼容状态 reviewed" backup={preview.backupSummary?.segmentCounts.reviewed} current={preview.currentSummary?.segmentCounts.reviewed} />
            </div>

            {preview.notice !== undefined && (
              <p className="flex items-start gap-1.5 text-warning">
                <AlertTriangle size={12} className="mt-px flex-shrink-0" />
                {preview.notice}
              </p>
            )}

            {restorable && (
              <p className="text-foreground/55 leading-relaxed">
                确认恢复将用该备份整体替换当前项目（数据库、元数据与源文件）。
                替换前当前状态会先快照为 pre-restore 备份，可随时手动找回。
              </p>
            )}

            {restoreError !== null && (
              <p role="alert" className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle size={12} />
                {restoreError}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={restoring}
            className="px-3 py-1.5 rounded-md text-[13px] font-medium text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground transition-colors duration-100"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleRestore()}
            disabled={!restorable || restoring}
            title={restorable ? '确认从此备份恢复' : '该备份不可恢复（旧格式或未通过校验）'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors duration-100 shadow-sm',
              (!restorable || restoring) && 'cursor-not-allowed opacity-50',
            )}
          >
            {restoring && <Loader2 size={12} className="animate-spin" />}
            确认恢复
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SummaryRow({
  label,
  backup,
  current,
}: {
  label: string
  backup: number | undefined
  current: number | undefined
}): React.ReactElement {
  return (
    <>
      <span className="text-foreground/60">{label}</span>
      <span className="text-right tabular-nums text-foreground/80">{backup ?? '—'}</span>
      <span className="text-right tabular-nums text-foreground/80">{current ?? '—'}</span>
    </>
  )
}
