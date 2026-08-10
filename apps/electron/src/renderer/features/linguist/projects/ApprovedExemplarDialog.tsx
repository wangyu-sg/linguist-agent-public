import * as React from 'react'
import { toast } from 'sonner'
import type { LinguistSegmentInfo } from '@proma/shared'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { describeLinguistIpcError } from './project-utils'

interface ExemplarDraft {
  speaker: string
  textType: string
  note: string
}

function segmentDraft(segment: LinguistSegmentInfo): ExemplarDraft {
  const meta = segment.context?.meta
  return {
    speaker: meta?.speaker ?? '',
    textType: meta?.textType ?? meta?.text_type ?? meta?.stringType ?? meta?.string_type ?? '',
    note: '',
  }
}

export function ApprovedExemplarForm({
  segment,
  speaker,
  textType,
  note,
  saving,
  onSpeakerChange,
  onTextTypeChange,
  onNoteChange,
  onCancel,
  onSubmit,
}: {
  segment: LinguistSegmentInfo
  speaker: string
  textType: string
  note: string
  saving: boolean
  onSpeakerChange: (value: string) => void
  onTextTypeChange: (value: string) => void
  onNoteChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}): React.ReactElement {
  const canSubmit = !saving && speaker.trim() !== '' && textType.trim() !== ''
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onSubmit()
      }}
    >
      <div className="space-y-1 rounded-lg bg-foreground/[0.035] p-3 text-xs">
        <p className="text-foreground/55">Source</p>
        <p className="whitespace-pre-wrap text-foreground">{segment.source}</p>
        <p className="pt-1 text-foreground/55">Target</p>
        <p className="whitespace-pre-wrap text-foreground">{segment.target}</p>
      </div>
      <label className="block space-y-1 text-xs">
        <span className="font-medium text-foreground">角色 / speaker</span>
        <input
          required
          maxLength={200}
          value={speaker}
          onChange={(event) => onSpeakerChange(event.target.value)}
          className="h-9 w-full rounded-md bg-background px-3 ring-1 ring-border/50 focus:outline-none focus:ring-primary/50"
        />
      </label>
      <label className="block space-y-1 text-xs">
        <span className="font-medium text-foreground">文本类型 / textType</span>
        <input
          required
          maxLength={120}
          value={textType}
          onChange={(event) => onTextTypeChange(event.target.value)}
          placeholder="例如 dialogue"
          className="h-9 w-full rounded-md bg-background px-3 ring-1 ring-border/50 focus:outline-none focus:ring-primary/50"
        />
      </label>
      <label className="block space-y-1 text-xs">
        <span className="font-medium text-foreground">备注 / note</span>
        <textarea
          maxLength={2_000}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="为什么这句适合作为角色译例（可空）"
          className="min-h-20 w-full resize-y rounded-md bg-background px-3 py-2 ring-1 ring-border/50 focus:outline-none focus:ring-primary/50"
        />
      </label>
      <DialogFooter>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="rounded-md bg-foreground/[0.06] px-3 py-1.5 text-xs disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {saving ? '正在保存…' : '保存角色译例'}
        </button>
      </DialogFooter>
    </form>
  )
}

export function ApprovedExemplarDialog({
  projectId,
  segment,
  onOpenChange,
}: {
  projectId: string
  segment?: LinguistSegmentInfo
  onOpenChange: (open: boolean) => void
}): React.ReactElement {
  const [draft, setDraft] = React.useState<ExemplarDraft>(() =>
    segment === undefined ? { speaker: '', textType: '', note: '' } : segmentDraft(segment))
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (segment !== undefined) setDraft(segmentDraft(segment))
  }, [segment])

  if (segment === undefined) return <></>

  const save = async (): Promise<void> => {
    if (saving || draft.speaker.trim() === '' || draft.textType.trim() === '') return
    setSaving(true)
    try {
      const result = await window.electronAPI.linguistCatAddApprovedExemplar({
        projectId,
        segmentId: segment.id,
        speaker: draft.speaker.trim(),
        textType: draft.textType.trim(),
        ...(draft.note.trim() === '' ? {} : { note: draft.note.trim() }),
      })
      if (!result.ok) {
        toast.error('保存角色译例失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      toast.success(`已保存 ${result.data.speaker} 的角色译例`)
      onOpenChange(false)
    } catch {
      toast.error('保存角色译例失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设为角色译例</DialogTitle>
          <DialogDescription>
            保存当前已确认的 Source / Target；正文与 Segment 引用由主进程读取。
          </DialogDescription>
        </DialogHeader>
        <ApprovedExemplarForm
          segment={segment}
          speaker={draft.speaker}
          textType={draft.textType}
          note={draft.note}
          saving={saving}
          onSpeakerChange={(speaker) => setDraft((current) => ({ ...current, speaker }))}
          onTextTypeChange={(textType) => setDraft((current) => ({ ...current, textType }))}
          onNoteChange={(note) => setDraft((current) => ({ ...current, note }))}
          onCancel={() => onOpenChange(false)}
          onSubmit={() => void save()}
        />
      </DialogContent>
    </Dialog>
  )
}
