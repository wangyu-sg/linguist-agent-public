import { describe, expect, mock, test } from 'bun:test'
import type { AgentSessionMeta, StartTodoAgentInput, Todo } from '@proma/shared'
import {
  TodoAgentStartRecoveryError,
  startTodoAgentWithRollback,
} from './todo-agent-start'

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'todo-1',
    title: '核对本地化资源',
    status: 'open',
    priority: 'medium',
    createdAt: 100,
    updatedAt: 101,
    ...overrides,
    tags: overrides.tags ?? [],
    reminders: overrides.reminders ?? [],
    sessionLinks: overrides.sessionLinks ?? [],
  }
}

function input(overrides: Partial<StartTodoAgentInput> = {}): StartTodoAgentInput {
  return {
    todoId: 'todo-1',
    workspaceId: 'workspace-1',
    expectedUpdatedAt: 101,
    channelId: 'channel-1',
    ...overrides,
  }
}

const session = { id: 'session-1', title: '处理：核对本地化资源' } as AgentSessionMeta

describe('Todo → Agent 启动的可恢复顺序', () => {
  test('Given 会话创建失败 When 启动 Todo Agent Then 不会预先修改 Todo', () => {
    const updateTodo = mock(() => todo({ workspaceId: 'workspace-1', updatedAt: 102 }))
    const deleteSession = mock(() => {})

    expect(() => startTodoAgentWithRollback(todo(), input(), {
      createSession: () => { throw new Error('模拟会话目录不可写') },
      updateTodo,
      deleteSession,
    })).toThrow('模拟会话目录不可写')

    expect(updateTodo).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
  })

  test('Given Todo CAS 写入失败 When 会话已创建 Then 删除该半成品会话', () => {
    const updateTodo = mock(() => { throw new Error('Todo 已在其他窗口更新') })
    const deleteSession = mock(() => {})

    expect(() => startTodoAgentWithRollback(todo(), input(), {
      createSession: () => session,
      updateTodo,
      deleteSession,
    })).toThrow('Todo 已在其他窗口更新')

    expect(updateTodo).toHaveBeenCalledWith({
      id: 'todo-1',
      workspaceId: 'workspace-1',
      expectedUpdatedAt: 101,
    })
    expect(deleteSession).toHaveBeenCalledWith('session-1')
  })

  test('Given Todo 写入和清理都失败 When 启动 Todo Agent Then 返回带会话 ID 的可恢复错误', () => {
    let thrown: unknown
    const originalConsoleError = console.error
    try {
      console.error = () => {}
      try {
        startTodoAgentWithRollback(todo(), input(), {
          createSession: () => session,
          updateTodo: () => { throw new Error('Todo 已在其他窗口更新') },
          deleteSession: () => { throw new Error('模拟删除索引失败') },
        })
      } catch (error) {
        thrown = error
      }
    } finally {
      console.error = originalConsoleError
    }

    expect(thrown).toBeInstanceOf(TodoAgentStartRecoveryError)
    expect((thrown as TodoAgentStartRecoveryError).sessionId).toBe('session-1')
    expect((thrown as Error).message).toContain('刷新 Todo')
  })
})
