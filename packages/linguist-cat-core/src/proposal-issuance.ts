import { deriveStableIdV2, type ProposalId, type ProposalIssuanceId } from './ids'
import type { TranslationProposal } from './proposal'

export interface LinguistGenerationProvenance {
  sessionId?: string
  runId?: string
  toolCallId?: string
  modelProvider?: string
  modelId?: string
  runtime?: string
  role?: 'assistant' | 'reviewer' | 'auditor'
  strategy?: 'fast' | 'balanced' | 'best'
  linguistPromptVersion?: string
  promptHash?: string
  projectDigestHash?: string
  projectDigestRevision?: string
  turnContextVersion?: number
  /** Canonical JSON from the validated host-owned Turn Context. */
  turnContextSnapshot?: string
  turnContextHash?: string
  toolsetHash?: string
}

export interface ProposalIssuanceInput extends LinguistGenerationProvenance {
  /** Trusted retry identity; never model input. */
  idempotencyKey?: string
  createdAt?: string
}

export interface ProposalIssuance extends LinguistGenerationProvenance {
  id: ProposalIssuanceId
  proposalId: ProposalId
  idempotencyKey?: string
  evidenceRefs: string[]
  termRefs: string[]
  createdAt: string
}

export function createProposalIssuance(
  proposal: TranslationProposal,
  input: ProposalIssuanceInput = {},
): ProposalIssuance {
  const { idempotencyKey, createdAt: issuedAt, ...inputProvenance } = input
  const createdAt = issuedAt ?? proposal.createdAt
  const provenance: LinguistGenerationProvenance = {
    ...inputProvenance,
    ...(inputProvenance.sessionId === undefined && proposal.sessionId !== undefined
      ? { sessionId: proposal.sessionId }
      : {}),
    ...(inputProvenance.runId === undefined && proposal.runId !== undefined
      ? { runId: proposal.runId }
      : {}),
    ...(inputProvenance.modelId === undefined && proposal.modelId !== undefined
      ? { modelId: proposal.modelId }
      : {}),
  }
  const identity = idempotencyKey === undefined
    ? [
        provenance.sessionId ?? null,
        provenance.runId ?? null,
        provenance.toolCallId ?? null,
        provenance.modelProvider ?? null,
        provenance.modelId ?? null,
        provenance.runtime ?? null,
        createdAt,
      ]
    : [idempotencyKey]
  return {
    id: deriveStableIdV2('pis', [proposal.id, ...identity]) as ProposalIssuanceId,
    proposalId: proposal.id,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...provenance,
    evidenceRefs: [...proposal.evidenceRefs],
    termRefs: [...proposal.termRefs],
    createdAt,
  }
}
