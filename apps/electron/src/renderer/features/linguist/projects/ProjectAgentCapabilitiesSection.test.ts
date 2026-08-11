import { describe, expect, test } from 'bun:test'
import type { WorkspaceCapabilities } from '@proma/shared'
import { describeCapabilities } from './ProjectAgentCapabilitiesSection'

function capabilities(partial?: {
  skills?: Array<{ enabled: boolean }>
  mcp?: Array<{ enabled: boolean }>
  agentsMdSize?: number
}): WorkspaceCapabilities {
  return {
    skills: (partial?.skills ?? []).map((skill, index) => ({
      slug: `skill-${index}`,
      name: `Skill ${index}`,
      enabled: skill.enabled,
    })),
    mcpServers: (partial?.mcp ?? []).map((server, index) => ({
      name: `server-${index}`,
      enabled: server.enabled,
      type: 'stdio' as const,
    })),
    builtinMcpServers: [],
    memory: {
      agentsMd: { path: '/managed/workspace/AGENTS.md', size: partial?.agentsMdSize ?? 0, exists: (partial?.agentsMdSize ?? 0) > 0 },
      autoMemory: {
        directory: '/managed/workspace/memory',
        memoryMdExists: false,
        fileCount: 0,
        totalSize: 0,
      },
    },
  }
}

describe('describeCapabilities（K3 Agent 能力区文案）', () => {
  test('Skills / MCP 只统计已启用，AGENTS.md 按内容存在与否', () => {
    expect(describeCapabilities(capabilities({
      skills: [{ enabled: true }, { enabled: false }, { enabled: true }, { enabled: true }, { enabled: true }, { enabled: false }],
      mcp: [{ enabled: true }, { enabled: true }, { enabled: false }],
      agentsMdSize: 128,
    }))).toEqual({
      skills: '4 已启用',
      mcp: '2 已启用',
      agentsMd: '已配置',
    })
  })

  test('空工作区显示 0 已启用与未配置', () => {
    expect(describeCapabilities(capabilities())).toEqual({
      skills: '0 已启用',
      mcp: '0 已启用',
      agentsMd: '未配置',
    })
  })
})
