/**
 * PB-040: 常驻项目 Skill 内容门禁（纯 fs 读取，bun 安全，无 node:sqlite 依赖）
 *
 * 计划 §8.1/§8.4 的机器可执行护栏：
 * - 七条不变量逐字在场（system-invariant 风格，防止编辑漂移）；
 * - frontmatter 只允许 name/description/version —— 不得携带任何工具/权限授予
 *   （allowed-tools、tools、permission 等键一律拒绝；Skill 不授予能力）；
 * - 全文不得出现本机绝对路径：POSIX 绝对路径（行首或空白/引号/括号后紧跟 /）、
 *   用户主目录前缀（~ 或当前 os.homedir()）、Windows 盘符路径（C:\ 等）。
 *   注意「TM/TB」这类词内斜杠不是路径，词字符后的 / 不计。
 */

import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const REPO_ROOT = dirname(import.meta.dir)
const SKILL_DIR = join(REPO_ROOT, 'resources', 'linguist-skills', 'project-assistant')
const SKILL_PATH = join(SKILL_DIR, 'SKILL.md')

/** 计划 §8.1 规定的七条不变量（逐字，顺序一致） */
const INVARIANTS = [
  '你正在一个 Linguist Project 中工作。',
  '使用 CAT Tool 读取和提出修改。',
  '不要直接修改源资产。',
  'Proposal 不等于已接受译文。',
  'QA 结果由确定性工具产生。',
  '引用 Segment ID、TM/TB 或项目证据。',
  '无法确定时标记歧义，不要伪造事实。',
] as const

function readSkill(): string {
  expect(existsSync(SKILL_PATH), `内置项目 Skill 不存在: ${SKILL_PATH}`).toBe(true)
  return readFileSync(SKILL_PATH, 'utf-8')
}

test('skill file exists at the whitelisted resources/linguist-skills path', () => {
  readSkill()
})

test('frontmatter grants nothing: only name/description/version keys, expected name', () => {
  const content = readSkill()
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  expect(fm, 'SKILL.md 缺少 frontmatter 块').not.toBeNull()
  const keys = fm![1]!
    .split('\n')
    .map((line) => line.match(/^([A-Za-z][A-Za-z0-9_-]*):/)?.[1])
    .filter((k): k is string => k !== undefined)
  expect(keys.length).toBeGreaterThan(0)
  const allowed = new Set(['name', 'description', 'version'])
  const forbidden = keys.filter((k) => !allowed.has(k))
  expect(forbidden, `frontmatter 含工具/权限授予或其他非白名单键: ${forbidden.join(', ')}`).toEqual([])
  const name = fm![1]!.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  expect(name).toBe('linguist-project-assistant')
  const description = fm![1]!.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  expect(description && description.length > 0).toBe(true)
})

test('all seven plan §8.1 invariants are present verbatim', () => {
  const content = readSkill()
  for (const sentence of INVARIANTS) {
    expect(content.includes(sentence), `不变量缺失或被改写: ${sentence}`).toBe(true)
  }
})

test('no machine-local absolute path, home prefix, or drive letter anywhere in the skill', () => {
  const content = readSkill()
  // POSIX 绝对路径：行首或空白/引号/括号/等号/反引号之后紧跟 /
  expect(/(?:^|[\s"'`(=])\//m.test(content), 'SKILL.md 含 POSIX 绝对路径').toBe(false)
  // 用户主目录前缀（~ 符号或当前机器真实 homedir 字面量）
  expect(content.includes('~'), 'SKILL.md 含 ~ 主目录前缀').toBe(false)
  expect(content.includes(homedir()), `SKILL.md 含当前用户主目录 ${homedir()}`).toBe(false)
  // Windows 盘符路径（C:\ 或 C:/）
  expect(/\b[A-Za-z]:[\\/]/.test(content), 'SKILL.md 含 Windows 盘符路径').toBe(false)
})
