import { describe, expect, test } from 'bun:test'
import {
  createLinguistTurnContextV1,
  LINGUIST_TURN_CONTEXT_SELECTED_SEGMENT_LIMIT,
  parseLinguistTurnContextV1,
  serializeLinguistTurnContextV1,
} from './linguist-turn-context'

const VALID_CONTEXT = {
  schemaVersion: 1,
  projectId: 'prj-0123456789abcdef',
  assetId: 'ast-0123456789abcdef',
  activeSegmentId: 'seg-0123456789abcdef',
  selectedSegmentIds: [
    'seg-0123456789abcdef',
    'seg-fedcba9876543210',
  ],
  activeQaFindingId: 'qaf-0123456789abcdef',
  capturedAt: '2026-07-27T08:00:00.000Z',
  uiRevision: 7,
} as const

describe('LinguistTurnContextV1', () => {
  test('Given 合法项目 UI 上下文 When 解析 Then 返回冻结的 V1 快照', () => {
    const result = parseLinguistTurnContextV1(VALID_CONTEXT)

    expect(result.selectionTruncated).toBe(false)
    expect(result.context).toEqual(VALID_CONTEXT)
    expect(Object.isFrozen(result.context)).toBe(true)
    expect(Object.isFrozen(result.context.selectedSegmentIds)).toBe(true)
  })

  test('Given Project-only 上下文 When 解析 Then 允许缺少资产、片段和 QA', () => {
    const result = parseLinguistTurnContextV1({
      schemaVersion: 1,
      projectId: VALID_CONTEXT.projectId,
      selectedSegmentIds: [],
      capturedAt: VALID_CONTEXT.capturedAt,
      uiRevision: 0,
    })

    expect(result.context).toEqual({
      schemaVersion: 1,
      projectId: VALID_CONTEXT.projectId,
      selectedSegmentIds: [],
      capturedAt: VALID_CONTEXT.capturedAt,
      uiRevision: 0,
    })
  })

  test('Given Workbench 状态 When 构建 Then 生成同一严格契约且不携带额外 UI 状态', () => {
    const result = createLinguistTurnContextV1({
      projectId: VALID_CONTEXT.projectId,
      assetId: VALID_CONTEXT.assetId,
      activeSegmentId: VALID_CONTEXT.activeSegmentId,
      selectedSegmentIds: VALID_CONTEXT.selectedSegmentIds,
      activeQaFindingId: VALID_CONTEXT.activeQaFindingId,
      capturedAt: VALID_CONTEXT.capturedAt,
      uiRevision: VALID_CONTEXT.uiRevision,
    })

    expect(result.context).toEqual(VALID_CONTEXT)
    expect(Object.keys(result.context)).toEqual([
      'schemaVersion',
      'projectId',
      'assetId',
      'activeSegmentId',
      'selectedSegmentIds',
      'activeQaFindingId',
      'capturedAt',
      'uiRevision',
    ])
  })

  test('Given 未知字段或版本 When 解析 Then fail closed', () => {
    expect(() => parseLinguistTurnContextV1({
      ...VALID_CONTEXT,
      sourceText: '客户正文',
    })).toThrow('unknown field')
    expect(() => parseLinguistTurnContextV1({
      ...VALID_CONTEXT,
      schemaVersion: 2,
    })).toThrow('schemaVersion')
  })

  test('Given 必填项缺失或 optional 字段显式为 undefined When 解析 Then 拒绝', () => {
    const { selectedSegmentIds: _selectedSegmentIds, ...missingSelection } = VALID_CONTEXT
    expect(() => parseLinguistTurnContextV1(missingSelection)).toThrow('selectedSegmentIds')
    expect(() => parseLinguistTurnContextV1({
      ...VALID_CONTEXT,
      assetId: undefined,
    })).toThrow('assetId')
  })

  test('Given 绝对路径或正文冒充 ID When 解析 Then 拒绝', () => {
    expect(() => parseLinguistTurnContextV1({
      ...VALID_CONTEXT,
      assetId: '/Users/customer/source.xliff',
    })).toThrow('assetId')
    expect(() => parseLinguistTurnContextV1({
      ...VALID_CONTEXT,
      activeSegmentId: 'Welcome to the game',
    })).toThrow('activeSegmentId')
  })

  test('Given selected IDs 超上限 When 解析 Then 有界截断并明确标记', () => {
    const selectedSegmentIds = Array.from(
      { length: LINGUIST_TURN_CONTEXT_SELECTED_SEGMENT_LIMIT + 3 },
      (_, index) => `seg-${index.toString(16).padStart(16, '0')}`,
    )

    const result = parseLinguistTurnContextV1({
      ...VALID_CONTEXT,
      selectedSegmentIds,
    })

    expect(result.selectionTruncated).toBe(true)
    expect(result.context.selectedSegmentIds).toHaveLength(
      LINGUIST_TURN_CONTEXT_SELECTED_SEGMENT_LIMIT,
    )
    expect(result.context.selectedSegmentIds.at(-1)).toBe(
      selectedSegmentIds[LINGUIST_TURN_CONTEXT_SELECTED_SEGMENT_LIMIT - 1],
    )
  })

  test('Given 同一语义但键顺序不同 When 序列化 Then 字节确定一致', () => {
    const shuffled = {
      uiRevision: VALID_CONTEXT.uiRevision,
      capturedAt: VALID_CONTEXT.capturedAt,
      activeQaFindingId: VALID_CONTEXT.activeQaFindingId,
      selectedSegmentIds: [...VALID_CONTEXT.selectedSegmentIds],
      activeSegmentId: VALID_CONTEXT.activeSegmentId,
      assetId: VALID_CONTEXT.assetId,
      projectId: VALID_CONTEXT.projectId,
      schemaVersion: VALID_CONTEXT.schemaVersion,
    }

    expect(serializeLinguistTurnContextV1(shuffled)).toBe(
      serializeLinguistTurnContextV1(VALID_CONTEXT),
    )
  })
})
