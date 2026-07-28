import { describe, expect, test } from 'bun:test'
import {
  acceptProposal,
  applyTargetEdit,
  archiveProject,
  createAsset,
  createProject,
  createProposal,
  createSeededEntropy,
  openQaFinding,
  type LinguistProject,
  type QaFinding,
  type Segment,
  type SegmentRevision,
  type TranslationProposal,
} from './index'
import { makeSegment } from './segment.test'

const NOW = '2026-07-25T00:00:00.000Z'

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('JSON 序列化往返', () => {
  test('LinguistProject（含 archivedAt 可选字段）', () => {
    const project = createProject(
      { name: 'Demo', sourceLocale: 'en-US', targetLocale: 'zh-CN', promaWorkspaceId: 'ws-1' },
      { entropy: createSeededEntropy('proj'), now: NOW },
    )
    expect(roundTrip(project)).toEqual(project)
    const archived = archiveProject(project, NOW)
    expect(roundTrip(archived)).toEqual(archived)
    // 类型层面 schemaVersion 恒为 1
    const parsed: LinguistProject = roundTrip(archived)
    expect(parsed.schemaVersion).toBe(1)
  })

  test('Asset', () => {
    const project = createProject(
      { name: 'Demo', sourceLocale: 'en-US', targetLocale: 'zh-CN', promaWorkspaceId: 'ws-1' },
      { entropy: createSeededEntropy('proj'), now: NOW },
    )
    const asset = createAsset({
      projectId: project.id,
      formatId: 'phrase_mxliff',
      originalFilename: 'ui.xlf',
      sourceSha256: 'deadbeef',
      segmentCount: 3,
    })
    expect(roundTrip(asset)).toEqual(asset)
  })

  test('Segment（含 context）+ SegmentRevision', () => {
    const seg: Segment = {
      ...makeSegment({
        key: 'menu.file',
        context: { note: '主菜单', origin: 'res/menu.xml', meta: { maxLen: '20' } },
      }),
    }
    expect(roundTrip(seg)).toEqual(seg)

    const { revision } = applyTargetEdit(seg, '文件', 0, { now: NOW })
    const history: SegmentRevision[] = [revision]
    expect(roundTrip(history)).toEqual(history)
  })

  test('TranslationProposal（全生命周期状态）', () => {
    const seg = makeSegment()
    const pending = createProposal({
      segmentId: seg.id,
      baseRevision: 0,
      proposedTarget: '你好',
      evidenceRefs: ['tm:entry-1'],
      termRefs: ['tb:file'],
      warnings: ['数字未校验'],
      modelId: 'fake-model',
      sessionId: 'sess-1',
      now: NOW,
    })
    expect(roundTrip(pending)).toEqual(pending)

    const { proposal: accepted } = acceptProposal(seg, pending, { now: NOW })
    expect(roundTrip(accepted)).toEqual(accepted)
    const parsed: TranslationProposal = roundTrip(accepted)
    expect(parsed.status).toBe('accepted')
  })

  test('QaFinding', () => {
    const seg = makeSegment()
    const finding = openQaFinding({
      segmentId: seg.id,
      code: 'NUMBER_MISMATCH',
      severity: 'L1',
      message: '数字不一致',
    })
    expect(roundTrip(finding)).toEqual(finding)
    const parsed: QaFinding = roundTrip(finding)
    expect(parsed.severity).toBe('L1')
  })
})
