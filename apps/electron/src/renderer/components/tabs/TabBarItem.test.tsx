import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TabBarItem } from './TabBarItem'

describe('TabBarItem', () => {
  test('given 可关闭标签页 when 渲染 then 打开主体和关闭动作是同级原生按钮', () => {
    const html = renderToStaticMarkup(
      <TabBarItem
        id="session-a"
        type="agent"
        title="翻译任务"
        isActive
        isStreaming="idle"
        isHovered={false}
        isLeaving={false}
        onActivate={() => undefined}
        onClose={() => undefined}
        onMiddleClick={() => undefined}
        onDragStart={() => undefined}
        onHoverEnter={() => undefined}
        onHoverLeave={() => undefined}
        onPanelHoverEnter={() => undefined}
        onPanelHoverLeave={() => undefined}
      />,
    )

    const openButtonEnd = html.indexOf('</button>')
    const closeButtonStart = html.indexOf('aria-label="关闭标签页：翻译任务"')

    expect(html).toContain('aria-label="打开标签页：翻译任务"')
    expect(closeButtonStart).toBeGreaterThan(openButtonEnd)
    expect(html).not.toContain('role="button"')
  })

  test('given 中键落在主体或关闭按钮 when 按下 then 两个入口都保留中键关闭处理', async () => {
    const source = await Bun.file(new URL('./TabBarItem.tsx', import.meta.url)).text()

    expect(source).toMatch(
      /aria-label=\{`关闭标签页：\$\{title\}`\}[\s\S]*?onClick=\{handleCloseClick\}\s+onMouseDown=\{handleMouseDown\}/,
    )
  })
})
