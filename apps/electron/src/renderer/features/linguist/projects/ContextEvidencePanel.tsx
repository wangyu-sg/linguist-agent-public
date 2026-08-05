import * as React from 'react'
import { useAtomValue } from 'jotai'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type {
  LinguistCatContextResult,
  LinguistContextDocInfo,
  LinguistIpcError,
  LinguistStyleGuideRuleInfo,
  LinguistVoiceProfileInfo,
} from '@proma/shared'
import { describeLinguistIpcError } from './project-utils'
import {
  getProjectMutationRefreshPlan,
  linguistProjectMutationStateAtomFamily,
} from './project-mutation-atoms'

interface SourcePage<T> {
  total: number
  items: T[]
}

export interface ContextEvidenceSources {
  styleRules: SourcePage<LinguistStyleGuideRuleInfo>
  voiceProfiles: SourcePage<LinguistVoiceProfileInfo>
  contextDocs: SourcePage<LinguistContextDocInfo>
}

interface EvidenceProvenance {
  kind: 'tm' | 'term' | 'style' | 'voice' | 'context' | 'other'
  label: string
}

type ContextEvidenceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: LinguistIpcError }
  | {
      status: 'ready'
      context: LinguistCatContextResult
      sources: ContextEvidenceSources
    }

const SOURCE_PREVIEW_LIMIT = 3

export function evidenceProvenance(reference: string): EvidenceProvenance {
  const prefix = reference.split(':', 1)[0]?.trim().toLowerCase()
  if (prefix === 'tm') return { kind: 'tm', label: 'TM' }
  if (prefix === 'term') return { kind: 'term', label: '术语' }
  if (prefix === 'style' || prefix === 'style-guide' || prefix === 'styleguide') {
    return { kind: 'style', label: 'Style' }
  }
  if (prefix === 'voice') return { kind: 'voice', label: 'Voice' }
  if (prefix === 'context' || prefix === 'context-doc' || prefix === 'doc') {
    return { kind: 'context', label: 'Context' }
  }
  return { kind: 'other', label: '其他' }
}

export function ContextEvidencePanel({
  projectId,
  activeSegmentId,
  onOpenTerms,
}: {
  projectId: string
  activeSegmentId?: string
  onOpenTerms: () => void
}): React.ReactElement {
  const projectMutationState = useAtomValue(
    linguistProjectMutationStateAtomFamily(projectId),
  )
  const [state, setState] = React.useState<ContextEvidenceState>({ status: 'idle' })
  const [mutationRefreshToken, setMutationRefreshToken] = React.useState(0)
  const handledMutationRevisions = React.useRef(new Map<string, number>())

  React.useEffect(() => {
    const lastHandledRevision = handledMutationRevisions.current.get(projectId)
    if (lastHandledRevision === undefined) {
      handledMutationRevisions.current.set(projectId, projectMutationState.lastRevision)
      return
    }
    if (
      projectMutationState.latest === undefined
      || projectMutationState.lastRevision <= lastHandledRevision
    ) return
    handledMutationRevisions.current.set(projectId, projectMutationState.lastRevision)
    const refreshPlan = getProjectMutationRefreshPlan(projectMutationState)
    if (
      refreshPlan.context
      && (
        refreshPlan.resources
        || refreshPlan.segmentIds.length === 0
        || (
          activeSegmentId !== undefined
          && refreshPlan.segmentIds.includes(activeSegmentId)
        )
      )
    ) {
      setMutationRefreshToken((current) => current + 1)
    }
  }, [activeSegmentId, projectId, projectMutationState])

  React.useEffect(() => {
    if (activeSegmentId === undefined) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    void Promise.all([
      window.electronAPI.linguistCatGetContext({ projectId, segmentId: activeSegmentId }),
      window.electronAPI.linguistAssetsQuery({
        projectId,
        kind: 'styleGuideRules',
        limit: SOURCE_PREVIEW_LIMIT,
        offset: 0,
      }),
      window.electronAPI.linguistAssetsQuery({
        projectId,
        kind: 'voiceProfiles',
        limit: SOURCE_PREVIEW_LIMIT,
        offset: 0,
      }),
      window.electronAPI.linguistAssetsQuery({
        projectId,
        kind: 'contextDocs',
        limit: SOURCE_PREVIEW_LIMIT,
        offset: 0,
      }),
    ]).then(([context, styleRules, voiceProfiles, contextDocs]) => {
      if (cancelled) return
      const failure = [context, styleRules, voiceProfiles, contextDocs].find((result) => !result.ok)
      if (failure !== undefined && !failure.ok) {
        setState({ status: 'error', error: failure.error })
        return
      }
      if (!context.ok || !styleRules.ok || !voiceProfiles.ok || !contextDocs.ok) return
      setState({
        status: 'ready',
        context: context.data,
        sources: {
          styleRules: {
            total: styleRules.data.total,
            items: styleRules.data.items as LinguistStyleGuideRuleInfo[],
          },
          voiceProfiles: {
            total: voiceProfiles.data.total,
            items: voiceProfiles.data.items as LinguistVoiceProfileInfo[],
          },
          contextDocs: {
            total: contextDocs.data.total,
            items: contextDocs.data.items as LinguistContextDocInfo[],
          },
        },
      })
    }).catch(() => {
      if (!cancelled) {
        setState({
          status: 'error',
          error: { code: 'INTERNAL', message: '与主进程通信异常' },
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeSegmentId, mutationRefreshToken, projectId])

  if (state.status === 'idle') {
    return <Empty>选择一个片段查看上下文与证据</Empty>
  }
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        正在读取上下文…
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="flex items-start gap-2 text-xs text-destructive">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        {describeLinguistIpcError(state.error)}
      </div>
    )
  }
  return (
    <ContextEvidenceView
      projectId={projectId}
      context={state.context}
      sources={state.sources}
      onOpenTerms={onOpenTerms}
    />
  )
}

export function ContextEvidenceView({
  projectId,
  context,
  sources,
  onOpenTerms,
}: {
  projectId: string
  context: LinguistCatContextResult
  sources: ContextEvidenceSources
  onOpenTerms: () => void
}): React.ReactElement {
  const sourceId = (kind: 'style' | 'voice' | 'context' | 'tm'): string =>
    `linguist-context-source-${projectId}-${kind}`
  const evidence = context.pendingProposal?.evidenceRefs ?? []
  const termRefs = context.pendingProposal?.termRefs ?? []

  return (
    <div className="grid min-h-0 gap-4 overflow-auto pb-2 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
      <section aria-label="片段上下文来源" className="grid content-start gap-2 sm:grid-cols-2">
        <SourceSummary
          id={sourceId('style')}
          label="Style"
          total={sources.styleRules.total}
          empty="无 Style Guide"
          items={sources.styleRules.items.map((rule) => ({
            id: rule.id,
            title: rule.groupKey ?? '通用规则',
            detail: rule.ruleText,
          }))}
        />
        <SourceSummary
          id={sourceId('voice')}
          label="Voice"
          total={sources.voiceProfiles.total}
          empty="无 Voice Profile"
          items={sources.voiceProfiles.items.map((profile) => ({
            id: profile.id,
            title: profile.speaker,
            detail: [profile.register, ...(profile.toneMarkers ?? [])].filter(Boolean).join(' · '),
          }))}
        />
        <SourceSummary
          id={sourceId('context')}
          label="Context"
          total={
            sources.contextDocs.total
            + (context.segment.context?.origin === undefined ? 0 : 1)
            + (context.segment.context?.note === undefined ? 0 : 1)
          }
          empty="无 Context Doc"
          items={[
            ...(context.segment.context?.origin !== undefined
              ? [{
                  id: 'segment-origin',
                  title: 'Segment 来源',
                  detail: context.segment.context.origin,
                }]
              : []),
            ...(context.segment.context?.note !== undefined
              ? [{
                  id: 'segment-note',
                  title: 'Segment 备注',
                  detail: context.segment.context.note,
                }]
              : []),
            ...sources.contextDocs.items.map((doc) => ({
              id: doc.id,
              title: doc.originalFilename,
              detail: doc.note ?? (doc.hasTextExtract ? `可阅读 · ${doc.textExtractLength} 字` : '无文本抽取'),
            })),
          ]}
        />
        <SourceSummary
          id={sourceId('tm')}
          label="TM"
          total={context.tmMatches.length}
          empty="当前片段无 TM 匹配"
          items={context.tmMatches.map((match) => ({
            id: match.id,
            title: match.origin ?? '项目 TM',
            detail: `${match.matchType} · ${Math.round(match.score * 100)}%`,
          }))}
        />
      </section>

      <section aria-label="Agent proposal evidence" className="min-w-0">
        <h3 className="text-xs font-semibold text-foreground">Agent Proposal Evidence</h3>
        {context.pendingProposal === undefined ? (
          <Empty>当前片段没有待审 Proposal</Empty>
        ) : evidence.length + termRefs.length === 0 ? (
          <Empty>当前 Proposal 没有证据引用</Empty>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {[...evidence, ...termRefs].map((reference, index) => {
              const provenance = evidenceProvenance(reference)
              const target = provenance.kind === 'style'
                || provenance.kind === 'voice'
                || provenance.kind === 'context'
                || provenance.kind === 'tm'
                ? `#${sourceId(provenance.kind)}`
                : undefined
              return (
                <li key={`${index}:${reference}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-foreground/[0.035] px-2.5 py-2 text-xs">
                  <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {provenance.label}
                  </span>
                  <span className="min-w-0 flex-1 break-all text-foreground/70">{reference}</span>
                  {target !== undefined ? (
                    <a href={target} className="shrink-0 text-[11px] text-primary hover:underline">
                      查看来源
                    </a>
                  ) : provenance.kind === 'term' ? (
                    <button
                      type="button"
                      data-open-dock-tab="terms"
                      onClick={onOpenTerms}
                      className="shrink-0 text-[11px] text-primary hover:underline"
                    >
                      查看术语
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function SourceSummary({
  id,
  label,
  total,
  empty,
  items,
}: {
  id: string
  label: string
  total: number
  empty: string
  items: Array<{ id: string; title: string; detail: string }>
}): React.ReactElement {
  return (
    <article id={id} tabIndex={-1} className="rounded-xl bg-foreground/[0.025] p-3 focus:outline-none focus:ring-2 focus:ring-primary/50">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{label}</h3>
        <span className="text-[10px] text-muted-foreground">{total}</span>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="min-w-0">
              <p className="truncate text-[11px] font-medium text-foreground/80">{item.title}</p>
              {item.detail !== '' && (
                <p className="line-clamp-2 break-words text-[11px] text-muted-foreground">{item.detail}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {total > items.length && (
        <p className="mt-2 text-[10px] text-muted-foreground">另有 {total - items.length} 项</p>
      )}
    </article>
  )
}

function Empty({ children }: React.PropsWithChildren): React.ReactElement {
  return <p className="mt-2 text-xs leading-5 text-muted-foreground">{children}</p>
}
