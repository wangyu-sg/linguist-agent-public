/**
 * Agent Host Extension（LA-HOST-SEAM）行为测试。
 *
 * 固定宿主缝的可观察契约：
 * - 普通 Agent 会话得到空扩展（无 chips、无轮次上下文、默认能力、附件闸门按 workspace 判定）；
 * - Linguist 项目绑定会话得到 CAT 扩展（项目 chips、Linguist surface 能力清单）；
 * - Rail 呈现裁决把会话未创建时的占位查询也解析为 Linguist 能力。
 */

import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSessionMeta, LinguistProjectSummary } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { linguistProjectMutationStateAtomFamily } from '@/features/linguist/projects/project-mutation-atoms'
import { linguistProjectSummaryAtomFamily } from '@/features/linguist/projects/project-summary-atoms'
import { DEFAULT_AGENT_HOST_CAPABILITIES } from './contracts'
import {
  LINGUIST_AGENT_FULL_HOST_CAPABILITIES,
  LINGUIST_AGENT_RAIL_HOST_CAPABILITIES,
} from './linguist-extension'
import {
  useAgentHostExtension,
  useAgentSurfaceHostPresentation,
  type AgentHostExtension,
  type AgentSurfaceHostPresentation,
} from './agent-host-extension'

const linguistSession: AgentSessionMeta = {
  id: 'session-linguist',
  title: '项目会话',
  linguistProjectId: 'prj-linguist-1',
  createdAt: 1_751_000_000_000,
  updatedAt: 1_751_000_000_000,
}

const summaryFixture: LinguistProjectSummary = {
  project: {
    schemaVersion: 1,
    id: 'prj-linguist-1',
    name: '游戏本地化',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'workspace-1',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
  },
  assetCount: 0,
  totalSegments: 0,
  segmentCounts: { untranslated: 0, draft: 0, translated: 0, reviewed: 0 },
  currentStageCounts: { untouched: 0, draft: 0, confirmed: 0 },
  assets: [],
}

/** 捕获 hook 返回值的探针：renderToStaticMarkup 渲染期即可读取 useMemo 结果。 */
function HostExtensionProbe({
  sessionId,
  presentation,
  box,
}: {
  sessionId: string
  presentation?: 'full' | 'rail'
  box: { current?: AgentHostExtension }
}): React.ReactElement {
  const extension = useAgentHostExtension(sessionId, presentation)
  box.current = extension
  return <div data-testid="host-extension-probe">{extension.composerContextChips}</div>
}

function SurfacePresentationProbe({
  projectId,
  sessionId,
  requested,
  box,
}: {
  projectId: string
  sessionId?: string
  requested: 'closed' | 'rail' | 'full'
  box: { current?: AgentSurfaceHostPresentation }
}): React.ReactElement {
  box.current = useAgentSurfaceHostPresentation(projectId, sessionId, requested)
  return <div data-testid="surface-presentation-probe" />
}

function renderWithStore(node: React.ReactNode, store: ReturnType<typeof createStore>): string {
  return renderToStaticMarkup(<Provider store={store}>{node}</Provider>)
}

describe('useAgentHostExtension', () => {
  test('given 普通 Agent 会话 when 解析宿主扩展 then 返回空扩展与默认能力', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [
      { id: 'session-plain', title: '普通会话', createdAt: 1_751_000_000_000, updatedAt: 1_751_000_000_000 },
    ])
    const box: { current?: AgentHostExtension } = {}

    const html = renderWithStore(
      <HostExtensionProbe sessionId="session-plain" box={box} />,
      store,
    )

    expect(box.current?.composerContextChips).toBeNull()
    expect(box.current?.captureTurnContext()).toBeUndefined()
    expect(box.current?.mutationVersion).toBe(0)
    expect(box.current?.hostCapabilities).toEqual(DEFAULT_AGENT_HOST_CAPABILITIES)
    // 附件闸门封装项目身份：普通会话无 workspace 时 fail closed，有 workspace 时放行并透传 slug。
    expect(box.current?.attachmentGate.resolve(undefined)).toEqual({ canSave: false })
    expect(box.current?.attachmentGate.resolve('my-workspace')).toEqual({
      canSave: true,
      workspaceSlug: 'my-workspace',
    })
  })

  test('given Linguist 绑定会话且摘要就绪 when 解析宿主扩展 then 输出项目 chips 与 rail 能力', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [linguistSession])
    store.set(linguistProjectSummaryAtomFamily('prj-linguist-1'), {
      status: 'ready',
      summary: summaryFixture,
    })
    store.set(linguistProjectMutationStateAtomFamily('prj-linguist-1'), {
      lastRevision: 7,
      lastSequence: 12,
    })
    const box: { current?: AgentHostExtension } = {}

    const html = renderWithStore(
      <HostExtensionProbe sessionId="session-linguist" presentation="rail" box={box} />,
      store,
    )

    // 项目名进入 composer chips；普通会话区域不出现。
    expect(html).toContain('游戏本地化')
    expect(box.current?.mutationVersion).toBe(7)
    expect(box.current?.hostCapabilities).toEqual(LINGUIST_AGENT_RAIL_HOST_CAPABILITIES)
    expect(box.current?.hostCapabilities.filePanel).toBe(false)
    // Linguist 会话无 Proma workspace：仅按项目绑定放行，不透传 workspaceSlug。
    expect(box.current?.attachmentGate.resolve(undefined)).toEqual({ canSave: true })
  })

  test('given Linguist 绑定会话以 full 呈现 when 解析能力 then 恢复文件面板入口', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [linguistSession])
    const box: { current?: AgentHostExtension } = {}

    renderWithStore(
      <HostExtensionProbe sessionId="session-linguist" presentation="full" box={box} />,
      store,
    )

    expect(box.current?.hostCapabilities).toEqual(LINGUIST_AGENT_FULL_HOST_CAPABILITIES)
    expect(box.current?.hostCapabilities.filePanel).toBe(true)
  })

  test('given 摘要未就绪 when 渲染 chips then 项目名回退通用标签不崩溃', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [linguistSession])
    const box: { current?: AgentHostExtension } = {}

    const html = renderWithStore(
      <HostExtensionProbe sessionId="session-linguist" presentation="rail" box={box} />,
      store,
    )

    expect(html).toContain('当前项目')
    expect(html).not.toContain('游戏本地化')
  })
})

describe('useAgentSurfaceHostPresentation', () => {
  test('given 会话未创建 when 裁决呈现 then 占位查询解析为 Linguist rail 能力', () => {
    const store = createStore()
    const box: { current?: AgentSurfaceHostPresentation } = {}

    renderWithStore(
      <SurfacePresentationProbe
        projectId="prj-linguist-1"
        requested="closed"
        box={box}
      />,
      store,
    )

    expect(box.current?.presentation).toBe('rail')
    expect(box.current?.canExpandToFull).toBe(true)
    expect(box.current?.hostCapabilities).toEqual(LINGUIST_AGENT_RAIL_HOST_CAPABILITIES)
  })

  test('given 用户请求 full when 能力允许 then 裁决为 full 并暴露完整能力清单', () => {
    const store = createStore()
    const fullBox: { current?: AgentSurfaceHostPresentation } = {}
    renderWithStore(
      <SurfacePresentationProbe
        projectId="prj-linguist-1"
        sessionId="session-linguist"
        requested="full"
        box={fullBox}
      />,
      store,
    )
    expect(fullBox.current?.presentation).toBe('full')
    expect(fullBox.current?.hostCapabilities.fullPresentation).toBe(true)
  })
})
