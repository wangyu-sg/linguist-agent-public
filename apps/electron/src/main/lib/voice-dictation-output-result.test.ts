import { describe, expect, test } from 'bun:test'
import { resolveVoiceDictationPromaOutput } from './voice-dictation-output-result'

describe('resolveVoiceDictationPromaOutput', () => {
  test('given no Proma composer consumes a Linguist workbench dictation, when resolving output, then it copies text and reports clipboard fallback', () => {
    const copied: string[] = []

    const result = resolveVoiceDictationPromaOutput(false, '翻译完成', (text) => copied.push(text))

    expect(copied).toEqual(['翻译完成'])
    expect(result).toEqual({
      mode: 'clipboard',
      success: true,
      message: '未找到可写入的 Proma 输入框，已复制到剪贴板',
    })
  })

  test('given a Proma composer consumes the dictation, when resolving output, then it reports only the confirmed input write', () => {
    const copied: string[] = []

    const result = resolveVoiceDictationPromaOutput(true, '翻译完成', (text) => copied.push(text))

    expect(copied).toEqual([])
    expect(result).toEqual({
      mode: 'proma-input',
      success: true,
      message: '已写入 Proma 输入框',
    })
  })
})
