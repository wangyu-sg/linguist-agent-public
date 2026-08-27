import * as React from 'react'
import { useAtomValue, useStore } from 'jotai'
import type { createStore } from 'jotai/vanilla'
import {
  LINGUIST_ASSET_ID_PATTERN,
  type LinguistCatContextResult,
  type LinguistCatGetContextRequest,
  type LinguistIpcResult,
  type LinguistProjectOpenRequest,
  type LinguistProjectOpenResult,
} from '@proma/shared'
import {
  catResultNavigationRequestAtom,
  type CatResultLocation,
} from '@/atoms/cat-result-navigation-atoms'
import { linguistWorkbenchUiStateAtomFamily } from './cat-workspace-atoms'
import { openLocalizationProject } from './open-localization-project'

interface CatResultNavigationDeps {
  openProject: (
    input: LinguistProjectOpenRequest,
  ) => Promise<LinguistIpcResult<LinguistProjectOpenResult>>
  getContext: (
    input: LinguistCatGetContextRequest,
  ) => Promise<LinguistIpcResult<LinguistCatContextResult>>
}

export type CatResultNavigationOutcome = 'project' | 'segment' | 'none'
type JotaiStore = ReturnType<typeof createStore>

export async function navigateToCatResult(
  store: JotaiStore,
  location: CatResultLocation,
  deps: CatResultNavigationDeps = {
    openProject: (input) => window.electronAPI.linguistProjectsOpen(input),
    getContext: (input) => window.electronAPI.linguistCatGetContext(input),
  },
): Promise<CatResultNavigationOutcome> {
  let opened: LinguistIpcResult<LinguistProjectOpenResult>
  try {
    opened = await openLocalizationProject(store, location.projectId, deps.openProject)
  } catch {
    return 'none'
  }
  if (!opened.ok) return 'none'
  const segmentId = location.segmentId
  if (segmentId === undefined) return 'project'

  try {
    const context = await deps.getContext({ projectId: location.projectId, segmentId })
    if (
      !context.ok
      || context.data.segment.id !== segmentId
      || !LINGUIST_ASSET_ID_PATTERN.test(context.data.segment.assetId)
    ) return 'project'

    const { assetId } = context.data.segment
    store.set(linguistWorkbenchUiStateAtomFamily(location.projectId), (current) => ({
      activeAssetId: assetId,
      activeSegmentId: segmentId,
      assetActiveSegmentIds: {
        ...current.assetActiveSegmentIds,
        [assetId]: segmentId,
      },
      search: '',
      segmentStageStateFilter: undefined,
    }))
    return 'segment'
  } catch {
    return 'project'
  }
}

export function CatToolResultNavigationInitializer(): null {
  const store = useStore()
  const request = useAtomValue(catResultNavigationRequestAtom)
  const handledRevision = React.useRef(0)

  React.useEffect(() => {
    if (request === null || request.revision <= handledRevision.current) return
    handledRevision.current = request.revision
    void navigateToCatResult(store, request)
  }, [request, store])

  return null
}
