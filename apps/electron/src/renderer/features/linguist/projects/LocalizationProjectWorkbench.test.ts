import { describe, expect, test } from 'bun:test'
import type {
  LinguistIpcResult,
  LinguistProjectInfo,
  LinguistProjectOpenRequest,
  LinguistProjectOpenResult,
} from '@proma/shared'
import {
  loadLocalizationProjectSummary,
  loadLocalizationProjectWorkbench,
} from './LocalizationProjectWorkbench'

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

const openedProject: LinguistIpcResult<LinguistProjectOpenResult> = {
  ok: true,
  data: {
    project,
    health: {
      projectId: 'prj-0000000000000001',
      healthy: true,
      checkedAt: '2026-07-01T08:00:00.000Z',
      checks: [],
    },
  },
}

describe('LocalizationProjectWorkbench', () => {
  test('given 冷启动恢复的正常 Project Tab when 工作台挂载 then 先打开项目再进入 CAT 工作区', async () => {
    const requests: LinguistProjectOpenRequest[] = []

    const state = await loadLocalizationProjectWorkbench(
      'prj-0000000000000001',
      async (request) => {
        requests.push(request)
        return openedProject
      },
    )

    expect(requests).toEqual([{ projectId: 'prj-0000000000000001' }])
    expect(state).toEqual({
      status: 'ready',
      project,
    })
  })

  test('given 主进程拒绝打开 when 工作台挂载 then 保留类型化错误供恢复界面展示', async () => {
    const state = await loadLocalizationProjectWorkbench(
      project.id,
      async () => ({
        ok: false,
        error: { code: 'PROJECT_NOT_FOUND', message: 'missing' },
      }),
    )

    expect(state).toEqual({
      status: 'error',
      error: { code: 'PROJECT_NOT_FOUND', message: 'missing' },
    })
  })

  test('given 项目摘要可用 when 工作台加载统计 then 返回真实计数', async () => {
    const state = await loadLocalizationProjectSummary(project.id, async () => ({
      ok: true,
      data: {
        project,
        assetCount: 0,
        totalSegments: 12,
        segmentCounts: {
          untranslated: 2,
          draft: 3,
          translated: 2,
          reviewed: 5,
        },
        currentStageCounts: { untouched: 2, draft: 3, confirmed: 7 },
        assets: [],
      },
    }))

    expect(state).toEqual({
      status: 'ready',
      summary: {
        project,
        assetCount: 0,
        totalSegments: 12,
        segmentCounts: {
          untranslated: 2,
          draft: 3,
          translated: 2,
          reviewed: 5,
        },
        currentStageCounts: { untouched: 2, draft: 3, confirmed: 7 },
        assets: [],
      },
    })
  })

  test('given 项目摘要调用异常 when 工作台加载统计 then 降级为统计不可用', async () => {
    expect(await loadLocalizationProjectSummary(project.id, async () => {
      throw new Error('offline')
    })).toEqual({ status: 'error' })
  })
})
