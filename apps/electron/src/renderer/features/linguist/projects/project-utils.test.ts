/**
 * project-utils 纯函数测试（ticket PB-032；PB-033 追加摘要截断）
 *
 * bun 安全：不触 React / DOM / IPC，只驱动纯函数。
 * 覆盖：「最近」排序、归档分组、表单预校验（镜像 IPC 规则）、
 * 29 个稳定错误码中文映射完备性、健康报告摘要、时间格式化、
 * SHA-256 截断展示。
 */

import { describe, expect, test } from 'bun:test'
import {
  LINGUIST_IPC_ERROR_CODES,
  type LinguistIpcErrorCode,
  type LinguistProjectHealthReport,
  type LinguistProjectInfo,
} from '@proma/shared'
import {
  describeHealthCheckId,
  describeLinguistIpcError,
  describeQualityProfile,
  failedHealthChecks,
  formatProjectTime,
  LINGUIST_IPC_ERROR_MESSAGES,
  normalizeQualityProfileInfo,
  partitionProjectsByArchived,
  QUALITY_PROFILE_OPTIONS,
  sortProjectsByRecentDesc,
  summarizeFailedHealthChecks,
  truncateSha256,
  validateLocaleInput,
  validateProjectNameInput,
} from './project-utils'

/** 构造最小项目线格式（测试夹具） */
function project(overrides: Partial<LinguistProjectInfo>): LinguistProjectInfo {
  return {
    schemaVersion: 1,
    id: 'prj-0000000000000000',
    name: '项目',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'ws',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    qualityProfile: 'balanced',
    ...overrides,
  }
}

function healthReport(checks: Array<{ id: LinguistProjectHealthReport['checks'][number]['id']; ok: boolean; detail?: string }>): LinguistProjectHealthReport {
  return {
    projectId: 'prj-0000000000000000',
    healthy: checks.every((c) => c.ok),
    checkedAt: '2026-07-25T10:00:00.000Z',
    checks,
  }
}

describe('sortProjectsByRecentDesc', () => {
  test('按 updatedAt 降序，且不改动入参数组', () => {
    const a = project({ id: 'prj-aaaaaaaaaaaaaaaa', updatedAt: '2026-07-01T08:00:00.000Z' })
    const b = project({ id: 'prj-bbbbbbbbbbbbbbbb', updatedAt: '2026-07-20T08:00:00.000Z' })
    const c = project({ id: 'prj-cccccccccccccccc', updatedAt: '2026-07-10T08:00:00.000Z' })
    const input = [a, b, c]
    const sorted = sortProjectsByRecentDesc(input)
    expect(sorted.map((p) => p.id)).toEqual([b.id, c.id, a.id])
    // 入参不被原地修改
    expect(input.map((p) => p.id)).toEqual([a.id, b.id, c.id])
  })

  test('空列表与单元素', () => {
    expect(sortProjectsByRecentDesc([])).toEqual([])
    const only = project({ id: 'prj-aaaaaaaaaaaaaaaa' })
    expect(sortProjectsByRecentDesc([only])).toEqual([only])
  })
})

describe('partitionProjectsByArchived', () => {
  test('按 archivedAt 分组，两组各自按 updatedAt 降序', () => {
    const a = project({ id: 'prj-aaaaaaaaaaaaaaaa', updatedAt: '2026-07-01T08:00:00.000Z' })
    const b = project({
      id: 'prj-bbbbbbbbbbbbbbbb',
      updatedAt: '2026-07-02T08:00:00.000Z',
      archivedAt: '2026-07-21T08:00:00.000Z',
    })
    const c = project({
      id: 'prj-cccccccccccccccc',
      updatedAt: '2026-07-03T08:00:00.000Z',
      archivedAt: '2026-07-22T08:00:00.000Z',
    })
    const d = project({ id: 'prj-dddddddddddddddd', updatedAt: '2026-07-04T08:00:00.000Z' })
    const { active, archived } = partitionProjectsByArchived([a, b, c, d])
    expect(active.map((p) => p.id)).toEqual([d.id, a.id])
    expect(archived.map((p) => p.id)).toEqual([c.id, b.id])
  })
})

describe('validateProjectNameInput（镜像 IPC readProjectName）', () => {
  test('空串 / 纯空白被拒绝', () => {
    expect(validateProjectNameInput('')).not.toBeNull()
    expect(validateProjectNameInput('   ')).not.toBeNull()
    expect(validateProjectNameInput('\n\t ')).not.toBeNull()
  })

  test('超过 120 字符被拒绝（按 trim 后长度）', () => {
    expect(validateProjectNameInput('x'.repeat(121))).not.toBeNull()
    expect(validateProjectNameInput(` ${'x'.repeat(121)} `)).not.toBeNull()
    expect(validateProjectNameInput('x'.repeat(120))).toBeNull()
  })

  test('正常名称通过（含首尾空白，发送前会 trim）', () => {
    expect(validateProjectNameInput('官网本地化')).toBeNull()
    expect(validateProjectNameInput('  My Project 2026  ')).toBeNull()
  })
})

describe('validateLocaleInput（镜像 IPC readLocale：BCP-47 形状 + ≤35）', () => {
  test('合法形状通过', () => {
    for (const ok of ['en', 'zh', 'zh-CN', 'zh-Hant-TW', 'pt-BR', 'es-419']) {
      expect(validateLocaleInput(ok, '源语言')).toBeNull()
    }
  })

  test('非法形状被拒绝', () => {
    for (const bad of ['', '   ', 'e', 'engl', 'en-', 'en_US', '123', 'en--US', '-en', 'a-b-c']) {
      expect(validateLocaleInput(bad, '目标语言')).not.toBeNull()
    }
  })

  test('超过 35 字符被拒绝', () => {
    expect(validateLocaleInput(`en-${'x'.repeat(40)}`, '源语言')).not.toBeNull()
  })

  test('首尾空白按 trim 后校验（发送前会 trim）', () => {
    expect(validateLocaleInput('  zh-CN ', '源语言')).toBeNull()
  })

  test('错误文案带字段名', () => {
    expect(validateLocaleInput('', '源语言')).toContain('源语言')
    expect(validateLocaleInput('bad_locale', '目标语言')).toContain('目标语言')
  })
})

describe('LINGUIST_IPC_ERROR_MESSAGES（31 码中文化）', () => {
  test('映射表与契约错误码目录一一对应（31 个，无多无缺）', () => {
    const contractCodes = Object.values(LINGUIST_IPC_ERROR_CODES).sort()
    const mappedCodes = Object.keys(LINGUIST_IPC_ERROR_MESSAGES).sort()
    expect(mappedCodes).toEqual(contractCodes)
    expect(mappedCodes.length).toBe(31)
  })

  test('describeLinguistIpcError：文案 + 稳定码后缀', () => {
    const text = describeLinguistIpcError({ code: 'PROJECT_NOT_FOUND', message: 'not found' })
    expect(text).toContain('项目不存在')
    expect(text).toContain('（PROJECT_NOT_FOUND）')
  })

  test('INVALID_INPUT 透出服务端 message 以定位字段', () => {
    const text = describeLinguistIpcError({
      code: 'INVALID_INPUT',
      message: 'name must be a non-blank string of at most 120 characters',
    })
    expect(text).toContain('INVALID_INPUT')
    expect(text).toContain('at most 120')
  })

  test('CONTEXT_DOC_EXTRACT_FAILED 透出安全诊断，帮助用户修正文档', () => {
    const text = describeLinguistIpcError({
      code: 'CONTEXT_DOC_EXTRACT_FAILED',
      message: 'Context DOCX extraction failed (DOCX_PARSE_FAILED).',
    })
    expect(text).toContain('DOCX_PARSE_FAILED')
    expect(text).toContain('CONTEXT_DOC_EXTRACT_FAILED')
  })

  test('每个契约码都能产出包含码本身的文案', () => {
    for (const code of Object.values(LINGUIST_IPC_ERROR_CODES)) {
      const text = describeLinguistIpcError({ code: code as LinguistIpcErrorCode, message: 'm' })
      expect(text).toContain(code)
      expect(text.length).toBeGreaterThan(code.length)
    }
  })
})

describe('健康报告助手', () => {
  test('failedHealthChecks 只留未通过项', () => {
    const report = healthReport([
      { id: 'project_json', ok: true },
      { id: 'cat_db_open', ok: false, detail: 'STORE_BUSY' },
      { id: 'schema_version', ok: true },
      { id: 'asset_sources', ok: false },
    ])
    expect(report.healthy).toBe(false)
    expect(failedHealthChecks(report).map((c) => c.id)).toEqual(['cat_db_open', 'asset_sources'])
  })

  test('describeHealthCheckId：已知标签 / 未知原样', () => {
    expect(describeHealthCheckId('cat_db_open')).toBe('翻译数据库')
    expect(describeHealthCheckId('project_json')).toBe('项目元数据')
    expect(describeHealthCheckId('future_check')).toBe('future_check')
  })

  test('summarizeFailedHealthChecks：标签 + detail 码，无 detail 只留标签', () => {
    const report = healthReport([
      { id: 'cat_db_open', ok: false, detail: 'STORE_BUSY' },
      { id: 'asset_sources', ok: false },
    ])
    const text = summarizeFailedHealthChecks(report)
    expect(text).toContain('翻译数据库（STORE_BUSY）')
    expect(text).toContain('资产源校验')
  })

  test('全通过时 healthy=true 且无失败项', () => {
    const report = healthReport([
      { id: 'project_json', ok: true },
      { id: 'cat_db_open', ok: true },
      { id: 'schema_version', ok: true },
      { id: 'asset_sources', ok: true },
    ])
    expect(report.healthy).toBe(true)
    expect(failedHealthChecks(report)).toEqual([])
    expect(summarizeFailedHealthChecks(report)).toBe('')
  })
})

describe('formatProjectTime', () => {
  // 固定 now：2026-07-25 15:00 本地时间
  const now = new Date(2026, 6, 25, 15, 0, 0)

  test('今天 → 今天 HH:mm', () => {
    const iso = new Date(2026, 6, 25, 9, 5, 0).toISOString()
    expect(formatProjectTime(iso, now)).toBe('今天 09:05')
  })

  test('昨天 → 昨天 HH:mm', () => {
    const iso = new Date(2026, 6, 24, 23, 40, 0).toISOString()
    expect(formatProjectTime(iso, now)).toBe('昨天 23:40')
  })

  test('同年更早 → M月d日', () => {
    const iso = new Date(2026, 2, 3, 12, 0, 0).toISOString()
    expect(formatProjectTime(iso, now)).toBe('3月3日')
  })

  test('跨年 → yyyy年M月d日', () => {
    const iso = new Date(2025, 11, 31, 12, 0, 0).toISOString()
    expect(formatProjectTime(iso, now)).toBe('2025年12月31日')
  })

  test('非法输入原样返回（不 crash）', () => {
    expect(formatProjectTime('not-a-date', now)).toBe('not-a-date')
  })
})

describe('truncateSha256（PB-033 资产摘要展示）', () => {
  test('64 位 hex → 前 12…后 4', () => {
    const sha = '7a3b67c1eab30f49da31192a3ee770ec04d9b38ceba32a3ad0b25ad639ea5030'
    expect(truncateSha256(sha)).toBe('7a3b67c1eab3…5030')
  })

  test('截断结果不含中间部分但仍可定位（首 12 + 末 4 与原值一致）', () => {
    const sha = 'abcdef0123456789'.repeat(4)
    const truncated = truncateSha256(sha)
    expect(truncated.startsWith(sha.slice(0, 12))).toBe(true)
    expect(truncated.endsWith(sha.slice(-4))).toBe(true)
    expect(truncated.length).toBeLessThan(sha.length)
  })

  test('短输入原样返回（不 crash）', () => {
    expect(truncateSha256('')).toBe('')
    expect(truncateSha256('abc123')).toBe('abc123')
    expect(truncateSha256('x'.repeat(18))).toBe('x'.repeat(18))
    expect(truncateSha256('y'.repeat(19))).toBe(`${'y'.repeat(12)}…yyyy`)
  })
})

// ===== PB-082：质量策略档展示逻辑 =====

describe('质量策略档（PB-082，计划 §21）', () => {
  test('normalizeQualityProfileInfo：三档原样通过，缺省/未知回落 balanced', () => {
    expect(normalizeQualityProfileInfo('fast')).toBe('fast')
    expect(normalizeQualityProfileInfo('balanced')).toBe('balanced')
    expect(normalizeQualityProfileInfo('best')).toBe('best')
    for (const value of [undefined, null, '', 'turbo', 'FAST', 42, {}]) {
      expect(normalizeQualityProfileInfo(value)).toBe('balanced')
    }
  })

  test('QUALITY_PROFILE_OPTIONS：三档顺序与契约一致，均带中文说明', () => {
    expect(QUALITY_PROFILE_OPTIONS.map((option) => option.profile)).toEqual(['fast', 'balanced', 'best'])
    for (const option of QUALITY_PROFILE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0)
      expect(option.description.length).toBeGreaterThan(0)
    }
  })

  test('describeQualityProfile：每档返回对应说明，未知值回落 balanced 说明', () => {
    for (const option of QUALITY_PROFILE_OPTIONS) {
      expect(describeQualityProfile(option.profile)).toBe(option.description)
    }
    expect(describeQualityProfile('turbo' as never)).toBe(QUALITY_PROFILE_OPTIONS[1]!.description)
  })
})
