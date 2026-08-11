import { describe, expect, test } from 'bun:test'
import { Provider } from 'jotai'
import { createStore } from 'jotai/vanilla'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentSessionMeta, LinguistProjectInfo } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { projectCurrentAgentSessionIdMapAtom } from '@/atoms/tab-atoms'
import { sessionHoverPreviewEnabledAtom } from '@/atoms/ui-preferences'
import {
  areProjectSessionRenderInputsEqual,
  LinguistSidebarContentView,
  moveProjectId,
  registerCreatedProjectSession,
  selectProjectAgentSession,
  type SharedProjectSessionRowProps,
} from './LinguistSidebarContent'

function TestSessionRow({
  session,
  active,
  workspaceName,
  transferLabel,
  historyOnlyActions,
  delegationSummary,
  disableMiniMap,
  onSelect,
}: SharedProjectSessionRowProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={`选择会话 ${session.title}`}
      aria-current={active || undefined}
      data-history-only={historyOnlyActions || undefined}
      data-minimap-disabled={disableMiniMap || undefined}
      onClick={() => onSelect(session.id, session.title)}
    >
      {session.title}
      {workspaceName && <span>{workspaceName}</span>}
      {transferLabel && <span>{transferLabel}</span>}
      {delegationSummary && (
        <span data-delegation-count={delegationSummary.total} />
      )}
      <span aria-label={`管理会话 ${session.title}`} />
    </button>
  )
}

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
    linguistProjectId: projectId,
    linguistProjectName: `项目 ${projectId}`,
    archived,
    createdAt: 1,
    updatedAt: Date.now(),
  }
}

describe('LinguistSidebarContent', () => {
  test('given 一个项目的 Session 状态变化 when 比较其他项目行输入 then 不重渲染整个项目树', async () => {
    const alpha = session('alpha-current', 'alpha')
    const beta = session('beta-current', 'beta')
    const previousIndicators = new Map([
      [beta.id, 'running' as const],
    ])
    const nextIndicators = new Map([
      [beta.id, 'blocked' as const],
    ])

    expect(areProjectSessionRenderInputsEqual(
      [alpha],
      [alpha],
      previousIndicators,
      nextIndicators,
    )).toBeTrue()
    expect(areProjectSessionRenderInputsEqual(
      [beta],
      [beta],
      previousIndicators,
      nextIndicators,
    )).toBeFalse()
    expect(areProjectSessionRenderInputsEqual(
      [alpha],
      [{ ...alpha, title: '已更新' }],
      previousIndicators,
      previousIndicators,
    )).toBeFalse()

    const source = await Bun.file(new URL('./LinguistSidebarContent.tsx', import.meta.url)).text()
    expect(source).toContain('React.memo(ProjectRowView, areProjectRowPropsEqual)')
    expect(source).toContain('React.memo(SessionTreeRowsView, areSessionTreeRowsPropsEqual)')
    expect(source).toContain('onSelectSession={handleSelectSession}')
    expect(source).toContain('onCreateSession={handleCreateSession}')
    expect(source).toContain('onRenameSession={handleRenameSession}')
    expect(source).toContain('onCopySession={handleCopySession}')
    expect(source).toContain('onDeleteSession={handleDeleteSession}')
  })

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

  test('given Linguist 侧栏 when 渲染 then 标题栏提供创建且底部只有统一归档入口', () => {
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('active')] }}
        onRetry={() => {}}
        onOpenProject={() => {}}
        onCreateProject={() => {}}
      />,
    )

    expect(html).toContain('aria-label="新建本地化项目"')
    expect(html).toContain('px-2 pb-1 pt-2')
    expect(html).toContain('text-foreground/40')
    expect(html).toContain('已归档')
    expect(html).not.toContain('管理项目</')
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
        activeProjectId="alpha"
        onRetry={() => {}}
        onOpenProject={() => {}}
        SessionRowComponent={TestSessionRow}
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
        SessionRowComponent={TestSessionRow}
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
    expect(html).toContain('复制到其他项目')
    expect(html).not.toContain('迁移到其他项目')
  })

  test('given 置顶母会话含未置顶委派子会话 when 渲染 then 置顶区保留子树且项目组不重复', () => {
    const root = session('root', 'alpha')
    root.pinned = true
    const child = session('child', 'alpha')
    child.parentSessionId = root.id
    child.sourceDelegationId = 'delegation-1'
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('alpha')] }}
        sessions={[root, child]}
        onRetry={() => {}}
        onOpenProject={() => {}}
        SessionRowComponent={TestSessionRow}
      />,
    )

    expect(html.match(/会话 root/g)?.length).toBe(3)
    expect(html).toContain('data-delegation-count="1"')
    expect(html).not.toContain('会话 child')
  })

  test('given 只委派 Reviewer when 展开子会话 then 显示审校岗位且不虚构翻译/校对', () => {
    const root = session('root', 'alpha')
    const child = session('child', 'alpha')
    child.parentSessionId = root.id
    child.sourceDelegationId = 'delegation-1'
    child.linguistRole = 'reviewer'
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('alpha')] }}
        sessions={[root, child]}
        activeProjectId="alpha"
        currentSessionIds={new Map([['alpha', child.id]])}
        onRetry={() => {}}
        onOpenProject={() => {}}
        SessionRowComponent={TestSessionRow}
      />,
    )

    expect(html).toContain('会话 child')
    expect(html).toContain('审校')
    expect(html).not.toContain('翻译')
    expect(html).not.toContain('校对')
    // 通用 Proma delegation 标签不得冒充本地化岗位
    expect(html).not.toContain('review')
    expect(html).not.toContain('custom')
  })

  test('given General 完整委派一轮 when 展开 then 三岗位按真实委派各显示一次', () => {
    const root = session('root', 'alpha')
    const roles = ['translator', 'reviewer', 'proofreader'] as const
    const children = roles.map((role, index) => {
      const child = session(`child-${role}`, 'alpha')
      child.parentSessionId = root.id
      child.sourceDelegationId = `delegation-${index}`
      child.linguistRole = role
      child.createdAt = index + 1
      return child
    })
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('alpha')] }}
        sessions={[root, ...children]}
        activeProjectId="alpha"
        currentSessionIds={new Map([['alpha', children[0]!.id]])}
        onRetry={() => {}}
        onOpenProject={() => {}}
        SessionRowComponent={TestSessionRow}
      />,
    )

    expect(html).toContain('翻译')
    expect(html).toContain('审校')
    expect(html).toContain('校对')
    expect(html).toContain('data-delegation-count="3"')
  })

  test('given 三天外空闲会话和阻塞会话 when 渲染项目预览 then 只保留阻塞会话', () => {
    const now = 10 * 86_400_000
    const oldIdle = session('old-idle', 'alpha')
    oldIdle.updatedAt = 1
    const blocked = session('blocked', 'alpha')
    blocked.updatedAt = 1
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{ status: 'ready', projects: [project('alpha')] }}
        sessions={[oldIdle, blocked]}
        indicatorMap={new Map([['blocked', 'blocked']])}
        relativeTimeNow={now}
        onRetry={() => {}}
        onOpenProject={() => {}}
        SessionRowComponent={TestSessionRow}
      />,
    )

    expect(html).not.toContain('会话 old-idle')
    expect(html).toContain('会话 blocked')
  })

  test('given 用户关闭会话悬浮预览 when 渲染 Linguist 会话行 then 原生 Agent 行收到同一禁用偏好', () => {
    const store = createStore()
    store.set(sessionHoverPreviewEnabledAtom, false)
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <LinguistSidebarContentView
          state={{ status: 'ready', projects: [project('alpha')] }}
          sessions={[session('alpha-current', 'alpha')]}
          onRetry={() => {}}
          onOpenProject={() => {}}
          SessionRowComponent={TestSessionRow}
        />
      </Provider>,
    )

    expect(html).toContain('data-minimap-disabled="true"')
  })

  test('given 活跃项目顺序 when 键盘上移或下移 then 复用不可变排序结果', () => {
    expect(moveProjectId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveProjectId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveProjectId(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
  })

  test('given 归档会话、归档项目和缺失项目 when 打开统一归档入口 then 分组三类只读历史', () => {
    const missing = session('missing-session', 'missing')
    missing.linguistProjectName = '已删除项目'
    const html = renderToStaticMarkup(
      <LinguistSidebarContentView
        state={{
          status: 'ready',
          projects: [project('active'), project('archived', true)],
        }}
        archiveView
        sessions={[
          session('active-archived', 'active', true),
          session('archived-project-session', 'archived'),
          missing,
        ]}
        onRetry={() => {}}
        onOpenProject={() => {}}
        SessionRowComponent={TestSessionRow}
        onSelectSession={() => {}}
      />,
    )

    expect(html).toContain('活跃项目中的已归档会话')
    expect(html).toContain('已归档项目')
    expect(html).toContain('缺失或已删除的项目')
    expect(html).toContain('已删除项目')
    expect(html).toContain('data-history-only="true"')
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
