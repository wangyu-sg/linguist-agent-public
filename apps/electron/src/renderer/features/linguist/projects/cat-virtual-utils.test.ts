import { describe, expect, test } from 'bun:test'
import {
  adjacentRowIndex,
  findNextEditableRow,
  gridRowKeyAction,
  mergeIndexedPage,
  nextSegmentId,
  pageOffsetsForRange,
  virtualRowKey,
} from './cat-virtual-utils'

describe('PB-061 virtual Segment window', () => {
  test('loads only pages intersecting the overscanned visible range', () => {
    expect(pageOffsetsForRange(0, 15, 200)).toEqual([0])
    expect(pageOffsetsForRange(195, 205, 200)).toEqual([0, 200])
    expect(pageOffsetsForRange(9_990, 9_999, 200)).toEqual([9_800])
  })

  test('uses the filtered Segment ID index as the stable virtual row key', () => {
    expect(virtualRowKey(['seg-a', 'seg-b'], 1)).toBe('seg-b')
    expect(() => virtualRowKey(['seg-a'], 1)).toThrow('Missing virtual row key')
  })

  test('merges a newly loaded or refreshed page without discarding other pages', () => {
    const first = mergeIndexedPage(new Map<number, string>(), 0, ['a', 'b'])
    const second = mergeIndexedPage(first, 200, ['c'])
    const refreshed = mergeIndexedPage(second, 0, ['A', 'B'])

    expect([...refreshed]).toEqual([[0, 'A'], [1, 'B'], [200, 'c']])
  })

  test('moves one row without leaving the Grid bounds', () => {
    expect(adjacentRowIndex(4, 'ArrowUp', 10)).toBe(3)
    expect(adjacentRowIndex(4, 'ArrowDown', 10)).toBe(5)
    expect(adjacentRowIndex(0, 'ArrowUp', 10)).toBe(0)
    expect(adjacentRowIndex(9, 'ArrowDown', 10)).toBe(9)
  })

  test('given Grid 行焦点 when 使用方向、首尾和翻页键 then 返回边界内目标行', () => {
    const action = (key: string, currentIndex = 5) => gridRowKeyAction({
      key,
      currentIndex,
      total: 20,
      pageSize: 8,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    })

    expect(action('ArrowUp')).toEqual({ type: 'focus', index: 4 })
    expect(action('ArrowDown')).toEqual({ type: 'focus', index: 6 })
    expect(action('Home')).toEqual({ type: 'focus', index: 0 })
    expect(action('End')).toEqual({ type: 'focus', index: 19 })
    expect(action('PageUp')).toEqual({ type: 'focus', index: 0 })
    expect(action('PageDown')).toEqual({ type: 'focus', index: 13 })
    expect(action('PageDown', 18)).toEqual({ type: 'focus', index: 19 })
  })

  test('given Grid 行焦点 when 请求编辑或选择 then 只接受无修饰键的 Enter/F2/Space', () => {
    const action = (
      key: string,
      patch: Partial<Parameters<typeof gridRowKeyAction>[0]> = {},
    ) => gridRowKeyAction({
      key,
      currentIndex: 2,
      total: 5,
      pageSize: 8,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      ...patch,
    })

    expect(action('Enter')).toEqual({ type: 'edit' })
    expect(action('F2')).toEqual({ type: 'edit' })
    expect(action(' ')).toEqual({ type: 'toggle-selection' })
    expect(action('Enter', { metaKey: true })).toBeNull()
    expect(action('ArrowDown', { altKey: true })).toBeNull()
  })

  test('finds the next matching Segment and wraps once', () => {
    expect(nextSegmentId(['seg-a', 'seg-b', 'seg-c'], 'seg-a')).toBe('seg-b')
    expect(nextSegmentId(['seg-a', 'seg-b', 'seg-c'], 'seg-c')).toBe('seg-a')
    expect(nextSegmentId(['seg-a'], 'seg-missing')).toBe('seg-a')
    expect(nextSegmentId([], 'seg-a')).toBeUndefined()
  })

  test('given 当前批次含锁定和未加载行 when 确认并前进 then 只在批次边界内找下一可编辑行', () => {
    const rows = new Map([
      [0, { assetId: 'asset-a', locked: false }],
      [1, { assetId: 'asset-a', locked: true }],
      [2, { assetId: 'asset-a', locked: false }],
      [3, { assetId: 'asset-b', locked: false }],
    ])

    expect(findNextEditableRow(rows, 0, 'asset-a', 4)).toEqual({ kind: 'found', index: 2 })
    expect(findNextEditableRow(rows, 2, 'asset-a', 4)).toEqual({ kind: 'end' })
    expect(findNextEditableRow(rows, 0, 'asset-a', 1)).toEqual({ kind: 'end' })
    expect(findNextEditableRow(new Map([[0, rows.get(0)!]]), 0, 'asset-a', 4))
      .toEqual({ kind: 'load', index: 1 })
  })
})
