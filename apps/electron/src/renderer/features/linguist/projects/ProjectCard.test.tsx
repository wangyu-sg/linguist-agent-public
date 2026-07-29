import { describe, expect, test } from 'bun:test'
import type { LinguistProjectInfo } from '@proma/shared'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProjectCard } from './ProjectCard'

const project: LinguistProjectInfo = {
  schemaVersion: 1,
  id: 'prj-0000000000000001',
  name: '游戏本地化',
  sourceLocale: 'en',
  targetLocale: 'zh-CN',
  promaWorkspaceId: 'workspace-1',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:00:00.000Z',
  qualityProfile: 'balanced',
}

describe('ProjectCard', () => {
  test('given 活跃项目 when 渲染管理卡片 then 提供打开、设置和归档入口', () => {
    const html = renderToStaticMarkup(
      <ProjectCard
        project={project}
        summaryState={{ status: 'loading' }}
        health={undefined}
        onOpen={() => undefined}
        onSettings={() => undefined}
        onArchive={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="打开项目 游戏本地化"')
    expect(html).toContain('aria-label="打开 游戏本地化"')
    expect(html).toContain('aria-label="设置 游戏本地化"')
    expect(html).toContain('aria-label="归档 游戏本地化"')
    expect(html).not.toContain('role="button"')
  })

  test('given 已归档项目 when 渲染管理卡片 then 保留打开和设置入口但不重复提供归档动作', () => {
    const html = renderToStaticMarkup(
      <ProjectCard
        project={{ ...project, archivedAt: '2026-07-02T08:00:00.000Z' }}
        summaryState={{ status: 'error' }}
        health={undefined}
        onOpen={() => undefined}
        onSettings={() => undefined}
        onArchive={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="打开 游戏本地化"')
    expect(html).toContain('aria-label="设置 游戏本地化"')
    expect(html).not.toContain('aria-label="归档 游戏本地化"')
  })

  test('given 健康检查失败 when 渲染管理卡片 then 直接显示可读健康状态', () => {
    const html = renderToStaticMarkup(
      <ProjectCard
        project={project}
        summaryState={{ status: 'loading' }}
        health={{
          kind: 'quick',
          projectId: project.id,
          healthy: false,
          checkedAt: '2026-07-02T08:00:00.000Z',
          checks: [{ id: 'cat_db_open', ok: false, scope: 'complete', detail: 'STORE_NOT_FOUND' }],
        }}
        onOpen={() => undefined}
        onSettings={() => undefined}
        onArchive={() => undefined}
      />,
    )

    expect(html).toContain('需要修复')
    expect(html).toContain('失败检查')
    expect(html).toContain('STORE_NOT_FOUND')
  })
})
