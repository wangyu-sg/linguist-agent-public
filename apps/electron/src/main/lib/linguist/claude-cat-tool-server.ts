import { randomUUID } from 'node:crypto'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { z } from 'zod'

export const LINGUIST_CAT_MCP_SERVER_NAME = 'linguist_cat'
const CLAUDE_CAT_MCP_PREFIX = `mcp__${LINGUIST_CAT_MCP_SERVER_NAME}__`
type AnyToolDefinition = ToolDefinition<any, any, any>
type SdkToolResult = Awaited<ReturnType<SdkMcpToolDefinition<any>['handler']>>

export function isClaudeCatMcpTool(toolName: string): boolean {
  return toolName.startsWith(CLAUDE_CAT_MCP_PREFIX)
}

/** Plan 模式只放行命名契约明确的读取工具；新增或未知 CAT 工具默认拒绝。 */
export function isReadOnlyClaudeCatMcpTool(toolName: string): boolean {
  if (!isClaudeCatMcpTool(toolName)) return false
  const name = toolName.slice(CLAUDE_CAT_MCP_PREFIX.length)
  return name === 'cat_project_summary'
    || name === 'cat_plan_consistency_repairs'
    || /^cat_(?:get|list|search|read)_/.test(name)
}

function toolCallId(extra: unknown): string {
  if (extra !== null && typeof extra === 'object') {
    const requestId = Reflect.get(extra, 'requestId')
    if (typeof requestId === 'string' || typeof requestId === 'number') {
      return `claude:${requestId}`
    }
  }
  return `claude:${randomUUID()}`
}

function abortSignal(extra: unknown): AbortSignal | undefined {
  if (extra === null || typeof extra !== 'object') return undefined
  const signal = Reflect.get(extra, 'signal')
  return signal instanceof AbortSignal ? signal : undefined
}

/** 将同一份 CAT ToolDefinition 投影为 Claude SDK 的进程内 MCP Tool。 */
export function createClaudeCatSdkTools(
  tools: readonly AnyToolDefinition[],
): Array<SdkMcpToolDefinition<any>> {
  return tools.map((tool) => {
    const schema = z.fromJSONSchema(
      tool.parameters as Parameters<typeof z.fromJSONSchema>[0],
    )
    if (!(schema instanceof z.ZodObject)) {
      throw new Error(`[Linguist CAT] Claude MCP 工具参数必须是对象: ${tool.name}`)
    }

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: schema.shape,
      async handler(args, extra) {
        const params = schema.parse(args)
        const result = await tool.execute(
          toolCallId(extra),
          params,
          abortSignal(extra),
          undefined,
          {} as never,
        )
        const details = result.details
        const structuredContent: Record<string, unknown> | undefined = details === undefined
          ? undefined
          : details !== null && typeof details === 'object' && !Array.isArray(details)
            ? details as Record<string, unknown>
            : { result: details }
        const output: SdkToolResult = {
          content: result.content as SdkToolResult['content'],
          ...(details === undefined
            ? {}
            : { structuredContent }),
        }
        return output
      },
    }
  })
}

export async function createClaudeCatMcpServer(tools: readonly AnyToolDefinition[]) {
  const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk')
  return createSdkMcpServer({
    name: LINGUIST_CAT_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: createClaudeCatSdkTools(tools),
  })
}

/** Claude 的既有 Proma MCP 原样继承；Overlay 重名时拒绝静默覆盖。 */
export function mergeClaudeMcpServers(
  base: Readonly<Record<string, unknown>>,
  overlay: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  for (const name of Object.keys(overlay)) {
    if (Object.hasOwn(base, name)) {
      throw new Error(`[Agent MCP] Server 名称冲突: ${name}`)
    }
  }
  return { ...base, ...overlay }
}
