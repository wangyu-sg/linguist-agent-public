import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { LinguistProjectSummary } from '@proma/shared'

/** Workbench 项目摘要的读模型状态。 */
export type WorkbenchSummaryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; summary: LinguistProjectSummary }

/**
 * 项目摘要共享 atom family：由 LocalizationProjectWorkbench 的 summary loader 写入,
 * 会话侧消费者(Host 扩展 / Rail)无需挂载 Workbench 组件即可读取项目名与资产列表。
 */
export const linguistProjectSummaryAtomFamily = atomFamily(
  (_projectId: string) => atom<WorkbenchSummaryState>({ status: 'loading' }),
)
