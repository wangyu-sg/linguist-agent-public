/**
 * Linguist 会话绑定的纯展示逻辑（PB-034）——bun 可测，无 IPC/React 依赖。
 *
 * 状态语义（与 main/lib/linguist/session-binding.ts 一致）：
 * - active：徽章中性展示项目名，无通告；
 * - archived：徽章标「已归档」，通告说明会话只读（发送会被主进程拒绝）；
 * - missing / unavailable：历史可读，发送 fail closed，等待修复或显式解绑。
 */

import type { LinguistSessionBindingStatus } from '@proma/shared'

/** 徽章上项目名后的状态后缀；active 无后缀。 */
export function bindingStatusLabel(status: LinguistSessionBindingStatus): string | null {
  switch (status) {
    case 'archived':
      return '已归档'
    case 'missing':
      return '项目缺失'
    case 'unavailable':
      return '项目不可用'
    case 'active':
      return null
  }
}

export interface BindingNoticeCopy {
  title: string
  body: string
  /** 通告色调：归档=amber（只读），缺失/不可用=red（阻断）。 */
  tone: 'amber' | 'red'
}

/** 会话内通告文案；active 不需要通告（返回 null）。 */
export function bindingNoticeCopy(
  status: LinguistSessionBindingStatus,
  projectName: string,
): BindingNoticeCopy | null {
  switch (status) {
    case 'archived':
      return {
        title: '项目已归档（只读）',
        body: `会话绑定的项目「${projectName}」已归档。历史消息可正常阅读，但不能发送新消息。`,
        tone: 'amber',
      }
    case 'missing':
      return {
        title: '绑定项目缺失',
        body: `会话绑定的项目「${projectName}」目录已缺失或损坏。历史消息可正常阅读，但新消息不会发送；修复项目或永久解除绑定后才能继续。`,
        tone: 'red',
      }
    case 'unavailable':
      return {
        title: '项目服务不可用',
        body: `暂时无法验证会话绑定的项目「${projectName}」，新消息不会按普通 Agent 发送。请重试；若确认不再需要项目上下文，也可永久解除绑定。`,
        tone: 'red',
      }
    case 'active':
      return null
  }
}
