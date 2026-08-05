import type {
  AgentSessionMeta,
  StartTodoAgentInput,
  StartTodoAgentResult,
  Todo,
  UpdateTodoInput,
} from '@proma/shared'

/**
 * Todo 与 Agent 会话分别落在 Planning JSON 和会话 JSON/工作目录中，不能假装存在跨文件事务。
 * 先创建可清理的会话，再用 Todo CAS 提交归属；后者失败时立即删除刚创建的会话。
 */
export interface TodoAgentStartOperations {
  createSession: () => AgentSessionMeta
  updateTodo: (input: UpdateTodoInput) => Todo | undefined
  deleteSession: (sessionId: string) => void
}

/**
 * 极少数清理本身失败时，保留会话 ID 让调用方和用户能够恢复，而不是静默留下孤儿会话。
 */
export class TodoAgentStartRecoveryError extends Error {
  readonly sessionId: string
  readonly todoId: string

  constructor(todoId: string, sessionId: string, cleanupError: unknown) {
    super(`启动 Todo Agent 未完成：请刷新 Todo 确认其项目归属；新建会话 ${sessionId} 未能自动清理，可在该项目会话列表中继续使用或手动删除。`)
    this.name = 'TodoAgentStartRecoveryError'
    this.todoId = todoId
    this.sessionId = sessionId
    console.error('[Todo] 启动失败后的会话清理失败:', cleanupError)
  }
}

/**
 * 在一次同步 IPC 调用内执行的两阶段可恢复写入。
 *
 * `createSession` 先执行，保证其失败时 Todo 完全不变；Todo CAS 写入失败时，
 * `deleteSession` 必须删除尚未对外发布的会话及其 session 工作目录。
 */
export function startTodoAgentWithRollback(
  existingTodo: Todo,
  input: StartTodoAgentInput,
  operations: TodoAgentStartOperations,
): StartTodoAgentResult {
  const session = operations.createSession()

  if (existingTodo.workspaceId === input.workspaceId) {
    return { todo: existingTodo, session }
  }

  try {
    const todo = operations.updateTodo({
      id: existingTodo.id,
      workspaceId: input.workspaceId,
      expectedUpdatedAt: existingTodo.updatedAt,
    })
    if (!todo) throw new Error('Todo 不存在')
    return { todo, session }
  } catch (error) {
    try {
      operations.deleteSession(session.id)
    } catch (cleanupError) {
      throw new TodoAgentStartRecoveryError(existingTodo.id, session.id, cleanupError)
    }
    throw error
  }
}
