import * as React from 'react'
import { expect, test } from 'bun:test'
import {
  DEFAULT_AGENT_HOST_CAPABILITIES,
  type PromaExtension,
} from './contracts'
import {
  linguistExtension,
  LINGUIST_AGENT_HOST_CAPABILITIES,
} from './linguist-extension'
import {
  createExtensionRegistry,
  getAgentSurfaceControls,
} from './extension-registry'

const linguistHostCapabilities = {
  references: true,
    companionChat: true,
  filePanel: false,
  preview: true,
  attachments: true,
  slashMenu: true,
  modelControls: true,
  queueAndSteer: true,
  permissions: true,
  fullPresentation: true,
} as const

test('静态扩展 registry 组合贡献，并让 Rail 按 capability 隐藏未实现入口', () => {
  const registry = createExtensionRegistry([
    {
      id: 'linguist',
      appModes: [{ id: 'linguist', mode: 'linguist', label: '本地化', icon: null }],
      agentProfiles: [{
        id: 'linguist-project',
        decodeProfile: (metadata) => metadata === 'linguist' ? { id: 'linguist' } : null,
        contributeTools: async (_context, baseTools) => baseTools,
        contributePromptLayers: async () => [],
        contributeSkills: async () => [],
        resolveExecutionScope: async () => null,
      }],
      settingsSections: [{ id: 'migration', label: '数据迁移', icon: null, modes: ['linguist'] }],
      hostCapabilityManifests: [{
        id: 'linguist-rail',
        presentation: 'linguist-rail',
        capabilities: linguistHostCapabilities,
      }],
    },
  ] satisfies readonly PromaExtension[])

  expect(registry.appModesFor('linguist').map((contribution) => contribution.id)).toEqual(['linguist'])
  expect(registry.agentProfiles.map((contribution) => contribution.id)).toEqual(['linguist-project'])
  expect(registry.settingsSections.map((contribution) => contribution.id)).toEqual(['migration'])

  const surface = registry.getAgentSurfaceContext({
    extensionId: 'linguist',
    sessionId: 'session-1',
    presentation: 'linguist-rail',
  })
  expect(surface?.hostCapabilities).toEqual(linguistHostCapabilities)
  expect(getAgentSurfaceControls(surface!.hostCapabilities)).toEqual({
    referenceAction: true,
    companionChatAction: true,
    filePanelEntry: false,
    canExpandToFull: true,
  })
})

test('静态扩展 registry 拒绝重复贡献 ID', () => {
  expect(() => createExtensionRegistry([
    { id: 'linguist', appModes: [{ id: 'linguist', mode: 'linguist', label: '本地化', icon: null }] },
    { id: 'linguist', appModes: [{ id: 'linguist-alt', mode: 'linguist', label: '重复', icon: null }] },
  ])).toThrow('重复 extension ID')
})

test('Host Parity canary: Linguist rail/full 登记所有 Proma 宿主能力键', () => {
  expect(Object.keys(LINGUIST_AGENT_HOST_CAPABILITIES).sort()).toEqual(
    Object.keys(DEFAULT_AGENT_HOST_CAPABILITIES).sort(),
  )
  expect(linguistExtension.hostCapabilityManifests?.map((manifest) => manifest.capabilities)).toEqual([
    LINGUIST_AGENT_HOST_CAPABILITIES,
    LINGUIST_AGENT_HOST_CAPABILITIES,
  ])
})

test('Linguist 侧栏通过共享会话行槽组合，不复制 Agent 行组件', () => {
  const sidebar = linguistExtension.appModes?.[0]?.renderSidebar?.({
    // React.memo 是 object 形式的 exotic component，确保 composition slot 不把它误判为空。
    SessionRowComponent: React.memo(() => null),
  })

  expect(React.isValidElement(sidebar)).toBe(true)
})
