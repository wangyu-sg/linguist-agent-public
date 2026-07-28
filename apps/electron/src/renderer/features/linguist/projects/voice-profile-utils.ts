/**
 * VoiceProfilePanel 纯函数助手（ticket PB-095）
 *
 * 语气标记/禁忌的「逗号分隔文本 ↔ 字符串数组」转换与 speaker 预校验，
 * 不含任何 React / IPC 依赖，bun test 直接驱动。
 */

/** 逗号/顿号分隔文本 → 去空白去重的字符串数组（编辑框往返用）。 */
export function parseMarkerList(text: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const part of text.split(/[,，、]/)) {
    const trimmed = part.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

/** 字符串数组 → 逗号分隔展示文本；缺省 → 空串（编辑框初值）。 */
export function formatMarkerList(markers: readonly string[] | undefined): string {
  return markers === undefined ? '' : markers.join('，')
}

/** speaker 预校验（镜像 IPC readVoiceProfileInput：非空白 + ≤1000）。 */
export function validateSpeakerInput(speaker: string): string | null {
  const trimmed = speaker.trim()
  if (trimmed.length === 0) return '角色名不能为空'
  if (trimmed.length > 1_000) return '角色名最长 1000 个字符'
  return null
}
