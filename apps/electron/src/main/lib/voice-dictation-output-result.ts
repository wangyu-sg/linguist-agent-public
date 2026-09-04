import type { VoiceDictationCommitResult } from '../../types'

/**
 * 仅在 Renderer 明确确认没有输入框消费文本时才走剪贴板回退。
 * webContents.send 只是投递，不代表文本已进入任何编辑器。
 */
export function resolveVoiceDictationPromaOutput(
  handled: boolean,
  text: string,
  copyToClipboard: (text: string) => void,
): VoiceDictationCommitResult {
  if (handled) {
    return { mode: 'proma-input', success: true, message: '已写入 Linguist Agent 输入框' }
  }

  try {
    copyToClipboard(text)
    return {
      mode: 'clipboard',
      success: true,
      message: '未找到可写入的 Linguist Agent 输入框，已复制到剪贴板',
    }
  } catch (error) {
    console.error('[语音输入] 复制回退失败:', error)
    return {
      mode: 'clipboard',
      success: false,
      message: '未找到可写入的 Linguist Agent 输入框，且复制到剪贴板失败',
    }
  }
}
