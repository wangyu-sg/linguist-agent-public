/**
 * Agent 会话附件落盘闸门（renderer 侧纯函数）。
 *
 * 普通 Agent 会话绑定 Proma workspace，附件写入 workspace 派生的受管 session 目录；
 * Linguist 项目绑定会话没有 Proma workspace，附件仍走同一 IPC（saveFilesToAgentSession），
 * 由主进程 resolveAgentExecutionScope 按 session ↔ project binding 解析受管目录，
 * 并经 checkLinguistSessionSendBlock 校验可写性（归档/缺失 fail closed）。
 * renderer 不伪造 workspace，也不提交任意项目路径。
 */
export interface AgentAttachmentSaveGate {
  canSave: boolean
  /** 仅 Proma workspace 会话提供；Linguist 会话不传（主进程不依赖该字段授权）。 */
  workspaceSlug?: string
}

export function resolveAgentAttachmentSaveGate(input: {
  linguistProjectId?: string
  workspaceSlug?: string
}): AgentAttachmentSaveGate {
  if (input.workspaceSlug) {
    return { canSave: true, workspaceSlug: input.workspaceSlug }
  }
  // 无 Proma workspace 时，仅 Linguist 项目绑定会话允许继续（主进程按 session 授权）。
  return { canSave: Boolean(input.linguistProjectId) }
}
