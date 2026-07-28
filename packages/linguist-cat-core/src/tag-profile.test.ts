import { describe, expect, test } from 'bun:test'
import { normalizeTagProfile } from './tag-profile'

describe('tag profile（PB-097 项目 tag 族登记 normalize）', () => {
  test('合法 profile 原样通过：字段齐全、族顺序保留', () => {
    const profile = normalizeTagProfile({
      families: [
        {
          id: 'grm-qty',
          pattern: '\\[Grm:Qty(?: [A-Za-z]+="[^"]*")+\\]',
          class: 'singleton',
          targetLocales: ['ru'],
          note: '物品数量标签',
        },
        { id: 'icon', pattern: '\\[icon:\\w+\\]', flags: 'gi', class: 'singleton', pairWith: 'icon' },
      ],
    })
    expect(profile).toEqual({
      families: [
        {
          id: 'grm-qty',
          pattern: '\\[Grm:Qty(?: [A-Za-z]+="[^"]*")+\\]',
          class: 'singleton',
          targetLocales: ['ru'],
          note: '物品数量标签',
        },
        { id: 'icon', pattern: '\\[icon:\\w+\\]', flags: 'gi', class: 'singleton', pairWith: 'icon' },
      ],
    })
  })

  test('缺失/非对象/非法 JSON 形状一律回落 undefined，不抛错', () => {
    for (const value of [undefined, null, '', 'x', 0, 42, true, [], {}, { families: 'x' }, { families: {} }]) {
      expect(normalizeTagProfile(value)).toBeUndefined()
    }
  })

  test('缺 id/pattern/class 或 class 非法的族条目整条丢弃；全丢光回落 undefined', () => {
    expect(normalizeTagProfile({ families: [{ pattern: 'x', class: 'singleton' }] })).toBeUndefined()
    expect(normalizeTagProfile({ families: [{ id: 'x', class: 'singleton' }] })).toBeUndefined()
    expect(normalizeTagProfile({ families: [{ id: 'x', pattern: 'y' }] })).toBeUndefined()
    expect(normalizeTagProfile({ families: [{ id: 'x', pattern: 'y', class: 'weird' }] })).toBeUndefined()
    expect(normalizeTagProfile({ families: ['junk', 42, null] })).toBeUndefined()
    // 合法条目保留，非法条目丢弃
    expect(normalizeTagProfile({
      families: [
        { id: '', pattern: 'x', class: 'singleton' },
        { id: 'ok', pattern: '\\[ok\\]', class: 'paired' },
      ],
    })).toEqual({ families: [{ id: 'ok', pattern: '\\[ok\\]', class: 'paired' }] })
  })

  test('可选字段防御：flags/pairWith/note 非字符串丢弃；targetLocales 滤非字符串、空数组丢弃', () => {
    expect(normalizeTagProfile({
      families: [{
        id: 'x',
        pattern: 'y',
        class: 'singleton',
        flags: 42,
        pairWith: '',
        note: null,
        targetLocales: ['ru', 42, ''],
      }],
    })).toEqual({ families: [{ id: 'x', pattern: 'y', class: 'singleton', targetLocales: ['ru'] }] })
    expect(normalizeTagProfile({
      families: [{ id: 'x', pattern: 'y', class: 'singleton', targetLocales: [] }],
    })).toEqual({ families: [{ id: 'x', pattern: 'y', class: 'singleton' }] })
  })
})
