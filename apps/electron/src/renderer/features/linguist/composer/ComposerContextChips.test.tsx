import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerContextChips } from './ComposerContextChips'

describe('ComposerContextChips', () => {
  test('given Linguist 上下文 when 原生 Composer 渲染 then 显示 scope、清除入口与窄栏摘要', () => {
    const html = renderToStaticMarkup(
      <ComposerContextChips
        chips={[
          { id: 'project', label: '完美诸神', scope: '项目范围' },
          { id: 'asset', label: '活动公告', scope: '资产范围' },
          {
            id: 'selection',
            label: '已选 12 段',
            scope: '已选片段范围',
            onRemove: () => undefined,
          },
        ]}
      />,
    )

    expect(html).toContain('aria-label="当前 Linguist 上下文"')
    expect(html).toContain('完美诸神')
    expect(html).toContain('活动公告')
    expect(html).toContain('已选 12 段')
    expect(html).toContain('title="项目范围"')
    expect(html).toContain('title="资产范围"')
    expect(html).toContain('aria-label="清除已选 12 段上下文"')
    expect(html).toContain('data-context-chip-summary="true"')
    expect(html).toContain('完美诸神 · 另 2 项')
  })

  test('given 普通 Agent 没有 Linguist 上下文 when 渲染 Composer then 不显示空壳', () => {
    expect(renderToStaticMarkup(<ComposerContextChips chips={[]} />)).toBe('')
  })
})
