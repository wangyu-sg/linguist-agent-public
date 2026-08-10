import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  LINGUIST_PROJECT_ID_PATTERN,
  LINGUIST_PROPOSAL_ID_PATTERN,
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

interface ApplyResultNavigation {
  label: string
  location: CatResultLocation
}

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

export function serializeCatToolResultDetails(
  toolName: string,
  details: unknown,
): string | undefined {
  if (!isObject(details) || summarizeCatResult(toolName, details) === null) return undefined
  try {
    return JSON.stringify(details)
  } catch {
    return undefined
  }
}

export function readProposalResultIdentity(
  toolName: string,
  payload: Record<string, unknown>,
): ProposalResultIdentity | null {
  if (
    toolName !== 'cat_propose_translations'
    && toolName !== 'cat_create_consistency_proposals'
  ) return null
  if (
    typeof payload.projectId !== 'string'
    || !LINGUIST_PROJECT_ID_PATTERN.test(payload.projectId)
    || !Array.isArray(payload.proposalIds)
    || payload.proposalIds.length === 0
    || payload.proposalIds.length > 50
    || !payload.proposalIds.every(
      (proposalId) => typeof proposalId === 'string' && LINGUIST_PROPOSAL_ID_PATTERN.test(proposalId),
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
    count('pending') > 0 ? `待查看 ${count('pending')}` : '',
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

export function readApplyResultNavigation(
  payload: Record<string, unknown>,
): ApplyResultNavigation[] {
  if (
    typeof payload.projectId !== 'string'
    || !LINGUIST_PROJECT_ID_PATTERN.test(payload.projectId)
  ) return []
  const projectId = payload.projectId
  const groups: ApplyResultNavigation[] = []
  const add = (label: string, amount: unknown, ids: unknown): void => {
    const total = count(amount)
    if (
      total === null
      || total === 0
      || !Array.isArray(ids)
      || !ids.every((id) => typeof id === 'string' && LINGUIST_SEGMENT_ID_PATTERN.test(id))
      || ids[0] === undefined
    ) return
    groups.push({ label: `${label} ${total}`, location: { projectId, segmentId: ids[0] } })
  }
  const changedId = typeof payload.segmentId === 'string' ? [payload.segmentId] : []
  add('已写回', payload.applied, changedId)
  add('保留建议', payload.pending, changedId)
  add('Revision 冲突', arrayLength(payload.stale, true), payload.stale)
  add('锁定跳过', arrayLength(payload.locked, true), payload.locked)
  const failedIds = Array.isArray(payload.failed)
    ? payload.failed.flatMap((item) => isObject(item) && typeof item.segmentId === 'string' ? [item.segmentId] : [])
    : []
  add('失败', arrayLength(payload.failed), failedIds)
  return groups
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
    case 'cat_get_translation_context': {
      const contexts = arrayLength(payload.contexts)
      const total = count(payload.totalRequested)
      if (contexts === null || total === null || typeof payload.truncated !== 'boolean') return null
      return {
        title: '翻译上下文',
        detail: `已读取 ${contexts} / ${total} 个片段${payload.truncated ? '，可继续' : ''}`,
      }
    }
    case 'cat_get_proposal_snapshot': {
      const labels: Record<string, string> = {
        pending: '待查看',
        accepted: '已接受',
        rejected: '已拒绝',
        stale: '已过期',
      }
      const status = typeof payload.status === 'string' ? labels[payload.status] : undefined
      return status === undefined || typeof payload.snapshotId !== 'string'
        ? null
        : { title: '建议快照', detail: `状态：${status}` }
    }
    case 'cat_apply_translations': {
      const requested = count(payload.requested)
      const applied = count(payload.applied)
      const pending = count(payload.pending)
      const stale = arrayLength(payload.stale, true)
      const locked = arrayLength(payload.locked, true)
      const failed = arrayLength(payload.failed)
      if ([requested, applied, pending, stale, locked, failed].some((value) => value === null)) return null
      return {
        title: '写回结果',
        detail: [
          `处理 ${requested} 段`,
          `已写回 ${applied}`,
          `保留建议 ${pending}`,
          `Revision 冲突 ${stale}`,
          `锁定跳过 ${locked}`,
          failed! > 0 ? `失败 ${failed}` : '',
        ].filter(Boolean).join(' · '),
      }
    }
    case 'cat_propose_translations': {
      const proposals = arrayLength(payload.proposalIds, true)
      return proposals === null
        ? null
        : { title: '翻译建议', detail: `已创建 ${proposals} 条待查看建议` }
    }
    case 'cat_accept_proposals': {
      const accepted = arrayLength(payload.accepted)
      if (accepted === null || typeof payload.replayed !== 'boolean') return null
      return {
        title: '写回结果',
        detail: payload.replayed
          ? '请求已重放，未重复写入'
          : `已写回 ${accepted} 段`,
      }
    }
    case 'cat_import_resources': {
      const groups: ReadonlyArray<readonly [string, unknown]> = [
        ['已导入', payload.imported],
        ['未变化', payload.skippedDuplicate],
        ['需要选择', payload.needsInput],
        ['不支持', payload.unsupported],
        ['失败', payload.failed],
      ]
      const parts = groups.flatMap(([label, value]) => {
        const item = count(value)
        return item !== null && item > 0 ? [`${label} ${item}`] : []
      })
      return parts.length === 0 ? null : { title: '导入资源', detail: parts.join(' · ') }
    }
    case 'cat_import_asset': {
      const importedCount = count(payload.importedCount)
      const unchangedCount = count(payload.unchangedCount)
      const filename = typeof payload.filename === 'string' ? payload.filename : null
      if (importedCount === null || unchangedCount === null || filename === null) return null
      const kindTitles: Record<string, string> = {
        batch: '导入批次',
        tm: '导入 TM',
        terms: '导入术语库',
        context: '导入上下文',
      }
      const title = typeof payload.resourceKind === 'string'
        ? kindTitles[payload.resourceKind] ?? '导入资源'
        : '导入资源'
      const warnings = arrayLength(payload.warnings)
      return {
        title,
        detail: `${filename} · 新增 ${importedCount} · 未变化 ${unchangedCount}${warnings !== null && warnings > 0 ? ` · ${warnings} 条警告` : ''}`,
      }
    }
    case 'cat_export_asset': {
      const verified = count(payload.verifiedSegments)
      const filename = typeof payload.filename === 'string' ? payload.filename : null
      if (
        verified === null
        || filename === null
        || (payload.validation !== 'verified' && payload.validation !== 'as-is')
      ) return null
      return {
        title: payload.validation === 'verified' ? '验证并导出' : '按当前状态导出',
        detail: `${filename} · 已回读验证 ${verified} 段`,
      }
    }
    case 'cat_scan_unknown_tag_patterns': {
      const patterns = arrayLength(payload.patterns)
      return patterns === null
        ? null
        : {
            title: '未知 Tag 扫描',
            detail: patterns === 0 ? '未发现疑似 Tag' : `发现 ${patterns} 类疑似 Tag`,
          }
    }
    case 'cat_save_tag_profile_candidate': {
      if (
        typeof payload.candidateId !== 'string'
        || (payload.status !== 'candidate' && payload.status !== 'active')
      ) return null
      return {
        title: 'Tag 候选',
        detail: payload.status === 'active' ? '已保存并启用' : '已保存为候选（软提示）',
      }
    }
    case 'cat_plan_consistency_repairs': {
      const groups = count(payload.groupCount)
      const findings = count(payload.findingCount)
      return groups === null || findings === null
        ? null
        : { title: '一致性检查', detail: `${groups} 组发现 ${findings} 个问题` }
    }
    case 'cat_create_consistency_proposals': {
      const proposals = arrayLength(payload.proposalIds, true)
      return proposals === null
        ? null
        : { title: '一致性建议', detail: `已创建 ${proposals} 条待查看建议` }
    }
    case 'cat_run_qa': {
      const total = count(payload.total)
      if (total === null || !isObject(payload.severityCounts) || !isObject(payload.dispositionCounts)) return null
      return { title: '确定性 QA', detail: `发现 ${total} 个问题` }
    }
    case 'cat_get_qa_findings':
      return pagedSummary(payload, '质检问题', '问题')
    case 'cat_search_sentence_patterns':
      return pagedSummary(payload, '句式库', '句式')
    case 'cat_read_context_doc': {
      const total = count(payload.totalChars)
      const shown = typeof payload.text === 'string' ? payload.text.length : 0
      return total === null || shown > total
        ? null
        : { title: '上下文文档', detail: `已读取 ${shown} / ${total} 个字符` }
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
  const applyNavigation = toolName === 'cat_apply_translations' && payload !== null
    ? readApplyResultNavigation(payload)
    : []

  return (
    <section
      aria-label={`${summary.title}结果摘要`}
      className="rounded-lg bg-muted/25 px-3 py-2.5 shadow-sm"
    >
      <p className="text-[12px] font-medium text-foreground/80">{summary.title}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{summary.detail}</p>
      {applyNavigation.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="写回结果定位">
          {applyNavigation.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => requestNavigation(item.location)}
              className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {proposalStatuses !== undefined && (
        <p className="mt-1 text-[11px] font-medium text-foreground/65">
          审核结果：{summarizeProposalReviewStatuses(proposalStatuses)}
        </p>
      )}
      {location !== null && applyNavigation.length === 0 && (
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
