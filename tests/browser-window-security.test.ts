import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const ROOT = join(import.meta.dir, '..')
const MAIN_PROCESS_ROOT = join(ROOT, 'apps/electron/src/main')

interface BrowserWindowSecurityAssertions {
  contextIsolation: boolean
  nodeIntegrationDisabled: boolean
  sandbox: boolean
  webSecurity: boolean
}

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listTypeScriptFiles(path)
    return entry.isFile() && path.endsWith('.ts') ? [path] : []
  })
}

function getBooleanProperty(
  object: ts.ObjectLiteralExpression,
  name: 'contextIsolation' | 'nodeIntegration' | 'sandbox' | 'webSecurity',
): boolean | null {
  const property = object.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name,
  )
  if (!property || !ts.isPropertyAssignment(property)) return null
  return property.initializer.kind === ts.SyntaxKind.TrueKeyword
    ? true
    : property.initializer.kind === ts.SyntaxKind.FalseKeyword
      ? false
      : null
}

function findBrowserWindowSecurityOptions(filePath: string): BrowserWindowSecurityAssertions[] {
  const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true)
  const windows: BrowserWindowSecurityOptions[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'BrowserWindow' &&
      node.arguments?.[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const options = node.arguments[0]
      const webPreferences = options.properties.find((property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'webPreferences' &&
        ts.isObjectLiteralExpression(property.initializer),
      )

      expect(webPreferences, `${filePath} 的 BrowserWindow 必须有字面量 webPreferences`).toBeDefined()
      if (!webPreferences || !ts.isPropertyAssignment(webPreferences) || !ts.isObjectLiteralExpression(webPreferences.initializer)) {
        return
      }

      windows.push({
        contextIsolation: getBooleanProperty(webPreferences.initializer, 'contextIsolation') === true,
        nodeIntegrationDisabled: getBooleanProperty(webPreferences.initializer, 'nodeIntegration') === false,
        sandbox: getBooleanProperty(webPreferences.initializer, 'sandbox') === true,
        webSecurity: getBooleanProperty(webPreferences.initializer, 'webSecurity') === true,
      })
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return windows
}

describe('AC-004 BrowserWindow 安全配置', () => {
  test('Given 任一主进程 BrowserWindow, When 创建窗口, Then 显式启用隔离、sandbox 和 web security', () => {
    const files = listTypeScriptFiles(MAIN_PROCESS_ROOT)
    const windows = files.flatMap(findBrowserWindowSecurityOptions)

    expect(windows.length).toBeGreaterThan(0)
    expect(windows).toEqual(
      windows.map(() => ({
        contextIsolation: true,
        nodeIntegrationDisabled: true,
        sandbox: true,
        webSecurity: true,
      })),
    )
  })
})
