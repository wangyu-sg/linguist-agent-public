import * as React from 'react'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistTermInfo, LinguistTmInfo } from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import { SentencePatternsPanel } from './SentencePatternsPanel'

type Tab = 'tm' | 'terms' | 'patterns'

export function ReferenceManager({ projectId, archived }: { projectId: string; archived: boolean }): React.ReactElement {
  const [tab, setTab] = React.useState<Tab>('tm')
  const [query, setQuery] = React.useState('')
  const [tm, setTm] = React.useState<LinguistTmInfo[]>([])
  const [terms, setTerms] = React.useState<LinguistTermInfo[]>([])
  const [busy, setBusy] = React.useState(false)
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
      } else {
        const result = await window.electronAPI.linguistReferencesQueryTerms({ projectId, query, limit: 50, offset: 0 })
        if (!result.ok) {
          toast.error('读取参考库失败', { description: describeLinguistIpcError(result.error) })
          return
        }
        setTerms(result.data.items)
      }
    } catch {
      toast.error('读取参考库失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }, [projectId, query, tab])
  React.useEffect(() => { void refresh() }, [refresh])
  const importReference = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistReferencesImport({ projectId, kind: tab === 'tm' ? 'tm' : 'terms' })
      if (!result.ok) {
        toast.error('导入失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      if (!result.data.cancelled) {
        toast.success(`已导入 ${result.data.imported ?? 0} 条`, { description: result.data.warnings?.[0] })
        await refresh()
      }
    } catch {
      toast.error('导入失败', { description: '与主进程通信异常（INTERNAL）' })
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
  const items = tab === 'tm' ? tm : terms
  return <details className="rounded-xl bg-content-area shadow-sm ring-1 ring-border/35">
    <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-medium text-foreground/70">TM / 术语库 / 句式管理</summary>
    <div className="space-y-2 border-t border-border/35 p-3">
      <div className="flex flex-wrap gap-1.5"><button type="button" onClick={() => setTab('tm')} className={`rounded-md px-2 py-1 text-[11px] ${tab === 'tm' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05]'}`}>翻译记忆</button><button type="button" onClick={() => setTab('terms')} className={`rounded-md px-2 py-1 text-[11px] ${tab === 'terms' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05]'}`}>术语库</button><button type="button" onClick={() => setTab('patterns')} className={`rounded-md px-2 py-1 text-[11px] ${tab === 'patterns' ? 'bg-primary/10 text-primary' : 'bg-foreground/[0.05]'}`}>句式</button>{tab !== 'patterns' && <><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" className="ml-auto h-7 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" /><button type="button" disabled={archived || busy} onClick={() => void importReference()} className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2 py-1 text-[11px] disabled:opacity-40"><Download size={11} />导入 {tab === 'tm' ? 'TMX/CSV' : 'TBX/CSV'}</button></>}</div>
      {tab === 'patterns' ? <SentencePatternsPanel projectId={projectId} archived={archived} /> : busy ? <p className="text-[11px] text-foreground/40">正在读取…</p> : items.length === 0 ? <p className="text-[11px] text-foreground/40">暂无记录</p> : <ul className="max-h-56 space-y-1 overflow-auto text-[11px]">{items.map((item) => <li key={item.id} className="flex items-center gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5"><span className="min-w-0 flex-1 break-words">{tab === 'tm' ? <>{(item as LinguistTmInfo).source}<span className="ml-2 text-foreground/45">{(item as LinguistTmInfo).target}</span></> : <>{(item as LinguistTermInfo).term}<span className="ml-2 text-foreground/45">{(item as LinguistTermInfo).translation} · {(item as LinguistTermInfo).status}</span></>}</span><button type="button" disabled={archived} onClick={() => void remove(item.id)} aria-label="删除参考记录" className="text-destructive disabled:opacity-40"><Trash2 size={12} /></button></li>)}</ul>}
    </div>
  </details>
}
