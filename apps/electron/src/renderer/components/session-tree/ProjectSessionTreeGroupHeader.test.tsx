import { describe, expect, test } from 'bun:test'
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectSessionTreeGroupHeader } from './ProjectSessionTreeGroupHeader'

function renderHeader(overrides: Partial<ComponentProps<typeof ProjectSessionTreeGroupHeader>> = {}): string {
  return renderToStaticMarkup(
    <ProjectSessionTreeGroupHeader
      projectId="project-1"
      name="示例项目"
      current={false}
      collapsed={false}
      onSelect={() => {}}
      onToggleCollapse={() => {}}
      {...overrides}
    />,
  )
}

describe('ProjectSessionTreeGroupHeader', () => {
  test('given Agent 或 Linguist 项目 when 渲染 then 共用紧凑项目头与独立折叠控件', () => {
    const html = renderHeader()

    expect(html).toContain('group/project relative flex translate-x-[2px] items-center')
    expect(html).toContain('aria-label="折叠项目 示例项目"')
    expect(html).toContain('aria-controls="project-sessions-project-1"')
    expect(html).toContain('aria-label="打开项目 示例项目"')
    expect(html).toContain('text-[13px] font-medium leading-[18px]')
  })

  test('given 当前可排序项目与动作槽 when 渲染 then 显示统一状态标记、拖拽柄和注入动作', () => {
    const html = renderHeader({
      current: true,
      collapsed: true,
      draggable: true,
      actions: <button type="button">项目动作</button>,
    })

    expect(html).toContain('aria-current="page"')
    expect(html).toContain('workspace-selected-triangle')
    expect(html).toContain('draggable="true"')
    expect(html).toContain('aria-label="展开项目 示例项目"')
    expect(html).toContain('项目动作')
  })
})
