import { describe, expect, test } from 'bun:test'
import type { LinguistProjectInfo } from '@proma/shared'
import {
  copyTargetCandidates,
  hasLanguageDirectionMismatch,
} from './CopyLinguistSessionDialog'

function project(
  id: string,
  sourceLocale = 'en-US',
  targetLocale = 'zh-CN',
  archived = false,
): LinguistProjectInfo {
  return {
    id,
    name: id,
    sourceLocale,
    targetLocale,
    promaWorkspaceId: `ws-${id}`,
    workflowStage: 'translation',
    qaProfile: 'general',
    qualityProfile: 'balanced',
    schemaVersion: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...(archived ? { archivedAt: '2026-07-30T01:00:00.000Z' } : {}),
  }
}

describe('Linguist 会话复制目标', () => {
  test('只保留其他活跃项目，并识别语言方向不一致', () => {
    const source = project('source')
    const same = project('same')
    const different = project('different', 'fr-FR', 'de-DE')
    const archived = project('archived', 'en-US', 'zh-CN', true)

    expect(copyTargetCandidates(
      [source, same, different, archived],
      source.id,
    ).map((item) => item.id)).toEqual(['same', 'different'])
    expect(hasLanguageDirectionMismatch(source, same)).toBe(false)
    expect(hasLanguageDirectionMismatch(source, different)).toBe(true)
  })
})
