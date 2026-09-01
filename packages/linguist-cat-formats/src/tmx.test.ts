import { describe, expect, test } from 'bun:test'
import { parseTmx } from './tmx'

describe('TMX parser', () => {
  test('preserves occurrence identity, metadata, context, flow, and inline structure', () => {
    const xml = `<tmx version="1.4"><body>
      <tu tuid="t-1" creationtool="demo">
        <prop type="x-context">menu.home</prop>
        <tuv xml:lang="en-US" usage="source"><seg>Hello <bpt i="1">&lt;b&gt;</bpt>world<ept i="1">&lt;/b&gt;</ept></seg></tuv>
        <tuv xml:lang="zh-CN" usage="target"><seg>你好世界</seg></tuv>
      </tu>
      <tu tuid="t-2">
        <tuv xml:lang="en-US"><seg>Next</seg></tuv>
        <tuv xml:lang="zh-CN"><seg>下一个</seg></tuv>
      </tu>
    </body></tmx>`
    const result = parseTmx(new TextEncoder().encode(xml), {
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      filename: 'fixture.tmx',
    })

    expect(result.warnings).toEqual([])
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0]).toMatchObject({
      source: 'Hello <b>world</b>',
      target: '你好世界',
      originalTuid: 't-1',
      contextKey: 'menu.home',
      nextSource: 'Next',
      metadata: {
        'tu.tuid': 't-1',
        'tu.creationtool': 'demo',
        'source.xml:lang': 'en-US',
        'source.usage': 'source',
        'target.xml:lang': 'zh-CN',
        'target.usage': 'target',
        'x-context': 'menu.home',
      },
    })
    expect(result.entries[0]!.sourceInline).toContain('<bpt')
    expect(result.entries[1]).toMatchObject({
      source: 'Next',
      target: '下一个',
      originalTuid: 't-2',
      previousSource: 'Hello <b>world</b>',
    })
  })
})
