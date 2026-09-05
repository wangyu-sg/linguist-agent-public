import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import {
  fnv1a64,
  matchTmCandidates,
  scanTagTokens,
  selectTmAgentEvidence,
  type Segment,
  type StageEvidenceReceipt,
  type SegmentTermPolicyEvaluation,
  type TmAgentEvidence,
  type TmMatchDiagnostics,
} from '@linguist/cat-core'
import {
  StoreNotFoundError,
  type TermEntryMatch,
  type TmUnit,
} from '@linguist/cat-store'
import { Type } from 'typebox'
import { LinguistCatContextDriftError, LinguistCatInvalidArgumentError } from './errors'
import { pageHasMore, resolvePage } from './pagination'
import {
  CAT_TOOL_PAGE_LIMITS,
  type CatEvidenceRef,
  type CatGetTranslationContextResult,
  type CatLinkedContextEvidence,
  type CatProjectRuleItem,
  type CatReadContextDocResult,
  type CatRequiredEvidencePending,
  type CatSearchSentencePatternsResult,
  type CatSearchTermsResult,
  type CatSearchTmResult,
  type CatSegmentBrief,
  type SegmentTranslationContext,
} from './types'
import {
  defineTool,
  toolResult,
  type CatToolRuntime,
} from './tool-runtime'

const EMPTY_TM_NOTE =
  'No TM units matched the query. Import TMX or CSV into this project to add translation memory.'
const EMPTY_TB_NOTE =
  'No term entries matched the query. Import TBX or CSV into this project to add terminology.'
const EMPTY_PATTERNS_NOTE =
  'No sentence patterns matched. Import a CSV or add sentence patterns via the project UI to build the pattern library.'
const IMAGE_DOC_NOTE =
  'This context doc is an image. The managed image requires a vision-capable model; a filename or text-only model does not satisfy visual evidence. Do not switch Provider without user authorization.'
const NO_EXTRACT_NOTE =
  'This context doc has no plain-text extract (only binary/source bytes are stored). Ask the user for the relevant content if you need it.'
const SENTENCE_PATTERN_STATUSES = [
  'confirmed',
  'pending',
  'rejected',
] as const

/** LA-CONTEXT-001：首页自动注入的规则条数硬上限。 */
const PROJECT_RULES_LIMIT = 20
const INLINE_CONTEXT_TEXT_MAX_CHARS = 2_000
const REQUIREDNESS_RANK = { optional: 0, conditional: 1, required: 2 } as const

function translationContextCursorKey(
  segmentIds: readonly string[],
  neighborCount: number,
  tmLimit: number,
  termLimit: number,
): string {
  return fnv1a64(JSON.stringify([
    segmentIds,
    neighborCount,
    tmLimit,
    termLimit,
  ]))
}

/** v3 绑定尚未提供的真实上下文；已有有效 v2 游标继续按其原快照校验。 */
function translationContextCursorOffset(
  cursor: string | undefined,
  key: string,
  total: number,
  latestEventSequence: number,
): { offset: number; snapshot?: string } {
  if (cursor === undefined) return { offset: 0 }
  const match = /^ctx([23])-([0-9a-f]{16})-([0-9a-f]+)-(\d+)$/.exec(cursor)
  if (match === null || match[2] !== key || Number(match[4]) > total) {
    throw new LinguistCatInvalidArgumentError('cursor', 'does not belong to this translation-context request')
  }
  if (match[1] === '2') {
    if (!/^\d+$/.test(match[3]!) || Number(match[3]) !== latestEventSequence) throw new LinguistCatContextDriftError()
    return { offset: Number(match[4]) }
  }
  return { offset: Number(match[4]), snapshot: match[3] }
}

/** TM、术语、句式库和 Context 文档的只读检索工具。 */
export function createReferenceTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject } = runtime

  const getTranslationContextTool = defineTool({
    name: 'cat_get_translation_context',
    label: 'CAT get translation context',
    description:
      'Read translation context for 1-50 segment ids from the bound project in input order. ' +
      'Returns revision snapshots, neighbors, TM/TB matches, project rules, linked Context excerpts, ' +
      'required Evidence pending fetches, and submitted Stage Evidence coverage. ' +
      'This tool prepares evidence; only a confirmed Provider submission contributes to coverage. ' +
      'Results may be truncated by maxBytes and continued with a cursor that ' +
      'binds the remaining requested context — relevant content changes produce CONTEXT_DRIFT.',
    promptSnippet: 'Read bounded batch translation context from the bound CAT project',
    promptGuidelines: [
      'Use one batch call for related segments instead of repeating TM/TB searches per segment.',
      'Treat every revision as a snapshot; proposals must still use the returned current revision.',
      'Reviewer and Proofreader context always retains the complete current target; reduce the segment batch or raise maxBytes when the minimum core does not fit.',
      'Fetch every requiredEvidencePending item with cat_read_context_doc before confirming the Stage.',
      'On CONTEXT_DRIFT discard the cursor and restart from the first page; on an empty page with minimumRequiredBytes retry with a larger maxBytes.',
    ],
    parameters: Type.Object({
      segmentIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 50 }),
      includeNeighbors: Type.Optional(Type.Boolean()),
      neighborCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
      tmLimitPerSegment: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
      termLimitPerSegment: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
      maxBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 262_144 })),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(toolCallId, params) {
      if (params.segmentIds.length < 1 || params.segmentIds.length > 50) {
        throw new LinguistCatInvalidArgumentError('segmentIds', 'expected 1-50 items')
      }
      const neighborCount = params.includeNeighbors === false ? 0 : params.neighborCount ?? 1
      const tmLimit = params.tmLimitPerSegment ?? 5
      const termLimit = params.termLimitPerSegment ?? 10
      const maxBytes = params.maxBytes ?? 65_536
      if (!Number.isInteger(neighborCount) || neighborCount < 0 || neighborCount > 5) {
        throw new LinguistCatInvalidArgumentError('neighborCount', 'expected an integer from 0 to 5')
      }
      if (!Number.isInteger(tmLimit) || tmLimit < 0 || tmLimit > 10) {
        throw new LinguistCatInvalidArgumentError('tmLimitPerSegment', 'expected an integer from 0 to 10')
      }
      if (!Number.isInteger(termLimit) || termLimit < 0 || termLimit > 10) {
        throw new LinguistCatInvalidArgumentError('termLimitPerSegment', 'expected an integer from 0 to 10')
      }
      if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 262_144) {
        throw new LinguistCatInvalidArgumentError('maxBytes', 'expected an integer from 1024 to 262144')
      }
      const { project, db } = resolveBoundProject('cat_get_translation_context', toolCallId)
      const cursorKey = translationContextCursorKey(
        params.segmentIds,
        neighborCount,
        tmLimit,
        termLimit,
      )
      const { offset: cursorOffset, snapshot } = translationContextCursorOffset(
        params.cursor,
        cursorKey,
        params.segmentIds.length,
        db.runs.latestEventSequence,
      )
      const allRules = db.styleGuideRules.list({ limit: db.styleGuideRules.count() })
      const projectRules: CatProjectRuleItem[] = cursorOffset === 0
        ? allRules.slice(0, PROJECT_RULES_LIMIT).map((rule) => ({
          ruleId: rule.id,
          ...(rule.groupKey !== undefined ? { groupKey: rule.groupKey } : {}),
          ruleText: rule.ruleText,
          ...(rule.screenshotRef !== undefined ? { referenceId: rule.screenshotRef } : {}),
        }))
        : []
      const segments = db.segments.getByIds(params.segmentIds)
      if (segments.length !== params.segmentIds.length) {
        const found = new Set(segments.map((segment) => segment.id as string))
        throw new StoreNotFoundError(
          'segment',
          params.segmentIds.find((segmentId) => !found.has(segmentId))!,
        )
      }
      const remainingSegments = segments.slice(cursorOffset)
      const linkedContextBySegment = new Map<string, CatLinkedContextEvidence[]>()
      const pendingEvidenceBySegment = new Map<string, CatRequiredEvidencePending[]>()
      const contextDocs = db.contextDocs.list({ limit: db.contextDocs.count() })
      const requestedIds = new Set(remainingSegments.map(segment => segment.id as string))
      const requestedAssets = new Set(remainingSegments.map(segment => segment.assetId as string))
      const contextEvidence = contextDocs.flatMap(doc => {
        const links = db.contextDocs.listEvidenceLinks(doc.id).filter(link => link.relation.kind === 'segment'
          ? requestedIds.has(link.relation.segmentId) : requestedAssets.has(link.relation.assetId))
        if (links.length === 0) return []
        const anchors = new Map(db.contextDocs.listAnchors(doc.id).map(anchor => [anchor.id, anchor]))
        return [{ doc, anchors, links, version: fnv1a64(JSON.stringify([doc.sha256, doc.textExtract, [...anchors.values()]])) }]
      })
      for (const segment of remainingSegments) {
        const linkedContext: CatLinkedContextEvidence[] = []
        const pending: CatRequiredEvidencePending[] = []
        for (const { doc, anchors, links } of contextEvidence) {
          const grouped = new Map<string, 'required' | 'conditional' | 'optional'>()
          for (const link of links) {
            const relevant = link.relation.kind === 'segment'
              ? link.relation.segmentId === segment.id
              : link.relation.assetId === segment.assetId
            if (!relevant) continue
            const key = link.anchorId ?? ''
            const current = grouped.get(key) ?? 'optional'
            if (REQUIREDNESS_RANK[link.requiredness] > REQUIREDNESS_RANK[current]) {
              grouped.set(key, link.requiredness)
            }
          }
          for (const [anchorId, requiredness] of grouped) {
            const anchor = anchorId === '' ? undefined : anchors.get(anchorId)
            const text = anchor?.text ?? (anchor === undefined ? doc.textExtract : undefined)
            if (doc.kind !== 'image' && anchor?.mediaContextDocId === undefined && text !== undefined && text.length <= INLINE_CONTEXT_TEXT_MAX_CHARS) {
              linkedContext.push({
                docId: doc.id,
                filename: doc.originalFilename,
                ...(anchor === undefined ? {} : { anchorId: anchor.id, locator: anchor.locator }),
                text,
                requiredness,
              })
              continue
            }
            if (requiredness !== 'required') continue
            const media = anchor?.mediaContextDocId === undefined
              ? undefined
              : db.contextDocs.get(anchor.mediaContextDocId)
            pending.push({
              docId: media?.id ?? doc.id,
              filename: media?.originalFilename ?? doc.originalFilename,
              anchorIds: anchor === undefined ? [] : [anchor.id],
              kind: media === undefined ? 'document' : 'image',
              reason: media === undefined
                ? '必需 Context 正文超过自动注入上限，需调用 cat_read_context_doc'
                : '必需视觉证据尚未进入模型请求，需调用 cat_read_context_doc',
            })
          }
        }
        linkedContextBySegment.set(segment.id as string, linkedContext)
        pendingEvidenceBySegment.set(segment.id as string, pending)
      }
      const neighborsBySegment: ReadonlyMap<
        string,
        { previous: Segment[]; next: Segment[] }
      > = neighborCount === 0
        ? new Map()
        : db.segments.neighborsMany(remainingSegments, neighborCount)
      const termPolicyBySegment = new Map<string, SegmentTermPolicyEvaluation<TermEntryMatch>>()
      if (termLimit > 0) {
        for (const segment of remainingSegments) {
          const evaluated = db.termEntries.evaluateSegment(segment)
          termPolicyBySegment.set(segment.id as string, {
            matches: evaluated.matches.slice(0, termLimit),
          })
        }
      }
      const tmMatchesBySegment = new Map<string, TmAgentEvidence[]>()
      if (tmLimit > 0) {
        const localeGroups = new Map<string, typeof remainingSegments>()
        for (const segment of remainingSegments) {
          const key = JSON.stringify([segment.sourceLocale, segment.targetLocale])
          const group = localeGroups.get(key) ?? []
          group.push(segment)
          localeGroups.set(key, group)
        }
        for (const group of localeGroups.values()) {
          const candidates = db.tmUnits.listCandidates(
            group[0]!.sourceLocale,
            group[0]!.targetLocale,
          )
          for (const segment of group) {
            const neighbors = neighborsBySegment.get(segment.id as string) ?? { previous: [], next: [] }
            const diagnostics = matchTmCandidates(segment.source, candidates, {
              context: {
                ...(segment.key === undefined ? {} : { contextKey: segment.key }),
                ...(neighbors.previous.at(-1) === undefined ? {} : { previousSource: neighbors.previous.at(-1)!.source }),
                ...(neighbors.next[0] === undefined ? {} : { nextSource: neighbors.next[0]!.source }),
              },
            })
            tmMatchesBySegment.set(
              segment.id as string,
              selectTmAgentEvidence(diagnostics, tmLimit),
            )
          }
        }
      }
      const contexts: SegmentTranslationContext[] = []
      for (const segment of remainingSegments) {
        const neighbors = neighborCount === 0
          ? { previous: [], next: [] }
          : neighborsBySegment.get(segment.id as string)!
        const brief = (item: typeof segment): CatSegmentBrief => ({
          segmentId: item.id as string,
          revision: item.revision,
          source: item.source,
          currentTarget: item.target,
        })
        const termPolicy = termPolicyBySegment.get(segment.id as string)?.matches ?? []
        const termMatches = termPolicy.map((item) => item.match)
        const tm = tmMatchesBySegment.get(segment.id as string) ?? []
        const tags = scanTagTokens(segment.source, {
          targetLocale: segment.targetLocale,
          ...(project.tagProfile !== undefined ? { profile: project.tagProfile } : {}),
        })
        const evidence: CatEvidenceRef[] = [
          { id: `segment:${segment.id as string}@${segment.revision}`, kind: 'segment-revision' },
          ...neighbors.previous.map((item) => ({
            id: `segment:${item.id as string}@${item.revision}`,
            kind: 'neighbor' as const,
          })),
          ...neighbors.next.map((item) => ({
            id: `segment:${item.id as string}@${item.revision}`,
            kind: 'neighbor' as const,
          })),
          ...termMatches.map((item) => ({ id: item.id, kind: 'term' as const })),
          ...tm.map((item) => ({ id: item.unitId, kind: 'tm' as const })),
        ]
        contexts.push({
          segmentId: segment.id as string,
          assetId: segment.assetId as string,
          revision: segment.revision,
          source: segment.source,
          currentTarget: segment.target,
          locked: segment.locked,
          ...(segment.context?.meta?.speaker !== undefined
            ? { speaker: segment.context.meta.speaker }
            : {}),
          ...(segment.context?.note !== undefined ? { notes: segment.context.note } : {}),
          previous: neighbors.previous.map(brief),
          next: neighbors.next.map(brief),
          tags,
          placeholderSignature: tags
            .filter((tag) => tag.group === 'placeholder')
            .map((tag) => tag.signature)
            .sort(),
          requiredTerms: termPolicy
            .filter((item) => item.enforcement === 'hard' && item.match.status === 'required')
            .map((item) => item.match),
          forbiddenTerms: termPolicy
            .filter((item) => item.enforcement === 'hard' && item.match.status === 'forbidden')
            .map((item) => item.match),
          preferredTerms: termPolicy
            .filter((item) => item.enforcement === 'advisory')
            .map((item) => item.match),
          conflicts: termMatches.filter((term) => term.conflict),
          tm,
          linkedContext: linkedContextBySegment.get(segment.id as string) ?? [],
          warnings: [
            ...(segment.locked ? ['Segment is locked.'] : []),
            ...(termMatches.some((term) => term.conflict)
              ? ['Conflicting terminology evidence.']
              : []),
            ...(termPolicy.some((item) => item.reasons.includes('scope_unknown'))
              ? ['Terminology scope is unknown; treat it as advisory.']
              : []),
            ...((pendingEvidenceBySegment.get(segment.id as string)?.length ?? 0) > 0
              ? ['Required Context evidence is pending explicit fetch.']
              : []),
          ],
          evidence,
        })
      }
      const snapshotFor = (items: readonly SegmentTranslationContext[]): string => {
        const ids = new Set(items.map(item => item.segmentId))
        const assets = new Set(items.map(item => item.assetId))
        const documents = contextEvidence.flatMap(({ doc, version, links }) => {
          const relevant = links.filter(link => link.relation.kind === 'segment' ? ids.has(link.relation.segmentId) : assets.has(link.relation.assetId))
          return relevant.length === 0 ? [] : [{ docId: doc.id, version, links: relevant }]
        })
        return fnv1a64(JSON.stringify({ contexts: items, rules: allRules, documents }))
      }
      if (snapshot !== undefined && snapshot !== snapshotFor(contexts)) throw new LinguistCatContextDriftError()
      const measured = (value: CatGetTranslationContextResult): number => {
        const details = deps.resultProjectId === undefined
          ? value
          : {
              ...value,
              projectId: deps.resultProjectId,
              ...(value.contexts[0] === undefined
                ? {}
                : { segmentId: value.contexts[0].segmentId }),
            }
        return Buffer.byteLength(JSON.stringify(details), 'utf8')
      }
      const requiredPendingFor = (
        items: readonly SegmentTranslationContext[],
      ): CatRequiredEvidencePending[] => {
        const pending = new Map<string, CatRequiredEvidencePending>()
        for (const item of items) {
          for (const evidence of pendingEvidenceBySegment.get(item.segmentId) ?? []) {
            const key = `${evidence.docId}\u0000${evidence.kind}\u0000${evidence.reason}`
            const current = pending.get(key)
            if (current === undefined) pending.set(key, { ...evidence, anchorIds: [...evidence.anchorIds] })
            else current.anchorIds.push(...evidence.anchorIds)
          }
          const presentedAnchors = new Set(item.linkedContext.map((evidence) => evidence.anchorId ?? ''))
          for (const evidence of linkedContextBySegment.get(item.segmentId) ?? []) {
            if (evidence.requiredness !== 'required' || presentedAnchors.has(evidence.anchorId ?? '')) continue
            const key = `${evidence.docId}\u0000document\u0000budget`
            const current = pending.get(key)
            const anchorIds = evidence.anchorId === undefined ? [] : [evidence.anchorId]
            if (current === undefined) {
              pending.set(key, {
                docId: evidence.docId,
                filename: evidence.filename,
                anchorIds,
                kind: 'document',
                reason: '必需 Context 正文未进入当前预算页，需缩小 Segment 批次或调用 cat_read_context_doc',
              })
            } else current.anchorIds.push(...anchorIds)
          }
        }
        return [...pending.values()].map((item) => ({
          ...item,
          anchorIds: [...new Set(item.anchorIds)].sort(),
        }))
      }
      const stageSummary = (): CatGetTranslationContextResult['stageEvidence'] => {
        if (deps.stageEvidenceRunId === undefined) return undefined
        const state = db.stageEvidence.get(deps.stageEvidenceRunId)
        if (state === undefined) throw new Error('Host Stage Evidence state is missing')
        const coverage = db.stageEvidence.getPresentationCoverage(state.stageRunId)
        return {
          stageRunId: state.stageRunId,
          status: state.status,
          required: coverage.required,
          presented: coverage.presented,
          pending: coverage.pending.length,
        }
      }
      const page = (
        items: SegmentTranslationContext[],
        minimumRequiredBytes?: number,
      ): CatGetTranslationContextResult => {
        const nextIndex = cursorOffset + items.length
        const truncated = nextIndex < params.segmentIds.length
        const requiredEvidencePending = requiredPendingFor(items)
        const evidenceSummary = stageSummary()
        const result: CatGetTranslationContextResult = {
          contexts: items,
          totalRequested: params.segmentIds.length,
          cursor: params.cursor ?? null,
          truncated,
          // LA-CONTEXT-002：预算不足的空页不得推进 cursor，也不给续页建议。
          ...(truncated && items.length > 0
            ? {
                nextCursor: `ctx3-${cursorKey}-${snapshotFor(contexts.slice(items.length))}-${nextIndex}`,
                suggestedSegmentIds: params.segmentIds.slice(nextIndex),
              }
            : {}),
          ...(projectRules.length > 0 ? { projectRules } : {}),
          ...(requiredEvidencePending.length > 0 ? { requiredEvidencePending } : {}),
          ...(evidenceSummary === undefined ? {} : { stageEvidence: evidenceSummary }),
          ...(minimumRequiredBytes !== undefined ? { minimumRequiredBytes } : {}),
          maxBytes,
          usedBytes: 0,
        }
        for (let index = 0; index < 4; index += 1) {
          const size = measured(result)
          if (size === result.usedBytes) break
          result.usedBytes = size
        }
        return result
      }
      // LA-CONTEXT-002 最小核心：identity/revision/完整 source + current target/locked/placeholderSignature。
      // 预算只裁次级字段，返回页的双语正文永不置空或截半截。
      const minimalCore = (context: SegmentTranslationContext): SegmentTranslationContext => ({
        segmentId: context.segmentId,
        assetId: context.assetId,
        revision: context.revision,
        source: context.source,
        currentTarget: context.currentTarget,
        locked: context.locked,
        previous: [],
        next: [],
        tags: [],
        placeholderSignature: context.placeholderSignature,
        requiredTerms: [],
        forbiddenTerms: [],
        preferredTerms: [],
        conflicts: [],
        tm: [],
        linkedContext: [],
        warnings: [
          ...(context.locked ? ['Segment is locked.'] : []),
          'Context fields were truncated to fit maxBytes.',
        ],
        evidence: [],
      })
      // 逐段装页：优先全量段；全量放不下先核最小核心；核心也超预算即停止装页。
      let selected: SegmentTranslationContext[] = []
      let minimumRequiredBytes: number | undefined
      for (const context of contexts) {
        const candidate = [...selected, context]
        if (measured(page(candidate)) <= maxBytes) {
          selected = candidate
          continue
        }
        const coreCandidate = [...selected, minimalCore(context)]
        const coreBytes = measured(page(coreCandidate))
        if (coreBytes > maxBytes) {
          if (selected.length === 0) minimumRequiredBytes = coreBytes
          break
        }
        selected = coreCandidate
      }
      // 第一段最小核心都放不下 → contexts=[] + minimumRequiredBytes，cursor 不推进。
      const dto = selected.length === 0 && minimumRequiredBytes !== undefined
        ? page([], minimumRequiredBytes)
        : page(selected)
      if (measured(dto) > maxBytes) {
        throw new LinguistCatInvalidArgumentError(
          'maxBytes',
          'budget cannot hold the minimum context envelope',
        )
      }
      const presented: StageEvidenceReceipt['evidence'] = []
      for (const context of dto.contexts) {
        presented.push({ ref: { kind: 'asset', id: context.assetId }, anchorIds: [] })
        for (const evidence of context.linkedContext) {
          const source = contextEvidence.find(item => item.doc.id === evidence.docId)
          const anchor = evidence.anchorId === undefined ? undefined : source?.anchors.get(evidence.anchorId)
          const textRange = anchor?.locator.textRange ?? (evidence.anchorId === undefined && source?.doc.textExtract === evidence.text
            ? { start: 0, end: evidence.text.length } : undefined)
          presented.push({ ref: { kind: 'context-doc', id: evidence.docId }, anchorIds: evidence.anchorId === undefined ? [] : [evidence.anchorId],
            ...(textRange === undefined ? {} : { textRange }) })
        }
      }
      for (const rule of dto.projectRules ?? []) presented.push({ ref: { kind: 'style-rule', id: rule.ruleId }, anchorIds: [] })
      const result = toolResult(dto, deps.resultProjectId, dto.contexts.map((context) => context.segmentId))
      runtime.prepareEvidencePresentation(
        db,
        toolCallId,
        dto.contexts.map((context) => context.segmentId),
        presented,
        result.content,
      )
      return result
    },
  })

  const searchTmTool = defineTool({
    name: 'cat_search_tm',
    label: 'CAT search TM',
    description:
      'Search the translation memory of the bound CAT project. concordance mode is a case-insensitive literal substring ' +
      'over TM source or target; segment mode ranks complete-source matches deterministically. Returns at most ' +
      `${CAT_TOOL_PAGE_LIMITS.searchTm.maxLimit} units per call (default ${CAT_TOOL_PAGE_LIMITS.searchTm.defaultLimit}). ` +
      'An empty result carries a note and is not an error.',
    promptSnippet: 'Search the bound project translation memory',
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      mode: Type.Optional(Type.Union([Type.Literal('concordance'), Type.Literal('segment')])),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(toolCallId, params) {
      const { query } = params
      if (query.trim() === '') {
        throw new LinguistCatInvalidArgumentError('query', 'expected a non-empty string')
      }
      const mode = params.mode ?? 'concordance'
      const { project, db } = resolveBoundProject('cat_search_tm', toolCallId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.searchTm)
      let segmentMatches: TmMatchDiagnostics[] = []
      if (mode === 'segment') {
        const exactCandidates = db.tmUnits.listCandidates(
          project.sourceLocale,
          project.targetLocale,
          query,
        )
        const candidates = exactCandidates.length > 0
          ? exactCandidates
          : db.tmUnits.listCandidates(project.sourceLocale, project.targetLocale)
        segmentMatches = matchTmCandidates(query, candidates, { minimumScore: 75 })
      }
      const results: TmUnit[] | TmMatchDiagnostics[] = mode === 'segment'
        ? segmentMatches.slice(0, page.limit)
        : db.tmUnits.list({ query, limit: page.limit })
      const total = mode === 'segment' ? segmentMatches.length : db.tmUnits.count({ query })
      const dto: CatSearchTmResult = {
        query,
        results,
        total,
        limit: page.limit,
        mode,
        ...(total === 0 ? { note: EMPTY_TM_NOTE } : page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId)
    },
  })

  const searchTermsTool = defineTool({
    name: 'cat_search_terms',
    label: 'CAT search terms',
    description:
      'Search the termbase of the bound CAT project: case-insensitive literal substring over term ' +
      'or translation. Returns at most ' +
      `${CAT_TOOL_PAGE_LIMITS.searchTerms.maxLimit} entries per call (default ${CAT_TOOL_PAGE_LIMITS.searchTerms.defaultLimit}). ` +
      'An empty result carries a note and is not an error.',
    promptSnippet: 'Search the bound project termbase',
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(toolCallId, params) {
      const { query } = params
      if (query.trim() === '') {
        throw new LinguistCatInvalidArgumentError('query', 'expected a non-empty string')
      }
      const { db } = resolveBoundProject('cat_search_terms', toolCallId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.searchTerms)
      const results = db.termEntries.search({ query, limit: page.limit })
      const total = db.termEntries.count({ query })
      const dto: CatSearchTermsResult = {
        query,
        results,
        total,
        limit: page.limit,
        ...(total === 0 ? { note: EMPTY_TB_NOTE } : page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId)
    },
  })


  const searchSentencePatternsTool = defineTool({
    name: 'cat_search_sentence_patterns',
    label: 'CAT search sentence patterns',
    description:
      'Search the sentence-pattern library of the bound CAT project: optional case-insensitive literal ' +
      'substring over source/draft/suggested target, plus textType and status (confirmed/pending/rejected) ' +
      'filters. Returns at most ' +
      `${CAT_TOOL_PAGE_LIMITS.searchSentencePatterns.maxLimit} patterns per call (default ${CAT_TOOL_PAGE_LIMITS.searchSentencePatterns.defaultLimit}). ` +
      'An empty result carries a note and is not an error.',
    promptSnippet: 'Search the bound project sentence-pattern library',
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: 'Literal substring matched against source or targets.' })),
      textType: Type.Optional(Type.String({ description: 'Exact text_type filter (e.g. dialogue, ui).' })),
      status: Type.Optional(
        Type.Union([
          Type.Literal('confirmed'),
          Type.Literal('pending'),
          Type.Literal('rejected'),
        ]),
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(toolCallId, params) {
      if (params.query !== undefined && params.query.trim() === '') {
        throw new LinguistCatInvalidArgumentError('query', 'expected a non-empty string when provided')
      }
      if (params.status !== undefined && !SENTENCE_PATTERN_STATUSES.includes(params.status)) {
        throw new LinguistCatInvalidArgumentError(
          'status',
          `expected one of ${SENTENCE_PATTERN_STATUSES.join('/')}, got ${String(params.status)}`,
        )
      }
      const { db } = resolveBoundProject('cat_search_sentence_patterns', toolCallId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.searchSentencePatterns)
      const filter = {
        ...(params.query !== undefined ? { query: params.query } : {}),
        ...(params.textType !== undefined ? { textType: params.textType } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
      }
      const items = db.sentencePatterns.list({ ...filter, limit: page.limit, offset: page.offset })
      const total = db.sentencePatterns.count(filter)
      const dto: CatSearchSentencePatternsResult = {
        items,
        total,
        limit: page.limit,
        offset: page.offset,
        hasMore: pageHasMore(total, page.offset, items.length),
        ...(total === 0 ? { note: EMPTY_PATTERNS_NOTE } : page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId)
    },
  })

  const readContextDocTool = defineTool({
    name: 'cat_read_context_doc',
    label: 'CAT read context doc',
    description: 'Read bound project Context text by UTF-16 offset, or attach its image. Follow nextOffset for text and nextMetadataOffset at the same offset and returned limit for remaining anchors/warnings. maxBytes covers the final text envelope; image bytes remain separate. Reading only prepares evidence until a Provider response confirms submission.',
    promptSnippet: 'Read a bounded Context page or managed image',
    parameters: Type.Object({
      docId: Type.String({ minLength: 1 }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      metadataOffset: Type.Optional(Type.Integer({ minimum: 0 })),
      maxBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 262_144 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_read_context_doc', toolCallId)
      const doc = db.contextDocs.get(params.docId)
      if (doc === undefined) throw new StoreNotFoundError('context doc', params.docId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.readContextDoc)
      const maxBytes = params.maxBytes ?? 65_536
      const metadataOffset = params.metadataOffset ?? 0
      if (!Number.isInteger(maxBytes) || maxBytes < 1_024 || maxBytes > 262_144
        || !Number.isInteger(metadataOffset) || metadataOffset < 0) {
        throw new LinguistCatInvalidArgumentError('maxBytes/metadataOffset', 'invalid page budget or metadata position')
      }
      const extract = doc.textExtract ?? ''
      if (page.offset > extract.length) throw new LinguistCatInvalidArgumentError('offset', 'outside Context text')
      const anchors = db.contextDocs.listAnchors(doc.id)
      let textLength = Math.min(page.limit, extract.length - page.offset)
      let metadataLimit = 20
      const makePage = (): CatReadContextDocResult => {
        const end = page.offset + textLength
        const related = anchors.filter(anchor => anchor.locator.textRange
          ? anchor.locator.textRange.start < end && anchor.locator.textRange.end > page.offset
          : page.offset === 0)
        const selected = related.slice(metadataOffset, metadataOffset + metadataLimit)
        const warnings = doc.extractionWarnings.slice(metadataOffset, metadataOffset + metadataLimit)
        const media = selected.flatMap(anchor => {
          if (anchor.mediaContextDocId === undefined) return []
          const mediaDoc = db.contextDocs.get(anchor.mediaContextDocId)
          return mediaDoc === undefined ? [] : [{ docId: mediaDoc.id, filename: mediaDoc.originalFilename, anchorIds: [anchor.id] }]
        })
        const dto: CatReadContextDocResult = {
          docId: doc.id, kind: doc.kind, filename: doc.originalFilename, createdAt: doc.createdAt,
          ...(doc.sha256 === undefined ? {} : { sha256: doc.sha256 }),
          ...(doc.note === undefined ? {} : { docNote: doc.note }),
          offset: page.offset, limit: textLength || page.limit, totalChars: extract.length,
          hasMore: end < extract.length,
          ...(end < extract.length ? { nextOffset: end } : {}),
          ...(doc.textExtract === undefined ? {} : { text: extract.slice(page.offset, end) }),
          // 正文仅在 text 中；目录不再重复整段 anchor.text。
          anchors: selected.map(({ text: _text, ...anchor }) => anchor),
          extractedMedia: media,
          extractionWarnings: warnings,
          metadataOffset, anchorCount: related.length, warningCount: doc.extractionWarnings.length,
          ...(metadataOffset + metadataLimit < Math.max(related.length, doc.extractionWarnings.length)
            ? { nextMetadataOffset: metadataOffset + metadataLimit } : {}),
          ...(doc.kind === 'image' ? { note: IMAGE_DOC_NOTE }
            : doc.textExtract === undefined ? { note: NO_EXTRACT_NOTE }
              : page.note === undefined ? {} : { note: page.note }),
          maxBytes, usedBytes: 0,
        }
        for (let index = 0; index < 4; index += 1) {
          const bytes = Buffer.byteLength(JSON.stringify(toolResult(dto, deps.resultProjectId).details), 'utf8')
          if (bytes === dto.usedBytes) break
          dto.usedBytes = bytes
        }
        return dto
      }
      let dto = makePage()
      while (dto.usedBytes! > maxBytes && (textLength > 1 || metadataLimit > 1)) {
        if (textLength > 1) textLength = Math.max(1, Math.floor(textLength / 2))
        else metadataLimit = Math.max(1, Math.floor(metadataLimit / 2))
        dto = makePage()
      }
      if (dto.usedBytes! > maxBytes) {
        const insufficient: CatReadContextDocResult = {
          docId: doc.id, kind: doc.kind, filename: doc.originalFilename, createdAt: doc.createdAt,
          offset: page.offset, limit: page.limit, totalChars: extract.length, hasMore: page.offset < extract.length,
          metadataOffset, minimumRequiredBytes: dto.usedBytes, maxBytes,
          note: 'Budget cannot hold one text unit and one metadata item; increase maxBytes.',
        }
        return toolResult(insufficient, deps.resultProjectId)
      }
      const result = toolResult(dto, deps.resultProjectId)
      if (doc.kind === 'image' && deps.readContextImage !== undefined) {
        const image = await deps.readContextImage(doc.id)
        result.content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }
      const evidenceDocId = doc.parentContextDocId ?? doc.id
      const evidenceAnchors = doc.parentContextDocId === undefined ? anchors
        : db.contextDocs.listAnchors(evidenceDocId).filter(anchor => anchor.mediaContextDocId === doc.id)
      const requirement = deps.stageEvidenceRunId === undefined ? undefined
        : db.stageEvidence.get(deps.stageEvidenceRunId)?.plan.requirements.find(item => item.evidence.ref.kind === 'context-doc' && item.evidence.ref.id === evidenceDocId)
      const visual = result.content.filter(block => block.type === 'image')
      if (textLength > 0 || visual.length > 0) runtime.prepareEvidencePresentation(
        db, toolCallId, requirement?.scope.kind === 'segments' ? requirement.scope.segmentIds : [],
        [{ ref: { kind: 'context-doc', id: evidenceDocId }, anchorIds: visual.length > 0 ? evidenceAnchors.map(anchor => anchor.id) : [],
          ...(visual.length > 0 ? { visual: true } : { textRange: { start: page.offset, end: page.offset + textLength } }) }],
        visual.length > 0 ? visual : result.content,
      )
      return result
    },
  })

return [
    getTranslationContextTool,
    searchTmTool,
    searchTermsTool,
    searchSentencePatternsTool,
    readContextDocTool,
  ] as const
}
