/**
 * 协作委派结果渲染器（K2）
 *
 * mcp__collaboration__* 工具结果（piJsonResult 的 JSON 文本）中的 Linguist 委派：
 * - linguistOutcome 由主进程实时读取冻结范围的 CAT 审计事件
 *   （main/lib/agent-collaboration-tools.ts 的 LinguistDelegationOutcome）；
 * - 子会话状态（运行中 / 已结束 / 失败 / …）与 CAT 阶段结果（未完成 / 已完成 /
 *   有阻塞）是两个独立事实，分行展示，互不作为对方依据；
 * - 普通委派（无 linguistOutcome）整体回退到默认渲染器，不改变原生展示。
 */

import * as React from 'react'
import type { LinguistDelegationOutcome } from '@proma/shared'
import { cn } from '@/lib/utils'
import { getLinguistRoleOption } from '@/features/linguist/session-binding/LinguistRoleMenu'
import { DefaultResultRenderer } from './default-result'

interface DelegationSummaryPayload {
  title?: string
  status?: string
  linguistOutcome?: LinguistDelegationOutcome
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLinguistDelegationOutcome(value: unknown): value is LinguistDelegationOutcome {
  if (!isRecord(value)) return false
  const numericFields = ['total', 'confirmed', 'unchanged', 'corrected', 'blocked', 'pending', 'decided'] as const
  return ['translator', 'reviewer', 'proofreader'].includes(String(value.role))
    && ['translation', 'editing', 'proofreading'].includes(String(value.stage))
    && ['in_progress', 'complete', 'completed_with_blocks'].includes(String(value.status))
    && numericFields.every((field) => Number.isInteger(value[field]) && Number(value[field]) >= 0)
}

function readDelegationSummary(value: unknown): DelegationSummaryPayload | null {
  if (!isRecord(value)) return null
  if (value.linguistOutcome !== undefined && !isLinguistDelegationOutcome(value.linguistOutcome)) {
    return null
  }
  return {
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
    ...(value.linguistOutcome === undefined ? {} : { linguistOutcome: value.linguistOutcome }),
  }
}

/** 接受 { delegations: [...] }（wait/list/get_results）与 { delegation: {...} }（delegate_agent）两种包装。 */
export function parseDelegationSummaries(result: string): DelegationSummaryPayload[] | null {
  try {
    const parsed: unknown = JSON.parse(result)
    if (!isRecord(parsed)) return null
    const values = Array.isArray(parsed.delegations)
      ? parsed.delegations
      : parsed.delegation === undefined ? null : [parsed.delegation]
    if (values === null) return null
    const summaries: DelegationSummaryPayload[] = []
    for (const value of values) {
      const summary = readDelegationSummary(value)
      if (summary === null) return null
      summaries.push(summary)
    }
    return summaries
  } catch {
    return null
  }
}

/** 子会话进程状态；与 CAT 阶段结果无关。 */
export function delegationStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'completed':
      return '已结束'
    case 'failed':
      return '已失败'
    case 'cancelled':
      return '已停止'
    case 'interrupted':
      return '已中断'
    default:
      return '状态未知'
  }
}

/** CAT 阶段结果：只看冻结范围的审计覆盖状态，不从会话状态推断。 */
export function linguistStageOutcomeLabel(outcome: LinguistDelegationOutcome): string {
  if (outcome.status === 'complete') return '已完成'
  if (outcome.status === 'completed_with_blocks') return '有阻塞'
  return '未完成'
}

/** Translator 看通用确认数；Reviewer/Proofreader 看 decision 拆分。 */
export function formatDelegationCoverage(outcome: LinguistDelegationOutcome): string {
  const label = getLinguistRoleOption(outcome.role).shortLabel
  if (outcome.role === 'translator') {
    return `${label}覆盖 ${outcome.confirmed} / ${outcome.total} · 阻塞 ${outcome.blocked}`
  }
  return `${label}覆盖 ${outcome.decided} / ${outcome.total} · 未修改 ${outcome.unchanged} · 已修正 ${outcome.corrected} · 阻塞 ${outcome.blocked}`
}

function DelegationSummaryRow({ item }: { item: DelegationSummaryPayload }): React.ReactElement {
  const outcome = item.linguistOutcome
  return (
    <div className="rounded-md bg-muted/20 px-3 py-2 text-[12px]">
      <div className="flex items-center gap-2">
        {outcome && (
          <span className="flex-shrink-0 rounded-full bg-primary/10 px-1.5 py-0 text-[10px] font-medium leading-4">
            {getLinguistRoleOption(outcome.role).shortLabel}
          </span>
        )}
        <span className="min-w-0 truncate text-foreground/70">{item.title ?? '委派子会话'}</span>
        <span className="ml-auto flex-shrink-0 text-foreground/45">
          {delegationStatusLabel(item.status)}
        </span>
      </div>
      {outcome && (
        <>
          <div className="mt-1 text-foreground/55">
            {formatDelegationCoverage(outcome)}
            <span
              className={cn(
                'ml-2',
                outcome.status === 'complete' ? 'text-foreground/45' : 'text-warning',
              )}
            >
              {linguistStageOutcomeLabel(outcome)}
            </span>
          </div>
          {outcome.evidence && (
            <div className="mt-1 text-[11px] text-foreground/45">
              系统证据 {outcome.evidence.presented}/{outcome.evidence.required}
              {' · '}待呈现 {outcome.evidence.pending}
              {' · '}提醒 {outcome.evidence.warnings}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function DelegationResultRenderer({
  result,
  isError,
}: {
  result: string
  isError: boolean
}): React.ReactElement {
  const summaries = React.useMemo(
    () => (isError ? null : parseDelegationSummaries(result)),
    [result, isError],
  )

  // 非委派 JSON、解析失败或整组普通委派：保持原生默认展示。
  if (!summaries || !summaries.some((item) => item.linguistOutcome)) {
    return <DefaultResultRenderer result={result} isError={isError} />
  }

  return (
    <div className="flex flex-col gap-1.5">
      {summaries.map((item, index) => (
        <DelegationSummaryRow key={index} item={item} />
      ))}
    </div>
  )
}
