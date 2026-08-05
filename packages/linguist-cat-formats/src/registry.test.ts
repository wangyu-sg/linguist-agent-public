import { describe, expect, test } from 'bun:test'
import type { CatFormatAdapter, CatFormatExportInput, CatFormatImportInput } from './index'
import { CatFormatRegistry, FormatUnsupportedError } from './index'
import { encodeFakeTsv, FakeAdapter } from './testing/index'

/** 最小存根 adapter：按魔数字节给高分、按扩展名给低分。 */
function makeStubAdapter(id: string, ext: string, magic: number[]): CatFormatAdapter {
  return {
    id,
    extensions: [ext],
    async detect(input: Uint8Array, filename: string): Promise<number> {
      const hasMagic = magic.every((byte, i) => input[i] === byte)
      if (hasMagic) return 0.95
      if (filename.toLowerCase().endsWith(ext)) return 0.5
      return 0
    },
    async import(_input: CatFormatImportInput): Promise<never> {
      throw new Error('stub: not implemented')
    },
    async export(_input: CatFormatExportInput): Promise<never> {
      throw new Error('stub: not implemented')
    },
  }
}

describe('CatFormatRegistry', () => {
  test('register/list/get/has；重复 id 抛错', () => {
    const registry = new CatFormatRegistry()
    expect(registry.list()).toEqual([])
    const fake = new FakeAdapter()
    registry.register(fake)
    expect(registry.has('fake_tsv')).toBe(true)
    expect(registry.get('fake_tsv')).toBe(fake)
    expect(registry.list()).toEqual([fake])
    expect(() => registry.register(new FakeAdapter())).toThrow(/already registered/)
  })

  test('detectAll 按 detect 分数降序排序，detectBest 选最高分（内容魔数胜过扩展名）', async () => {
    const registry = new CatFormatRegistry()
    registry.register(new FakeAdapter()) // .ftsv → 0.9
    registry.register(makeStubAdapter('stub_magic', '.stub', [0xde, 0xad]))
    const bytes = new Uint8Array([0xde, 0xad, 0x00, 0x01])
    const matches = await registry.detectAll(bytes, 'file.ftsv')
    // FakeAdapter 遇 NUL 字节得 0；stub 魔数命中
    expect(matches.map((m) => m.adapter.id)).toEqual(['stub_magic'])
    expect((await registry.detectBest(bytes, 'file.ftsv')).id).toBe('stub_magic')

    const ftsvBytes = encodeFakeTsv([{ key: 'k', source: 's' }])
    const matches2 = await registry.detectAll(ftsvBytes, 'file.ftsv')
    expect(matches2[0]!.adapter.id).toBe('fake_tsv')
    expect(matches2[0]!.score).toBe(0.9)
    // 降序断言
    for (let i = 1; i < matches2.length; i++) {
      expect(matches2[i]!.score).toBeLessThanOrEqual(matches2[i - 1]!.score)
    }
  })

  test('同分时保持注册顺序（稳定排序）', async () => {
    const registry = new CatFormatRegistry()
    const a = makeStubAdapter('stub_a', '.tie', [])
    const b = makeStubAdapter('stub_b', '.tie', [])
    registry.register(a).register(b)
    const matches = await registry.detectAll(new Uint8Array([1, 2]), 'x.tie')
    expect(matches.map((m) => m.adapter.id)).toEqual(['stub_a', 'stub_b'])
  })

  test('未知扩展名 + 无任何 detect 命中 → FormatUnsupportedError（含已尝试 adapter 列表）', async () => {
    const registry = new CatFormatRegistry()
    registry.register(new FakeAdapter())
    const err = await registry
      .detectBest(new Uint8Array([0x00, 0x01, 0x02]), 'mystery.unknown')
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect(err).toBeInstanceOf(FormatUnsupportedError)
    expect((err as FormatUnsupportedError).code).toBe('FORMAT_UNSUPPORTED')
    expect((err as FormatUnsupportedError).message).toContain('mystery.unknown')
    expect((err as FormatUnsupportedError).message).toContain('fake_tsv')
  })

  test('空 registry → 清晰的 unsupported 错误', async () => {
    const registry = new CatFormatRegistry()
    await expect(registry.detectBest(new Uint8Array([1]), 'a.ftsv')).rejects.toBeInstanceOf(
      FormatUnsupportedError,
    )
  })
})
