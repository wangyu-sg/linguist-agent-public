import type { AgentSessionMeta } from '@proma/shared'

/** 由组合根注入；Proma 通用入口不反向依赖 Linguist feature。 */
export type ExternalLinguistSessionOpener = (sessionId: string) => Promise<void>

export type ExternalAgentSessionOpenResult =
  | { kind: 'opened-ordinary' | 'opened-linguist' }
  | { kind: 'blocked'; message: string }

/**
 * 菜单栏、Agent Island 等外部入口的会话路由。
 *
 * 绑定到 Linguist 项目的会话没有 opener 时必须 fail closed；不能为了打开历史
 * 而退化为普通 Agent，否则会绕过项目归档/缺失时的只读路径。
 */
export async function routeExternalAgentSession(
  session: AgentSessionMeta,
  openLinguistSession: ExternalLinguistSessionOpener | null,
  openOrdinarySession: () => void,
): Promise<ExternalAgentSessionOpenResult> {
  if (!session.linguistProjectId) {
    openOrdinarySession()
    return { kind: 'opened-ordinary' }
  }

  if (!openLinguistSession) {
    return {
      kind: 'blocked',
      message: 'Linguist 项目会话入口尚未就绪；为保护项目上下文，未按普通 Agent 打开。',
    }
  }

  try {
    await openLinguistSession(session.id)
    return { kind: 'opened-linguist' }
  } catch (error) {
    return {
      kind: 'blocked',
      message: error instanceof Error && error.message
        ? error.message
        : '无法打开 Linguist 项目会话；为保护项目上下文，未按普通 Agent 打开。',
    }
  }
}
