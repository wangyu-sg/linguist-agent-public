import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  LINGUIST_PROJECT_ID_PATTERN,
  LINGUIST_SEGMENT_ID_PATTERN,
  type LinguistIpcResult,
  type LinguistProposalDiff,
  type LinguistProposalStatus,
} from '@proma/shared'
import {
  requestCatResultNavigationAtom,
  type CatResultLocation,
} from '@/atoms/cat-result-navigation-atoms'
import { DefaultResultRenderer } from './default-result'

interface CatResultRendererProps {
  toolName: string
  result: string
  isError: boolean
}

interface CatResultSummary {
  title: string
  detail: string
}

export interface ProposalResultIdentity {
  projectId: string
  proposalIds: string[]
}

const PROPOSAL_ID_PATTERN = /^prp-[0-9a-f]{16}$/

function parseObject(result: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(result)
    return isObject(value) ? value : null
  } catch {
    return null
  }
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function arrayLength(value: unknown, stringsOnly = false): number | null {
  if (!Array.isArray(value) || (stringsOnly && !value.every((item) => typeof item === 'string'))) return null
  return value.length
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readProposalResultIdentity(
  toolName: string,
  payload: Record<string, unknown>,
): ProposalResultIdentity | null {
  if (
    toolName !== 'cat_propose_translations'
    && toolName !== 'cat_run_batch_consistency'
  ) return null
  if (
    typeof payload.projectId !== 'string'
    || !LINGUIST_PROJECT_ID_PATTERN.test(payload.projectId)
    || !Array.isArray(payload.proposalIds)
    || payload.proposalIds.length === 0
    || payload.proposalIds.length > 50
    || !payload.proposalIds.every(
      (proposalId) => typeof proposalId === 'string' && PROPOSAL_ID_PATTERN.test(proposalId),
    )
  ) return null
  return { projectId: payload.projectId, proposalIds: payload.proposalIds }
}

export function summarizeProposalReviewStatuses(
  statuses: readonly LinguistProposalStatus[],
): string {
  const count = (status: LinguistProposalStatus): number =>
    statuses.filter((candidate) => candidate === status).length
  const terminal = count('superseded') + count('expired')
  return [
    count('accepted') > 0 ? `已接受 ${count('accepted')}` : '',
    count('rejected') > 0 ? `已拒绝 ${count('rejected')}` : '',
    count('pending') > 0 ? `待审核 ${count('pending')}` : '',
    terminal > 0 ? `已失效 ${terminal}` : '',
  ].filter(Boolean).join(' · ')
}

export async function loadProposalReviewStatuses(
  identity: ProposalResultIdentity,
  getDiff: (input: {
    projectId: string
    proposalId: string
  }) => Promise<LinguistIpcResult<LinguistProposalDiff>>,
): Promise<LinguistProposalStatus[] | undefined> {
  const responses = await Promise.all(identity.proposalIds.map((proposalId) =>
    getDiff({ projectId: identity.projectId, proposalId })))
  const statuses = responses.flatMap((response) =>
    response.ok ? [response.data.proposal.status] : [])
  return statuses.length === responses.length ? statuses : undefined
}

export function readCatResultLocation(
  payload: Record<string, unknown>,
): CatResultLocation | null {
  if (
    typeof payload.projectId !== 'string'
    || !LINGUIST_PROJECT_ID_PATTERN.test(payload.projectId)
  ) return null

  if (Object.hasOwn(payload, 'segmentId')) {
    return typeof payload.segmentId === 'string'
      && LINGUIST_SEGMENT_ID_PATTERN.test(payload.segmentId)
      ? { projectId: payload.projectId, segmentId: payload.segmentId }
      : null
  }
  if (Object.hasOwn(payload, 'segmentIds')) {
    if (
      !Array.isArray(payload.segmentIds)
      || !payload.segmentIds.every(
        (segmentId) => typeof segmentId === 'string'
          && LINGUIST_SEGMENT_ID_PATTERN.test(segmentId),
      )
    ) return null
    return payload.segmentIds[0] === undefined
      ? { projectId: payload.projectId }
      : { projectId: payload.projectId, segmentId: payload.segmentIds[0] }
  }
  return { projectId: payload.projectId }
}

function pagedSummary(
  payload: Record<string, unknown>,
  title: string,
  noun: string,
): CatResultSummary | null {
  const shown = arrayLength(payload.items)
  const total = count(payload.total)
  return shown === null || total === null
    ? null
    : { title, detail: `显示 ${shown} / ${total} 个${noun}` }
}

function searchSummary(
  payload: Record<string, unknown>,
  title: string,
  noun: string,
): CatResultSummary | null {
  const results = arrayLength(payload.results)
  const total = count(payload.total)
  return results === null || total === null
    ? null
    : { title, detail: `找到 ${total} 条${noun}` }
}

function summarizeCatResult(
  toolName: string,
  payload: Record<string, unknown>,
): CatResultSummary | null {
  switch (toolName) {
    case 'cat_project_summary': {
      const assets = count(payload.assetCount)
      const segments = count(payload.totalSegments)
      if (assets === null || segments === null || !isObject(payload.project) || !isObject(payload.segmentCounts)) {
        return null
      }
      return { title: '项目摘要', detail: `${assets} 个文件，${segments} 个片段` }
    }
    case 'cat_list_assets':
      return pagedSummary(payload, '项目文件', '文件')
    case 'cat_get_segments':
      return pagedSummary(payload, '项目片段', '片段')
    case 'cat_search_tm':
      return payload.mode === 'match' || payload.mode === 'concordance'
        ? searchSummary(payload, '翻译记忆', '匹配')
        : null
    case 'cat_search_terms':
      return searchSummary(payload, '项目术语', '术语')
    case 'cat_propose_translations': {
      const proposals = arrayLength(payload.proposalIds, true)
      return proposals === null
        ? null
        : { title: '翻译建议', detail: `已创建 ${proposals} 条待审核建议` }
    }
    case 'cat_run_qa': {
      const total = count(payload.total)
      if (total === null || !isObject(payload.severityCounts) || !isObject(payload.dispositionCounts)) return null
      return { title: '确定性 QA', detail: `发现 ${total} 个问题` }
    }
    case 'cat_get_qa_findings':
      return pagedSummary(payload, '质检问题', '问题')
    case 'cat_submit_critic_review': {
      const findings = arrayLength(payload.findingIds, true)
      const qaFindings = arrayLength(payload.qaFindingIds, true)
      if (
        findings === null
        || qaFindings === null
        || typeof payload.artifactId !== 'string'
        || !isObject(payload.repairScope)
      ) return null
      return { title: '独立复核', detail: `记录 ${findings} 条复核意见` }
    }
    case 'cat_run_batch_consistency': {
      const groups = count(payload.groupCount)
      const findings = count(payload.findingCount)
      if (
        groups === null
        || findings === null
        || !Array.isArray(payload.groups)
        || payload.groups.length !== groups
        || (payload.mode !== 'check-only' && payload.mode !== 'repair')
      ) return null
      if (payload.mode === 'check-only') {
        return { title: '批量一致性', detail: `${groups} 组发现 ${findings} 个问题` }
      }
      const proposals = arrayLength(payload.proposalIds, true)
      return proposals === null
        ? null
        : {
            title: '批量一致性',
            detail: `${groups} 组发现 ${findings} 个问题，创建 ${proposals} 条待审核建议`,
          }
    }
    default:
      return null
  }
}

export function CatResultRenderer({
  toolName,
  result,
  isError,
}: CatResultRendererProps): React.ReactElement {
  const requestNavigation = useSetAtom(requestCatResultNavigationAtom)
  const payload = React.useMemo(() => isError ? null : parseObject(result), [isError, result])
  const proposalIdentity = React.useMemo(
    () => payload === null ? null : readProposalResultIdentity(toolName, payload),
    [payload, toolName],
  )
  const [mutationRevision, setMutationRevision] = React.useState(0)
  const [proposalStatuses, setProposalStatuses] = React.useState<LinguistProposalStatus[]>()
  const proposalKey = proposalIdentity?.proposalIds.join('\0')

  React.useEffect(() => {
    if (proposalIdentity === null) return
    // ponytail: 每张可见 Proposal 卡独立订阅；可见卡数量实测影响时再提升到组合根。
    return window.electronAPI.onLinguistProjectMutation((event) => {
      if (
        event.projectId === proposalIdentity.projectId
        && event.kind === 'proposal-reviewed'
        && (
          event.proposalIds === undefined
          || event.proposalIds.some((proposalId) => proposalIdentity.proposalIds.includes(proposalId))
        )
      ) setMutationRevision((current) => current + 1)
    })
  }, [proposalIdentity?.projectId, proposalKey])

  React.useEffect(() => {
    if (proposalIdentity === null) {
      setProposalStatuses(undefined)
      return
    }
    let cancelled = false
    void loadProposalReviewStatuses(
      proposalIdentity,
      window.electronAPI.linguistProposalsGetDiff,
    ).then((statuses) => {
      if (!cancelled) setProposalStatuses(statuses)
    }).catch(() => {
      if (!cancelled) setProposalStatuses(undefined)
    })
    return () => {
      cancelled = true
    }
  }, [mutationRevision, proposalIdentity?.projectId, proposalKey])

  const summary = payload === null ? null : summarizeCatResult(toolName, payload)
  if (summary === null) return <DefaultResultRenderer result={result} isError={isError} />
  const location = payload === null ? null : readCatResultLocation(payload)
  const actionLabel = toolName === 'cat_run_qa' || toolName === 'cat_get_qa_findings'
    ? '查看问题'
    : '在 CAT 中查看'

  return (
    <section
      aria-label={`${summary.title}结果摘要`}
      className="rounded-lg bg-muted/25 px-3 py-2.5 shadow-sm"
    >
      <p className="text-[12px] font-medium text-foreground/80">{summary.title}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{summary.detail}</p>
      {proposalStatuses !== undefined && (
        <p className="mt-1 text-[11px] font-medium text-foreground/65">
          审核结果：{summarizeProposalReviewStatuses(proposalStatuses)}
        </p>
      )}
      {location !== null && (
        <button
          type="button"
          onClick={() => requestNavigation(location)}
          className="mt-2 rounded-md bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {actionLabel}
        </button>
      )}
    </section>
  )
}
