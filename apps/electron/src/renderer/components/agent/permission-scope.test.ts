import { describe, expect, test } from 'bun:test'
import { summarizePermissionScope } from './permission-scope'

describe('summarizePermissionScope', () => {
  test('Bash：优先 command 字段', () => {
    const scope = summarizePermissionScope({
      toolName: 'Bash',
      toolInput: { command: 'ls -la' },
      description: '列出目录',
      command: 'rm -rf /tmp/x',
    })
    expect(scope).toEqual({ kind: 'command', primary: 'rm -rf /tmp/x' })
  })

  test('Bash：无 command 字段时回退 toolInput.command', () => {
    const scope = summarizePermissionScope({
      toolName: 'Bash',
      toolInput: { command: 'bun test' },
      description: '运行测试',
    })
    expect(scope).toEqual({ kind: 'command', primary: 'bun test' })
  })

  test('Bash：无命令时回退 description', () => {
    const scope = summarizePermissionScope({
      toolName: 'Bash',
      toolInput: {},
      description: '执行 shell 命令',
    })
    expect(scope).toEqual({ kind: 'other', primary: '执行 shell 命令' })
  })

  test.each(['Read', 'Write', 'Edit', 'NotebookEdit'])('%s：提取 file_path', (toolName) => {
    const scope = summarizePermissionScope({
      toolName,
      toolInput: { file_path: '/tmp/a.ts' },
      description: '读写文件',
    })
    expect(scope).toEqual({ kind: 'file', primary: '/tmp/a.ts' })
  })

  test('Write：file_path 缺失时回退 description', () => {
    const scope = summarizePermissionScope({
      toolName: 'Write',
      toolInput: {},
      description: '写入文件',
    })
    expect(scope).toEqual({ kind: 'other', primary: '写入文件' })
  })

  test('Glob：pattern + path', () => {
    const scope = summarizePermissionScope({
      toolName: 'Glob',
      toolInput: { pattern: '**/*.ts', path: '/repo/src' },
      description: '搜索文件',
    })
    expect(scope).toEqual({ kind: 'search', primary: '**/*.ts', detail: '/repo/src' })
  })

  test('Grep：pattern 无 path 时无 detail', () => {
    const scope = summarizePermissionScope({
      toolName: 'Grep',
      toolInput: { pattern: 'foo' },
      description: '搜索内容',
    })
    expect(scope).toEqual({ kind: 'search', primary: 'foo', detail: undefined })
  })

  test('Grep：pattern 为空白字符串时回退 description', () => {
    const scope = summarizePermissionScope({
      toolName: 'Grep',
      toolInput: { pattern: '   ' },
      description: '搜索内容',
    })
    expect(scope).toEqual({ kind: 'other', primary: '搜索内容' })
  })

  test('WebFetch：提取 url', () => {
    const scope = summarizePermissionScope({
      toolName: 'WebFetch',
      toolInput: { url: 'https://example.com' },
      description: '抓取网页',
    })
    expect(scope).toEqual({ kind: 'web', primary: 'https://example.com' })
  })

  test('WebSearch：提取 query', () => {
    const scope = summarizePermissionScope({
      toolName: 'WebSearch',
      toolInput: { query: 'bun test runner' },
      description: '搜索网络',
    })
    expect(scope).toEqual({ kind: 'web', primary: 'bun test runner' })
  })

  test.each(['Task', 'Agent'])('%s：提取 description 字段', (toolName) => {
    const scope = summarizePermissionScope({
      toolName,
      toolInput: { description: '探索代码库' },
      description: '启动子 Agent',
    })
    expect(scope).toEqual({ kind: 'task', primary: '探索代码库' })
  })

  test('未知工具：回退 description', () => {
    const scope = summarizePermissionScope({
      toolName: 'mcp__server__tool',
      toolInput: { foo: 'bar' },
      description: '调用 MCP 工具',
    })
    expect(scope).toEqual({ kind: 'other', primary: '调用 MCP 工具' })
  })

  test('description 为空白时返回 null', () => {
    const scope = summarizePermissionScope({
      toolName: 'mcp__server__tool',
      toolInput: {},
      description: '   ',
    })
    expect(scope).toBeNull()
  })
})
