import { describe, expect, test } from 'bun:test'
import { buildProjectEvidenceInventory } from './project-evidence-inventory'

describe('Project Evidence inventory', () => {
  test('单一可解析批次直接 Ready，不制造询问', () => {
    const result = buildProjectEvidenceInventory({
      discoveryScopeHash: 'scope-1',
      managedEvidenceCount: 1,
      unavailable: [],
      scan: {
        found: 1,
        ready: 1,
        imported: 0,
        skippedDuplicate: 0,
        needsInput: 0,
        unsupported: 0,
        failed: 0,
        truncated: false,
        items: [{ filename: 'source.xliff', status: 'ready', resourceKind: 'batch' }],
      },
    })

    expect(result.summary.status).toBe('ready')
    expect(result.gaps).toEqual([])
    expect(result.summary.readyToImport).toBe(1)
  })

  test('未知、不可读、映射歧义与同名版本候选都形成显式 Gap', () => {
    const result = buildProjectEvidenceInventory({
      discoveryScopeHash: 'scope-2',
      managedEvidenceCount: 0,
      unavailable: [{
        kind: 'session-attached-file',
        name: 'missing.pdf',
        reason: 'missing',
      }],
      scan: {
        found: 4,
        ready: 0,
        imported: 0,
        skippedDuplicate: 0,
        needsInput: 1,
        unsupported: 1,
        failed: 0,
        truncated: false,
        items: [
          { filename: 'brief.xlsx', status: 'needs-input', resourceKind: 'batch' },
          { filename: 'unknown.bin', status: 'unsupported' },
          { filename: 'brief.pdf', status: 'ready', resourceKind: 'context', sourceSha256: 'a'.repeat(64) },
          { filename: 'brief.pdf', status: 'ready', resourceKind: 'context', sourceSha256: 'b'.repeat(64) },
        ],
      },
    })

    expect(result.summary.status).toBe('blocked')
    expect(result.summary.versionConflicts).toBe(1)
    expect(new Set(result.gaps.map((gap) => gap.code))).toEqual(new Set([
      'REQUIRED_RESOURCE_MISSING',
      'RESOURCE_MAPPING_AMBIGUOUS',
      'UNMAPPED_CLIENT_VISIBLE_CONTENT',
      'VERSION_CONFLICT',
    ]))
  })
})
