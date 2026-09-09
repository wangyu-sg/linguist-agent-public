/** 受管对象复用当前 CAT 宿主会话的原生右侧预览。 */
import * as React from 'react'
import type { LinguistPreviewTarget, PreviewFile } from '@/atoms/preview-atoms'
import { useOpenPreview } from '@/components/diff/preview-opener'

export const LinguistPreviewSessionContext = React.createContext<string | undefined>(undefined)

type OpenPreviewFn = (sessionId: string, file: PreviewFile) => void

export function openLinguistPreview(
  sessionId: string | undefined,
  openPreview: OpenPreviewFn,
  target: LinguistPreviewTarget,
): boolean {
  if (sessionId === undefined) return false
  openPreview(sessionId, {
    filePath: target.filename,
    previewOnly: true,
    readOnly: true,
    linguist: target,
  })
  return true
}

export function useOpenLinguistPreview(): (target: LinguistPreviewTarget) => boolean {
  const sessionId = React.useContext(LinguistPreviewSessionContext)
  const openPreview = useOpenPreview()
  return React.useCallback(
    (target: LinguistPreviewTarget): boolean => openLinguistPreview(sessionId, openPreview, target),
    [sessionId, openPreview],
  )
}
