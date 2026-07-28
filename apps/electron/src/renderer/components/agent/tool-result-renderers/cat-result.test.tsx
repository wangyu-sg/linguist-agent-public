import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolResultRenderer } from '.'
import {
  readCatResultLocation,
  readProposalResultIdentity,
  loadProposalReviewStatuses,
  summarizeProposalReviewStatuses,
} from './cat-result'

const PRIVATE_TEXT = '/Users/customer/private/客户正文'
const PROJECT_ID = 'prj-0000000000000001'
const SEGMENT_ID = 'seg-0000000000000001'

function renderResult(
  toolName: string,
  payload: Record<string, unknown> | string,
  isError = false,
): string {
  return renderToStaticMarkup(
    <ToolResultRenderer
      toolName={toolName}
      input={{}}
      result={typeof payload === 'string' ? payload : JSON.stringify(payload)}
      isError={isError}
    />,
  )
}

describe('CAT Tool Result 原生摘要', () => {
  test('given 常用 CAT 工具结果 when 原生 Tool Renderer 展开 then 只显示可访问摘要', () => {
    const cases = [
      {
        toolName: 'cat_project_summary',
        payload: {
          project: { name: PRIVATE_TEXT },
          assetCount: 3,
          totalSegments: 42,
          segmentCounts: { untranslated: 12, draft: 10, translated: 15, reviewed: 5 },
        },
        title: '项目摘要',
        detail: '3 个文件，42 个片段',
      },
      {
        toolName: 'cat_list_assets',
        payload: { items: [{ filename: PRIVATE_TEXT }], total: 3, limit: 1, offset: 0, hasMore: true },
        title: '项目文件',
        detail: '显示 1 / 3 个文件',
      },
      {
        toolName: 'cat_get_segments',
        payload: { items: [{ source: PRIVATE_TEXT }], total: 42, limit: 1, offset: 0, hasMore: true },
        title: '项目片段',
        detail: '显示 1 / 42 个片段',
      },
      {
        toolName: 'cat_search_tm',
        payload: { query: PRIVATE_TEXT, results: [{ target: PRIVATE_TEXT }], total: 6, limit: 20, mode: 'match' },
        title: '翻译记忆',
        detail: '找到 6 条匹配',
      },
      {
        toolName: 'cat_search_terms',
        payload: { query: PRIVATE_TEXT, results: [{ translation: PRIVATE_TEXT }], total: 4, limit: 20 },
        title: '项目术语',
        detail: '找到 4 条术语',
      },
      {
        toolName: 'cat_propose_translations',
        payload: { proposalIds: ['proposal-1', PRIVATE_TEXT] },
        title: '翻译建议',
        detail: '已创建 2 条待审核建议',
      },
      {
        toolName: 'cat_run_qa',
        payload: {
          total: 8,
          severityCounts: { L0: 0, L1: 1, L2: 2, L3: 3, L4: 2 },
          dispositionCounts: { defect: 6, needs_review: 2, query: 0, info: 0 },
        },
        title: '确定性 QA',
        detail: '发现 8 个问题',
      },
      {
        toolName: 'cat_get_qa_findings',
        payload: { items: [{ message: PRIVATE_TEXT }], total: 8, limit: 1, offset: 0, hasMore: true },
        title: '质检问题',
        detail: '显示 1 / 8 个问题',
      },
      {
        toolName: 'cat_submit_critic_review',
        payload: {
          artifactId: 'artifact-1',
          findingIds: ['finding-1', PRIVATE_TEXT],
          qaFindingIds: ['qa-1', 'qa-2'],
          repairScope: { authority: 'advisory_finding', canCommit: false, segmentIds: ['segment-1'], findingIds: [] },
        },
        title: '独立复核',
        detail: '记录 2 条复核意见',
      },
      {
        toolName: 'cat_run_batch_consistency',
        payload: {
          mode: 'repair',
          findingCount: 5,
          groupCount: 2,
          groups: [{ source: PRIVATE_TEXT }, { source: PRIVATE_TEXT }],
          proposalIds: ['proposal-1'],
        },
        title: '批量一致性',
        detail: '2 组发现 5 个问题，创建 1 条待审核建议',
      },
      {
        toolName: 'cat_run_batch_consistency',
        payload: {
          mode: 'check-only',
          findingCount: 5,
          groupCount: 2,
          groups: [{ source: PRIVATE_TEXT }, { source: PRIVATE_TEXT }],
        },
        title: '批量一致性',
        detail: '2 组发现 5 个问题',
      },
    ] as const

    for (const item of cases) {
      const html = renderResult(item.toolName, item.payload)
      expect(html).toContain(`aria-label="${item.title}结果摘要"`)
      expect(html).toContain(item.detail)
      expect(html).not.toContain(PRIVATE_TEXT)
      expect(html).not.toContain('<button')
    }
  })

  test('given 错误、畸形或未知 CAT payload when 渲染 then 安全回退原生通用结果', () => {
    expect(renderResult('cat_run_qa', 'malformed fallback marker')).toContain('malformed fallback marker')
    expect(renderResult('cat_project_summary', { total: 1 })).toContain('<td')
    expect(renderResult('cat_future_tool', 'unknown fallback marker')).toContain('unknown fallback marker')
    expect(renderResult('cat_run_qa', 'error fallback marker', true)).toContain('error fallback marker')
  })

  test('given 严格 Project/Segment ID when 渲染摘要 then 只为可信位置显示原生按钮', () => {
    const projectOnly = renderResult('cat_run_qa', {
      projectId: PROJECT_ID,
      total: 0,
      severityCounts: {},
      dispositionCounts: {},
    })
    expect(projectOnly).toContain('查看问题')

    const segment = renderResult('cat_get_qa_findings', {
      projectId: PROJECT_ID,
      segmentIds: [SEGMENT_ID],
      items: [],
      total: 0,
    })
    expect(segment).toContain('查看问题')

    for (const payload of [
      { projectId: PRIVATE_TEXT },
      { projectId: PROJECT_ID, segmentId: PRIVATE_TEXT },
      { projectId: PROJECT_ID, segmentIds: [SEGMENT_ID, PRIVATE_TEXT] },
    ]) {
      const html = renderResult('cat_run_qa', {
        ...payload,
        total: 0,
        severityCounts: {},
        dispositionCounts: {},
      })
      expect(html).not.toContain('<button')
      expect(readCatResultLocation(payload)).toBeNull()
    }
  })

  test('given 持久化 proposal tool_result when Timeline 重开 then 只接受可信身份并汇总 DB 终态', () => {
    const proposalIds = ['prp-0000000000000001', 'prp-0000000000000002']
    expect(readProposalResultIdentity('cat_propose_translations', {
      projectId: PROJECT_ID,
      proposalIds,
    })).toEqual({ projectId: PROJECT_ID, proposalIds })
    expect(readProposalResultIdentity('cat_propose_translations', {
      projectId: PROJECT_ID,
      proposalIds: [...proposalIds, PRIVATE_TEXT],
    })).toBeNull()
    expect(summarizeProposalReviewStatuses([
      'accepted',
      'accepted',
      'rejected',
      'pending',
      'superseded',
      'expired',
    ])).toBe('已接受 2 · 已拒绝 1 · 待审核 1 · 已失效 2')
  })

  test('given Timeline 重开或 proposal-reviewed revision when 回查终态 then 逐个使用可信 ID 且任一失败即不伪造状态', async () => {
    const identity = {
      projectId: PROJECT_ID,
      proposalIds: ['prp-0000000000000001', 'prp-0000000000000002'],
    }
    const requested: string[] = []
    const statuses = await loadProposalReviewStatuses(identity, async (input) => {
      requested.push(input.proposalId)
      return {
        ok: true,
        data: {
          proposal: {
            id: input.proposalId,
            segmentId: SEGMENT_ID,
            baseRevision: 0,
            proposedTarget: '译文',
            evidenceRefs: [],
            termRefs: [],
            warnings: [],
            createdAt: '2026-07-27T00:00:00.000Z',
            status: input.proposalId.endsWith('1') ? 'accepted' : 'rejected',
          },
          originalOrdinal: 1,
          source: 'Source',
          currentTarget: '译文',
          proposedTarget: '译文',
          currentRevision: 1,
          baseRevision: 0,
          locked: false,
        },
      }
    })
    expect(requested).toEqual(identity.proposalIds)
    expect(statuses).toEqual(['accepted', 'rejected'])
    expect(await loadProposalReviewStatuses(identity, async () => ({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND', message: 'missing' },
    }))).toBeUndefined()
  })
})
