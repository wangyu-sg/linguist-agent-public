import {
  parseCriticReviewArtifact,
  parseIndependentCriticArtifact,
} from '@linguist/cat-core'
import type { CatDatabase } from './database'
import {
  addProblem,
  countRows,
  integrityResult,
  safeCount,
  type ProblemCounts,
  type ProjectIntegrityCheck,
} from './integrity-types'

export function checkSqlite(
  db: CatDatabase,
  pragma: 'integrity_check' | 'quick_check',
): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  try {
    const rows = db.db.prepare(`PRAGMA ${pragma}`).all() as Array<Record<string, unknown>>
    const bad = rows.filter((row) => Object.values(row)[0] !== 'ok').length
    addProblem(
      failed,
      pragma === 'integrity_check' ? 'SQLITE_INTEGRITY_FAILED' : 'SQLITE_QUICK_CHECK_FAILED',
      bad,
    )
    return integrityResult('sqlite_integrity', rows.length, failed)
  } catch {
    addProblem(failed, 'SQLITE_INTEGRITY_UNREADABLE')
    return integrityResult('sqlite_integrity', 0, failed)
  }
}

export function checkForeignKeys(db: CatDatabase): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  try {
    const rows = db.db.prepare('PRAGMA foreign_key_check').all()
    addProblem(failed, 'FOREIGN_KEY_VIOLATION', rows.length)
    return integrityResult('foreign_keys', rows.length, failed)
  } catch {
    addProblem(failed, 'FOREIGN_KEY_CHECK_FAILED')
    return integrityResult('foreign_keys', 0, failed)
  }
}

export function checkOrphans(db: CatDatabase, projectId: string): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  const unavailable: ProblemCounts = new Map()
  const projectTables = [
    'assets',
    'term_entries',
    'tm_units',
    'style_guide_rules',
    'sentence_patterns',
    'context_docs',
    'tech_constraints',
    'voice_profiles',
    'exports',
    'translation_jobs',
    'project_events',
  ]
  for (const table of projectTables) {
    safeCount(
      db,
      `SELECT COUNT(*) AS n FROM ${table} WHERE project_id <> ?`,
      failed,
      'PROJECT_SCOPE_MISMATCH',
      unavailable,
      projectId,
    )
  }
  safeCount(
    db,
    'SELECT COUNT(*) AS n FROM critic_artifacts c LEFT JOIN segments s ON s.id = c.segment_id WHERE s.id IS NULL',
    failed,
    'REVIEW_SEGMENT_ORPHAN',
    unavailable,
  )
  safeCount(
    db,
    'SELECT COUNT(*) AS n FROM exports e LEFT JOIN assets a ON a.id = e.asset_id WHERE a.id IS NULL',
    failed,
    'EXPORT_ASSET_ORPHAN',
    unavailable,
  )
  return integrityResult('orphans', projectTables.length + 2, failed, unavailable)
}

export function checkProposalReferences(db: CatDatabase): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  const unavailable: ProblemCounts = new Map()
  let checkedItems = 0
  try {
    checkedItems = countRows(db, 'SELECT COUNT(*) AS n FROM proposals')
    safeCount(db, `
      SELECT COUNT(*) AS n
      FROM proposals p
      LEFT JOIN segments s ON s.id = p.segment_id
      WHERE s.id IS NULL
         OR p.base_revision < 0
         OR p.base_revision > s.revision
         OR (p.base_revision > 0 AND NOT EXISTS (
           SELECT 1 FROM segment_revisions r
           WHERE r.segment_id = p.segment_id AND r.revision = p.base_revision
         ))
    `, failed, 'PROPOSAL_BASE_REVISION_INVALID', unavailable)
    safeCount(db, `
      SELECT COUNT(*) AS n FROM proposals p
      WHERE p.reissued_from_proposal_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM proposals parent WHERE parent.id = p.reissued_from_proposal_id)
    `, failed, 'PROPOSAL_REISSUE_REFERENCE_MISSING', unavailable)
    safeCount(db, `
      SELECT COUNT(*) AS n FROM proposals p
      WHERE p.supersedes_proposal_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM proposals parent WHERE parent.id = p.supersedes_proposal_id)
    `, failed, 'PROPOSAL_SUPERSEDES_REFERENCE_MISSING', unavailable)
    safeCount(db, `
      SELECT COUNT(*) AS n FROM proposals
      WHERE CASE
        WHEN json_valid(evidence_refs_json) = 0 THEN 1
        WHEN json_type(evidence_refs_json) <> 'array' THEN 1
        WHEN json_valid(term_refs_json) = 0 THEN 1
        WHEN json_type(term_refs_json) <> 'array' THEN 1
        WHEN json_valid(warnings_json) = 0 THEN 1
        WHEN json_type(warnings_json) <> 'array' THEN 1
        ELSE 0
      END = 1
    `, failed, 'PROPOSAL_REFERENCE_JSON_INVALID', unavailable)
    if (db.schemaVersion >= 13) {
      safeCount(db, `
        SELECT COUNT(*) AS n
        FROM proposals p
        LEFT JOIN proposal_issuances i ON i.proposal_id = p.id
        WHERE i.issuance_id IS NULL
      `, failed, 'PROPOSAL_ISSUANCE_MISSING', unavailable)
      safeCount(db, `
        SELECT COUNT(*) AS n
        FROM proposal_issuances i
        LEFT JOIN proposals p ON p.id = i.proposal_id
        WHERE p.id IS NULL
      `, failed, 'PROPOSAL_ISSUANCE_ORPHAN', unavailable)
      safeCount(db, `
        SELECT COUNT(*) AS n
        FROM proposal_issuances i
        LEFT JOIN proposals p ON p.id = i.proposal_id
        LEFT JOIN segments s ON s.id = p.segment_id
        WHERE p.id IS NOT NULL AND s.id IS NULL
      `, failed, 'PROPOSAL_ISSUANCE_SEGMENT_MISSING', unavailable)
      safeCount(db, `
        SELECT COUNT(*) AS n
        FROM proposal_issuances
        WHERE CASE
          WHEN json_valid(evidence_refs_json) = 0 THEN 1
          WHEN json_type(evidence_refs_json) <> 'array' THEN 1
          WHEN json_valid(term_refs_json) = 0 THEN 1
          WHEN json_type(term_refs_json) <> 'array' THEN 1
          WHEN turn_context_snapshot_json IS NOT NULL
            AND json_valid(turn_context_snapshot_json) = 0 THEN 1
          ELSE 0
        END = 1
      `, failed, 'PROPOSAL_ISSUANCE_PROVENANCE_JSON_INVALID', unavailable)
    }
  } catch {
    addProblem(unavailable, 'PROPOSAL_REFERENCE_SCAN_UNAVAILABLE')
  }
  return integrityResult('proposal_references', checkedItems, failed, unavailable)
}

export function checkQaReferences(db: CatDatabase): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  const unavailable: ProblemCounts = new Map()
  let checkedItems = 0
  try {
    checkedItems = countRows(db, 'SELECT COUNT(*) AS n FROM qa_findings')
    safeCount(db, `
      SELECT COUNT(*) AS n
      FROM qa_findings q
      LEFT JOIN segments s ON s.id = q.segment_id
      WHERE s.id IS NULL
         OR q.segment_revision < 0
         OR q.segment_revision > s.revision
         OR (q.segment_revision > 0 AND NOT EXISTS (
           SELECT 1 FROM segment_revisions r
           WHERE r.segment_id = q.segment_id AND r.revision = q.segment_revision
         ))
    `, failed, 'QA_SEGMENT_REVISION_INVALID', unavailable)
    safeCount(db, `
      SELECT COUNT(*) AS n FROM qa_findings q
      WHERE NOT EXISTS (SELECT 1 FROM qa_finding_occurrences o WHERE o.finding_id = q.id)
    `, failed, 'QA_OCCURRENCE_MISSING', unavailable)
    safeCount(db, `
      SELECT COUNT(*) AS n FROM qa_findings q
      WHERE NOT EXISTS (SELECT 1 FROM qa_finding_status_events e WHERE e.finding_id = q.id)
    `, failed, 'QA_STATUS_HISTORY_MISSING', unavailable)
    safeCount(db, `
      SELECT COUNT(*) AS n FROM qa_findings q
      WHERE q.status <> (
        SELECT e.to_status FROM qa_finding_status_events e
        WHERE e.finding_id = q.id
        ORDER BY e.created_at DESC, e.event_id DESC LIMIT 1
      )
    `, failed, 'QA_STATUS_HISTORY_DIVERGED', unavailable)
  } catch {
    addProblem(unavailable, 'QA_REFERENCE_SCAN_UNAVAILABLE')
  }
  return integrityResult('qa_references', checkedItems, failed, unavailable)
}

export function checkReviewReferences(db: CatDatabase): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  const unavailable: ProblemCounts = new Map()
  let rows: Array<{ artifact_id: string; segment_id: string; artifact_json: string }>
  try {
    rows = db.db.prepare(
      'SELECT artifact_id, segment_id, artifact_json FROM critic_artifacts ORDER BY artifact_id',
    ).all() as typeof rows
  } catch {
    return integrityResult(
      'review_references',
      0,
      failed,
      new Map([['REVIEW_REFERENCE_SCAN_UNAVAILABLE', 1]]),
    )
  }
  const findingIds = new Map<string, Set<string>>()
  for (const row of rows) {
    try {
      const raw = JSON.parse(row.artifact_json) as { schemaVersion?: unknown }
      const artifact = raw.schemaVersion === 2
        ? parseCriticReviewArtifact(raw)
        : parseIndependentCriticArtifact(raw)
      if (artifact.artifactId !== row.artifact_id || artifact.subject.segmentId !== row.segment_id) {
        addProblem(failed, 'REVIEW_ROW_IDENTITY_MISMATCH')
      }
      findingIds.set(row.artifact_id, new Set(artifact.findings.map((finding) => finding.findingId)))
      const proposal = db.db.prepare('SELECT segment_id FROM proposals WHERE id = ?').get(
        artifact.subject.candidateId,
      ) as { segment_id: string } | undefined
      if (proposal === undefined || proposal.segment_id !== row.segment_id) {
        addProblem(failed, 'REVIEW_PROPOSAL_REFERENCE_MISSING')
      }
      if (artifact.schemaVersion === 2 && artifact.snapshot.proposalId !== artifact.subject.candidateId) {
        addProblem(failed, 'REVIEW_SNAPSHOT_REFERENCE_MISMATCH')
      }
    } catch {
      addProblem(failed, 'REVIEW_ARTIFACT_INVALID')
    }
  }
  try {
    const links = db.db.prepare(`
      SELECT artifact_id, critic_finding_id
      FROM critic_finding_qa_links
      ORDER BY artifact_id, critic_finding_id
    `).all() as Array<{ artifact_id: string; critic_finding_id: string }>
    for (const link of links) {
      if (!findingIds.get(link.artifact_id)?.has(link.critic_finding_id)) {
        addProblem(failed, 'REVIEW_FINDING_LINK_INVALID')
      }
    }
  } catch {
    addProblem(unavailable, 'REVIEW_QA_LINK_SCAN_UNAVAILABLE')
  }
  return integrityResult('review_references', rows.length, failed, unavailable)
}
