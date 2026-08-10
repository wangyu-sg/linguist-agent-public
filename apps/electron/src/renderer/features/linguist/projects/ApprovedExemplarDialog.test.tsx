import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistSegmentInfo } from '@proma/shared'
import { ApprovedExemplarForm } from './ApprovedExemplarDialog'

describe('ApprovedExemplarDialog', () => {
  test('given 已确认台词 when 收集角色译例 then speaker/textType/note 字段可见且不允许空角色提交', () => {
    const segment: LinguistSegmentInfo = {
      id: 'seg-0000000000000001',
      assetId: 'ast-0000000000000001',
      ordinal: 0,
      source: 'Stay close.',
      target: '跟紧我。',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
      status: 'translated',
      currentStageState: 'confirmed',
      locked: false,
      revision: 1,
      sourceHash: 'hash',
      context: { meta: { speaker: 'Ava', textType: 'dialogue' } },
    }
    const html = renderToStaticMarkup(
      <ApprovedExemplarForm
        segment={segment}
        speaker="Ava"
        textType="dialogue"
        note=""
        saving={false}
        onSpeakerChange={() => {}}
        onTextTypeChange={() => {}}
        onNoteChange={() => {}}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    )

    expect(html).toContain('Stay close.')
    expect(html).toContain('跟紧我。')
    expect(html).toContain('角色 / speaker')
    expect(html).toContain('文本类型 / textType')
    expect(html).toContain('备注 / note')
    expect(html).toContain('value="Ava"')
    expect(html).toContain('value="dialogue"')
  })
})
