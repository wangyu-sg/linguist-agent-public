/**
 * LA-FORMAT-001 / LA-FORMAT-002 回归测试：scripts/corpus-scan.mjs 的聚合与脱敏逻辑。
 *
 * 运行（scanner import 了 workspace TS 源，需要 house TS loader）：
 *   node --experimental-transform-types \
 *     --import ./apps/electron/src/main/lib/linguist/test/register-ts-loader.mjs \
 *     --test tests/corpus-scan.test.mjs
 * 或：
 *   bun test tests/corpus-scan.test.mjs
 *
 * fixture 为 tests/linguist-fixtures/corpus-scan/ 下的全合成文本，无任何真实语料。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { FormatParseError } from '@linguist/cat-formats'

import {
  assertPublicDocSafe,
  classifySize,
  collectForbiddenTokens,
  IMPORT_SIZE_LIMIT_BYTES,
  sanitizeError,
  scanCorpus,
  toPublicJson,
  walkFiles,
} from '../scripts/corpus-scan.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FIXTURE_DIR = join(REPO_ROOT, 'tests/linguist-fixtures/corpus-scan')

async function scanFixture() {
  return scanCorpus(FIXTURE_DIR, { label: 'fixture-test', roundtripSample: 3 })
}

test('fixture 聚合：扩展名、分类、family 计数精确匹配', async () => {
  const result = await scanFixture()
  assert.equal(result.ok, true)
  // 7 个可见文件；2 个隐藏项被忽略
  assert.equal(result.totalFiles, 7)
  assert.equal(result.skippedHidden, 2)
  assert.deepEqual(result.extensionCounts, [
    ['.csv', 2],
    ['.xliff', 2],
    ['.json', 1],
    ['.png', 1],
    ['.txt', 1],
  ])
  assert.deepEqual(result.categories, {
    detected: 5,
    unsupported: 1,
    non_document: 1,
    oversize: 0,
    detect_error: 0,
    read_error: 0,
  })
  assert.deepEqual(result.families, { csv_rfc4180: 2, json_i18n: 1, xliff_1_2: 2 })
  assert.deepEqual(result.duplicates, { count: 0, bytes: 0 })
})

test('fixture roundtrip：xliff 坏文件按消毒类别失败，其余全部成功', async () => {
  const result = await scanFixture()
  const rt = result.roundtrip.families
  assert.deepEqual(rt.csv_rfc4180, { sampled: 2, ok: 2, failed: 0, errors: {} })
  assert.deepEqual(rt.json_i18n, { sampled: 1, ok: 1, failed: 0, errors: {} })
  assert.equal(rt.xliff_1_2.sampled, 2)
  assert.equal(rt.xliff_1_2.ok, 1)
  assert.equal(rt.xliff_1_2.failed, 1)
  assert.deepEqual(rt.xliff_1_2.errors, { 'FormatParseError:FORMAT_PARSE_ERROR': 1 })

  // 逐文件 roundtrip 记录不得携带文件名或路径片段
  const broken = result.files.find((f) => f.roundtrip !== undefined && f.roundtrip !== 'ok')
  assert.ok(broken !== undefined)
  assert.equal(broken.roundtrip, 'FormatParseError:FORMAT_PARSE_ERROR')
  assert.ok(!broken.roundtrip.includes(broken.relPath))
  assert.ok(!broken.roundtrip.includes('/'))
})

test('扫描确定性：两次扫描的公开 JSON 完全一致', async () => {
  const [a, b] = await Promise.all([scanFixture(), scanFixture()])
  assert.deepEqual(toPublicJson(a), toPublicJson(b))
})

test('toPublicJson 不含任何文件名、相对路径或绝对路径', async () => {
  const result = await scanFixture()
  const json = JSON.stringify(toPublicJson(result))
  assert.ok(!json.includes('scan-alpha'))
  assert.ok(!json.includes('scan-notes'))
  assert.ok(!json.includes(FIXTURE_DIR))
  assert.ok(!json.includes('sha256'))
})

test('walkFiles：码元序确定排序，忽略隐藏项与符号链接', async () => {
  const { files, skippedHidden } = await walkFiles(FIXTURE_DIR)
  assert.equal(files.length, 7)
  assert.equal(skippedHidden, 2)
  const relPaths = files.map((f) => f.relPath)
  const sorted = [...relPaths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  assert.deepEqual(relPaths, sorted)
  assert.ok(relPaths.every((p) => !p.split('/').some((seg) => seg.startsWith('.'))))
  assert.ok(relPaths.includes('nested/scan-deep.csv'))
})

test('classifySize 分桶边界', () => {
  assert.equal(classifySize(0), '<64 KiB')
  assert.equal(classifySize(64 * 1024 - 1), '<64 KiB')
  assert.equal(classifySize(64 * 1024), '64 KiB-1 MiB')
  assert.equal(classifySize(1024 * 1024), '1-10 MiB')
  assert.equal(classifySize(10 * 1024 * 1024), '10-50 MiB')
  // 恰为 50 MiB 的文件不超上限（生产判断是严格大于）
  assert.equal(IMPORT_SIZE_LIMIT_BYTES, 50 * 1024 * 1024)
  assert.equal(classifySize(IMPORT_SIZE_LIMIT_BYTES), '>50 MiB')
})

test('IMPORT_SIZE_LIMIT_BYTES 与生产 MAX_IMPORT_BYTES 同步', () => {
  const source = readFileSync(
    join(REPO_ROOT, 'apps/electron/src/main/lib/linguist/project-delivery.ts'),
    'utf8',
  )
  const match = source.match(/MAX_IMPORT_BYTES = (\d+) \* 1024 \* 1024/)
  assert.ok(match !== null, '未能在 project-delivery.ts 找到 MAX_IMPORT_BYTES 定义')
  assert.equal(IMPORT_SIZE_LIMIT_BYTES, Number(match[1]) * 1024 * 1024)
})

test('sanitizeError 只保留类名与机器 code，剥离 message', () => {
  const parseErr = new FormatParseError(
    'xliff_1_2',
    '/secret/path/客户合同.xliff',
    '内容片段 <source>机密</source>',
  )
  const category = sanitizeError(parseErr)
  assert.equal(category, 'FormatParseError:FORMAT_PARSE_ERROR')
  assert.ok(!category.includes('客户'))
  assert.ok(!category.includes('/'))
  assert.equal(sanitizeError(new TypeError('some detail')), 'TypeError')
  const fsErr = Object.assign(new Error('detail'), { code: 'EACCES' })
  assert.equal(sanitizeError(fsErr), 'Error:EACCES')
  assert.equal(sanitizeError('string throw'), 'NonErrorThrow')
})

test('collectForbiddenTokens 覆盖文件 stem、根路径分段与固定禁止词', async () => {
  const result = await scanFixture()
  const tokens = collectForbiddenTokens(result)
  assert.ok(tokens.includes('scan-alpha'))
  assert.ok(tokens.includes('scan-notes'))
  assert.ok(tokens.includes('corpus-scan'))
  assert.ok(tokens.includes('翻译'))
  assert.ok(tokens.includes('desktop'))
  // 短于阈值的 stem 不收录（fixture 中最短 stem 为 4+，此处验证固定词必在）
  assert.ok(tokens.every((t) => t.length > 0))
})

test('assertPublicDocSafe：泄漏内容被拒，干净文档通过，违规不回显 token', () => {
  const tokens = ['secret-client', '翻译']
  const leaking = ['第一行正常', '引用绝对路径 a/b', '提及 secret-client 的行'].join('\n')
  const result = assertPublicDocSafe(leaking, tokens)
  assert.equal(result.ok, false)
  assert.deepEqual(result.violations, [
    { line: 2, kind: 'forbidden-slash' },
    { line: 3, kind: 'forbidden-token' },
  ])
  // 违规信息只含行号与规则类别
  assert.ok(!JSON.stringify(result.violations).includes('secret-client'))

  const clean = ['# 聚合结论', '', '扩展名 .xliff 共 42 个，roundtrip 成功率 95%。'].join('\n')
  assert.deepEqual(assertPublicDocSafe(clean, tokens), { ok: true, violations: [] })
})
