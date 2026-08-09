import type { LinguistProject } from '@linguist/cat-core'
import type { CatFormatRegistry } from '@linguist/cat-formats'
import type { ProjectDatabase } from '@linguist/cat-store'
import type { LinguistProjectPaths } from './paths'

/**
 * 项目子模块所需的最小宿主能力。
 *
 * 子模块不拥有句柄、项目索引或错误映射；这些生命周期职责仍由
 * LinguistProjectService 统一管理，避免拆分后出现第二套状态。
 */
export interface ProjectModuleContext {
  rootDir: string
  registry: CatFormatRegistry
  now: () => string
  getProject: (projectId: string) => LinguistProject
  getProjectPaths: (projectId: string) => LinguistProjectPaths
  openProject: (
    projectId: string,
    options?: { readOnly?: boolean },
  ) => ProjectDatabase
  assertProjectWritable: (projectId: string) => void
  call: <T>(fn: () => T, projectId?: string) => T
}
