import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { sha256Hex } from '@linguist/cat-formats'
import type { CatDatabase } from './database'
import {
  addProblem,
  integrityResult,
  type ProblemCounts,
  type ProjectIntegrityCheck,
  type ScanProjectIntegrityOptions,
} from './integrity-types'
import {
  readProjectManifestFile,
  type ProjectManifest,
} from './project-index'

export interface ProjectManifestCheck {
  check: ProjectIntegrityCheck
  manifest?: ProjectManifest
}

/** mainFileSnapshot 是最近一次 checkpoint 的审计记录，不与实时 cat.db 字节强行等同。 */
export function hasCompleteDatabaseIdentity(
  manifest: ProjectManifest,
  expectedApplicationId: number,
  expectedSchemaVersion: number,
): boolean {
  const identity = manifest.databaseIdentity
  const snapshot = identity?.mainFileSnapshot
  return identity?.projectId === manifest.id
    && identity.applicationId === expectedApplicationId
    && identity.schemaVersion === expectedSchemaVersion
    && typeof identity.lastMigratedByVersion === 'string'
    && identity.lastMigratedByVersion.length > 0
    && snapshot?.state === 'post-migration-checkpoint'
    && Number.isSafeInteger(snapshot.sizeBytes)
    && snapshot.sizeBytes > 0
    && /^[0-9a-f]{64}$/.test(snapshot.sha256)
    && typeof snapshot.measuredAt === 'string'
    && snapshot.measuredAt.length > 0
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function safeProjectRelativePath(projectDir: string, value: string, prefix: string): string | undefined {
  if (
    value.includes('\\')
    || value.startsWith('/')
    || value.split('/').some((part) => part === '' || part === '..' || part === '.')
  ) return undefined
  const candidate = join(projectDir, value)
  return value.startsWith(`${prefix}/`) && isInside(join(projectDir, prefix), candidate)
    ? candidate
    : undefined
}

function listTreeFiles(
  root: string,
  failed: ProblemCounts,
  symlinkCode: string,
  nonFileCode: string,
  options: { prefix?: string; recursive?: boolean } = {},
): string[] {
  const stat = lstatSync(root, { throwIfNoEntry: false })
  if (stat === undefined) return []
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    addProblem(failed, stat.isSymbolicLink() ? symlinkCode : nonFileCode)
    return []
  }
  const files: string[] = []
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    const rel = options.prefix === undefined ? name : `${options.prefix}/${name}`
    const item = lstatSync(path)
    if (item.isSymbolicLink()) addProblem(failed, symlinkCode)
    else if (item.isDirectory()) {
      if (options.recursive === false) addProblem(failed, nonFileCode)
      else {
        files.push(...listTreeFiles(path, failed, symlinkCode, nonFileCode, {
          ...options,
          prefix: rel,
        }))
      }
    } else if (item.isFile()) files.push(rel)
    else addProblem(failed, nonFileCode)
  }
  return files
}

export function checkProjectManifest(
  projectDir: string,
  expectedProjectId: string,
): ProjectManifestCheck {
  const failed: ProblemCounts = new Map()
  try {
    const path = join(projectDir, 'project.json')
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      addProblem(failed, 'PROJECT_MANIFEST_NOT_REGULAR')
      return { check: integrityResult('project_manifest', 1, failed) }
    }
    const manifest = readProjectManifestFile(path)
    if (manifest.id !== expectedProjectId) addProblem(failed, 'PROJECT_ID_MISMATCH')
    return {
      check: integrityResult('project_manifest', 1, failed),
      ...(failed.size === 0 ? { manifest } : {}),
    }
  } catch {
    addProblem(failed, 'PROJECT_MANIFEST_INVALID')
    return { check: integrityResult('project_manifest', 1, failed) }
  }
}

export function checkSourceDigests(
  db: CatDatabase,
  projectDir: string,
  onProgress?: ScanProjectIntegrityOptions['onProgress'],
): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  let rows: Array<{ id: string; original_filename: string; source_sha256: string }>
  try {
    rows = db.db.prepare(
      'SELECT id, original_filename, source_sha256 FROM assets ORDER BY id',
    ).all() as typeof rows
  } catch {
    return integrityResult(
      'source_digests',
      0,
      new Map(),
      new Map([['SOURCE_DIGEST_SCAN_UNAVAILABLE', 1]]),
    )
  }
  const expected = new Set<string>()
  rows.forEach((row, index) => {
    const name = `${row.id}${extname(row.original_filename)}`
    expected.add(name)
    const path = join(projectDir, 'source', name)
    try {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || !stat.isFile()) addProblem(failed, 'SOURCE_NOT_REGULAR')
      else if (sha256Hex(readFileSync(path)) !== row.source_sha256) {
        addProblem(failed, 'SOURCE_DIGEST_MISMATCH')
      }
    } catch {
      addProblem(failed, 'SOURCE_MISSING_OR_UNREADABLE')
    }
    onProgress?.({
      checkId: 'source_digests',
      completedItems: index + 1,
      totalItems: rows.length,
    })
  })
  const actual = listTreeFiles(
    join(projectDir, 'source'),
    failed,
    'SOURCE_SYMLINK',
    'SOURCE_NON_FILE',
  )
  addProblem(failed, 'SOURCE_ORPHAN_FILE', actual.filter((path) => !expected.has(path)).length)
  return integrityResult('source_digests', rows.length, failed)
}

export function checkBlobDigests(
  db: CatDatabase,
  projectDir: string,
  onProgress?: ScanProjectIntegrityOptions['onProgress'],
): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  const unavailable: ProblemCounts = new Map()
  let rows: Array<{ blob_relpath: string; sha256: string | null }>
  try {
    rows = db.db.prepare(
      'SELECT blob_relpath, sha256 FROM context_docs ORDER BY id',
    ).all() as typeof rows
  } catch {
    return integrityResult(
      'blob_digests',
      0,
      failed,
      new Map([['BLOB_DIGEST_SCAN_UNAVAILABLE', 1]]),
    )
  }
  const referenced = new Set<string>()
  rows.forEach((row, index) => {
    const path = safeProjectRelativePath(projectDir, row.blob_relpath, 'blobs')
    if (path === undefined) {
      addProblem(failed, 'BLOB_PATH_INVALID')
    } else {
      referenced.add(row.blob_relpath.slice('blobs/'.length))
      try {
        const stat = lstatSync(path)
        if (stat.isSymbolicLink() || !stat.isFile()) addProblem(failed, 'BLOB_NOT_REGULAR')
        else if (row.sha256 === null) addProblem(unavailable, 'BLOB_DIGEST_UNAVAILABLE')
        else if (sha256Hex(readFileSync(path)) !== row.sha256) {
          addProblem(failed, 'BLOB_DIGEST_MISMATCH')
        }
      } catch {
        addProblem(failed, 'BLOB_MISSING_OR_UNREADABLE')
      }
    }
    onProgress?.({
      checkId: 'blob_digests',
      completedItems: index + 1,
      totalItems: rows.length,
    })
  })
  const actual = listTreeFiles(
    join(projectDir, 'blobs'),
    failed,
    'BLOB_SYMLINK',
    'BLOB_NON_FILE',
  )
  const unreferenced = actual.filter((path) => !referenced.has(path)).length
  addProblem(unavailable, 'BLOB_DIGEST_UNAVAILABLE', unreferenced)
  return integrityResult('blob_digests', rows.length + unreferenced, failed, unavailable)
}

function isExportManifest(
  value: unknown,
): value is {
  schemaVersion: 1
  artifactId: string
  assetId: string
  sha256: string
  sizeBytes: number
  createdAt: string
  verifiedAt: string
  projectRevision: string
} {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return item.schemaVersion === 1
    && typeof item.artifactId === 'string'
    && /^exp-[0-9a-f]{16}$/.test(item.artifactId)
    && typeof item.assetId === 'string'
    && /^ast-[0-9a-f]{16}$/.test(item.assetId)
    && typeof item.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(item.sha256)
    && typeof item.sizeBytes === 'number'
    && Number.isSafeInteger(item.sizeBytes)
    && item.sizeBytes >= 0
    && typeof item.createdAt === 'string'
    && typeof item.verifiedAt === 'string'
    && typeof item.projectRevision === 'string'
    && /^rev-[0-9a-f]{64}$/.test(item.projectRevision)
}

export function checkExportManifests(
  db: CatDatabase,
  projectDir: string,
  projectId: string,
): ProjectIntegrityCheck {
  const failed: ProblemCounts = new Map()
  let rows: Array<{
    id: string
    project_id: string
    asset_id: string
    path: string
    sha256: string
    created_at: string
  }>
  try {
    rows = db.db.prepare(`
      SELECT id, project_id, asset_id, path, sha256, created_at
      FROM exports ORDER BY id
    `).all() as typeof rows
  } catch {
    return integrityResult(
      'export_manifests',
      0,
      new Map(),
      new Map([['EXPORT_MANIFEST_SCAN_UNAVAILABLE', 1]]),
    )
  }
  const manifestDir = join(projectDir, 'exports', '.export-manifests')
  const expectedNames = new Set<string>()
  for (const row of rows) {
    expectedNames.add(`${row.id}.json`)
    const artifactPath = safeProjectRelativePath(projectDir, row.path, 'exports')
    let artifactSize: number | undefined
    if (row.project_id !== projectId) addProblem(failed, 'EXPORT_PROJECT_ID_MISMATCH')
    if (artifactPath === undefined) {
      addProblem(failed, 'EXPORT_PATH_INVALID')
    } else {
      try {
        const stat = lstatSync(artifactPath)
        if (stat.isSymbolicLink() || !stat.isFile()) {
          addProblem(failed, 'EXPORT_ARTIFACT_NOT_REGULAR')
        } else {
          artifactSize = stat.size
          if (sha256Hex(readFileSync(artifactPath)) !== row.sha256) {
            addProblem(failed, 'EXPORT_ARTIFACT_DIGEST_MISMATCH')
          }
        }
      } catch {
        addProblem(failed, 'EXPORT_ARTIFACT_MISSING_OR_UNREADABLE')
      }
    }
    try {
      const manifestPath = join(manifestDir, `${row.id}.json`)
      const stat = lstatSync(manifestPath)
      if (stat.isSymbolicLink() || !stat.isFile()) {
        addProblem(failed, 'EXPORT_MANIFEST_NOT_REGULAR')
        continue
      }
      const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!isExportManifest(manifest)) {
        addProblem(failed, 'EXPORT_MANIFEST_INVALID')
      } else if (
        manifest.artifactId !== row.id
        || manifest.assetId !== row.asset_id
        || manifest.sha256 !== row.sha256
        || manifest.createdAt !== row.created_at
      ) {
        addProblem(failed, 'EXPORT_MANIFEST_REFERENCE_MISMATCH')
      } else if (artifactSize !== undefined && artifactSize !== manifest.sizeBytes) {
        addProblem(failed, 'EXPORT_MANIFEST_SIZE_MISMATCH')
      }
    } catch {
      addProblem(failed, 'EXPORT_MANIFEST_MISSING_OR_UNREADABLE')
    }
  }
  const actual = listTreeFiles(
    manifestDir,
    failed,
    'EXPORT_MANIFEST_NOT_REGULAR',
    'EXPORT_MANIFEST_NOT_REGULAR',
    { recursive: false },
  )
  addProblem(
    failed,
    'EXPORT_MANIFEST_ORPHAN',
    actual.filter((name) => !expectedNames.has(name)).length,
  )
  return integrityResult('export_manifests', rows.length, failed)
}
