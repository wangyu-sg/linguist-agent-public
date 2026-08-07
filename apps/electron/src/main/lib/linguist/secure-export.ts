import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'

const BUFFER_SIZE = 64 * 1024
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0

export class SecureExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecureExportError'
  }
}

export interface VerifiedExportWrite {
  sha256: string
  sizeBytes: number
  verifiedAt: string
}

interface FileIdentity {
  dev: number
  ino: number
}

interface DirectoryIdentity extends FileIdentity {
  realPath: string
}

function fail(message: string): never {
  throw new SecureExportError(message)
}

function identityOf(stat: Stats): FileIdentity {
  return { dev: stat.dev, ino: stat.ino }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function isInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === ''
    || (
      pathFromRoot !== '..'
      && !pathFromRoot.startsWith(`..${sep}`)
      && !isAbsolute(pathFromRoot)
    )
}

function isTrustedMacSystemAlias(path: string, resolvedPath: string): boolean {
  if (process.platform !== 'darwin') return false
  return (
    (path === '/var' && resolvedPath === '/private/var')
    || (path === '/tmp' && resolvedPath === '/private/tmp')
    || (path === '/etc' && resolvedPath === '/private/etc')
  )
}

/**
 * 逐级检查目标 parent。macOS 的 /var、/tmp、/etc 是系统固定别名；除此之外
 * 任何 ancestor symlink 都拒绝，避免文件选择后被目录别名重定向。
 */
function inspectParent(destination: string): DirectoryIdentity {
  const parent = dirname(destination)
  const root = parse(parent).root
  let current = root
  const parts = relative(root, parent).split(sep).filter(Boolean)
  for (const part of parts) {
    current = join(current, part)
    let stat: Stats
    try {
      stat = lstatSync(current)
    } catch {
      fail('导出目标目录不可用，请选择已有目录')
    }
    if (stat.isSymbolicLink()) {
      let resolvedAlias = ''
      try {
        resolvedAlias = realpathSync.native(current)
      } catch {
        fail('导出目标目录包含不可用的符号链接')
      }
      if (!isTrustedMacSystemAlias(current, resolvedAlias)) {
        fail('导出目标目录包含符号链接，请选择真实目录')
      }
      continue
    }
    if (!stat.isDirectory()) fail('导出目标 parent 不是目录')
  }

  const stat = lstatSync(parent)
  if (stat.isSymbolicLink()) fail('导出目标目录包含符号链接，请选择真实目录')
  if (!stat.isDirectory()) fail('导出目标 parent 不是目录')
  return {
    ...identityOf(stat),
    realPath: realpathSync.native(parent),
  }
}

function validateDestination(
  managedRoot: string,
  filePath: string,
  overwrite: boolean,
): { destination: string; parent: DirectoryIdentity; existingIdentity?: FileIdentity } {
  if (filePath.trim() === '' || !isAbsolute(filePath)) {
    fail('导出目标必须是绝对文件路径')
  }
  const destination = resolve(filePath)
  const parent = inspectParent(destination)
  const canonicalDestination = join(parent.realPath, basename(destination))
  if (isInside(realpathSync.native(resolve(managedRoot)), canonicalDestination)) {
    fail('不能导出到 Linguist Agent 受管数据目录')
  }
  const existing = lstatSync(destination, { throwIfNoEntry: false })
  if (existing !== undefined) {
    if (!overwrite) fail('导出目标已存在，请选择新的文件名或明确允许覆盖')
    if (existing.isSymbolicLink() || !existing.isFile()) fail('只能覆盖已有的普通文件')
  }
  return {
    destination,
    parent,
    ...(existing === undefined ? {} : { existingIdentity: identityOf(existing) }),
  }
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0
  while (offset < bytes.byteLength) {
    offset += writeSync(fd, bytes, offset, bytes.byteLength - offset)
  }
}

function hashFd(fd: number): VerifiedExportWrite {
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(BUFFER_SIZE)
  let sizeBytes = 0
  for (;;) {
    const count = readSync(fd, buffer, 0, buffer.byteLength, sizeBytes)
    if (count === 0) break
    hash.update(buffer.subarray(0, count))
    sizeBytes += count
  }
  return {
    sha256: hash.digest('hex'),
    sizeBytes,
    verifiedAt: new Date().toISOString(),
  }
}

function safelyRemoveCreatedFile(path: string, identity: FileIdentity | undefined): void {
  if (identity === undefined) return
  try {
    const current = lstatSync(path, { throwIfNoEntry: false })
    if (
      current !== undefined
      && !current.isSymbolicLink()
      && current.isFile()
      && sameIdentity(identity, identityOf(current))
    ) {
      unlinkSync(path)
    }
  } catch {
    // 路径已被并发替换时不删除未知对象。
  }
}

function writeVerifiedDestination(
  managedRoot: string,
  filePath: string,
  write: (fd: number) => void,
  expectedSha256: string,
  overwrite = false,
): VerifiedExportWrite {
  const { destination, parent, existingIdentity } = validateDestination(managedRoot, filePath, overwrite)
  if (existingIdentity !== undefined) {
    const temporaryPath = join(parent.realPath, `.${basename(destination)}.${randomUUID()}.tmp`)
    const verified = writeVerifiedDestination(
      managedRoot,
      temporaryPath,
      write,
      expectedSha256,
    )
    const temporaryStat = lstatSync(temporaryPath)
    const temporaryIdentity = identityOf(temporaryStat)
    try {
      const current = lstatSync(destination, { throwIfNoEntry: false })
      const currentParent = inspectParent(destination)
      if (
        current === undefined
        || current.isSymbolicLink()
        || !current.isFile()
        || !sameIdentity(existingIdentity, identityOf(current))
        || currentParent.realPath !== parent.realPath
        || !sameIdentity(currentParent, parent)
      ) {
        fail('导出目标在覆盖前发生变化')
      }
      renameSync(temporaryPath, destination)
      const replaced = lstatSync(destination, { throwIfNoEntry: false })
      if (
        replaced === undefined
        || replaced.isSymbolicLink()
        || !replaced.isFile()
        || !sameIdentity(temporaryIdentity, identityOf(replaced))
      ) {
        fail('覆盖后的导出文件身份校验失败')
      }
      return verified
    } catch (error) {
      safelyRemoveCreatedFile(temporaryPath, temporaryIdentity)
      throw error
    }
  }
  const beforeOpen = inspectParent(destination)
  if (
    beforeOpen.realPath !== parent.realPath
    || !sameIdentity(beforeOpen, parent)
  ) {
    fail('导出目标目录在写入前发生变化')
  }

  let fd: number | undefined
  let createdIdentity: FileIdentity | undefined
  try {
    fd = openSync(
      destination,
      constants.O_CREAT
        | constants.O_EXCL
        | constants.O_RDWR
        | NO_FOLLOW,
      0o600,
    )
    createdIdentity = identityOf(fstatSync(fd))
    write(fd)
    fsyncSync(fd)

    const verified = hashFd(fd)
    if (verified.sha256 !== expectedSha256) {
      fail('导出目标摘要校验失败')
    }
    const destinationStat = fstatSync(fd)
    if (destinationStat.size !== verified.sizeBytes) {
      fail('导出目标大小校验失败')
    }

    const afterWrite = inspectParent(destination)
    if (
      afterWrite.realPath !== parent.realPath
      || !sameIdentity(afterWrite, parent)
    ) {
      fail('导出目标目录在写入期间发生变化')
    }
    const pathStat = lstatSync(destination, { throwIfNoEntry: false })
    if (
      pathStat === undefined
      || pathStat.isSymbolicLink()
      || !pathStat.isFile()
      || !sameIdentity(createdIdentity, identityOf(pathStat))
      || realpathSync.native(destination) !== join(afterWrite.realPath, basename(destination))
    ) {
      fail('导出目标文件身份校验失败')
    }
    return verified
  } catch (error) {
    if (fd !== undefined && createdIdentity === undefined) {
      try {
        createdIdentity = identityOf(fstatSync(fd))
      } catch {
        // open 后即失败时可能拿不到身份；不删除未知路径。
      }
    }
    if (fd !== undefined) {
      closeSync(fd)
      fd = undefined
    }
    safelyRemoveCreatedFile(destination, createdIdentity)
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'EEXIST'
    ) {
      fail('导出目标已存在，请选择新的文件名')
    }
    throw error
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function copyFileVerified(input: {
  managedRoot: string
  sourcePath: string
  destinationPath: string
  expectedSha256: string
  overwrite?: boolean
}): VerifiedExportWrite {
  const sourcePath = resolve(input.sourcePath)
  const initial = lstatSync(sourcePath, { throwIfNoEntry: false })
  if (initial === undefined || initial.isSymbolicLink() || !initial.isFile()) {
    fail('导出源文件不可用或是符号链接')
  }
  const initialIdentity = identityOf(initial)
  const initialRealPath = realpathSync.native(sourcePath)
  let sourceFd: number | undefined
  try {
    sourceFd = openSync(sourcePath, constants.O_RDONLY | NO_FOLLOW)
    const opened = fstatSync(sourceFd)
    if (!opened.isFile() || !sameIdentity(initialIdentity, identityOf(opened))) {
      fail('导出源文件在打开前发生变化')
    }
    const source = sourceFd
    return writeVerifiedDestination(
      input.managedRoot,
      input.destinationPath,
      (destinationFd) => {
        const buffer = Buffer.allocUnsafe(BUFFER_SIZE)
        let position = 0
        for (;;) {
          const count = readSync(source, buffer, 0, buffer.byteLength, position)
          if (count === 0) break
          writeAll(destinationFd, buffer.subarray(0, count))
          position += count
        }
        const afterFd = fstatSync(source)
        const afterPath = lstatSync(sourcePath, { throwIfNoEntry: false })
        if (
          afterPath === undefined
          || afterPath.isSymbolicLink()
          || !afterPath.isFile()
          || !sameIdentity(initialIdentity, identityOf(afterPath))
          || !sameIdentity(initialIdentity, identityOf(afterFd))
          || afterFd.size !== initial.size
          || afterFd.mtimeMs !== initial.mtimeMs
          || realpathSync.native(sourcePath) !== initialRealPath
        ) {
          fail('导出源文件在复制期间发生变化')
        }
      },
      input.expectedSha256,
      input.overwrite ?? false,
    )
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'ELOOP'
    ) {
      fail('导出源文件不可用或是符号链接')
    }
    throw error
  } finally {
    if (sourceFd !== undefined) closeSync(sourceFd)
  }
}

export function writeBytesVerified(input: {
  managedRoot: string
  destinationPath: string
  bytes: Uint8Array
}): VerifiedExportWrite {
  const expectedSha256 = createHash('sha256').update(input.bytes).digest('hex')
  return writeVerifiedDestination(
    input.managedRoot,
    input.destinationPath,
    (fd) => writeAll(fd, input.bytes),
    expectedSha256,
  )
}
