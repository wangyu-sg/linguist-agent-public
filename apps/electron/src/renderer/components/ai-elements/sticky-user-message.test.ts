import { describe, expect, test } from 'bun:test'
import { getStickyUserMessagePreview, STICKY_USER_MESSAGE_SEPARATOR_CLASS } from './sticky-user-message'

describe('StickyUserMessage', () => {
  test('given rail 中的多行提问 when 生成紧凑摘要 then 折叠空白并隐藏代码块正文', () => {
    expect(getStickyUserMessagePreview({
      id: 'message-a',
      text: '请检查术语\n\n```ts\nconst leaked = true\n```\n并给出建议',
      attachments: [],
    })).toBe('请检查术语 [code] 并给出建议')
  })

  test('given 只有附件的提问 when 生成紧凑摘要 then 明示附件数量与文件名', () => {
    expect(getStickyUserMessagePreview({
      id: 'message-b',
      text: '',
      attachments: [
        { filename: 'screen.png' },
        { filename: 'brief.docx' },
      ],
    })).toBe('2 个附件 · screen.png')
  })

  test('given 悬浮条容器边界 when 读取分隔 class then 上/下边界同为 0.45 强度结构分隔', () => {
    // 与 Workbench 结构分隔（hsl(var(--border)/0.45)）同一标准；防止回退成只有下边界而显得悬空
    expect(STICKY_USER_MESSAGE_SEPARATOR_CLASS).toContain('border-y')
    expect(STICKY_USER_MESSAGE_SEPARATOR_CLASS).toContain('border-border/45')
    expect(STICKY_USER_MESSAGE_SEPARATOR_CLASS).not.toContain('border-b border-border')
  })
})
