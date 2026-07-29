/**
 * Deterministic id generation and branded id types.
 *
 * Pure domain module: no Node/Electron imports. Entropy and time are
 * injectable so tests can assert stability (`same input -> same ids`).
 * New content-derived ids use versioned SHA-256 tuples. FNV-1a remains for
 * legacy compatibility, source hashes, and deterministic entropy.
 */

import { InvalidIdError } from './errors'
import { sha256Hex } from './hash'

declare const idBrand: unique symbol

export type ProjectId = string & { readonly [idBrand]: 'ProjectId' }
export type AssetId = string & { readonly [idBrand]: 'AssetId' }
export type SegmentId = string & { readonly [idBrand]: 'SegmentId' }
export type ProposalId = string & { readonly [idBrand]: 'ProposalId' }
export type ProposalIssuanceId = string & { readonly [idBrand]: 'ProposalIssuanceId' }
export type QaFindingId = string & { readonly [idBrand]: 'QaFindingId' }

const LEGACY_ID_PATTERN = /^([a-z]{3})-([0-9a-f]{16})$/
const V2_ID_PATTERN = /^([a-z][a-z0-9]{0,15})_v2_([0-9a-f]{64})$/
export const ID_PATTERN = /^(?:[a-z]{3}-[0-9a-f]{16}|[a-z][a-z0-9]{0,15}_v2_[0-9a-f]{64})$/
export type StableIdField = string | number | boolean | null
export type StableIdVersion = 'v1' | 'v2'

export interface ParsedStableId {
  readonly entityType: string
  readonly version: StableIdVersion
  readonly digest: string
}

const STABLE_ID_ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9]{0,15}$/
const textEncoder = new TextEncoder()

function stableIdFieldFrame(field: StableIdField): string {
  const tag = field === null ? 'z' : typeof field === 'string'
    ? 's'
    : typeof field === 'number'
      ? 'n'
      : 'b'
  if (typeof field === 'number' && !Number.isFinite(field)) {
    throw new TypeError('Stable ID fields must contain finite numbers.')
  }
  const value = field === null ? '' : typeof field === 'boolean' ? (field ? '1' : '0') : String(field)
  return `${tag}${textEncoder.encode(value).length}:${value}`
}

/**
 * Versioned content ID over an unambiguous typed tuple. Lengths count UTF-8
 * bytes, not JavaScript UTF-16 code units.
 */
export function deriveStableIdV2(
  entityType: string,
  fields: readonly StableIdField[],
): string {
  if (!STABLE_ID_ENTITY_TYPE_PATTERN.test(entityType)) {
    throw new TypeError(`Invalid Stable ID entity type: ${entityType}`)
  }
  const tuple = textEncoder.encode(
    ['v2', entityType, ...fields].map(stableIdFieldFrame).join(''),
  )
  return `${entityType}_v2_${sha256Hex(tuple)}`
}

export function parseStableId(value: string): ParsedStableId | undefined {
  const legacy = LEGACY_ID_PATTERN.exec(value)
  if (legacy) {
    return { entityType: legacy[1]!, version: 'v1', digest: legacy[2]! }
  }
  const v2 = V2_ID_PATTERN.exec(value)
  return v2
    ? { entityType: v2[1]!, version: 'v2', digest: v2[2]! }
    : undefined
}

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

function asBranded<T extends string>(
  prefix: string,
  value: string,
  make: (v: string) => T,
  allowV2 = true,
): T {
  const parsed = parseStableId(value)
  if (!parsed || parsed.entityType !== prefix || (!allowV2 && parsed.version !== 'v1')) {
    const expected = allowV2
      ? `${prefix}-<16 lowercase hex chars> or ${prefix}_v2_<64 lowercase hex chars>`
      : `${prefix}-<16 lowercase hex chars>`
    throw new InvalidIdError(value, expected)
  }
  return make(value)
}

/** Random id with injectable entropy: `prj-<16hex>`. */
export function generateProjectId(entropy: EntropySource = defaultEntropy): ProjectId {
  return `prj-${entropyHex(entropy, 16)}` as ProjectId
}

export function asProjectId(value: string): ProjectId {
  return asBranded('prj', value, (v) => v as ProjectId, false)
}

/** Content-derived asset id: stable for the same (projectId, sourceSha256, originalFilename). */
export function deriveAssetId(projectId: string, sourceSha256: string, originalFilename: string): AssetId {
  return deriveStableIdV2('ast', [projectId, sourceSha256, originalFilename]) as AssetId
}

export function asAssetId(value: string): AssetId {
  return asBranded('ast', value, (v) => v as AssetId)
}

/** Content-derived segment id: stable for the same (assetId, ordinal, key). */
export function deriveSegmentId(assetId: string, ordinal: number, key?: string): SegmentId {
  return deriveStableIdV2('seg', [assetId, ordinal, key ?? null]) as SegmentId
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
  return deriveStableIdV2(
    'prp',
    [segmentId, baseRevision, proposedTarget, issuanceKey ?? null],
  ) as ProposalId
}

export function asProposalId(value: string): ProposalId {
  return asBranded('prp', value, (v) => v as ProposalId)
}

/** Content-derived QA finding id: stable for the same (segmentId, code, message). */
export function deriveQaFindingId(segmentId: string, code: string, message: string): QaFindingId {
  return deriveStableIdV2('qaf', [segmentId, code, message]) as QaFindingId
}

export function asQaFindingId(value: string): QaFindingId {
  return asBranded('qaf', value, (v) => v as QaFindingId)
}
