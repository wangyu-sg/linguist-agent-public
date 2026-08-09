/** 只为撤销导入保护读取历史 critic_artifacts；没有写入或产品投影能力。 */
import type { CatDatabase } from '../database'

export class LegacyCriticArtifactsReader {
  constructor(private readonly db: CatDatabase) {}

  countByAsset(assetId: string): number {
    const row = this.db.db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM critic_artifacts
         INNER JOIN segments ON segments.id = critic_artifacts.segment_id
         WHERE segments.asset_id = ?`,
      )
      .get(assetId) as { n: number }
    return Number(row.n)
  }
}
