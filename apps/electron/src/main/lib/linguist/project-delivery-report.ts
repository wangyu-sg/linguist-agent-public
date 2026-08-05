import type { LinguistProject } from '@linguist/cat-core'
import type {
  LinguistDeliveryPreflight,
  LinguistDeliveryVerification,
} from './project-service-types'

/** 生成不包含本机路径的交付预检报告。 */
export function buildDeliveryReport(
  project: LinguistProject,
  preflight: LinguistDeliveryPreflight,
  verification?: LinguistDeliveryVerification,
): string {
  const state = preflight.ready ? '可交付' : '不可交付'
  const nativeStatus = preflight.expectedNativeStatus ?? '格式无可写原生状态'
  const lines = [
    '# Linguist Agent 审校交付报告',
    '',
    `- 项目：${project.name}`,
    `- 资产：${preflight.filename}`,
    `- 工作阶段：${preflight.workflowStage}`,
    `- 预检结论：${state}`,
    `- 句段：${preflight.segmentCount}`,
    `- 本轮进度：未处理 ${preflight.stageCounts.untouched} / 草稿 ${preflight.stageCounts.draft} / 已确认 ${preflight.stageCounts.confirmed}`,
    `- 待处理提案：${preflight.pendingProposalCount}`,
    `- QA：错误 ${preflight.qa.openErrors} / 警告 ${preflight.qa.openWarnings} / 已豁免 ${preflight.qa.waived}`,
    `- 目标原生状态：${nativeStatus}`,
  ]
  if (preflight.blockers.length > 0) {
    lines.push(
      '- 阻断项：',
      ...preflight.blockers.map((blocker) => `  - ${blocker.message}`),
    )
  }
  if (verification !== undefined) {
    lines.push(
      `- 重新导入验证：${verification.verifiedSegments}/${preflight.segmentCount} 句段通过`,
      `- 标签与占位符：${verification.tagsPreserved ? '已保留' : '未通过'}`,
      `- 译文变化：${verification.changedTargetSegments} 段`,
      `- 原生状态变化：${verification.changedNativeStatusSegments} 段`,
      `- SHA-256：${verification.sha256}`,
      `- 建议文件名：${verification.suggestedFilename}`,
    )
  }
  return `${lines.join('\n')}\n`
}
