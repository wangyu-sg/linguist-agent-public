import { describe, expect, test } from 'bun:test'
import { sha256Hex } from './index'

describe('sha256Hex（纯 TS SHA-256）', () => {
  test('通过标准测试向量', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
