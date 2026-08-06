import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { electronMock, resetElectronMock } from '../test/electron-mock'
import { readFixture } from './test/service-testkit'

type AgentServiceModule = typeof import('../agent-service')
type AgentSessionManagerModule = typeof import('../agent-session-manager')
type SessionBindingModule = typeof import('./session-binding')
type ProjectServiceModule = typeof import('./project-service')

let tempHome: string
let agentService: AgentServiceModule
let sessionManager: AgentSessionManagerModule
let sessionBinding: SessionBindingModule
let projectService: ProjectServiceModule

const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => electronMock)
mock.module('node:os', () => ({ ...os, homedir: () => tempHome }))

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'linguist-agent-intake-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  resetElectronMock()

  projectService = await import('./project-service')
  projectService.initLinguistProjectService()
  sessionManager = await import('../agent-session-manager')
  sessionBinding = await import('./session-binding')
  agentService = await import('../agent-service')
})

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalPromaDev === undefined) delete process.env.PROMA_DEV
  else process.env.PROMA_DEV = originalPromaDev
  rmSync(tempHome, { recursive: true, force: true })
})

describe('Linguist 会话附件到 CAT Intake', () => {
  test('Given 当前绑定会话通过纸夹保存文件 When 保存完成 Then 文件登记为该会话的 Intake 授权来源', async () => {
    const service = projectService.getLinguistProjectService()
    const project = service.createProject({
      name: '会话附件 Intake',
      sourceLocale: 'en',
      targetLocale: 'zh-CN',
    })
    const session = sessionBinding.createLinguistProjectChatSession(service, { projectId: project.id })

    const saved = agentService.saveFilesToAgentSession({
      sessionId: session.id,
      files: [{
        filename: 'mini-items.json',
        data: Buffer.from(readFixture('mini_items.json')).toString('base64'),
      }],
    })

    expect(saved).toHaveLength(1)
    const savedFile = saved[0]!
    const stored = sessionManager.getAgentSessionMeta(session.id)
    expect(stored?.attachedFiles).toEqual([savedFile.targetPath])
  })
})
