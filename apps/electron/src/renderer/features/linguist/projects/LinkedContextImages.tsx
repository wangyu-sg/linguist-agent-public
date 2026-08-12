import * as React from 'react'
import { ImagePlus, Link2, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistContextDocInfo } from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import { useOpenLinguistPreview } from './linguist-preview-open'

/**
 * K6 关联图片区：展示与当前 Segment 显式关联的 Context 图片/文档，
 * 支持解除关联、从项目 Context Docs 中选择关联，以及打开原生预览。
 *
 * 缩略图走 main 下发的 proma-file:// previewUrl（不透明 token URL）；
 * 预览统一进 Proma Preview Tab；写操作经
 * linguistAssetsSetContextDocSegmentLink，归档项目只读。
 * 关联/解除后 main 广播 asset-updated，由 ContextEvidencePanel 的
 * mutation 刷新链路重新查询，本组件不自行持有 docs 真源。
 */

export interface LinkedContextImagesViewProps {
  /** 已与当前 Segment 关联的 Context Docs（含图片与文档）。 */
  docs: LinguistContextDocInfo[]
  archived: boolean
  /** 选择器是否展开。 */
  pickerOpen: boolean
  /** 选择器候选（项目内尚未关联的 Context Docs）。 */
  candidates: LinguistContextDocInfo[]
  loadingCandidates: boolean
  /** 正在等待 IPC 返回的 doc id。 */
  busyDocId?: string
  onPreview: (doc: LinguistContextDocInfo) => void
  onUnlink: (doc: LinguistContextDocInfo) => void
  onTogglePicker: () => void
  onLink: (doc: LinguistContextDocInfo) => void
}

export function LinkedContextImagesView({
  docs,
  archived,
  pickerOpen,
  candidates,
  loadingCandidates,
  busyDocId,
  onPreview,
  onUnlink,
  onTogglePicker,
  onLink,
}: LinkedContextImagesViewProps): React.ReactElement {
  return (
    <article className="rounded-xl bg-foreground/[0.025] p-3 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">关联图片 / 文档</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{docs.length}</span>
          <button
            type="button"
            disabled={archived}
            onClick={onTogglePicker}
            className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] disabled:opacity-40"
          >
            <ImagePlus size={11} />
            {pickerOpen ? '收起' : '关联图片'}
          </button>
        </div>
      </div>
      {docs.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          当前片段还没有关联图片。关联后 Agent 可经 cat_read_context_doc 查看。
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-2 rounded-lg bg-foreground/[0.035] px-2.5 py-2 text-xs">
              {doc.kind === 'image' && doc.previewUrl !== undefined && (
                <button
                  type="button"
                  onClick={() => onPreview(doc)}
                  aria-label={`预览 ${doc.originalFilename}`}
                  className="shrink-0"
                >
                  <img
                    src={doc.previewUrl}
                    alt={doc.originalFilename}
                    loading="lazy"
                    className="max-h-10 w-auto rounded ring-1 ring-border/35"
                  />
                </button>
              )}
              <span className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onPreview(doc)}
                  className="block max-w-full truncate text-left text-[11px] font-medium text-foreground/80 hover:text-foreground"
                >
                  {doc.originalFilename}
                </button>
                <span className="text-[10px] text-muted-foreground">
                  {doc.kind === 'image' ? '图片' : '文档'}
                </span>
              </span>
              <button
                type="button"
                disabled={archived || busyDocId === doc.id}
                onClick={() => onUnlink(doc)}
                aria-label={`解除关联 ${doc.originalFilename}`}
                className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-40"
              >
                {busyDocId === doc.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pickerOpen && (
        <div className="mt-2 rounded-lg ring-1 ring-border/35">
          <p className="border-b border-border/35 px-2.5 py-1.5 text-[10px] text-muted-foreground">
            选择项目 Context Doc 关联到当前片段（图片 Agent 可直接查看）
          </p>
          {loadingCandidates ? (
            <p role="status" className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-muted-foreground">
              <Loader2 size={11} className="animate-spin" />
              正在读取 Context Docs…
            </p>
          ) : candidates.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
              没有可关联的 Context Doc，请先在项目设置中导入。
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-auto p-2">
              {candidates.map((doc) => (
                <li key={doc.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">
                    {doc.originalFilename}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      {doc.kind === 'image' ? '图片' : '文档'}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busyDocId === doc.id}
                    onClick={() => onLink(doc)}
                    aria-label={`关联 ${doc.originalFilename}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary disabled:opacity-40"
                  >
                    {busyDocId === doc.id ? <Loader2 size={11} className="animate-spin" /> : <Link2 size={11} />}
                    关联
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  )
}

export function LinkedContextImages({
  projectId,
  segmentId,
  docs,
  archived,
}: {
  projectId: string
  segmentId: string
  docs: LinguistContextDocInfo[]
  archived: boolean
}): React.ReactElement {
  const openLinguistPreview = useOpenLinguistPreview()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [allDocs, setAllDocs] = React.useState<LinguistContextDocInfo[]>([])
  const [loadingCandidates, setLoadingCandidates] = React.useState(false)
  const [busyDocId, setBusyDocId] = React.useState<string | undefined>(undefined)

  /** 候选 = 项目全部 Context Docs 中尚未与当前片段关联的。 */
  const candidates = React.useMemo(() => {
    const linkedIds = new Set(docs.map((doc) => doc.id))
    return allDocs.filter((doc) => !linkedIds.has(doc.id))
  }, [allDocs, docs])

  const togglePicker = (): void => {
    if (pickerOpen) {
      setPickerOpen(false)
      return
    }
    setPickerOpen(true)
    setLoadingCandidates(true)
    void window.electronAPI.linguistAssetsQuery({
      projectId,
      kind: 'contextDocs',
      limit: 200,
      offset: 0,
    }).then((result) => {
      if (!result.ok) {
        toast.error('读取 Context Docs 失败', { description: describeLinguistIpcError(result.error) })
        setPickerOpen(false)
        return
      }
      setAllDocs(result.data.items as LinguistContextDocInfo[])
    }).catch(() => {
      toast.error('读取 Context Docs 失败', { description: '与主进程通信异常（INTERNAL）' })
      setPickerOpen(false)
    }).finally(() => {
      setLoadingCandidates(false)
    })
  }

  const setLink = async (doc: LinguistContextDocInfo, linked: boolean): Promise<void> => {
    setBusyDocId(doc.id)
    try {
      const result = await window.electronAPI.linguistAssetsSetContextDocSegmentLink({
        projectId,
        docId: doc.id,
        segmentId,
        linked,
      })
      if (!result.ok) {
        toast.error(linked ? '关联失败' : '解除关联失败', {
          description: describeLinguistIpcError(result.error),
        })
      }
      // 成功后不本地改 docs：main 广播 asset-updated，父级刷新链路重查。
    } catch {
      toast.error(linked ? '关联失败' : '解除关联失败', {
        description: '与主进程通信异常（INTERNAL）',
      })
    } finally {
      setBusyDocId(undefined)
    }
  }

  const preview = (doc: LinguistContextDocInfo): void => {
    const opened = openLinguistPreview({
      kind: 'contextDoc',
      projectId,
      docId: doc.id,
      filename: doc.originalFilename,
    })
    if (!opened) toast('项目会话尚未就绪，请稍后重试')
  }

  return (
    <LinkedContextImagesView
      docs={docs}
      archived={archived}
      pickerOpen={pickerOpen}
      candidates={candidates}
      loadingCandidates={loadingCandidates}
      busyDocId={busyDocId}
      onPreview={preview}
      onUnlink={(doc) => void setLink(doc, false)}
      onTogglePicker={togglePicker}
      onLink={(doc) => void setLink(doc, true)}
    />
  )
}
