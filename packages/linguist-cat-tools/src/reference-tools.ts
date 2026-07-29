import { fnv1a64, scanTagTokens, type Segment } from '@linguist/cat-core'
import {
  StoreNotFoundError,
  type TermEntryMatch,
  type TmUnitMatch,
} from '@linguist/cat-store'
import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { pageHasMore, resolvePage } from './pagination'
import {
  CAT_TOOL_PAGE_LIMITS,
  type CatEvidenceRef,
  type CatGetTranslationContextResult,
  type CatReadContextDocResult,
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
  'This context doc is an image: its bytes are never returned by tools. Only metadata is available here; visual content must be described to you by the user.'
const NO_EXTRACT_NOTE =
  'This context doc has no plain-text extract (only binary/source bytes are stored). Ask the user for the relevant content if you need it.'
const SENTENCE_PATTERN_STATUSES = [
  'confirmed',
  'pending',
  'rejected',
] as const

function translationContextCursorKey(
  segmentIds: readonly string[],
  neighborCount: number,
  tmLimit: number,
  termLimit: number,
  includeProjectRules: boolean,
): string {
  return fnv1a64(JSON.stringify([
    segmentIds,
    neighborCount,
    tmLimit,
    termLimit,
    includeProjectRules,
  ]))
}

function translationContextCursor(key: string, offset: number): string {
  return `ctx-${key}-${offset}`
}

function translationContextCursorOffset(
  cursor: string | undefined,
  key: string,
  total: number,
): number {
  if (cursor === undefined) return 0
  const prefix = `ctx-${key}-`
  const rawOffset = cursor.startsWith(prefix) ? cursor.slice(prefix.length) : ''
  const offset = Number(rawOffset)
  if (!/^(0|[1-9]\d*)$/.test(rawOffset) || offset > total) {
    throw new LinguistCatInvalidArgumentError(
      'cursor',
      'does not belong to this translation-context request',
    )
  }
  return offset
}

/** TM、术语、句式库和 Context 文档的只读检索工具。 */
export function createReferenceTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject } = runtime

  const getTranslationContextTool = defineTool({
    name: 'cat_get_translation_context',
    label: 'CAT get translation context',
    description:
      'Read translation context for 1-50 segment ids from the bound project in input order. ' +
      'Returns revision snapshots, optional neighbors, TM/TB matches, tags, and stable evidence ids. ' +
      'This tool is read-only; results may be truncated by maxBytes and continued with cursor.',
    promptSnippet: 'Read bounded batch translation context from the bound CAT project',
    promptGuidelines: [
      'Use one batch call for related segments instead of repeating TM/TB searches per segment.',
      'Treat every revision as a snapshot; proposals must still use the returned current revision.',
    ],
    parameters: Type.Object({
      segmentIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 50 }),
      includeNeighbors: Type.Optional(Type.Boolean()),
      neighborCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
      tmLimitPerSegment: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
      termLimitPerSegment: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
      includeProjectRules: Type.Optional(Type.Boolean()),
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
        params.includeProjectRules ?? false,
      )
      const cursorOffset = translationContextCursorOffset(
        params.cursor,
        cursorKey,
        params.segmentIds.length,
      )
      const segments = db.segments.getByIds(params.segmentIds)
      if (segments.length !== params.segmentIds.length) {
        const found = new Set(segments.map((segment) => segment.id as string))
        throw new StoreNotFoundError(
          'segment',
          params.segmentIds.find((segmentId) => !found.has(segmentId))!,
        )
      }
      const remainingSegments = segments.slice(cursorOffset)
      const neighborsBySegment: ReadonlyMap<
        string,
        { previous: Segment[]; next: Segment[] }
      > = neighborCount === 0
        ? new Map()
        : db.segments.neighborsMany(remainingSegments, neighborCount)
      const sources = remainingSegments.map((segment) => segment.source)
      const termMatchesBySource: ReadonlyMap<string, TermEntryMatch[]> = termLimit === 0
        ? new Map()
        : db.termEntries.findMatchesMany({ texts: sources, limit: termLimit })
      const tmMatchesBySegment = new Map<string, TmUnitMatch[]>()
      if (tmLimit > 0) {
        const localeGroups = new Map<string, typeof remainingSegments>()
        for (const segment of remainingSegments) {
          const key = JSON.stringify([segment.sourceLocale, segment.targetLocale])
          const group = localeGroups.get(key) ?? []
          group.push(segment)
          localeGroups.set(key, group)
        }
        for (const group of localeGroups.values()) {
          const matches = db.tmUnits.findMatchesMany({
            sources: group.map((segment) => segment.source),
            sourceLocale: group[0]!.sourceLocale,
            targetLocale: group[0]!.targetLocale,
            threshold: 0.6,
            limit: tmLimit,
          })
          for (const segment of group) {
            tmMatchesBySegment.set(segment.id as string, matches.get(segment.source) ?? [])
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
        const termMatches = termMatchesBySource.get(segment.source) ?? []
        const tmMatches = tmMatchesBySegment.get(segment.id as string) ?? []
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
          ...tmMatches.map((item) => ({ id: item.id, kind: 'tm' as const })),
        ]
        contexts.push({
          segmentId: segment.id as string,
          assetId: segment.assetId as string,
          revision: segment.revision,
          source: segment.source,
          currentTarget: segment.target,
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
          requiredTerms: termMatches.filter((term) => term.status === 'required'),
          forbiddenTerms: termMatches.filter((term) => term.status === 'forbidden'),
          preferredTerms: termMatches.filter((term) => term.status === 'preferred'),
          tmMatches,
          warnings: [
            ...(segment.locked ? ['Segment is locked.'] : []),
            ...(termMatches.some((term) => term.conflict)
              ? ['Conflicting preferred terminology evidence.']
              : []),
          ],
          evidence,
        })
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
      const page = (
        items: SegmentTranslationContext[],
        includeSuggestions = true,
      ): CatGetTranslationContextResult => {
        const nextIndex = cursorOffset + items.length
        const truncated = nextIndex < params.segmentIds.length
        const result: CatGetTranslationContextResult = {
          contexts: items,
          totalRequested: params.segmentIds.length,
          cursor: params.cursor ?? null,
          truncated,
          ...(truncated
            ? {
                nextCursor: translationContextCursor(cursorKey, nextIndex),
                ...(includeSuggestions
                  ? { suggestedSegmentIds: params.segmentIds.slice(nextIndex) }
                  : {}),
              }
            : {}),
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
      let selected: SegmentTranslationContext[] = []
      for (const context of contexts) {
        const candidate = [...selected, context]
        if (measured(page(candidate)) > maxBytes) break
        selected = candidate
      }
      if (selected.length === 0 && contexts[0] !== undefined) {
        const first = contexts[0]
        selected = [{
          ...first,
          source: `${first.source.slice(0, 64)}${first.source.length > 64 ? '…' : ''}`,
          currentTarget:
            `${first.currentTarget.slice(0, 64)}${first.currentTarget.length > 64 ? '…' : ''}`,
          previous: [],
          next: [],
          tags: [],
          placeholderSignature: [],
          requiredTerms: [],
          forbiddenTerms: [],
          preferredTerms: [],
          tmMatches: [],
          warnings: [...first.warnings, 'Context fields were truncated to fit maxBytes.'],
          evidence: first.evidence.filter((item) => item.kind === 'segment-revision'),
        }]
      }
      let dto = page(selected)
      if (measured(dto) > maxBytes) dto = page(selected, false)
      if (measured(dto) > maxBytes && selected[0] !== undefined) {
        selected = [{
          ...selected[0],
          source: '',
          currentTarget: '',
          warnings: ['Context text was omitted to fit maxBytes.'],
        }]
        dto = page(selected, false)
      }
      if (measured(dto) > maxBytes) {
        throw new LinguistCatInvalidArgumentError(
          'maxBytes',
          'budget cannot hold the minimum context envelope',
        )
      }
      return toolResult(dto, deps.resultProjectId, dto.contexts.map((context) => context.segmentId))
    },
  })

  const searchTmTool = defineTool({
    name: 'cat_search_tm',
    label: 'CAT search TM',
    description:
      'Search the translation memory of the bound CAT project. concordance mode is a case-insensitive literal substring ' +
      'over TM source or target; match mode ranks source exact/contains/fuzzy matches deterministically. Returns at most ' +
      `${CAT_TOOL_PAGE_LIMITS.searchTm.maxLimit} units per call (default ${CAT_TOOL_PAGE_LIMITS.searchTm.defaultLimit}). ` +
      'An empty result carries a note and is not an error.',
    promptSnippet: 'Search the bound project translation memory',
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      mode: Type.Optional(Type.Union([Type.Literal('concordance'), Type.Literal('match')])),
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
      const results = mode === 'match'
        ? db.tmUnits.findMatches({
          source: query,
          sourceLocale: project.sourceLocale,
          targetLocale: project.targetLocale,
          limit: page.limit,
        })
        : db.tmUnits.search({ query, limit: page.limit })
      const total = mode === 'match' ? results.length : db.tmUnits.count({ query })
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
    description:
      'Read the plain-text extract of a context document of the bound CAT project, paged by characters ' +
      `(default ${CAT_TOOL_PAGE_LIMITS.readContextDoc.defaultLimit}, hard max ${CAT_TOOL_PAGE_LIMITS.readContextDoc.maxLimit} per call; ` +
      'use offset to continue). Image documents never return bytes — only metadata. docId comes from the ' +
      'context catalog in the system context or the project UI. Contains no filesystem paths.',
    promptSnippet: 'Read a context document of the bound CAT project (paged)',
    parameters: Type.Object({
      docId: Type.String({ minLength: 1, description: 'Context doc id from the injected context catalog.' }),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_read_context_doc', toolCallId)
      const doc = db.contextDocs.get(params.docId)
      if (doc === undefined) throw new StoreNotFoundError('context doc', params.docId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.readContextDoc)
      const base = {
        docId: doc.id,
        kind: doc.kind,
        filename: doc.originalFilename,
        createdAt: doc.createdAt,
        ...(doc.sha256 !== undefined ? { sha256: doc.sha256 } : {}),
        ...(doc.note !== undefined ? { docNote: doc.note } : {}),
      }
      if (doc.kind === 'image') {
        const dto: CatReadContextDocResult = {
          ...base,
          offset: 0,
          limit: page.limit,
          totalChars: 0,
          hasMore: false,
          note: IMAGE_DOC_NOTE,
        }
        return toolResult(dto, deps.resultProjectId)
      }
      const extract = doc.textExtract
      if (extract === undefined) {
        const dto: CatReadContextDocResult = {
          ...base,
          offset: 0,
          limit: page.limit,
          totalChars: 0,
          hasMore: false,
          note: NO_EXTRACT_NOTE,
        }
        return toolResult(dto, deps.resultProjectId)
      }
      const text = extract.slice(page.offset, page.offset + page.limit)
      const dto: CatReadContextDocResult = {
        ...base,
        offset: page.offset,
        limit: page.limit,
        totalChars: extract.length,
        hasMore: pageHasMore(extract.length, page.offset, text.length),
        text,
        ...(page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId)
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
