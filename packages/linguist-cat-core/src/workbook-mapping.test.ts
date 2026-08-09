import { describe, expect, test } from 'bun:test'
import { normalizeWorkbookMappingProfiles } from './workbook-mapping'

describe('normalizeWorkbookMappingProfiles', () => {
  test('keeps complete profiles and drops malformed project.json entries', () => {
    const valid = {
      id: 'wbm_demo',
      workbookFingerprint: 'a'.repeat(64),
      filenamePattern: 'game-*.xlsx',
      sheetName: 'Strings',
      headerSignature: 'b'.repeat(64),
      columns: { source: 'English', target: 'Chinese' },
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    }
    expect(normalizeWorkbookMappingProfiles([valid, { ...valid, columns: { source: '', target: 'Chinese' } }]))
      .toEqual([valid])
    expect(normalizeWorkbookMappingProfiles({})).toEqual([])
  })
})
