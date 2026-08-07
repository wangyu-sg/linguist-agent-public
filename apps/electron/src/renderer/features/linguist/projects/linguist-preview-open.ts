/**
 * linguist-preview-open — Linguist 对象 → Proma Preview Tab 的薄 adapter。
 *
 * 把「批次源文件 / Context 文档」的 opaque 身份包装成 PreviewFile.linguist
 * 描述符，经统一的 useOpenPreview 进入原生预览体系（Tab / 右侧分屏按用户
 * 偏好，关闭 / 切换 / 复用 / MRU 全部是原生行为，不新增第二套 Tab 状态）。
 *
 * owner 会话 = 项目当前绑定的 Agent 会话（projectCurrentAgentSessionIdMapAtom
 * 真源；Workbench 挂载时 Rail 已确保其存在）。会话尚未就绪时返回 false，
 * 由调用方给出诚实提示，绝不伪造 sessionId。
 */

import * as React from 'react'
import { useStore } from 'jotai'
import type { LinguistPreviewTarget, PreviewFile } from '@/atoms/preview-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/project-agent-session-atoms'
import { useOpenPreview } from '@/components/diff/preview-opener'

/** Jotai store 类型（从 useStore 推导，避免直接 import 内部 Store 类型） */
type JotaiStore = ReturnType<typeof useStore>

type OpenPreviewFn = (sessionId: string, file: PreviewFile, mode?: 'tab' | 'split') => void

/**
 * 打开核心（纯函数形态，便于 bun test 直接驱动 store 断言）。
 * 返回 false = 项目当前没有可用的绑定会话，状态完全不变。
 */
export function openLinguistPreview(
  store: JotaiStore,
  openPreview: OpenPreviewFn,
  target: LinguistPreviewTarget,
): boolean {
  const sessionId = store.get(projectCurrentAgentSessionIdMapAtom).get(target.projectId)
  if (sessionId === undefined) return false
  openPreview(sessionId, {
    // filePath 仅承担标题展示（预览：文件名）； linguist 描述符存在时
    // 不进入 DiffTabContent 的文件读取链，主进程围栏仍在 linguist IPC 侧。
    filePath: target.filename,
    previewOnly: true,
    readOnly: true,
    linguist: target,
  }, 'tab')
  return true
}

export function useOpenLinguistPreview(): (target: LinguistPreviewTarget) => boolean {
  const store = useStore()
  const openPreview = useOpenPreview()
  return React.useCallback(
    (target: LinguistPreviewTarget): boolean =>
      openLinguistPreview(store, openPreview, target),
    [store, openPreview],
  )
}
