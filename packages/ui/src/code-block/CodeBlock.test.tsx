import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeBlock } from './CodeBlock'

describe('CodeBlock', () => {
  test('given 可横向滚动的代码 when 渲染 then 代码区可聚焦且有说明', () => {
    const html = renderToStaticMarkup(
      <CodeBlock>
        <code className="language-typescript">const veryLongLine = 'scroll me'</code>
      </CodeBlock>,
    )

    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-label="代码内容，可水平滚动"')
  })
})
