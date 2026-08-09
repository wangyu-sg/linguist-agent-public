import * as React from 'react'
import { Check, ChevronDown, Languages, ScanText, Sparkles, SpellCheck2 } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import type { AgentSessionMeta, LinguistRole } from '@proma/shared'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { replaceAgentSessionInFreshnessOrder } from '@/lib/agent-session-list'
import { cn } from '@/lib/utils'
import { describeLinguistIpcError } from '../projects/project-utils'

export const LINGUIST_ROLE_OPTIONS: readonly {
  role: LinguistRole
  label: string
  shortLabel: string
  description: string
  icon: typeof Sparkles
}[] = [
  { role: 'general', label: '通用项目 Agent', shortLabel: '通用', description: '导入、分析、术语、QA、交付和开放任务', icon: Sparkles },
  { role: 'translator', label: '翻译', shortLabel: '翻译', description: '对声明范围完成正式译文并自检', icon: Languages },
  { role: 'reviewer', label: '双语审校', shortLabel: '审校', description: '检查完整 Source 与当前 Target，修正任何问题', icon: ScanText },
  { role: 'proofreader', label: '目标语校对', shortLabel: '校对', description: '以目标语成品为中心润色和统一风格', icon: SpellCheck2 },
] as const

export function getLinguistRoleOption(role: LinguistRole | undefined) {
  return LINGUIST_ROLE_OPTIONS.find((option) => option.role === (role ?? 'general'))!
}

export function LinguistRoleMenu({
  session,
  compact = false,
}: {
  session: AgentSessionMeta
  compact?: boolean
}): React.ReactElement | null {
  const setSessions = useSetAtom(agentSessionsAtom)
  const [saving, setSaving] = React.useState(false)
  if (!session.linguistProjectId) return null
  const current = getLinguistRoleOption(session.linguistRole)
  const Icon = current.icon

  const updateRole = async (role: LinguistRole): Promise<void> => {
    if (saving || role === current.role) return
    setSaving(true)
    try {
      const result = await window.electronAPI.linguistSessionsUpdateRole({ sessionId: session.id, role })
      if (!result.ok) {
        toast.error('切换岗位失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      setSessions((previous) => replaceAgentSessionInFreshnessOrder(previous, result.data))
      toast.success(`已切换为${getLinguistRoleOption(role).label}`)
    } catch {
      toast.error('切换岗位失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          aria-label={`当前岗位：${current.label}`}
          className={cn(
            'titlebar-no-drag inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 text-foreground/60 hover:bg-accent/70 hover:text-foreground',
            compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
          )}
        >
          <Icon size={compact ? 10 : 11} aria-hidden="true" />
          <span>{compact ? current.shortLabel : current.label}</span>
          <ChevronDown size={10} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="z-[9999] w-72">
        {LINGUIST_ROLE_OPTIONS.map((option) => {
          const OptionIcon = option.icon
          return (
            <DropdownMenuItem
              key={option.role}
              onSelect={() => { void updateRole(option.role) }}
              className="items-start"
            >
              <OptionIcon className="mt-0.5" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{option.label}</span>
                <span className="block text-[11px] leading-4 text-muted-foreground">{option.description}</span>
              </span>
              {option.role === current.role && <Check className="mt-0.5" aria-hidden="true" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
