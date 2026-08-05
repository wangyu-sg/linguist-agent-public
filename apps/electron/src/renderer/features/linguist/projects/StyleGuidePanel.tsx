import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LinguistStyleGuideRuleInfo } from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import { groupStyleGuideRules, validateStyleGuideRuleText } from './style-guide-utils'

/**
 * Style Guide 面板（PB-095）：按 groupKey 分组的规则行编辑，✅/❌ 对照列。
 * 全部写操作走 linguistAssetsUpsert/Delete 信封；归档项目只读。
 */
export function StyleGuidePanel({ projectId, archived }: { projectId: string; archived: boolean }): React.ReactElement {
  const [rules, setRules] = React.useState<LinguistStyleGuideRuleInfo[]>([])
  const [busy, setBusy] = React.useState(false)
  const [draftGroup, setDraftGroup] = React.useState('')
  const [draftRule, setDraftRule] = React.useState('')
  const [draftGood, setDraftGood] = React.useState('')
  const [draftBad, setDraftBad] = React.useState('')

  const refresh = React.useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistAssetsQuery({ projectId, kind: 'styleGuideRules', limit: 200, offset: 0 })
      if (!result.ok) {
        toast.error('读取 Style Guide 失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      setRules(result.data.items as LinguistStyleGuideRuleInfo[])
    } catch {
      toast.error('读取 Style Guide 失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }, [projectId])
  React.useEffect(() => { void refresh() }, [refresh])

  const addRule = async (): Promise<void> => {
    const invalidMessage = validateStyleGuideRuleText(draftRule)
    if (invalidMessage !== null) {
      toast.error('无法保存规则', { description: invalidMessage })
      return
    }
    const result = await window.electronAPI.linguistAssetsUpsert({
      projectId,
      kind: 'styleGuideRules',
      item: {
        ruleText: draftRule.trim(),
        ...(draftGroup.trim() !== '' ? { groupKey: draftGroup.trim() } : {}),
        ...(draftGood.trim() !== '' ? { goodExample: draftGood.trim() } : {}),
        ...(draftBad.trim() !== '' ? { badExample: draftBad.trim() } : {}),
      },
    })
    if (!result.ok) {
      toast.error('保存规则失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    setDraftRule('')
    setDraftGood('')
    setDraftBad('')
    await refresh()
  }

  const removeRule = async (id: string): Promise<void> => {
    const result = await window.electronAPI.linguistAssetsDelete({ projectId, kind: 'styleGuideRules', id })
    if (!result.ok) {
      toast.error('删除规则失败', { description: describeLinguistIpcError(result.error) })
      return
    }
    await refresh()
  }

  const groups = groupStyleGuideRules(rules)
  return (
    <details className="rounded-xl bg-content-area shadow-sm ring-1 ring-border/35">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-[12px] font-medium text-foreground/70">Style Guide（{rules.length}）</summary>
      <div className="space-y-2 border-t border-border/35 p-3">
        {busy && rules.length === 0 ? (
          <p className="text-[11px] text-foreground/40">正在读取…</p>
        ) : groups.length === 0 ? (
          <p className="text-[11px] text-foreground/40">暂无规则</p>
        ) : (
          groups.map((group) => (
            <div key={group.groupKey} className="space-y-1">
              <p className="text-[11px] font-medium text-foreground/55">{group.groupKey}</p>
              <ul className="space-y-1">
                {group.rules.map((rule) => (
                  <li key={rule.id} className="flex items-start gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5 text-[11px]">
                    <span className="min-w-0 flex-1 break-words">
                      {rule.ruleText}
                      {(rule.goodExample !== undefined || rule.badExample !== undefined) && (
                        <span className="mt-0.5 flex flex-wrap gap-x-3 text-foreground/50">
                          {rule.goodExample !== undefined && <span>✅ {rule.goodExample}</span>}
                          {rule.badExample !== undefined && <span>❌ {rule.badExample}</span>}
                        </span>
                      )}
                    </span>
                    <button type="button" disabled={archived} onClick={() => void removeRule(rule.id)} aria-label="删除规则" className="mt-0.5 text-destructive disabled:opacity-40">
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/25 pt-2">
          <input value={draftGroup} onChange={(event) => setDraftGroup(event.target.value)} placeholder="分组（可空）" className="h-7 w-20 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
          <input value={draftRule} onChange={(event) => setDraftRule(event.target.value)} placeholder="规则内容" className="h-7 min-w-36 flex-1 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
          <input value={draftGood} onChange={(event) => setDraftGood(event.target.value)} placeholder="✅ 正例（可空）" className="h-7 w-28 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
          <input value={draftBad} onChange={(event) => setDraftBad(event.target.value)} placeholder="❌ 反例（可空）" className="h-7 w-28 rounded-md bg-background px-2 text-[11px] ring-1 ring-border/50" />
          <button type="button" disabled={archived || busy || draftRule.trim() === ''} onClick={() => void addRule()} className="rounded-md bg-primary/10 px-2 py-1 text-[11px] text-primary disabled:opacity-40">添加</button>
        </div>
      </div>
    </details>
  )
}
