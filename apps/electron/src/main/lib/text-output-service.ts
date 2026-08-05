/**
 * 文本输出服务
 *
 * 语音输入完成后优先写入 Proma 输入框，否则尝试写入当前光标位置。
 */

import { BrowserWindow, clipboard } from 'electron'
import { VOICE_DICTATION_IPC_CHANNELS } from '../../types'
import type {
  VoiceDictationCommitInput,
  VoiceDictationCommitResult,
  VoiceDictationPromaInputResolution,
  VoiceDictationSettings,
  VoiceDictationTextEvent,
} from '../../types'
import { getMainWindow } from '../index'
import { pasteTextAtCurrentCursor } from './text-insertion-service'
import { resolveVoiceDictationPromaOutput } from './voice-dictation-output-result'

let targetWasPromaInput = false
let activePreviewSessionId: string | null = null
let closedPreviewSessionId: string | null = null
const PROMA_INPUT_RESOLUTION_TIMEOUT_MS = 1_000

interface PendingPromaInputCommit {
  webContentsId: number
  text: string
  resolve: (result: VoiceDictationCommitResult) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingPromaInputCommits = new Map<string, PendingPromaInputCommit>()

/** 在显示语音浮窗前记录目标是否为 Proma 主窗口。 */
export function captureVoiceDictationTarget(forcePromaInput?: boolean): boolean {
  const mainWindow = getMainWindow()
  targetWasPromaInput = forcePromaInput ?? BrowserWindow.getFocusedWindow() === mainWindow
  return targetWasPromaInput
}

function shouldWriteToPromaInput(settings: VoiceDictationSettings): boolean {
  return settings.outputMode === 'proma-input' ||
    (settings.outputMode === 'auto' && targetWasPromaInput)
}

function sendTextEvent(channel: string, event: VoiceDictationTextEvent): boolean {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return false
  mainWindow.webContents.send(channel, event)
  return true
}

function settlePromaInputCommit(
  sessionId: string,
  handled: boolean,
  senderWebContentsId?: number,
): VoiceDictationCommitResult | null {
  const pending = pendingPromaInputCommits.get(sessionId)
  if (!pending || (senderWebContentsId !== undefined && pending.webContentsId !== senderWebContentsId)) {
    return null
  }

  pendingPromaInputCommits.delete(sessionId)
  clearTimeout(pending.timer)
  if (activePreviewSessionId === sessionId) activePreviewSessionId = null
  closedPreviewSessionId = sessionId
  const result = resolveVoiceDictationPromaOutput(handled, pending.text, (text) => clipboard.writeText(text))
  pending.resolve(result)
  return result
}

function requestPromaInputCommit(input: VoiceDictationTextEvent): Promise<VoiceDictationCommitResult> | null {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return null

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      settlePromaInputCommit(input.sessionId, false)
    }, PROMA_INPUT_RESOLUTION_TIMEOUT_MS)
    pendingPromaInputCommits.set(input.sessionId, {
      webContentsId: mainWindow.webContents.id,
      text: input.text,
      resolve,
      timer,
    })

    try {
      mainWindow.webContents.send(VOICE_DICTATION_IPC_CHANNELS.INSERT_TEXT, input)
    } catch (error) {
      console.error('[语音输入] 投递最终文本到 Proma 失败，改用剪贴板:', error)
      settlePromaInputCommit(input.sessionId, false)
    }
  })
}

/** Renderer 必须确认最终文本已被编辑器消费；未消费时主进程统一复制到剪贴板。 */
export function resolveVoiceDictationPromaInput(
  input: VoiceDictationPromaInputResolution,
  senderWebContentsId: number,
): VoiceDictationCommitResult | null {
  return settlePromaInputCommit(input.sessionId, input.handled, senderWebContentsId)
}

/**
 * 将 ASR 的最新完整结果预览到 Proma 输入框。
 * 外部应用只在结束时一次性写入，避免连续粘贴打断用户输入。
 */
export function previewVoiceDictationText(
  input: VoiceDictationTextEvent,
  settings: VoiceDictationSettings,
): void {
  const text = input.text.trim()
  if (!text || !shouldWriteToPromaInput(settings)) return
  if (input.sessionId === closedPreviewSessionId) return
  if (activePreviewSessionId && activePreviewSessionId !== input.sessionId) return
  activePreviewSessionId = input.sessionId
  sendTextEvent(VOICE_DICTATION_IPC_CHANNELS.PREVIEW_TEXT, { ...input, text })
}

/** 取消录音时撤销尚未提交到 Proma 输入框的临时组合文本。 */
export function clearVoiceDictationPreview(sessionId: string): void {
  if (activePreviewSessionId === sessionId) {
    activePreviewSessionId = null
    sendTextEvent(VOICE_DICTATION_IPC_CHANNELS.CLEAR_PREVIEW_TEXT, { sessionId, text: '' })
  }
  closedPreviewSessionId = sessionId
}

export async function commitVoiceDictationText(
  input: VoiceDictationCommitInput,
  settings: VoiceDictationSettings,
): Promise<VoiceDictationCommitResult> {
  const trimmed = input.text.trim()
  if (!trimmed) {
    return { mode: 'clipboard', success: false, message: '没有可输出的语音文本' }
  }

  const hasActivePreview = activePreviewSessionId === input.sessionId
  if (hasActivePreview || shouldWriteToPromaInput(settings)) {
    const result = requestPromaInputCommit({ sessionId: input.sessionId, text: trimmed })
    if (result) return await result
  }

  if (settings.outputMode === 'auto') {
    const result = await pasteTextAtCurrentCursor(trimmed)
    return result.success
      ? { mode: 'cursor', success: true, message: result.message }
      : { mode: 'clipboard', success: true, message: result.message }
  }

  clipboard.writeText(trimmed)
  return { mode: 'clipboard', success: true, message: '已复制到剪贴板' }
}
