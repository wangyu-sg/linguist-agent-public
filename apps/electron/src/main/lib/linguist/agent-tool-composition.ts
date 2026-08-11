import { createHash } from 'node:crypto'
import type { AgentProfile } from '@proma/shared'

export interface AgentToolCompositionResult<TTool> {
  baseTools: readonly TTool[]
  overlayTools: readonly TTool[]
  mergedTools: readonly TTool[]
}

/** Base 始终原样继承；Linguist 只追加 overlay，任何重名都 fail loud。 */
export function composeAgentTools<TTool extends { name: string }>(
  profile: AgentProfile,
  baseTools: readonly TTool[],
  buildLinguistOverlay: (
    profile: Extract<AgentProfile, { kind: 'linguist' }>,
  ) => readonly TTool[],
): AgentToolCompositionResult<TTool> {
  const base = [...baseTools]
  const overlay = profile.kind === 'linguist'
    ? [...buildLinguistOverlay(profile)]
    : []
  const merged: TTool[] = []
  const names = new Set<string>()

  for (const tool of [...base, ...overlay]) {
    if (names.has(tool.name)) {
      throw new Error(`[Agent tools] 工具名称冲突: ${tool.name}`)
    }
    names.add(tool.name)
    merged.push(tool)
  }

  return {
    baseTools: base,
    overlayTools: overlay,
    mergedTools: merged,
  }
}

/** 对宿主本轮实际装配的工具名、MCP server 与原生 preset 做稳定摘要。 */
export function hashAgentToolComposition(input: {
  toolNames: readonly string[]
  mcpServerNames: readonly string[]
}): string {
  return createHash('sha256').update(JSON.stringify({
    toolNames: [...new Set(input.toolNames)].sort(),
    mcpServerNames: [...new Set(input.mcpServerNames)].sort(),
  })).digest('hex')
}
