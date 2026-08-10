import { describe, expect, test } from 'bun:test'
import type { LinguistTermInfo, LinguistTermStatus } from '@proma/shared'
import {
  ACTIVE_TERM_CONFLICT_STATUSES,
  buildTermConflictResolution,
  TERM_STATUS_LABELS,
} from './ReferenceManager'

function term(id: string, sourceTerm: string, status: LinguistTermStatus): LinguistTermInfo {
  return {
    id,
    term: sourceTerm,
    translation: `${sourceTerm}-译-${id}`,
    status,
    caseSensitive: false,
  }
}

describe('术语管理', () => {
  test('状态标签覆盖全部五种状态且为用户语言', () => {
    expect(TERM_STATUS_LABELS).toEqual({
      required: '必须',
      preferred: '推荐',
      forbidden: '禁用',
      allowed: '允许',
      deprecated: '弃用',
    })
    expect(ACTIVE_TERM_CONFLICT_STATUSES).toEqual(['required', 'preferred'])
  })

  test('一键保留某条时不删除一词多义，只把其他生效译法改为允许', () => {
    const entries = [
      { ...term('keep', 'Start', 'required'), translation: '开始', module: 'UI', note: '按钮' },
      { ...term('other', 'Start', 'preferred'), translation: '启动', category: '动词' },
      { ...term('forbidden', 'Start', 'forbidden'), translation: '开端' },
    ]
    expect(buildTermConflictResolution(entries, 'keep')).toEqual([
      entries[0]!,
      { ...entries[1]!, status: 'allowed' },
      entries[2]!,
    ])
  })
})
