import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AlertTriangle, Loader2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import type {
  LinguistAssetMetadata,
  LinguistCurrentStageState,
  LinguistIpcError,
  LinguistProposalInfo,
  LinguistQaFindingInfo,
  LinguistSegmentInfo,
  LinguistWorkflowStage,
} from '@proma/shared'
import {
  clearQaFindingsCapability,
  getInvalidLinguistWorkbenchLocationPatch,
  linguistQaFindingsCapabilityAtomFamily,
  linguistTargetEditorCapabilityAtomFamily,
  linguistWorkbenchUiStateAtomFamily,
  updateTargetEditorCapability,
} from './cat-workspace-atoms'
import {
  findNextEditableRow,
  mergeIndexedPage,
  nextSegmentId,
  pageOffsetsForRange,
} from './cat-virtual-utils'
import type { TargetSaveResult } from './cat-edit-utils'
import type { TargetEditorHandle } from './TargetEditor'
import { SegmentGrid } from './SegmentGrid'
import { describeLinguistIpcError } from './project-utils'
import {
  bulkProposalReviewConfirmation,
  isProposalConflictCode,
  proposalMutationPlan,
  proposalReviewBlock,
} from './proposal-inbox-utils'
import {
  summarizeOpenQaFindingsBySegment,
  type SegmentQaSummary,
} from './qa-findings-utils'
import {
  affectedLoadedPageOffsets,
  getProjectMutationRefreshPlan,
  linguistProjectMutationStateAtomFamily,
} from './project-mutation-atoms'
import {
  nextStageItemLabel,
  stageActionLabel,
  stageBulkConfirmationSummary,
  stageFilterOptions,
} from './workflow-ui'

const PAGE_SIZE = 200

interface Dataset {
  signature: string
  assets: LinguistAssetMetadata[]
  total: number
  segmentIds: string[]
  rows: ReadonlyMap<number, LinguistSegmentInfo>
}

type QueryState =
  | { status: 'loading' }
  | { status: 'error'; error: LinguistIpcError }
  | { status: 'ready'; data: Dataset }

interface VisibleRange {
  start: number
  end: number
}

export function SegmentEditor({
  projectId,
  archived,
  workflowStage,
  onProjectSummaryInvalidated,
}: {
  projectId: string
  archived: boolean
  workflowStage: LinguistWorkflowStage
  onProjectSummaryInvalidated?: () => void
}): React.ReactElement {
  const [workbenchUiState, setWorkbenchUiState] = useAtom(
    linguistWorkbenchUiStateAtomFamily(projectId),
  )
  const setTargetEditorCapability = useSetAtom(
    linguistTargetEditorCapabilityAtomFamily(projectId),
  )
  const setQaFindingsCapability = useSetAtom(
    linguistQaFindingsCapabilityAtomFamily(projectId),
  )
  const projectMutationState = useAtomValue(
    linguistProjectMutationStateAtomFamily(projectId),
  )
  const mutationRefreshPlan = getProjectMutationRefreshPlan(projectMutationState)
  const filters = React.useMemo(() => ({
    assetId: workbenchUiState.activeAssetId,
    currentStageState: workbenchUiState.segmentStageStateFilter,
    search: workbenchUiState.search,
  }), [
    workbenchUiState.activeAssetId,
    workbenchUiState.search,
    workbenchUiState.segmentStageStateFilter,
  ])
  const selectedIds = React.useMemo(
    () => new Set(workbenchUiState.selectedSegmentIds),
    [workbenchUiState.selectedSegmentIds],
  )
  const activeSegmentId = workbenchUiState.activeSegmentId
  const setActiveSegmentId = React.useCallback((segmentId: string | undefined, assetId?: string): void => {
    setWorkbenchUiState((current) => ({
      activeSegmentId: segmentId,
      assetActiveSegmentIds: segmentId === undefined || assetId === undefined
        ? current.assetActiveSegmentIds
        : { ...current.assetActiveSegmentIds, [assetId]: segmentId },
    }))
  }, [setWorkbenchUiState])
  const [state, setState] = React.useState<QueryState>({ status: 'loading' })
  const [pendingBySegment, setPendingBySegment] = React.useState<ReadonlyMap<string, LinguistProposalInfo>>(new Map())
  const [mutatingProposalIds, setMutatingProposalIds] = React.useState<ReadonlySet<string>>(new Set())
  const [bulkMutating, setBulkMutating] = React.useState<'accept' | 'reject'>()
  const [stageBulkMutating, setStageBulkMutating] = React.useState(false)
  const [pendingFocusIndex, setPendingFocusIndex] = React.useState<number>()
  const [requestedSegmentId, setRequestedSegmentId] = React.useState<string>()
  const [visibleRange, setVisibleRange] = React.useState<VisibleRange>()
  const [retryToken, setRetryToken] = React.useState(0)
  const [qaOpenCount, setQaOpenCount] = React.useState<number>()
  const [qaBySegment, setQaBySegment] = React.useState<ReadonlyMap<string, SegmentQaSummary>>()
  const [qaRefreshToken, setQaRefreshToken] = React.useState(0)
  const loadingOffsets = React.useRef(new Set<number>())
  const handledMutationRevisions = React.useRef(new Map<string, number>())
  const stageMutatingSegmentIds = React.useRef(new Set<string>())
  const deferredSearch = React.useDeferredValue(filters.search)
  const signature = `${projectId}\0${filters.assetId ?? ''}\0${filters.currentStageState ?? ''}\0${deferredSearch}`
  const data = state.status === 'ready' ? state.data : undefined
  const selectedPendingIds = [...selectedIds].filter((id) => pendingBySegment.has(id))
  const updateEditorCapability = React.useCallback((
    segmentId: string,
    handle: TargetEditorHandle | undefined,
  ): void => {
    setTargetEditorCapability((current) =>
      updateTargetEditorCapability(current, segmentId, handle))
  }, [setTargetEditorCapability])

  const loadPending = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.linguistProposalsListPending({ projectId })
      setPendingBySegment(result.ok
        ? new Map(result.data.map((proposal) => [proposal.segmentId, proposal]))
        : new Map())
    } catch {
      setPendingBySegment(new Map())
    }
  }, [projectId])

  const updateVisibleRange = React.useCallback((start: number, end: number): void => {
    setVisibleRange((current) => (
      current?.start === start && current.end === end ? current : { start, end }
    ))
  }, [])

  const queryPage = React.useCallback(
    (offset: number, includeIndex: boolean) =>
      window.electronAPI.linguistCatQuery({
        projectId,
        assetId: filters.assetId,
        currentStageState: filters.currentStageState,
        search: deferredSearch || undefined,
        limit: PAGE_SIZE,
        offset,
        includeIndex,
      }),
    [deferredSearch, filters.assetId, filters.currentStageState, projectId],
  )

  React.useEffect(() => {
    let cancelled = false
    loadingOffsets.current.clear()
    setVisibleRange(undefined)
    setState({ status: 'loading' })
    void queryPage(0, true)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setState({ status: 'error', error: result.error })
          return
        }
        setState({
          status: 'ready',
          data: {
            signature,
            assets: result.data.assets,
            total: result.data.total,
            segmentIds: result.data.segmentIds,
            rows: mergeIndexedPage(new Map(), 0, result.data.segments),
          },
        })
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: { code: 'INTERNAL', message: '与主进程通信异常' },
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [queryPage, retryToken, signature])

  React.useEffect(() => {
    if (data === undefined || data.signature !== signature) return
    const patch = getInvalidLinguistWorkbenchLocationPatch(
      workbenchUiState,
      new Set(data.assets.map((asset) => asset.assetId)),
      new Set(data.segmentIds),
    )
    if (patch !== null) setWorkbenchUiState(patch)
  }, [data, setWorkbenchUiState, signature, workbenchUiState])

  React.useEffect(() => {
    if (
      data === undefined ||
      data.signature !== signature ||
      visibleRange === undefined
    ) return
    const offsets = pageOffsetsForRange(visibleRange.start, visibleRange.end, PAGE_SIZE).filter(
      (offset) => !data.rows.has(offset) && !loadingOffsets.current.has(offset),
    )
    if (offsets.length === 0) return
    for (const offset of offsets) loadingOffsets.current.add(offset)
    void Promise.all(offsets.map(async (offset) => ({ offset, result: await queryPage(offset, false) })))
      .then((pages) => {
        const failed = pages.find((page) => !page.result.ok)
        if (failed !== undefined && !failed.result.ok) {
          setState({ status: 'error', error: failed.result.error })
          return
        }
        setState((current) => {
          if (current.status !== 'ready' || current.data.signature !== signature) return current
          let rows = new Map(current.data.rows)
          for (const page of pages) {
            if (!page.result.ok) continue
            rows = mergeIndexedPage(rows, page.offset, page.result.data.segments)
          }
          return rows.size === 0
            ? current
            : { status: 'ready', data: { ...current.data, rows } }
        })
      })
      .catch(() => {
        setState({
          status: 'error',
          error: { code: 'INTERNAL', message: '与主进程通信异常' },
        })
      })
      .finally(() => {
        for (const offset of offsets) loadingOffsets.current.delete(offset)
      })
  }, [data, queryPage, signature, visibleRange])

  React.useEffect(() => {
    void loadPending()
  }, [loadPending])

  const refreshQaSummary = React.useCallback(async (): Promise<void> => {
    try {
      const findings: LinguistQaFindingInfo[] = []
      let offset = 0
      let hasMore = true
      while (hasMore) {
        const result = await window.electronAPI.linguistCatListQaFindings({
          projectId,
          status: 'open',
          limit: PAGE_SIZE,
          offset,
        })
        if (!result.ok || (result.data.hasMore && result.data.items.length === 0)) {
          setQaOpenCount(undefined)
          setQaBySegment(undefined)
          return
        }
        findings.push(...result.data.items)
        hasMore = result.data.hasMore
        offset += result.data.items.length
      }
      setQaOpenCount(findings.length)
      setQaBySegment(summarizeOpenQaFindingsBySegment(findings))
    } catch {
      setQaOpenCount(undefined)
      setQaBySegment(undefined)
    }
  }, [projectId])

  React.useEffect(() => {
    void refreshQaSummary()
  }, [refreshQaSummary])

  const updateFilters = (patch: Partial<typeof filters>): void => {
    setWorkbenchUiState((current) => ({
      activeAssetId: 'assetId' in patch ? patch.assetId : current.activeAssetId,
      segmentStageStateFilter: 'currentStageState' in patch
        ? patch.currentStageState
        : current.segmentStageStateFilter,
      search: patch.search ?? current.search,
    }))
  }

  const focusRow = React.useCallback((index: number): void => {
    if (data === undefined || index < 0 || index >= data.total) return
    const segment = data.rows.get(index)
    setActiveSegmentId(data.segmentIds[index], segment?.assetId)
    setPendingFocusIndex(index)
  }, [data, setActiveSegmentId])

  const goToNextUntouched = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.linguistCatQuery({
        projectId,
        assetId: filters.assetId,
        currentStageState: 'untouched',
        search: deferredSearch || undefined,
        limit: 1,
        offset: 0,
        includeIndex: true,
      })
      if (!result.ok) {
        toast.error('无法定位本轮待处理片段', { description: describeLinguistIpcError(result.error) })
        return
      }
      const segmentId = nextSegmentId(result.data.segmentIds, activeSegmentId)
      if (segmentId === undefined) {
        toast.info('当前范围没有本轮待处理片段')
        return
      }
      const index = data?.segmentIds.indexOf(segmentId) ?? -1
      if (index >= 0) {
        focusRow(index)
        return
      }
      setWorkbenchUiState({ segmentStageStateFilter: undefined })
      setActiveSegmentId(segmentId)
      setRequestedSegmentId(segmentId)
    } catch {
      toast.error('无法定位本轮待处理片段', { description: '与主进程通信异常（INTERNAL）' })
    }
  }, [
    activeSegmentId,
    data?.segmentIds,
    deferredSearch,
    filters.assetId,
    focusRow,
    projectId,
    setActiveSegmentId,
    setWorkbenchUiState,
  ])

  React.useEffect(() => {
    if (requestedSegmentId === undefined || data === undefined) return
    const index = data.segmentIds.indexOf(requestedSegmentId)
    if (index < 0) return
    setRequestedSegmentId(undefined)
    focusRow(index)
  }, [data, focusRow, requestedSegmentId])

  React.useEffect(() => {
    if (activeSegmentId === undefined || data?.signature !== signature) return
    const index = data.segmentIds.indexOf(activeSegmentId)
    if (index >= 0) setPendingFocusIndex(index)
  }, [activeSegmentId, data, signature])

  const jumpToQaSegment = React.useCallback((segmentId: string): void => {
    const index = data?.segmentIds.indexOf(segmentId) ?? -1
    if (index >= 0) {
      focusRow(index)
      return
    }
    setWorkbenchUiState({
      activeAssetId: undefined,
      segmentStageStateFilter: undefined,
      search: '',
    })
    setActiveSegmentId(segmentId)
    setRequestedSegmentId(segmentId)
  }, [data?.segmentIds, focusRow, setActiveSegmentId, setWorkbenchUiState])

  const jumpToQaFinding = React.useCallback((finding: LinguistQaFindingInfo): void => {
    jumpToQaSegment(finding.segmentId)
  }, [jumpToQaSegment])

  const goToNextQa = React.useCallback((): void => {
    if (qaOpenCount === undefined || qaOpenCount === 0) {
      toast.info(qaOpenCount === 0 ? '当前没有待处理 QA Finding' : '请先运行 QA')
      return
    }
    const segmentIds = [...(qaBySegment?.keys() ?? [])]
    if (segmentIds.length === 0) {
      setQaOpenCount(0)
      toast.info('当前没有待处理 QA Finding')
      return
    }
    const currentIndex = activeSegmentId === undefined
      ? -1
      : segmentIds.indexOf(activeSegmentId)
    jumpToQaSegment(segmentIds[(currentIndex + 1) % segmentIds.length]!)
  }, [activeSegmentId, jumpToQaSegment, qaBySegment, qaOpenCount])

  const openSegmentDock = React.useCallback((
    segmentId: string,
    assetId: string,
    tab: 'context' | 'qa',
  ): void => {
    setWorkbenchUiState((current) => ({
      activeSegmentId: segmentId,
      assetActiveSegmentIds: {
        ...current.assetActiveSegmentIds,
        [assetId]: segmentId,
      },
      bottomDockOpen: true,
      bottomDockTab: tab,
    }))
  }, [setWorkbenchUiState])

  const toggleSelected = (segmentId: string): void => {
    setWorkbenchUiState((current) => {
      const next = new Set(current.selectedSegmentIds)
      if (next.has(segmentId)) next.delete(segmentId)
      else next.add(segmentId)
      return { selectedSegmentIds: [...next] }
    })
  }

  const loadPageAt = React.useCallback(async (index: number) => {
    const offset = Math.floor(index / PAGE_SIZE) * PAGE_SIZE
    const result = await queryPage(offset, false)
    if (!result.ok) return undefined
    setState((current) => current.status === 'ready' && current.data.signature === signature
      ? {
          status: 'ready',
          data: {
            ...current.data,
            rows: mergeIndexedPage(current.data.rows, offset, result.data.segments),
          },
        }
      : current)
    return { offset, segments: result.data.segments }
  }, [queryPage, signature])

  const refreshPage = React.useCallback(async (index: number): Promise<boolean> => (
    (await loadPageAt(index)) !== undefined
  ), [loadPageAt])

  const reloadTarget = React.useCallback(async (
    segmentId: string,
    index: number,
  ): Promise<LinguistSegmentInfo | undefined> => {
    try {
      const result = await window.electronAPI.linguistCatGetContext({
        projectId,
        segmentId,
      })
      if (!result.ok) {
        toast.error('无法重新加载译文', { description: describeLinguistIpcError(result.error) })
        return undefined
      }
      const segment = result.data.segment
      setState((current) => {
        if (current.status !== 'ready' || current.data.signature !== signature) return current
        const rows = new Map(current.data.rows)
        rows.set(index, segment)
        return { status: 'ready', data: { ...current.data, rows } }
      })
      return segment
    } catch {
      toast.error('无法重新加载译文', { description: '与主进程通信异常（INTERNAL）' })
      return undefined
    }
  }, [projectId, signature])

  const refreshCurrentPage = React.useCallback(async (): Promise<boolean> => {
    const offset = Math.floor((visibleRange?.start ?? 0) / PAGE_SIZE) * PAGE_SIZE
    const result = await queryPage(offset, true)
    if (!result.ok) return false
    setState((current) => current.status === 'ready' && current.data.signature === signature
      ? {
          status: 'ready',
          data: {
            signature,
            assets: result.data.assets,
            total: result.data.total,
            segmentIds: result.data.segmentIds,
            rows: mergeIndexedPage(new Map(), offset, result.data.segments),
          },
        }
      : current)
    return true
  }, [queryPage, signature, visibleRange?.start])

  React.useEffect(() => {
    const lastHandledRevision = handledMutationRevisions.current.get(projectId)
    if (lastHandledRevision === undefined) {
      handledMutationRevisions.current.set(projectId, projectMutationState.lastRevision)
      return
    }
    if (projectMutationState.latest === undefined) return
    if (projectMutationState.lastRevision <= lastHandledRevision) return
    handledMutationRevisions.current.set(projectId, projectMutationState.lastRevision)
    const refresh = (request: Promise<boolean>): void => {
      const showError = (): void => {
        toast.error('项目变更刷新失败', { description: '请稍后重试或重新打开项目。' })
      }
      void request.then((ok) => {
        if (!ok) showError()
      }).catch(showError)
    }
    if (mutationRefreshPlan.proposals) void loadPending()
    if (mutationRefreshPlan.qa) {
      void refreshQaSummary()
      setQaRefreshToken((current) => current + 1)
    }
    if (mutationRefreshPlan.segments === 'current-page') {
      refresh(refreshCurrentPage())
      return
    }
    if (mutationRefreshPlan.segments !== 'affected-pages' || data === undefined) return
    if (filters.currentStageState !== undefined || deferredSearch.length > 0) {
      refresh(refreshCurrentPage())
      return
    }
    const offsets = affectedLoadedPageOffsets(
      mutationRefreshPlan.segmentIds,
      data.segmentIds,
      data.rows,
      PAGE_SIZE,
    )
    refresh(Promise.all(offsets.map((offset) => refreshPage(offset)))
      .then((results) => results.every(Boolean)))
  }, [
    data,
    deferredSearch.length,
    filters.currentStageState,
    loadPending,
    mutationRefreshPlan.proposals,
    mutationRefreshPlan.qa,
    mutationRefreshPlan.segmentIds,
    mutationRefreshPlan.segments,
    projectId,
    projectMutationState.lastRevision,
    projectMutationState.latest,
    refreshCurrentPage,
    refreshPage,
    refreshQaSummary,
  ])

  const saveTarget = React.useCallback(async (
    index: number,
    segment: LinguistSegmentInfo,
    target: string,
  ): Promise<TargetSaveResult> => {
    try {
      const result = await window.electronAPI.linguistCatEditSegment({
        projectId,
        segmentId: segment.id,
        target,
        expectedRevision: segment.revision,
      })
      if (!result.ok) {
        if (result.error.code === 'REVISION_CONFLICT') {
          toast.error('译文已被其他操作更新', { description: '草稿未覆盖最新内容，请选择冲突处理方式。' })
          return 'conflict'
        }
        toast.error('保存失败', { description: describeLinguistIpcError(result.error) })
        return 'failed'
      }
      if (filters.currentStageState !== undefined || deferredSearch.length > 0) {
        setQaRefreshToken((current) => current + 1)
        setRetryToken((current) => current + 1)
        onProjectSummaryInvalidated?.()
        toast.success('译文已保存')
        return 'saved'
      }
      setState((current) => {
        if (current.status !== 'ready') return current
        const rows = new Map(current.data.rows)
        rows.set(index, result.data)
        return { status: 'ready', data: { ...current.data, rows } }
      })
      setQaRefreshToken((current) => current + 1)
      onProjectSummaryInvalidated?.()
      toast.success('译文已保存')
      return 'saved'
    } catch {
      toast.error('保存失败', { description: '与主进程通信异常（INTERNAL）' })
      return 'failed'
    }
  }, [deferredSearch, filters.currentStageState, onProjectSummaryInvalidated, projectId])

  const updateLoadedSegment = React.useCallback((
    index: number,
    segment: LinguistSegmentInfo,
  ): void => {
    setState((current) => {
      if (current.status !== 'ready' || current.data.signature !== signature) return current
      const rows = new Map(current.data.rows)
      rows.set(index, segment)
      return { status: 'ready', data: { ...current.data, rows } }
    })
  }, [signature])

  const mutateCurrentStage = React.useCallback(async (
    index: number,
    segment: LinguistSegmentInfo,
    operation: 'confirm' | 'unconfirm',
  ): Promise<LinguistSegmentInfo | undefined> => {
    if (archived || stageMutatingSegmentIds.current.has(segment.id)) return undefined
    stageMutatingSegmentIds.current.add(segment.id)
    try {
      const context = await window.electronAPI.linguistCatGetContext({
        projectId,
        segmentId: segment.id,
      })
      if (!context.ok) {
        toast.error('阶段状态刷新失败', {
          description: describeLinguistIpcError(context.error),
        })
        return undefined
      }
      const latest = context.data.segment
      if (
        (operation === 'confirm' && latest.currentStageState === 'confirmed')
        || (operation === 'unconfirm' && latest.currentStageState !== 'confirmed')
      ) {
        updateLoadedSegment(index, latest)
        return latest
      }
      const input = {
        projectId,
        segmentId: latest.id,
        expectedRevision: latest.revision,
      }
      const result = operation === 'confirm'
        ? await window.electronAPI.linguistCatConfirmStage(input)
        : await window.electronAPI.linguistCatUnconfirmStage(input)
      if (!result.ok) {
        toast.error(operation === 'confirm' ? '确认当前阶段失败' : '撤销本轮确认失败', {
          description: describeLinguistIpcError(result.error),
        })
        return undefined
      }
      updateLoadedSegment(index, result.data)
      onProjectSummaryInvalidated?.()
      toast.success(
        operation === 'confirm'
          ? `${stageActionLabel(workflowStage)}成功`
          : '已撤销本轮确认',
      )
      return result.data
    } catch {
      toast.error(operation === 'confirm' ? '确认当前阶段失败' : '撤销本轮确认失败', {
        description: '与主进程通信异常（INTERNAL）',
      })
      return undefined
    } finally {
      stageMutatingSegmentIds.current.delete(segment.id)
    }
  }, [
    archived,
    onProjectSummaryInvalidated,
    projectId,
    updateLoadedSegment,
    workflowStage,
  ])

  const advanceToNextEditable = React.useCallback(async (
    index: number,
    assetId: string,
  ): Promise<void> => {
    if (archived || data === undefined) return
    let candidateRows = new Map(data.rows)
    let next = findNextEditableRow(candidateRows, index, assetId, data.total)
    try {
      while (next.kind === 'load') {
        const page = await loadPageAt(next.index)
        if (page === undefined) {
          toast.error('无法前进到下一片段', { description: '重新加载片段失败。' })
          return
        }
        candidateRows = mergeIndexedPage(candidateRows, page.offset, page.segments)
        if (!candidateRows.has(next.index)) {
          toast.info('当前批次和筛选范围内没有下一个可编辑片段')
          return
        }
        next = findNextEditableRow(candidateRows, index, assetId, data.total)
      }
    } catch {
      toast.error('无法前进到下一片段', { description: '与主进程通信异常（INTERNAL）' })
      return
    }
    if (next.kind === 'found') {
      focusRow(next.index)
      return
    }
    toast.info('当前批次和筛选范围内没有下一个可编辑片段')
  }, [archived, data, focusRow, loadPageAt])

  const confirmAndAdvance = React.useCallback(async (
    index: number,
    segment: LinguistSegmentInfo,
  ): Promise<void> => {
    const confirmed = await mutateCurrentStage(index, segment, 'confirm')
    if (confirmed === undefined) return
    await advanceToNextEditable(index, confirmed.assetId)
  }, [advanceToNextEditable, mutateCurrentStage])

  const unconfirmStage = React.useCallback(async (
    index: number,
    segment: LinguistSegmentInfo,
  ): Promise<void> => {
    await mutateCurrentStage(index, segment, 'unconfirm')
  }, [mutateCurrentStage])

  const refreshReview = React.useCallback(async (): Promise<void> => {
    await loadPending()
    await refreshQaSummary()
    setRetryToken((current) => current + 1)
    onProjectSummaryInvalidated?.()
  }, [loadPending, onProjectSummaryInvalidated, refreshQaSummary])

  React.useEffect(() => {
    const capability = {
      jumpToFinding: jumpToQaFinding,
      refreshAfterMutation: refreshReview,
      refreshToken: qaRefreshToken,
    }
    setQaFindingsCapability(capability)
    return () => {
      setQaFindingsCapability((current) =>
        clearQaFindingsCapability(current, capability))
    }
  }, [
    jumpToQaFinding,
    qaRefreshToken,
    refreshReview,
    setQaFindingsCapability,
  ])

  const reviewProposal = React.useCallback(async (
    segment: LinguistSegmentInfo,
    proposal: LinguistProposalInfo,
    operation: 'accept' | 'reject',
  ): Promise<void> => {
    if (
      stageBulkMutating
      || bulkMutating !== undefined
      || mutatingProposalIds.has(proposal.id)
      || proposalReviewBlock(segment, proposal, archived, operation) !== undefined
    ) return
    setMutatingProposalIds((current) => new Set(current).add(proposal.id))
    try {
      const input = {
        projectId,
        proposalId: proposal.id,
        expectedRevision: segment.revision,
        idempotencyKey: `${operation}:${proposal.id}:${crypto.randomUUID()}`,
      }
      const result = operation === 'accept'
        ? await window.electronAPI.linguistProposalsAccept(input)
        : await window.electronAPI.linguistProposalsReject(input)
      if (!result.ok) {
        toast.error(isProposalConflictCode(result.error.code) ? '建议已发生冲突' : '审核失败', {
          description: describeLinguistIpcError(result.error),
        })
        if (isProposalConflictCode(result.error.code)) await refreshReview()
        return
      }
      toast.success(operation === 'accept' ? '已接受建议' : '已拒绝建议')
      await refreshReview()
    } catch {
      toast.error('审核失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setMutatingProposalIds((current) => {
        const next = new Set(current)
        next.delete(proposal.id)
        return next
      })
    }
  }, [
    archived,
    bulkMutating,
    mutatingProposalIds,
    projectId,
    refreshReview,
    stageBulkMutating,
  ])

  const reviewSelected = React.useCallback(async (operation: 'accept' | 'reject'): Promise<void> => {
    const segmentIds = [...selectedIds]
    if (
      archived
      || stageBulkMutating
      || bulkMutating !== undefined
      || mutatingProposalIds.size > 0
      || segmentIds.length === 0
    ) return
    if (segmentIds.length > PAGE_SIZE) {
      toast.error('批量审核失败', {
        description: `单次最多核对 ${PAGE_SIZE} 个所选句段，请缩小选择范围。`,
      })
      return
    }
    setBulkMutating(operation)
    try {
      const results = await Promise.all(segmentIds.map((segmentId) =>
        window.electronAPI.linguistCatGetContext({ projectId, segmentId }),
      ))
      const failed = results.find((result) => !result.ok)
      if (failed !== undefined && !failed.ok) {
        toast.error('批量审核失败', { description: describeLinguistIpcError(failed.error) })
        return
      }
      const plan = proposalMutationPlan(
        results.flatMap((result) => result.ok ? [result.data] : []),
        archived,
        operation,
      )
      if (plan.items.length === 0) {
        window.alert(bulkProposalReviewConfirmation(
          operation,
          segmentIds.length,
          0,
          plan.excluded,
        ).replace('\n\n确定继续吗？', ''))
        await refreshReview()
        return
      }
      if (plan.items.length > 50) {
        toast.error('批量审核失败', {
          description: `实际可审核 ${plan.items.length} 条建议，单次最多执行 50 条。`,
        })
        return
      }
      if (!window.confirm(bulkProposalReviewConfirmation(
        operation,
        segmentIds.length,
        plan.items.length,
        plan.excluded,
      ))) return
      const idempotencyKey = `${operation}-selected:${crypto.randomUUID()}`
      const result = operation === 'accept'
        ? await window.electronAPI.linguistProposalsAcceptSelected({
          projectId,
          items: plan.items,
          idempotencyKey,
        })
        : await window.electronAPI.linguistProposalsRejectSelected({
          projectId,
          items: plan.items,
          idempotencyKey,
        })
      if (!result.ok) {
        toast.error(isProposalConflictCode(result.error.code) ? '所选建议已发生冲突' : '批量审核失败', {
          description: describeLinguistIpcError(result.error),
        })
        await refreshReview()
        return
      }
      toast.success(
        operation === 'accept'
          ? `已接受 ${plan.items.length} 条建议`
          : `已拒绝 ${plan.items.length} 条建议`,
      )
      setWorkbenchUiState({ selectedSegmentIds: [] })
      await refreshReview()
    } catch {
      toast.error('批量审核失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBulkMutating(undefined)
    }
  }, [
    archived,
    bulkMutating,
    mutatingProposalIds.size,
    pendingBySegment,
    projectId,
    refreshReview,
    selectedIds,
    setWorkbenchUiState,
    stageBulkMutating,
  ])

  const confirmSelectedStage = React.useCallback(async (): Promise<void> => {
    const segmentIds = [...selectedIds]
    if (
      archived
      || stageBulkMutating
      || bulkMutating !== undefined
      || segmentIds.length === 0
      || segmentIds.length > PAGE_SIZE
    ) return
    setStageBulkMutating(true)
    try {
      const contexts = await Promise.all(segmentIds.map((segmentId) =>
        window.electronAPI.linguistCatGetContext({ projectId, segmentId }),
      ))
      const contextFailures = contexts.flatMap((result, index) => result.ok
        ? []
        : [{
            segmentId: segmentIds[index]!,
            code: result.error.code,
            message: result.error.message,
          }])
      const items = contexts.flatMap((result) => result.ok
        ? [{
            segmentId: result.data.segment.id,
            expectedRevision: result.data.segment.revision,
          }]
        : [])
      if (items.length === 0) {
        toast.error('所选片段均无法读取，未执行阶段确认')
        return
      }
      const result = await window.electronAPI.linguistCatConfirmStageBulk({
        projectId,
        items,
      })
      if (!result.ok) {
        toast.error('批量确认当前阶段失败', {
          description: describeLinguistIpcError(result.error),
        })
        return
      }
      const failures = [...contextFailures, ...result.data.failed]
      const succeededById = new Map(
        result.data.succeeded.map((segment) => [segment.id, segment]),
      )
      setState((current) => {
        if (current.status !== 'ready' || current.data.signature !== signature) return current
        const rows = new Map(current.data.rows)
        current.data.segmentIds.forEach((segmentId, index) => {
          const succeeded = succeededById.get(segmentId)
          if (succeeded !== undefined) rows.set(index, succeeded)
        })
        return { status: 'ready', data: { ...current.data, rows } }
      })
      setWorkbenchUiState({
        selectedSegmentIds: failures.map((failure) => failure.segmentId),
      })
      onProjectSummaryInvalidated?.()
      if (failures.length === 0) {
        toast.success(`${stageActionLabel(workflowStage)} ${result.data.succeeded.length} 段`)
        return
      }
      const details = failures
        .slice(0, 3)
        .map((failure) => `${failure.segmentId}：${failure.code}`)
        .join('；')
      toast.warning(
        stageBulkConfirmationSummary(
          workflowStage,
          result.data.succeeded.length,
          failures.length,
        ),
        { description: `${details}${failures.length > 3 ? '；其余失败项仍保持选中' : ''}` },
      )
    } catch {
      toast.error('批量确认当前阶段失败', {
        description: '与主进程通信异常（INTERNAL）',
      })
    } finally {
      setStageBulkMutating(false)
    }
  }, [
    archived,
    bulkMutating,
    onProjectSummaryInvalidated,
    projectId,
    selectedIds,
    setWorkbenchUiState,
    signature,
    stageBulkMutating,
    workflowStage,
  ])

  return (
    <section aria-label="Segment 编辑器" className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
      <div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_180px_140px]">
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-foreground/35" />
          <span className="sr-only">搜索源文或译文</span>
          <input
            value={filters.search}
            onChange={(event) => updateFilters({ search: event.target.value })}
            placeholder="搜索源文或译文"
            maxLength={500}
            className="h-9 w-full rounded-lg bg-background/70 pl-9 pr-3 text-[13px] outline-none ring-1 ring-border/50 focus:ring-primary/50"
          />
        </label>
        <label>
          <span className="sr-only">批次筛选</span>
          <select
            value={filters.assetId ?? ''}
            onChange={(event) => updateFilters({ assetId: event.target.value || undefined })}
            className="h-9 w-full min-w-0 truncate rounded-lg bg-background/70 pl-3 pr-8 text-[13px] outline-none ring-1 ring-border/50 focus:ring-primary/50"
          >
            <option value="">全部批次</option>
            {data?.assets.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>{asset.filename}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">状态筛选</span>
          <select
            value={filters.currentStageState ?? ''}
            onChange={(event) =>
              updateFilters({
                currentStageState: (event.target.value || undefined) as
                  | LinguistCurrentStageState
                  | undefined,
              })
            }
            className="h-9 w-full min-w-0 truncate rounded-lg bg-background/70 pl-3 pr-8 text-[13px] outline-none ring-1 ring-border/50 focus:ring-primary/50"
          >
            <option value="">全部本轮状态</option>
            {stageFilterOptions(workflowStage).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-[12px] text-foreground/60">
        <span className="flex gap-2">
          <span>{data === undefined ? '正在查询…' : `共 ${data.total} 段`}</span>
          <span>{selectedIds.size} 项已选择</span>
        </span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void goToNextUntouched()}
            className="rounded-md bg-foreground/[0.055] px-2.5 py-1 hover:bg-foreground/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {nextStageItemLabel(workflowStage)}
          </button>
          <button
            type="button"
            disabled={qaOpenCount === undefined || qaOpenCount === 0}
            onClick={() => void goToNextQa()}
            title={qaOpenCount === undefined ? '请先在下方 QA 面板运行 QA' : undefined}
            className="rounded-md bg-foreground/[0.055] px-2.5 py-1 hover:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-45"
          >
            下一个 QA 问题{qaOpenCount === undefined ? '（未运行）' : `（${qaOpenCount}）`}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {state.status === 'loading' ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-foreground/60">
          <Loader2 size={15} className="animate-spin" />
          正在加载片段…
        </div>
      ) : state.status === 'error' ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <AlertTriangle size={22} className="text-destructive" />
          <p className="text-[13px] text-foreground/60">{describeLinguistIpcError(state.error)}</p>
          <button type="button" onClick={() => setRetryToken((current) => current + 1)} className="inline-flex items-center gap-1.5 rounded-md bg-foreground/[0.07] px-3 py-1.5 text-[13px] font-medium hover:bg-foreground/[0.1]">
            <RefreshCw size={13} />
            重试
          </button>
        </div>
      ) : state.data.total === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-foreground/60">
          没有符合条件的片段
        </div>
      ) : (
        <SegmentGrid
          key={state.data.signature}
          projectId={projectId}
          total={state.data.total}
          segmentIds={state.data.segmentIds}
          rows={state.data.rows}
          selectedIds={selectedIds}
          pendingBySegment={pendingBySegment}
          mutatingProposalIds={mutatingProposalIds}
          qaBySegment={qaBySegment}
          activeSegmentId={activeSegmentId}
          focusIndex={pendingFocusIndex}
          archived={archived}
          workflowStage={workflowStage}
          onActiveSegmentChange={setActiveSegmentId}
          onOpenDetails={(segmentId, assetId) =>
            openSegmentDock(segmentId, assetId, 'context')
          }
          onOpenQa={(segmentId, assetId) =>
            openSegmentDock(segmentId, assetId, 'qa')
          }
          onFocusIndex={focusRow}
          onFocusIndexSettled={() => setPendingFocusIndex(undefined)}
          onToggleSelected={toggleSelected}
          onVisibleRangeChange={updateVisibleRange}
          onSaveTarget={saveTarget}
          onReloadTarget={reloadTarget}
          onConfirmAndAdvance={confirmAndAdvance}
          onUnconfirmStage={unconfirmStage}
          onReviewProposal={reviewProposal}
          onTargetEditorCapabilityChange={updateEditorCapability}
        />
        )}
      </div>
      {selectedIds.size > 0 && (
        <div aria-label="所选片段审核操作" className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-content-area px-3 py-2 shadow-md ring-1 ring-border/35">
          <p className="text-[12px] text-foreground/50">
            已选择 {selectedIds.size} 段，其中 {selectedPendingIds.length} 条含 pending 建议
            {selectedPendingIds.length > 50 ? '（执行前会核对，单次最多实际处理 50 条）' : ''}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={
                archived
                || stageBulkMutating
                || bulkMutating !== undefined
                || selectedIds.size === 0
                || selectedIds.size > PAGE_SIZE
              }
              onClick={() => void confirmSelectedStage()}
              className="rounded-md bg-foreground/[0.06] px-3 py-1.5 text-[12px] font-medium text-foreground/65 transition-colors hover:bg-foreground/[0.1] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {stageBulkMutating
                ? '正在确认当前阶段…'
                : `${stageActionLabel(workflowStage)}所选（${selectedIds.size}）`}
            </button>
            <button
              type="button"
              disabled={archived || stageBulkMutating || bulkMutating !== undefined || mutatingProposalIds.size > 0 || selectedPendingIds.length === 0}
              onClick={() => void reviewSelected('reject')}
              className="rounded-md bg-foreground/[0.06] px-3 py-1.5 text-[12px] font-medium text-foreground/65 transition-colors hover:bg-foreground/[0.1] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkMutating === 'reject' ? '正在拒绝…' : '拒绝所选建议'}
            </button>
            <button
              type="button"
              disabled={archived || stageBulkMutating || bulkMutating !== undefined || mutatingProposalIds.size > 0 || selectedPendingIds.length === 0}
              onClick={() => void reviewSelected('accept')}
              className="rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkMutating === 'accept' ? '正在接受…' : '接受所选建议'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
