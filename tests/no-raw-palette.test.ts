/**
 * no-raw-palette 契约测试（PB-101 起，逐批次扩充）
 *
 * 断言各批次迁移过的文件不再出现 raw palette 状态色 class
 * （amber-/emerald-/red-/violet-/green- + 数字色阶，如 text-amber-600、bg-green-500/10）。
 * 状态色一律走 LA token 层（success / warning / info / destructive 三件套，
 * 见 docs/design/LA_DESIGN_TOKENS.md §1.5）。
 *
 * 豁免机制：EXEMPTIONS 按「文件 + 行内容子串」精确豁免，每条必须写清理由；
 * 豁免行若被改掉（子串不再匹配），对应断言会失败，防止豁免被滥用扩大。
 *
 * 明确不在本测试范围（豁免之外的 raw palette 归后续批次，见 PB-101 简报「明确不做」）：
 * - 未列入 MIGRATED_FILES 的其他域文件
 * 因此本测试只覆盖下方 MIGRATED_FILES 列出的、各批次已迁移的文件。
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const REPO_ROOT = dirname(import.meta.dir)
const AGENT_DIR = 'apps/electron/src/renderer/components/agent'
const LINGUIST_DIR = 'apps/electron/src/renderer/features/linguist'

/** PB-101 完成 raw palette 迁移的文件（相对仓库根） */
const MIGRATED_FILES = [
  `${AGENT_DIR}/AgentMessages.tsx`,
  `${AGENT_DIR}/AgentView.tsx`,
  `${AGENT_DIR}/AgentPlaceholder.tsx`,
  `${AGENT_DIR}/ContentBlock.tsx`,
  `${AGENT_DIR}/tool-result-renderers/task-list-result.tsx`,
  `${AGENT_DIR}/tool-result-renderers/task-get-result.tsx`,
  `${AGENT_DIR}/tool-result-renderers/bash-result.tsx`,
  // ===== PB-103（Approval / Plan / Compaction 域）=====
  `${AGENT_DIR}/PermissionBanner.tsx`,
  `${AGENT_DIR}/ContextUsageBadge.tsx`,
  `${AGENT_DIR}/SDKMessageRenderer.tsx`,
  `${AGENT_DIR}/TaskProgressOverlay.tsx`,
  `${AGENT_DIR}/TaskProgressCard.tsx`,
  `${AGENT_DIR}/mention-suggestions.tsx`,
  // ===== PB-102（Shell / Right Rail 域）=====
  'apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx',
  'apps/electron/src/renderer/components/chat/SystemPromptSelector.tsx',
  'apps/electron/src/renderer/components/chat/PromptEditorSidebar.tsx',
  'apps/electron/src/renderer/components/session-preview/SessionMiniMapPopover.tsx',
  'apps/electron/src/renderer/components/diff/DiffChangesList.tsx',
  'apps/electron/src/renderer/components/diff/DiffTabContent.tsx',
  'apps/electron/src/renderer/components/agent-skills/SkillCard.tsx',
  'apps/electron/src/renderer/components/agent-skills/AgentSkillsView.tsx',
  'apps/electron/src/renderer/components/agent-skills/ImportSkillDialog.tsx',
  'apps/electron/src/renderer/components/agent-skills/McpCard.tsx',
  'apps/electron/src/renderer/components/agent-skills/BuiltinMcpDetailSheet.tsx',
  'apps/electron/src/renderer/components/agent-skills/SkillDetailSheet.tsx',
  'apps/electron/src/renderer/components/settings/FeishuSettings.tsx',
  'apps/electron/src/renderer/components/settings/DingTalkSettings.tsx',
  'apps/electron/src/renderer/components/settings/WeChatSettings.tsx',
  'apps/electron/src/renderer/components/settings/StorageSettings.tsx',
  'apps/electron/src/renderer/components/settings/ToolSettings.tsx',
  'apps/electron/src/renderer/components/settings/McpServerForm.tsx',
  'apps/electron/src/renderer/components/settings/ChannelForm.tsx',
  'apps/electron/src/renderer/components/settings/BotHubSettings.tsx',
  'apps/electron/src/renderer/components/settings/VoiceInputSettings.tsx',
  'apps/electron/src/renderer/components/settings/MigrationSettings.tsx',
  'apps/electron/src/renderer/components/settings/MemorySettings.tsx',
  'apps/electron/src/renderer/components/settings/SettingsPanel.tsx',
  'apps/electron/src/renderer/components/settings/ProxySettings.tsx',
  'apps/electron/src/renderer/components/settings/PromptSettings.tsx',
  // ===== PB-104（linguist 域收尾：migration / session-binding / projects）=====
  `${LINGUIST_DIR}/migration/MigrationWizard.tsx`,
  'apps/electron/src/renderer/components/migration/MigrationImportDialog.tsx',
  `${LINGUIST_DIR}/session-binding/LinguistSessionBindingBadge.tsx`,
  `${LINGUIST_DIR}/projects/ProposalInbox.tsx`,
  `${LINGUIST_DIR}/projects/ProjectAssetsSection.tsx`,
  `${LINGUIST_DIR}/projects/ProjectCard.tsx`,
  // ===== PB-111（备份 / 恢复 UI：新建即走 token，纳入防回归）=====
  `${LINGUIST_DIR}/projects/ProjectBackupsSection.tsx`,
] as const

/** raw palette 状态色 class 模式：色名 + 数字色阶（覆盖 text-/bg-/border- 等前缀与 /alpha 后缀） */
const RAW_PALETTE_PATTERN = /(?:amber|emerald|red|violet|green)-\d/

interface Exemption {
  file: string
  lineIncludes: string
  reason: string
}

/**
 * 行级豁免：语义不是「状态色」、刻意保留 raw palette 的行。
 * lineIncludes 必须在该行原文中唯一出现，防止误豁免其他行。
 */
const EXEMPTIONS: Exemption[] = [
  {
    file: `${AGENT_DIR}/ContentBlock.tsx`,
    lineIncludes: 'text-green-500">+{phrase.diffStats.additions}',
    reason: 'diff 新增行数 +N 的绿色是 diff 语义（仿 git diff 配色），不是状态色，PB-101 明确保留',
  },
  {
    file: `${AGENT_DIR}/ContentBlock.tsx`,
    lineIncludes: 'text-red-500">-{phrase.diffStats.deletions}',
    reason: 'diff 删除行数 -N 的红色是 diff 语义（仿 git diff 配色），不是状态色，PB-101 明确保留',
  },
  {
    file: `${AGENT_DIR}/tool-result-renderers/bash-result.tsx`,
    lineIncludes: 'text-green-400">$',
    reason: '终端 $ 提示符的绿色是 shell 配色惯例（装饰语义，配 zinc 终端底色），不是状态色',
  },
  // ===== PB-103 豁免 =====
  {
    file: `${AGENT_DIR}/mention-suggestions.tsx`,
    lineIncludes: 'text-emerald-500 flex-shrink-0',
    reason: 'MCP 服务 mention 的 Server 装饰图标色（装饰语义，非状态色），PB-103 豁免',
  },
  {
    file: `${AGENT_DIR}/mention-suggestions.tsx`,
    lineIncludes: 'text-violet-500 flex-shrink-0',
    reason: '技能 mention 的 Sparkles 装饰图标色（装饰语义，非状态色；violet 评审色归 PB-104），PB-103 豁免',
  },
  // ===== PB-102 豁免 =====
  {
    file: 'apps/electron/src/renderer/components/settings/StorageSettings.tsx',
    lineIncludes: `'bg-amber-500',`,
    reason: 'BAR_COLORS 存储分类条形图的数据可视化分类色（装饰，非状态语义），PB-102 豁免',
  },
  {
    file: 'apps/electron/src/renderer/components/settings/StorageSettings.tsx',
    lineIncludes: `'bg-emerald-500',`,
    reason: 'BAR_COLORS 存储分类条形图的数据可视化分类色（装饰，非状态语义），PB-102 豁免',
  },
  {
    file: 'apps/electron/src/renderer/components/settings/BotHubSettings.tsx',
    lineIncludes: `iconBgClass: 'bg-green-500/15',`,
    reason: '渠道装饰图标底色（品牌区分用，非状态语义），PB-102 豁免',
  },
  {
    file: 'apps/electron/src/renderer/components/agent-skills/SkillCard.tsx',
    lineIncludes: 'rounded-xl bg-amber-500/12 p-2 text-amber-500 shadow-sm shrink-0',
    reason: '技能卡片装饰图标 tile（非状态语义），PB-102 豁免',
  },
  {
    file: 'apps/electron/src/renderer/components/agent-skills/ImportSkillDialog.tsx',
    lineIncludes: 'rounded-xl bg-amber-500/12 p-2 text-amber-500 shadow-sm',
    reason: '导入对话框装饰图标 tile（非状态语义），PB-102 豁免',
  },
  {
    file: 'apps/electron/src/renderer/components/agent-skills/SkillDetailSheet.tsx',
    lineIncludes: 'rounded-xl bg-amber-500/12 p-2 text-amber-500 shadow-sm shrink-0',
    reason: '技能详情装饰图标 tile（非状态语义），PB-102 豁免',
  },
  // ===== PB-104 豁免 =====
  {
    file: `${LINGUIST_DIR}/projects/ProposalInbox.tsx`,
    lineIncludes: `part.kind === 'remove' && 'rounded-sm bg-red-500/10 text-red-600 line-through dark:text-red-400',`,
    reason: '提案 diff 删除部分的红色是 diff 增删语义（仿 git diff 配色，同 PB-101 ContentBlock diff 豁免），不是状态色，PB-104 明确保留',
  },
  {
    file: `${LINGUIST_DIR}/projects/ProposalInbox.tsx`,
    lineIncludes: `part.kind === 'insert' && 'rounded-sm bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',`,
    reason: '提案 diff 新增部分的绿色是 diff 增删语义（仿 git diff 配色，同 PB-101 ContentBlock diff 豁免），不是状态色，PB-104 明确保留',
  },
]

describe('no-raw-palette（PB-101/PB-102/PB-103/PB-104 迁移文件）', () => {
  for (const file of MIGRATED_FILES) {
    test(`${file} 不含 raw palette 状态色 class`, () => {
      const content = readFileSync(join(REPO_ROOT, file), 'utf8')
      const lines = content.split('\n')
      const violations: string[] = []

      lines.forEach((line, index) => {
        if (!RAW_PALETTE_PATTERN.test(line)) return
        const exemption = EXEMPTIONS.find(
          (e) => e.file === file && line.includes(e.lineIncludes),
        )
        if (!exemption) {
          violations.push(`  L${index + 1}: ${line.trim()}`)
        }
      })

      expect(violations).toEqual([])
    })
  }

  test('豁免条目仍然命中目标行（防止豁免失效后被静默扩大）', () => {
    for (const exemption of EXEMPTIONS) {
      const content = readFileSync(join(REPO_ROOT, exemption.file), 'utf8')
      const hitCount = content
        .split('\n')
        .filter((line) => line.includes(exemption.lineIncludes)).length
      expect(hitCount).toBe(1)
    }
  })
})
