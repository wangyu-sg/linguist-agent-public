import type { TermEntryStatus } from '@linguist/cat-store'
import { StoreNotFoundError } from '@linguist/cat-store'
import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'

const TERM_STATUS = Type.Union([
  Type.Literal('allowed'),
  Type.Literal('preferred'),
  Type.Literal('required'),
  Type.Literal('forbidden'),
  Type.Literal('deprecated'),
])

const TERM_SCOPE = {
  module: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  category: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
}

/** 项目术语 CRUD、冲突和译后校验；项目身份只来自 Session binding。 */
export function createTerminologyTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const upsertTool = defineTool({
    name: 'cat_upsert_terms',
    label: 'CAT upsert terms',
    description: 'Create or update 1-200 terminology entries in the bound project. Empty values are rejected; pure numeric source terms require status=required.',
    promptSnippet: 'Create or update a bounded batch of project terminology entries',
    parameters: Type.Object({
      terms: Type.Array(Type.Object({
        id: Type.Optional(Type.String({ minLength: 1 })),
        term: Type.String({ minLength: 1, maxLength: 500 }),
        translation: Type.String({ minLength: 1, maxLength: 500 }),
        status: TERM_STATUS,
        caseSensitive: Type.Optional(Type.Boolean()),
        note: Type.Optional(Type.String({ maxLength: 2_000 })),
        ...TERM_SCOPE,
        imageRef: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
      }), { minItems: 1, maxItems: 200 }),
    }),
    async execute(toolCallId, params) {
      if (params.terms.length < 1 || params.terms.length > 200) {
        throw new LinguistCatInvalidArgumentError('terms', 'expected 1-200 items')
      }
      for (const entry of params.terms) {
        if (entry.term.trim() === '' || entry.translation.trim() === '') {
          throw new LinguistCatInvalidArgumentError('terms', 'term and translation must be non-blank')
        }
        if (entry.status !== 'required' && /^[\p{N}\s.,+\-]+$/u.test(entry.term.trim())) {
          throw new LinguistCatInvalidArgumentError('terms', 'pure numeric terms require status=required')
        }
      }
      const { db } = resolveBoundProject('cat_upsert_terms', toolCallId)
      const terms = db.catDb.transaction('upsert terminology batch', () => params.terms.map((entry) =>
        db.termEntries.upsert({
          ...entry,
          status: entry.status as TermEntryStatus,
          caseSensitive: entry.caseSensitive ?? false,
        })))
      notifyMutation({ kind: 'project-updated' })
      return toolResult({ terms, count: terms.length }, deps.resultProjectId)
    },
  })

  const deleteTool = defineTool({
    name: 'cat_delete_terms',
    label: 'CAT delete terms',
    description: 'Delete 1-200 terminology entries by id from the bound project. The batch is atomic and unknown ids fail closed.',
    promptSnippet: 'Delete a bounded batch of project terminology entries',
    parameters: Type.Object({
      termIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 200 }),
    }),
    async execute(toolCallId, params) {
      if (params.termIds.length < 1 || params.termIds.length > 200) {
        throw new LinguistCatInvalidArgumentError('termIds', 'expected 1-200 items')
      }
      const { db } = resolveBoundProject('cat_delete_terms', toolCallId)
      db.catDb.transaction('delete terminology batch', () => {
        for (const id of params.termIds) db.termEntries.delete(id)
      })
      notifyMutation({ kind: 'project-updated' })
      return toolResult({ deletedTermIds: params.termIds, count: params.termIds.length }, deps.resultProjectId)
    },
  })

  const conflictsTool = defineTool({
    name: 'cat_list_term_conflicts',
    label: 'CAT list term conflicts',
    description: 'List source terms with multiple target translations in the bound project, optionally filtered by status and module/category scope. Read-only.',
    promptSnippet: 'Inspect project terminology conflicts before translation or review',
    parameters: Type.Object({
      statuses: Type.Optional(Type.Array(TERM_STATUS, { minItems: 1, maxItems: 5 })),
      ...TERM_SCOPE,
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_list_term_conflicts', toolCallId)
      const conflicts = db.termEntries.listConflicts({
        ...(params.statuses === undefined ? {} : { statuses: params.statuses as TermEntryStatus[] }),
        ...params,
      })
      return toolResult({ conflicts, count: conflicts.length }, deps.resultProjectId)
    },
  })

  const validateTool = defineTool({
    name: 'cat_validate_terms',
    label: 'CAT validate terms',
    description: 'Validate the current source/target text for 1-200 segment ids in the bound project. Returns missing required terms, forbidden target hits, unused preferred terms, and unresolved conflicts. Read-only.',
    promptSnippet: 'Run bounded post-translation terminology validation for current project segments',
    parameters: Type.Object({
      segmentIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 200 }),
    }),
    async execute(toolCallId, params) {
      if (params.segmentIds.length < 1 || params.segmentIds.length > 200) {
        throw new LinguistCatInvalidArgumentError('segmentIds', 'expected 1-200 items')
      }
      const { db } = resolveBoundProject('cat_validate_terms', toolCallId)
      const segments = db.segments.getByIds(params.segmentIds)
      const found = new Set(segments.map((segment) => segment.id as string))
      const missing = params.segmentIds.find((id) => !found.has(id))
      if (missing !== undefined) throw new StoreNotFoundError('segment', missing)
      const result = db.termEntries.validateSegments(segments.map((segment) => ({
        segmentId: segment.id as string,
        source: segment.source,
        target: segment.target,
        ...(segment.context?.meta?.module === undefined
          ? {} : { module: segment.context.meta.module }),
        ...(segment.context?.meta?.category === undefined
          ? {} : { category: segment.context.meta.category }),
      })))
      return toolResult(result, deps.resultProjectId, params.segmentIds)
    },
  })

  return [upsertTool, deleteTool, conflictsTool, validateTool] as const
}
