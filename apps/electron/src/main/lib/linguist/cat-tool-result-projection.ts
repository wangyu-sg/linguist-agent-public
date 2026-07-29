import type { AgentMessage } from '@earendil-works/pi-agent-core'

function stringifyDetails(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/**
 * CAT 结果在磁盘上只保留短 content + 单份 details；发给模型前临时展开，
 * 避免持久化两份可能很大的项目 DTO。
 */
export function projectCatToolResultsForModel(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (message.role !== 'toolResult' || !message.toolName.startsWith('cat_')) return message
    const details = stringifyDetails(message.details)
    return details === undefined
      ? message
      : { ...message, content: [{ type: 'text', text: details }] }
  })
}
