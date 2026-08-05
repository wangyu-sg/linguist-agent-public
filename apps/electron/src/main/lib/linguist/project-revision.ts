import { createHash } from 'node:crypto'
import type { LinguistProject } from '@linguist/cat-core'
import type { ProjectDatabase } from '@linguist/cat-store'

const PAGE_SIZE = 500

/**
 * 导出修订只哈希稳定 ID、段 revision/状态和项目元数据时间，不读取客户正文。
 * ponytail: 低频导出/列表先 O(n) 计算；十万段项目实测卡顿后再持久化单调 revision。
 */
export function computeLinguistProjectRevision(
  project: LinguistProject,
  db: ProjectDatabase,
): string {
  const hash = createHash('sha256')
  hash.update(project.updatedAt)
  for (const asset of db.assets.listByProject()) {
    hash.update(asset.id)
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const segments = db.segments.query({
        assetId: asset.id,
        limit: PAGE_SIZE,
        offset,
      })
      for (const segment of segments) {
        hash.update(
          `${segment.id}\0${segment.revision}\0${segment.status}\0${segment.currentStageState ?? 'untouched'}\n`,
        )
      }
      if (segments.length < PAGE_SIZE) break
    }
  }
  return `rev-${hash.digest('hex')}`
}
