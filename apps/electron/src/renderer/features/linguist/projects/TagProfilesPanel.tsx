import * as React from 'react'
import type {
  LinguistProjectInfo,
  LinguistTagProfileCandidateInfo,
  LinguistUnknownTagExampleInfo,
  LinguistUnknownTagPatternInfo,
} from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { describeLinguistIpcError } from './project-utils'

function TagSection({ title, empty, children }: {
  title: string
  empty: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="rounded-xl bg-muted/50 p-4 shadow-sm">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-3 space-y-2">{React.Children.count(children) === 0
        ? <p className="text-xs text-muted-foreground">{empty}</p>
        : children}</div>
    </section>
  )
}

function CandidateRow({
  projectId,
  candidate,
  examples,
  archived,
  onUpdated,
}: {
  projectId: string
  candidate: LinguistTagProfileCandidateInfo
  examples: ReadonlyMap<string, LinguistUnknownTagExampleInfo>
  archived: boolean
  onUpdated: () => void
}): React.ReactElement {
  const [pattern, setPattern] = React.useState(candidate.pattern)
  const [busy, setBusy] = React.useState(false)
  const invoke = async (input: Parameters<typeof window.electronAPI.linguistProjectsUpdateTagProfile>[0], success: string) => {
    setBusy(true)
    try {
      const result = await window.electronAPI.linguistProjectsUpdateTagProfile(input)
      if (!result.ok) {
        toast.error('更新 Tag Profile 失败', { description: describeLinguistIpcError(result.error) })
        return
      }
      toast.success(success)
      onUpdated()
    } catch {
      toast.error('更新 Tag Profile 失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setBusy(false)
    }
  }
  const preview = candidate.evidenceExampleIds
    .map((id) => examples.get(id))
    .filter((item): item is LinguistUnknownTagExampleInfo => item !== undefined)

  return (
    <div className="rounded-lg border border-border/60 bg-background/65 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{candidate.name}</div>
          <div className="text-[11px] text-muted-foreground">置信度 {Math.round(candidate.confidence * 100)}% · {candidate.kind}</div>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" disabled={busy || archived || pattern === candidate.pattern} onClick={() => {
            void invoke({
              projectId,
              action: 'save',
              replaceId: candidate.id,
              candidate: {
                name: candidate.name,
                regex: pattern,
                kind: candidate.kind,
                ...(candidate.pairKey ? { pairKey: candidate.pairKey } : {}),
                evidenceExampleIds: [...candidate.evidenceExampleIds],
                confidence: candidate.confidence,
                explanation: candidate.explanation,
              },
            }, '候选正则已验证并保存')
          }}>保存</Button>
          <Button size="sm" disabled={busy || archived} onClick={() => {
            void invoke({ projectId, action: 'activate', entryId: candidate.id }, '已启用硬保护')
          }}>批准</Button>
          <Button size="sm" variant="ghost" disabled={busy || archived} onClick={() => {
            void invoke({ projectId, action: 'ignore', entryId: candidate.id }, '候选已忽略')
          }}>拒绝</Button>
        </div>
      </div>
      <Input className="mt-2 h-8 font-mono text-xs" value={pattern} disabled={busy || archived} onChange={(event) => setPattern(event.target.value)} />
      <p className="mt-2 text-xs text-muted-foreground">{candidate.explanation}</p>
      {preview.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">预览匹配样本（{preview.length}）</summary>
          <div className="mt-1 space-y-1 font-mono">
            {preview.map((item) => <div key={item.id} className="rounded bg-muted px-2 py-1 break-all">{item.value}</div>)}
          </div>
        </details>
      )}
    </div>
  )
}

export function TagProfilesPanel({ project, onUpdated }: {
  project: LinguistProjectInfo
  onUpdated: () => void
}): React.ReactElement {
  const [patterns, setPatterns] = React.useState<LinguistUnknownTagPatternInfo[]>([])
  const [scanning, setScanning] = React.useState(false)
  const archived = project.archivedAt !== undefined
  const scan = React.useCallback(async () => {
    setScanning(true)
    try {
      const result = await window.electronAPI.linguistProjectsScanUnknownTags({ projectId: project.id, sampleLimit: 10 })
      if (result.ok) setPatterns(result.data)
      else toast.error('未知 Tag 扫描失败', { description: describeLinguistIpcError(result.error) })
    } catch {
      toast.error('未知 Tag 扫描失败', { description: '与主进程通信异常（INTERNAL）' })
    } finally {
      setScanning(false)
    }
  }, [project.id])
  React.useEffect(() => { void scan() }, [scan, project.updatedAt])
  const profile = project.tagProfile
  const active = profile?.families.filter((family) => family.enabled !== false) ?? []
  const disabled = profile?.families.filter((family) => family.enabled === false) ?? []
  const candidates = profile?.candidates?.filter((candidate) => candidate.status === 'candidate') ?? []
  const ignored = profile?.candidates?.filter((candidate) => candidate.status === 'ignored') ?? []
  const examples = new Map(patterns.flatMap((pattern) => pattern.examples.map((example) => [example.id, example] as const)))

  const toggleFamily = async (id: string, action: 'enable' | 'disable') => {
    const result = await window.electronAPI.linguistProjectsUpdateTagProfile({ projectId: project.id, action, entryId: id })
    if (!result.ok) toast.error('Tag Profile 更新失败', { description: describeLinguistIpcError(result.error) })
    else onUpdated()
  }

  return (
    <div className="space-y-3 py-1">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted-foreground">候选只做软提示；批准后才进入编辑、Proposal、QA 和导出的硬规则。</p>
        <Button size="sm" variant="outline" disabled={scanning} onClick={() => { void scan() }}>{scanning ? '扫描中…' : '重新扫描'}</Button>
      </div>
      <TagSection title="已启用" empty="暂无项目级硬保护规则。">
        {active.map((family) => (
          <div key={family.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/65 p-3">
            <div><div className="text-sm font-medium">{family.id}</div><code className="text-xs text-muted-foreground">{family.pattern}</code></div>
            <Button size="sm" variant="outline" disabled={archived} onClick={() => { void toggleFamily(family.id, 'disable') }}>禁用</Button>
          </div>
        ))}
      </TagSection>
      <TagSection title="未登记与候选" empty="暂无未登记形状或候选。">
        {patterns.map((pattern) => (
          <div key={pattern.patternShape} className="rounded-lg border border-border/60 bg-background/65 p-3">
            <div className="flex items-center justify-between gap-2">
              <code className="break-all text-xs text-foreground/80">{pattern.patternShape}</code>
              <span className="shrink-0 text-[11px] text-muted-foreground">出现 {pattern.frequency} 次</span>
            </div>
            <div className="mt-2 space-y-1">
              {pattern.examples.map((example) => (
                <div key={example.id} className="flex gap-2 rounded bg-muted px-2 py-1 text-[11px]">
                  <span className="shrink-0 text-muted-foreground">{example.side === 'source' ? '源文' : '译文'}</span>
                  <code className="break-all text-foreground/75">{example.value}</code>
                </div>
              ))}
            </div>
          </div>
        ))}
        {candidates.map((candidate) => <CandidateRow key={candidate.id} projectId={project.id} candidate={candidate} examples={examples} archived={archived} onUpdated={onUpdated} />)}
      </TagSection>
      <TagSection title="已忽略" empty="暂无已忽略或已禁用条目。">
        {disabled.map((family) => (
          <div key={family.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-background/65 p-3">
            <code className="text-xs text-muted-foreground">{family.pattern}</code>
            <Button size="sm" variant="outline" disabled={archived} onClick={() => { void toggleFamily(family.id, 'enable') }}>重新启用</Button>
          </div>
        ))}
        {ignored.map((candidate) => <div key={candidate.id} className="rounded-lg border border-border/60 bg-background/65 p-3 text-xs text-muted-foreground">{candidate.name} · <code>{candidate.pattern}</code></div>)}
      </TagSection>
    </div>
  )
}
