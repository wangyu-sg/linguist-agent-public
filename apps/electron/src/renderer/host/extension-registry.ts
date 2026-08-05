import type { PrimaryAppMode } from '@/atoms/app-mode'
import type {
  AgentHostCapabilities,
  AgentSurfaceContext,
  AgentSurfacePresentation,
  AgentProfileContribution,
  AppModeContribution,
  IpcModuleContribution,
  PromaExtension,
  SettingsContribution,
} from './contracts'

export interface ModeContribution<T> {
  id: string
  mode: PrimaryAppMode
  value: T
}

export interface AgentSurfaceContextRequest {
  extensionId: string
  sessionId: string
  presentation: AgentSurfacePresentation
}

export interface ExtensionRegistry {
  readonly extensions: readonly PromaExtension[]
  readonly agentProfiles: readonly AgentProfileContribution[]
  readonly settingsSections: readonly SettingsContribution[]
  readonly ipcModules: readonly IpcModuleContribution[]
  appModesFor: (mode: PrimaryAppMode) => readonly AppModeContribution[]
  getAgentSurfaceContext: (request: AgentSurfaceContextRequest) => AgentSurfaceContext | null
}

function assertUnique(ids: Iterable<string>, label: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`重复 ${label} ID：${id}`)
    seen.add(id)
  }
}

/**
 * 创建单次、只读的本地扩展 registry。它只组合已编译进应用的贡献，
 * 不提供动态 register API，也不加载外部代码。
 */
export function createExtensionRegistry(extensions: readonly PromaExtension[]): ExtensionRegistry {
  assertUnique(extensions.map((extension) => extension.id), 'extension')
  assertUnique(
    extensions.flatMap((extension) => (extension.appModes ?? []).map((contribution) => contribution.id)),
    'AppModeContribution',
  )
  assertUnique(
    extensions.flatMap((extension) => (extension.agentProfiles ?? []).map((contribution) => contribution.id)),
    'AgentProfileContribution',
  )
  assertUnique(
    extensions.flatMap((extension) => (extension.settingsSections ?? []).map((contribution) => contribution.id)),
    'SettingsContribution',
  )
  assertUnique(
    extensions.flatMap((extension) => (extension.ipcModules ?? []).map((contribution) => contribution.namespace)),
    'IpcModuleContribution',
  )
  assertUnique(
    extensions.flatMap((extension) => (extension.hostCapabilityManifests ?? []).map((manifest) => `${extension.id}:${manifest.id}`)),
    'HostCapabilityManifest',
  )
  assertUnique(
    extensions.flatMap((extension) => (extension.hostCapabilityManifests ?? []).map((manifest) => `${extension.id}:${manifest.presentation}`)),
    'HostCapabilityManifest presentation',
  )

  const registeredExtensions = Object.freeze([...extensions])
  const agentProfiles = Object.freeze(
    registeredExtensions.flatMap((extension) => extension.agentProfiles ?? []),
  )
  const settingsSections = Object.freeze(
    registeredExtensions.flatMap((extension) => extension.settingsSections ?? []),
  )
  const ipcModules = Object.freeze(
    registeredExtensions.flatMap((extension) => extension.ipcModules ?? []),
  )

  return Object.freeze({
    extensions: registeredExtensions,
    agentProfiles,
    settingsSections,
    ipcModules,
    appModesFor(mode: PrimaryAppMode): readonly AppModeContribution[] {
      return registeredExtensions.flatMap((extension) =>
        (extension.appModes ?? []).filter((contribution) => contribution.mode === mode),
      )
    },
    getAgentSurfaceContext(request: AgentSurfaceContextRequest): AgentSurfaceContext | null {
      const extension = registeredExtensions.find((candidate) => candidate.id === request.extensionId)
      const manifest = extension?.hostCapabilityManifests?.find(
        (candidate) => candidate.presentation === request.presentation,
      )
      if (!manifest) return null
      return {
        sessionId: request.sessionId,
        presentation: manifest.presentation,
        hostCapabilities: manifest.capabilities,
      }
    },
  })
}

/** 与 composition root 的语义对齐：只登记编译进应用的 extension。 */
export function registerExtensions(extensions: readonly PromaExtension[]): ExtensionRegistry {
  return createExtensionRegistry(extensions)
}

/**
 * 将 capability 转成既有 Agent UI 可直接使用的可见性判断，避免按 appMode 猜测。
 */
export function getAgentSurfaceControls(capabilities: AgentHostCapabilities): {
  referenceAction: boolean
  companionChatAction: boolean
  filePanelEntry: boolean
  canExpandToFull: boolean
} {
  return {
    referenceAction: capabilities.references,
    companionChatAction: capabilities.companionChat,
    filePanelEntry: capabilities.filePanel,
    canExpandToFull: capabilities.fullPresentation,
  }
}

/**
 * 将额外设置段落附加到上游设置工作区。基础段落优先，重复 ID 不得覆盖或重复渲染。
 */
export function resolveSettingsSections<
  TBase extends { id: string },
  TContribution extends { id: string; modes?: readonly PrimaryAppMode[] },
>(
  baseSections: readonly TBase[],
  contributions: readonly TContribution[],
  mode: PrimaryAppMode,
): readonly (TBase | TContribution)[] {
  if (contributions.length === 0) return baseSections

  const ids = new Set(baseSections.map((section) => section.id))
  let resolved: Array<TBase | TContribution> | undefined
  for (const section of contributions) {
    if (section.modes && !section.modes.includes(mode)) continue
    if (ids.has(section.id)) continue
    ids.add(section.id)
    resolved ??= [...baseSections]
    resolved.push(section)
  }
  return resolved ?? baseSections
}

/** 同一模式可组合多个侧栏贡献；首个注册项拥有同名 ID。 */
export function resolveModeContributions<T>(
  mode: PrimaryAppMode,
  contributions: readonly ModeContribution<T>[],
): T[] {
  const ids = new Set<string>()
  const values: T[] = []
  for (const contribution of contributions) {
    if (contribution.mode !== mode || ids.has(contribution.id)) continue
    ids.add(contribution.id)
    values.push(contribution.value)
  }
  return values
}
