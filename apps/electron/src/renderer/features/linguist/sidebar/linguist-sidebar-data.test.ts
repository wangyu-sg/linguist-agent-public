import { expect, test } from 'bun:test'
import type { AgentSessionMeta, LinguistProjectInfo } from '@proma/shared'
import { buildLinguistSidebarGroups } from './linguist-sidebar-data'

test('共享侧栏投影隔离普通 Agent、置顶/自动会话，并保留归档和缺失项目历史', () => {
  const projects = [
    { id: 'active', name: '活跃', createdAt: '2026-09-16', updatedAt: '2026-09-16' },
    { id: 'archived', name: '归档', createdAt: '2026-09-16', updatedAt: '2026-09-16', archivedAt: '2026-09-16' },
  ] as LinguistProjectInfo[]
  const sessions: AgentSessionMeta[] = [
    {id:'ordinary'}, {id:'visible',linguistProjectId:'active'},
    {id:'pinned',linguistProjectId:'active',pinned:true},
    {id:'auto',linguistProjectId:'active',sourceAutomationId:'job'},
    {id:'old',linguistProjectId:'active',archived:true},
    {id:'project-history',linguistProjectId:'archived'},
    {id:'missing',linguistProjectId:'missing',linguistProjectName:'旧项目'},
  ].map(item => ({ title:item.id,createdAt:1,updatedAt:1,...item }))
  const active = buildLinguistSidebarGroups(projects,sessions,false)
  expect(active.map(group=>group.workspace.id)).toEqual(['active'])
  expect(active[0]?.sessions.map(session=>session.id)).toEqual(['visible'])
  const archived = buildLinguistSidebarGroups(projects,sessions,true)
  expect(archived.map(group=>group.sessions.map(session=>session.id))).toEqual([['old'],['project-history'],['missing']])
  expect(archived.map(group=>group.historyOnly)).toEqual([false,true,true])
})
