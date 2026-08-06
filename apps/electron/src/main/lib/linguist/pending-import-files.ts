/**
 * 短生命周期、主进程私有的待确认文件。
 *
 * 只保存原生 picker 已读入的 bytes；不会写项目目录、数据库或 renderer。
 * XLSX 映射与 TM/TB 候选共用同一存储，确认时必须回显 token 的项目、用途和
 * source hash，过期/取消只移除内存项。
 */

import { randomUUID } from 'node:crypto'

export const PENDING_IMPORT_FILE_TTL_MS = 5 * 60_000

export type PendingImportFileScope =
  | 'xlsx-mapping'
  | 'reference-tm'
  | 'reference-terms'

export interface PendingImportFile {
  id: string
  scope: PendingImportFileScope
  projectId: string
  filename: string
  sourceSha256: string
  bytes: Uint8Array
  expiresAt: number
}

export interface IssuePendingImportFile {
  scope: PendingImportFileScope
  projectId: string
  filename: string
  sourceSha256: string
  bytes: Uint8Array
  ttlMs?: number
}

/**
 * 每个 project + scope 只保留最新 picker 结果；这与 XLSX 映射原有行为一致，
 * 且避免用户反复点选时在内存积压客户文件。
 */
export class PendingImportFileStore {
  private readonly files = new Map<string, PendingImportFile>()

  constructor(private readonly now: () => number = Date.now) {}

  issue(input: IssuePendingImportFile): PendingImportFile {
    this.purgeExpired()
    for (const [id, item] of this.files) {
      if (item.scope === input.scope && item.projectId === input.projectId) this.files.delete(id)
    }
    const item: PendingImportFile = {
      id: randomUUID(),
      scope: input.scope,
      projectId: input.projectId,
      filename: input.filename,
      sourceSha256: input.sourceSha256,
      bytes: input.bytes,
      expiresAt: this.now() + (input.ttlMs ?? PENDING_IMPORT_FILE_TTL_MS),
    }
    this.files.set(item.id, item)
    return item
  }

  get(id: string, scope: PendingImportFileScope): PendingImportFile | undefined {
    this.purgeExpired()
    const item = this.files.get(id)
    return item?.scope === scope ? item : undefined
  }

  remove(id: string, scope: PendingImportFileScope): boolean {
    const item = this.get(id, scope)
    if (item === undefined) return false
    return this.files.delete(id)
  }

  purgeExpired(): void {
    const now = this.now()
    for (const [id, item] of this.files) {
      if (item.expiresAt <= now) this.files.delete(id)
    }
  }
}
