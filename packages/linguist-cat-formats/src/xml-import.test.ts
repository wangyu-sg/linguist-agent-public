import { describe, expect, test } from 'bun:test'
import { FormatParseError } from './errors'
import { parseTbx } from './tbx'
import { parseTmx } from './tmx'

const bytes = (xml: string): Uint8Array => new TextEncoder().encode(xml)

describe('TMX 纯解析', () => {
  test('支持 namespace、xml:lang/lang、实体和唯一主语言回退', () => {
    const result = parseTmx(bytes(`
      <x:tmx xmlns:x="urn:tmx" version="1.4">
        <x:body>
          <x:tu tuid="one">
            <x:tuv xml:lang="en-US"><x:seg>Save &amp; Close <x:ph id="1"/></x:seg></x:tuv>
            <x:tuv lang="zh-CN"><x:seg>保存&#x4E0E;关闭</x:seg></x:tuv>
          </x:tu>
        </x:body>
      </x:tmx>
    `), { sourceLocale: 'en-GB', targetLocale: 'zh-CN' })

    expect(result.entries).toEqual([{
      source: 'Save & Close',
      target: '保存与关闭',
      sourceLocale: 'en-GB',
      targetLocale: 'zh-CN',
    }])
    expect(result.warnings.map((item) => item.code)).toEqual(['tmx.inline_markup_flattened'])
  })

  test('同主语言存在多个 locale 时不猜测', () => {
    const input = bytes(`
      <tmx><body><tu>
        <tuv xml:lang="en-US"><seg>Color</seg></tuv>
        <tuv xml:lang="en-GB"><seg>Colour</seg></tuv>
        <tuv xml:lang="zh-CN"><seg>颜色</seg></tuv>
      </tu></body></tmx>
    `)
    expect(() => parseTmx(input, { sourceLocale: 'en-AU', targetLocale: 'zh-CN' }))
      .toThrow(FormatParseError)
  })

  test('畸形 XML 和零有效翻译对均明确失败', () => {
    expect(() => parseTmx(bytes('<tmx><body></tmx>'), {
      sourceLocale: 'en',
      targetLocale: 'zh',
    })).toThrow(/XML 格式错误/)
    expect(() => parseTmx(bytes('<tmx><body><tu/></body></tmx>'), {
      sourceLocale: 'en',
      targetLocale: 'zh',
    })).toThrow(/未找到有效/)
  })
})

describe('TBX v2/v3 纯解析', () => {
  test('解析 v2 termEntry/langSet/tig，保留 note 且默认大小写不敏感', () => {
    const result = parseTbx(bytes(`
      <m:martif xmlns:m="urn:iso:std:iso:30042:ed-2">
        <m:text><m:body><m:termEntry id="c1">
          <m:langSet xml:lang="en">
            <m:tig><m:term>Rock &amp; Roll</m:term></m:tig>
          </m:langSet>
          <m:langSet lang="zh-CN">
            <m:tig>
              <m:term>摇滚&#x4E50;</m:term>
              <m:termNote type="administrativeStatus">preferredTerm-admn-sts</m:termNote>
              <m:note>音乐类型</m:note>
            </m:tig>
          </m:langSet>
        </m:termEntry></m:body></m:text>
      </m:martif>
    `), { sourceLocale: 'en-US', targetLocale: 'zh-CN' })

    expect(result).toEqual({
      entries: [{
        term: 'Rock & Roll',
        translation: '摇滚乐',
        status: 'preferred',
        note: '音乐类型',
        caseSensitive: false,
      }],
      warnings: [],
    })
  })

  test('解析 v3 conceptEntry/langSec/termSec 并规范化状态', () => {
    const result = parseTbx(bytes(`
      <tbx xmlns="urn:iso:std:iso:30042:ed-3">
        <text><body><conceptEntry id="c2">
          <langSec xml:lang="en"><termSec><term>API</term></termSec></langSec>
          <langSec xml:lang="zh">
            <termSec caseSensitive="true"><term>接口</term><termNote type="status">admitted</termNote></termSec>
            <termSec><term>旧接口</term><termNote type="administrativeStatus">deprecatedTerm-admn-sts</termNote></termSec>
            <termSec><term>禁用接口</term><termNote type="administrativeStatus">supersededTerm-admn-sts</termNote></termSec>
            <termSec><term>通用接口</term></termSec>
            <termSec><term>其他接口</term><termNote type="status">custom</termNote></termSec>
          </langSec>
        </conceptEntry></body></text>
      </tbx>
    `), { sourceLocale: 'en', targetLocale: 'zh' })

    expect(result.entries.map(({ status }) => status)).toEqual([
      'allowed',
      'deprecated',
      'forbidden',
      'allowed',
      'allowed',
    ])
    expect(result.entries[0]?.caseSensitive).toBe(true)
    expect(result.warnings.map((item) => item.code)).toEqual([
      'tbx.status_defaulted',
      'tbx.status_defaulted',
    ])
  })

  test('locale 歧义、畸形 XML 和零有效术语对均明确失败', () => {
    const ambiguous = bytes(`
      <tbx><conceptEntry>
        <langSec xml:lang="en-US"><termSec><term>Color</term></termSec></langSec>
        <langSec xml:lang="en-GB"><termSec><term>Colour</term></termSec></langSec>
        <langSec xml:lang="zh"><termSec><term>颜色</term></termSec></langSec>
      </conceptEntry></tbx>
    `)
    expect(() => parseTbx(ambiguous, { sourceLocale: 'en-AU', targetLocale: 'zh' }))
      .toThrow(/未找到有效/)
    expect(() => parseTbx(bytes('<tbx><conceptEntry></tbx>'), {
      sourceLocale: 'en',
      targetLocale: 'zh',
    })).toThrow(/XML 格式错误/)
    expect(() => parseTbx(bytes('<tbx/>'), {
      sourceLocale: 'en',
      targetLocale: 'zh',
    })).toThrow(/未找到有效/)
  })

  test('拒绝内部实体声明', () => {
    const input = bytes('<!DOCTYPE tbx [<!ENTITY x "boom">]><tbx>&x;</tbx>')
    expect(() => parseTbx(input, { sourceLocale: 'en', targetLocale: 'zh' }))
      .toThrow(/不允许 XML 实体声明/)
  })
})
