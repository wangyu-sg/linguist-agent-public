/**
 * Legacy data-root layout constants (PB-090).
 *
 * Provenance — every constant here is lifted from frozen legacy-repo SOURCE
 * (read-only; data/ and outputs/ were never touched):
 * - docs/migration/CAT_EXTRACTION_MATRIX.md §5 (new repo) — layout blueprint.
 * - linguist-agent/packages/cat-data/src/workspace.ts:17-19 — workspacePath()
 *   = <root>/data/projects/<projectId>/...
 * - linguist-agent/packages/cat-data/src/runtime_migrations.ts:13-14 —
 *   data/.schema.json is the v2 marker (absent = v1).
 * - linguist-agent/packages/cat-data/src/cat_core_storage.ts:46-62 —
 *   authority marker path, read-cache path scheme, safeCachePart().
 * - linguist-agent/packages/storage-sqlite/src/cat_core_repository.ts:35-38 —
 *   catCoreStreamId() = cat-core-<kind>-<sha256(projectId NUL id)[:48]>.
 * - linguist-agent/packages/cat-data/src/project_manifest.ts:23-38 —
 *   ProjectManifest field set (schemaVersion 1).
 * - linguist-agent/packages/cat-server/src/settings_grants_trust_sqlite_cutover.ts:107-122
 *   — agent_settings.json allowed keys, permissionMode/thinkingLevel domains.
 * - linguist-agent/packages/cat-data/src/runtime_storage.ts:106-118 —
 *   known per-project state/index/audit file names.
 * - linguist-agent/packages/cat-data/src/batch_workspace.ts:38-86 —
 *   BatchSegment.status domain ("new" | "draft" | "confirmed").
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// runtime-root relative anchors

export const DATA_DIR = 'data'
export const SCHEMA_MARKER_REL = 'data/.schema.json'
export const PROJECTS_REL = 'data/projects'
export const CAT_CORE_RUNTIME_REL = 'data/runtime/cat-core-sqlite-v1'
export const CAT_CORE_AUTHORITY_REL = `${CAT_CORE_RUNTIME_REL}/authority-v1.json`
export const CAT_CORE_DB_REL = `${CAT_CORE_RUNTIME_REL}/cat-core.sqlite`
export const CAT_CORE_READ_CACHE_REL = `${CAT_CORE_RUNTIME_REL}/read-cache`
export const CAT_CORE_BLOBS_REL = `${CAT_CORE_RUNTIME_REL}/blob-store/blobs/sha256`

/** Runtime data schema marker version when data/.schema.json exists. */
export const RUNTIME_DATA_SCHEMA_VERSION = 2

// ---------------------------------------------------------------------------
// project-directory relative names

export const PROJECT_MANIFEST = 'project.json'
export const TM_FILE = 'tm.json'
export const TM_AUDIT_FILE = 'tm_audit.jsonl'
export const TERMBASE_FILE = 'termbase.json'
export const TERMBASE_OVERRIDES_FILE = 'termbase_overrides.json'
export const CHAT_FILE = 'chat.json'
export const AGENT_EVENTS_FILE = 'agent_events.jsonl'
export const PI_SESSIONS_DIR = '_pi_sessions'
export const AGENT_SELECTED_SESSION_FILE = 'agent_selected_session.json'
export const AGENT_SETTINGS_FILE = 'agent_settings.json'
export const BATCHES_DIR = 'batches'
export const BATCH_FILE = 'batch.json'
export const PROPOSALS_DIR = 'proposals'
export const REPORTS_DIR = 'reports'
export const UPLOADS_DIR = 'uploads'
export const DELIVERY_QA_DIR = 'delivery_qa'
export const EXPORTS_DIR = 'exports'
export const TERM_HISTORY_FILE = 'term_history.json'
export const QUALITY_DECISION_LEDGER_FILE = 'quality_decision_ledger.jsonl'

/** Excluded by the legacy migration contract (MATRIX §5 exclusion list). */
export const EXCLUDED_PROJECT_ENTRIES = new Set(['agent_events.jsonl', '_pi_sessions'])

/**
 * Top-level files a legacy project directory is known to carry
 * (runtime_storage.ts STATE_FILES + INDEX_FILES + AUDIT_FILES, plus the
 * remaining per-project files of MATRIX §5). Anything else at the project
 * top level is reported as an unsupported field.
 */
export const KNOWN_PROJECT_FILES = new Set([
  // state
  PROJECT_MANIFEST,
  TM_FILE,
  TERMBASE_FILE,
  'glossary.json',
  'tag_rules.json',
  AGENT_SETTINGS_FILE,
  'agent_decisions.json',
  'agent_jobs.json',
  // index
  'asset_blocks.jsonl',
  'asset_vectors.jsonl',
  'asset_typed_index.json',
  'source_context_index.json',
  // audit
  'agent_events.jsonl',
  CHAT_FILE,
  AGENT_SELECTED_SESSION_FILE,
  'memory_audit.jsonl',
  TM_AUDIT_FILE,
  'export_audit.jsonl',
  'pi_settings_audit.jsonl',
  // MATRIX §5 remainder
  TERMBASE_OVERRIDES_FILE,
  'term_history.json',
  'quality_checklist.json',
  'quality_decision_ledger.jsonl',
  'voice_exemplars.jsonl',
  'customer_returns.json',
  'readiness_decisions.jsonl',
  'asset_mapping_profiles.json',
  'workflow_artifacts.json',
])

/** Known top-level directories of a legacy project (MATRIX §5). */
export const KNOWN_PROJECT_DIRS = new Set([
  BATCHES_DIR,
  UPLOADS_DIR,
  EXPORTS_DIR,
  DELIVERY_QA_DIR,
  'workflows',
  'task_workspace',
  'memory',
  'library',
  'asset_parse',
  '_pi_sessions',
])

// ---------------------------------------------------------------------------
// manifest / settings domains

/** ProjectManifest keys, schemaVersion 1 (project_manifest.ts:23-38). */
export const KNOWN_MANIFEST_FIELDS = new Set([
  'schemaVersion',
  'projectId',
  'projectName',
  'root',
  'sourceLanguage',
  'targetLanguage',
  'createdAt',
  'updatedAt',
  'scan',
  'assetRoleDecisions',
  'phraseTagPairs',
  'importPlan',
  'warnings',
  'questions',
])

/** agent_settings.json allowed keys (settings_grants_trust_sqlite_cutover.ts:109). */
export const KNOWN_AGENT_SETTINGS_FIELDS = new Set([
  'modelProvider',
  'modelId',
  'thinkingLevel',
  'disabledTools',
  'disabledSkills',
  'permissionMode',
  'permissionRules',
  'teamRoleSettings',
])

/** Valid permissionMode values; legacy "full" is rejected by the old runtime. */
export const VALID_PERMISSION_MODES = new Set(['ask', 'auto', 'custom'])
export const VALID_THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** BatchSegment.status domain (batch_workspace.ts; SegmentStatus). */
export const VALID_SEGMENT_STATUSES = new Set(['new', 'draft', 'confirmed'])

// ---------------------------------------------------------------------------
// derived locators

/** read-cache path component escaping (cat_core_storage.ts:50-52). */
export function safeCachePart(value: string): string {
  return encodeURIComponent(value).replace(/%/gu, '_')
}

export type CatCoreStreamKind = 'batch' | 'tm' | 'termbase' | 'manifest' | 'source'

/** Stream-id separator byte (legacy uses \u0000; built via code point so this source stays NUL-free). */
const NUL = String.fromCodePoint(0)

/** SQLite stream id for a CAT-core projection (cat_core_repository.ts:35-38). */
export function catCoreStreamId(kind: CatCoreStreamKind, projectId: string, id = 'root'): string {
  const suffix = createHash('sha256').update(projectId + NUL + id).digest('hex').slice(0, 48)
  return `cat-core-${kind}-${suffix}`
}

export function projectDirOf(root: string, projectId: string): string {
  return join(root, PROJECTS_REL, projectId)
}

/**
 * Files whose bytes are individually digested (project-relative):
 * project.json, tm.json, termbase.json, chat.json, batches/<id>/batch.json,
 * uploads/<file> (direct children only).
 */
export function isDigestKeyFile(relPath: string): boolean {
  if (
    relPath === PROJECT_MANIFEST ||
    relPath === TM_FILE ||
    relPath === TERMBASE_FILE ||
    relPath === CHAT_FILE
  ) {
    return true
  }
  const parts = relPath.split('/')
  if (parts.length === 3 && parts[0] === BATCHES_DIR && parts[2] === BATCH_FILE) return true
  if (parts.length === 2 && parts[0] === UPLOADS_DIR) return true
  return false
}
