import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LinguistProjectInfo } from '@proma/shared'
import {
  buildLinguistWorkspaceMap,
  LinguistWorkspaceBadge,
} from './LinguistWorkspaceBadge'
import type { LinguistProjectListState } from './project-list-atoms'

function makeProject(id: string, promaWorkspaceId: string): LinguistProjectInfo {
  return {
    schemaVersion: 1,
    id,
    name: `项目 ${id}`,
    sourceLocale: 'en',
    targetLocale: 'zh-CN',
    promaWorkspaceId,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  }
}

describe('LinguistWorkspaceBadge', () => {
  test('given 项目列表就绪 when 构建映射 then 同一 Workspace 只出现一次且渲染 Linguist 标记', () => {
    const state: LinguistProjectListState = {
      status: 'ready',
      projects: [
        makeProject('p1', 'ws-1'),
        makeProject('p1-duplicate', 'ws-1'),
        makeProject('p2', 'ws-2'),
      ],
    }

    const map = buildLinguistWorkspaceMap(state)

    expect(map.size).toBe(2)
    expect(map.get('ws-1')?.id).toBe('p1')

    const html = renderToStaticMarkup(<LinguistWorkspaceBadge />)
    expect(html).toContain('Linguist')
  })

  test('given 项目列表未就绪或失败 when 构建映射 then 降级为空映射不显示徽章', () => {
    expect(buildLinguistWorkspaceMap({ status: 'loading' }).size).toBe(0)
    expect(buildLinguistWorkspaceMap({ status: 'error', message: 'x' }).size).toBe(0)
  })
})
