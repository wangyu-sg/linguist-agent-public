import { describe, expect, test } from 'bun:test'
import { createLinguistTurnContextV1 } from '@proma/shared'
import type { AgentPendingPrompt } from '@/atoms/agent-atoms'
import { buildAgentPendingPromptTurn } from './AgentView'

describe('AgentView pending prompt 自动发送', () => {
  test('given 项目快捷动作 pending prompt when 自动发送 then optimistic message 与 AgentSendInput 复用同一冻结 Context', () => {
    const context = createLinguistTurnContextV1({
      projectId: 'prj-0000000000000001',
      activeSegmentId: 'seg-0000000000000001',
      selectedSegmentIds: ['seg-0000000000000001'],
      capturedAt: '2026-07-27T08:00:00.000Z',
      uiRevision: 3,
    }).context
    const pendingPrompt: AgentPendingPrompt = {
      sessionId: 'session-1',
      message: '请翻译当前已选 1 个片段。',
      linguistContext: context,
    }

    const turn = buildAgentPendingPromptTurn(
      pendingPrompt,
      {
        sessionId: 'session-1',
        channelId: 'channel-1',
        agentRuntime: 'pi',
        startedAt: 123,
      },
      123,
    )

    expect(turn.optimisticMessage.linguistContext).toBe(context)
    expect(turn.sendInput.linguistContext).toBe(context)
    expect(turn.optimisticMessage.message?.content).toEqual([
      { type: 'text', text: pendingPrompt.message },
    ])
    expect(turn.sendInput.userMessage).toBe(pendingPrompt.message)
  })

  test('given 普通 Agent pending prompt when 自动发送 then 保持无 Linguist Context', () => {
    const pendingPrompt: AgentPendingPrompt = {
      sessionId: 'session-1',
      message: '整理工作区记忆',
    }

    const turn = buildAgentPendingPromptTurn(
      pendingPrompt,
      {
        sessionId: 'session-1',
        channelId: 'channel-1',
        agentRuntime: 'pi',
        startedAt: 123,
      },
      123,
    )

    expect(turn.optimisticMessage.linguistContext).toBeUndefined()
    expect(turn.sendInput.linguistContext).toBeUndefined()
  })
})
