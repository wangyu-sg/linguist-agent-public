import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistContextDocInfo } from '@proma/shared'
import { LinkedContextImagesView } from './LinkedContextImages'

const LINKED_IMAGE: LinguistContextDocInfo = {
  id: 'doc-img-1',
  kind: 'image',
  originalFilename: 'potion-ui.png',
  createdAt: '2026-08-12T00:00:00.000Z',
  hasTextExtract: false,
  textExtractLength: 0,
  previewUrl: 'proma-file://token-abc',
}

const LINKED_DOC: LinguistContextDocInfo = {
  id: 'doc-text-1',
  kind: 'doc',
  originalFilename: 'combat-notes.md',
  createdAt: '2026-08-12T00:00:00.000Z',
  hasTextExtract: true,
  textExtractLength: 120,
}

const noop = (): void => undefined

describe('LinkedContextImagesView', () => {
  test('given 已关联图片与文档 when 渲染 then 显示缩略图、文件名、解除入口与候选选择器', () => {
    const html = renderToStaticMarkup(
      <LinkedContextImagesView
        docs={[LINKED_IMAGE, LINKED_DOC]}
        archived={false}
        pickerOpen
        candidates={[{
          ...LINKED_IMAGE,
          id: 'doc-img-2',
          originalFilename: 'shop-ui.png',
        }]}
        onPreview={noop}
        onUnlink={noop}
        onTogglePicker={noop}
        onLink={noop}
      />,
    )

    // 已关联项：图片给缩略图，文档只给文件名
    expect(html).toContain('关联图片 / 文档')
    expect(html).toContain('src="proma-file://token-abc"')
    expect(html).toContain('potion-ui.png')
    expect(html).toContain('combat-notes.md')
    expect(html).toContain('aria-label="解除关联 potion-ui.png"')
    // 选择器候选与关联入口
    expect(html).toContain('shop-ui.png')
    expect(html).toContain('aria-label="关联 shop-ui.png"')
  })

  test('given 归档项目且无关联 when 渲染 then 空态且关联入口禁用', () => {
    const html = renderToStaticMarkup(
      <LinkedContextImagesView
        docs={[]}
        archived
        pickerOpen={false}
        candidates={[]}
        onPreview={noop}
        onUnlink={noop}
        onTogglePicker={noop}
        onLink={noop}
      />,
    )

    expect(html).toContain('当前片段还没有关联图片')
    expect(html).toContain('disabled=""')
  })
})
