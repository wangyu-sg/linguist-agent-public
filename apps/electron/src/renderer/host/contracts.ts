import type { ReactElement, ReactNode } from 'react'
import type { PrimaryAppMode } from '@/atoms/app-mode'

/** Agent 页面、Linguist rail 和全屏呈现共用的宿主表面标识。 */
export type AgentSurfacePresentation = 'page' | 'linguist-rail' | 'linguist-full'

/**
 * Agent 原生界面可按宿主表面显式开放的能力。
 *
 * 这是一份能力声明，不是功能开关：未实现或被宿主阻断的入口必须登记为 false。
 */
export interface AgentHostCapabilities {
  references: boolean
  companionChat: boolean
  filePanel: boolean
  preview: boolean
  attachments: boolean
  slashMenu: boolean
  modelControls: boolean
  queueAndSteer: boolean
  permissions: boolean
  fullPresentation: boolean
}

/** 普通 Agent 页面沿用现有完整能力，Linguist 由 extension manifest 单独声明。 */
export const DEFAULT_AGENT_HOST_CAPABILITIES: AgentHostCapabilities = {
  references: true,
  companionChat: true,
  filePanel: true,
  preview: true,
  attachments: true,
  slashMenu: true,
  modelControls: true,
  queueAndSteer: true,
  permissions: true,
  fullPresentation: true,
}

/** registry 缺失时的保守回退，避免错误地向嵌入式 Agent 暴露宿主入口。 */
export const UNAVAILABLE_AGENT_HOST_CAPABILITIES: AgentHostCapabilities = {
  references: false,
  companionChat: false,
  filePanel: false,
  preview: false,
  attachments: false,
  slashMenu: false,
  modelControls: false,
  queueAndSteer: false,
  permissions: false,
  fullPresentation: false,
}

export interface AgentSurfaceContextValue {
  sessionId: string
  presentation: AgentSurfacePresentation
  hostCapabilities: AgentHostCapabilities
}

/** 与蓝图中的 AgentSurfaceContext 命名对齐的简写。 */
export type AgentSurfaceContext = AgentSurfaceContextValue

/**
 * 静态登记的宿主能力；不会在运行时加载第三方插件。
 */
export interface HostCapabilityManifest {
  id: string
  presentation: AgentSurfacePresentation
  capabilities: AgentHostCapabilities
}

export interface SettingsContribution {
  id: string
  label: string
  icon: ReactNode
  /** 未指定时沿用当前全模式可见的设置行为。 */
  modes?: readonly PrimaryAppMode[]
  render?: () => ReactElement
}

/**
 * App shell 注入的呈现槽。上下文保持 opaque，避免 extension 反向依赖整个 shell。
 */
export interface AppModeContribution {
  id: string
  mode: PrimaryAppMode
  label: string
  icon: ReactNode
  renderSidebar?: (context: unknown) => ReactNode
  renderMain?: () => ReactNode
  restoreNavigationState?: () => void
}

export interface AgentRunContext<TProfile = unknown> {
  sessionId: string
  profile: TProfile
  surface: AgentSurfaceContext
}

export interface AgentRunResult<TProfile = unknown> {
  sessionId: string
  profile: TProfile
}

export interface PromptLayer {
  id: string
  content: string
}

export interface SkillReference {
  id: string
}

export interface ExecutionScope {
  id: string
}

/**
 * Agent Profile 的编译期合同。Linguist 的实际 tool 注入仍留在既有主进程路径，
 * 此处先固定“基座工具 + profile 追加”的边界，避免复制原生 Agent 构建器。
 */
export interface AgentProfileContribution<TProfile = unknown, TTool = unknown> {
  id: string
  decodeProfile: (metadata: unknown) => TProfile | null
  contributeTools: (
    context: AgentRunContext<TProfile>,
    baseTools: readonly TTool[],
  ) => Promise<readonly TTool[]>
  contributePromptLayers: (
    context: AgentRunContext<TProfile>,
  ) => Promise<readonly PromptLayer[]>
  contributeSkills: (
    context: AgentRunContext<TProfile>,
  ) => Promise<readonly SkillReference[]>
  resolveExecutionScope: (
    context: AgentRunContext<TProfile>,
  ) => Promise<ExecutionScope | null>
  beforeRun?: (context: AgentRunContext<TProfile>) => Promise<void>
  afterRun?: (result: AgentRunResult<TProfile>) => Promise<void>
}

/**
 * IPC module 的编译期合同。实际 IPC 仍须同时更新 shared/main/preload/renderer 四层。
 */
export interface RuntimeSchema<T> {
  parse: (input: unknown) => T
}

export interface ValidatedIpcCommand<TInput = unknown, TOutput = unknown> {
  inputSchema: RuntimeSchema<TInput>
  outputSchema: RuntimeSchema<TOutput>
}

export interface IpcModuleContribution {
  namespace: string
  commands: Readonly<Record<string, ValidatedIpcCommand>>
}

/**
 * 仅在 composition root 静态注册的扩展合同；这不是运行时插件平台。
 */
export interface PromaExtension {
  id: string
  appModes?: readonly AppModeContribution[]
  agentProfiles?: readonly AgentProfileContribution[]
  settingsSections?: readonly SettingsContribution[]
  ipcModules?: readonly IpcModuleContribution[]
  hostCapabilityManifests?: readonly HostCapabilityManifest[]
}
