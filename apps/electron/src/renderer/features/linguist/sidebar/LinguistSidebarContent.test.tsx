import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai/vanilla'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSessionMeta, LinguistProjectInfo } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/tab-atoms'
import {
  LinguistSidebarContentView,
  registerCreatedProjectSession,
  selectProjectAgentSession,
} from './LinguistSidebarContent'

function project(id: string, archived = false): LinguistProjectInfo {
  return {
    schemaVersion: 1,
    id,
    name: `项目 ${id}`,
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId: 'workspace-1',
    createdAt: '2026-07-01T08:00:00.000Z',
    updatedAt: '2026-07-01T08:00:00.000Z',
    qualityProfile: 'balanced',
    archivedAt: archived ? '2026-07-02T08:00:00.000Z' : undefined,
  }
}

function session(
  id: string,
  projectId: string,
  archived = false,
): AgentSessionMeta {
  return {
    id,
    title: `会话 ${id}`,
    agentRuntime: 'pi',
    linguistProjectId: projectId,
    linguistProjectName: `项目 ${projectId}`,
    archived,
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('LinguistSidebarContent', () => {
  test('given 项目列表加载中 when 渲染侧栏 then 提供可访问加载状态', () => {
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'loading' }}
        onRetry={() => {}}
        onOpenProject={() => {}}
      />,
    )

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('正在加载本地化项目')
  })

  test('given 项目加载失败 when 渲染侧栏 then 展示错误与重试入口', () => {
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'error', message: '网络不可用' }}
        onRetry={() => {}}
        onOpenProject={() => {}}
      />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('网络不可用')
    expect(html).toContain('重新加载')
  })

  test('given 仅有归档项目 when 渲染侧栏 then 日常项目列表显示空态', () => {
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('archived', true)] }}
        onRetry={() => {}}
        onOpenProject={() => {}}
      />,
    )

    expect(html).toContain('暂无本地化项目')
    expect(html).not.toContain('项目 archived')
  })

  test('given 活跃与归档项目 when 渲染侧栏 then 只列出活跃项目及语言对', () => {
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('active'), project('archived', true)] }}
        onRetry={() => {}}
        activeProjectId="active"
        onOpenProject={() => {}}
      />,
    )

    expect(html).toContain('<button')
    expect(html).toContain('aria-label="打开项目 项目 active"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('项目 active')
    expect(html).toContain('en')
    expect(html).toContain('zh-CN')
    expect(html).not.toContain('项目 archived')
  })

  test('given Linguist 侧栏 when 渲染 then 提供当前状态可见的项目管理次级入口', () => {
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('active')] }}
        onRetry={() => {}}
        onOpenProject={() => {}}
        onOpenProjectManagement={() => {}}
        projectManagementActive
      />,
    )

    expect(html).toContain('aria-label="管理项目"')
    expect(html).toContain('aria-current="page"')
  })

  test('given 多项目原生 Agent 会话 when 渲染侧栏 then 项目下只显示自身未归档会话和新建入口', () => {
    const ordinarySession: AgentSessionMeta = {
      id: 'ordinary',
      title: '普通 Agent 会话',
      createdAt: 1,
      updatedAt: 2,
    }
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('alpha'), project('beta')] }}
        sessions={[
          session('alpha-current', 'alpha'),
          session('alpha-archived', 'alpha', true),
          session('beta-current', 'beta'),
          ordinarySession,
        ]}
        currentSessionIds={new Map([['alpha', 'alpha-current']])}
        onRetry={() => {}}
        onOpenProject={() => {}}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
      />,
    )

    expect(html).toContain('会话 alpha-current')
    expect(html).toContain('会话 beta-current')
    expect(html).not.toContain('会话 alpha-archived')
    expect(html).not.toContain('普通 Agent 会话')
    expect(html).toContain('aria-label="选择会话 会话 alpha-current"')
    expect(html).toContain('aria-current="true"')
    expect(html).toContain('aria-label="在项目 项目 alpha 中新建会话"')
    expect(html).toContain('aria-label="在项目 项目 beta 中新建会话"')
  })

  test('given Linguist 项目与会话 when 渲染侧栏 then 右键之外还有可聚焦的独立动作菜单', () => {
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('alpha')] }}
        sessions={[session('alpha-current', 'alpha')]}
        onRetry={() => {}}
        onOpenProject={() => {}}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
        onOpenProjectSettings={() => {}}
        onRenameSession={() => {}}
        onTogglePinSession={() => {}}
        onToggleArchiveSession={() => {}}
        onDeleteSession={() => {}}
      />,
    )

    expect(html).toContain('aria-label="管理项目 项目 alpha"')
    expect(html).toContain('aria-label="管理会话 会话 alpha-current"')
    expect(html).not.toContain('迁移到其他项目')
  })

  test('given 项目会话操作失败 when 渲染侧栏 then 错误在对应项目下可见', () => {
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('alpha')] }}
        sessions={[]}
        sessionError={{ projectId: 'alpha', message: '创建失败' }}
        onRetry={() => {}}
        onOpenProject={() => {}}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
      />,
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('创建失败')
  })

  test('given 已有两个项目选择 when 选择或创建项目会话 then 只更新目标项目并复用原生 Agent 列表', () => {
    const store = createStore()
    const alpha = session('alpha-current', 'alpha')
    const betaCurrent = session('beta-current', 'beta')
    store.set(agentSessionsAtom, [alpha, betaCurrent])
    store.set(projectCurrentAgentSessionIdMapAtom, new Map([
      ['alpha', alpha.id],
      ['beta', 'beta-old'],
    ]))

    selectProjectAgentSession(store, 'beta', 'beta-current')
    expect(store.get(projectCurrentAgentSessionIdMapAtom)).toEqual(new Map([
      ['alpha', alpha.id],
      ['beta', 'beta-current'],
    ]))

    const betaNew = session('beta-new', 'beta')
    registerCreatedProjectSession(store, 'beta', betaNew)
    expect(store.get(agentSessionsAtom).map((item) => item.id)).toEqual([
      'beta-new',
      'alpha-current',
      'beta-current',
    ])
    expect(store.get(projectCurrentAgentSessionIdMapAtom).get('beta')).toBe('beta-new')
  })
})
