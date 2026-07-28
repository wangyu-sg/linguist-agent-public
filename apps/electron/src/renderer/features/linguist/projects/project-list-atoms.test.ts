import { afterEach, describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { LinguistProjectInfo, LinguistProjectListResult, LinguistIpcResult } from '@proma/shared'
import {
  linguistProjectListStateAtom,
  refreshLinguistProjectListAtom,
} from './project-list-atoms'

const originalWindow = globalThis.window

function project(id: string): LinguistProjectInfo {
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
  }
}

function installProjectList(
  listProjects: () => Promise<LinguistIpcResult<LinguistProjectListResult>>,
): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: { linguistProjectsList: listProjects },
    } as unknown as Window & typeof globalThis,
  })
}

async function waitForState(
  store: ReturnType<typeof createStore>,
  status: 'ready' | 'error',
): Promise<void> {
  await new Promise<void>((resolve) => {
    const unsubscribe = store.sub(linguistProjectListStateAtom, () => {
      if (store.get(linguistProjectListStateAtom).status === status) {
        unsubscribe()
        resolve()
      }
    })
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

describe('共享项目列表资源', () => {
  test('given 两个消费者同时读取 when 首次加载 then 只请求一次并共享结果', async () => {
    let calls = 0
    installProjectList(async () => {
      calls += 1
      return { ok: true, data: [project('project-1')] }
    })
    const store = createStore()

    expect(store.get(linguistProjectListStateAtom)).toEqual({ status: 'loading' })
    expect(store.get(linguistProjectListStateAtom)).toEqual({ status: 'loading' })
    await waitForState(store, 'ready')

    expect(calls).toBe(1)
    expect(store.get(linguistProjectListStateAtom)).toEqual({
      status: 'ready',
      projects: [project('project-1')],
    })
  })

  test('given 已缓存列表 when 显式刷新 then 用新结果替换共享缓存', async () => {
    let revision = 0
    installProjectList(async () => {
      revision += 1
      return { ok: true, data: [project(`project-${revision}`)] }
    })
    const store = createStore()

    void store.get(linguistProjectListStateAtom)
    await waitForState(store, 'ready')
    store.set(refreshLinguistProjectListAtom)
    await waitForState(store, 'ready')

    expect(revision).toBe(2)
    expect(store.get(linguistProjectListStateAtom)).toEqual({
      status: 'ready',
      projects: [project('project-2')],
    })
  })

  test('given 主进程返回错误 when 加载项目 then 共享错误状态可被重试替换', async () => {
    let succeed = false
    installProjectList(async () => (
      succeed
        ? { ok: true, data: [project('project-1')] }
        : { ok: false, error: { code: 'INTERNAL', message: 'temporary' } }
    ))
    const store = createStore()

    void store.get(linguistProjectListStateAtom)
    await waitForState(store, 'error')
    expect(store.get(linguistProjectListStateAtom)).toEqual({
      status: 'error',
      message: '发生内部错误，请重试（INTERNAL）',
    })

    succeed = true
    store.set(refreshLinguistProjectListAtom)
    await waitForState(store, 'ready')
    expect(store.get(linguistProjectListStateAtom).status).toBe('ready')
  })
})
