import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'
import type { CatVoiceContextResult } from './types'

export function createVoiceTools(runtime: CatToolRuntime) {
  const { deps, notifyMutation, resolveBoundProject } = runtime

  const upsertProfileTool = defineTool({
    name: 'cat_upsert_voice_profile',
    label: 'CAT upsert voice profile',
    description: 'Create or update one speaker/entity voice profile in the bound project. Profiles remain project-scoped and are not copied into the permanent prompt.',
    promptSnippet: 'Save a speaker voice, register, person, tone markers, and taboos',
    parameters: Type.Object({
      id: Type.Optional(Type.String({ minLength: 1 })),
      speaker: Type.String({ minLength: 1, maxLength: 200 }),
      textType: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      register: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      person: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      toneMarkers: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 50 })),
      taboos: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 300 }), { maxItems: 50 })),
      notes: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_upsert_voice_profile', toolCallId)
      const profile = db.voiceProfiles.upsert({
        id: params.id,
        speaker: params.speaker,
        textType: params.textType,
        register: params.register,
        person: params.person,
        toneMarkers: params.toneMarkers,
        taboos: params.taboos,
        notes: params.notes,
        updatedBy: deps.sessionId,
      })
      notifyMutation({ kind: 'project-updated' })
      return toolResult(profile, deps.resultProjectId)
    },
  })

  const addExemplarTool = defineTool({
    name: 'cat_add_approved_exemplar',
    label: 'CAT add approved exemplar',
    description: 'Save the current text of one translated segment as an approved voice exemplar in the bound project. Source, target, asset, segment, locales, and approval time are host-owned.',
    promptSnippet: 'Mark a translated segment as an approved speaker exemplar',
    parameters: Type.Object({
      segmentId: Type.String({ minLength: 1 }),
      speaker: Type.String({ minLength: 1, maxLength: 200 }),
      textType: Type.String({ minLength: 1, maxLength: 120 }),
      module: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      note: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    }),
    async execute(toolCallId, params) {
      const { project, db } = resolveBoundProject('cat_add_approved_exemplar', toolCallId)
      const segment = db.segments.getById(params.segmentId)
      if (!segment) throw new LinguistCatInvalidArgumentError('segmentId', 'segment does not exist in the bound project')
      if (segment.target.trim() === '') {
        throw new LinguistCatInvalidArgumentError('segmentId', 'segment has no translated target to approve')
      }
      const exemplar = db.tmUnits.addApprovedExemplar({
        source: segment.source,
        target: segment.target,
        sourceLocale: project.sourceLocale,
        targetLocale: project.targetLocale,
        speaker: params.speaker,
        textType: params.textType,
        module: params.module,
        assetId: segment.assetId,
        segmentId: segment.id,
        note: params.note,
      })
      notifyMutation({ kind: 'project-updated' })
      return toolResult(exemplar, deps.resultProjectId)
    },
  })

  const getContextTool = defineTool({
    name: 'cat_get_voice_context',
    label: 'CAT get voice context',
    description: 'Read one speaker/entity profile and 3–5 approved exemplars from the bound project, filtered by speaker and optionally text type/module.',
    promptSnippet: 'Retrieve bounded voice guidance and approved examples for dialogue translation',
    parameters: Type.Object({
      speaker: Type.String({ minLength: 1, maxLength: 200 }),
      textType: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      module: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      limit: Type.Optional(Type.Integer({ minimum: 3, maximum: 5 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_get_voice_context', toolCallId)
      const profiles = db.voiceProfiles.list({
        query: params.speaker,
        ...(params.textType === undefined ? {} : { textType: params.textType }),
        limit: 50,
      }).filter((profile) => profile.speaker.toLocaleLowerCase() === params.speaker.toLocaleLowerCase())
      const profile = profiles.find((candidate) => candidate.textType === params.textType)
        ?? profiles.find((candidate) => candidate.textType === undefined)
        ?? profiles[0]
      const exemplars = db.tmUnits.listApprovedExemplars({
        speaker: params.speaker,
        textType: params.textType,
        module: params.module,
        limit: params.limit ?? 5,
      })
      const result: CatVoiceContextResult = {
        speaker: params.speaker,
        ...(params.textType === undefined ? {} : { textType: params.textType }),
        ...(params.module === undefined ? {} : { module: params.module }),
        ...(profile === undefined ? {} : { profile }),
        exemplars,
        ...(profile === undefined && exemplars.length === 0
          ? { note: 'No voice profile or approved exemplar matched.' }
          : {}),
      }
      return toolResult(result, deps.resultProjectId)
    },
  })

  return [upsertProfileTool, addExemplarTool, getContextTool] as const
}
