/**
 * 阶段 decision 覆盖统计（K2/K4：Translator/Reviewer/Proofreader 真实进度投影）。
 *
 * 数据只来自主进程聚合 IPC（linguist.projects.getStageCoverage），前端不从
 * 可见段数 / Agent 文本 / Proposal 数推算覆盖率。本文件不含 React 依赖，
 * 纯函数与 atom 由 bun test 直接驱动。
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { createStore } from 'jotai/vanilla'
import type {
  LinguistStageDecisionCoverage,
  LinguistWorkflowStage,
} from '@proma/shared'

/** 展示的阶段集合：Translator=translation、Reviewer=editing、Proofreader=proofreading。 */
export const COVERAGE_STAGES = ['translation', 'editing', 'proofreading'] as const

export const STAGE_COVERAGE_LABELS: Record<(typeof COVERAGE_STAGES)[number], string> = {
  translation: '翻译',
  editing: '审校',
  proofreading: '校对',
}

export type LinguistStageCoverageMap = Partial<
  Record<LinguistWorkflowStage, LinguistStageDecisionCoverage>
>

export function stageCoverageKey(projectId: string, assetId: string): string {
  return `${projectId}:${assetId}`
}

/** 当前批次的阶段覆盖投影；只缓存最近一次成功拉取。 */
export const linguistStageCoverageAtomFamily = atomFamily(
  (_key: string) => atom<LinguistStageCoverageMap>({}),
)

type Store = ReturnType<typeof createStore>

/** 拉取当前批次各阶段覆盖并写入投影；失败阶段保持旧值。 */
export async function refreshLinguistStageCoverage(
  store: Store,
  projectId: string,
  assetId: string,
): Promise<void> {
  const results = await Promise.all(
    COVERAGE_STAGES.map((workflowStage) =>
      window.electronAPI.linguistProjectsGetStageCoverage({
        projectId,
        assetId,
        workflowStage,
      }),
    ),
  )
  const key = stageCoverageKey(projectId, assetId)
  const previous = store.get(linguistStageCoverageAtomFamily(key))
  const next: LinguistStageCoverageMap = { ...previous }
  COVERAGE_STAGES.forEach((stage, index) => {
    const result = results[index]
    if (result !== undefined && result.ok) {
      next[stage] = result.data
    }
  })
  store.set(linguistStageCoverageAtomFamily(key), next)
}

export interface StageCoverageText {
  /** 形如「审校 96 / 101 · 未修改 70 · 已修正 26 · 阻塞 2」。 */
  text: string
  decided: number
  total: number
  blocked: number
  complete: boolean
}

/** 状态栏紧凑文案；decided = total - pending，仅后端聚合值。翻译阶段按 K4 只显示确认口径与阻塞。 */
export function formatStageCoverage(
  stage: (typeof COVERAGE_STAGES)[number],
  coverage: LinguistStageDecisionCoverage,
): StageCoverageText {
  const decided = coverage.total - coverage.pending
  const text = stage === 'translation'
    ? `${STAGE_COVERAGE_LABELS[stage]} ${coverage.confirmed} / ${coverage.total} · 阻塞 ${coverage.blocked}`
    : `${STAGE_COVERAGE_LABELS[stage]} ${decided} / ${coverage.total}`
      + ` · 未修改 ${coverage.unchanged} · 已修正 ${coverage.corrected} · 阻塞 ${coverage.blocked}`
  return {
    text,
    decided,
    total: coverage.total,
    blocked: coverage.blocked,
    complete: coverage.pending === 0,
  }
}
