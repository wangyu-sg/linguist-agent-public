/**
 * PreviewTabContent 的 Linguist 分支回归（bun:test + renderToStaticMarkup）。
 *
 * 验收面：previewFileMapAtom 携带 linguist 目标时，原生 Preview Tab 挂载
 * LinguistPreviewBody（批次概览 / Context 文档），不进入 DiffTabContent
 * 的文件读取链；普通文件仍走 DiffTabContent。
 */

import { describe, expect, test } from 'bun:test'
import { createStore, Provider } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import { previewFileMapAtom, type PreviewFile } from '@/atoms/preview-atoms'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PreviewTabContent } from './PreviewTabContent'

const BATCH_FILE: PreviewFile = {
  filePath: 'messages.xliff',
  previewOnly: true,
  readOnly: true,
  linguist: {
    kind: 'batch',
    projectId: 'project-a',
    assetId: 'ast-0000000000000001',
    filename: 'messages.xliff',
    formatId: 'xliff',
    segmentCount: 3,
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
  },
}

function renderWithFile(file: PreviewFile): string {
  const store = createStore()
  store.set(previewFileMapAtom, new Map([['session-a', file]]))
  return renderToStaticMarkup(
    <Provider store={store}>
      <TooltipProvider>
        <PreviewTabContent sessionId="session-a" />
      </TooltipProvider>
    </Provider>,
  )
}

describe('PreviewTabContent Linguist 分支', () => {
  test('given previewFile 携带 linguist 批次目标 when 渲染 preview tab then 挂载批次概览而非文件读取链', () => {
    const html = renderWithFile(BATCH_FILE)

    expect(html).toContain('aria-label="批次语义预览"')
    expect(html).toContain('查看原始文件')
    expect(html).toContain('messages.xliff')
    // 原生 tear-off（Tab ↔ 分屏）入口保留；DiffTabContent 未挂载
    expect(html).toContain('切换为侧边分屏')
    expect(html).not.toContain('预览已关闭')
  })

  test('given previewFile 携带 linguist contextDoc 目标 when 渲染 then 挂载 Context 文档预览', () => {
    const html = renderWithFile({
      filePath: '风格指南.docx',
      previewOnly: true,
      readOnly: true,
      linguist: {
        kind: 'contextDoc',
        projectId: 'project-a',
        docId: 'ctx-0123456789abcdef',
        filename: '风格指南.docx',
      },
    })

    expect(html).toContain('aria-label="Context 文档预览"')
    expect(html).not.toContain('预览已关闭')
  })

  test('given previewFile 携带 TM 文件导入来源 when 渲染 then 复用原生 Preview Tab 挂载原件预览', () => {
    const html = renderWithFile({
      filePath: 'memory.csv',
      previewOnly: true,
      readOnly: true,
      linguist: {
        kind: 'referenceImport',
        projectId: 'project-a',
        importId: 'rfi_v2_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        filename: 'memory.csv',
        referenceKind: 'tm',
      },
    })

    expect(html).toContain('aria-label="翻译记忆原件预览"')
    expect(html).toContain('切换为侧边分屏')
    expect(html).not.toContain('预览已关闭')
  })

  test('given previewFile 携带未确认 TM 候选 when 渲染 then 复用同一 Preview Tab 且不落入文件路径预览', () => {
    const html = renderWithFile({
      filePath: 'pending-memory.csv',
      previewOnly: true,
      readOnly: true,
      linguist: {
        kind: 'referenceCandidate',
        projectId: 'project-a',
        candidateId: '01234567-89ab-4def-8123-456789abcdef',
        sourceSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        filename: 'pending-memory.csv',
        referenceKind: 'tm',
      },
    })

    expect(html).toContain('aria-label="翻译记忆候选原件预览"')
    expect(html).toContain('切换为侧边分屏')
    expect(html).not.toContain('预览已关闭')
  })

  test('given 普通文件 previewFile when 渲染 then 仍走 DiffTabContent 文件预览', () => {
    const html = renderWithFile({
      filePath: 'src/main.ts',
      previewOnly: true,
      readOnly: true,
    })

    expect(html).not.toContain('批次语义预览')
    expect(html).not.toContain('Context 文档预览')
    expect(html).not.toContain('预览已关闭')
  })
})
