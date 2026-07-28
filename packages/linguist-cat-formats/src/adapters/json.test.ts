/**
 * JsonAdapter tests (PB-023, JSON leg).
 *
 * Synthetic fixtures only (tests/linguist-fixtures/): mini_items.json
 * (game-items flavor: nested groups, CJK, {count} placeholder, escaped
 * chars incl. raw \u00e9, an empty string leaf, number/boolean/null
 * non-segment leaves). All code and fixtures fresh-written for this repo.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAsset, createProject, createSeededEntropy } from '@linguist/cat-core'
import { bindImportedSegments, FormatExportError, FormatParseError } from '../index'
import { assertRoundTrip } from '../testing/index'
import { JsonAdapter } from './json'

const FIXTURES = join(import.meta.dir, '../../../../tests/linguist-fixtures')

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)))
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

async function importBytes(bytes: Uint8Array, filename: string, adapter = new JsonAdapter()) {
  return adapter.import({ bytes, filename, sourceLocale: 'en-US', targetLocale: 'zh-CN' })
}

async function importFixture(name: string, adapter = new JsonAdapter()) {
  const bytes = fixtureBytes(name)
  const imported = await importBytes(bytes, name, adapter)
  return { adapter, bytes, imported }
}

const NOW = '2026-01-01T00:00:00.000Z'

/** Binds imported segments to a deterministic asset (same pattern as the harness). */
async function boundSegments(name: string, imported: Awaited<ReturnType<JsonAdapter['import']>>) {
  const project = createProject(
    { name: 'json-test', sourceLocale: 'en-US', targetLocale: 'zh-CN', promaWorkspaceId: 'json-test' },
    { entropy: createSeededEntropy(`json-test:${name}`), now: NOW },
  )
  const asset = createAsset({
    projectId: project.id,
    formatId: imported.asset.formatId,
    originalFilename: name,
    sourceSha256: imported.asset.sourceSha256,
    segmentCount: imported.asset.segmentCount,
  })
  return { asset, segments: bindImportedSegments(imported.segments, asset.id) }
}

describe('JsonAdapter detect', () => {
  test('.json + i18n 内容 => 0.8；仅字节 => 0.4；非 i18n JSON / 非 JSON / 二进制 => 0', async () => {
    const adapter = new JsonAdapter()
    const json = fixtureBytes('mini_items.json')
    expect(await adapter.detect(json, 'mini_items.json')).toBe(0.8)
    expect(await adapter.detect(json, 'renamed.bin')).toBe(0.4)
    expect(await adapter.detect(encode('[{"source": "Hello"}]'), 'entries.txt')).toBe(0.4)
    // 无字符串叶的对象 / 无 source 字段的数组 / 顶层原始值：不是 i18n 内容
    expect(await adapter.detect(encode('{"a": 1, "b": true}'), 'data.json')).toBe(0)
    expect(await adapter.detect(encode('[{"foo": "bar"}]'), 'data.json')).toBe(0)
    expect(await adapter.detect(encode('42'), 'data.json')).toBe(0)
    // 非 JSON / 非法 UTF-8 / 二进制
    expect(await adapter.detect(encode('key,source\na,b\n'), 'data.json')).toBe(0)
    expect(await adapter.detect(new Uint8Array([0xff, 0xfe, 0x7b]), 'data.json')).toBe(0)
    expect(await adapter.detect(new Uint8Array([0, 1, 2, 123]), 'data.json')).toBe(0)
    // 自定义映射影响 detect 的数组形状判定
    const custom = new JsonAdapter({ arrayMapping: { source: 'en' } })
    expect(await custom.detect(encode('[{"en": "Hello"}]'), 'data.txt')).toBe(0.4)
    expect(await custom.detect(encode('[{"source": "Hello"}]'), 'data.json')).toBe(0)
  })
})

describe('JsonAdapter import（flat/nested 形状）', () => {
  test('mini_items：嵌套展平为 dotted key、CJK、占位符、空字符串叶、非字符串叶不是段', async () => {
    const { imported } = await importFixture('mini_items.json')
    expect(imported.asset.formatId).toBe('json_i18n')
    expect(imported.asset.segmentCount).toBe(8)
    expect(imported.segments.map((s) => s.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(imported.warnings).toHaveLength(0)
    expect(imported.segments.map((s) => s.key)).toEqual([
      'items.potion.name',
      'items.potion.desc',
      'items.potion.lore',
      'items.sword.name',
      'items.sword.desc',
      'items.sword.flavor',
      'ui.equip',
      'ui.compare_hint',
    ])

    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    // flat i18n 叶是 SOURCE 字符串：target 一律从 '' 开始（untranslated）
    expect(byKey.get('items.potion.name')?.source).toBe('Health Potion')
    expect(byKey.get('items.potion.name')?.target).toBe('')
    expect(byKey.get('items.potion.name')?.status).toBe('untranslated')
    // {count} 占位符逐字保留在源文中
    expect(byKey.get('items.potion.desc')?.source).toBe('Restores {count} HP.\n"Drink up, traveler!"')
    // CJK 源文原样保留
    expect(byKey.get('items.potion.lore')?.source).toBe('晨露酿造，回甘绵长')
    // 空字符串叶是段（source '' / target ''）
    expect(byKey.get('ui.compare_hint')?.source).toBe('')
    expect(byKey.get('ui.compare_hint')?.status).toBe('untranslated')
    // 非字符串叶（version 3 / premium_only false / event_end null）不产生段
    expect([...byKey.keys()].some((k) => k !== undefined && k.startsWith('meta'))).toBe(false)
  })

  test('转义序列解码：`\\n`、`\\"`、`\\\\`、`\\u00e9`、代理对 emoji', async () => {
    const { imported } = await importFixture('mini_items.json')
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('items.sword.desc')?.source).toBe('A sturdy blade. Path: C:\\forge\\iron')
    expect(byKey.get('items.sword.flavor')?.source).toBe('Forged at the café forge')

    const emoji = await importBytes(encode('{"face": "\\uD83D\\uDE00 \\u0041"}'), 'emoji.json')
    expect(emoji.segments[0]?.source).toBe('😀 A')
  })

  test('raw key 含字面点/反斜杠 => 转义后 dotted key 不冲突；key 内 \\u 转义照常解码', async () => {
    const text = '{"a.b": {"c": "x"}, "a": {"b.c": "y"}, "caf\\u00e9": "z"}'
    const imported = await importBytes(encode(text), 'dots.json')
    expect(imported.segments.map((s) => s.key)).toEqual(['a\\.b.c', 'a.b\\.c', 'café'])
    expect(imported.segments.map((s) => s.source)).toEqual(['x', 'y', 'z'])
  })

  test('重复 raw key：import 记 warning 并取最后值（JSON.parse 语义）', async () => {
    const imported = await importBytes(encode('{"a": "first", "b": "mid", "a": "last"}'), 'dup.json')
    expect(imported.segments.map((s) => s.key)).toEqual(['a', 'b'])
    expect(imported.segments[0]?.source).toBe('last')
    expect(imported.warnings.some((w) => w.code === 'json.duplicate_key')).toBe(true)
  })
})

describe('JsonAdapter import（array 形状 + 可配置映射）', () => {
  test('默认映射：id/source/target/locked；缺 target => ""；非字符串 target => ""', async () => {
    const text = [
      '[',
      '  { "id": "greet", "source": "Hello", "target": "你好" },',
      '  { "id": "farewell", "source": "Bye" },',
      '  { "id": "legal", "source": "EULA text", "target": "EULA text", "locked": true },',
      '  { "id": "weird", "source": "Nullable", "target": null }',
      ']',
    ].join('\n')
    const imported = await importBytes(encode(text), 'entries.json')
    expect(imported.warnings).toHaveLength(0)
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('greet')?.target).toBe('你好')
    expect(byKey.get('greet')?.status).toBe('translated')
    expect(byKey.get('farewell')?.target).toBe('')
    expect(byKey.get('farewell')?.status).toBe('untranslated')
    expect(byKey.get('legal')?.locked).toBe(true)
    expect(byKey.get('legal')?.target).toBe('EULA text')
    expect(byKey.get('weird')?.target).toBe('')
  })

  test('自定义字段映射（constructor options）；缺 source 字段的条目被跳过并记 warning', async () => {
    const text = '[{"key": "g1", "en": "Hello", "zh": "你好", "lock": true}, {"key": "g2", "en": "World"}, {"key": "g3"}]'
    const adapter = new JsonAdapter({ arrayMapping: { id: 'key', source: 'en', target: 'zh', locked: 'lock' } })
    const imported = await importBytes(encode(text), 'custom.json', adapter)
    const byKey = new Map(imported.segments.map((s) => [s.key, s]))
    expect(byKey.get('g1')?.source).toBe('Hello')
    expect(byKey.get('g1')?.target).toBe('你好')
    expect(byKey.get('g1')?.locked).toBe(true)
    expect(byKey.get('g2')?.target).toBe('')
    expect(imported.segments).toHaveLength(2)
    expect(imported.warnings).toHaveLength(1)
    expect(imported.warnings[0]?.code).toBe('json.entry_skipped')
  })

  test('重复 / 缺失 id => 合成 #idx-<ordinal> + warning（与 CSV leg 同策略）', async () => {
    const text = '[{"id": "a", "source": "one"}, {"id": "a", "source": "two"}, {"source": "three"}]'
    const imported = await importBytes(encode(text), 'dupids.json')
    expect(imported.segments.map((s) => s.key)).toEqual(['a', '#idx-1', '#idx-2'])
    expect(imported.segments.map((s) => s.source)).toEqual(['one', 'two', 'three'])
    expect(imported.warnings).toHaveLength(2)
    expect(imported.warnings.every((w) => w.code === 'json.synthesized_key')).toBe(true)
    expect(imported.warnings[0]?.segmentKey).toBe('#idx-1')
  })
})

describe('JsonAdapter round-trip（assertRoundTrip harness）', () => {
  test('mini_items.json：flat 形状字节稳定（modify 全 null——编辑导出语义见专项测试）', async () => {
    const report = await assertRoundTrip(new JsonAdapter(), fixtureBytes('mini_items.json'), {
      filename: 'mini_items.json',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      // flat i18n 是源文件：target 从 '' 开始，导出把译文写进叶值产出译文文件，
      // 重导入会把译文读作新源文（预期产品流），故 harness 只验证未修改路径。
      modify: () => null,
    })
    expect(report.segmentCount).toBe(8)
    expect(report.modifiedSegmentIds).toHaveLength(0)
  })

  test('array 形状：字节稳定 + 修改子集写回（含缺失 target 字段插入；锁定条目不被 harness 修改）', async () => {
    const text = [
      '[',
      '  { "id": "greet", "source": "Hello", "target": "你好" },',
      '  { "id": "farewell", "source": "Bye" },',
      '  { "id": "legal", "source": "EULA text", "target": "EULA text", "locked": true }',
      ']',
    ].join('\n')
    const report = await assertRoundTrip(new JsonAdapter(), encode(text), {
      filename: 'entries.json',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      modify: (_segment, index) => (index < 2 ? `[zh-CN] ${_segment.source}` : null),
    })
    expect(report.segmentCount).toBe(3)
    expect(report.modifiedSegmentIds).toHaveLength(2)
    const out = new TextDecoder().decode(report.exportedBytes)
    // 已有 target 字段：只重写该字段的值 span
    expect(out).toContain('{ "id": "greet", "source": "Hello", "target": "[zh-CN] Hello" }')
    // 缺 target 字段：在 source 字段后插入（沿用文件的空格风格）
    expect(out).toContain('{ "id": "farewell", "source": "Bye", "target": "[zh-CN] Bye" }')
    // 锁定条目逐字节不动
    expect(out).toContain('{ "id": "legal", "source": "EULA text", "target": "EULA text", "locked": true }')
  })

  test('未修改导出逐字节等于原始字节（flat fixture 与 BOM 变体的显式抽查）', async () => {
    const { adapter, bytes, imported } = await importFixture('mini_items.json')
    const { asset, segments } = await boundSegments('mini_items.json', imported)
    const exported = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(exported).equals(Buffer.from(bytes))).toBe(true)

    const bomBytes = encode('\uFEFF{\n  "greet": "你好"\n}')
    const bomImport = await importBytes(bomBytes, 'bom.json')
    expect(bomImport.segments[0]?.source).toBe('你好')
    const bound = await boundSegments('bom.json', bomImport)
    const bomExported = await adapter.export({ originalBytes: bomBytes, asset: bound.asset, segments: bound.segments })
    expect(Buffer.from(bomExported).equals(Buffer.from(bomBytes))).toBe(true)
  })
})

describe('JsonAdapter export（flat 形状编辑语义）', () => {
  test('只替换被编辑叶值：非字符串叶/raw 转义/键序/空白逐字节不动；重导入把译文读作新源文', async () => {
    const { adapter, bytes, imported } = await importFixture('mini_items.json')
    const { asset, segments } = await boundSegments('mini_items.json', imported)
    const edited = segments.map((s) => {
      if (s.key === 'ui.equip') return { ...s, target: '装备' }
      if (s.key === 'items.sword.desc') return { ...s, target: '结实的刀刃。\n"第二行" \\ 完' }
      return s
    })
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    const out = new TextDecoder().decode(exported)

    // 被编辑叶：JSON 字符串规范转义写入
    expect(out).toContain('"equip": "装备"')
    expect(out).toContain('"desc": "结实的刀刃。\\n\\"第二行\\" \\\\ 完"')
    // 未编辑叶的 raw 形态保留（含 \\u00e9 与 \\n 的原始转义字节）
    expect(out).toContain('"flavor": "Forged at the caf\\u00e9 forge"')
    expect(out).toContain('"desc": "Restores {count} HP.\\n\\"Drink up, traveler!\\""')
    // 非字符串叶与整体结构（键序/缩进）不动
    expect(out).toContain('"meta": {\n    "version": 3,\n    "premium_only": false,\n    "event_end": null\n  }')
    // diff 只发生在两个叶值上：去掉两处替换后与原文一致
    const original = new TextDecoder().decode(bytes)
    expect(out.length - original.length).toBe(
      '"装备"'.length - '"Equip"'.length + (JSON.stringify('结实的刀刃。\n"第二行" \\ 完').length - '"A sturdy blade. Path: C:\\\\forge\\\\iron"'.length),
    )

    // 重导入导出产物 => 译文文件：keys 不变，译文出现在 source 位置（预期产品流）
    const reimported = await importBytes(exported, 'mini_items.json', adapter)
    const byKey = new Map(reimported.segments.map((s) => [s.key, s]))
    expect(byKey.get('ui.equip')?.source).toBe('装备')
    expect(byKey.get('items.sword.desc')?.source).toBe('结实的刀刃。\n"第二行" \\ 完')
    expect(byKey.get('items.potion.lore')?.source).toBe('晨露酿造，回甘绵长')
  })
})

describe('JsonAdapter 错误路径（typed errors）', () => {
  test('畸形输入 => FormatParseError（FORMAT_PARSE_ERROR），绝不部分静默导入', async () => {
    const adapter = new JsonAdapter()
    const cases: Array<[string, Uint8Array]> = [
      ['empty.json', encode('')],
      ['trailing-comma.json', encode('{"a": "x",}')],
      ['unclosed-string.json', encode('{"a": "unclosed}')],
      ['bad-escape.json', encode('{"a": "bad \\x escape"}')],
      ['control-char.json', encode('{"a": "raw\nnewline"}')],
      ['trailing-garbage.json', encode('{"a": "x"} garbage')],
      ['top-level-number.json', encode('42')],
      ['no-string-leaves.json', encode('{"a": 1, "b": [true, null]}')],
      ['array-no-source.json', encode('[{"foo": "bar"}]')],
      ['empty-array.json', encode('[]')],
      ['bad-utf8.json', new Uint8Array([0xff, 0xfe, 0x7b])],
    ]
    for (const [filename, bytes] of cases) {
      let caught: unknown
      try {
        await adapter.import({ bytes, filename, sourceLocale: 'en', targetLocale: 'zh' })
      } catch (err) {
        caught = err
      }
      expect(caught, filename).toBeInstanceOf(FormatParseError)
      expect((caught as FormatParseError).code).toBe('FORMAT_PARSE_ERROR')
    }
  })

  test('导出拒绝未知 key / 缺失段 / 源文被篡改 / 导出输入重复 key => FormatExportError', async () => {
    const { adapter, bytes, imported } = await importFixture('mini_items.json')
    const { asset, segments } = await boundSegments('mini_items.json', imported)

    const unknown = [{ ...segments[0]!, key: 'does.not.exist' }, ...segments.slice(1)]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: unknown })).rejects.toBeInstanceOf(FormatExportError)

    await expect(adapter.export({ originalBytes: bytes, asset, segments: segments.slice(1) })).rejects.toBeInstanceOf(FormatExportError)

    const tamperedSource = segments.map((s, i) => (i === 0 ? { ...s, source: 'MUTATED' } : s))
    await expect(adapter.export({ originalBytes: bytes, asset, segments: tamperedSource })).rejects.toBeInstanceOf(FormatExportError)

    const dup = [...segments, { ...segments[0]! }]
    await expect(adapter.export({ originalBytes: bytes, asset, segments: dup })).rejects.toBeInstanceOf(FormatExportError)
  })

  test('锁定条目 target 被改 => FormatExportError；未改则字节稳定', async () => {
    const bytes = encode('[{ "id": "legal", "source": "EULA", "target": "EULA", "locked": true }]')
    const adapter = new JsonAdapter()
    const imported = await importBytes(bytes, 'locked.json', adapter)
    const { asset, segments } = await boundSegments('locked.json', imported)
    const unmodified = await adapter.export({ originalBytes: bytes, asset, segments })
    expect(Buffer.from(unmodified).equals(Buffer.from(bytes))).toBe(true)

    const tamperedLocked = segments.map((s) => ({ ...s, target: 'MUTATED' }))
    let lockedErr: unknown
    try {
      await adapter.export({ originalBytes: bytes, asset, segments: tamperedLocked })
    } catch (err) {
      lockedErr = err
    }
    expect(lockedErr).toBeInstanceOf(FormatExportError)
    expect((lockedErr as FormatExportError).code).toBe('FORMAT_EXPORT_ERROR')
    expect((lockedErr as FormatExportError).message).toContain('locked')
  })

  test('模板含重复 raw key => 导出 FormatExportError（按 key splice 有歧义，绝不静默）', async () => {
    const bytes = encode('{"a": "first", "b": "mid", "a": "last"}')
    const adapter = new JsonAdapter()
    const imported = await importBytes(bytes, 'dup.json', adapter)
    const { asset, segments } = await boundSegments('dup.json', imported)
    let caught: unknown
    try {
      await adapter.export({ originalBytes: bytes, asset, segments })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(FormatExportError)
    expect((caught as FormatExportError).message).toContain('duplicate object key')
  })
})
