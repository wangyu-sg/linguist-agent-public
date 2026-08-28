import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import {
  buildLinguistPrompt,
  loadRolePrompt,
} from './linguist-prompt-builder'

let rolesRoot: string

beforeAll(() => {
  rolesRoot = mkdtempSync(join(os.tmpdir(), 'linguist-role-prompts-'))
})

afterAll(() => {
  rmSync(rolesRoot, { recursive: true, force: true })
})

test('专业岗位 Prompt 缺失时以稳定错误拒绝，并且不泄露本机路径', () => {
  expect(() => loadRolePrompt('reviewer', rolesRoot)).toThrow('LINGUIST_ROLE_PROMPT_UNAVAILABLE')

  try {
    loadRolePrompt('reviewer', rolesRoot)
  } catch (error) {
    expect(error).toMatchObject({ code: 'LINGUIST_ROLE_PROMPT_UNAVAILABLE' })
    expect(error instanceof Error ? error.message : String(error)).not.toContain(rolesRoot)
  }
})

test('通用岗位 Prompt 不可用时保留降级警告并提供诊断状态', () => {
  const result = buildLinguistPrompt(
    { linguistProjectId: 'prj-0123456789abcdef', linguistRole: 'general' },
    () => { throw new Error('service unavailable') },
    { rolesRoot },
  )

  expect(result.status).toMatchObject({ role: 'general', roleSource: 'fallback' })
  expect(result.prompt).toContain('岗位资源不可用')
})

test('专业岗位 Prompt 超过岗位上限时同样拒绝', () => {
  mkdirSync(rolesRoot, { recursive: true })
  writeFileSync(join(rolesRoot, 'translator.md'), 'x'.repeat(6_001), 'utf8')

  expect(() => loadRolePrompt('translator', rolesRoot)).toThrow('LINGUIST_ROLE_PROMPT_UNAVAILABLE')
})
