import { describe, expect, test } from 'bun:test'
import { composeAgentTools, hashAgentToolComposition } from './agent-tool-composition'

const canary = { name: 'proma_canary_tool' }
const catTool = { name: 'cat_project_summary' }

describe('composeAgentTools', () => {
  test('Given Proma 新增基础工具 When 组合 General/Linguist Then 两者自动继承且仅 Linguist 有 CAT overlay', () => {
    const general = composeAgentTools(
      { kind: 'general' },
      [canary],
      () => [catTool],
    )
    const linguist = composeAgentTools(
      {
        kind: 'linguist',
        projectId: 'project-1',
        role: 'assistant',
        executionPolicy: { independentReview: 'off' },
      },
      [canary],
      () => [catTool],
    )

    expect(general.mergedTools.map(({ name }) => name)).toEqual(['proma_canary_tool'])
    expect(linguist.mergedTools.map(({ name }) => name)).toEqual([
      'proma_canary_tool',
      'cat_project_summary',
    ])
  })

  test('Given Base 与 Overlay 重名 When 组合 Then 明确失败而非静默覆盖', () => {
    expect(() => composeAgentTools(
      {
        kind: 'linguist',
        projectId: 'project-1',
        role: 'assistant',
        executionPolicy: { independentReview: 'off' },
      },
      [catTool],
      () => [catTool],
    )).toThrow('cat_project_summary')
  })

  test('真实工具组合摘要与输入顺序无关，组合变化会改变 hash', () => {
    const first = hashAgentToolComposition({
      runtime: 'claude',
      basePreset: 'claude_code',
      toolNames: ['cat_run_qa', 'cat_project_summary'],
      mcpServerNames: ['linguist_cat', 'browser'],
    })
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(hashAgentToolComposition({
      runtime: 'claude',
      basePreset: 'claude_code',
      toolNames: ['cat_project_summary', 'cat_run_qa'],
      mcpServerNames: ['browser', 'linguist_cat'],
    })).toBe(first)
    expect(hashAgentToolComposition({
      runtime: 'pi',
      toolNames: ['cat_project_summary'],
      mcpServerNames: [],
    })).not.toBe(first)
  })
})
