import { normalizeQaProfile } from '@linguist/cat-core'
import {
  runProjectQa,
  type QaFindingListFilter,
} from '@linguist/cat-store'
import { Type } from 'typebox'
import { pageHasMore, resolvePage } from './pagination'
import {
  CAT_TOOL_PAGE_LIMITS,
  type CatQaFindingItem,
  type CatRunQaResult,
  type PagedResult,
} from './types'
import {
  defineTool,
  toolResult,
  type CatToolRuntime,
} from './tool-runtime'

/** 确定性 QA 执行与 Finding 读取；不提供 resolve/waive。 */
export function createQaTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const runQaTool = defineTool({
    name: 'cat_run_qa',
    label: 'CAT run QA',
    description:
      'Run deterministic QA for every segment in the bound CAT project and persist reviewable findings. ' +
      'This never changes segment text, revision, or review status. Only a human can resolve or waive findings.',
    promptSnippet: 'Run deterministic QA on the bound CAT project',
    promptGuidelines: [
      'Report findings to the user; never claim they are resolved or waived.',
    ],
    parameters: Type.Object({}),
    async execute(toolCallId) {
      // PB-096 术语接线：runProjectQa 内部从 term_entries 构建术语规则；
      // 项目 glossaryPolicy 决定 preferred 偏离的定级（forbidden 永远阻断）。
      // PB-097：项目 tagProfile 进同一道确定性 QA（缺省 = 仅内置族）。
      const { project, db } = resolveBoundProject('cat_run_qa', toolCallId)
      const findings = runProjectQa(db, {
        glossaryPolicy: project.glossaryPolicy,
        profile: normalizeQaProfile(project.qaProfile),
        ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
      })
      const severityCounts: CatRunQaResult['severityCounts'] = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 }
      const dispositionCounts: CatRunQaResult['dispositionCounts'] = { defect: 0, needs_review: 0, query: 0, info: 0 }
      for (const finding of findings) {
        severityCounts[finding.severity] += 1
        dispositionCounts[finding.disposition] += 1
      }
      const dto: CatRunQaResult = {
        total: findings.length,
        severityCounts,
        dispositionCounts,
      }
      notifyMutation({
        kind: 'qa-updated',
        segmentIds: [...new Set(findings.map((finding) => finding.segmentId as string))],
        qaFindingIds: findings.map((finding) => finding.id as string),
      })
      return toolResult(
        dto,
        deps.resultProjectId,
        findings.map((finding) => finding.segmentId as string),
      )
    },
  })

  const getQaFindingsTool = defineTool({
    name: 'cat_get_qa_findings',
    label: 'CAT get QA findings',
    description:
      'Read persisted QA findings from the bound CAT project, optionally filtered by status or severity. ' +
      `Returns at most ${CAT_TOOL_PAGE_LIMITS.getQaFindings.maxLimit} findings per call. ` +
      'This tool cannot resolve or waive findings.',
    promptSnippet: 'Read QA findings from the bound CAT project',
    parameters: Type.Object({
      status: Type.Optional(Type.Union([
        Type.Literal('open'),
        Type.Literal('resolved'),
        Type.Literal('waived'),
      ])),
      severity: Type.Optional(Type.Union([
        Type.Literal('L0'),
        Type.Literal('L1'),
        Type.Literal('L2'),
        Type.Literal('L3'),
        Type.Literal('L4'),
      ])),
      disposition: Type.Optional(Type.Union([
        Type.Literal('defect'),
        Type.Literal('needs_review'),
        Type.Literal('query'),
        Type.Literal('info'),
      ])),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_get_qa_findings', toolCallId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.getQaFindings)
      const filter: QaFindingListFilter = {
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.severity !== undefined ? { severity: params.severity } : {}),
        ...(params.disposition !== undefined ? { disposition: params.disposition } : {}),
      }
      const findings = db.qaFindings.list({ ...filter, limit: page.limit, offset: page.offset })
      const total = db.qaFindings.count(filter)
      const items: CatQaFindingItem[] = findings.map((finding) => ({
        id: finding.id as string,
        segmentId: finding.segmentId as string,
        code: finding.code,
        severity: finding.severity,
        issueType: finding.issueType,
        disposition: finding.disposition,
        message: finding.message,
        status: finding.status,
        segmentRevision: finding.segmentRevision,
        ...(finding.waiverReason !== undefined ? { waiverReason: finding.waiverReason } : {}),
      }))
      const dto: PagedResult<CatQaFindingItem> = {
        items,
        total,
        limit: page.limit,
        offset: page.offset,
        hasMore: pageHasMore(total, page.offset, items.length),
        ...(page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId, items.map((item) => item.segmentId))
    },
  })

return [runQaTool, getQaFindingsTool] as const
}
