import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import {
  createClaudeCatSdkTools,
  isClaudeCatMcpTool,
  isReadOnlyClaudeCatMcpTool,
  mergeClaudeMcpServers,
} from './claude-cat-tool-server'

describe('Claude Linguist CAT MCP overlay', () => {
  test('Given Pi CAT Tool When 适配 Claude SDK Then 保留 schema 并投影结构化结果', async () => {
    const calls: unknown[] = []
    const [tool] = createClaudeCatSdkTools([{
      name: 'cat_canary',
      label: 'CAT Canary',
      description: 'CAT canary',
      parameters: Type.Object({
        segmentId: Type.String({ minLength: 1 }),
      }),
      async execute(toolCallId, params) {
        calls.push({ toolCallId, params })
        return {
          content: [{ type: 'text', text: 'ok' }],
          details: { segmentId: (params as { segmentId: string }).segmentId },
        }
      },
    }])

    expect(tool?.name).toBe('cat_canary')
    await expect(tool!.handler({ segmentId: '' }, {})).rejects.toThrow()
    const result = await tool!.handler({ segmentId: 'seg-1' }, { requestId: 'req-1' })
    expect(calls).toEqual([{
      toolCallId: 'claude:req-1',
      params: { segmentId: 'seg-1' },
    }])
    expect(result).toEqual({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { segmentId: 'seg-1' },
    })
  })

  test('Given Proma MCP 与 Linguist Overlay When 合并 Then 继承 Base 且重名 fail loud', () => {
    const base = { proma: { type: 'stdio' } }
    const overlay = { linguist_cat: { type: 'sdk' } }

    expect(mergeClaudeMcpServers(base, overlay)).toEqual({
      proma: { type: 'stdio' },
      linguist_cat: { type: 'sdk' },
    })
    expect(() => mergeClaudeMcpServers(
      { linguist_cat: { type: 'http' } },
      overlay,
    )).toThrow('linguist_cat')
  })

  test('Given Claude CAT MCP 名称 When 判定 Plan 权限 Then 未知和写工具默认拒绝', () => {
    expect(isClaudeCatMcpTool('mcp__linguist_cat__cat_get_translation_context')).toBe(true)
    expect(isReadOnlyClaudeCatMcpTool('mcp__linguist_cat__cat_get_translation_context')).toBe(true)
    expect(isReadOnlyClaudeCatMcpTool('mcp__linguist_cat__cat_project_summary')).toBe(true)
    expect(isReadOnlyClaudeCatMcpTool('mcp__linguist_cat__cat_plan_consistency_repairs')).toBe(true)
    expect(isReadOnlyClaudeCatMcpTool('mcp__linguist_cat__cat_create_consistency_proposals')).toBe(false)
    expect(isReadOnlyClaudeCatMcpTool('mcp__linguist_cat__cat_propose_translations')).toBe(false)
    expect(isReadOnlyClaudeCatMcpTool('mcp__linguist_cat__cat_future_unknown')).toBe(false)
    expect(isClaudeCatMcpTool('mcp__other__cat_get_segments')).toBe(false)
  })
})
