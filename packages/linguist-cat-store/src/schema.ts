/**
 * Schema migrations (plan §5.4 / §5.7).
 *
 * Ordered, append-only migration list. Each migration applies in its own
 * transaction and records (version, applied_at, description) in
 * schema_migrations. Opening a DB whose on-disk version is NEWER than
 * SCHEMA_VERSION throws StoreSchemaTooNewError — the store fails closed.
 *
 * TM/TB write and match support lands in schema v4 (PB-080).
 * Independent-critic review artifacts land in schema v5 (PB-083).
 * Project assets (style guide / sentence patterns / context docs / tech
 * constraints / voice profiles + term entry annotations) land in schema v6
 * (PB-095).
 * QA 契约对齐（五档 severity L0–L4 + issue_type + disposition 列，按 code
 * 静态表回填）lands in schema v7 (PB-096).
 */

import { createProposalIssuance } from '@linguist/cat-core'
import type { SqliteDatabase } from './runtime'
import {
  proposalFromRow,
  proposalIssuanceToParams,
  type ProposalRow,
} from './repositories/rows'

export interface SchemaValidation {
  sql: string
  expected: number
}

export interface SchemaMigration {
  version: number
  description: string
  sql: string
  prerequisites?: readonly SchemaValidation[]
  backfill?: (db: SqliteDatabase) => void
  validations?: readonly SchemaValidation[]
}

/** Current schema version this build understands. */
export const SCHEMA_VERSION = 15

const MIGRATION_1_SQL = `
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  format_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  segment_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE segments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  key TEXT,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  target_locale TEXT NOT NULL,
  status TEXT NOT NULL,
  locked INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  context_json TEXT
);
CREATE INDEX idx_segments_asset ON segments(asset_id, ordinal);

CREATE TABLE segment_revisions (
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (segment_id, revision)
);

CREATE TABLE term_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  term TEXT NOT NULL,
  translation TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE tm_units (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  target_locale TEXT NOT NULL,
  origin TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  base_revision INTEGER NOT NULL,
  proposed_target TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  term_refs_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  model_id TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX idx_proposals_segment ON proposals(segment_id, status);

CREATE TABLE qa_findings (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX idx_qa_findings_segment ON qa_findings(segment_id, status);

CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  segment_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_exports_asset ON exports(asset_id);
`

const MIGRATION_2_SQL = `
CREATE TABLE proposal_mutations (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`

const MIGRATION_3_SQL = `
ALTER TABLE qa_findings ADD COLUMN segment_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE qa_findings ADD COLUMN waiver_reason TEXT;
`

const MIGRATION_4_SQL = `
ALTER TABLE term_entries
  ADD COLUMN status TEXT NOT NULL DEFAULT 'allowed'
  CHECK (status IN ('allowed', 'preferred', 'forbidden', 'deprecated'));
ALTER TABLE term_entries
  ADD COLUMN case_sensitive INTEGER NOT NULL DEFAULT 0
  CHECK (case_sensitive IN (0, 1));

CREATE INDEX idx_tm_units_project_locales
  ON tm_units(project_id, source_locale, target_locale, created_at, id);
CREATE INDEX idx_term_entries_project_status
  ON term_entries(project_id, status, created_at, id);
`

function backfillProposalIssuances(db: SqliteDatabase): void {
  const insert = db.prepare(`
    INSERT INTO proposal_issuances (
      issuance_id, proposal_id, idempotency_key, session_id, run_id, tool_call_id,
      model_provider, model_id, runtime, role, strategy, linguist_prompt_version,
      prompt_hash, project_digest_hash, project_digest_revision,
      turn_context_version, turn_context_snapshot_json, turn_context_hash,
      toolset_hash, evidence_refs_json, term_refs_json, created_at
    ) VALUES (${Array.from({ length: 22 }, () => '?').join(', ')})
  `)
  for (const row of db.prepare('SELECT * FROM proposals ORDER BY created_at, id').all() as ProposalRow[]) {
    const proposal = proposalFromRow(row)
    insert.run(...proposalIssuanceToParams(createProposalIssuance(proposal, {
      idempotencyKey: `legacy:${proposal.id}`,
      createdAt: proposal.createdAt,
    })))
  }
}

const MIGRATION_5_SQL = `
CREATE TABLE critic_artifacts (
  artifact_id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  artifact_json TEXT NOT NULL
);
CREATE INDEX idx_critic_artifacts_segment ON critic_artifacts(segment_id);
`

const MIGRATION_6_SQL = `
CREATE TABLE style_guide_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  group_key TEXT,
  rule_text TEXT NOT NULL,
  source_example TEXT,
  good_example TEXT,
  bad_example TEXT,
  screenshot_ref TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX idx_style_guide_rules_project
  ON style_guide_rules(project_id, group_key, updated_at, id);

CREATE TABLE sentence_patterns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  text_type TEXT,
  module TEXT,
  source TEXT NOT NULL,
  draft_target TEXT,
  suggested_target TEXT,
  reviewer TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('confirmed', 'pending', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sentence_patterns_project
  ON sentence_patterns(project_id, status, created_at, id);

CREATE TABLE context_docs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('doc', 'image')),
  original_filename TEXT NOT NULL,
  blob_relpath TEXT NOT NULL,
  sha256 TEXT,
  note TEXT,
  text_extract TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_context_docs_project
  ON context_docs(project_id, kind, created_at, id);

CREATE TABLE tech_constraints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('length', 'rich_text', 'tag_note')),
  scope TEXT,
  value_json TEXT NOT NULL,
  note TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tech_constraints_project
  ON tech_constraints(project_id, kind, updated_at, id);

CREATE TABLE voice_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  speaker TEXT NOT NULL,
  text_type TEXT,
  register TEXT,
  person TEXT,
  tone_markers TEXT,
  taboos TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX idx_voice_profiles_project
  ON voice_profiles(project_id, speaker, updated_at, id);

ALTER TABLE term_entries ADD COLUMN module TEXT;
ALTER TABLE term_entries ADD COLUMN category TEXT;
ALTER TABLE term_entries ADD COLUMN image_ref TEXT;
`

/**
 * PB-096 schema v7：QA 契约对齐。
 * 1) severity 三值 → 五档 L0–L4：已知码按 cat-core issue-type.ts 静态表回填；
 *    CRITIC_* 保留旧档位语义（blocking→L1 / warning→L2 / info→L4）；
 *    未知码一律 L2。
 * 2) issue_type 列按 code 回填（CRITIC_* 按类目映射），未知码 'other'。
 * 3) disposition 列按 code 回填：确定性检查 defect；REQUIRED_TERM（术语
 *    prefer 偏离）与 CRITIC_*（评审意见）needs_review；glossary_conflict /
 *    source_issue query；其余旧 info 行 info。disposition UPDATE 必须先于
 *    severity UPDATE 执行（依赖旧三值判别 info 类）。
 */
const MIGRATION_7_SQL = `
ALTER TABLE qa_findings ADD COLUMN issue_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE qa_findings ADD COLUMN disposition TEXT NOT NULL DEFAULT 'defect';

UPDATE qa_findings SET disposition = CASE
  WHEN code = 'REQUIRED_TERM' THEN 'needs_review'
  WHEN code LIKE 'CRITIC\\_%' ESCAPE '\\' THEN 'needs_review'
  WHEN code IN ('GLOSSARY_CONFLICT', 'SOURCE_ISSUE') THEN 'query'
  WHEN code IN (
    'PLACEHOLDER_MISMATCH', 'TAG_MISMATCH', 'EMPTY_TARGET', 'FORBIDDEN_TERM',
    'NUMBER_MISMATCH', 'WHITESPACE_MISMATCH', 'REPEATED_PUNCTUATION',
    'SOURCE_EQUALS_TARGET', 'INCONSISTENT_REPEATED_SOURCE', 'TARGET_LENGTH_WARNING',
    'NEWLINE_MISMATCH', 'EDGE_WHITESPACE', 'DOUBLE_SPACE',
    'UNPAIRED_SYMBOL', 'UNPAIRED_QUOTE', 'REPEATED_WORD',
    'EMAIL_MISMATCH', 'URL_MISMATCH', 'ALPHANUMERIC_MISMATCH',
    'TARGET_SOURCE_INCONSISTENCY', 'FULLWIDTH_PUNCTUATION', 'RESIDUAL_CJK',
    'UPPERCASE_TOKEN_MISMATCH', 'CAMELCASE_TOKEN_MISMATCH'
  ) THEN 'defect'
  WHEN severity = 'info' THEN 'info'
  ELSE 'defect'
END;

UPDATE qa_findings SET severity = CASE code
  WHEN 'PLACEHOLDER_MISMATCH' THEN 'L0'
  WHEN 'TAG_MISMATCH' THEN 'L0'
  WHEN 'EMPTY_TARGET' THEN 'L1'
  WHEN 'FORBIDDEN_TERM' THEN 'L1'
  WHEN 'NUMBER_MISMATCH' THEN 'L1'
  WHEN 'REQUIRED_TERM' THEN 'L2'
  WHEN 'WHITESPACE_MISMATCH' THEN 'L3'
  WHEN 'REPEATED_PUNCTUATION' THEN 'L3'
  WHEN 'SOURCE_EQUALS_TARGET' THEN 'L2'
  WHEN 'INCONSISTENT_REPEATED_SOURCE' THEN 'L2'
  WHEN 'TARGET_LENGTH_WARNING' THEN 'L3'
  WHEN 'NEWLINE_MISMATCH' THEN 'L2'
  WHEN 'EDGE_WHITESPACE' THEN 'L3'
  WHEN 'DOUBLE_SPACE' THEN 'L3'
  WHEN 'UNPAIRED_SYMBOL' THEN 'L2'
  WHEN 'UNPAIRED_QUOTE' THEN 'L2'
  WHEN 'REPEATED_WORD' THEN 'L3'
  WHEN 'EMAIL_MISMATCH' THEN 'L2'
  WHEN 'URL_MISMATCH' THEN 'L2'
  WHEN 'ALPHANUMERIC_MISMATCH' THEN 'L2'
  WHEN 'TARGET_SOURCE_INCONSISTENCY' THEN 'L3'
  WHEN 'FULLWIDTH_PUNCTUATION' THEN 'L2'
  WHEN 'RESIDUAL_CJK' THEN 'L2'
  WHEN 'GLOSSARY_CONFLICT' THEN 'L2'
  WHEN 'UPPERCASE_TOKEN_MISMATCH' THEN 'L3'
  WHEN 'CAMELCASE_TOKEN_MISMATCH' THEN 'L3'
  ELSE CASE
    WHEN code LIKE 'CRITIC\\_%' ESCAPE '\\' THEN
      CASE severity WHEN 'blocking' THEN 'L1' WHEN 'warning' THEN 'L2' WHEN 'info' THEN 'L4' ELSE 'L2' END
    ELSE 'L2'
  END
END;

UPDATE qa_findings SET issue_type = CASE code
  WHEN 'PLACEHOLDER_MISMATCH' THEN 'placeholders_variables'
  WHEN 'TAG_MISMATCH' THEN 'format_tags'
  WHEN 'EMPTY_TARGET' THEN 'omission'
  WHEN 'FORBIDDEN_TERM' THEN 'terminology_hard'
  WHEN 'REQUIRED_TERM' THEN 'terminology_soft'
  WHEN 'NUMBER_MISMATCH' THEN 'numbers_units_dates'
  WHEN 'WHITESPACE_MISMATCH' THEN 'whitespace_linebreaks'
  WHEN 'REPEATED_PUNCTUATION' THEN 'punctuation_typography'
  WHEN 'SOURCE_EQUALS_TARGET' THEN 'omission'
  WHEN 'INCONSISTENT_REPEATED_SOURCE' THEN 'consistency'
  WHEN 'TARGET_LENGTH_WARNING' THEN 'length_limit'
  WHEN 'NEWLINE_MISMATCH' THEN 'whitespace_linebreaks'
  WHEN 'EDGE_WHITESPACE' THEN 'whitespace_linebreaks'
  WHEN 'DOUBLE_SPACE' THEN 'whitespace_linebreaks'
  WHEN 'UNPAIRED_SYMBOL' THEN 'punctuation_typography'
  WHEN 'UNPAIRED_QUOTE' THEN 'punctuation_typography'
  WHEN 'REPEATED_WORD' THEN 'fluency_readability'
  WHEN 'EMAIL_MISMATCH' THEN 'placeholders_variables'
  WHEN 'URL_MISMATCH' THEN 'placeholders_variables'
  WHEN 'ALPHANUMERIC_MISMATCH' THEN 'placeholders_variables'
  WHEN 'TARGET_SOURCE_INCONSISTENCY' THEN 'consistency'
  WHEN 'FULLWIDTH_PUNCTUATION' THEN 'punctuation_typography'
  WHEN 'RESIDUAL_CJK' THEN 'omission'
  WHEN 'GLOSSARY_CONFLICT' THEN 'glossary_conflict'
  WHEN 'UPPERCASE_TOKEN_MISMATCH' THEN 'capitalization_case'
  WHEN 'CAMELCASE_TOKEN_MISMATCH' THEN 'capitalization_case'
  WHEN 'CRITIC_FIDELITY' THEN 'mistranslation'
  WHEN 'CRITIC_NATURALNESS' THEN 'fluency_readability'
  WHEN 'CRITIC_TERMINOLOGY' THEN 'terminology_soft'
  WHEN 'CRITIC_VOICE' THEN 'character_voice'
  WHEN 'CRITIC_CONSISTENCY' THEN 'consistency'
  ELSE 'other'
END;
`

const MIGRATION_8_SQL = `
ALTER TABLE segments ADD COLUMN current_stage_state TEXT NOT NULL DEFAULT 'untouched';
ALTER TABLE segments ADD COLUMN imported_native_status TEXT;

CREATE TABLE segment_stage_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  action TEXT NOT NULL,
  segment_revision INTEGER NOT NULL,
  actor TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_segment_stage_events_segment
  ON segment_stage_events(segment_id, stage, event_id);
`

const MIGRATION_9_SQL = `
ALTER TABLE proposals ADD COLUMN run_id TEXT;
ALTER TABLE proposals ADD COLUMN reissued_from_proposal_id TEXT;
ALTER TABLE proposals ADD COLUMN supersedes_proposal_id TEXT;

CREATE INDEX idx_proposals_run
  ON proposals(run_id, created_at, id);
`

const MIGRATION_10_SQL = `
ALTER TABLE qa_findings ADD COLUMN waived_by TEXT;
ALTER TABLE qa_findings ADD COLUMN waived_at TEXT;
`

const MIGRATION_11_SQL = `
ALTER TABLE qa_findings ADD COLUMN rule_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE qa_findings ADD COLUMN evidence_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE qa_findings ADD COLUMN first_seen_run_id TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE qa_findings ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';

UPDATE qa_findings SET evidence_hash = id WHERE evidence_hash = '';

CREATE INDEX idx_qa_findings_identity
  ON qa_findings(segment_id, segment_revision, code, rule_version, evidence_hash);

CREATE TABLE qa_finding_occurrences (
  occurrence_id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES qa_findings(id) ON DELETE CASCADE,
  qa_run_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(finding_id, qa_run_id)
);
CREATE INDEX idx_qa_finding_occurrences_finding
  ON qa_finding_occurrences(finding_id, observed_at, occurrence_id);

CREATE TABLE qa_finding_status_events (
  event_id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES qa_findings(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_qa_finding_status_events_finding
  ON qa_finding_status_events(finding_id, created_at, event_id);

INSERT INTO qa_finding_occurrences
  (occurrence_id, finding_id, qa_run_id, observed_at)
SELECT
  'qao:legacy:' || id,
  id,
  'legacy',
  created_at
FROM qa_findings;

INSERT INTO qa_finding_status_events
  (event_id, finding_id, from_status, to_status, actor_type, actor_id, reason, created_at)
SELECT
  'qse:legacy:' || id,
  id,
  NULL,
  status,
  CASE WHEN waived_by IS NULL THEN 'system' ELSE 'human' END,
  waived_by,
  waiver_reason,
  COALESCE(waived_at, created_at)
FROM qa_findings;

CREATE TABLE critic_finding_qa_links (
  artifact_id TEXT NOT NULL REFERENCES critic_artifacts(artifact_id) ON DELETE CASCADE,
  critic_finding_id TEXT NOT NULL,
  qa_finding_id TEXT NOT NULL REFERENCES qa_findings(id) ON DELETE CASCADE,
  PRIMARY KEY (artifact_id, critic_finding_id, qa_finding_id)
);
CREATE INDEX idx_critic_finding_qa_links_qa
  ON critic_finding_qa_links(qa_finding_id);
`

const MIGRATION_12_SQL = `
ALTER TABLE proposal_mutations ADD COLUMN run_id TEXT;
ALTER TABLE proposal_mutations ADD COLUMN tool_call_id TEXT;
ALTER TABLE proposal_mutations ADD COLUMN event_sequence INTEGER;

CREATE TABLE translation_jobs (
  job_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK(strategy IN ('fast', 'balanced', 'best')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  segment_ids_json TEXT NOT NULL,
  base_revisions_json TEXT NOT NULL,
  cursor INTEGER NOT NULL CHECK(cursor >= 0),
  completed_segment_ids_json TEXT NOT NULL,
  failed_segment_ids_json TEXT NOT NULL,
  proposal_ids_json TEXT NOT NULL,
  open_item_ids_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_translation_jobs_session_status
  ON translation_jobs(session_id, status, updated_at, job_id);
CREATE INDEX idx_translation_jobs_run
  ON translation_jobs(run_id, created_at, job_id);

CREATE TABLE project_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  run_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_project_events_run
  ON project_events(run_id, sequence);

CREATE TABLE project_event_acks (
  consumer_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  acked_at TEXT NOT NULL
);

CREATE TABLE run_changes (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  mutation_key TEXT NOT NULL REFERENCES proposal_mutations(idempotency_key),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK(change_kind IN ('created', 'updated', 'deleted', 'touched')),
  segment_id TEXT,
  expected_revision INTEGER,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL,
  undone_at TEXT
);
CREATE INDEX idx_run_changes_run
  ON run_changes(run_id, change_id);
`

const MIGRATION_13_SQL = `
CREATE TABLE proposal_issuances (
  issuance_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  session_id TEXT,
  run_id TEXT,
  tool_call_id TEXT,
  model_provider TEXT,
  model_id TEXT,
  runtime TEXT,
  role TEXT CHECK (role IS NULL OR role IN ('assistant', 'reviewer', 'auditor')),
  strategy TEXT CHECK (strategy IS NULL OR strategy IN ('fast', 'balanced', 'best')),
  linguist_prompt_version TEXT,
  prompt_hash TEXT,
  project_digest_hash TEXT,
  project_digest_revision TEXT,
  turn_context_version INTEGER,
  turn_context_snapshot_json TEXT,
  turn_context_hash TEXT,
  toolset_hash TEXT,
  evidence_refs_json TEXT NOT NULL,
  term_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (proposal_id, idempotency_key)
);
CREATE INDEX idx_proposal_issuances_proposal
  ON proposal_issuances(proposal_id, created_at, issuance_id);

ALTER TABLE term_entries RENAME TO term_entries_v12;

CREATE TABLE term_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  term TEXT NOT NULL,
  translation TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'allowed'
    CHECK (status IN ('allowed', 'preferred', 'required', 'forbidden', 'deprecated')),
  case_sensitive INTEGER NOT NULL DEFAULT 0
    CHECK (case_sensitive IN (0, 1)),
  module TEXT,
  category TEXT,
  image_ref TEXT
);

INSERT INTO term_entries (
  id, project_id, term, translation, note, created_at, status,
  case_sensitive, module, category, image_ref
)
SELECT
  id, project_id, term, translation, note, created_at, status,
  case_sensitive, module, category, image_ref
FROM term_entries_v12;

DROP TABLE term_entries_v12;
CREATE INDEX idx_term_entries_project_status
  ON term_entries(project_id, status, created_at, id);
`

/** 原始 TM/TB 导入文件的单源 provenance；bytes 统一落 blobs/。 */
const MIGRATION_14_SQL = `
CREATE TABLE reference_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tm', 'terms')),
  original_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  blob_relpath TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reference_imports_project_kind
  ON reference_imports(project_id, kind, created_at, id);
`

/** Adapter-owned import metadata; the store persists it but never interprets it. */
const MIGRATION_15_SQL = `
ALTER TABLE assets ADD COLUMN format_config_json TEXT;
`

export const MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, description: 'initial CAT schema (plan 5.4)', sql: MIGRATION_1_SQL },
  { version: 2, description: 'idempotent human proposal mutations (PB-053)', sql: MIGRATION_2_SQL },
  { version: 3, description: 'revision-bound QA findings and waiver reasons (PB-071)', sql: MIGRATION_3_SQL },
  { version: 4, description: 'TM/TB status, case sensitivity, and lookup indexes (PB-080)', sql: MIGRATION_4_SQL },
  { version: 5, description: 'independent critic review artifacts (PB-083)', sql: MIGRATION_5_SQL },
  { version: 6, description: 'project assets: style guide, sentence patterns, context docs, tech constraints, voice profiles (PB-095)', sql: MIGRATION_6_SQL },
  { version: 7, description: 'QA contract alignment: five-tier severity, issue_type, disposition (PB-096)', sql: MIGRATION_7_SQL },
  { version: 8, description: 'T/E/P stage state and confirmation audit', sql: MIGRATION_8_SQL },
  { version: 9, description: 'proposal run provenance and explicit reconciliation lineage', sql: MIGRATION_9_SQL },
  { version: 10, description: 'QA waiver operator and timestamp evidence', sql: MIGRATION_10_SQL },
  { version: 11, description: 'QA finding identity, occurrence/status history, and critic trace links', sql: MIGRATION_11_SQL },
  { version: 12, description: 'durable translation jobs, run recovery, and project event outbox', sql: MIGRATION_12_SQL },
  {
    version: 13,
    description: 'required terminology and proposal issuance provenance',
    sql: MIGRATION_13_SQL,
    prerequisites: [
      {
        sql: 'SELECT CASE WHEN MAX(version) = 12 THEN 0 ELSE 1 END AS violations FROM schema_migrations',
        expected: 0,
      },
      {
        sql: `SELECT 5 - COUNT(*) AS violations
              FROM sqlite_master
              WHERE type = 'table'
                AND name IN ('proposals', 'term_entries', 'translation_jobs', 'project_events', 'run_changes')`,
        expected: 0,
      },
    ],
    backfill: backfillProposalIssuances,
    validations: [
      {
        sql: `SELECT COUNT(*) AS violations
              FROM proposals p
              LEFT JOIN proposal_issuances i ON i.proposal_id = p.id
              WHERE i.issuance_id IS NULL`,
        expected: 0,
      },
      {
        sql: `SELECT COUNT(*) AS violations
              FROM proposal_issuances i
              LEFT JOIN proposals p ON p.id = i.proposal_id
              WHERE p.id IS NULL`,
        expected: 0,
      },
      {
        sql: `SELECT COUNT(*) AS violations
              FROM term_entries
              WHERE status NOT IN ('allowed', 'preferred', 'required', 'forbidden', 'deprecated')`,
        expected: 0,
      },
      {
        sql: `SELECT COUNT(*) AS violations
              FROM proposal_issuances
              WHERE issuance_id NOT LIKE 'pis_v2_%'`,
        expected: 0,
      },
    ],
  },
  {
    version: 14,
    description: 'managed TM/TB import source provenance',
    sql: MIGRATION_14_SQL,
  },
  {
    version: 15,
    description: 'opaque adapter import configuration for faithful re-export',
    sql: MIGRATION_15_SQL,
  },
]
