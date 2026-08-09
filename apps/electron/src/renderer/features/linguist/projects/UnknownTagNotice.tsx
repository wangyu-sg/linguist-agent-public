/**
 * 未知 Tag 自动提示（K7）：导入新批次或项目内容变化后，主区顶部提示
 * 扫描到的未登记疑似 Tag，提供「查看 / 让 Agent 识别 / 忽略」三个出口。
 *
 * 候选只做软提示，批准后才进入编辑、建议、QA 与导出的硬规则——这条边界
 * 与 TagProfilesPanel 完全一致，本组件不另开第二套规则入口。
 */

import * as React from 'react'
import { atom, useAtom, useSetAtom, useStore } from 'jotai'
import type { createStore } from 'jotai/vanilla'
import { ScanSearch, X } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistUnknownTagPatternInfo } from '@proma/shared'
import {
  linguistProjectSettingsTabAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
} from './cat-workspace-atoms'
import { sendProjectAgentTask } from './project-agent-task'

type JotaiStore = ReturnType<typeof createStore>

/**
 * 当前扫描结果的稳定指纹：形状 + 频次排序拼接。
 * 「忽略」只针对当前指纹；之后出现新形状或频次变化会重新提示。
 */
export function unknownTagFingerprint(
  patterns: readonly LinguistUnknownTagPatternInfo[],
): string {
  return patterns
    .map((pattern) => `${pattern.patternShape}:${pattern.frequency}`)
    .sort()
    .join('|')
}

export function shouldShowUnknownTagNotice(input: {
  archived: boolean
  patterns: readonly LinguistUnknownTagPatternInfo[] | null
  dismissedFingerprint: string | undefined
}): boolean {
  const { archived, patterns, dismissedFingerprint } = input
  if (archived || patterns === null || patterns.length === 0) return false
  return unknownTagFingerprint(patterns) !== dismissedFingerprint
}

/** 「让 Agent 识别」任务措辞：候选由用户批准，Agent 不得直接启用硬保护。 */
const AGENT_TAG_RECOGNITION_TASK =
  '请识别当前项目里扫描到的未知 Tag 形状：先运行未知 Tag 扫描，逐类判断它是不是真实的格式 Tag。'
  + '真实的请整理成正则候选提交给我确认，误报请说明理由。'
  + '不要直接启用硬保护，候选由我批准后才生效。'

const dismissedFingerprintAtoms = new Map<
  string,
  ReturnType<typeof atom<string | undefined>>
>()

/** 「忽略」只存在于当前渲染会话，按 Project 隔离；重开应用后重新评估。 */
function unknownTagNoticeDismissedAtomFamily(
  projectId: string,
): ReturnType<typeof atom<string | undefined>> {
  const existing = dismissedFingerprintAtoms.get(projectId)
  if (existing !== undefined) return existing
  const created = atom<string | undefined>(undefined)
  dismissedFingerprintAtoms.set(projectId, created)
  return created
}

export function UnknownTagNotice({
  projectId,
  projectUpdatedAt,
  archived,
}: {
  projectId: string
  projectUpdatedAt: string
  archived: boolean
}): React.ReactElement | null {
  const store: JotaiStore = useStore()
  const setUiState = useSetAtom(linguistWorkbenchUiStateAtomFamily(projectId))
  const setSettingsTab = useSetAtom(linguistProjectSettingsTabAtomFamily(projectId))
  const [dismissedFingerprint, setDismissedFingerprint] = useAtom(
    unknownTagNoticeDismissedAtomFamily(projectId),
  )
  const [patterns, setPatterns] = React.useState<LinguistUnknownTagPatternInfo[] | null>(null)
  const [sending, setSending] = React.useState(false)

  React.useEffect(() => {
    if (archived) return
    let cancelled = false
    // notice 是增强提示：扫描失败静默降级，不打扰主流程。
    void window.electronAPI.linguistProjectsScanUnknownTags({ projectId, sampleLimit: 1 })
      .then((result) => {
        if (cancelled) return
        setPatterns(result.ok ? result.data : null)
      })
      .catch(() => {
        if (!cancelled) setPatterns(null)
      })
    return () => {
      cancelled = true
    }
  }, [archived, projectId, projectUpdatedAt])

  if (!shouldShowUnknownTagNotice({ archived, patterns, dismissedFingerprint })) {
    return null
  }
  const count = patterns!.length

  const openTagProfiles = (): void => {
    setSettingsTab('tags')
    setUiState({ projectSettingsOpen: true })
  }
  const askAgent = (): void => {
    if (sending) return
    setSending(true)
    void sendProjectAgentTask(store, projectId, AGENT_TAG_RECOGNITION_TASK)
      .then((result) => {
        if (result.status === 'error') {
          toast.error('发送识别任务失败', { description: result.error.message })
        } else if (result.status === 'selection-truncated') {
          toast.error('发送识别任务失败', { description: '当前片段选择过大，请缩小后重试' })
        }
      })
      .finally(() => setSending(false))
  }

  return (
    <div
      role="status"
      aria-label="未知 Tag 提示"
      className="mx-3 mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <ScanSearch aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0">
          发现 {count} 类未登记的疑似 Tag；批准后才会进入编辑与 QA 的硬保护。
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={openTagProfiles}
          className="rounded-md bg-foreground/[0.07] px-2 py-0.5 text-foreground hover:bg-foreground/[0.12]"
        >
          查看
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={askAgent}
          className="rounded-md bg-foreground/[0.07] px-2 py-0.5 text-foreground hover:bg-foreground/[0.12] disabled:opacity-45"
        >
          让 Agent 识别
        </button>
        <button
          type="button"
          aria-label="忽略本次提示"
          title="忽略本次提示；出现新形状时会重新提示"
          onClick={() => setDismissedFingerprint(unknownTagFingerprint(patterns!))}
          className="rounded-md p-1 text-foreground/60 hover:bg-foreground/[0.12]"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </span>
    </div>
  )
}
