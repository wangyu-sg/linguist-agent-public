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
import { shareTranslationContexts, type ResolvedTranslationContext } from './context-response'
import { pageHasMore, resolvePage } from './pagination'
import {
  CAT_TOOL_PAGE_LIMITS,
  type CatEvidenceRef,
  type CatGetTranslationContextResult,
  type CatLinkedContextEvidence,
  type CatProjectRuleItem,
  type CatReadContextDocResult,
  type CatUnprovidedReference,
  type CatSearchSentencePatternsResult,
  type CatSearchTermsResult,
  type CatSearchTmResult,
  type CatSegmentBrief,
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
  'No plain-text extract is available. Inspect the authorized original with existing file/vision tools when its path or reference is known; do not invent a path or claim generic reading creates CAT evidence. Report only the task-relevant facts that remain unavailable.'
const SENTENCE_PATTERN_STATUSES = [
  'confirmed',
  'pending',
  'rejected',
] as const

/** 每页规则上限；余项通过同一工具续读。 */
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
): { offset: number; snapshot?: string; fragmentOffset?: number } {
  if (cursor === undefined) return { offset: 0 }
  const match = /^ctx([234])-([0-9a-f]{16})-([0-9a-f]+)-(\d+)(?:-(\d+))?$/.exec(cursor)
  if (match === null || match[2] !== key || Number(match[4]) >= total || (match[1] === '4') !== (match[5] !== undefined)) {
    throw new LinguistCatInvalidArgumentError('cursor', 'does not belong to this translation-context request')
  }
  if (match[1] === '2') {
    if (!/^\d+$/.test(match[3]!) || Number(match[3]) !== latestEventSequence) throw new LinguistCatContextDriftError()
    return { offset: Number(match[4]) }
  }
  return { offset: Number(match[4]), snapshot: match[3], ...(match[1] === '4' ? { fragmentOffset: Number(match[5]) } : {}) }
}

/** TM、术语、句式库和 Context 文档的只读检索工具。 */
export function createReferenceTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject } = runtime

  const getTranslationContextTool = defineTool({
    name: 'cat_get_translation_context',
    label: 'CAT get translation context',
    description: 'Read complete Source/current Target and relevant evidence for 1–50 segment IDs. The read page is not the task, review group or commit boundary. Each response is self-contained: segment refs resolve to shared Context/Voice/neighbor content in that response; source, revision, scope and requiredness remain attached. Execution reads establish/continue the trusted Stage; readOnly=true creates neither Stage nor evidence receipts. Follow the returned cursor and ruleCoverage positions with the same request. unprovidedReferences describes content omitted from this response, not proof that the Stage has never received it or that the model currently remembers it. Resolve genuinely missing or currently needed evidence before claiming its dependent work complete. Content preparation is not Provider submission. If contextFragment is returned, collect its returned continuation until the JSON is complete; on CONTEXT_DRIFT retrieve the affected current content.',
    promptSnippet: 'Read bounded batch translation context from the bound CAT project',
    parameters: Type.Object({
      segmentIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 50, description: 'The current page of 1-50 existing segment IDs, in input order. For a full batch/project execution task, declare its full stageScope on the first read; this page does not redefine the whole task. Keep the same full array when continuing its nextCursor or rules-only pages.' }),
      includeNeighbors: Type.Optional(Type.Boolean({ description: 'Include adjacent context when useful. Omitted=true behavior remains unchanged. This affects returned context, not the task scope.' })),
      neighborCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 5, description: 'Number of adjacent segments on each side, 0-5. Keep unchanged when continuing a text cursor.' })),
      tmLimitPerSegment: Type.Optional(Type.Integer({ minimum: 0, maximum: 10, description: 'Maximum optional TM evidence per segment, 0-10; keep unchanged with a text cursor. A match is reference evidence, not automatic approval.' })),
      termLimitPerSegment: Type.Optional(Type.Integer({ minimum: 0, maximum: 10, description: 'Advisory match limit, 0-10. Required/forbidden authority and conflicts remain available even at 0. Keep unchanged with a text cursor.' })),
      maxBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 262_144, description: 'UTF-8 byte budget for the complete text result, 1024-262144. Default 65536. Oversized single-context content uses contextFragment and nextCursor; continue with the same request.' })),
      cursor: Type.Optional(Type.String({ description: 'The exact nextCursor from a prior text page. Reuse the same original segmentIds and matching options; For rulesOnly, use it only to continue a contextFragment. Never combine with restartStage=true.' })),
      stageScope: Type.Optional(Type.Union([Type.Literal('segments'), Type.Literal('batches'), Type.Literal('project')], { description: 'Execution task scope on the first read: segments freezes exactly these IDs; batches freezes every segment in each batch represented by these IDs; project freezes the entire bound project. Omit on continuation. Not permitted with readOnly=true; never broaden a selected subset to all batches to bypass the 50-ID read limit.' })),
      restartStage: Type.Optional(Type.Boolean({ description: 'True only when the user explicitly requests a new professional round, such as reviewing the same scope again. Omit/false for continuation, pagination, retries and ordinary resume. Requires a fresh request without cursor and cannot be used with readOnly=true.' })),
      rulesOnly: Type.Optional(Type.Boolean({ description: 'Return an applicable-rules page without rebuilding segment context/TM. Use the same segmentIds and rulesOffset from ruleCoverage.nextOffset. Omit stageScope and restartStage on continuation; keep cursor only for a contextFragment; preserve readOnly=true for inspection.' })),
      rulesOffset: Type.Optional(Type.Integer({ minimum: 0, description: 'Offset in the applicable rules for this exact segmentIds request. Start at 0 and follow ruleCoverage.nextOffset. After all these rules were actually read and remain in current context, later text pages of the same request may use ruleCoverage.total to avoid repeating them. Do not carry this offset to a different segment batch or treat skipped rules as read.' })),
      readOnly: Type.Optional(Type.Boolean({
        description: 'When true, inspect content without creating/replacing a professional Stage or preparing evidence receipts. Use for reports or proposal preparation. Does not disable binding validation or make later write tools read-only. Omitted/false preserves execution behavior.',
      })),
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
      const readOnly = params.readOnly === true
      if (readOnly && params.stageScope !== undefined) {
        throw new LinguistCatInvalidArgumentError('stageScope', 'cannot be used with readOnly=true')
      }
      if (readOnly && params.restartStage === true) {
        throw new LinguistCatInvalidArgumentError('restartStage', 'cannot be used with readOnly=true')
      }
      const { project, db } = resolveBoundProject('cat_get_translation_context', toolCallId)
      if (params.cursor !== undefined && params.restartStage) throw new LinguistCatInvalidArgumentError('restartStage', 'restart from a fresh context request without cursor')
      if (!readOnly) runtime.prepareStage(params.segmentIds, {
        scope: params.stageScope === 'batches' ? 'assets' : params.stageScope,
        restart: params.restartStage,
        toolCallId,
      })
      const cursorKey = translationContextCursorKey(
        params.segmentIds,
        neighborCount,
        tmLimit,
        termLimit,
      )
      const { offset: cursorOffset, snapshot, fragmentOffset } = translationContextCursorOffset(
        params.cursor,
        cursorKey,
        params.segmentIds.length,
        db.runs.latestEventSequence,
      )
      const segments = db.segments.getByIds(params.segmentIds)
      if (segments.length !== params.segmentIds.length) {
        const found = new Set(segments.map((segment) => segment.id as string))
        throw new StoreNotFoundError(
          'segment',
          params.segmentIds.find((segmentId) => !found.has(segmentId))!,
        )
      }
      const allRules = db.getProjectRules(segments)
      const rulesOffset = params.rulesOffset ?? 0
      if (!Number.isInteger(rulesOffset) || rulesOffset < 0 || rulesOffset > allRules.length) throw new LinguistCatInvalidArgumentError('rulesOffset', 'outside current rule set')
      let projectRules: CatProjectRuleItem[] = allRules.slice(rulesOffset, rulesOffset + PROJECT_RULES_LIMIT)
      const remainingSegments = params.rulesOnly ? [] : segments.slice(cursorOffset)
      const linkedContextBySegment = new Map<string, CatLinkedContextEvidence[]>()
      const pendingEvidenceBySegment = new Map<string, Array<Omit<CatUnprovidedReference, 'segmentIds' | 'history'>>>()
      const contextDocs = params.rulesOnly ? [] : db.contextDocs.list({ limit: db.contextDocs.count() })
      const requestedIds = new Set(remainingSegments.map(segment => segment.id as string))
      const requestedAssets = new Set(remainingSegments.map(segment => segment.assetId as string))
      const contextEvidence = contextDocs.flatMap(doc => {
        const links = db.contextDocs.listEvidenceLinks(doc.id).filter(link => link.relation.kind === 'segment'
          ? requestedIds.has(link.relation.segmentId) : requestedAssets.has(link.relation.assetId))
        if (links.length === 0) return []
        const anchors = new Map(db.contextDocs.listAnchors(doc.id).map(anchor => [anchor.id, anchor]))
        return [{ doc, anchors, links, version: db.contextDocs.documentVersion(doc.id)! }]
      })
      for (const segment of remainingSegments) {
        const linkedContext: CatLinkedContextEvidence[] = []
        const pending: Array<Omit<CatUnprovidedReference, 'segmentIds' | 'history'>> = []
        for (const { doc, anchors, links, version } of contextEvidence) {
          const grouped = new Map<string, 'required' | 'conditional' | 'optional'>()
          for (const link of links) {
            const relevant = link.relation.kind === 'segment'
              ? link.relation.segmentId === segment.id
              : link.relation.assetId === segment.assetId
            if (!relevant) continue
            const key = link.anchorId ?? ''
            const current = grouped.get(key)
            if (current === undefined || REQUIREDNESS_RANK[link.requiredness] > REQUIREDNESS_RANK[current]) {
              grouped.set(key, link.requiredness)
            }
          }
          for (const [anchorId, requiredness] of grouped) {
            const anchor = anchorId === '' ? undefined : anchors.get(anchorId)
            const text = anchor?.text ?? (anchor === undefined ? doc.textExtract : undefined)
            if (doc.kind !== 'image' && anchor?.mediaContextDocId === undefined && text !== undefined && text.length <= INLINE_CONTEXT_TEXT_MAX_CHARS) {
              linkedContext.push({
                docId: doc.id,
                version,
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
              sourceRef: { kind: 'context-doc', id: doc.id },
              version,
              docId: media?.id ?? doc.id,
              filename: media?.originalFilename ?? doc.originalFilename,
              anchorIds: anchor === undefined ? [] : [anchor.id],
              kind: media !== undefined || doc.kind === 'image' ? 'image' : 'document',
              reason: media !== undefined || doc.kind === 'image'
                ? '本响应未附必要图像'
                : text === undefined ? '必要原件尚无可用正文抽取' : '必要正文超过本响应自动附带上限',
              retrieve: {
                tool: 'cat_read_context_doc', docId: media?.id ?? doc.id,
                ...(anchor?.locator.textRange === undefined || media !== undefined ? {} : {
                  offset: anchor.locator.textRange.start,
                  limit: anchor.locator.textRange.end - anchor.locator.textRange.start,
                }),
              },
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
      for (const segment of remainingSegments) {
        const evaluated = db.termEntries.evaluateSegment(segment)
        termPolicyBySegment.set(segment.id as string, {
          matches: [...evaluated.matches.filter(item => item.enforcement === 'hard' || item.match.conflict),
            ...evaluated.matches.filter(item => item.enforcement !== 'hard' && !item.match.conflict).slice(0, termLimit)],
        })
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
      const voices = remainingSegments.some(segment => segment.context?.meta?.speaker !== undefined) ? db.voiceProfiles.list({ limit: db.voiceProfiles.count() }) : []
      const contexts: ResolvedTranslationContext[] = []
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
          batchId: segment.assetId as string,
          revision: segment.revision,
          source: segment.source,
          currentTarget: segment.target,
          locked: segment.locked,
          originalOrdinal: segment.ordinal + 1,
          ...(segment.key === undefined ? {} : { key: segment.key }),
          ...(segment.context?.origin === undefined ? {} : { origin: segment.context.origin }),
          ...Object.fromEntries(['textType', 'module', 'category'].flatMap(key => {
            const value = segment.context?.meta?.[key]
            return value === undefined ? [] : [[key, value]]
          })),
          ...(segment.context?.meta?.speaker === undefined ? {} : { voiceProfiles: voices.filter(profile => profile.speaker === segment.context?.meta?.speaker) }),
          ...(segment.context?.meta?.speaker !== undefined
            ? { speaker: segment.context.meta.speaker }
            : {}),
          ...(segment.context?.note !== undefined ? { notes: segment.context.note } : {}),
          previous: neighbors.previous.map(brief),
          next: neighbors.next.map(brief),
          tags,
          targetTags: scanTagTokens(segment.target, {
            targetLocale: segment.targetLocale,
            ...(project.tagProfile === undefined ? {} : { profile: project.tagProfile }),
          }),
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
          ],
          evidence,
        })
      }
      const snapshotFor = (items: readonly ResolvedTranslationContext[]): string => {
        const ids = new Set(items.map(item => item.segmentId))
        const batches = new Set(items.map(item => item.batchId))
        const documents = contextEvidence.flatMap(({ doc, version, links }) => {
          const relevant = links.filter(link => link.relation.kind === 'segment' ? ids.has(link.relation.segmentId) : batches.has(link.relation.assetId))
          return relevant.length === 0 ? [] : [{ docId: doc.id, version, links: relevant }]
        })
        return fnv1a64(JSON.stringify({ contexts: items, rules: allRules, documents }))
      }
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
      const stageState = deps.stageEvidenceRunId === undefined ? undefined : db.stageEvidence.get(deps.stageEvidenceRunId)
      if (!readOnly && deps.stageEvidenceRunId !== undefined && stageState === undefined) throw new Error('Host Stage Evidence state is missing')
      const completion = stageState === undefined ? undefined : db.stageEvidence.getCompletion(stageState.stageRunId)
      const historicalVersions = new Map<string, string | undefined>()
      const historicalCoverage = (reference: Omit<CatUnprovidedReference, 'history'>): CatUnprovidedReference['history'] => {
        if (stageState === undefined || completion === undefined) return { status: 'not-tracked' }
        const requirement = stageState.plan.requirements.find(item => item.evidence.ref.kind === 'context-doc'
          && item.evidence.ref.id === reference.sourceRef.id && item.requiredness === 'required')
        if (requirement === undefined) return { status: 'not-tracked', stageRunId: stageState.stageRunId }
        const id = reference.sourceRef.id
        if (!historicalVersions.has(id)) historicalVersions.set(id, db.contextDocs.evidenceVersion(id, stageState.plan.segmentIds, stageState.plan.assetIds))
        const history = { stageRunId: stageState.stageRunId, version: requirement.evidence.version }
        if (historicalVersions.get(id) !== requirement.evidence.version) return { ...history, status: 'unknown' }
        const missing = completion.presentation.pending.find(item => item.evidence.kind === 'context-doc' && item.evidence.id === id)
        const pending = missing !== undefined && (reference.anchorIds.length === 0 || missing.anchorIds.length === 0
          || reference.anchorIds.some(anchor => missing.anchorIds.includes(anchor)))
        return { ...history, status: pending ? 'pending' : 'covered' }
      }
      const unprovidedFor = (items: readonly ResolvedTranslationContext[]): CatUnprovidedReference[] => {
        const omitted = new Map<string, Omit<CatUnprovidedReference, 'history'>>()
        for (const item of items) {
          const included = new Set(item.linkedContext.map(evidence => `${evidence.docId}\u0000${evidence.anchorId ?? ''}`))
          const references: Array<Omit<CatUnprovidedReference, 'segmentIds' | 'history'>> = [
            ...(pendingEvidenceBySegment.get(item.segmentId) ?? []),
            ...(linkedContextBySegment.get(item.segmentId) ?? [])
              .filter(evidence => evidence.requiredness === 'required' && !included.has(`${evidence.docId}\u0000${evidence.anchorId ?? ''}`))
              .map(evidence => ({
                sourceRef: { kind: 'context-doc' as const, id: evidence.docId },
                version: evidence.version, docId: evidence.docId, filename: evidence.filename,
                anchorIds: evidence.anchorId === undefined ? [] : [evidence.anchorId],
                kind: 'document' as const, reason: '必要正文未附在本响应预算页',
                retrieve: { tool: 'cat_read_context_doc' as const, docId: evidence.docId },
              })),
          ]
          for (const reference of references) {
            const key = JSON.stringify([reference.sourceRef, reference.version, reference.docId, reference.kind, reference.reason])
            const current = omitted.get(key)
            if (current === undefined) omitted.set(key, { ...reference, anchorIds: [...reference.anchorIds], segmentIds: [item.segmentId] })
            else {
              current.anchorIds.push(...reference.anchorIds)
              current.segmentIds.push(item.segmentId)
              if (JSON.stringify(current.retrieve) !== JSON.stringify(reference.retrieve)) current.retrieve = { tool: 'cat_read_context_doc', docId: reference.docId }
            }
          }
        }
        return [...omitted.values()].map(item => {
          const reference = { ...item, anchorIds: [...new Set(item.anchorIds)].sort(), segmentIds: [...new Set(item.segmentIds)] }
          return { ...reference, history: historicalCoverage(reference) }
        })
      }
      const evidenceSummary: CatGetTranslationContextResult['stageEvidence'] = readOnly || stageState === undefined || completion === undefined ? undefined : {
        stageRunId: stageState.stageRunId,
        status: completion.status,
        scopeSegments: completion.decisions.total,
        pendingSegments: completion.decisions.pending,
        blockedSegments: completion.decisions.blocked,
        required: completion.presentation.required,
        presented: completion.presentation.presented,
        pending: completion.presentation.pending.length,
      }
      const page = (items: ResolvedTranslationContext[]): CatGetTranslationContextResult => {
        const nextIndex = cursorOffset + items.length
        const truncated = !params.rulesOnly && nextIndex < params.segmentIds.length
        const unprovidedReferences = unprovidedFor(items)
        const result: CatGetTranslationContextResult = {
          contextFormatVersion: 2,
          ...shareTranslationContexts(items),
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
          ruleCoverage: { total: allRules.length, offset: rulesOffset, provided: projectRules.length,
            remaining: allRules.length - rulesOffset - projectRules.length,
            ...(rulesOffset + projectRules.length < allRules.length && (!params.rulesOnly || projectRules.length > 0) ? { nextOffset: rulesOffset + projectRules.length } : {}) },
          ...(unprovidedReferences.length > 0 ? { unprovidedReferences } : {}),
          ...(evidenceSummary === undefined ? {} : { stageEvidence: evidenceSummary }),
          ...(readOnly ? { readOnly: true } : {}),
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
      const minimalCore = (context: ResolvedTranslationContext, sharedWith: readonly ResolvedTranslationContext[] = []): ResolvedTranslationContext => ({
        ...context,
        previous: [], next: [], preferredTerms: [],
        linkedContext: context.linkedContext.filter(link => sharedWith.some(other => other.linkedContext.some(included =>
          included.docId === link.docId && included.version === link.version && included.anchorId === link.anchorId && included.text === link.text))),
        warnings: [...context.warnings, 'Optional context fields were omitted to fit maxBytes; required references are listed separately.'],
        evidence: context.evidence.filter(item => item.kind !== 'neighbor'),
      })
      // 分片还绑定本次历史覆盖描述，避免补读原件后混接不同 JSON。
      const fragmentSnapshot = (): string => fnv1a64(JSON.stringify([
        snapshotFor(contexts), rulesOffset, params.rulesOnly === true,
        unprovidedFor(contexts.slice(0, 1).map(context => minimalCore(context))),
      ]))
      if (snapshot !== undefined && snapshot !== (fragmentOffset === undefined ? snapshotFor(contexts) : fragmentSnapshot())) throw new LinguistCatContextDriftError()
      // 规则有独立续读；普通上下文先给必要句段，规则页则只受自身预算限制。
      while (projectRules.length > 0 && measured(page(params.rulesOnly || contexts[0] === undefined ? [] : [minimalCore(contexts[0])])) > maxBytes) projectRules = projectRules.slice(0, -1)
      const oversizedRule = params.rulesOnly && projectRules.length === 0 && rulesOffset < allRules.length
      // 逐段装页：优先全量段；全量放不下先核最小核心；核心也超预算即停止装页。
      let selected: ResolvedTranslationContext[] = []
      let oversizedContext = false
      for (const context of params.rulesOnly ? [] : contexts) {
        const candidate = [...selected, context]
        if (measured(page(candidate)) <= maxBytes) {
          selected = candidate
          continue
        }
        const coreCandidate = [...selected, minimalCore(context, selected)]
        const coreBytes = measured(page(coreCandidate))
        if (coreBytes > maxBytes) {
          if (selected.length === 0) oversizedContext = true
          break
        }
        selected = coreCandidate
      }
      // 不可再缩小的载荷由分片路径处理。
      let dto = page(selected)
      let payloadPart: StageEvidenceReceipt['evidence'][number]['payloadPart']
      let receiptContexts = selected
      let receiptRules = dto.projectRules ?? []
      if (fragmentOffset !== undefined || oversizedRule || oversizedContext) {
        // 核心与必需引用清单按完整 JSON 续读；正文仍由 Context 文档工具提供。
        receiptContexts = contexts.slice(0, 1).map(context => minimalCore(context))
        receiptRules = allRules.slice(rulesOffset, rulesOffset + PROJECT_RULES_LIMIT)
        const payload = JSON.stringify({ contextFormatVersion: 2, ...shareTranslationContexts(receiptContexts), projectRules: receiptRules,
          unprovidedReferences: unprovidedFor(receiptContexts) })
        const start = fragmentOffset ?? 0
        if (!Number.isSafeInteger(start) || start < 0 || start >= payload.length) throw new LinguistCatInvalidArgumentError('cursor', 'invalid fragment offset')
        const snapshotHash = fragmentSnapshot()
        const makeFragment = (length: number): CatGetTranslationContextResult => {
          const end = start + length
          const more = end < payload.length
          const nextIndex = params.rulesOnly ? params.segmentIds.length : cursorOffset + 1
          const result: CatGetTranslationContextResult = {
            contextFormatVersion: 2, ...shareTranslationContexts([]), totalRequested: params.segmentIds.length, cursor: params.cursor ?? null,
            contextFragment: { encoding: 'json', offset: start, totalChars: payload.length, text: payload.slice(start, end) },
            truncated: more || nextIndex < params.segmentIds.length,
            ...(more ? { nextCursor: `ctx4-${cursorKey}-${snapshotHash}-${cursorOffset}-${end}` }
              : nextIndex < params.segmentIds.length ? { nextCursor: `ctx3-${cursorKey}-${snapshotFor(contexts.slice(1))}-${nextIndex}` } : {}),
            ruleCoverage: { total: allRules.length, offset: rulesOffset, provided: more ? 0 : receiptRules.length,
              remaining: allRules.length - rulesOffset - (more ? 0 : receiptRules.length),
              ...(!more && rulesOffset + receiptRules.length < allRules.length ? { nextOffset: rulesOffset + receiptRules.length } : {}) },
            ...(evidenceSummary === undefined ? {} : { stageEvidence: evidenceSummary }),
            ...(readOnly ? { readOnly: true } : {}), maxBytes, usedBytes: 0,
          }
          for (let index = 0; index < 4; index++) result.usedBytes = measured(result)
          return result
        }
        let low = 0, high = Math.min(payload.length - start, maxBytes)
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          if (measured(makeFragment(middle)) <= maxBytes) low = middle
          else high = middle - 1
        }
        if (low === 0) throw new LinguistCatInvalidArgumentError('maxBytes', 'budget cannot hold a context fragment')
        dto = makeFragment(low)
        payloadPart = { hash: fnv1a64(payload), start, end: start + low, total: payload.length }
      }
      if (measured(dto) > maxBytes) {
        throw new LinguistCatInvalidArgumentError(
          'maxBytes',
          'budget cannot hold the minimum context envelope',
        )
      }
      const presented: StageEvidenceReceipt['evidence'] = []
      for (const context of receiptContexts) {
        presented.push({ ref: { kind: 'asset', id: context.batchId }, anchorIds: [] })
        for (const evidence of context.linkedContext) {
          const source = contextEvidence.find(item => item.doc.id === evidence.docId)
          const anchor = evidence.anchorId === undefined ? undefined : source?.anchors.get(evidence.anchorId)
          const textRange = anchor?.locator.textRange ?? (evidence.anchorId === undefined && source?.doc.textExtract === evidence.text
            ? { start: 0, end: evidence.text.length } : undefined)
          presented.push({ ref: { kind: 'context-doc', id: evidence.docId }, anchorIds: evidence.anchorId === undefined ? [] : [evidence.anchorId],
            ...(textRange === undefined ? {} : { textRange }) })
        }
      }
      for (const rule of receiptRules) presented.push({ ref: { kind: rule.kind, id: rule.ruleId }, anchorIds: [] })
      for (const context of receiptContexts) for (const profile of context.voiceProfiles ?? []) presented.push({ ref: { kind: 'voice-profile', id: profile.id }, anchorIds: [] })
      const result = toolResult(dto, deps.resultProjectId, dto.contexts.map((context) => context.segmentId))
      if (!readOnly) {
        runtime.prepareEvidencePresentation(
          db,
          toolCallId,
          receiptContexts.map((context) => context.segmentId),
          payloadPart === undefined ? presented : presented.map(item => ({ ...item, payloadPart })),
          result.content,
        )
      }
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
    description: 'Read bound-project Context text by UTF-16 offset, or return its managed image. Follow nextOffset for text. For nextMetadataOffset use metadataOnly=true with the returned docVersion, text offset and returned limit; change metadataOffset to read anchors/media/warnings without repeating the text. Metadata-only reads do not prepare body receipts. On version change fetch the affected current text. maxBytes bounds the full text envelope, not image bytes. Use readOnly=true for inspection/reports/proposal preparation: no Stage changes and no evidence preparation. Omitted/false preserves execution evidence behavior; preparing content is not proof that a model received it. Images require actual visual content and a capable configured model; filenames, directories or OCR text do not automatically satisfy visual evidence. If no extract exists, use authorized general file/vision capabilities to inspect the original where available; do not invent a path or claim generic reading creates CAT receipts. Only unresolved, task-relevant missing facts require user input. Never switch Provider without user authorization.',
    promptSnippet: 'Read a bounded Context page or managed image',
    parameters: Type.Object({
      docId: Type.String({ minLength: 1, description: 'Existing managed Context document ID from the bound project inventory, digest or context result; never a filesystem path.' }),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: 'UTF-16 text offset. Start at 0 and follow returned nextOffset; do not add the requested limit to guess the next page.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, description: 'Requested text length. For metadata continuation reuse the previous page\'s returned limit; actual text length may be smaller because of the byte budget.' })),
      metadataOffset: Type.Optional(Type.Integer({ minimum: 0, description: 'Start at 0. Follow nextMetadataOffset while keeping the same text offset and returned limit; this pages related anchors, images and warnings, not the document text.' })),
      metadataOnly: Type.Optional(Type.Boolean({ description: 'Return only anchor/media/warning metadata for a previously returned text range. Requires its docVersion, offset and returned limit. Does not repeat text or prepare a text-disclosure receipt; does not prove the text remains in model context.' })),
      docVersion: Type.Optional(Type.String({ minLength: 1, description: 'Exact document version from the preceding response. Required for metadataOnly; if it changed, retrieve the affected current text instead of joining versions.' })),
      maxBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 262_144, description: 'Complete text-envelope UTF-8 byte budget. Default 65536, maximum 262144. If minimumRequiredBytes is returned without a continuation, increase the budget; do not loop on an unchanged insufficient request.' })),
      readOnly: Type.Optional(Type.Boolean({
        description: 'When true, read content without changing a professional Stage or preparing evidence receipts. Omitted/false preserves execution evidence behavior.',
      })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_read_context_doc', toolCallId)
      const doc = db.contextDocs.get(params.docId)
      if (doc === undefined) throw new StoreNotFoundError('context doc', params.docId)
      const metadataOnly = params.metadataOnly === true
      if (metadataOnly && (params.docVersion === undefined || params.offset === undefined || params.limit === undefined)) {
        throw new LinguistCatInvalidArgumentError('metadataOnly', 'requires the previous docVersion, offset and returned limit')
      }
      // 文档续页还包含提取警告与备注；它们变化时同样不能拼接旧元数据页。
      const docVersion = db.contextDocs.documentVersion(doc.id)!
      if (params.docVersion !== undefined && params.docVersion !== docVersion) throw new LinguistCatContextDriftError()
      const readOnly = params.readOnly === true
      if (!readOnly && !metadataOnly) deps.prepareContextDoc?.(doc.parentContextDocId ?? doc.id)
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
          docVersion,
          ...(metadataOnly ? { metadataOnly: true } : {}),
          ...(doc.sha256 === undefined ? {} : { sha256: doc.sha256 }),
          ...(doc.note === undefined ? {} : { docNote: doc.note }),
          offset: page.offset, limit: textLength || page.limit, totalChars: extract.length,
          hasMore: end < extract.length,
          ...(end < extract.length ? { nextOffset: end } : {}),
          ...(metadataOnly || doc.textExtract === undefined ? {} : { text: extract.slice(page.offset, end) }),
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
          ...(readOnly ? { readOnly: true } : {}),
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
      while (dto.usedBytes! > maxBytes && ((!metadataOnly && textLength > 1) || metadataLimit > 1)) {
        if (!metadataOnly && textLength > 1) textLength = Math.max(1, Math.floor(textLength / 2))
        else metadataLimit = Math.max(1, Math.floor(metadataLimit / 2))
        dto = makePage()
      }
      if (dto.usedBytes! > maxBytes) {
        const insufficient: CatReadContextDocResult = {
          docId: doc.id, kind: doc.kind, filename: doc.originalFilename, createdAt: doc.createdAt,
          docVersion,
          ...(metadataOnly ? { metadataOnly: true } : {}),
          offset: page.offset, limit: page.limit, totalChars: extract.length, hasMore: page.offset < extract.length,
          metadataOffset, minimumRequiredBytes: dto.usedBytes, maxBytes,
          ...(readOnly ? { readOnly: true } : {}),
          note: 'Budget cannot hold the requested minimum page; increase maxBytes.',
        }
        return toolResult(insufficient, deps.resultProjectId)
      }
      const result = toolResult(dto, deps.resultProjectId)
      if (!metadataOnly && doc.kind === 'image' && deps.readContextImage !== undefined) {
        const image = await deps.readContextImage(doc.id)
        result.content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }
      const evidenceDocId = doc.parentContextDocId ?? doc.id
      const evidenceAnchors = doc.parentContextDocId === undefined ? anchors
        : db.contextDocs.listAnchors(evidenceDocId).filter(anchor => anchor.mediaContextDocId === doc.id)
      const requirement = deps.stageEvidenceRunId === undefined ? undefined
        : db.stageEvidence.get(deps.stageEvidenceRunId)?.plan.requirements.find(item => item.evidence.ref.kind === 'context-doc' && item.evidence.ref.id === evidenceDocId)
      const visual = result.content.filter(block => block.type === 'image')
      if (!readOnly && !metadataOnly && (textLength > 0 || visual.length > 0)) runtime.prepareEvidencePresentation(
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
