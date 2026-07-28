/**
 * Deterministic id generation and branded id types.
 *
 * Pure domain module: no Node/Electron imports. Entropy and time are
 * injectable so tests can assert stability (`same input -> same ids`).
 * The hash is FNV-1a 64-bit over UTF-8 bytes — an id-stability hash,
 * NOT a security primitive.
 */

import { InvalidIdError } from './errors'

declare const idBrand: unique symbol

export type ProjectId = string & { readonly [idBrand]: 'ProjectId' }
export type AssetId = string & { readonly [idBrand]: 'AssetId' }
export type SegmentId = string & { readonly [idBrand]: 'SegmentId' }
export type ProposalId = string & { readonly [idBrand]: 'ProposalId' }
export type QaFindingId = string & { readonly [idBrand]: 'QaFindingId' }

export const ID_PATTERN = /^[a-z]{3}-[0-9a-f]{16}$/

/** FNV-1a 64-bit over UTF-8 bytes, rendered as 16 lowercase hex chars. */
export function fnv1a64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const byte of bytes) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

/** Injectable entropy: returns random bytes. Default uses WebCrypto. */
export type EntropySource = () => Uint8Array

export const defaultEntropy: EntropySource = () => {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/**
 * Seeded entropy source for deterministic ids in tests/importers.
 * xorshift64* stream seeded from the FNV hash of `seed`.
 */
export function createSeededEntropy(seed: string): EntropySource {
  let state = BigInt(`0x${fnv1a64(seed)}`) || 0x9e3779b97f4a7c15n
  const mask = 0xffffffffffffffffn
  return () => {
    const out = new Uint8Array(8)
    for (let i = 0; i < 8; i++) {
      state ^= state << 13n
      state &= mask
      state ^= state >> 7n
      state ^= state << 17n
      state &= mask
      out[i] = Number((state >> BigInt((i % 8) * 8)) & 0xffn)
    }
    return out
  }
}

function entropyHex(entropy: EntropySource, length: number): string {
  const bytes = entropy()
  let hex = ''
  for (let i = 0; hex.length < length; i++) {
    hex += (bytes[i % bytes.length] ?? 0).toString(16).padStart(2, '0')
  }
  return hex.slice(0, length)
}

function asBranded<T extends string>(prefix: string, value: string, make: (v: string) => T): T {
  if (!ID_PATTERN.test(value) || !value.startsWith(`${prefix}-`)) {
    throw new InvalidIdError(value, `${prefix}-<16 lowercase hex chars>`)
  }
  return make(value)
}

/** Random id with injectable entropy: `prj-<16hex>`. */
export function generateProjectId(entropy: EntropySource = defaultEntropy): ProjectId {
  return `prj-${entropyHex(entropy, 16)}` as ProjectId
}

export function asProjectId(value: string): ProjectId {
  return asBranded('prj', value, (v) => v as ProjectId)
}

/** Content-derived asset id: stable for the same (projectId, sourceSha256, originalFilename). */
export function deriveAssetId(projectId: string, sourceSha256: string, originalFilename: string): AssetId {
  return `ast-${fnv1a64(`${projectId}${sourceSha256}${originalFilename}`)}` as AssetId
}

export function asAssetId(value: string): AssetId {
  return asBranded('ast', value, (v) => v as AssetId)
}

/** Content-derived segment id: stable for the same (assetId, ordinal, key). */
export function deriveSegmentId(assetId: string, ordinal: number, key?: string): SegmentId {
  return `seg-${fnv1a64(`${assetId}${ordinal}${key ?? ''}`)}` as SegmentId
}

export function asSegmentId(value: string): SegmentId {
  return asBranded('seg', value, (v) => v as SegmentId)
}

/**
 * Content-derived proposal id. Normal proposals preserve the original
 * (segmentId, baseRevision, proposedTarget) identity. Explicit reissues add a
 * trusted issuance key so the old terminal row remains immutable.
 */
export function deriveProposalId(
  segmentId: string,
  baseRevision: number,
  proposedTarget: string,
  issuanceKey?: string,
): ProposalId {
  const seed = `${segmentId}${baseRevision}${proposedTarget}`
  return `prp-${fnv1a64(issuanceKey === undefined ? seed : `${seed}\0${issuanceKey}`)}` as ProposalId
}

export function asProposalId(value: string): ProposalId {
  return asBranded('prp', value, (v) => v as ProposalId)
}

/** Content-derived QA finding id: stable for the same (segmentId, code, message). */
export function deriveQaFindingId(segmentId: string, code: string, message: string): QaFindingId {
  return `qaf-${fnv1a64(`${segmentId}${code}${message}`)}` as QaFindingId
}

export function asQaFindingId(value: string): QaFindingId {
  return asBranded('qaf', value, (v) => v as QaFindingId)
}
