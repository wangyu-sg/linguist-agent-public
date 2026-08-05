import * as React from 'react'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistSentencePatternInfo, LinguistSentencePatternStatus } from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import {
  canTransitionSentencePattern,
  filterSentencePatternsByStatus,
  SENTENCE_PATTERN_STATUS_LABELS,
  SENTENCE_PATTERN_STATUSES,
} from './sentence-patterns-utils'

const STATUS_CHIP_STYLE: Record<LinguistSentencePatternStatus, string> = {
  confirmed: 'bg-primary/10 text-primary',
  pending: 'bg-foreground/[0.07] text-foreground/60',
  rejected: 'bg-destructive/10 text-destructive',
}

/**
 * Sentence Patterns 面板（PB-095）：状态筛选 chips、CSV 导入（走主进程
 * 选择器）、状态流转（pending→confirmed|rejected，可互转/打回，自转禁止）
 * 与删除。流转经 upsert 全字段回写；归档项目只读。
 */
export function SentencePatternsPanel({ projectId, archived }: { projectId: string; archived: boolean }): React.ReactElement {
  const [patterns, setPatterns] = React.useState<LinguistSentencePatternInfo[]>([])
  const [busy, setBusy] = React.useState(false)
  const [statusFilter, setStatusFilter] = React.useState<LinguistSentencePatternStatus | 'all'>('all')

  const refresh = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistAssetsQuery({ projectId, kind: 'sentencePatterns', limit: 200, offset: 0 })
      if (!result.ok) {
        toast.error('读取句式库失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      setPatterns(result.data.items as LinguistSentencePatternInfo[])
    } catch {
      toast.error('读取句式库失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }, [projectId])
  React.useEffect(() => { void refresh() }, [refresh])

  const importPatterns = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistAssetsImportSentencePatterns({ projectId })
      if (!result.ok) {
        toast.error('导入句式失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      if (!result.data.cancelled) {
        toast.success(`已导入 ${result.data.imported ?? 0} 条句式`, {
          description: result.data.warnings !== undefined && result.data.warnings.length > 0 ? result.data.warnings[0] : undefined,
        })
        await refresh()
      }
    } catch {
      toast.error('导入句式失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }

  const transitionTo = async (pattern: LinguistSentencePatternInfo, to: LinguistSentencePatternStatus): Promise<void> => {
    if (!canTransitionSentencePattern(pattern.status, to)) return
    const result = await window.electronAPI.linguistAssetsUpsert({
      projectId,
      kind: 'sentencePatterns',
      item: {
        id: pattern.id,
        source: pattern.source,
        status: to,
        ...(pattern.textType !== undefined ? { textType: pattern.textType } : {}),
        ...(pattern.module !== undefined ? { module: pattern.module } : {}),
        ...(pattern.draftTarget !== undefined ? { draftTarget: pattern.draftTarget } : {}),
        ...(pattern.suggestedTarget !== undefined ? { suggestedTarget: pattern.suggestedTarget } : {}),
        ...(pattern.reviewer !== undefined ? { reviewer: pattern.reviewer } : {}),
      },
    })
    if (!result.ok) {
      toast.error('更新句式状态失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    await refresh()
  }

  const removePattern = async (id: string): Promise<void> => {
    const result = await window.electronAPI.linguistAssetsDelete({ projectId, kind: 'sentencePatterns', id })
    if (!result.ok) {
      toast.error('删除句式失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    await refresh()
  }

  const visible = filterSentencePatternsByStatus(patterns, statusFilter)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setStatusFilter('all')} className={`rounded-md px-2 py-1 text-[11px] ${statusFilter === 'all' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05]'}`}>全部（{patterns.length}）</button>
        {SENTENCE_PATTERN_STATUSES.map((status) => (
          <button key={status} type="button" onClick={() => setStatusFilter(status)} className={`rounded-md px-2 py-1 text-[11px] ${statusFilter === status ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05]'}`}>
            {SENTENCE_PATTERN_STATUS_LABELS[status]}（{patterns.filter((pattern) => pattern.status === status).length}）
          </button>
        ))}
        <button type="button" disabled={archived || busy} onClick={() => void importPatterns()} className="ml-auto inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2 py-1 text-[11px] disabled:opacity-40">
          <Download size={11} />导入 CSV
        </button>
      </div>
      {busy && patterns.length === 0 ? (
        <p className="text-[11px] text-foreground/40">正在读取…</p>
      ) : visible.length === 0 ? (
        <p className="text-[11px] text-foreground/40">暂无句式</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-auto">
          {visible.map((pattern) => (
            <li key={pattern.id} className="flex items-start gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5 text-[11px]">
              <span className="min-w-0 flex-1 break-words">
                <span className={`mr-1.5 inline-block rounded px-1 py-px text-[10px] ${STATUS_CHIP_STYLE[pattern.status]}`}>
                  {SENTENCE_PATTERN_STATUS_LABELS[pattern.status]}
                </span>
                {pattern.source}
                {(pattern.draftTarget !== undefined || pattern.suggestedTarget !== undefined) && (
                  <span className="mt-0.5 block text-foreground/50">
                    {pattern.suggestedTarget ?? pattern.draftTarget}
                  </span>
                )}
                {(pattern.textType !== undefined || pattern.module !== undefined) && (
                  <span className="mt-0.5 block text-foreground/40">
                    {[pattern.textType, pattern.module].filter((item) => item !== undefined).join(' · ')}
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex shrink-0 items-center gap-1">
                {SENTENCE_PATTERN_STATUSES.filter((status) => canTransitionSentencePattern(pattern.status, status)).map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={archived || busy}
                    onClick={() => void transitionTo(pattern, status)}
                    className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] disabled:opacity-40"
                  >
                    {SENTENCE_PATTERN_STATUS_LABELS[status]}
                  </button>
                ))}
                <button type="button" disabled={archived} onClick={() => void removePattern(pattern.id)} aria-label="删除句式" className="text-destructive disabled:opacity-40">
                  <Trash2 size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
