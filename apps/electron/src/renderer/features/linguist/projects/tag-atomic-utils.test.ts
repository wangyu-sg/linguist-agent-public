import { describe, expect, test } from 'bun:test'
import type { LinguistTagProfileInfo } from '@proma/shared'
import {
  extendSelectionOverHardSpans,
  hardSpanForUnitDeletion,
  listTargetTagSpans,
  skipHardSpanForArrow,
  snapCaretOutOfHardSpan,
} from './tag-atomic-utils'

// ===== span 来源（内置族 / 项目族 PB-097 / 候选软提示）=====

describe('listTargetTagSpans 统一 span 来源', () => {
  test('内置 xml 配对族给出两个 hard span 与配对锚', () => {
    const text = '你好<b>世界</b>!'
    const spans = listTargetTagSpans(text)
    const hard = spans.filter((span) => span.protection === 'hard')
    expect(hard.map((span) => text.slice(span.start, span.end))).toEqual(['<b>', '</b>'])
    expect(hard[0]!.pairKey).not.toBeNull()
    expect(hard[0]!.pairKey).toBe(hard[1]!.pairKey)
  })

  test('内置占位符与 printf 族', () => {
    const text = '玩家 {name} 获得 %1$s'
    const spans = listTargetTagSpans(text)
    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual(['{name}', '%1$s'])
    expect(spans.every((span) => span.protection === 'hard')).toBe(true)
  })

  test('PB-097 项目族优先于内置族占 span', () => {
    const profile: LinguistTagProfileInfo = {
      families: [{ id: 'icon', pattern: '\\[Icon:[A-Za-z0-9]+\\]', class: 'singleton' }],
    }
    const spans = listTargetTagSpans('获得 [Icon:Star] 一枚', profile)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.familyId).toBe('icon')
    expect(spans[0]!.protection).toBe('hard')
  })

  test('候选正则成为 soft span，与 hard 重叠的候选被丢弃', () => {
    const profile: LinguistTagProfileInfo = {
      families: [],
      candidates: [{
        id: 'cand-1',
        name: '书名号',
        pattern: '《[^》]+》',
        kind: 'standalone',
        evidenceExampleIds: [],
        confidence: 0.6,
        explanation: '疑似占位',
        status: 'candidate',
      }],
    }
    const softOnly = listTargetTagSpans('发动《技能》攻击', profile)
    expect(softOnly).toHaveLength(1)
    expect(softOnly[0]!.protection).toBe('soft')
    // 与 hard 重叠的候选匹配不进结果（候选 <b> 与 xml span 完全重叠，被丢弃）
    const mixed = listTargetTagSpans('<b>《技能》</b>', {
      families: [],
      candidates: [{
        id: 'cand-2',
        name: '混合',
        pattern: '<b>|《[^》]+》',
        kind: 'standalone',
        evidenceExampleIds: [],
        confidence: 0.6,
        explanation: '疑似',
        status: 'candidate',
      }],
    })
    // 候选 <b> 匹配与 hard 重叠被丢弃；候选《技能》不与 hard 重叠，保留为 soft
    expect(mixed.filter((span) => span.protection === 'hard')).toHaveLength(2)
    const mixedSoft = mixed.filter((span) => span.protection === 'soft')
    expect(mixedSoft).toHaveLength(1)
    expect('<b>《技能》</b>'.slice(mixedSoft[0]!.start, mixedSoft[0]!.end)).toBe('《技能》')
    // ignored 候选不再提示
    const ignored = listTargetTagSpans('发动《技能》攻击', {
      families: [],
      candidates: [{
        id: 'cand-3',
        name: '书名号',
        pattern: '《[^》]+》',
        kind: 'standalone',
        evidenceExampleIds: [],
        confidence: 0.6,
        explanation: '疑似占位',
        status: 'ignored',
      }],
    })
    expect(ignored).toHaveLength(0)
  })

  test('emoji / surrogate pair 使用 UTF-16 下标，span 位置与 selection 同单位', () => {
    const text = '😀好<b>x</b>'
    // 😀 占两个 UTF-16 单元：<b> 从 2+1=3 开始
    const spans = listTargetTagSpans(text)
    expect(spans[0]).toMatchObject({ start: 3, end: 6 })
    expect(text.slice(3, 6)).toBe('<b>')
  })
})

// ===== 光标吸附 =====

describe('snapCaretOutOfHardSpan', () => {
  const text = '你好<b>世界</b>!'
  const spans = listTargetTagSpans(text)
  // <b> = [2,5)，世界 = [5,7)，</b> = [7,11)

  test('落在 hard span 内部吸附到最近边界', () => {
    expect(snapCaretOutOfHardSpan(3, spans)).toBe(2)
    expect(snapCaretOutOfHardSpan(4, spans)).toBe(5)
    expect(snapCaretOutOfHardSpan(9, spans)).toBe(7)
    expect(snapCaretOutOfHardSpan(10, spans)).toBe(11)
  })

  test('等距时吸附到前边界', () => {
    // [7,11) 中点 9：7-9 距离 2，11-9 距离 2 → 前边界 7
    expect(snapCaretOutOfHardSpan(9, spans)).toBe(7)
  })

  test('边界与纯文本位置不调整', () => {
    expect(snapCaretOutOfHardSpan(2, spans)).toBeNull()
    expect(snapCaretOutOfHardSpan(5, spans)).toBeNull()
    expect(snapCaretOutOfHardSpan(0, spans)).toBeNull()
    expect(snapCaretOutOfHardSpan(text.length, spans)).toBeNull()
  })

  test('soft span 不吸附', () => {
    const soft = [{ start: 1, end: 4, protection: 'soft' as const, familyId: null, pairKey: null }]
    expect(snapCaretOutOfHardSpan(2, soft)).toBeNull()
  })
})

// ===== 拖选扩展 =====

describe('extendSelectionOverHardSpans', () => {
  const text = '你好<b>世界</b>!'
  const spans = listTargetTagSpans(text)

  test('部分覆盖扩展为完整 span', () => {
    expect(extendSelectionOverHardSpans(3, 6, spans)).toEqual({ start: 2, end: 6 })
    expect(extendSelectionOverHardSpans(5, 8, spans)).toEqual({ start: 5, end: 11 })
    expect(extendSelectionOverHardSpans(3, 9, spans)).toEqual({ start: 2, end: 11 })
  })

  test('已完整覆盖或纯文本选区不调整', () => {
    expect(extendSelectionOverHardSpans(2, 5, spans)).toBeNull()
    expect(extendSelectionOverHardSpans(5, 7, spans)).toBeNull()
    expect(extendSelectionOverHardSpans(0, 2, spans)).toBeNull()
  })

  test('折叠选区返回 null（交给光标吸附）', () => {
    expect(extendSelectionOverHardSpans(3, 3, spans)).toBeNull()
  })

  test('链式扩展覆盖相邻 span', () => {
    const chained = listTargetTagSpans('<b><i>x</i></b>')
    expect(extendSelectionOverHardSpans(1, 2, chained)).toEqual({ start: 0, end: 3 })
  })
})

// ===== 方向键跨越 =====

describe('skipHardSpanForArrow', () => {
  const text = '你好<b>世界</b>!'
  const spans = listTargetTagSpans(text)

  test('边界处跨越整个 span', () => {
    expect(skipHardSpanForArrow(5, 'left', spans)).toBe(2)
    expect(skipHardSpanForArrow(2, 'right', spans)).toBe(5)
    expect(skipHardSpanForArrow(11, 'left', spans)).toBe(7)
    expect(skipHardSpanForArrow(7, 'right', spans)).toBe(11)
  })

  test('纯文本位置不跨越', () => {
    expect(skipHardSpanForArrow(6, 'left', spans)).toBeNull()
    expect(skipHardSpanForArrow(6, 'right', spans)).toBeNull()
    expect(skipHardSpanForArrow(0, 'left', spans)).toBeNull()
  })

  test('相邻 span 各自独立跨越', () => {
    const adjacent = listTargetTagSpans('<b></b>')
    // <b> = [0,3)，</b> = [3,7)
    expect(skipHardSpanForArrow(3, 'left', adjacent)).toBe(0)
    expect(skipHardSpanForArrow(3, 'right', adjacent)).toBe(7)
  })
})

// ===== 整单元删除目标 =====

describe('hardSpanForUnitDeletion', () => {
  const text = '你好<b>世界</b>!'
  const spans = listTargetTagSpans(text)

  test('Backspace 命中右边界', () => {
    expect(hardSpanForUnitDeletion(5, 'backward', spans)).toMatchObject({ start: 2, end: 5 })
    expect(hardSpanForUnitDeletion(11, 'backward', spans)).toMatchObject({ start: 7, end: 11 })
  })

  test('Delete 命中左边界', () => {
    expect(hardSpanForUnitDeletion(2, 'forward', spans)).toMatchObject({ start: 2, end: 5 })
    expect(hardSpanForUnitDeletion(7, 'forward', spans)).toMatchObject({ start: 7, end: 11 })
  })

  test('方向不匹配或纯文本位置不命中', () => {
    expect(hardSpanForUnitDeletion(2, 'backward', spans)).toBeNull()
    expect(hardSpanForUnitDeletion(5, 'forward', spans)).toBeNull()
    expect(hardSpanForUnitDeletion(6, 'backward', spans)).toBeNull()
    expect(hardSpanForUnitDeletion(6, 'forward', spans)).toBeNull()
  })

  test('soft span 不参与整单元删除', () => {
    const soft = [{ start: 1, end: 4, protection: 'soft' as const, familyId: null, pairKey: null }]
    expect(hardSpanForUnitDeletion(4, 'backward', soft)).toBeNull()
    expect(hardSpanForUnitDeletion(1, 'forward', soft)).toBeNull()
  })
})
