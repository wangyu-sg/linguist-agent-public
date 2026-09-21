import { fnv1a64 } from '@linguist/cat-core'
import type { VoiceProfile } from '@linguist/cat-store'
import type {
  CatLinkedContextEvidence,
  CatSegmentBrief,
  CatSharedTranslationContext,
  SegmentTranslationContext,
} from './types'

/** 装页前的完整领域数据；原件与关联先保留，最终响应再按页自含去重。 */
export interface ResolvedTranslationContext extends Omit<
  SegmentTranslationContext, 'contextRefs' | 'voiceRefs' | 'previous' | 'next'
> {
  linkedContext: CatLinkedContextEvidence[]
  voiceProfiles?: VoiceProfile[]
  previous: CatSegmentBrief[]
  next: CatSegmentBrief[]
}

export function shareTranslationContexts(items: readonly ResolvedTranslationContext[]): {
  contexts: SegmentTranslationContext[]
  shared: CatSharedTranslationContext
} {
  const shared: CatSharedTranslationContext = { context: {}, voices: {}, neighbors: {} }
  const present = new Set(items.map(item => `${item.segmentId}@${item.revision}`))
  const contexts = items.map(({ linkedContext, voiceProfiles, previous, next, ...item }) => {
    const contextRefs = linkedContext.map(({ requiredness, ...evidence }) => {
      // 包含真实来源、版本、定位与正文；同文异源不合并，requiredness 留在关联边。
      const ref = fnv1a64(JSON.stringify(evidence))
      shared.context[ref] = evidence
      return { ref, requiredness }
    })
    const voiceRefs = (voiceProfiles ?? []).map(profile => {
      const ref = fnv1a64(JSON.stringify(profile))
      shared.voices[ref] = profile
      return ref
    })
    const neighbors = (values: readonly CatSegmentBrief[]) => values.map(value => {
      const ref = `${value.segmentId}@${value.revision}`
      if (!present.has(ref)) shared.neighbors[ref] = value
      return { segmentId: value.segmentId, revision: value.revision }
    })
    return { ...item, contextRefs, voiceRefs, previous: neighbors(previous), next: neighbors(next) }
  })
  return { contexts, shared }
}
