/**
 * useLinguistSessionBinding — 会话 → 项目绑定的实时状态（PB-034）。
 *
 * 数据纪律（计划 §9.5）：绑定状态是主进程当次解析结果（项目归档/缺失
 * 随时可变，绝不镜像为客户端真源）；atom 只是「每次挂载拉取」的会话级
 * 缓存（key = sessionId），会话切换/重开时重新拉取。未绑定的普通会话
 * 不发起 IPC，直接返回 null。
 */

import * as React from 'react'
import { atom, useAtom } from 'jotai'
import type { AgentSessionMeta, LinguistSessionBindingInfo } from '@proma/shared'

/** 会话级绑定缓存（key = agent sessionId；仅缓存已解析结果，IPC 仍为真源）。 */
export const linguistSessionBindingsAtom = atom<Record<string, LinguistSessionBindingInfo>>({})

type BindingSession = Pick<
  AgentSessionMeta,
  'id' | 'linguistProjectId' | 'linguistProjectName'
> | null | undefined

/**
 * 解析当前会话的项目绑定。session 无 linguistProjectId（普通会话）→ null；
 * 绑定会话在挂载/切换时经 IPC 实时解析（archived/missing 立即反映）。
 */
export function useLinguistSessionBinding(session: BindingSession): LinguistSessionBindingInfo | null {
  const projectId = session?.linguistProjectId ?? null
  const projectName = session?.linguistProjectName ?? '项目'
  const sessionId = session?.linguistProjectId ? session.id : null
  const [bindings, setBindings] = useAtom(linguistSessionBindingsAtom)

  React.useEffect(() => {
    if (!sessionId || !projectId) return
    let cancelled = false
    const markUnavailable = (): void => {
      if (cancelled) return
      setBindings((previous) => ({
        ...previous,
        [sessionId]: { projectId, projectName, status: 'unavailable' },
      }))
    }
    void (async () => {
      try {
        const result = await window.electronAPI.linguistSessionsGetBinding({ sessionId })
        if (cancelled) return
        if (!result.ok) {
          markUnavailable()
          return
        }
        setBindings((prev) => {
          if (!result.data.binding) {
            // 会话已无绑定（异常态）：清掉陈旧缓存
            if (!(sessionId in prev)) return prev
            const next = { ...prev }
            delete next[sessionId]
            return next
          }
          return { ...prev, [sessionId]: result.data.binding }
        })
      } catch {
        markUnavailable()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, projectName, sessionId, setBindings])

  if (!sessionId) return null
  return bindings[sessionId] ?? null
}
