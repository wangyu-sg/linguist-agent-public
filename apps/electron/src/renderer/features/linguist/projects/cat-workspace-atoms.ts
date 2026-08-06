import { atom } from 'jotai'
import type { createStore } from 'jotai/vanilla'
import {
  createLinguistTurnContextV1,
  type LinguistAssetInfo,
  type LinguistCurrentStageState,
  type LinguistQaFindingInfo,
  type LinguistTurnContextParseResult,
} from '@proma/shared'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import type { TargetEditorHandle } from './TargetEditor'

const BOTTOM_DOCK_TABS = [
  'tm',
  'terms',
  'qa',
  'context',
  'preview',
  'proposals',
  'delivery',
] as const

export type LinguistBottomDockTab = (typeof BOTTOM_DOCK_TABS)[number]
export type LinguistAgentPresentation = 'closed' | 'rail' | 'full'

export const ASSET_NAVIGATOR_MIN_WIDTH = 180
export const ASSET_NAVIGATOR_DEFAULT_WIDTH = 240
export const ASSET_NAVIGATOR_MAX_WIDTH = 420
export const AGENT_RAIL_MIN_WIDTH = 340
export const AGENT_RAIL_DEFAULT_WIDTH = 420
export const AGENT_RAIL_MAX_WIDTH = 520
export const BOTTOM_DOCK_MIN_HEIGHT = 160
export const BOTTOM_DOCK_DEFAULT_HEIGHT = 240
export const BOTTOM_DOCK_MAX_HEIGHT = 480

export function clampAssetNavigatorWidth(width: number): number {
  return Math.min(ASSET_NAVIGATOR_MAX_WIDTH, Math.max(ASSET_NAVIGATOR_MIN_WIDTH, width))
}

export function clampAgentRailWidth(width: number): number {
  return Math.min(AGENT_RAIL_MAX_WIDTH, Math.max(AGENT_RAIL_MIN_WIDTH, width))
}

export function clampBottomDockHeight(height: number): number {
  return Math.min(BOTTOM_DOCK_MAX_HEIGHT, Math.max(BOTTOM_DOCK_MIN_HEIGHT, height))
}

export interface LinguistWorkbenchUiState {
  schemaVersion: 1
  projectId: string
  activeAssetId?: string
  activeSegmentId?: string
  /** 同一项目内按资产保留最后活动段；只保存 opaque ID，不镜像 CAT 内容。 */
  assetActiveSegmentIds: Readonly<Record<string, string>>
  selectedSegmentIds: string[]
  search: string
  assetNavigatorSearch: string
  segmentStageStateFilter?: LinguistCurrentStageState
  qaFilter?: string
  assetNavigatorOpen: boolean
  assetNavigatorWidth: number
  bottomDockOpen: boolean
  bottomDockTab: LinguistBottomDockTab
  bottomDockHeight: number
  agentPresentation: LinguistAgentPresentation
  agentRailWidth: number
  projectSettingsOpen: boolean
  activeProjectAgentSessionId?: string
  lastVisitedAt: string
  uiRevision: number
}

export interface LinguistWorkbenchLocation {
  activeAssetId?: string
  activeSegmentId?: string
  assetNavigatorOpen?: boolean
  assetNavigatorWidth?: number
  agentPresentation?: LinguistAgentPresentation
  /** 仅用于读取旧 settings；序列化时统一写入 agentPresentation。 */
  agentRailOpen?: boolean
  agentRailWidth?: number
  bottomDockOpen?: boolean
  bottomDockTab?: LinguistBottomDockTab
  bottomDockHeight?: number
}

type WorkbenchUiStatePatch = Partial<
  Omit<
    LinguistWorkbenchUiState,
    'schemaVersion' | 'projectId' | 'lastVisitedAt' | 'uiRevision'
  >
>
type StoredWorkbenchUiState = Omit<
  LinguistWorkbenchUiState,
  'activeProjectAgentSessionId'
>

export type WorkbenchUiStateUpdate =
  | WorkbenchUiStatePatch
  | ((current: LinguistWorkbenchUiState) => WorkbenchUiStatePatch)

/**
 * 当前 TargetEditor 暴露给同项目 Bottom Dock 的短生命周期能力。
 * 这里只保存命令句柄和 opaque Segment ID，不镜像草稿或客户文本。
 */
export interface LinguistTargetEditorCapability {
  segmentId: string
  handle: TargetEditorHandle
}

/**
 * CAT Workspace 暴露给同项目 Bottom Dock 的短生命周期 QA 能力。
 * 这里只保存命令和刷新序号，不镜像 Finding 列表或正文。
 */
export interface LinguistQaFindingsCapability {
  jumpToFinding: (finding: LinguistQaFindingInfo) => void
  refreshAfterMutation: () => Promise<void>
  refreshToken: number
}

export function updateTargetEditorCapability(
  current: LinguistTargetEditorCapability | undefined,
  segmentId: string,
  handle: TargetEditorHandle | undefined,
): LinguistTargetEditorCapability | undefined {
  if (handle !== undefined) return { segmentId, handle }
  return current?.segmentId === segmentId ? undefined : current
}

export function clearQaFindingsCapability(
  current: LinguistQaFindingsCapability | undefined,
  expected: LinguistQaFindingsCapability,
): LinguistQaFindingsCapability | undefined {
  return current === expected ? undefined : current
}

function createWorkbenchUiState(projectId: string): StoredWorkbenchUiState {
  return {
    schemaVersion: 1,
    projectId,
    assetActiveSegmentIds: {},
    selectedSegmentIds: [],
    search: '',
    assetNavigatorSearch: '',
    assetNavigatorOpen: true,
    assetNavigatorWidth: ASSET_NAVIGATOR_DEFAULT_WIDTH,
    bottomDockOpen: true,
    bottomDockTab: 'tm',
    bottomDockHeight: BOTTOM_DOCK_DEFAULT_HEIGHT,
    agentPresentation: 'closed',
    agentRailWidth: AGENT_RAIL_DEFAULT_WIDTH,
    projectSettingsOpen: false,
    lastVisitedAt: new Date().toISOString(),
    uiRevision: 0,
  }
}

const workbenchUiStateByProjectAtom = atom<ReadonlyMap<string, StoredWorkbenchUiState>>(
  new Map(),
)

function getLocation(value: unknown): LinguistWorkbenchLocation | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const activeAssetId = typeof raw.activeAssetId === 'string' && raw.activeAssetId.length > 0
    ? raw.activeAssetId
    : undefined
  const activeSegmentId = typeof raw.activeSegmentId === 'string' && raw.activeSegmentId.length > 0
    ? raw.activeSegmentId
    : undefined
  const assetNavigatorOpen = typeof raw.assetNavigatorOpen === 'boolean'
    ? raw.assetNavigatorOpen
    : undefined
  const assetNavigatorWidth = typeof raw.assetNavigatorWidth === 'number'
    && Number.isFinite(raw.assetNavigatorWidth)
    ? clampAssetNavigatorWidth(raw.assetNavigatorWidth)
    : undefined
  const agentPresentation = raw.agentPresentation === 'closed'
    || raw.agentPresentation === 'rail'
    || raw.agentPresentation === 'full'
    ? raw.agentPresentation
    : typeof raw.agentRailOpen === 'boolean'
      ? raw.agentRailOpen ? 'rail' : 'closed'
      : undefined
  const agentRailWidth = typeof raw.agentRailWidth === 'number' && Number.isFinite(raw.agentRailWidth)
    ? clampAgentRailWidth(raw.agentRailWidth)
    : undefined
  const bottomDockOpen = typeof raw.bottomDockOpen === 'boolean' ? raw.bottomDockOpen : undefined
  const bottomDockTab = typeof raw.bottomDockTab === 'string'
    && BOTTOM_DOCK_TABS.includes(raw.bottomDockTab as LinguistBottomDockTab)
    ? raw.bottomDockTab as LinguistBottomDockTab
    : undefined
  const bottomDockHeight = typeof raw.bottomDockHeight === 'number'
    && Number.isFinite(raw.bottomDockHeight)
    ? clampBottomDockHeight(raw.bottomDockHeight)
    : undefined
  if (
    activeAssetId === undefined
    && activeSegmentId === undefined
    && assetNavigatorOpen === undefined
    && assetNavigatorWidth === undefined
    && agentPresentation === undefined
    && agentRailWidth === undefined
    && bottomDockOpen === undefined
    && bottomDockTab === undefined
    && bottomDockHeight === undefined
  ) {
    return null
  }
  return {
    ...(activeAssetId !== undefined ? { activeAssetId } : {}),
    ...(activeSegmentId !== undefined ? { activeSegmentId } : {}),
    ...(assetNavigatorOpen !== undefined ? { assetNavigatorOpen } : {}),
    ...(assetNavigatorWidth !== undefined ? { assetNavigatorWidth } : {}),
    ...(agentPresentation !== undefined ? { agentPresentation } : {}),
    ...(agentRailWidth !== undefined ? { agentRailWidth } : {}),
    ...(bottomDockOpen !== undefined ? { bottomDockOpen } : {}),
    ...(bottomDockTab !== undefined ? { bottomDockTab } : {}),
    ...(bottomDockHeight !== undefined ? { bottomDockHeight } : {}),
  }
}

/** 从 settings.json 读取位置与布局偏好；不信任磁盘中的项目、实体 ID 或宽度。 */
export function parseLinguistWorkbenchLocations(
  value: unknown,
): ReadonlyMap<string, LinguistWorkbenchLocation> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map()
  const locations = new Map<string, LinguistWorkbenchLocation>()
  for (const [projectId, rawLocation] of Object.entries(value as Record<string, unknown>)) {
    if (projectId.length === 0) continue
    const location = getLocation(rawLocation)
    if (location !== null) locations.set(projectId, location)
  }
  return locations
}

/** 只持久化可恢复位置与布局，不将 CAT 内容或临时筛选状态写入 settings。 */
export function serializeLinguistWorkbenchLocations(
  states: ReadonlyMap<string, LinguistWorkbenchLocation>,
): Record<string, LinguistWorkbenchLocation> {
  const locations: Record<string, LinguistWorkbenchLocation> = {}
  for (const [projectId, state] of states) {
    const location = getLocation(state)
    if (projectId.length > 0 && location !== null) locations[projectId] = location
  }
  return locations
}

/** CAT 真源加载后清除不存在的恢复位置，绝不替换为猜测 ID。 */
export function getInvalidLinguistWorkbenchLocationPatch(
  location: LinguistWorkbenchLocation,
  assetIds: ReadonlySet<string>,
  segmentIds: ReadonlySet<string>,
): LinguistWorkbenchLocation | null {
  if (location.activeAssetId !== undefined && !assetIds.has(location.activeAssetId)) {
    return { activeAssetId: undefined, activeSegmentId: undefined }
  }
  if (location.activeSegmentId !== undefined && !segmentIds.has(location.activeSegmentId)) {
    return { activeSegmentId: undefined }
  }
  return null
}

export const linguistWorkbenchLocationsAtom = atom((get) =>
  serializeLinguistWorkbenchLocations(get(workbenchUiStateByProjectAtom)),
)

/** 启动时回填位置；已有运行期状态优先，避免异步恢复覆盖用户操作。 */
export const restoreLinguistWorkbenchLocationsAtom = atom(
  null,
  (get, set, value: unknown) => {
    const locations = parseLinguistWorkbenchLocations(value)
    if (locations.size === 0) return
    const current = get(workbenchUiStateByProjectAtom)
    const next = new Map(current)
    for (const [projectId, location] of locations) {
      if (next.has(projectId)) continue
      next.set(projectId, { ...createWorkbenchUiState(projectId), ...location })
    }
    set(workbenchUiStateByProjectAtom, next)
  },
)

/**
 * LF-040：所有 Workbench 交互状态以 Project ID 分区。
 * Segment 内容、状态和 revision 等真相仍只来自主进程 CatStore。
 */
function createProjectWorkbenchUiStateAtom(projectId: string) {
  const initialState = createWorkbenchUiState(projectId)
  return atom(
    (get): LinguistWorkbenchUiState => ({
      ...(get(workbenchUiStateByProjectAtom).get(projectId) ?? initialState),
      activeProjectAgentSessionId: get(projectCurrentAgentSessionIdMapAtom).get(projectId),
    }),
    (get, set, update: WorkbenchUiStateUpdate) => {
      const currentStored = get(workbenchUiStateByProjectAtom).get(projectId) ?? initialState
      const current: LinguistWorkbenchUiState = {
        ...currentStored,
        activeProjectAgentSessionId: get(projectCurrentAgentSessionIdMapAtom).get(projectId),
      }
      const patch = typeof update === 'function' ? update(current) : update
      const { activeProjectAgentSessionId: nextSessionId, ...storedPatch } = patch
      if (Object.prototype.hasOwnProperty.call(patch, 'activeProjectAgentSessionId')) {
        set(projectCurrentAgentSessionIdMapAtom, (sessions) => {
          const updated = new Map(sessions)
          if (nextSessionId) updated.set(projectId, nextSessionId)
          else updated.delete(projectId)
          return updated
        })
      }
      const next: StoredWorkbenchUiState = {
        ...currentStored,
        ...storedPatch,
        assetNavigatorWidth: clampAssetNavigatorWidth(
          storedPatch.assetNavigatorWidth ?? currentStored.assetNavigatorWidth,
        ),
        agentRailWidth: clampAgentRailWidth(
          storedPatch.agentRailWidth ?? currentStored.agentRailWidth,
        ),
        bottomDockHeight: clampBottomDockHeight(
          storedPatch.bottomDockHeight ?? currentStored.bottomDockHeight,
        ),
        schemaVersion: 1,
        projectId,
        lastVisitedAt: new Date().toISOString(),
        uiRevision: Math.min(Number.MAX_SAFE_INTEGER, currentStored.uiRevision + 1),
      }
      set(workbenchUiStateByProjectAtom, (states) => {
        const updated = new Map(states)
        updated.set(projectId, next)
        return updated
      })
    },
  )
}

const workbenchUiStateAtoms = new Map<
  string,
  ReturnType<typeof createProjectWorkbenchUiStateAtom>
>()

export function linguistWorkbenchUiStateAtomFamily(
  projectId: string,
): ReturnType<typeof createProjectWorkbenchUiStateAtom> {
  const existing = workbenchUiStateAtoms.get(projectId)
  if (existing !== undefined) return existing
  const created = createProjectWorkbenchUiStateAtom(projectId)
  workbenchUiStateAtoms.set(projectId, created)
  return created
}

const targetEditorCapabilityAtoms = new Map<
  string,
  ReturnType<typeof atom<LinguistTargetEditorCapability | undefined>>
>()
const qaFindingsCapabilityAtoms = new Map<
  string,
  ReturnType<typeof atom<LinguistQaFindingsCapability | undefined>>
>()

/**
 * LF-051：按 Project 隔离、仅存在于当前渲染会话的编辑能力 seam。
 * 不进入 Workbench settings 持久化，也不参与 Turn Context snapshot。
 */
export function linguistTargetEditorCapabilityAtomFamily(
  projectId: string,
): ReturnType<typeof atom<LinguistTargetEditorCapability | undefined>> {
  const existing = targetEditorCapabilityAtoms.get(projectId)
  if (existing !== undefined) return existing
  const created = atom<LinguistTargetEditorCapability | undefined>(undefined)
  targetEditorCapabilityAtoms.set(projectId, created)
  return created
}

/** LF-053：按 Project 隔离、仅存在于当前渲染会话的 QA 命令 seam。 */
export function linguistQaFindingsCapabilityAtomFamily(
  projectId: string,
): ReturnType<typeof atom<LinguistQaFindingsCapability | undefined>> {
  const existing = qaFindingsCapabilityAtoms.get(projectId)
  if (existing !== undefined) return existing
  const created = atom<LinguistQaFindingsCapability | undefined>(undefined)
  qaFindingsCapabilityAtoms.set(projectId, created)
  return created
}

// ===== 显式「为 Agent 引用」片段（问题 12：替代隐式 active-segment scope）=====

export interface LinguistSegmentAgentReference {
  segmentId: string
  assetId: string
  capturedAt: number
}

const segmentAgentReferenceAtoms = new Map<
  string,
  ReturnType<typeof atom<LinguistSegmentAgentReference | undefined>>
>()

/** 显式引用只存在于当前渲染会话，按 Project 隔离且不进入 Workbench settings。 */
export function linguistSegmentAgentReferenceAtomFamily(
  projectId: string,
): ReturnType<typeof atom<LinguistSegmentAgentReference | undefined>> {
  const existing = segmentAgentReferenceAtoms.get(projectId)
  if (existing !== undefined) return existing
  const created = atom<LinguistSegmentAgentReference | undefined>(undefined)
  segmentAgentReferenceAtoms.set(projectId, created)
  return created
}

export function getLinguistWorkbenchAtomFamilyCacheSizes(): {
  workbench: number
  targetEditor: number
  qaFindings: number
  segmentAgentReference: number
} {
  return {
    workbench: workbenchUiStateAtoms.size,
    targetEditor: targetEditorCapabilityAtoms.size,
    qaFindings: qaFindingsCapabilityAtoms.size,
    segmentAgentReference: segmentAgentReferenceAtoms.size,
  }
}

export const disposeLinguistWorkbenchAtomFamiliesAtom = atom(
  null,
  (_get, set, projectId: string) => {
    const capabilityAtom = targetEditorCapabilityAtoms.get(projectId)
    if (capabilityAtom !== undefined) set(capabilityAtom, undefined)
    const qaCapabilityAtom = qaFindingsCapabilityAtoms.get(projectId)
    if (qaCapabilityAtom !== undefined) set(qaCapabilityAtom, undefined)
    const segmentReferenceAtom = segmentAgentReferenceAtoms.get(projectId)
    if (segmentReferenceAtom !== undefined) set(segmentReferenceAtom, undefined)
    targetEditorCapabilityAtoms.delete(projectId)
    qaFindingsCapabilityAtoms.delete(projectId)
    segmentAgentReferenceAtoms.delete(projectId)
    workbenchUiStateAtoms.delete(projectId)
  },
)

/**
 * 显式引用给 Agent 的片段（每项目单槽最新值，仅内存态，不持久化）。
 *
 * 写入方只有 SegmentGrid 行的「为 Agent 引用」动作；键盘焦点、虚拟列表首行、
 * 自动恢复编辑位置都不会触碰该 atom，Agent 默认只有 Project + Batch scope。
 * ProjectAgentRail 与 turn snapshot 都从同一 project-scoped atom 读取。
 */
/** 仅当被引用片段属于当前项目批次时才对 Agent 可见；否则视为其他项目的残留引用。 */
export function resolveVisibleSegmentAgentReference(
  reference: LinguistSegmentAgentReference | undefined,
  assets: readonly LinguistAssetInfo[],
): LinguistSegmentAgentReference | undefined {
  if (!reference) return undefined
  return assets.some((asset) => asset.assetId === reference.assetId) ? reference : undefined
}

/** 「为 Agent 引用」行动作的共享写入入口（SegmentGrid 复用）。 */
export function createSegmentAgentReference(
  segmentId: string,
  assetId: string,
  capturedAt = Date.now(),
): LinguistSegmentAgentReference {
  return { segmentId, assetId, capturedAt }
}

/**
 * LF-062：发送点击的唯一 Workbench snapshot seam。
 * 同一 Project atom 同时服务 Rail 与 Full Agent；共享构建器负责截断和深冻结。
 * 问题 12：segment scope 只来自显式「为 Agent 引用」的项目 scoped atom，
 * 键盘/编辑焦点的 activeSegmentId 不得偷渡进 Agent turn context。
 */
export function captureLinguistTurnContextSnapshot(
  store: ReturnType<typeof createStore>,
  projectId: string,
  capturedAt = new Date().toISOString(),
): LinguistTurnContextParseResult {
  const state = store.get(linguistWorkbenchUiStateAtomFamily(projectId))
  const segmentReference = store.get(linguistSegmentAgentReferenceAtomFamily(projectId))
  const assetId = segmentReference?.assetId ?? state.activeAssetId
  const selectedSegmentIds = segmentReference !== undefined
    && segmentReference.assetId !== state.activeAssetId
    ? []
    : state.selectedSegmentIds
  return createLinguistTurnContextV1({
    projectId,
    ...(assetId !== undefined ? { assetId } : {}),
    ...(segmentReference !== undefined
      ? { activeSegmentId: segmentReference.segmentId }
      : {}),
    selectedSegmentIds,
    capturedAt,
    uiRevision: state.uiRevision,
  })
}

export const clearLinguistWorkbenchUiStateAtom = atom(
  null,
  (_get, set, projectId: string) => {
    set(workbenchUiStateByProjectAtom, (states) => {
      if (!states.has(projectId)) return states
      const updated = new Map(states)
      updated.delete(projectId)
      return updated
    })
    set(disposeLinguistWorkbenchAtomFamiliesAtom, projectId)
  },
)
