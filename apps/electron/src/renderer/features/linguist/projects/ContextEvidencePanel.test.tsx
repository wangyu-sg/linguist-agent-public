import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistCatContextResult } from '@proma/shared'
import {
  ContextEvidenceView,
  evidenceProvenance,
  type ContextEvidenceSources,
} from './ContextEvidencePanel'

const TM_EVIDENCE_REF = `tm:tmu_v2_${'a'.repeat(64)}`

const CONTEXT: LinguistCatContextResult = {
  segment: {
    id: 'seg-0000000000000001',
    assetId: 'ast-0000000000000001',
    ordinal: 0,
    source: 'Drink the potion',
    target: '喝下药水',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    status: 'draft',
    locked: false,
    revision: 1,
    sourceHash: 'source-hash',
    context: {
      origin: 'dialogue/tutorial.json',
      note: 'Tutorial prompt',
    },
  },
  pendingProposal: {
    id: 'pro-0000000000000001',
    segmentId: 'seg-0000000000000001',
    baseRevision: 1,
    proposedTarget: '饮用药水',
    evidenceRefs: [TM_EVIDENCE_REF, 'context:combat-notes', 'manual-review'],
    termRefs: ['term:potion'],
    warnings: [],
    createdAt: '2026-07-27T00:00:00.000Z',
    status: 'pending',
  },
  qaFindings: [],
  tmMatches: [{
    id: 'tm-1',
    source: 'Drink potion',
    target: '喝下药水',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    origin: 'game-v1.tmx',
    score: 0.96,
    matchType: 'fuzzy',
  }],
  termMatches: [],
  approvedExemplars: [{
    id: 'exemplar-1',
    source: 'Drink the potion',
    target: '喝下药水',
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    speaker: 'Narrator',
    textType: 'dialogue',
    assetId: 'ast-0000000000000001',
    segmentId: 'seg-0000000000000001',
    note: '简洁的教程口吻',
    approvedAt: '2026-07-27T00:00:00.000Z',
  }],
}

const SOURCES: ContextEvidenceSources = {
  styleRules: {
    total: 1,
    items: [{
      id: 'style-1',
      groupKey: 'UI',
      ruleText: '按钮文本使用祈使句',
      updatedAt: '2026-07-27T00:00:00.000Z',
    }],
  },
  voiceProfiles: {
    total: 1,
    items: [{
      id: 'voice-1',
      speaker: 'Narrator',
      register: 'neutral',
      toneMarkers: ['concise'],
      updatedAt: '2026-07-27T00:00:00.000Z',
    }],
  },
  contextDocs: {
    total: 1,
    items: [{
      id: 'doc-1',
      kind: 'doc',
      originalFilename: 'combat-notes.md',
      note: 'Combat terminology',
      createdAt: '2026-07-27T00:00:00.000Z',
      hasTextExtract: true,
      textExtractLength: 120,
    }],
  },
}

describe('ContextEvidencePanel', () => {
  test('given 活动片段 when 显示上下文 then 汇总四类来源并展示可追溯的 Agent 证据', () => {
    const html = renderToStaticMarkup(
      <ContextEvidenceView
        projectId="project-a"
        context={CONTEXT}
        sources={SOURCES}
        onOpenTerms={() => undefined}
      />,
    )

    expect(html).toContain('Style')
    expect(html).toContain('按钮文本使用祈使句')
    expect(html).toContain('Voice')
    expect(html).toContain('Narrator')
    expect(html).toContain('喝下药水')
    expect(html).toContain('简洁的教程口吻')
    expect(html).toContain('Context')
    expect(html).toContain('combat-notes.md')
    expect(html).toContain('TM')
    expect(html).toContain('game-v1.tmx')
    expect(html).toContain('aria-label="建议的证据来源"')
    expect(html).toContain(TM_EVIDENCE_REF)
    expect(html).toContain('context:combat-notes')
    expect(html).toContain('manual-review')
    expect(html).toContain('href="#linguist-context-source-project-a-tm"')
    expect(html).toContain('data-open-dock-tab="terms"')
    expect(html).not.toContain('导入文档')
    expect(html).not.toContain('删除')
  })

  test('given evidence ref when 解析来源 then 只为可识别来源提供跳转目标', () => {
    expect(evidenceProvenance(TM_EVIDENCE_REF)).toEqual({ kind: 'tm', label: 'TM' })
    expect(evidenceProvenance('style:ui-copy')).toEqual({ kind: 'style', label: 'Style' })
    expect(evidenceProvenance('voice:narrator')).toEqual({ kind: 'voice', label: 'Voice' })
    expect(evidenceProvenance('context:combat-notes')).toEqual({ kind: 'context', label: 'Context' })
    expect(evidenceProvenance('term:potion')).toEqual({ kind: 'term', label: '术语' })
    expect(evidenceProvenance('manual-review')).toEqual({ kind: 'other', label: '其他' })
  })
})
