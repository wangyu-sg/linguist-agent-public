import { describe, expect, test } from 'bun:test'
import type { LinguistProjectInfo, LinguistProjectSummary } from '@proma/shared'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ProjectResourceSettings,
  ProjectSettingsSheetBody,
} from './ProjectSettingsSheet'
import {
  ProjectDiagnosticsSettings,
  PromptStatusCard,
} from './ProjectDiagnosticsSettings'
import { ProjectMaintenanceSettings } from './ProjectMaintenanceSettings'
import { reduceArchiveDialogState } from './ProjectArchiveAction'

const project: LinguistProjectInfo = {
  schemaVersion: 1,
  id: 'prj-0000000000000001',
  name: '游戏本地化',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  promaWorkspaceId: 'workspace-1',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
}

const summary: LinguistProjectSummary = {
  project,
  assetCount: 0,
  totalSegments: 0,
  segmentCounts: {
    untranslated: 0,
    draft: 0,
    translated: 0,
    reviewed: 0,
  },
  currentStageCounts: { untouched: 0, draft: 0, confirmed: 0 },
  assets: [],
}

describe('ProjectSettingsSheet', () => {
  test('given 右侧设置浮窗 when 点击右上角关闭按钮 then 关闭按钮不能落入标题栏拖拽区', async () => {
    const source = await Bun.file(
      new URL('../../../components/ui/sheet.tsx', import.meta.url),
    ).text()
    const closeTag = source.match(/<SheetPrimitive\.Close[\s\S]*?>/)?.[0]

    expect(closeTag).toBeDefined()
    expect(closeTag).toContain('titlebar-no-drag')
  })

  test('given 已打开的项目 when 打开项目设置 then 显示项目元信息和语言资产分类入口', () => {
    const html = renderToStaticMarkup(
      <ProjectSettingsSheetBody
        project={project}
        summary={summary}
        onSummaryRefresh={() => undefined}
      />,
    )

    expect(html).toContain('游戏本地化')
    expect(html).toContain('en → zh-CN')
    expect(html).toContain('项目元信息')
    expect(html).toContain('语言资产')
    expect(html).toContain('维护')
    expect(html).toContain('诊断')
    const resourceTrigger = html.match(/<button[^>]*trigger-resources[^>]*>/)?.[0]
    expect(resourceTrigger).toBeDefined()
    expect(resourceTrigger).not.toContain('disabled=')
    const maintenanceTrigger = html.match(/<button[^>]*trigger-maintenance[^>]*>/)?.[0]
    expect(maintenanceTrigger).toBeDefined()
    expect(maintenanceTrigger).not.toContain('disabled=')
  })

  test('given 空项目 when 打开项目设置 then 可编辑语言方向；已有批次时明确冻结', () => {
    const editable = renderToStaticMarkup(
      <ProjectSettingsSheetBody
        project={project}
        summary={summary}
        onSummaryRefresh={() => undefined}
      />,
    )
    expect(editable).toContain('project-source-locale')
    expect(editable).toContain('project-target-locale')
    expect(editable).toContain('保存语言方向')

    const frozen = renderToStaticMarkup(
      <ProjectSettingsSheetBody
        project={project}
        summary={{ ...summary, assetCount: 1 }}
        onSummaryRefresh={() => undefined}
      />,
    )
    expect(frozen).toContain('已有批次，语言方向已冻结')
  })

  test('given Prompt 降级 when 渲染诊断状态 then 显示降级层和重新探测动作', () => {
    const html = renderToStaticMarkup(
      <>
        <PromptStatusCard
          prompt={{
            profileVersion: '1.0.0',
            profileHash: 'profile-hash',
            contractVersion: '1.0.0',
            contractHash: 'contract-hash',
            role: 'general',
            roleVersion: '1.0.0',
            roleHash: 'role-hash',
            projectDigestVersion: '1',
            projectDigestHash: 'project-digest-hash',
            projectDigestRevision: 'rev-1',
            projectDigestStatus: 'partial',
            promptHash: 'prompt-hash',
            degraded: true,
            fallbackLayers: ['role', 'project_digest'],
            retryable: true,
            renderer: 'xml',
            promptContractVersion: '1.0.0',
            promptContractHash: 'prompt-contract-hash',
            trimmedLayers: [
              { layer: 'project_digest', originalChars: 9000, finalChars: 7000, reason: 'global_budget' },
            ],
          }}
          loading={false}
          onRetry={() => undefined}
        />
        <ProjectDiagnosticsSettings projectId={project.id} />
      </>,
    )

    expect(html).toContain('Prompt 状态')
    expect(html).toContain('Prompt 已降级')
    expect(html).toContain('Role、Project Digest')
    expect(html).toContain('预算裁减 · Project Digest')
    expect(html).toContain('9000 → 7000 字符 · 总预算')
    expect(html).toContain('重新探测')
    expect(html).toContain('预览脱敏内容')
    expect(html).toContain('导出诊断包')
  })

  test('given 项目语言资产页 when 渲染 then 复用全部既有批次与语言资产管理能力', () => {
    const html = renderToStaticMarkup(
      <ProjectResourceSettings
        project={project}
        summary={summary}
        onSummaryRefresh={() => undefined}
      />,
    )

    expect(html).toContain('批次（文件）')
    expect(html).toContain('aria-label="刷新语言资产"')
    expect(html).toContain('导入批次')
    expect(html).toContain('整个文件夹可以让项目 Agent 直接导入')
    expect(html).toContain('TM / 术语库 / 句式管理')
    expect(html).toContain('Style Guide')
    expect(html).toContain('Voice Profiles')
    expect(html).toContain('Context Docs')
  })

  test('given 活跃项目 when 渲染维护页 then 删除入口要求先归档', () => {
    const html = renderToStaticMarkup(
      <ProjectMaintenanceSettings
        project={project}
        onSummaryRefresh={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('备份与恢复')
    expect(html).toContain('Full Integrity Scrub')
    expect(html).toContain('在独立 Worker 中逐项全量检查')
    expect(html).toContain('正在运行 Quick Health')
    expect(html).toContain('仅检查数据库可打开、项目清单、schema 与最多 20 个 source blob')
    expect(html).not.toContain('正在检查项目健康状态')
    expect(html).toContain('归档项目')
    expect(html).toContain('归档…')
    expect(html).toContain('删除项目')
    expect(html).toContain('请先归档项目')
    expect(html).toMatch(/<button[^>]*disabled[^>]*title="请先归档项目"/)
  })

  test('given 已归档项目 when 渲染维护页 then 归档动作保持禁用的只读语义', () => {
    const html = renderToStaticMarkup(
      <ProjectMaintenanceSettings
        project={{ ...project, archivedAt: '2026-07-02T08:00:00.000Z' }}
        onSummaryRefresh={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('该项目已归档，数据以只读方式保留。')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*已归档/s)
    expect(html).toContain('仅 CAT 项目目录会移入本地可恢复删除区（受管 Trash）')
    expect(html).toContain('历史 Agent Session 及其工作目录默认保留')
    expect(html).toContain('不会一并移入')
    expect(html).toMatch(/<button[^>]*title="删除项目"[^>]*>.*删除…/s)
  })

  test('given 已请求归档确认 when 用户取消 then 清除待归档项目且不进入归档中状态', () => {
    const requested = reduceArchiveDialogState(
      { project: null, archiving: false },
      { type: 'request', project },
    )

    expect(reduceArchiveDialogState(requested, 'cancel')).toEqual({ project: null, archiving: false })
  })
})
