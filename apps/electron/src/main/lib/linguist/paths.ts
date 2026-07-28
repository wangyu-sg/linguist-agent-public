/**
 * Linguist 路径解析（PB-030，纯函数，无 fs / electron 依赖——bun 下可测）。
 *
 * CAT 数据根目录为 <configDir>/linguist（USERDATA_LAYOUT.md §3，计划 §5.2）；
 * configDir 由调用方经 getConfigDir() 解析传入，本模块绝不硬编码 ~/.linguist-agent。
 */

import { isAbsolute, join, relative } from 'node:path'

/** 由 Proma 配置根解析 CAT 数据根：<configDir>/linguist。 */
export function resolveLinguistRootDir(configDir: string): string {
  return join(configDir, 'linguist')
}

/** 单个项目的磁盘布局（计划 §5.2，与 cat-store 的 ProjectIndex 一致）。 */
export interface LinguistProjectPaths {
  projectDir: string
  projectJsonPath: string
  catDbPath: string
  sourceDir: string
  blobsDir: string
  exportsDir: string
  backupsDir: string
}

export function projectPaths(linguistRootDir: string, projectId: string): LinguistProjectPaths {
  const projectDir = join(linguistRootDir, 'projects', projectId)
  return {
    projectDir,
    projectJsonPath: join(projectDir, 'project.json'),
    catDbPath: join(projectDir, 'cat.db'),
    sourceDir: join(projectDir, 'source'),
    blobsDir: join(projectDir, 'blobs'),
    exportsDir: join(projectDir, 'exports'),
    backupsDir: join(projectDir, 'backups'),
  }
}

/**
 * 将 linguist 根内的绝对路径转为根相对路径（返回给调用方/写日志用，
 * 避免泄露用户主目录等机器私有信息）。路径不在根内属于内部 bug，抛错。
 */
export function toRootRelativePath(linguistRootDir: string, absolutePath: string): string {
  const rel = relative(linguistRootDir, absolutePath)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path is outside the linguist root: ${absolutePath}`)
  }
  return rel
}
