import { createHash } from 'node:crypto'
import { accessSync, constants, createReadStream, copyFileSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface DelegationInput {
  path: string
  required?: boolean
  expectedSha256?: string
  /** 冻结本次文件版本；即使子会话已有读取权限也复制到其私有工作台。 */
  snapshot?: boolean
}

export interface DelegationInputReceipt {
  requestedPath: string
  state: 'referenced' | 'snapshotted' | 'missing' | 'blocked-input'
  usablePath?: string
  sha256?: string
  reason?: string
}

export interface PreparedDelegationInput {
  receipt: DelegationInputReceipt
  sourcePath?: string
  snapshot?: boolean
}

function withinAuthorizedPath(candidate: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    try {
      const canonicalRoot = realpathSync.native(root)
      const rel = relative(canonicalRoot, candidate)
      if (rel === '') return true
      if (statSync(canonicalRoot).isFile()) return false
      return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    } catch {
      return false
    }
  })
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/** 所有路径先按父实际 cwd 和授权根预检；不创建子会话或写文件。 */
export async function preflightDelegationInputs(
  inputs: readonly DelegationInput[],
  context: { parentCwd: string | undefined; parentRoots: readonly string[]; childReadablePaths: readonly string[] },
): Promise<{ ready: boolean; items: PreparedDelegationInput[] }> {
  const items: PreparedDelegationInput[] = []
  for (const input of inputs) {
    const requestedPath = input.path
    const blocked = (reason: string): PreparedDelegationInput => ({
      receipt: { requestedPath, state: 'blocked-input', reason },
    })
    if (!requestedPath || !context.parentCwd) {
      items.push(blocked('缺少有效文件路径或父会话工作目录'))
      continue
    }
    if (input.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(input.expectedSha256)) {
      items.push(blocked('expectedSha256 必须是 64 位十六进制 SHA-256'))
      continue
    }
    const absolutePath = resolve(context.parentCwd, requestedPath)
    let sourcePath: string
    try {
      sourcePath = realpathSync.native(absolutePath)
      if (!statSync(sourcePath).isFile()) {
        items.push(blocked('路径不是普通文件'))
        continue
      }
      accessSync(sourcePath, constants.R_OK)
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      items.push(missing && input.required === false
        ? { receipt: { requestedPath, state: 'missing', reason: '文件不存在或不可读取' } }
        : blocked(missing ? '文件不存在' : '文件不可读取'))
      continue
    }
    if (!withinAuthorizedPath(sourcePath, context.parentRoots)) {
      items.push(blocked('文件不在父会话已授权读取范围内'))
      continue
    }
    const snapshot = input.snapshot === true
      || input.expectedSha256 !== undefined
      || !withinAuthorizedPath(sourcePath, context.childReadablePaths)
    let sha256: string | undefined
    if (snapshot) {
      try {
        sha256 = await sha256File(sourcePath)
      } catch {
        items.push(blocked('文件无法读取'))
        continue
      }
      if (input.expectedSha256 !== undefined && sha256 !== input.expectedSha256.toLowerCase()) {
        items.push(blocked('文件 SHA-256 与预期不符'))
        continue
      }
    }
    items.push({
      receipt: {
        requestedPath,
        state: snapshot ? 'snapshotted' : 'referenced',
        ...(!snapshot ? { usablePath: sourcePath } : {}),
        ...(sha256 !== undefined ? { sha256 } : {}),
      },
      sourcePath,
      snapshot,
    })
  }
  return {
    ready: items.every(item => item.receipt.state !== 'blocked-input'),
    items,
  }
}

/** 仅复制预检时列出的文件；复制后的哈希不一致则拒绝启动子任务。 */
export async function deliverDelegationInputs(
  items: readonly PreparedDelegationInput[],
  childSessionDir: string,
): Promise<DelegationInputReceipt[]> {
  const receipts: DelegationInputReceipt[] = []
  for (const [index, item] of items.entries()) {
    if (!item.snapshot || !item.sourcePath) {
      receipts.push(item.receipt)
      continue
    }
    const inputDir = join(childSessionDir, 'delegation-inputs')
    mkdirSync(inputDir, { recursive: true })
    const targetPath = join(inputDir, `${index + 1}-${basename(item.sourcePath)}`)
    copyFileSync(item.sourcePath, targetPath, constants.COPYFILE_EXCL)
    if (await sha256File(targetPath) !== item.receipt.sha256) {
      throw new Error(`输入文件在交付期间发生变化：${item.receipt.requestedPath}`)
    }
    receipts.push({ ...item.receipt, usablePath: targetPath })
  }
  return receipts
}
