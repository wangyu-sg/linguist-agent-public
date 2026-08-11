import { describe, expect, test } from 'bun:test'
import { asAssetId, asSegmentId } from './ids'
import { createProject } from './project'
import type { Segment } from './segment'
import {
  confirmCurrentStage,
  nativeStatusForStage,
  recordCurrentStageDecision,
  unconfirmCurrentStage,
} from './workflow'

describe('本地化工作流状态映射', () => {
  test('按 T/E/P 当前阶段映射 SDLXLIFF 的确认状态', () => {
    expect(nativeStatusForStage('translation', 'sdlxliff')).toBe('Translated')
    expect(nativeStatusForStage('editing', 'sdlxliff')).toBe('ApprovedTranslation')
    expect(nativeStatusForStage('proofreading', 'sdlxliff')).toBe('ApprovedSignOff')
  })

  test('项目独立保存当前任务阶段和输出状态策略', () => {
    const project = createProject(
      {
        name: '审校项目',
        sourceLocale: 'zh-CN',
        targetLocale: 'en-US',
        promaWorkspaceId: 'workspace-1',
        workflowStage: 'editing',
        outputStatusPolicy: {
          sdlxliff: { editing: 'ApprovedSignOff' },
        },
      },
      {
        now: '2026-07-29T00:00:00.000Z',
        entropy: () => new Uint8Array([1]),
      },
    )

    expect(project.workflowStage).toBe('editing')
    expect(project.outputStatusPolicy?.sdlxliff?.editing).toBe('ApprovedSignOff')
  })

  test('E 阶段导入的 Translated 译文仍待审校，确认和撤销只改变本轮状态', () => {
    const segment: Segment = {
      id: asSegmentId('seg-0000000000000001'),
      assetId: asAssetId('ast-0000000000000001'),
      ordinal: 0,
      source: '源文',
      target: 'Existing target',
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      status: 'translated',
      currentStageState: 'untouched',
      importedNativeStatus: 'Translated',
      locked: false,
      revision: 3,
      sourceHash: 'source-hash',
    }

    const confirmed = confirmCurrentStage(segment, 'editing', 3, {
      actor: 'reviewer',
      now: '2026-07-29T01:00:00.000Z',
    })
    expect(confirmed.segment.currentStageState).toBe('confirmed')
    expect(confirmed.segment.status).toBe('translated')
    expect(confirmed.segment.revision).toBe(3)
    expect(confirmed.event).toEqual({
      stage: 'editing',
      action: 'confirmed',
      segmentRevision: 3,
      actor: 'reviewer',
      createdAt: '2026-07-29T01:00:00.000Z',
    })
    expect(() => confirmCurrentStage(confirmed.segment, 'editing', 3)).toThrow(
      'Invalid segment-stage state transition',
    )

    const reopened = unconfirmCurrentStage(confirmed.segment, 'editing', 3, {
      actor: 'reviewer',
      now: '2026-07-29T01:01:00.000Z',
    })
    expect(reopened.segment.currentStageState).toBe('draft')
    expect(reopened.event.action).toBe('unconfirmed')
    expect(() => unconfirmCurrentStage(reopened.segment, 'editing', 3)).toThrow(
      'Invalid segment-stage state transition',
    )
  })

  test('岗位 decision 复用阶段事件：确认可审计，blocked 不伪造文本 revision', () => {
    const segment: Segment = {
      id: asSegmentId('seg-0000000000000002'),
      assetId: asAssetId('ast-0000000000000001'),
      ordinal: 1,
      source: 'Source',
      target: 'Target',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      currentStageState: 'untouched',
      locked: false,
      revision: 4,
      sourceHash: 'source-hash-2',
    }

    const unchanged = recordCurrentStageDecision(segment, 'editing', 4, 'unchanged', {
      actor: 'review-session',
      now: '2026-08-11T00:00:00.000Z',
    })
    expect(unchanged.segment.currentStageState).toBe('confirmed')
    expect(unchanged.event.action).toBe('unchanged')
    expect(unchanged.event.segmentRevision).toBe(4)

    const blocked = recordCurrentStageDecision(
      { ...segment, locked: true },
      'editing',
      3,
      'blocked',
      { now: '2026-08-11T00:01:00.000Z' },
    )
    expect(blocked.segment.currentStageState).toBe('draft')
    expect(blocked.segment.revision).toBe(4)
    expect(blocked.event).toMatchObject({
      action: 'blocked',
      segmentRevision: 4,
    })
  })
})
