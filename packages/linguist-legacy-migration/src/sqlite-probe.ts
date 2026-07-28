/**
 * Read-only probe for the legacy CAT-core SQLite layer (PB-090).
 *
 * Semantics (legacy source, see layout.ts provenance header):
 * - data/runtime/cat-core-sqlite-v1/authority-v1.json present => SQLite is
 *   AUTHORITATIVE and the legacy JSON files under data/projects/ are dead
 *   to the old runtime (assertCatCoreLegacyAllowed throws there).
 * - The store is event-sourced; projections live in
 *   projections(stream_id, projection_json) with projection_json shaped
 *   {value: <entity>} (storage-sqlite/src/index.ts:312-316 +
 *   cat_core_repository.ts projectionValue()).
 * - Project ids are recovered from manifest projections
 *   (stream_id LIKE 'cat-core-manifest-%', value.projectId).
 *
 * Hard rules: the source database is NEVER opened directly — the
 * db/wal/shm trio is staged to a tmpdir copy first (PB-090-followup: even
 * readOnly opens can rewrite -shm under WAL), the staged copy is opened
 * with { readOnly: true }, and this module imports no write APIs. A
 * missing/corrupt/unopenable database
 * or an unexpected schema degrades to probe errors — never a thrown scan.
 *
 * The node:sqlite loading pattern (createRequire + structural types) follows
 * packages/linguist-cat-store/src/runtime.ts; duplicated rather than
 * imported to keep this package dependency-free.
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CAT_CORE_AUTHORITY_REL,
  CAT_CORE_BLOBS_REL,
  CAT_CORE_DB_REL,
  CAT_CORE_READ_CACHE_REL,
  catCoreStreamId,
  safeCachePart,
  type CatCoreStreamKind,
} from './layout'

// ---------------------------------------------------------------------------
// minimal structural node:sqlite surface (read-only usage only)

interface SqliteStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  close(): void
}

interface DatabaseSyncCtor {
  new (path: string, options?: { open?: boolean; readOnly?: boolean }): SqliteDatabase
}

function loadDatabaseSync(): DatabaseSyncCtor {
  const require = createRequire(import.meta.url)
  const mod = require('node:sqlite') as { DatabaseSync?: DatabaseSyncCtor }
  if (typeof mod.DatabaseSync !== 'function') {
    throw new Error('node:sqlite loaded but DatabaseSync is missing')
  }
  return mod.DatabaseSync
}

// ---------------------------------------------------------------------------
// probe

export type DataSource = 'sqlite' | 'read-cache' | 'legacy-json' | 'none'

/**
 * Source-ref projection row (PB-092), validated subset of the legacy
 * CatCoreSourceRef shape — provenance:
 * linguist-agent/packages/cat-data/src/cat_core_storage.ts:13-22
 * ({id, projectId, ownerKind, ownerId, path, sha256, bytes, blobRefId}) and
 * linguist-agent/packages/storage-sqlite/src/cat_core_repository.ts:181-213
 * (projection kind 'source', id `${ownerKind}:${ownerId}`, value = ref[];
 * publishSourceRef CAS-stores the bytes and sets sha256/bytes/blobRefId from
 * the blob ref). Source refs live ONLY in the SQLite layer: the read-cache
 * path scheme (catCoreReadCachePath) has no 'source' kind, so there is no
 * read-cache fallback for them.
 */
export interface CatCoreSourceRefInfo {
  path: string
  sha256: string
  bytes: number
  blobRefId: string
}

export interface CatCoreProbe {
  /** authority-v1.json exists => SQLite layer is authoritative. */
  authority: boolean
  /** cat-core.sqlite file exists. */
  dbPresent: boolean
  dbSha256: string | null
  dbBytes: number | null
  /** true when the database opened read-only AND the projections table is queryable. */
  opened: boolean
  /** First open/query error, when any (scan continues with read-cache/legacy signals). */
  error: string | null
  /** Project ids recovered from manifest projections (empty when not opened). */
  projectIds: string[]
  /** Read one projection entity ({value}-unwrapped), null when absent. Throws nothing. */
  read(kind: CatCoreStreamKind, projectId: string, id?: string): unknown | null
  /** All batch projection entities whose value.projectId matches. */
  listBatches(projectId: string): unknown[]
  /** Validated source refs for one owner ([] when absent/unopened/malformed). */
  readSourceRefs(projectId: string, ownerKind: 'batch' | 'asset', ownerId: string): CatCoreSourceRefInfo[]
  close(): void
}

/** Unwrap a projection_json payload: {value: entity} (legacy shape), tolerating bare entities. */
function unwrapProjection(parsed: unknown): unknown {
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'value' in parsed) {
    return (parsed as { value: unknown }).value
  }
  return parsed
}

export function probeCatCore(root: string): CatCoreProbe {
  const authority = existsSync(join(root, CAT_CORE_AUTHORITY_REL))
  const dbPath = join(root, CAT_CORE_DB_REL)
  const dbPresent = existsSync(dbPath)
  let dbSha256: string | null = null
  let dbBytes: number | null = null
  if (dbPresent) {
    try {
      const bytes = readFileSync(dbPath)
      dbSha256 = createHash('sha256').update(bytes).digest('hex')
      dbBytes = statSync(dbPath).size
    } catch {
      // unreadable db file: opened/error below will carry the detail
    }
  }

  let db: SqliteDatabase | null = null
  let opened = false
  let error: string | null = null
  let projectIds: string[] = []
  let stagingDir: string | null = null
  const batchCache = new Map<string, unknown[]>()

  if (dbPresent) {
    try {
      const DatabaseSync = loadDatabaseSync()
      // PB-090-followup：真零触碰。WAL 模式下即使 readOnly 打开，SQLite 也
      // 可能回写 -shm（wal-index 共享内存缓存，G9 真实数据复跑实测：主库与
      // wal 未动、shm 哈希变化）——先把 db/wal/shm 三件套拷到临时目录再开，
      // 源树逐字节不动；无法暂存则不开库（降级 read-cache），绝不直接开源库。
      stagingDir = mkdtempSync(join(tmpdir(), 'la-legacy-probe-'))
      copyFileSync(dbPath, join(stagingDir, 'cat-core.sqlite'))
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(`${dbPath}${suffix}`)) {
          copyFileSync(`${dbPath}${suffix}`, join(stagingDir, `cat-core.sqlite${suffix}`))
        }
      }
      db = new DatabaseSync(join(stagingDir, 'cat-core.sqlite'), { readOnly: true })
      opened = true
    } catch (err) {
      error = `open read-only failed: ${err instanceof Error ? err.message : String(err)}`
    }
    if (db) {
      try {
        const rows = db
          .prepare("SELECT projection_json FROM projections WHERE stream_id LIKE 'cat-core-manifest-%'")
          .all() as Array<{ projection_json: string }>
        const ids = new Set<string>()
        for (const row of rows) {
          const value = unwrapProjection(JSON.parse(row.projection_json))
          if (typeof value === 'object' && value !== null && typeof (value as { projectId?: unknown }).projectId === 'string') {
            ids.add((value as { projectId: string }).projectId)
          }
        }
        projectIds = [...ids].sort()
      } catch (err) {
        // A file that opens but fails the first query (corrupt, not a
        // database, or unexpected schema) is unusable for projection reads:
        // report opened=false so the scan degrades to the read-cache layer.
        error = `projection query failed (unexpected schema?): ${err instanceof Error ? err.message : String(err)}`
        projectIds = []
        opened = false
      }
    }
  }

  function read(kind: CatCoreStreamKind, projectId: string, id = 'root'): unknown | null {
    if (!db) return null
    try {
      const row = db.prepare('SELECT projection_json FROM projections WHERE stream_id = ?').get(
        catCoreStreamId(kind, projectId, id),
      ) as { projection_json: string } | undefined
      if (!row) return null
      return unwrapProjection(JSON.parse(row.projection_json))
    } catch {
      return null
    }
  }

  function listBatches(projectId: string): unknown[] {
    if (!db) return []
    const cached = batchCache.get(projectId)
    if (cached) return cached
    let result: unknown[] = []
    try {
      const rows = db
        .prepare("SELECT projection_json FROM projections WHERE stream_id LIKE 'cat-core-batch-%'")
        .all() as Array<{ projection_json: string }>
      result = rows
        .map((row) => unwrapProjection(JSON.parse(row.projection_json)))
        .filter(
          (value): value is { projectId: string } =>
            typeof value === 'object' &&
            value !== null &&
            (value as { projectId?: unknown }).projectId === projectId,
        )
    } catch {
      result = []
    }
    batchCache.set(projectId, result)
    return result
  }

  function readSourceRefs(projectId: string, ownerKind: 'batch' | 'asset', ownerId: string): CatCoreSourceRefInfo[] {
    // Legacy stream id component: `${ownerKind}:${ownerId}`
    // (cat_core_storage.ts catCoreOwnerId(); cat_core_repository.ts sourceOwnerId()).
    const value = read('source', projectId, `${ownerKind}:${ownerId}`)
    if (!Array.isArray(value)) return []
    return value.filter(
      (ref): ref is CatCoreSourceRefInfo =>
        typeof ref === 'object' &&
        ref !== null &&
        !Array.isArray(ref) &&
        typeof (ref as CatCoreSourceRefInfo).path === 'string' &&
        typeof (ref as CatCoreSourceRefInfo).sha256 === 'string' &&
        typeof (ref as CatCoreSourceRefInfo).blobRefId === 'string' &&
        typeof (ref as CatCoreSourceRefInfo).bytes === 'number' &&
        Number.isFinite((ref as CatCoreSourceRefInfo).bytes),
    )
  }

  return {
    authority,
    dbPresent,
    dbSha256,
    dbBytes,
    opened,
    error,
    projectIds,
    read,
    listBatches,
    readSourceRefs,
    close: () => {
      try {
        db?.close()
      } catch {
        // closing a probe must never fail a scan
      }
      db = null
      if (stagingDir !== null) {
        try {
          rmSync(stagingDir, { recursive: true, force: true })
        } catch {
          // staging cleanup is best-effort (tmpdir 会由 OS 兜底清理)
        }
        stagingDir = null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// read-cache fallback (only meaningful while authority is active, per
// readCatCoreReadCache: no marker => null; marker + missing file => error)

export interface ReadCacheResult {
  value: unknown | null
  /** set when the marker is active but the projection file is missing/unreadable */
  error: string | null
}

export function readCacheJson(root: string, kind: 'manifest' | 'batch' | 'tm' | 'termbase', projectId: string, id = 'root'): ReadCacheResult {
  const filename =
    kind === 'manifest' ? 'manifest.json' : kind === 'tm' ? 'tm.json' : kind === 'termbase' ? 'termbase.json' : `${safeCachePart(id)}.json`
  const directory = kind === 'batch' ? 'batches' : ''
  const path = join(root, CAT_CORE_READ_CACHE_REL, safeCachePart(projectId), directory, filename)
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) as unknown, error: null }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { value: null, error: `read-cache projection missing for ${kind}/${projectId}/${id}` }
    }
    return { value: null, error: `read-cache projection unreadable for ${kind}/${projectId}/${id}: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** List batch ids present in the read-cache for a project (empty when none). */
export function listReadCacheBatchIds(root: string, projectId: string): string[] {
  const dir = join(root, CAT_CORE_READ_CACHE_REL, safeCachePart(projectId), 'batches')
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort()
  } catch {
    return []
  }
}

/** Blob-store evidence path (CAS blobs live under blob-store/blobs/sha256/<2hex>/<digest>). */
export function blobStoreDir(root: string): string {
  return join(root, CAT_CORE_BLOBS_REL)
}
