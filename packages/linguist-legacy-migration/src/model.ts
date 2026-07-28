/**
 * Minimal runtime decoders for legacy CAT payloads (PB-090).
 *
 * The scanner never validates strictly and never throws on bad data: every
 * shape problem is recorded as an UnsupportedField and the affected value
 * degrades to null. Field sets mirror the legacy interfaces (see layout.ts
 * provenance header); semantics are only what the report needs (counts,
 * presence, health signals).
 */

import {
  KNOWN_AGENT_SETTINGS_FIELDS,
  KNOWN_MANIFEST_FIELDS,
  VALID_PERMISSION_MODES,
  VALID_SEGMENT_STATUSES,
  VALID_THINKING_LEVELS,
} from './layout'

export interface UnsupportedField {
  /** Which artifact carried the unknown/invalid value. */
  scope: 'manifest' | 'agent-settings' | 'project-files' | 'batch' | 'segment'
  /** Dotted locator, e.g. "manifest.foo", "agent-settings.permissionMode", "mystery.bin". */
  path: string
  detail: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// ---------------------------------------------------------------------------
// manifest

export interface ScannedAssetSummary {
  relPath: string | null
  role: string | null
  sizeBytes: number | null
}

export interface MinimalManifest {
  schemaVersion: number | null
  projectId: string | null
  projectName: string | null
  root: string | null
  sourceLanguage: string | null
  targetLanguage: string | null
  createdAt: string | null
  updatedAt: string | null
  scanAssets: ScannedAssetSummary[]
  importPlan: string[]
  warningCount: number
  questionCount: number
}

/**
 * Decode a ProjectManifest-shaped value. Returns null when the value is not
 * an object at all (caller reports the manifest as unreadable).
 */
export function decodeManifest(value: unknown, unsupported: UnsupportedField[]): MinimalManifest | null {
  if (!isRecord(value)) return null
  for (const key of Object.keys(value)) {
    if (!KNOWN_MANIFEST_FIELDS.has(key)) {
      unsupported.push({ scope: 'manifest', path: `manifest.${key}`, detail: 'unknown manifest field' })
    }
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    unsupported.push({
      scope: 'manifest',
      path: 'manifest.schemaVersion',
      detail: `expected schemaVersion 1, got ${JSON.stringify(value.schemaVersion)}`,
    })
  }
  let scanAssets: ScannedAssetSummary[] = []
  if (value.scan !== undefined) {
    if (isRecord(value.scan) && Array.isArray(value.scan.assets)) {
      scanAssets = value.scan.assets.map((asset): ScannedAssetSummary => {
        if (!isRecord(asset)) return { relPath: null, role: null, sizeBytes: null }
        return {
          relPath: optionalString(asset.relPath),
          role: optionalString(asset.role),
          sizeBytes: optionalNumber(asset.sizeBytes),
        }
      })
    } else {
      unsupported.push({ scope: 'manifest', path: 'manifest.scan', detail: 'scan is missing or has no assets array' })
    }
  }
  for (const listField of ['importPlan', 'warnings', 'questions'] as const) {
    if (value[listField] !== undefined && !Array.isArray(value[listField])) {
      unsupported.push({
        scope: 'manifest',
        path: `manifest.${listField}`,
        detail: `expected array, got ${typeof value[listField]}`,
      })
    }
  }
  return {
    schemaVersion: optionalNumber(value.schemaVersion),
    projectId: optionalString(value.projectId),
    projectName: optionalString(value.projectName),
    root: optionalString(value.root),
    sourceLanguage: optionalString(value.sourceLanguage),
    targetLanguage: optionalString(value.targetLanguage),
    createdAt: optionalString(value.createdAt),
    updatedAt: optionalString(value.updatedAt),
    scanAssets,
    importPlan: Array.isArray(value.importPlan) ? value.importPlan.filter((v): v is string => typeof v === 'string') : [],
    warningCount: Array.isArray(value.warnings) ? value.warnings.length : 0,
    questionCount: Array.isArray(value.questions) ? value.questions.length : 0,
  }
}

// ---------------------------------------------------------------------------
// agent_settings.json — read as plain JSON; invalid values never abort a scan

export interface AgentSettingsProbe {
  permissionMode: string | null
  /** true when permissionMode is present but outside {ask, auto, custom} (e.g. legacy "full"). */
  invalidPermissionMode: boolean
}

export function probeAgentSettings(value: unknown, unsupported: UnsupportedField[]): AgentSettingsProbe {
  const probe: AgentSettingsProbe = { permissionMode: null, invalidPermissionMode: false }
  if (!isRecord(value)) {
    unsupported.push({ scope: 'agent-settings', path: 'agent_settings.json', detail: 'not a JSON object' })
    return probe
  }
  for (const key of Object.keys(value)) {
    if (!KNOWN_AGENT_SETTINGS_FIELDS.has(key)) {
      unsupported.push({ scope: 'agent-settings', path: `agent-settings.${key}`, detail: 'unknown agent settings field' })
    }
  }
  if (typeof value.permissionMode === 'string') {
    probe.permissionMode = value.permissionMode
    if (!VALID_PERMISSION_MODES.has(value.permissionMode)) {
      probe.invalidPermissionMode = true
      unsupported.push({
        scope: 'agent-settings',
        path: 'agent-settings.permissionMode',
        detail: `invalid permission mode ${JSON.stringify(value.permissionMode)} (expected ask | auto | custom)`,
      })
    }
  } else if (value.permissionMode !== undefined) {
    unsupported.push({
      scope: 'agent-settings',
      path: 'agent-settings.permissionMode',
      detail: `expected string, got ${typeof value.permissionMode}`,
    })
  }
  if (
    value.thinkingLevel !== undefined &&
    !(typeof value.thinkingLevel === 'string' && VALID_THINKING_LEVELS.has(value.thinkingLevel))
  ) {
    unsupported.push({
      scope: 'agent-settings',
      path: 'agent-settings.thinkingLevel',
      detail: `invalid thinking level ${JSON.stringify(value.thinkingLevel)}`,
    })
  }
  return probe
}

// ---------------------------------------------------------------------------
// batch (CatBatch) summary — counts only, no per-segment hashing

export interface BatchSummary {
  batchId: string | null
  format: string | null
  sourceFile: string | null
  segmentCount: number
  lockedCount: number
  /** status value -> count; values outside the legacy domain are kept and also flagged. */
  statusCounts: Record<string, number>
}

export function summarizeBatch(value: unknown, batchLabel: string, unsupported: UnsupportedField[]): BatchSummary | null {
  if (!isRecord(value)) return null
  const statusCounts: Record<string, number> = {}
  let segmentCount = 0
  let lockedCount = 0
  if (Array.isArray(value.segments)) {
    segmentCount = value.segments.length
    for (const segment of value.segments) {
      if (!isRecord(segment)) continue
      if (segment.locked === true) lockedCount++
      const status = typeof segment.status === 'string' ? segment.status : 'unknown'
      statusCounts[status] = (statusCounts[status] ?? 0) + 1
      if (!VALID_SEGMENT_STATUSES.has(status)) {
        unsupported.push({
          scope: 'segment',
          path: `${batchLabel}.segments[].status`,
          detail: `unexpected segment status ${JSON.stringify(status)}`,
        })
      }
    }
  } else {
    unsupported.push({ scope: 'batch', path: `${batchLabel}.segments`, detail: 'missing segments array' })
  }
  return {
    batchId: optionalString(value.batchId),
    format: optionalString(value.format),
    sourceFile: optionalString(value.sourceFile),
    segmentCount,
    lockedCount,
    statusCounts,
  }
}

// ---------------------------------------------------------------------------
// TM / TB / chat counters — arrays per legacy JSON stores

/** tm.json / termbase.json / termbase_overrides.json are JSON arrays; null when not. */
export function countArrayEntries(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null
}

/** tm_audit.jsonl line count (blank lines ignored). */
export function countJsonlLines(raw: string): number {
  return raw.split(/\r?\n/).filter((line) => line.trim() !== '').length
}

/** chat.json is a JSON array of {ts, kind, text, sessionId?...}; null when not an array. */
export function countChatEntries(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null
}
