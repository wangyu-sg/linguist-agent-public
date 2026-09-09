import * as React from 'react'
import { HardDriveDownload, Languages } from 'lucide-react'
import { MigrationSettings } from '@/components/settings/MigrationSettings'
import {
  LinguistSidebarContent,
  type SharedProjectSessionRowProps,
} from '@/features/linguist/sidebar/LinguistSidebarContent'
import type { PromaExtension } from './contracts'

interface LinguistSidebarRenderContext {
  SessionRowComponent?: React.ComponentType<SharedProjectSessionRowProps>
}

function getSessionRowComponent(
  context: unknown,
): React.ComponentType<SharedProjectSessionRowProps> | null {
  if (!context || typeof context !== 'object' || !('SessionRowComponent' in context)) return null
  // React.memo 返回的是 exotic component object，而不一定是 function。
  // Shell 是唯一调用方，已在类型层传入共享会话行组件。
  return (context as LinguistSidebarRenderContext).SessionRowComponent ?? null
}

function renderLinguistSidebar(context: unknown): React.ReactNode {
  const SessionRowComponent = getSessionRowComponent(context)
  if (!SessionRowComponent) return null
  return <LinguistSidebarContent SessionRowComponent={SessionRowComponent} />
}

/**
 * 已编译进桌面应用的 Linguist 组合贡献。
 * IPC 条目只建立后续 namespaced bridge 的编译期合同；它不会重复注册现有 handler
 * 或建立运行时插件机制。
 */
export const linguistExtension: PromaExtension = {
  id: 'linguist',
  appModes: [{
    id: 'linguist-sidebar',
    mode: 'linguist',
    label: 'Linguist',
    icon: <Languages size={16} />,
    renderSidebar: renderLinguistSidebar,
  }],
  settingsSections: [{
    id: 'migration',
    label: '数据迁移',
    icon: <HardDriveDownload size={16} />,
    // 旧版 Linguist 项目迁移本来就可从所有主模式进入，保持现有行为。
    modes: ['agent', 'chat', 'linguist'],
    render: () => <MigrationSettings />,
  }],
  ipcModules: [{
    namespace: 'linguist',
    // 现有 IPC 尚未迁移为受验证的 namespaced bridge，不能伪登记为已实现 command。
    commands: {},
  }],
}
