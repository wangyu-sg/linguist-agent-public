import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistVoiceProfileInfo } from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import { formatMarkerList, parseMarkerList, validateSpeakerInput } from './voice-profile-utils'

interface VoiceDraft {
  speaker: string
  textType: string
  register: string
  person: string
  toneMarkers: string
  taboos: string
  notes: string
}

const EMPTY_DRAFT: VoiceDraft = { speaker: '', textType: '', register: '', person: '', toneMarkers: '', taboos: '', notes: '' }

/**
 * Voice Profile 面板（PB-095）：speaker 行编辑器（文本类型/语域/人称/
 * 语气标记/禁忌）。标记用逗号分隔文本编辑，保存时转字符串数组。
 */
export function VoiceProfilePanel({ projectId, archived }: { projectId: string; archived: boolean }): React.ReactElement {
  const [profiles, setProfiles] = React.useState<LinguistVoiceProfileInfo[]>([])
  const [busy, setBusy] = React.useState(false)
  const [draft, setDraft] = React.useState<VoiceDraft>(EMPTY_DRAFT)
  /** 非空表示表单正在编辑既有行（保存走 id 更新路径）。 */
  const [editingId, setEditingId] = React.useState<string | undefined>(undefined)

  const refresh = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistAssetsQuery({ projectId, kind: 'voiceProfiles', limit: 200, offset: 0 })
      if (!result.ok) {
        toast.error('读取 Voice Profiles 失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      setProfiles(result.data.items as LinguistVoiceProfileInfo[])
    } catch {
      toast.error('读取 Voice Profiles 失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }, [projectId])
  React.useEffect(() => { void refresh() }, [refresh])

  const patchDraft = (patch: Partial<VoiceDraft>): void => setDraft((current) => ({ ...current, ...patch }))

  const saveProfile = async (id: string | undefined, source: VoiceDraft): Promise<void> => {
    const invalidMessage = validateSpeakerInput(source.speaker)
    if (invalidMessage !== null) {
      toast.error('无法保存角色', { description: invalidMessage })
      return
    }
    const toneMarkers = parseMarkerList(source.toneMarkers)
    const taboos = parseMarkerList(source.taboos)
    const result = await window.electronAPI.linguistAssetsUpsert({
      projectId,
      kind: 'voiceProfiles',
      item: {
        ...(id !== undefined ? { id } : {}),
        speaker: source.speaker.trim(),
        ...(source.textType.trim() !== '' ? { textType: source.textType.trim() } : {}),
        ...(source.register.trim() !== '' ? { register: source.register.trim() } : {}),
        ...(source.person.trim() !== '' ? { person: source.person.trim() } : {}),
        ...(toneMarkers.length > 0 ? { toneMarkers } : {}),
        ...(taboos.length > 0 ? { taboos } : {}),
        ...(source.notes.trim() !== '' ? { notes: source.notes.trim() } : {}),
      },
    })
    if (!result.ok) {
      toast.error('保存角色失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    setDraft(EMPTY_DRAFT)
    setEditingId(undefined)
    await refresh()
  }

  const removeProfile = async (id: string): Promise<void> => {
    const result = await window.electronAPI.linguistAssetsDelete({ projectId, kind: 'voiceProfiles', id })
    if (!result.ok) {
      toast.error('删除角色失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    if (editingId === id) {
      setEditingId(undefined)
      setDraft(EMPTY_DRAFT)
    }
    await refresh()
  }

  const editInto = (profile: LinguistVoiceProfileInfo): void => {
    setEditingId(profile.id)
    setDraft({
      speaker: profile.speaker,
      textType: profile.textType ?? '',
      register: profile.register ?? '',
      person: profile.person ?? '',
      toneMarkers: formatMarkerList(profile.toneMarkers),
      taboos: formatMarkerList(profile.taboos),
      notes: profile.notes ?? '',
    })
  }

  return (
    <details className="rounded-xl bg-content-area shadow-sm ring-1 ring-border/35">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-medium text-foreground/70">Voice Profiles（{profiles.length}）</summary>
      <div className="space-y-2 border-t border-border/35 p-3">
        {busy && profiles.length === 0 ? (
          <p className="text-[11px] text-foreground/40">正在读取…</p>
        ) : profiles.length === 0 ? (
          <p className="text-[11px] text-foreground/40">暂无角色</p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-auto">
            {profiles.map((profile) => (
              <li key={profile.id} className="flex items-start gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5 text-[11px]">
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-medium">{profile.speaker}</span>
                  <span className="ml-2 text-foreground/50">
                    {[profile.textType, profile.register, profile.person].filter((item) => item !== undefined).join(' · ')}
                  </span>
                  {profile.toneMarkers !== undefined && profile.toneMarkers.length > 0 && (
                    <span className="block text-foreground/50">语气：{formatMarkerList(profile.toneMarkers)}</span>
                  )}
                  {profile.taboos !== undefined && profile.taboos.length > 0 && (
                    <span className="block text-foreground/50">禁忌：{formatMarkerList(profile.taboos)}</span>
                  )}
                </span>
                <button type="button" disabled={archived} onClick={() => editInto(profile)} className="mt-0.5 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 disabled:opacity-40">编辑</button>
                <button type="button" disabled={archived} onClick={() => void removeProfile(profile.id)} aria-label="删除角色" className="mt-0.5 text-destructive disabled:opacity-40">
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-1.5 border-t border-border/25 pt-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={draft.speaker} onChange={(event) => patchDraft({ speaker: event.target.value })} placeholder="角色名" className="h-7 w-24 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
            <input value={draft.textType} onChange={(event) => patchDraft({ textType: event.target.value })} placeholder="文本类型（可空）" className="h-7 w-28 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
            <input value={draft.register} onChange={(event) => patchDraft({ register: event.target.value })} placeholder="语域（可空）" className="h-7 w-24 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
            <input value={draft.person} onChange={(event) => patchDraft({ person: event.target.value })} placeholder="人称（可空）" className="h-7 w-24 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
            <input value={draft.notes} onChange={(event) => patchDraft({ notes: event.target.value })} placeholder="备注（可空）" className="h-7 min-w-28 flex-1 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={draft.toneMarkers} onChange={(event) => patchDraft({ toneMarkers: event.target.value })} placeholder="语气标记，逗号分隔（可空）" className="h-7 min-w-36 flex-1 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
            <input value={draft.taboos} onChange={(event) => patchDraft({ taboos: event.target.value })} placeholder="禁忌，逗号分隔（可空）" className="h-7 min-w-36 flex-1 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
            <button type="button" disabled={archived || busy || draft.speaker.trim() === ''} onClick={() => void saveProfile(editingId, draft)} className="rounded-md bg-primary/10 px-2 py-1 text-[11px] text-primary disabled:opacity-40">{editingId !== undefined ? '更新' : '添加'}</button>
            {editingId !== undefined && (
              <button type="button" onClick={() => { setEditingId(undefined); setDraft(EMPTY_DRAFT) }} className="rounded-md bg-foreground/[0.06] px-2 py-1 text-[11px]">取消编辑</button>
            )}
          </div>
        </div>
      </div>
    </details>
  )
}
