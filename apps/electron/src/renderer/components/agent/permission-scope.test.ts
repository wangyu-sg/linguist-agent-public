import { describe, expect, test } from 'bun:test'
import { summarizePermissionScope } from './permission-scope'

describe('summarizePermissionScope', () => {
  test('Bash：优先 command 字段', () => {
    expect(summarizePermissionScope({ toolName: 'Bash', toolInput: { command: 'ls -la' }, description: '列出目录', command: 'rm -rf /tmp/x' }))
      .toEqual({ kind: 'command', primary: 'rm -rf /tmp/x' })
  })

  test('从常用工具提取实际作用域', () => {
    expect(summarizePermissionScope({ toolName: 'Write', toolInput: { file_path: '/tmp/a.ts' }, description: '写文件' }))
      .toEqual({ kind: 'file', primary: '/tmp/a.ts' })
    expect(summarizePermissionScope({ toolName: 'Grep', toolInput: { pattern: 'foo', path: '/repo' }, description: '搜索' }))
      .toEqual({ kind: 'search', primary: 'foo', detail: '/repo' })
    expect(summarizePermissionScope({ toolName: 'WebFetch', toolInput: { url: 'https://example.com' }, description: '抓取' }))
      .toEqual({ kind: 'web', primary: 'https://example.com' })
    expect(summarizePermissionScope({ toolName: 'Task', toolInput: { description: '探索代码库' }, description: '启动 Agent' }))
      .toEqual({ kind: 'task', primary: '探索代码库' })
  })

  test('缺失作用域时回退非空描述', () => {
    expect(summarizePermissionScope({ toolName: 'Write', toolInput: {}, description: '写入文件' }))
      .toEqual({ kind: 'other', primary: '写入文件' })
    expect(summarizePermissionScope({ toolName: 'Unknown', toolInput: {}, description: '   ' })).toBeNull()
  })
})
