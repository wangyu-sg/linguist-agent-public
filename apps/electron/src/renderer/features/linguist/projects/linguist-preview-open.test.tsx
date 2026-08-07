/**
 * linguist-preview-open 回归（bun:test + renderToStaticMarkup + 真实 store）。
 *
 * 验收面：从批次 / Context 文档入口打开的是「原生 Proma Preview Tab」——
 * 经 useOpenLinguistPreview → useOpenPreview → openTab 的真实集成：
 * preview tab 出现在 tabsAtom（可关闭 / 可切换 / 复用同一 tab），
 * previewFileMapAtom 携带 opaque linguist 目标（无路径、无字节）。
 */

import { describe, expect, test } from 'bun:test'
import { Provider, createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSessionMeta } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import {
  previewFileMapAtom,
  previewModePreferenceAtom,
  previewPanelOpenMapAtom,
  type LinguistPreviewTarget,
} from '@/atoms/preview-atoms'
import {
  activeTabIdAtom,
  createPreviewTabId,
  isPreviewTab,
  tabsAtom,
} from '@/atoms/tab-atoms'
import { useOpenLinguistPreview } from './linguist-preview-open'

function session(id: string, projectId: string): AgentSessionMeta {
  return {
    id,
    title: id,
    agentRuntime: 'pi',
    linguistProjectId: projectId,
    createdAt: 1,
    updatedAt: 2,
  }
}

const BATCH_TARGET: LinguistPreviewTarget = {
  kind: 'batch',
  projectId: 'project-a',
  assetId: 'ast-0000000000000001',
  filename: 'messages.xliff',
  formatId: 'xliff',
  segmentCount: 3,
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  segmentCounts: { untranslated: 3, draft: 0, translated: 0, reviewed: 0 },
  currentStageCounts: { untouched: 3, draft: 0, confirmed: 0 },
  openQaCount: 0,
}

/** 在 Provider 内渲染探针捕获 hook 回调，随后以真实 store 直接驱动。 */
function captureOpener(store: ReturnType<typeof createStore>): (target: LinguistPreviewTarget) => boolean {
  let captured: ((target: LinguistPreviewTarget) => boolean) | null = null
  function Probe(): null {
    captured = useOpenLinguistPreview()
    return null
  }
  renderToStaticMarkup(
    <Provider store={store}>
      <Probe />
    </Provider>,
  )
  if (captured === null) throw new Error('hook 未被捕获')
  return captured
}

describe('linguist-preview-open', () => {
  test('given 项目有绑定会话 when 打开批次预览 then 激活该会话的原生 preview tab 且 previewFile 携带 opaque linguist 目标', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session('session-a', 'project-a')])
    const open = captureOpener(store)

    const opened = open(BATCH_TARGET)

    expect(opened).toBe(true)
    const previewTabId = createPreviewTabId('session-a')
    const tabs = store.get(tabsAtom)
    const previewTab = tabs.find((tab) => tab.id === previewTabId)
    expect(previewTab).toBeDefined()
    expect(previewTab && isPreviewTab(previewTab)).toBe(true)
    expect(previewTab?.title).toBe('预览：messages.xliff')
    expect(store.get(activeTabIdAtom)).toBe(previewTabId)

    const file = store.get(previewFileMapAtom).get('session-a')
    expect(file?.linguist).toEqual(BATCH_TARGET)
    expect(file?.filePath).toBe('messages.xliff')
    expect(file?.previewOnly).toBe(true)
    expect(file?.readOnly).toBe(true)
  })

  test('given 再次打开另一批次 when 同一会话 then 复用同一 preview tab（原生单 tab 语义）', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session('session-a', 'project-a')])
    const open = captureOpener(store)

    expect(open(BATCH_TARGET)).toBe(true)
    expect(open({ ...BATCH_TARGET, assetId: 'ast-0000000000000002', filename: 'menu.xliff' })).toBe(true)

    const previewTabs = store.get(tabsAtom).filter(isPreviewTab)
    expect(previewTabs).toHaveLength(1)
    expect(previewTabs[0]?.id).toBe(createPreviewTabId('session-a'))
    expect(store.get(previewFileMapAtom).get('session-a')?.linguist).toMatchObject({
      kind: 'batch',
      assetId: 'ast-0000000000000002',
    })
  })

  test('given 通用文件预览偏好为分屏 when 从 Linguist 资源页打开 then 仍进入可见的 Preview Tab', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session('session-a', 'project-a')])
    store.set(previewModePreferenceAtom, 'split')
    const open = captureOpener(store)

    expect(open(BATCH_TARGET)).toBe(true)
    expect(store.get(activeTabIdAtom)).toBe(createPreviewTabId('session-a'))
    expect(store.get(tabsAtom).filter(isPreviewTab)).toHaveLength(1)
    expect(store.get(previewPanelOpenMapAtom).get('session-a')).toBe(false)
    expect(store.get(previewModePreferenceAtom)).toBe('split')
  })

  test('given 打开 Context 文档预览 when 项目有绑定会话 then previewFile 携带 contextDoc 目标', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [session('session-a', 'project-a')])
    const open = captureOpener(store)

    const target: LinguistPreviewTarget = {
      kind: 'contextDoc',
      projectId: 'project-a',
      docId: 'ctx-0123456789abcdef',
      filename: '术语备忘.docx',
    }
    expect(open(target)).toBe(true)
    expect(store.get(previewFileMapAtom).get('session-a')?.linguist).toEqual(target)
  })

  test('given 项目没有绑定会话 when 打开 then 返回 false 且 tab 与 previewFile 状态完全不变', () => {
    const store = createStore()
    const open = captureOpener(store)

    const opened = open(BATCH_TARGET)

    expect(opened).toBe(false)
    expect(store.get(tabsAtom).filter(isPreviewTab)).toHaveLength(0)
    expect(store.get(previewFileMapAtom).size).toBe(0)
  })
})
