/**
 * 公开镜像净化护栏。
 *
 * 规则来自旧 LA 冻结报告，并以旧私有冻结树与旧公开 main 的实际 tree diff
 * 复核。只阻止真实未公开内容；历史上已经明确公开的 OPENWORKER / PROMA
 * 设计规格不在拒绝清单内。
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.scss',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])
const REAL_PROJECT_ID = ['prj-', 'a0b09ddb', '2005d761'].join('')
const PRIVATE_TEXT = [
  REAL_PROJECT_ID,
  ['/Users', ['wang', 'yu'].join('')].join('/'),
  ['/Users', ['guo', 'hao'].join('')].join('/'),
  ['/Users', ['big', 'mouth'].join('')].join('/'),
  ['Lingui', 'tronics'].join(''),
  ['王者', '荣耀番剧'].join(''),
]

const FORBIDDEN_PATHS = [
  /^(?:data|sessions|tmp\/quarantine|\.data-root-writer-lease)(?:\/|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)\.pi\/(?:settings\.local\.json|[^/]+\.local\.json|sessions(?:\/|$))/,
  /\.log$/i,
  /^docs\/CODEX_UI_CONTRACT\.md$/,
  /^docs\/roadmap\/LA_Evolution_Master_Blueprint_for_Codex_CN\.md$/,
  /^docs\/ui\/(?:codex-ui-spec-full|CODEX_DESIGN_SPEC|THREE_APPS_PIXEL_SPEC)\.md$/,
  /(^|\/)(?:codex-teardown|asar-src)(?:\/|$)/,
]

function listVersionedAndPendingFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean)
}

test('公开镜像不得包含旧 LA 私有路径或真实项目标识', () => {
  const files = listVersionedAndPendingFiles()
  const forbiddenPaths = files.filter((file) =>
    FORBIDDEN_PATHS.some((pattern) => pattern.test(file)),
  )
  const leakedPrivateText = files
    .filter((file) => TEXT_EXTENSIONS.has(extname(file).toLowerCase()))
    .filter((file) =>
      PRIVATE_TEXT.some((text) =>
        readFileSync(resolve(REPO_ROOT, file), 'utf8').includes(text),
      ),
    )

  assert.deepEqual(
    { forbiddenPaths, leakedPrivateText },
    { forbiddenPaths: [], leakedPrivateText: [] },
    [
      '公开镜像净化检查失败。',
      `禁止路径：\n${forbiddenPaths.join('\n')}`,
      `私有文本：\n${leakedPrivateText.join('\n')}`,
    ].join('\n'),
  )
})
