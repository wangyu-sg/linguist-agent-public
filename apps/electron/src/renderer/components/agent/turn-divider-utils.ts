/**
 * turn-divider-utils — Turn 间分隔条的纯派生逻辑（PB-101）
 *
 * 包含两条纯函数链：
 * - Worked divider：turn 完成后显示「Worked for Xs · N steps」
 * - Model changed divider：相邻 assistant turn 模型变化时显示「模型已切换：A → B」
 *
 * 全部为纯函数，不依赖 React / Jotai，便于单测。
 */

/**
 * 毫秒 → 可读耗时（与 AgentMessages.tsx 的 formatDuration 行为一致。
 * 这里保留一份无 React 依赖的副本，避免 utils 反向 import 组件文件。）
 */
export function formatWorkedDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s.toFixed(0)}s`
}

/** 统计一个 turn 顶层内容块中的工具调用次数（steps） */
export function countTurnSteps(blocks: ReadonlyArray<{ type: string }>): number {
  let steps = 0
  for (const block of blocks) {
    if (block.type === 'tool_use') steps += 1
  }
  return steps
}

/**
 * 构建 Worked divider 文案。
 * durationMs 缺失时返回 null（不显示 divider）；
 * steps 为 0 时省略 steps 段，避免「· 0 steps」噪音。
 */
export function buildWorkedDividerLabel(durationMs: number | undefined, steps: number): string | null {
  if (durationMs == null) return null
  const duration = formatWorkedDuration(durationMs)
  return steps > 0 ? `Worked for ${duration} · ${steps} steps` : `Worked for ${duration}`
}

/** 模型切换信息：prevModel → nextModel */
export interface ModelSwitchInfo {
  prevModel: string
  nextModel: string
}

/**
 * 扫描分组序列，找出需要插入「模型已切换」divider 的位置。
 *
 * 输入为按渲染顺序排列的消息分组（只需 type / model 两个字段）。
 * 只比较 assistant-turn 分组（user / system 分组不参与比较、不重置上下文）。
 * 返回 Map：key 为分组在数组中的下标（即在该分组之前插入 divider）。
 *
 * 首个 assistant turn、或与前一个 assistant turn model 相同（含双双缺失）时不产生条目。
 */
export function buildModelSwitchDividers<T extends { type: string; model?: string }>(
  groups: ReadonlyArray<T>,
): Map<number, ModelSwitchInfo> {
  const result = new Map<number, ModelSwitchInfo>()
  let lastModel: string | undefined

  for (let index = 0; index < groups.length; index++) {
    const group = groups[index]
    if (!group || group.type !== 'assistant-turn') continue
    const model = group.model
    if (model && lastModel && model !== lastModel) {
      result.set(index, { prevModel: lastModel, nextModel: model })
    }
    // model 缺失的 turn 不覆盖 lastModel：视为「沿用上一模型上下文」，
    // 避免持久化数据缺 model 字段时产生误判的切换提示。
    if (model) lastModel = model
  }

  return result
}
