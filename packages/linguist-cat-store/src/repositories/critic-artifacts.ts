/**
 * Critic artifacts repository (PB-083): persists independent-critic review
 * artifacts. Artifacts are advisory-only review output — this repository has
 * no path to segment/proposal/target writes. Inserts are idempotent by the
 * content-derived artifactId (same artifact, same id), following the
 * existing repository idempotency convention.
 */

import type { IndependentCriticArtifact } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { criticArtifactFromRow, type CriticArtifactRow } from './rows'

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
  insert(artifact: IndependentCriticArtifact): void {
    this.db.assertWritable(`insert critic artifact ${artifact.artifactId}`)
    this.db.db
      .prepare(
        'INSERT OR IGNORE INTO critic_artifacts (artifact_id, segment_id, created_at, artifact_json) VALUES (?, ?, ?, ?)',
      )
      .run(artifact.artifactId, artifact.subject.segmentId, this.now(), JSON.stringify(artifact))
  }

  getById(artifactId: string): IndependentCriticArtifact | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM critic_artifacts WHERE artifact_id = ?')
      .get(artifactId) as CriticArtifactRow | undefined
    return row === undefined ? undefined : criticArtifactFromRow(row)
  }

  listBySegment(segmentId: string): IndependentCriticArtifact[] {
    const rows = this.db.db
      .prepare('SELECT * FROM critic_artifacts WHERE segment_id = ? ORDER BY created_at, artifact_id')
      .all(segmentId) as CriticArtifactRow[]
    return rows.map(criticArtifactFromRow)
  }
}
