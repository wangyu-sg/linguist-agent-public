import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const TARGETS = [
  resolve(import.meta.dir, 'LeftSidebar.tsx'),
  resolve(import.meta.dir, '../tabs/TabBarItem.tsx'),
  resolve(import.meta.dir, '../../features/linguist/projects/ProjectCard.tsx'),
]

function staticRole(node: ts.JsxOpeningLikeElement): string | undefined {
  const role = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property)
      && ts.isIdentifier(property.name)
      && property.name.text === 'role',
  )
  return role?.initializer && ts.isStringLiteral(role.initializer)
    ? role.initializer.text
    : undefined
}

function isInteractive(node: ts.JsxOpeningLikeElement): boolean {
  const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : ''
  return tag === 'button' || staticRole(node) === 'button' || staticRole(node) === 'tab'
}

function nestedInteractiveLines(filePath: string): number[] {
  const source = readFileSync(filePath, 'utf8')
  const file = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines: number[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && isInteractive(node.openingElement)) {
      let parent = node.parent
      while (parent) {
        if (ts.isJsxElement(parent) && isInteractive(parent.openingElement)) {
          lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
          break
        }
        parent = parent.parent
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(file)
  return lines
}

describe('结构性无障碍契约', () => {
  test('given 主体与行内动作共存 when 编译 TSX then 不产生 nested-interactive', () => {
    for (const target of TARGETS) {
      expect(nestedInteractiveLines(target)).toEqual([])
    }
  })

  test('given 侧边栏图标动作 when 读取源码 then 搜索、折叠和会话操作都有名称', () => {
    const source = readFileSync(TARGETS[0]!, 'utf8')
    expect(source).toContain('aria-label="搜索会话"')
    expect(source).toContain('aria-label="收起侧边栏"')
    expect(source).toContain("aria-label={pinned ? '取消置顶' : '置顶'}")
    expect(source).toContain('aria-label="更多会话操作"')
    expect(source).toContain('tabular-nums text-foreground/65')
  })

  test('given Chat 标题进入编辑态 when 使用辅助技术 then 输入框有可访问名称', () => {
    const source = readFileSync(resolve(import.meta.dir, '../chat/ChatHeader.tsx'), 'utf8')
    expect(source).toContain('aria-label="对话标题"')
  })

  test('given 收起态 mini rail when 读取源码 then 不再堆叠最近会话列且保留搜索与模式入口', () => {
    const source = readFileSync(TARGETS[0]!, 'utf8')
    // 60px mini rail 内堆叠最近会话会退化成单字列，已整列移除
    expect(source).not.toContain('railRecentItems')
    expect(source).not.toContain('RailRecentButton')
    expect(source).toContain('aria-label="搜索"')
    expect(source).toContain('aria-label="展开侧边栏"')
  })

  test('given 展开与收起两种形态 when 读取源码 then Agent 技能入口各自唯一', () => {
    const source = readFileSync(TARGETS[0]!, 'utf8')
    // 展开态只有顶部 SkillsSidebarEntry 行；收起态只有一个图标按钮
    expect(source.match(/<SkillsSidebarEntry/g)).toHaveLength(1)
    expect(source.match(/aria-label="Agent 技能"/g)).toHaveLength(1)
  })

  test('given Linguist 模式 when 渲染 Proma 侧边栏宿主 then 复用共享的新建与搜索形态', () => {
    const source = readFileSync(TARGETS[0]!, 'utf8')
    const collapsedPrimary = source.slice(
      source.indexOf('{/* 高频操作 */}'),
      source.indexOf('aria-label="搜索"'),
    )
    const modeAndCollapse = source.slice(
      source.indexOf('{/* 模式切换器 + 折叠按钮 */}'),
      source.indexOf('{/* 新对话/新会话按钮 + 搜索按钮 */}'),
    )
    const expandedPrimary = source.slice(
      source.indexOf('{/* 新对话/新会话按钮 + 搜索按钮 */}'),
      source.indexOf('{/* 任务/日程入口：作为统一规划中心入口。 */}'),
    )

    expect(collapsedPrimary).not.toContain("mode !== 'linguist'")
    expect(modeAndCollapse).not.toContain("mode === 'linguist'")
    expect(expandedPrimary).not.toContain("mode !== 'linguist'")
    expect(source).toContain('void handleCreatePrimaryItem()')

    const linguistSource = readFileSync(
      resolve(import.meta.dir, '../../features/linguist/sidebar/LinguistSidebarContent.tsx'),
      'utf8',
    )
    expect(linguistSource).toContain('<ProjectSessionTreeGroupHeader')
    expect(linguistSource).toContain('SessionRowComponent={SessionRowComponent}')
  })

  test('given 模型选择器打开 when 使用辅助技术搜索 then 搜索框有可访问名称', () => {
    const source = readFileSync(resolve(import.meta.dir, '../chat/ModelSelector.tsx'), 'utf8')
    expect(source).toContain('aria-label="搜索模型"')
  })

  test('given Chat 工具列表打开 when 使用辅助技术切换工具 then 每个开关使用工具名称', () => {
    const source = readFileSync(resolve(import.meta.dir, '../chat/ToolSelectorPopover.tsx'), 'utf8')
    expect(source).toContain('aria-label={tool.meta.name}')
    expect(source).toContain('aria-label="工具面板"')
  })

  test('given 系统提示词菜单打开 when 仅使用键盘 then 所有动作都是菜单项', () => {
    const source = readFileSync(resolve(import.meta.dir, '../chat/SystemPromptSelector.tsx'), 'utf8')
    expect(source.match(/<DropdownMenuItem/g)).toHaveLength(2)
    expect(source).not.toContain('onClick=')
    expect(source).toContain('<DropdownMenu modal={false}')
    expect(source).toContain('text-xs text-foreground/70 shrink-0')
  })
})
