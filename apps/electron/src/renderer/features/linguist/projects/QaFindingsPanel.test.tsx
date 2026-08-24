import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistQaFindingInfo } from '@proma/shared'
import {
  buildQaFindingJumpPatch,
  linguistWorkbenchUiStateAtomFamily,
} from './cat-workspace-atoms'
import {
  buildQaFindingsRequest,
  buildQaRunRequest,
  QaFindingCard,
  QaFindingsPanel,
  QaPanelScopeNotice,
  qaFindingsScopeKey,
  qaResolveDisabledReason,
  qaStateMatchesScope,
  qaWaiveDisabledReason,
  qaWaiverReasonError,
  resolveQaPanelSegmentScope,
} from './QaFindingsPanel'
import { qaJumpDisabledReason } from './qa-findings-utils'

const finding: LinguistQaFindingInfo = {
  id: 'qaf-0000000000000001',
  segmentId: 'seg-0000000000000001',
  code: 'missing-placeholder',
  severity: 'L1',
  issueType: 'placeholders_variables',
  disposition: 'defect',
  message: '译文缺少 {name}',
  status: 'open',
  segmentRevision: 2,
  currentRevision: 2,
}

const noop = (): void => undefined

describe('LF-053 scoped QA Findings Panel', () => {
  test('given segment scope、filters 与分页 when 构建 list request then 只沿既有 DTO 传递 segmentId 且不建立 Finding 缓存', () => {
    expect(buildQaFindingsRequest({
      projectId: 'project-a',
      segmentId: finding.segmentId,
      status: 'open',
      severity: 'L1',
      disposition: 'defect',
      offset: 100,
    })).toEqual({
      projectId: 'project-a',
      segmentId: finding.segmentId,
      status: 'open',
      severity: 'L1',
      disposition: 'defect',
      limit: 100,
      offset: 100,
    })
    expect(buildQaFindingsRequest({
      projectId: 'project-a',
      status: 'resolved',
      severity: '',
      disposition: '',
      offset: 0,
    })).toEqual({
      projectId: 'project-a',
      status: 'resolved',
      limit: 100,
      offset: 0,
    })
  })

  test('given segment scope when 运行 QA then 请求仍只有 projectId 且 UI 明示扫描整个项目', () => {
    expect(buildQaRunRequest('project-a')).toEqual({ projectId: 'project-a' })
    const html = renderToStaticMarkup(
      <QaPanelScopeNotice
        scopeId="qa-test"
        segmentId={finding.segmentId}
        archived={false}
      />,
    )

    expect(html).toContain('仅显示当前片段')
    expect(html).toContain('运行 QA 仍会扫描整个项目')
  })

  test('given scope 从 segment A 切到 B when 旧请求晚到 then 旧 scope 不能重新显示或操作', () => {
    const oldScope = qaFindingsScopeKey('project-a', 'segment-a')
    const nextScope = qaFindingsScopeKey('project-a', 'segment-b')

    expect(qaStateMatchesScope(oldScope, nextScope)).toBeFalse()
    expect(qaStateMatchesScope(nextScope, nextScope)).toBeTrue()
  })

  test('given 项目已归档 when 渲染 Finding then 仍可读取但定位/resolve/waive 均有可访问禁用原因', () => {
    const notice = renderToStaticMarkup(
      <QaPanelScopeNotice scopeId="qa-test" segmentId={finding.segmentId} archived />,
    )
    const card = renderToStaticMarkup(
      <QaFindingCard
        idPrefix="qa-test"
        finding={{ ...finding, currentRevision: 3 }}
        archived
        waiving={false}
        waiverScope="single"
        waiverReason=""
        onJump={noop}
        onResolve={noop}
        onOpenWaiver={noop}
        onWaive={noop}
        onCancelWaiver={noop}
        onWaiverReasonChange={noop}
      />,
    )

    expect(notice).toContain('仍可读取')
    expect(notice).toContain('运行、定位、解决和豁免已禁用')
    expect(card).toContain('跳到片段')
    expect(card).toContain('项目已归档，不能定位到片段')
    expect(card).toContain('项目已归档，不能标记解决')
    expect(card).toContain('项目已归档，不能豁免 Finding')
    expect(card.match(/disabled=""/g)).toHaveLength(4)
    expect(card).toContain('aria-describedby="qa-test-jump-reason-qaf-0000000000000001"')
    expect(card).toContain('aria-describedby="qa-test-resolve-reason-qaf-0000000000000001"')
    expect(card).toContain('aria-describedby="qa-test-waive-reason-qaf-0000000000000001"')
  })

  test('given Finding 对应译文尚未修订 when resolve then fail-closed；修订后才可操作', () => {
    expect(qaResolveDisabledReason(finding, false)).toBe(
      '请先修改该片段的译文，再标记已解决',
    )
    expect(qaResolveDisabledReason({ ...finding, currentRevision: 3 }, false)).toBeUndefined()

    const card = renderToStaticMarkup(
      <QaFindingCard
        idPrefix="qa-test"
        finding={finding}
        archived={false}
        waiving={false}
        waiverScope="single"
        waiverReason=""
        onJump={noop}
        onResolve={noop}
        onOpenWaiver={noop}
        onWaive={noop}
        onCancelWaiver={noop}
        onWaiverReasonChange={noop}
      />,
    )
    expect(card).toContain('title="请先修改该片段的译文，再标记已解决"')
    expect(card).toContain('aria-describedby="qa-test-resolve-reason-qaf-0000000000000001"')
  })

  test('given waive 原因 when 校验 then 必须非空且不超过 500 字符，并在表单内反馈', () => {
    expect(qaWaiverReasonError('')).toBe('豁免原因不能为空')
    expect(qaWaiverReasonError('   ')).toBe('豁免原因不能为空')
    expect(qaWaiverReasonError('a'.repeat(501))).toBe('豁免原因不能超过 500 个字符')
    expect(qaWaiverReasonError('a'.repeat(500))).toBeUndefined()

    const invalid = renderToStaticMarkup(
      <QaFindingCard
        idPrefix="qa-test"
        finding={{ ...finding, currentRevision: 3 }}
        archived={false}
        waiving
        waiverScope="single"
        waiverReason=""
        onJump={noop}
        onResolve={noop}
        onOpenWaiver={noop}
        onWaive={noop}
        onCancelWaiver={noop}
        onWaiverReasonChange={noop}
      />,
    )
    expect(invalid).toContain('maxLength="500"')
    expect(invalid).toContain('aria-invalid="true"')
    expect(invalid).toContain('role="alert"')
    expect(invalid).toContain('豁免原因不能为空')
    expect(invalid).toContain('0/500')
    expect(invalid).toMatch(/确认豁免<\/button>/)
    expect(invalid).toMatch(/disabled=""[^>]*aria-describedby="qa-test-waiver-help-qaf-0000000000000001"/)

    const bulk = renderToStaticMarkup(
      <QaFindingCard
        idPrefix="qa-test"
        finding={{ ...finding, currentRevision: 3 }}
        archived={false}
        waiving
        waiverScope="rule"
        waiverReason="字幕强调标点"
        onJump={noop}
        onResolve={noop}
        onOpenWaiver={noop}
        onWaive={noop}
        onCancelWaiver={noop}
        onWaiverReasonChange={noop}
      />,
    )
    expect(bulk).toContain('确认按规则豁免')
    expect(bulk).toContain(`填写批量豁免 ${finding.code} 的原因`)
  })

  test('given 已处置 Finding when 尝试 waive then helper 与动作路径保持 fail-closed', () => {
    expect(qaWaiveDisabledReason({ ...finding, status: 'resolved' }, false)).toBe(
      '该 Finding 已完成处置',
    )
    expect(qaWaiveDisabledReason(finding, false)).toBeUndefined()
  })

  test('given U-02 默认范围 when 构建面板请求 then 默认项目级，显式开关才过滤当前片段', () => {
    // 默认（开关未打开）：即使有当前片段也不带 segmentId —— 项目级请求
    const defaultScope = resolveQaPanelSegmentScope(finding.segmentId, false)
    expect(defaultScope).toBeUndefined()
    expect(buildQaFindingsRequest({
      projectId: 'project-a',
      segmentId: defaultScope,
      status: 'open',
      severity: '',
      disposition: '',
      offset: 0,
    })).toEqual({ projectId: 'project-a', status: 'open', limit: 100, offset: 0 })

    // 用户显式打开「仅显示当前片段」后才带 segmentId 过滤
    const scopedSegment = resolveQaPanelSegmentScope(finding.segmentId, true)
    expect(scopedSegment).toBe(finding.segmentId)
    expect(buildQaFindingsRequest({
      projectId: 'project-a',
      segmentId: scopedSegment,
      status: 'open',
      severity: '',
      disposition: '',
      offset: 0,
    })).toEqual({
      projectId: 'project-a',
      segmentId: finding.segmentId,
      status: 'open',
      limit: 100,
      offset: 0,
    })

    // 没有当前片段时 fail closed 回项目级，不过滤到错误片段
    expect(resolveQaPanelSegmentScope(undefined, true)).toBeUndefined()
    expect(resolveQaPanelSegmentScope('', true)).toBeUndefined()
  })

  test('given 有当前片段 when 默认渲染面板 then 展示项目级口径且开关未勾选', () => {
    const html = renderToStaticMarkup(
      <QaFindingsPanel
        projectId="project-a"
        activeSegmentId={finding.segmentId}
        archived={false}
        onJump={noop}
        onChanged={async () => undefined}
        refreshToken={0}
      />,
    )

    expect(html).toContain('aria-label="QA Findings"')
    expect(html).not.toContain('aria-label="当前片段 QA Findings"')
    expect(html).toContain('显示整个项目的 Finding；运行 QA 也会扫描整个项目')
    expect(html).toContain('aria-label="仅显示当前片段"')
    expect(html).not.toContain('checked=""')
  })

  test('given 没有当前片段 when 渲染面板 then 「仅显示当前片段」开关禁用并给出原因', () => {
    const html = renderToStaticMarkup(
      <QaFindingsPanel
        projectId="project-a"
        archived={false}
        onJump={noop}
        onChanged={async () => undefined}
        refreshToken={0}
      />,
    )

    expect(html).toContain('title="没有当前片段可筛选"')
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*aria-label="仅显示当前片段"/)
  })

  test('given 定位按钮 when 归档或 Finding 缺片段 then fail-closed 禁用原因；正常时无背景、视觉低于处置动作', () => {
    expect(qaJumpDisabledReason(finding, true)).toBe('项目已归档，不能定位到片段')
    expect(qaJumpDisabledReason({ ...finding, segmentId: '' }, false)).toBe(
      '该 Finding 没有可定位的片段',
    )
    expect(qaJumpDisabledReason(finding, false)).toBeUndefined()

    const card = renderToStaticMarkup(
      <QaFindingCard
        idPrefix="qa-test"
        finding={{ ...finding, currentRevision: 3 }}
        archived={false}
        waiving={false}
        waiverScope="single"
        waiverReason=""
        onJump={noop}
        onResolve={noop}
        onOpenWaiver={noop}
        onWaive={noop}
        onCancelWaiver={noop}
        onWaiverReasonChange={noop}
      />,
    )
    const jumpButton = card.match(/<button[^>]*>[\s\S]*?跳到片段<\/button>/)?.[0]
    expect(jumpButton).toBeDefined()
    expect(jumpButton).not.toContain('disabled=""')
    // ghost 样式：无常驻背景（解决/豁免按钮用 rounded-md bg-foreground/[0.06]）
    expect(jumpButton).toContain('text-foreground/55')
    expect(jumpButton).not.toContain('rounded-md bg-foreground/[0.06]')
  })

  test('given 当前位置在其他批次且有筛选 when 应用定位 patch then workbench atom 切到 Finding 批次与片段并清除筛选', () => {
    const store = createStore()
    const workbenchAtom = linguistWorkbenchUiStateAtomFamily('project-jump')
    store.set(workbenchAtom, {
      activeAssetId: 'ast-00000000000000aa',
      activeSegmentId: 'seg-a',
      assetActiveSegmentIds: { 'ast-00000000000000aa': 'seg-a' },
      search: '旧搜索',
      segmentStageStateFilter: 'confirmed',
    })

    store.set(workbenchAtom, (current) =>
      buildQaFindingJumpPatch(current, 'ast-00000000000000bb', finding.segmentId))

    const state = store.get(workbenchAtom)
    expect(state.activeAssetId).toBe('ast-00000000000000bb')
    expect(state.activeSegmentId).toBe(finding.segmentId)
    expect(state.assetActiveSegmentIds).toEqual({
      'ast-00000000000000aa': 'seg-a',
      'ast-00000000000000bb': finding.segmentId,
    })
    expect(state.search).toBe('')
    expect(state.segmentStageStateFilter).toBeUndefined()
  })
})
