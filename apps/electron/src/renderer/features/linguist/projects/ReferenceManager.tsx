import * as React from 'react'
import { Download, FileText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  LinguistReferenceCandidateSummary,
  LinguistReferenceImportInfo,
  LinguistTermInfo,
  LinguistTermStatus,
  LinguistTmInfo,
} from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import { SentencePatternsPanel } from './SentencePatternsPanel'
import { useOpenLinguistPreview } from './linguist-preview-open'

type Tab = 'tm' | 'terms' | 'patterns'

interface PendingReferenceCandidate {
  kind: 'tm' | 'terms'
  candidateId: string
  sourceSha256: string
  filename: string
  summary: LinguistReferenceCandidateSummary
}

export function ReferenceManager({ projectId, archived }: { projectId: string; archived: boolean }): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>('tm')
  const [query, setQuery] = React.useState('')
  const [tm, setTm] = React.useState<LinguistTmInfo[]>([])
  const [terms, setTerms] = React.useState<LinguistTermInfo[]>([])
  const [imports, setImports] = React.useState<LinguistReferenceImportInfo[]>([])
  const [candidate, setCandidate] = React.useState<PendingReferenceCandidate | null>(null)
  const [termStatus, setTermStatus] = React.useState<'all' | LinguistTermStatus>('all')
  const [busy, setBusy] = React.useState(false)
  const openLinguistPreview = useOpenLinguistPreview()
  const refresh = React.useCallback(async (): Promise<void> => {
    if (tab === 'patterns') return
    setBusy(true)
    try {
      if (tab === 'tm') {
        const result = await window.electronAPI.linguistReferencesQueryTm({ projectId, query, limit: 50, offset: 0 })
        if (!result.ok) {
          toast.error('读取参考库失败', { description: describeLinguistIpcError(result.error) })
          return
        }
        setTm(result.data.items)
        setImports(result.data.imports ?? [])
      } else {
        const result = await window.electronAPI.linguistReferencesQueryTerms({
          projectId,
          query,
          ...(termStatus === 'all' ? {} : { status: termStatus }),
          limit: 50,
          offset: 0,
        })
        if (!result.ok) {
          toast.error('读取参考库失败', { description: describeLinguistIpcError(result.error) })
          return
        }
        setTerms(result.data.items)
        setImports(result.data.imports ?? [])
      }
    } catch {
      toast.error('读取参考库失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }, [projectId, query, tab, termStatus])
  React.useEffect(() => { void refresh() }, [refresh])
  React.useEffect(() => { setCandidate(null) }, [projectId])
  const importReference = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistReferencesImport({ projectId, kind: tab === 'tm' ? 'tm' : 'terms' })
      if (!result.ok) {
        toast.error('导入失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      if (!result.data.cancelled) {
        if (result.data.requiresConfirmation) {
          setCandidate({
            kind: tab === 'tm' ? 'tm' : 'terms',
            candidateId: result.data.candidateId,
            sourceSha256: result.data.sourceSha256,
            filename: result.data.filename,
            summary: result.data.summary,
          })
          toast(`已解析 ${result.data.summary.entryCount} 条候选，请确认后写入参考库`)
          return
        }
        toast.success(`已导入 ${result.data.imported} 条`, { description: result.data.warnings[0] })
        await refresh()
      }
    } catch {
      toast.error('导入失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }
  const confirmCandidate = async (): Promise<void> => {
    if (candidate === null || archived || busy) return
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistReferencesConfirmImport({
        projectId,
        kind: candidate.kind,
        candidateId: candidate.candidateId,
        sourceSha256: candidate.sourceSha256,
      })
      if (!result.ok) {
        toast.error('确认导入失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      setCandidate(null)
      toast.success(`已导入 ${result.data.imported} 条`, { description: result.data.warnings[0] })
      await refresh()
    } catch {
      toast.error('确认导入失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }
  const cancelCandidate = async (): Promise<void> => {
    if (candidate === null || busy) return
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistReferencesCancelImport({
        projectId,
        kind: candidate.kind,
        candidateId: candidate.candidateId,
        sourceSha256: candidate.sourceSha256,
      })
      if (!result.ok) {
        toast.error('取消候选失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      setCandidate(null)
      toast('已丢弃未确认候选')
    } catch {
      toast.error('取消候选失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string): Promise<void> => {
    const result = await window.electronAPI.linguistReferencesDelete({ projectId, kind: tab === 'tm' ? 'tm' : 'terms', id })
    if (!result.ok) {
      toast.error('删除失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    await refresh()
  }
  const openImportSource = (source: LinguistReferenceImportInfo): void => {
    const opened = openLinguistPreview({
      kind: 'referenceImport',
      projectId,
      importId: source.id,
      filename: source.filename,
      referenceKind: source.kind,
    })
    if (!opened) toast('项目会话尚未就绪，请稍后重试')
  }
  const openCandidateSource = (pending: PendingReferenceCandidate): void => {
    const opened = openLinguistPreview({
      kind: 'referenceCandidate',
      projectId,
      candidateId: pending.candidateId,
      sourceSha256: pending.sourceSha256,
      filename: pending.filename,
      referenceKind: pending.kind,
    })
    if (!opened) toast('项目会话尚未就绪，请稍后重试')
  }
  const items = tab === 'tm' ? tm : terms
  return (
    <details className="rounded-xl bg-content-area shadow-sm ring-1 ring-border/35">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-medium text-foreground/70">
        TM / 术语库 / 句式管理
      </summary>
      <div className="space-y-2 border-t border-border/35 p-3">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setTab('tm')} className={`rounded-md px-2 py-1 text-[11px] ${tab === 'tm' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05]'}`}>翻译记忆</button>
          <button type="button" onClick={() => setTab('terms')} className={`rounded-md px-2 py-1 text-[11px] ${tab === 'terms' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05]'}`}>术语库</button>
          <button type="button" onClick={() => setTab('patterns')} className={`rounded-md px-2 py-1 text-[11px] ${tab === 'patterns' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05]'}`}>句式</button>
          {tab === 'terms' && (
            <select aria-label="术语状态" value={termStatus} onChange={(event) => setTermStatus(event.target.value as 'all' | LinguistTermStatus)} className="h-7 min-w-0 truncate rounded-md bg-background pl-2 pr-6 text-[11px] ring-1 ring-border/50">
              <option value="all">全部状态</option><option value="required">必需</option><option value="preferred">首选</option><option value="forbidden">禁用</option><option value="allowed">允许</option><option value="deprecated">已弃用</option>
            </select>
          )}
          {tab !== 'patterns' && (
            <>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" className="ml-auto h-7 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
              <button
                type="button"
                disabled={archived || busy || candidate !== null}
                title={candidate === null ? undefined : '请先确认或取消当前候选文件'}
                onClick={() => void importReference()}
                className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2 py-1 text-[11px] disabled:opacity-40"
              >
                <Download size={11} />导入 {tab === 'tm' ? 'TMX/CSV' : 'TBX/CSV'}
              </button>
            </>
          )}
        </div>

        {candidate !== null && (
          <ReferenceCandidateConfirmPanel
            candidate={candidate}
            disabled={archived || busy}
            onPreview={() => openCandidateSource(candidate)}
            onConfirm={() => void confirmCandidate()}
            onCancel={() => void cancelCandidate()}
          />
        )}

        {tab === 'patterns' ? <SentencePatternsPanel projectId={projectId} archived={archived} /> : busy ? (
          <p className="text-[11px] text-foreground/40">正在读取…</p>
        ) : items.length === 0 ? (
          <p className="text-[11px] text-foreground/40">暂无已确认记录</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-auto text-[11px]">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5">
                <span className="min-w-0 flex-1 break-words">
                  {tab === 'tm' ? <>{(item as LinguistTmInfo).source}<span className="ml-2 text-foreground/45">{(item as LinguistTmInfo).target}</span></> : <>{(item as LinguistTermInfo).term}<span className="ml-2 text-foreground/45">{(item as LinguistTermInfo).translation} · {(item as LinguistTermInfo).status}</span></>}
                </span>
                <button type="button" disabled={archived} onClick={() => void remove(item.id)} aria-label="删除参考记录" className="text-destructive disabled:opacity-40"><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
        )}

        {tab !== 'patterns' && imports.length > 0 && (
          <div className="space-y-1.5 border-t border-border/35 pt-2">
            <p className="text-[11px] font-medium text-foreground/55">已确认来源</p>
            <ul className="space-y-1">
              {imports.map((source) => (
                <li key={source.id}>
                  <button type="button" onClick={() => openImportSource(source)} className="flex w-full items-center gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5 text-left text-[11px] hover:bg-foreground/[0.07]">
                    <FileText size={12} className="shrink-0 text-foreground/45" />
                    <span className="min-w-0 flex-1 truncate">{source.filename}</span>
                    <span className="shrink-0 text-foreground/45">预览</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

function ReferenceCandidateConfirmPanel({
  candidate,
  disabled,
  onPreview,
  onConfirm,
  onCancel,
}: {
  candidate: PendingReferenceCandidate
  disabled: boolean
  onPreview: () => void
  onConfirm: () => void
  onCancel: () => void
}): React.ReactElement {
  const label = candidate.kind === 'tm' ? '翻译记忆' : '术语库'
  const { summary } = candidate
  return (
    <section aria-label="参考文件候选确认" className="space-y-2 rounded-lg border border-primary/25 bg-primary/[0.035] px-3 py-2.5 text-[12px]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground/85">{candidate.filename}</p>
          <p className="mt-0.5 text-foreground/55">{label}候选 · {summary.entryCount} 条解析结果；确认前不会被 Agent 使用。</p>
        </div>
        <button type="button" disabled={disabled} onClick={onPreview} className="shrink-0 rounded-md px-2 py-1 text-foreground/60 hover:bg-foreground/[0.07] disabled:opacity-45">查看原文件</button>
      </div>
      {summary.warningCount > 0 && (
        <div className="rounded-md bg-warning-soft/60 px-2 py-1.5 text-foreground/65">
          <p>解析警告 {summary.warningCount} 条{summary.warningCount > summary.warnings.length ? '（仅展示前几条）' : ''}</p>
          {summary.warnings.map((warning, index) => <p key={index} className="mt-0.5 break-words text-foreground/50">{warning}</p>)}
        </div>
      )}
      <ul className="max-h-32 space-y-1 overflow-auto rounded-md bg-background/65 px-2 py-1.5 text-foreground/65">
        {summary.samples.map((sample, index) => (
          <li key={index} className="break-words">
            {sample.kind === 'tm' ? `${sample.source} → ${sample.target}` : `${sample.term} → ${sample.translation} · ${sample.status}`}
          </li>
        ))}
        {summary.samplesTruncated && <li className="text-foreground/45">… 仅展示前 {summary.samples.length} 条；完整内容请查看原文件。</li>}
        {summary.valuesTruncated && <li className="text-foreground/45">长字段已截断展示。</li>}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <button type="button" disabled={disabled} onClick={onCancel} className="rounded-md px-2 py-1 text-foreground/60 hover:bg-foreground/[0.07] disabled:opacity-45">取消</button>
        <button type="button" disabled={disabled} onClick={onConfirm} className="rounded-md bg-primary px-2.5 py-1 text-primary-foreground hover:bg-primary/90 disabled:opacity-45">确认写入{label}</button>
      </div>
    </section>
  )
}
