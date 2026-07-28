export function pageOffsetsForRange(start: number, end: number, pageSize: number): number[] {
  const first = Math.floor(start / pageSize) * pageSize
  const last = Math.floor(end / pageSize) * pageSize
  const offsets: number[] = []
  for (let offset = first; offset <= last; offset += pageSize) offsets.push(offset)
  return offsets
}

export function mergeIndexedPage<T>(
  rows: ReadonlyMap<number, T>,
  offset: number,
  items: readonly T[],
): Map<number, T> {
  const merged = new Map(rows)
  items.forEach((item, index) => merged.set(offset + index, item))
  return merged
}

export function virtualRowKey(segmentIds: readonly string[], index: number): string {
  const id = segmentIds[index]
  if (id === undefined) throw new Error(`Missing virtual row key at index ${index}`)
  return id
}

export function adjacentRowIndex(
  current: number,
  key: 'ArrowUp' | 'ArrowDown',
  total: number,
): number {
  return Math.max(0, Math.min(total - 1, current + (key === 'ArrowUp' ? -1 : 1)))
}

export interface GridRowKeyInput {
  key: string
  currentIndex: number
  total: number
  pageSize: number
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

type GridRowKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'edit' }
  | { type: 'toggle-selection' }

export function gridRowKeyAction(input: GridRowKeyInput): GridRowKeyAction | null {
  if (input.total <= 0 || input.metaKey || input.ctrlKey || input.altKey) return null
  const lastIndex = input.total - 1
  const clamp = (index: number): number => Math.max(0, Math.min(lastIndex, index))
  if (input.key === 'ArrowUp' || input.key === 'ArrowDown') {
    return {
      type: 'focus',
      index: adjacentRowIndex(input.currentIndex, input.key, input.total),
    }
  }
  if (input.key === 'Home') return { type: 'focus', index: 0 }
  if (input.key === 'End') return { type: 'focus', index: lastIndex }
  if (input.key === 'PageUp') {
    return { type: 'focus', index: clamp(input.currentIndex - input.pageSize) }
  }
  if (input.key === 'PageDown') {
    return { type: 'focus', index: clamp(input.currentIndex + input.pageSize) }
  }
  if (input.key === 'Enter' || input.key === 'F2') return { type: 'edit' }
  if (input.key === ' ') return { type: 'toggle-selection' }
  return null
}

export function nextSegmentId(ids: readonly string[], currentId?: string): string | undefined {
  if (ids.length === 0) return undefined
  const current = currentId === undefined ? -1 : ids.indexOf(currentId)
  return ids[(current + 1) % ids.length]
}

type NextEditableRow =
  | { kind: 'found'; index: number }
  | { kind: 'load'; index: number }
  | { kind: 'end' }

export function findNextEditableRow(
  rows: ReadonlyMap<number, { assetId: string; locked: boolean }>,
  currentIndex: number,
  assetId: string,
  total: number,
): NextEditableRow {
  for (let index = currentIndex + 1; index < total; index += 1) {
    const segment = rows.get(index)
    if (segment === undefined) return { kind: 'load', index }
    if (segment.assetId !== assetId) return { kind: 'end' }
    if (!segment.locked) return { kind: 'found', index }
  }
  return { kind: 'end' }
}
