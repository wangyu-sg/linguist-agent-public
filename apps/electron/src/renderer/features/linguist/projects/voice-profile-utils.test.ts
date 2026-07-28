/**
 * voice-profile-utils 纯函数测试（ticket PB-095）
 *
 * bun 安全：不触 React / DOM / IPC，只驱动纯函数。
 * 覆盖：标记列表解析/格式化、speaker 预校验。
 */

import { describe, expect, test } from 'bun:test'
import { formatMarkerList, parseMarkerList, validateSpeakerInput } from './voice-profile-utils'

describe('parseMarkerList', () => {
  test('中英逗号与顿号都可分隔；去空白去重', () => {
    expect(parseMarkerList('句尾上扬， 自嘲、敬语, 句尾上扬')).toEqual(['句尾上扬', '自嘲', '敬语'])
    expect(parseMarkerList('')).toEqual([])
    expect(parseMarkerList(' ，、 ')).toEqual([])
  })
})

describe('formatMarkerList', () => {
  test('数组 → 顿号分隔文本；缺省 → 空串', () => {
    expect(formatMarkerList(['a', 'b'])).toBe('a，b')
    expect(formatMarkerList([])).toBe('')
    expect(formatMarkerList(undefined)).toBe('')
  })

  test('与 parseMarkerList 往返一致', () => {
    const markers = ['句尾上扬', '自嘲']
    expect(parseMarkerList(formatMarkerList(markers))).toEqual(markers)
  })
})

describe('validateSpeakerInput（镜像 IPC）', () => {
  test('空串 / 纯空白被拒绝；正常角色名通过', () => {
    expect(validateSpeakerInput('')).not.toBeNull()
    expect(validateSpeakerInput('   ')).not.toBeNull()
    expect(validateSpeakerInput('莉安')).toBeNull()
  })
})
