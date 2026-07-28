import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { sha256Hex } from './hash'

const ref = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

describe('sha256Hex（纯 TS SHA-256）', () => {
  test('标准测试向量', () => {
    expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    // 跨块消息（56 字节边界：恰好触发额外 padding 块）
    const msg56 = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'
    expect(sha256Hex(new TextEncoder().encode(msg56))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  test('与 node:crypto 一致：CJK/Unicode、长输入、二进制字节', () => {
    const samples = [
      '你好，世界。Linguist Agent 格式适配器。',
      'x'.repeat(10000),
      'a'.repeat(55),
      'a'.repeat(56),
      'a'.repeat(64),
      'a'.repeat(119),
      'a'.repeat(120),
    ]
    for (const sample of samples) {
      expect(sha256Hex(new TextEncoder().encode(sample))).toBe(ref(sample))
    }
    // 全字节值扫描（非文本输入）
    const allBytes = new Uint8Array(256).map((_, i) => i)
    expect(sha256Hex(allBytes)).toBe(createHash('sha256').update(allBytes).digest('hex'))
  })
})
