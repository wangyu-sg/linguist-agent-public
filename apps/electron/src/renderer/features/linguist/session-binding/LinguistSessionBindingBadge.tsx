/**
 * LinguistSessionBindingBadge / Notice — 项目绑定会话的徽章与会话内通告（PB-034）。
 *
 * 徽章（AgentHeader 标题行）：项目名 + 实时状态后缀，
 * 让「这个对话属于哪个项目」一眼可见；普通会话不渲染。
 * 通告（AgentHeader 下方横条）：CAT 降级原因 + 用户主动永久解绑出口。
 * 数据来自 useLinguistSessionBinding（IPC 当次解析，非客户端镜像）。
 */

import * as React from 'react'
import { AlertTriangle, Archive, FolderOpen } from 'lucide-react'
import type { AgentSessionMeta } from '@proma/shared'
import { useSetAtom, useStore } from 'jotai'
import { toast } from 'sonner'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { replaceAgentSessionInFreshnessOrder } from '@/lib/agent-session-list'
import { cn } from '@/lib/utils'
import { openLocalizationProject } from '../projects/open-localization-project'
import { describeLinguistIpcError } from '../projects/project-utils'
import { bindingNoticeCopy, bindingStatusLabel } from './binding-utils'
import {
  linguistSessionBindingsAtom,
  useLinguistSessionBinding,
} from './useLinguistSessionBinding'

type BindingSession = Pick<AgentSessionMeta, 'id' | 'linguistProjectId' | 'linguistProjectName'>

/** 项目徽章：active=中性；archived=琥珀；异常=红。状态未回时按绑定快照展示项目名。 */
export function LinguistSessionBindingBadge({
  session,
}: {
  session: BindingSession
}): React.ReactElement | null {
  const binding = useLinguistSessionBinding(session)
  const store = useStore()
  const projectId = session.linguistProjectId
  if (!projectId) return null

  const projectName = binding?.projectName ?? session.linguistProjectName ?? '项目'
  const status = binding?.status ?? 'active'
  const label = bindingStatusLabel(status)
  const returnToProject = (): void => {
    void openLocalizationProject(store, projectId)
      .then((result) => {
        if (!result.ok) {
          toast.error('返回项目失败', {
            description: describeLinguistIpcError(result.error),
          })
        }
      })
      .catch(() => {
        toast.error('返回项目失败', { description: '与主进程通信异常（INTERNAL）' })
      })
  }

  return (
    <button
      type="button"
      onClick={returnToProject}
      aria-label={`返回 Linguist 项目 ${projectName}`}
      data-testid="linguist-project-badge"
      data-binding-status={status}
      title={
        status === 'archived'
          ? `绑定项目「${projectName}」已归档，CAT 写入只读`
          : status === 'missing'
            ? `绑定项目「${projectName}」目录缺失，Agent 对话仍可用`
            : status === 'unavailable'
              ? `绑定项目「${projectName}」暂不可用，Agent 对话仍可用`
              : `返回 Linguist 项目「${projectName}」`
      }
      className={cn(
        'titlebar-no-drag inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] flex-shrink-0',
        status === 'archived' &&
          'border-warning/40 bg-warning/10 text-warning',
        (status === 'missing' || status === 'unavailable') &&
          'border-destructive/40 bg-destructive/10 text-destructive',
        status === 'active' && 'border-border/60 text-foreground/55 hover:bg-accent/70 hover:text-foreground',
      )}
    >
      {status === 'archived' ? (
        <Archive size={11} />
      ) : status === 'active' ? (
        <FolderOpen size={11} />
      ) : (
        <AlertTriangle size={11} />
      )}
      <span className="max-w-[160px] truncate">{projectName}</span>
      {label && <span>· {label}</span>}
    </button>
  )
}

/** 会话内通告：异常态仅降级 CAT，并提供显式永久解绑。 */
export function LinguistSessionBindingNotice({
  session,
}: {
  session: BindingSession
}): React.ReactElement | null {
  const binding = useLinguistSessionBinding(session)
  const setBindings = useSetAtom(linguistSessionBindingsAtom)
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const [detaching, setDetaching] = React.useState(false)
  const [detachError, setDetachError] = React.useState<string | null>(null)
  if (!session.linguistProjectId || !binding) return null
  const copy = bindingNoticeCopy(binding.status, binding.projectName)
  if (!copy) return null

  const detach = async (): Promise<void> => {
    if (!window.confirm('永久解除项目绑定？解绑后该会话会作为普通 Agent 继续，且不能重新绑定。')) {
      return
    }
    setDetaching(true)
    setDetachError(null)
    try {
      const result = await window.electronAPI.linguistSessionsDetachBinding({
        sessionId: session.id,
      })
      if (!result.ok) {
        setDetachError(result.error.message)
        return
      }
      const updatedSession = result.data.session
      if (updatedSession) {
        setAgentSessions((previous) =>
          replaceAgentSessionInFreshnessOrder(previous, updatedSession),
        )
      }
      setBindings((previous) => {
        if (!(session.id in previous)) return previous
        const next = { ...previous }
        delete next[session.id]
        return next
      })
    } catch {
      setDetachError('解除绑定失败，请重试。')
    } finally {
      setDetaching(false)
    }
  }

  return (
    <div
      role="status"
      data-testid="linguist-binding-notice"
      data-binding-status={binding.status}
      className={cn(
        'mx-4 mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed',
        copy.tone === 'amber' &&
          'border-warning/30 bg-warning-soft/60 text-warning-foreground',
        copy.tone === 'red' &&
          'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      {copy.tone === 'amber' ? (
        <Archive size={13} className="mt-0.5 flex-shrink-0" />
      ) : (
        <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <span>
          <span className="font-medium">{copy.title}：</span>
          {copy.body}
        </span>
        <div className="mt-1.5 flex items-center gap-2">
          <button
            type="button"
            onClick={detach}
            disabled={detaching}
            className="rounded-md bg-background/70 px-2 py-1 font-medium text-foreground shadow-sm hover:bg-background disabled:opacity-50"
          >
            {detaching ? '正在解除…' : '解除绑定并作为普通 Agent 继续'}
          </button>
          {detachError && <span role="alert">{detachError}</span>}
        </div>
      </div>
    </div>
  )
}
