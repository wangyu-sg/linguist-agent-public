import { constants, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { writeTextFileAtomic } from '../safe-file'

/** 只迁移当前恢复的旧摘要结果；SDK 解析树结构，保留所有 entry/parent ID。 */
export async function normalizeLegacyCatSessionFile(sessionFile: string): Promise<void> {
  const { parseSessionEntries } = await import('@earendil-works/pi-coding-agent')
  const source = readFileSync(sessionFile, 'utf8')
  const entries = parseSessionEntries(source)
  if (entries.length !== source.split('\n').filter(line => line.trim() !== '').length) {
    throw new Error('旧会话包含无法解析的记录，未执行 CAT 格式迁移')
  }
  let changed = false
  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') continue
    const message = entry.message
    if (!message.toolName.startsWith('cat_') || typeof message.details !== 'object' || message.details === null) continue
    const summary = message.content.findIndex(block => block.type === 'text'
      && /^CAT tool result(?:: .*?)?\. Structured data is available in details\.$/u.test(block.text))
    if (summary < 0) continue
    message.content[summary] = { type: 'text', text: JSON.stringify(message.details) }
    changed = true
  }
  if (!changed) return
  // 必须有完整备份才提交迁移；失败可重试，不能覆盖第一次迁移前的原件。
  const backup = `${sessionFile}.before-cat-content-v1`
  if (!existsSync(backup)) copyFileSync(sessionFile, backup, constants.COPYFILE_EXCL)
  writeTextFileAtomic(sessionFile, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`)
}
