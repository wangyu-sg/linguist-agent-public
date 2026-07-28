import { describe, expect, test } from 'bun:test'
import { sha256Hex } from '../index'
import {
  FormatExportError,
  FormatParseError,
  FormatSegmentLostError,
} from '../index'
import {
  assertRoundTrip,
  BadSegmentDropAdapter,
  encodeFakeTsv,
  FakeAdapter,
} from './index'

const SAMPLE = encodeFakeTsv([
  { key: 'title', source: 'Hello {name}' },
  { key: 'body.intro', source: 'Welcome to Linguist Agent' },
  { key: 'body.outro', source: 'Goodbye' },
  { key: 'empty', source: 'Untranslated line' },
])

describe('round-trip harness（FakeAdapter 正路径）', () => {
  test('默认修改子集：计数/ID 顺序/目标写回/SHA-256 记录全部断言通过', async () => {
    const report = await assertRoundTrip(new FakeAdapter(), SAMPLE, { filename: 'sample.ftsv' })
    expect(report.adapterId).toBe('fake_tsv')
    expect(report.segmentCount).toBe(4)
    expect(report.sourceSha256).toBe(sha256Hex(SAMPLE))
    // 默认 modify：偶数下标段被改为 [zh-CN] <source>
    expect(report.modifiedSegmentIds).toHaveLength(2)
    // 导出字节仍可被 FakeAdapter 重新解析（harness 已验证，这里抽查目标已写入）
    const text = new TextDecoder().decode(report.exportedBytes)
    expect(text).toContain('[zh-CN] Hello {name}')
    // 未修改行保持无 TARGET 字段
    expect(text).toContain('body.intro\tWelcome to Linguist Agent\n')
  })

  test('空目标编辑（target → ""）也能完整往返', async () => {
    const bytes = encodeFakeTsv([
      { key: 'a', source: 'one', target: 'uno' },
      { key: 'b', source: 'two', target: 'dos' },
    ])
    const report = await assertRoundTrip(new FakeAdapter(), bytes, {
      filename: 'empty-target.ftsv',
      modify: (segment) => (segment.key === 'a' ? '' : null),
    })
    expect(report.modifiedSegmentIds).toHaveLength(1)
    const text = new TextDecoder().decode(report.exportedBytes)
    expect(text).toBe('a\tone\nb\ttwo\tdos\n')
  })

  test('Unicode / CJK 内容往返无损', async () => {
    const bytes = encodeFakeTsv([
      { key: 'greeting', source: '你好，{名字}！' },
      { key: 'emoji', source: 'Ship it 🚀 — café' },
    ])
    const report = await assertRoundTrip(new FakeAdapter(), bytes, {
      filename: 'cjk.ftsv',
      targetLocale: 'ja',
    })
    const text = new TextDecoder().decode(report.exportedBytes)
    expect(text).toContain('[ja] 你好，{名字}！')
    expect(text).toContain('Ship it 🚀 — café')
  })

  test('adapter 提供的不变量（占位符集合保留）被逐段断言', async () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort()
    const report = await assertRoundTrip(new FakeAdapter(), SAMPLE, {
      filename: 'invariant.ftsv',
      modify: (segment, index) =>
        index === 0 ? `${placeholders(segment.source).join('')} 已翻译` : null,
      invariants: [
        {
          name: 'placeholders-preserved-in-source',
          assert: (before, after) => {
            expect(placeholders(after.source)).toEqual(placeholders(before.source))
          },
        },
      ],
    })
    expect(report.segmentCount).toBe(4)
  })

  test('不变量违例 → FormatExportError（带 invariant 名与段 ID）', async () => {
    await expect(
      assertRoundTrip(new FakeAdapter(), SAMPLE, {
        filename: 'invariant-fail.ftsv',
        invariants: [{ name: 'always-fails', assert: () => { throw new Error('boom') } }],
      }),
    ).rejects.toThrow(/invariant "always-fails" failed: boom/)
  })
})

describe('round-trip harness（负路径）', () => {
  test('静默丢段的坏 adapter → FormatSegmentLostError，报出丢失段 ID', async () => {
    // 初始全部带 target（保证未修改导出字节稳定），随后把 a 的目标改为 ''
    // → 坏 adapter 在第二次导出时静默丢掉 a 所在行。
    const bytes = encodeFakeTsv([
      { key: 'a', source: 'one', target: 'uno' },
      { key: 'b', source: 'two', target: 'dos' },
    ])
    const err = await assertRoundTrip(new BadSegmentDropAdapter(), bytes, {
      filename: 'drop.ftsv',
      modify: (segment) => (segment.key === 'a' ? '' : null),
    }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(FormatSegmentLostError)
    expect((err as FormatSegmentLostError).code).toBe('FORMAT_SEGMENT_LOST')
    // a 被丢弃；b 的 ordinal 从 1 变为 0，派生 ID 随之改变——harness 将两者都报为丢失。
    // （段 ID 由 assetId+ordinal+key 派生；静默丢段必然暴露，无论靠计数还是靠 ID 漂移。）
    expect((err as FormatSegmentLostError).missingSegmentIds).toHaveLength(2)
    expect((err as FormatSegmentLostError).message).toContain('re-imported 1')
  })

  test('非法 UTF-8 字节 → FormatParseError（不崩溃）', async () => {
    const bad = new Uint8Array([0xff, 0xfe, 0xfd])
    await expect(assertRoundTrip(new FakeAdapter(), bad, { filename: 'bad.ftsv' })).rejects.toBeInstanceOf(
      FormatParseError,
    )
  })

  test('结构错误的行（缺 TAB） → FormatParseError，带行号', async () => {
    const bad = new TextEncoder().encode('ok\tsource\nbroken-line\n')
    const err = await assertRoundTrip(new FakeAdapter(), bad, { filename: 'bad2.ftsv' }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(FormatParseError)
    expect((err as FormatParseError).code).toBe('FORMAT_PARSE_ERROR')
    expect((err as FormatParseError).message).toContain('line 2')
  })

  test('未修改导出非字节稳定的 adapter → FormatExportError', async () => {
    class NoisyAdapter extends FakeAdapter {
      override readonly id = 'fake_tsv_noisy'
      override async export(input: Parameters<FakeAdapter['export']>[0]): Promise<Uint8Array> {
        const out = await super.export(input)
        return new TextEncoder().encode(new TextDecoder().decode(out) + ' ') // 追加字节破坏稳定性
      }
    }
    const err = await assertRoundTrip(new NoisyAdapter(), SAMPLE, { filename: 'noisy.ftsv' }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(FormatExportError)
    expect((err as FormatExportError).message).toContain('byte-stable')
  })

  test('adapter 记录错误的 sourceSha256 → FormatParseError（harness 强校验）', async () => {
    class LiarAdapter extends FakeAdapter {
      override readonly id = 'fake_tsv_liar'
      // 注入恒定假 hash
      constructor() {
        super(() => '0'.repeat(64))
      }
    }
    await expect(assertRoundTrip(new LiarAdapter(), SAMPLE, { filename: 'liar.ftsv' })).rejects.toThrow(
      /sourceSha256/,
    )
  })
})
