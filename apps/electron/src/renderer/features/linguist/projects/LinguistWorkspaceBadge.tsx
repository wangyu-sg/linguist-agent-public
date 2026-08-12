/**
 * Agent 侧栏的 Linguist 项目标记（K1）。
 *
 * 同一 LA 项目只显示为一个 Proma Workspace；该 workspace 的项目头用低调
 * Linguist 徽章表明 CAT 能力，不渲染第二种项目卡。徽章数据来自共享的项目
 * 列表 atom，未就绪时降级为无徽章，不影响原生 Agent 侧栏行为。
 */

import * as React from 'react'
import type { LinguistProjectInfo } from '@proma/shared'
import type { LinguistProjectListState } from './project-list-atoms'

/** promaWorkspaceId → 项目。未就绪/失败时返回空映射；同一 Workspace 只保留一个项目身份。 */
export function buildLinguistWorkspaceMap(
  state: LinguistProjectListState,
): Map<string, LinguistProjectInfo> {
  const map = new Map<string, LinguistProjectInfo>()
  if (state.status !== 'ready') return map
  for (const project of state.projects) {
    if (!map.has(project.promaWorkspaceId)) {
      map.set(project.promaWorkspaceId, project)
    }
  }
  return map
}

/** Agent 侧栏项目头上的低调 Linguist 标记。 */
export function LinguistWorkspaceBadge(): React.ReactElement {
  return (
    <span className="flex-shrink-0 rounded-full bg-primary/10 px-1.5 py-0 text-[10px] font-medium leading-4">
      Linguist
    </span>
  )
}
