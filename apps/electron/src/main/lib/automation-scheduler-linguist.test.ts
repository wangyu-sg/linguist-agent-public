import { expect, mock, test } from 'bun:test'
import type { AgentSessionMeta, Automation, AutomationRun } from '@proma/shared'
import type { AgentSessionLinguistBinding } from './agent-session-manager'

const sessions = new Map<string, AgentSessionMeta>()
const jobs = new Map<string, Automation>()
const runs: AutomationRun[] = []
const starts: Array<{ sessionId: string; context: unknown }> = []
let finish: (() => void) | undefined
let hold = false
let tick: (() => void) | undefined
mock.module('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
mock.module('./agent-session-manager', () => ({
  getAgentSessionMeta: (id: string) => sessions.get(id),
  createAgentSession: (title: string, channelId: string, workspaceId: string, modelId: string, _cwd: unknown, _layout: unknown, binding?: AgentSessionLinguistBinding) => {
    const session: AgentSessionMeta = { id: `session-${sessions.size}`, title, channelId, workspaceId, modelId, createdAt: Date.now(), updatedAt: Date.now(), ...binding }
    sessions.set(session.id, session)
    return session
  },
  updateAgentSessionMeta: (id: string, patch: Partial<AgentSessionMeta>) => Object.assign(sessions.get(id)!, patch),
}))
mock.module('./automation-manager', () => ({
  listAutomations: () => [...jobs.values()], getAutomation: (id: string) => jobs.get(id),
  updateAutomation: ({ id, ...patch }: Partial<Automation> & { id: string }) => Object.assign(jobs.get(id)!, patch),
  appendRun: (id: string, run: AutomationRun) => { runs.push(run); jobs.get(id)!.lastRunAt = run.runAt },
  setLastSessionId: (id: string, value: string) => { jobs.get(id)!.lastSessionId = value },
  setNextRunAt: (id: string, value: number) => { jobs.get(id)!.nextRunAt = value },
  computeNextRunAt: (_job: Automation, now: number) => now + 60000,
}))
mock.module('./agent-session-usage', () => ({ getSessionContextUsageRatio: () => 0.1 }))
mock.module('./automation-notification-service', () => ({ notifyAutomationRunFinished: async () => {} }))
mock.module('./linguist/project-service', () => ({ getLinguistProjectService: () => ({ getProject: (id: string) => ({ id, name: '测试项目', promaWorkspaceId: 'workspace' }) }) }))
mock.module('./agent-service', () => ({
  isAgentSessionActive: () => false,
  runAgentHeadless: async (input: { sessionId: string }, callbacks: { onComplete: () => void }, extensions: { automationLinguistContext?: unknown }) => {
    starts.push({ sessionId: input.sessionId, context: extensions.automationLinguistContext })
    finish = callbacks.onComplete
    if (!hold) callbacks.onComplete()
  },
}))
const { runAutomationNow, runAutomation, startScheduler, stopScheduler } = await import('./automation-scheduler')

test('同一调度器保留来源删除后的领域快照，正确新建、复用、跨日与到期运行', async () => {
  const job = {
    id: 'job', name: '测试', prompt: '仅查看摘要', workspaceId: 'workspace', channelId: 'channel',
    modelId: 'model', sourceSessionId: 'deleted-origin', active: true, intervalMinutes: 60,
    sessionMode: 'reuse', scheduleType: 'interval', runHistory: [], nextRunAt: 0, createdAt: 1, updatedAt: 1,
    linguistContext: { projectId: 'project', role: 'general', scope: { kind: 'asset', assetId: 'asset' }, capturedAt: '2026-09-16T00:00:00Z' },
  } satisfies Automation
  jobs.set(job.id, job)
  await runAutomationNow(job.id)
  const firstId = starts.at(-1)!.sessionId
  expect(sessions.get(firstId)).toMatchObject({ sourceAutomationId: job.id, linguistProjectId: 'project', linguistRole: 'general' })
  expect(sessions.get(firstId)?.sourceDelegationId).toBeUndefined()
  expect(starts.at(-1)?.context).toEqual(job.linguistContext)
  await runAutomationNow(job.id)
  expect(starts.at(-1)?.sessionId).toBe(firstId)
  const current = jobs.get(job.id)!
  current.sessionMode = 'daily'
  current.lastRunAt = Date.now() - 86400000
  await runAutomation(current)
  expect(starts.at(-1)?.sessionId).not.toBe(firstId)
  const daily = starts.at(-1)!.sessionId
  await runAutomation(current)
  expect(starts.at(-1)?.sessionId).toBe(daily)
  current.linguistContext = { ...current.linguistContext!, role: 'reviewer' }
  await runAutomation(current)
  expect(starts.at(-1)?.sessionId).not.toBe(daily)

  hold = true
  const frozen = structuredClone(current.linguistContext)
  const running = runAutomation(current)
  current.linguistContext = undefined
  current.workspaceId = 'other-workspace'
  finish!()
  await running
  expect(runs.at(-1)?.linguistContext).toEqual(frozen)
  hold = false
  await runAutomationNow(job.id)
  expect(starts.at(-1)?.context).toBeUndefined()
  expect(sessions.get(starts.at(-1)!.sessionId)?.linguistProjectId).toBeUndefined()

  const originalInterval = globalThis.setInterval
  globalThis.setInterval = ((callback: () => void) => { tick = callback; return 1 }) as unknown as typeof setInterval
  try {
    current.nextRunAt = 0
    startScheduler()
    expect(current.nextRunAt).toBeGreaterThan(Date.now())
    const count = starts.length
    tick!()
    expect(starts).toHaveLength(count)
    current.nextRunAt = 0
    tick!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(starts).toHaveLength(count + 1)
  } finally { stopScheduler(); globalThis.setInterval = originalInterval }
})
