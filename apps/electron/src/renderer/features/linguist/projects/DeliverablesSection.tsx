/**
 * DeliverablesSection — Agent 侧面板「交付物」区（PB-102）
 *
 * 职责：当当前 Agent 会话绑定了 linguist 项目时，在「会话文件」Tab 内
 * 列出该项目 exports/ 目录的交付物（PB-072 staging 产物），让交付物在
 * Agent 工作流中可发现。
 *
 * 信任边界（计划 §7.4）：renderer 只提交 projectId/assetId；列表由主进程
 * 读目录返回（basename/大小/时间，绝无路径）；点击行回走 PB-073 既有
 * native Save 链路（linguistExportsSaveAsset：主进程重新 staging + 校验 +
 * 原生 Save 对话框），本会话内不产生新的路径通道。
 *
 * 数据纪律（计划 §9.5）：列表永远来自 linguist.exports.list 当次拉取；
 * 无绑定项目时整区不渲染（返回 null）。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { AlertTriangle, Download, Loader2, Package, RefreshCw } from 'lucide-react'
import type { LinguistExportFileInfo } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { FileTypeIcon } from '@/components/file-browser'
import { cn } from '@/lib/utils'
import { useLinguistSessionBinding } from '../session-binding/useLinguistSessionBinding'
import { describeLinguistIpcError } from './project-utils'

/** staging 文件名 `<assetId>-<sha256:16>-<原文件名>` → 展示用原文件名。 */
function displayNameOf(file: LinguistExportFileInfo): string {
  if (file.assetId === undefined) return file.filename
  const prefix = `${file.assetId}-`
  if (!file.filename.startsWith(prefix)) return file.filename
  const rest = file.filename.slice(prefix.length)
  // 去掉 `<sha256:16>-` 段，余下即原文件名
  const dash = rest.indexOf('-')
  return dash > 0 ? rest.slice(dash + 1) : rest
}

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DeliverablesSection({ sessionId }: { sessionId: string }): React.ReactElement | null {
  const sessions = useAtomValue(agentSessionsAtom)
  const session = sessions.find((s) => s.id === sessionId)
  const binding = useLinguistSessionBinding(session)

  const [files, setFiles] = React.useState<LinguistExportFileInfo[] | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [savingAssetId, setSavingAssetId] = React.useState<string | null>(null)
  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const projectId = binding?.projectId ?? null
  const projectArchived = binding?.status === 'archived'

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!projectId) return
    try {
      const result = await window.electronAPI.linguistExportsList({ projectId })
      if (!aliveRef.current) return
      if (!result.ok) {
        setErrorMessage(describeLinguistIpcError(result.error))
        return
      }
      setErrorMessage(null)
      setFiles(result.data)
    } catch {
      if (aliveRef.current) setErrorMessage('与主进程通信异常（INTERNAL）')
    }
  }, [projectId])

  React.useEffect(() => {
    setFiles(null)
    setErrorMessage(null)
    void refresh()
  }, [refresh])

  // 点击交付物 → PB-073 native Save 链路（主进程 staging + 原生 Save 对话框）
  const handleSave = React.useCallback(async (file: LinguistExportFileInfo): Promise<void> => {
    if (!projectId || file.assetId === undefined || savingAssetId !== null) return
    setSavingAssetId(file.assetId)
    try {
      const result = await window.electronAPI.linguistExportsSaveAsset({
        projectId,
        assetId: file.assetId,
        validation: 'verified',
      })
      if (!aliveRef.current) return
      if (!result.ok) {
        toast.error('导出失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      if (result.data.cancelled) return
      toast.success(`已导出「${result.data.filename}」`, {
        description: `${result.data.verifiedSegments} 段`,
      })
      // 导出产生新 staging 产物，刷新列表（真源）
      void refresh()
    } catch {
      if (aliveRef.current) toast.error('导出失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      if (aliveRef.current) setSavingAssetId(null)
    }
  }, [projectId, savingAssetId, refresh])

  // 无绑定项目：整区不显示
  if (!binding || !projectId) return null

  return (
    <div className="pt-2.5 pb-1 flex-shrink-0">
      <div className="flex items-center gap-1 mb-1 px-3">
        <Package className="size-3 text-muted-foreground" />
        <span className="text-[11px] font-medium text-muted-foreground">
          交付物{files !== null && files.length > 0 ? `（${files.length}）` : ''}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="刷新交付物列表"
          title="刷新交付物列表"
          onClick={() => void refresh()}
          className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground/60 hover:bg-accent/70 hover:text-foreground"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>
      {errorMessage !== null ? (
        <div role="alert" className="mx-3 text-[11px] text-destructive py-1">
          {errorMessage}
        </div>
      ) : files === null ? (
        <div className="mx-3 flex items-center gap-1.5 text-[11px] text-muted-foreground/60 py-1">
          <Loader2 className="size-3 animate-spin motion-reduce:hidden" />
          <span className="hidden motion-reduce:inline">加载中</span>
        </div>
      ) : files.length === 0 ? (
        <div className="mx-3 text-[11px] text-muted-foreground/50 py-1">
          尚无交付物{projectArchived ? '（项目已归档）' : '，导出译文后在此可见'}
        </div>
      ) : (
        files.map((file) => {
          const displayName = displayNameOf(file)
          const clickable = file.assetId !== undefined && !projectArchived
          return (
            <div
              key={file.filename}
              role={clickable ? 'button' : 'listitem'}
              tabIndex={clickable ? 0 : undefined}
              title={
                clickable
                  ? `${file.filename}\n${file.stale ? '项目在该交付物生成后已有修改；请重新导出。\n' : ''}点击经原生「保存」对话框导出副本`
                  : file.filename
              }
              onClick={clickable ? () => void handleSave(file) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter') void handleSave(file) } : undefined}
              className={cn(
                'flex items-center gap-1 py-1 pl-2 pr-2 text-sm group mx-2 rounded-lg',
                clickable && 'cursor-pointer hover:bg-accent/50',
              )}
            >
              <span className="w-3.5 flex-shrink-0" />
              <FileTypeIcon name={displayName} isDirectory={false} />
              <span className="text-xs truncate flex-1">{displayName}</span>
              {file.stale && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400"
                  title="项目在该交付物生成后已有修改，请重新导出"
                >
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  旧修订
                </span>
              )}
              <span className="text-[10px] text-muted-foreground/60 tabular-nums flex-shrink-0">
                {formatSize(file.sizeBytes)}
              </span>
              {savingAssetId === file.assetId ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground flex-shrink-0 motion-reduce:hidden" />
              ) : (
                clickable && (
                  <Download className="size-3.5 text-muted-foreground/50 flex-shrink-0 invisible group-hover:visible" />
                )
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
