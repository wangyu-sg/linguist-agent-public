/**
 * 兼容旧 import 路径；新贡献定义与 registry 位于 renderer/host。
 */
export {
  resolveModeContributions,
  resolveSettingsSections,
} from '@/host/extension-registry'

export type { ModeContribution } from '@/host/extension-registry'
export type { SettingsContribution as SettingsSectionContribution } from '@/host/contracts'
