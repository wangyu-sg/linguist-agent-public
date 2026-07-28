import { describe, expect, test } from 'bun:test'
import { createLinguistTurnContextV1 } from '@proma/shared'
import {
  createAgentQueuedMessage,
  restoreQueuedMessageToFront,
} from './agent-message-queue'

describe('Agent 消息队列', () => {
  test('given Linguist Turn 在点击时入队 when Workbench 后续变化或消息被 steer then 沿用原冻结快照', () => {
    const snapshot = createLinguistTurnContextV1({
      projectId: 'prj-0123456789abcdef',
      selectedSegmentIds: ['seg-0123456789abcdef'],
      capturedAt: '2026-07-27T08:00:00.000Z',
      uiRevision: 3,
    }).context
    const message = createAgentQueuedMessage('翻译所选片段', 'message-1', 1, null, {
      linguistContext: snapshot,
    })

    const restored = restoreQueuedMessageToFront([], message)[0]!

    expect(restored.linguistContext).toBe(snapshot)
    expect(restored.linguistContext?.selectedSegmentIds).toEqual([
      'seg-0123456789abcdef',
    ])
    expect(Object.isFrozen(restored.linguistContext)).toBe(true)
  })
})
