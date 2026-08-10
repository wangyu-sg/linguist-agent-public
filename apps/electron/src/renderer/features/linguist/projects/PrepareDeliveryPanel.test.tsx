import { describe, expect, test } from 'bun:test'
import type { LinguistAssetInfo } from '@proma/shared'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrepareDeliveryPanel } from './PrepareDeliveryPanel'

const ASSET: LinguistAssetInfo = {
  assetId: 'ast-0123456789abcdef',
  filename: 'dialogue.sdlxliff',
  formatId: 'sdlxliff_1_2',
  segmentCount: 2,
  sourceSha256: 'a'.repeat(64),
  segmentCounts: {
    untranslated: 0,
    draft: 0,
    translated: 2,
    reviewed: 0,
  },
  currentStageCounts: {
    untouched: 0,
    draft: 0,
    confirmed: 2,
  },
  sourceCharacters: 26,
  targetCharacters: 20,
  openQaCount: 0,
}

describe('PrepareDeliveryPanel', () => {
  test('given 已导入批次 when 初次打开 then 明示预检入口与不覆盖原文件承诺', () => {
    const html = renderToStaticMarkup(
      <PrepareDeliveryPanel
        projectId="prj-0123456789abcdef"
        assets={[ASSET]}
        archived={false}
      />,
    )

    expect(html).toContain('dialogue.sdlxliff')
    expect(html).toContain('验证并导出')
    expect(html).toContain('仅运行预检')
    expect(html).toContain('不会被覆盖')
    expect(html).toContain('建议、QA、本轮状态、格式回写与导出完整性')
    expect(html).toContain('预检未通过时仍可明确选择按当前状态导出')
  })

  test('given 预检未通过 when 选择按当前状态导出 then 仅由无障碍对话框确认动作提交 as-is', async () => {
    const source = await Bun.file(new URL('./PrepareDeliveryPanel.tsx', import.meta.url)).text()

    expect(source).toContain('<AlertDialogTrigger asChild>')
    expect(source).toMatch(/<AlertDialogCancel\s+disabled=\{saving\}>\s*取消\s*<\/AlertDialogCancel>/)
    expect(source).toMatch(/<AlertDialogAction[\s\S]*?onClick=\{\(\) => onSave\('as-is'\)\}/)
    expect(source).toContain("onClick={() => onSave('verified')}")
    expect(source).not.toContain('confirmingAsIs')
  })
})
