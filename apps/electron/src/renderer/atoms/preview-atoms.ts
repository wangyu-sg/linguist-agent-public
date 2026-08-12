/**
 * Preview Atoms — 内联预览/Diff 面板状态管理
 *
 * 每个 Agent 会话拥有独立的预览面板状态（选中文件、开关）。
 */

import { atom } from 'jotai'
import { atomFamily, atomWithStorage } from 'jotai/utils'
import type {
  LinguistCurrentStageStateCounts,
  LinguistSegmentStatusCounts,
} from '@proma/shared'
import { currentAgentSessionIdAtom } from './agent-atoms'

// ===== 类型定义 =====

/**
 * Linguist 预览目标（renderer 侧 opaque 描述符）。
 *
 * 只携带对象身份与展示元数据：projectId + assetId/docId 经 linguist IPC
 * 提交，路径/字节 authority 全部留在主进程围栏（previewAssetSource /
 * previewContextDoc 三态分派，零路径零字节过 IPC）。批次统计字段是打开
 * 时刻的展示快照（segment 数据本身经 linguist.cat.query 分页实时拉取）。
 */
export interface LinguistBatchPreviewTarget {
  kind: 'batch'
  projectId: string
  /** 批次（Batch）opaque id（存储层兼容命名 assetId）。 */
  assetId: string
  filename: string
  formatId: string
  segmentCount: number
  sourceLocale?: string
  targetLocale?: string
  segmentCounts?: LinguistSegmentStatusCounts
  currentStageCounts?: LinguistCurrentStageStateCounts
  openQaCount?: number
}

export interface LinguistContextDocPreviewTarget {
  kind: 'contextDoc'
  projectId: string
  /** contextDocs 行 opaque id。 */
  docId: string
  filename: string
}

/** 文件导入型 TM/TB 的受管原件；手工记录不生成此 target。 */
export interface LinguistReferenceImportPreviewTarget {
  kind: 'referenceImport'
  projectId: string
  importId: string
  filename: string
  referenceKind: 'tm' | 'terms'
}

/** 未确认 TM/TB 候选的临时原件；token 到期后只读预览自然失效。 */
export interface LinguistReferenceCandidatePreviewTarget {
  kind: 'referenceCandidate'
  projectId: string
  candidateId: string
  sourceSha256: string
  filename: string
  referenceKind: 'tm' | 'terms'
}

export type LinguistPreviewTarget =
  | LinguistBatchPreviewTarget
  | LinguistContextDocPreviewTarget
  | LinguistReferenceImportPreviewTarget
  | LinguistReferenceCandidatePreviewTarget

export function getLinguistPreviewTargetId(target: LinguistPreviewTarget): string {
  if (target.kind === 'batch') return target.assetId
  if (target.kind === 'contextDoc') return target.docId
  return target.kind === 'referenceImport' ? target.importId : target.candidateId
}

/** 当前预览的文件信息 */
export interface PreviewFile {
  filePath: string
  dirPath?: string
  gitRoot?: string
  /** true = 纯文件预览（不显示 diff 控件），false/undefined = diff 模式 */
  previewOnly?: boolean
  /** true = 预览只读，不允许从预览面板写回临时/源文件 */
  readOnly?: boolean
  /** 候选基础目录（用于相对路径解析） */
  basePaths?: string[]
  /** Workspace slug for a relocatable managed Skill path. */
  workspaceSkillSlug?: string
  /** Original absolute Skill entry path used only when the managed locator cannot resolve. */
  legacySkillFilePath?: string
  /** 文件是否落在当前会话的 diff scope 内（与 getUnstagedChanges 的 candidates 对齐） */
  inDiffScope?: boolean
  /** 基准 ref（如 "origin/main"），用于 worktree vs main 模式的 diff 对比 */
  baseRef?: string
  /**
   * Linguist 受管预览目标（批次、项目语言资产、TM/TB 文件导入来源）。存在时预览 Tab / 分屏改由
   * LinguistPreviewBody 渲染，filePath 仅作标题展示（批次为文件名，
   * 绝非本机路径），不进入 DiffTabContent 的文件读取链。
   */
  linguist?: LinguistPreviewTarget
}

// ===== Atoms =====

/** 每会话预览面板开关 */
export const previewPanelOpenMapAtom = atom<Map<string, boolean>>(new Map())

/** 每会话当前预览的文件（null 时显示 DiffChangesList） */
export const previewFileMapAtom = atom<Map<string, PreviewFile | null>>(new Map())

/** 分栏比例（对话占比），持久化 */
export const previewSplitRatioAtom = atomWithStorage<number>('proma-preview-split-ratio', 0.5, undefined, { getOnInit: true })

/**
 * 预览默认展开方式，持久化。
 * - 'tab'   = 以预览标签页形式打开（旧版默认）
 * - 'split' = 在主区域右侧分屏展开（可同时看到 Agent 输出与文件内容）
 *
 * 用户仍可通过拖拽 Tab 出区域、PreviewPanel 顶栏按钮等即时切换。
 */
export type PreviewModePreference = 'tab' | 'split'
export const previewModePreferenceAtom = atomWithStorage<PreviewModePreference>(
  'proma-preview-mode-pref',
  'tab',
  undefined,
  { getOnInit: true },
)

/** 代码预览换行偏好（默认不换行，保持现有横向滚动行为） */
export const previewCodeWrapAtom = atomWithStorage<boolean>(
  'proma-preview-code-wrap',
  false,
  undefined,
  { getOnInit: true },
)

/** 当前会话的预览面板是否打开（derived） */
export const currentSessionPreviewOpenAtom = atom<boolean>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  if (!sessionId) return false
  return get(previewPanelOpenMapAtom).get(sessionId) ?? false
})

// ===== 引用选中文本（Quoted Selection）=====

/** 选中文本引用的来源 */
export type QuotedSelectionSourceType = 'file' | 'agent-history' | 'scratch-pad'

/** 从预览面板或 Agent 历史中选中的文本引用 */
export interface QuotedSelection {
  /** 选中的文本内容 */
  text: string
  /** 来源文件路径；历史引用时作为兼容展示字段 */
  filePath: string
  /** 引用来源类型 */
  sourceType?: QuotedSelectionSourceType
  /** 面向用户展示的来源名称 */
  sourceLabel?: string
  /** Agent 历史消息 ID */
  messageId?: string
  /** Agent 历史消息角色 */
  messageRole?: 'user' | 'assistant' | 'system'
  /** 起始行号（1-based，代码文件可计算，markdown 等无法计算时为 undefined） */
  startLine?: number
  /** 结束行号（1-based） */
  endLine?: number
  /** Agent 历史消息内选区的起始字符偏移（0-based） */
  selectionStart?: number
  /** Agent 历史消息内选区的结束字符偏移（0-based、exclusive） */
  selectionEnd?: number
  /** Agent 历史中的所属轮次（1-based；用户消息和对应回复共用同一轮） */
  turn?: number
  /** 捕获时间戳 */
  capturedAt: number
}

/** 每会话的引用选中文本 Map（每次新选中覆盖旧值） */
export const quotedSelectionMapAtom = atom<Map<string, QuotedSelection>>(new Map())

/** 当前会话的引用选中文本（派生） */
export const currentQuotedSelectionAtom = atom<QuotedSelection | null>((get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  if (!sessionId) return null
  return get(quotedSelectionMapAtom).get(sessionId) ?? null
})

/**
 * 指定会话的引用选中文本（session-scoped 派生）。
 *
 * AgentView 必须按自身 prop sessionId 读取引用：嵌入 Linguist Workbench 的
 * 项目 Agent 会话不等于全局 currentAgentSessionIdAtom（进入 Linguist 模式时
 * 全局 current 会被置空），按全局读取会导致「为 Agent 引用」chip 不显示。
 */
export const quotedSelectionAtomFamily = atomFamily((sessionId: string) =>
  atom<QuotedSelection | null>((get) => get(quotedSelectionMapAtom).get(sessionId) ?? null),
)
