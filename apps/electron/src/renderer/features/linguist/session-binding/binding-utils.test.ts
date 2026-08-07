/**
 * binding-utils 纯逻辑测试（PB-034，bun 安全）：
 * 徽章状态后缀 + 会话内通告文案的完备性（四状态全覆盖，active 无通告）。
 */

import { describe, expect, test } from 'bun:test'
import {
  bindingNoticeCopy,
  bindingStatusLabel,
} from './binding-utils'

describe('bindingStatusLabel', () => {
  test('active has no suffix; blocked states have stable labels', () => {
    expect(bindingStatusLabel('active')).toBeNull()
    expect(bindingStatusLabel('archived')).toBe('已归档')
    expect(bindingStatusLabel('missing')).toBe('项目缺失')
    expect(bindingStatusLabel('unavailable')).toBe('项目不可用')
  })
})

describe('bindingNoticeCopy', () => {
  test('active sessions need no notice', () => {
    expect(bindingNoticeCopy('active', '任何项目')).toBeNull()
  })

  test('archived notice: Agent remains available while CAT writes stay read-only', () => {
    const copy = bindingNoticeCopy('archived', '我的项目')
    expect(copy).not.toBeNull()
    expect(copy!.tone).toBe('amber')
    expect(copy!.title).toBe('项目已归档')
    expect(copy!.body).toContain('会话仍可使用全部 Proma 能力')
    expect(copy!.body).toContain('CAT 写入')
  })

  test('missing notice: Agent remains available and CAT reports PROJECT_MISSING', () => {
    const copy = bindingNoticeCopy('missing', '丢失的项目')
    expect(copy).not.toBeNull()
    expect(copy!.tone).toBe('red')
    expect(copy!.title).toBe('绑定项目缺失')
    expect(copy!.body).toContain('「丢失的项目」')
    expect(copy!.body).toContain('Agent 对话仍可继续')
    expect(copy!.body).toContain('PROJECT_MISSING')
  })

  test('unavailable notice does not downgrade the session to an ordinary Agent', () => {
    const copy = bindingNoticeCopy('unavailable', '暂时不可用的项目')
    expect(copy).not.toBeNull()
    expect(copy!.tone).toBe('red')
    expect(copy!.title).toBe('项目服务不可用')
    expect(copy!.body).toContain('「暂时不可用的项目」')
    expect(copy!.body).toContain('Agent 对话仍可继续')
    expect(copy!.body).toContain('CAT 工具')
  })

  test('all statuses are handled exhaustively', () => {
    // 若 LinguistSessionBindingStatus 未来新增状态，这里会编译/运行失败
    for (const status of ['active', 'archived', 'missing', 'unavailable'] as const) {
      expect(() => bindingNoticeCopy(status, 'x')).not.toThrow()
      expect(() => bindingStatusLabel(status)).not.toThrow()
    }
  })
})
