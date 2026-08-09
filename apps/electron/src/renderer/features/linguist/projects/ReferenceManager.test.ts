import { describe, expect, test } from 'bun:test'
import type { LinguistTermInfo, LinguistTermStatus } from '@proma/shared'
import { findTermConflicts, TERM_STATUS_LABELS } from './ReferenceManager'

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
  })

  test.each([
    {
      name: '同一术语两条必须：冲突',
      terms: [term('a', 'Start', 'required'), term('b', 'Start', 'preferred')],
      expectedGroups: 1,
    },
    {
      name: '同一术语必须加禁用：不冲突（禁用是排除向）',
      terms: [term('a', 'Start', 'required'), term('b', 'Start', 'forbidden')],
      expectedGroups: 0,
    },
    {
      name: '同一术语仅一条生效译法加一条弃用：不冲突',
      terms: [term('a', 'Start', 'preferred'), term('b', 'Start', 'deprecated')],
      expectedGroups: 0,
    },
    {
      name: '不同术语各自生效：不冲突',
      terms: [term('a', 'Start', 'required'), term('b', 'Score', 'preferred')],
      expectedGroups: 0,
    },
    {
      name: '三条生效译法同术语：冲突且整组返回',
      terms: [
        term('a', 'Start', 'required'),
        term('b', 'Start', 'preferred'),
        term('c', 'Start', 'preferred'),
        term('d', 'Start', 'forbidden'),
      ],
      expectedGroups: 1,
    },
  ])('given $name when 检测冲突 then 组数=$expectedGroups', ({ terms, expectedGroups }) => {
    const groups = findTermConflicts(terms)
    expect(groups).toHaveLength(expectedGroups)
    for (const group of groups) {
      expect(
        group.filter((item) => item.status === 'required' || item.status === 'preferred')
          .length,
      ).toBeGreaterThanOrEqual(2)
    }
  })
})
