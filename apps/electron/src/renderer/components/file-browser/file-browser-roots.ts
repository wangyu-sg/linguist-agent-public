export type FileScope = 'project' | 'session'

/** 每个附加根独立保存，增删/重排其他根不会改变 key；兼容按会话清理的前缀。 */
export function getAttachedDirectoryStateKey(sessionId: string, scope: FileScope, rootPath: string): string {
  return `${sessionId}\u0002attached\u0002${scope}\u0000${rootPath}`
}

export interface FileBrowserRoot {
  path: string
  scope: FileScope
}
