import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistContextDocInfo } from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import { createContextDocsRefreshGate } from './context-docs-refresh'
import {
  getProjectMutationRefreshPlan,
  linguistProjectMutationStateAtomFamily,
} from './project-mutation-atoms'

/**
 * Context Docs 面板（PB-095）：导入（走主进程文件选择器，字节落 blobs/）、
 * 列表（文件名/类型/note/是否有文本抽取）、note 编辑、删除（级联清 blob）。
 * image 条目经 proma-file:// previewUrl 内联预览（不透明 token URL，
 * renderer 不接触绝对路径）；模型经 cat_read_context_doc 读 text_extract。
 * 归档项目只读。
 */
export function ContextDocsPanel({ projectId, archived }: { projectId: string; archived: boolean }): React.ReactElement {
  const projectMutationState = useAtomValue(
    linguistProjectMutationStateAtomFamily(projectId),
  )
  const [docs, setDocs] = React.useState<LinguistContextDocInfo[]>([])
  const [busy, setBusy] = React.useState(false)
  const refreshGateRef = React.useRef(createContextDocsRefreshGate())
  const handledMutationRevisions = React.useRef(new Map<string, number>())
  /** 正在编辑 note 的行 id 与其草稿。 */
  const [noteDraft, setNoteDraft] = React.useState<{ id: string; value: string } | undefined>(undefined)

  const refresh = React.useCallback(async (): Promise<void> => {
    const revision = refreshGateRef.current.begin()
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistAssetsQuery({ projectId, kind: 'contextDocs', limit: 200, offset: 0 })
      if (!refreshGateRef.current.isLatest(revision)) return
      if (!result.ok) {
        toast.error('读取 Context Docs 失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      setDocs(result.data.items as LinguistContextDocInfo[])
    } catch {
      if (refreshGateRef.current.isLatest(revision)) {
        toast.error('读取 Context Docs 失败', { description: '与主进程通信异常（INTERNAL）' })
      }
    } finally {
      if (refreshGateRef.current.isLatest(revision)) setBusy(false)
    }
  }, [projectId])
  React.useEffect(() => { void refresh() }, [refresh])
  React.useEffect(() => {
    const lastHandled = handledMutationRevisions.current.get(projectId)
    if (lastHandled === undefined) {
      handledMutationRevisions.current.set(projectId, projectMutationState.lastRevision)
      return
    }
    if (projectMutationState.lastRevision <= lastHandled) return
    handledMutationRevisions.current.set(projectId, projectMutationState.lastRevision)
    if (getProjectMutationRefreshPlan(projectMutationState).resources) void refresh()
  }, [projectId, projectMutationState, refresh])

  const importDoc = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistAssetsImportContextDoc({ projectId })
      if (!result.ok) {
        toast.error('导入 Context Doc 失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      if (!result.data.cancelled) {
        const imported = result.data.doc
        setDocs((current) => [
          ...current.filter((doc) => doc.id !== imported.id),
          imported,
        ])
        toast.success(`已导入 ${result.data.filename}`)
        await refresh()
      }
    } catch {
      toast.error('导入 Context Doc 失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }

  const saveNote = async (): Promise<void> => {
    if (noteDraft === undefined) return
    const result = await window.electronAPI.linguistAssetsUpsert({
      projectId,
      kind: 'contextDocs',
      item: { id: noteDraft.id, ...(noteDraft.value.trim() !== '' ? { note: noteDraft.value.trim() } : {}) },
    })
    if (!result.ok) {
      toast.error('保存备注失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    const updated = result.data as LinguistContextDocInfo
    setDocs((current) => current.map((doc) => doc.id === updated.id ? updated : doc))
    setNoteDraft(undefined)
    await refresh()
  }

  const removeDoc = async (id: string): Promise<void> => {
    const result = await window.electronAPI.linguistAssetsDelete({ projectId, kind: 'contextDocs', id })
    if (!result.ok) {
      toast.error('删除 Context Doc 失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    setDocs((current) => current.filter((doc) => doc.id !== id))
    if (noteDraft?.id === id) setNoteDraft(undefined)
    await refresh()
  }

  return (
    <details className="rounded-xl bg-content-area shadow-sm ring-1 ring-border/35">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-medium text-foreground/70">Context Docs（{docs.length}）</summary>
      <div className="space-y-2 border-t border-border/35 p-3">
        <div className="flex items-center gap-1.5">
          <p className="flex-1 text-[10px] text-foreground/40">图片内联预览；模型经 cat_read_context_doc 读取文本抽取。</p>
          <button type="button" disabled={archived || busy} onClick={() => void importDoc()} className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-2 py-1 text-[11px] disabled:opacity-40">
            <Download size={11} />导入文档/图片
          </button>
        </div>
        {busy && docs.length === 0 ? (
          <p className="text-[11px] text-foreground/40">正在读取…</p>
        ) : docs.length === 0 ? (
          <p className="text-[11px] text-foreground/40">暂无 Context Doc</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-auto">
            {docs.map((doc) => (
              <li key={doc.id} className="rounded-md bg-foreground/[0.035] px-2 py-1.5 text-[11px]">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-medium">{doc.originalFilename}</span>
                    <span className="ml-2 text-foreground/50">
                      {doc.kind === 'image' ? '图片' : '文档'}
                      {doc.hasTextExtract
                        ? ` · 可阅读（${doc.textExtractLength} 字）`
                        : doc.kind === 'doc'
                          ? ' · 不可阅读，请删除后重新导入 DOCX/文本'
                          : ' · 无文本抽取'}
                    </span>
                    {doc.note !== undefined && noteDraft?.id !== doc.id && (
                      <span className="block text-foreground/50">{doc.note}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={archived}
                    onClick={() => setNoteDraft(noteDraft?.id === doc.id ? undefined : { id: doc.id, value: doc.note ?? '' })}
                    className="mt-0.5 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 disabled:opacity-40"
                  >
                    备注
                  </button>
                  <button type="button" disabled={archived} onClick={() => void removeDoc(doc.id)} aria-label="删除 Context Doc" className="mt-0.5 text-destructive disabled:opacity-40">
                    <Trash2 size={12} />
                  </button>
                </div>
                {doc.kind === 'image' && doc.previewUrl !== undefined && (
                  <img
                    src={doc.previewUrl}
                    alt={doc.originalFilename}
                    loading="lazy"
                    className="mt-1 max-h-40 w-auto rounded-md ring-1 ring-border/35"
                  />
                )}
                {noteDraft?.id === doc.id && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      value={noteDraft.value}
                      onChange={(event) => setNoteDraft({ id: doc.id, value: event.target.value })}
                      placeholder="备注（留空表示清除）"
                      className="h-7 min-w-0 flex-1 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50"
                    />
                    <button type="button" onClick={() => void saveNote()} className="rounded-md bg-primary/10 px-2 py-1 text-[11px] text-primary">保存</button>
                    <button type="button" onClick={() => setNoteDraft(undefined)} className="rounded-md bg-foreground/[0.06] px-2 py-1 text-[11px]">取消</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
