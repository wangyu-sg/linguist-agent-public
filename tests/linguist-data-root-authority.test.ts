import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'

const REPO_ROOT = join(import.meta.dir, '..')
const ROOT_LITERAL = /\.linguist-agent(?:-dev)?/
const ALLOWED = new Set([
  'apps/electron/src/main/lib/config-paths.ts',
  'apps/electron/src/main/lib/electron-user-data-path.ts',
  'apps/cli/src/paths.ts',
])

function sourceFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.includes('.test.') && !entry.name.includes('.nodetest.')) files.push(path)
  }
  return files
}

test('Linguist 数据根字面量只出现在权威路径解析模块', () => {
  const roots = [
    join(REPO_ROOT, 'apps/electron/src/main'),
    join(REPO_ROOT, 'apps/cli/src'),
  ]
  const violations: string[] = []
  for (const file of roots.flatMap(sourceFiles)) {
    const repoPath = relative(REPO_ROOT, file).split('\\').join('/')
    if (ALLOWED.has(repoPath)) continue
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && ROOT_LITERAL.test(node.text)) {
        violations.push(`${repoPath}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(violations).toEqual([])
})
