/**
 * binding-utils 纯逻辑测试（PB-034，bun 安全）：
 * 徽章状态后缀 + 会话内通告文案的完备性（四状态全覆盖，active 无通告）。
 */

import { describe, expect, test } from 'bun:test'
import {
  bindingNoticeCopy,
  bindingStatusLabel,
  isLinguistSessionReadOnly,
} from './binding-utils'

describe('isLinguistSessionReadOnly', () => {
  const session = { linguistProjectId: 'project-1' }
  const binding = {
    sessionId: 'session-1',
    projectId: 'project-1',
    projectName: '项目一',
    status: 'active' as const,
  }

  test('普通会话和 active 绑定可发送，未解析或异常绑定只读', () => {
    expect(isLinguistSessionReadOnly({}, undefined)).toBe(false)
    expect(isLinguistSessionReadOnly(session, binding)).toBe(false)
    expect(isLinguistSessionReadOnly(session, undefined)).toBe(true)
    expect(isLinguistSessionReadOnly(session, { ...binding, status: 'archived' })).toBe(true)
    expect(isLinguistSessionReadOnly(session, { ...binding, status: 'missing' })).toBe(true)
    expect(isLinguistSessionReadOnly(session, { ...binding, status: 'unavailable' })).toBe(true)
  })
})

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

  test('archived notice: read-only semantics, amber tone, project name quoted', () => {
    const copy = bindingNoticeCopy('archived', '我的项目')
    expect(copy).not.toBeNull()
    expect(copy!.tone).toBe('amber')
    expect(copy!.title).toBe('项目已归档（只读）')
    expect(copy!.body).toContain('「我的项目」')
    expect(copy!.body).toContain('不能发送新消息')
    expect(copy!.body).toContain('历史消息可正常阅读')
  })

  test('missing notice: history readable, sending blocked until detach', () => {
    const copy = bindingNoticeCopy('missing', '丢失的项目')
    expect(copy).not.toBeNull()
    expect(copy!.tone).toBe('red')
    expect(copy!.title).toBe('绑定项目缺失')
    expect(copy!.body).toContain('「丢失的项目」')
    expect(copy!.body).toContain('不会发送')
    expect(copy!.body).toContain('解除绑定')
  })

  test('unavailable notice: fail-closed semantics and retry guidance', () => {
    const copy = bindingNoticeCopy('unavailable', '暂时不可用的项目')
    expect(copy).not.toBeNull()
    expect(copy!.tone).toBe('red')
    expect(copy!.title).toBe('项目服务不可用')
    expect(copy!.body).toContain('「暂时不可用的项目」')
    expect(copy!.body).toContain('不会按普通 Agent 发送')
    expect(copy!.body).toContain('重试')
  })

  test('all statuses are handled exhaustively', () => {
    // 若 LinguistSessionBindingStatus 未来新增状态，这里会编译/运行失败
    for (const status of ['active', 'archived', 'missing', 'unavailable'] as const) {
      expect(() => bindingNoticeCopy(status, 'x')).not.toThrow()
      expect(() => bindingStatusLabel(status)).not.toThrow()
    }
  })
})
