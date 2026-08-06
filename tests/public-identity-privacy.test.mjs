/**
 * 公开身份隐私护栏。
 *
 * 对受 Git 管理及准备纳入提交的文档做当前工作树扫描；禁用姓名通过
 * Unicode code point 构造，避免测试文件本身包含被禁止的明文。
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DOCUMENT_EXTENSIONS = new Set([
  '.json',
  '.jsonc',
  '.md',
  '.mdx',
  '.toml',
  '.yaml',
  '.yml',
])
const FORBIDDEN_PUBLIC_NAME = String.fromCodePoint(0x738b, 0x94b0)

function listVersionedAndPendingFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  )

  return output
    .split('\0')
    .filter(Boolean)
    .filter((file) => DOCUMENT_EXTENSIONS.has(extname(file).toLowerCase()))
    // 已删除但尚未纳入提交的条目不在当前工作树，跳过扫描
    .filter((file) => existsSync(resolve(REPO_ROOT, file)))
}

test('公开文档不得包含作者中文姓名', () => {
  const violations = listVersionedAndPendingFiles().filter((file) =>
    readFileSync(resolve(REPO_ROOT, file), 'utf8').includes(FORBIDDEN_PUBLIC_NAME),
  )

  assert.deepEqual(
    violations,
    [],
    `公开文档包含禁用的作者姓名：\n${violations.join('\n')}`,
  )
})
