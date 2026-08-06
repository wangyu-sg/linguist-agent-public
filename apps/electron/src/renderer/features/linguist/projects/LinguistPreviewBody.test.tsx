/**
 * LinguistPreviewBody 静态渲染回归（bun:test + renderToStaticMarkup）。
 *
 * 验收面：批次默认落「批次概览」语义预览（格式 / 语言对 / 段数 / 统计快照 +
 * 分页片段容器），原始文件只以显式「查看原始文件」次级动作出现；
 * Context 文档走三态可读预览。两者都不是 modal（无 dialog 形态）、不提供
 * 任何编辑动作。数据装载 effect 在 SSR 下不执行，故初始帧为诚实忙碌态。
 */

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistPreviewTarget } from '@/atoms/preview-atoms'
import {
  LinguistAssetPreviewContent,
  LinguistPreviewBody,
} from './LinguistPreviewBody'

const BATCH_TARGET: LinguistPreviewTarget = {
  kind: 'batch',
  projectId: 'project-a',
  assetId: 'ast-0000000000000001',
  filename: 'messages.sdlxliff',
  formatId: 'sdlxliff',
  segmentCount: 128,
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  segmentCounts: { untranslated: 100, draft: 20, translated: 8, reviewed: 0 },
  currentStageCounts: { untouched: 120, draft: 8, confirmed: 0 },
  openQaCount: 2,
}

const CONTEXT_DOC_TARGET: LinguistPreviewTarget = {
  kind: 'contextDoc',
  projectId: 'project-a',
  docId: 'ctx-0123456789abcdef',
  filename: '风格指南.docx',
}

describe('LinguistPreviewBody 批次语义预览', () => {
  test('given 批次目标 when 渲染 then 默认是批次概览而非原始文件墙', () => {
    const html = renderToStaticMarkup(<LinguistPreviewBody target={BATCH_TARGET} />)

    // 概览元数据：文件名 / 格式 / 段数 / 语言对 / 只读
    expect(html).toContain('messages.sdlxliff')
    expect(html).toContain('sdlxliff')
    expect(html).toContain('128 段')
    expect(html).toContain('en → zh-CN')
    expect(html).toContain('只读')
    // 打开时统计快照（状态计数 + 开放 QA）
    expect(html).toContain('未翻译 100')
    expect(html).toContain('草稿 20')
    expect(html).toContain('开放 QA 2')
    expect(html).toContain('打开时统计快照')
    // 语义预览容器与分页片段装载态
    expect(html).toContain('aria-label="批次语义预览"')
    expect(html).toContain('role="status"')
    expect(html).toContain('正在生成预览')
    // 原始文件是显式次级层次：入口存在，但 raw 内容不默认渲染
    expect(html).toContain('查看原始文件')
    expect(html).not.toContain('aria-label="原始文件预览"')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<pre')
    // 不是 modal、无编辑动作
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('保存')
  })

  test('given 统计快照缺省 when 渲染 then 快照行省略但概览结构不变', () => {
    const minimal: LinguistPreviewTarget = {
      kind: 'batch',
      projectId: 'project-a',
      assetId: 'ast-0000000000000002',
      filename: 'menu.json',
      formatId: 'json',
      segmentCount: 8,
    }
    const html = renderToStaticMarkup(<LinguistPreviewBody target={minimal} />)

    expect(html).toContain('menu.json')
    expect(html).not.toContain('打开时统计快照')
    expect(html).toContain('aria-label="批次语义预览"')
    expect(html).toContain('查看原始文件')
  })
})

describe('LinguistPreviewBody Context 文档预览', () => {
  test('given Context 文档目标 when 渲染 then 三态可读预览装载态且无编辑动作', () => {
    const html = renderToStaticMarkup(<LinguistPreviewBody target={CONTEXT_DOC_TARGET} />)

    expect(html).toContain('风格指南.docx')
    expect(html).toContain('Context 文档 · 只读')
    expect(html).toContain('aria-label="Context 文档预览"')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('保存')
  })
})

describe('LinguistAssetPreviewContent Markdown 预览', () => {
  test('given Markdown Context 文档的 text 结果 when 渲染 then 显示富文本而非源码 pre', () => {
    const html = renderToStaticMarkup(
      <LinguistAssetPreviewContent
        result={{
          kind: 'text',
          filename: '世界观.md',
          text: '# 世界观\n\n王国与森林。',
          truncated: false,
        }}
      />,
    )

    expect(html).toContain('aria-label="Markdown 预览"')
    expect(html).toContain('<h1>世界观</h1>')
    expect(html).not.toContain('<pre')
  })

  test('given 普通文本结果 when 渲染 then 仍保留等宽原文预览', () => {
    const html = renderToStaticMarkup(
      <LinguistAssetPreviewContent
        result={{
          kind: 'text',
          filename: '术语.txt',
          text: '王国\tKingdom',
          truncated: false,
        }}
      />,
    )

    expect(html).toContain('<pre')
    expect(html).not.toContain('aria-label="Markdown 预览"')
  })
})

describe('LinguistPreviewBody 语言资产原件预览', () => {
  test('given TM 文件导入来源 when 渲染 then 走只读原件预览而不伪造成批次或 Context 文档', () => {
    const target = {
      kind: 'referenceImport',
      projectId: 'project-a',
      importId: 'rfi_v2_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      filename: 'memory.csv',
      referenceKind: 'tm',
    } satisfies LinguistPreviewTarget

    const html = renderToStaticMarkup(<LinguistPreviewBody target={target} />)

    expect(html).toContain('memory.csv')
    expect(html).toContain('翻译记忆原件 · 只读')
    expect(html).toContain('aria-label="翻译记忆原件预览"')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('批次语义预览')
    expect(html).not.toContain('Context 文档预览')
  })

  test('given 未确认 TM 候选 when 渲染 then 仍复用只读 Preview Tab 且清楚标注未确认', () => {
    const target = {
      kind: 'referenceCandidate',
      projectId: 'project-a',
      candidateId: '01234567-89ab-4def-8123-456789abcdef',
      sourceSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      filename: 'pending-memory.csv',
      referenceKind: 'tm',
    } satisfies LinguistPreviewTarget

    const html = renderToStaticMarkup(<LinguistPreviewBody target={target} />)

    expect(html).toContain('pending-memory.csv')
    expect(html).toContain('翻译记忆候选原件 · 未确认 · 只读')
    expect(html).toContain('aria-label="翻译记忆候选原件预览"')
    expect(html).not.toContain('批次语义预览')
  })
})
