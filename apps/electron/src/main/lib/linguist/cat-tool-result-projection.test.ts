import { describe, expect, test } from 'bun:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { projectCatToolResultsForModel } from './cat-tool-result-projection'

function toolResult(
  toolName: string,
  details: unknown,
): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName,
    content: [{ type: 'text', text: 'CAT tool result. records=1' }],
    details,
    isError: false,
    timestamp: 1,
  }
}

describe('CAT 工具模型投影', () => {
  test('只临时展开 CAT details，普通工具与原始历史保持不变', () => {
    const cat = toolResult('cat_get_translation_context', {
      contexts: [{ source: 'Source', currentTarget: '译文' }],
    })
    const ordinary = toolResult('Read', { private: 'not for model' })
    const messages = [cat, ordinary]

    const projected = projectCatToolResultsForModel(messages)

    expect(projected[0]).not.toBe(cat)
    expect(projected[0]).toMatchObject({
      content: [{
        type: 'text',
        text: '{"contexts":[{"source":"Source","currentTarget":"译文"}]}',
      }],
    })
    expect(projected[1]).toBe(ordinary)
    expect(cat).toMatchObject({
      content: [{ type: 'text', text: 'CAT tool result. records=1' }],
    })
  })

  test('不可序列化 details 安全保留短摘要', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const message = toolResult('cat_project_summary', circular)

    expect(projectCatToolResultsForModel([message])[0]).toBe(message)
  })
})
