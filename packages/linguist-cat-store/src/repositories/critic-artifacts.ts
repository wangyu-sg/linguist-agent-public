/**
 * Critic artifacts repository (PB-083): persists independent-critic review
 * artifacts. Artifacts are advisory-only review output — this repository has
 * no path to segment/proposal/target writes. Inserts are idempotent by the
 * content-derived artifactId (same artifact, same id), following the
 * existing repository idempotency convention.
 */

import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  criticArtifactFromRow,
  type CriticArtifactRow,
  type PersistedCriticArtifact,
} from './rows'

export class CriticArtifactsRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly now: () => string,
  ) {}

  /**
   * Insert an artifact; re-inserting the same artifactId is a no-op (the
   * artifact is content-derived, so a conflicting payload cannot exist).
   * Single statement: callers compose larger atomic writes (the
   * cat_submit_critic_review tool wraps artifact + QA findings in one
   * transaction).
   */
  insert(artifact: PersistedCriticArtifact): void {
    this.db.assertWritable(`insert critic artifact ${artifact.artifactId}`)
    this.db.db
      .prepare(
        'INSERT OR IGNORE INTO critic_artifacts (artifact_id, segment_id, created_at, artifact_json) VALUES (?, ?, ?, ?)',
      )
      .run(artifact.artifactId, artifact.subject.segmentId, this.now(), JSON.stringify(artifact))
  }

  getById(artifactId: string): PersistedCriticArtifact | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM critic_artifacts WHERE artifact_id = ?')
      .get(artifactId) as CriticArtifactRow | undefined
    return row === undefined ? undefined : criticArtifactFromRow(row)
  }

  listBySegment(segmentId: string): PersistedCriticArtifact[] {
    const rows = this.db.db
      .prepare('SELECT * FROM critic_artifacts WHERE segment_id = ? ORDER BY created_at, artifact_id')
      .all(segmentId) as CriticArtifactRow[]
    return rows.map(criticArtifactFromRow)
  }

  linkFindingToQa(
    artifactId: string,
    criticFindingId: string,
    qaFindingId: string,
  ): void {
    this.db.assertWritable(`link critic finding ${criticFindingId}`)
    const artifact = this.getById(artifactId)
    if (artifact === undefined) throw new StoreNotFoundError('critic artifact', artifactId)
    if (
      artifact.schemaVersion !== 2 ||
      !artifact.findings.some((finding) => finding.findingId === criticFindingId)
    ) {
      throw new StoreNotFoundError('critic finding', criticFindingId)
    }
    this.db.db.prepare(`
      INSERT OR IGNORE INTO critic_finding_qa_links
        (artifact_id, critic_finding_id, qa_finding_id)
      VALUES (?, ?, ?)
    `).run(artifactId, criticFindingId, qaFindingId)
  }

  traceByQaFindingId(qaFindingId: string): Array<{
    artifact: PersistedCriticArtifact
    criticFindingId: string
  }> {
    const rows = this.db.db.prepare(`
      SELECT artifact_id, critic_finding_id
      FROM critic_finding_qa_links
      WHERE qa_finding_id = ?
      ORDER BY artifact_id, critic_finding_id
    `).all(qaFindingId) as Array<{ artifact_id: string; critic_finding_id: string }>
    return rows.map((row) => {
      const artifact = this.getById(row.artifact_id)
      if (artifact === undefined) throw new StoreNotFoundError('critic artifact', row.artifact_id)
      return { artifact, criticFindingId: row.critic_finding_id }
    })
  }

  qaFindingIdsByArtifact(artifactId: string): string[] {
    const rows = this.db.db.prepare(`
      SELECT qa_finding_id
      FROM critic_finding_qa_links
      WHERE artifact_id = ?
      ORDER BY critic_finding_id, qa_finding_id
    `).all(artifactId) as Array<{ qa_finding_id: string }>
    return rows.map((row) => row.qa_finding_id)
  }
}
