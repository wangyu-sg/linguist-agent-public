/**
 * Context Docs 刷新采用 latest-request-wins，防止首次加载的慢响应覆盖导入/
 * 删除后的新列表。组件每次发请求先取 revision，提交状态前再核对。
 */
export interface ContextDocsRefreshGate {
  begin(): number
  isLatest(revision: number): boolean
}

export function createContextDocsRefreshGate(): ContextDocsRefreshGate {
  let latestRevision = 0
  return {
    begin(): number {
      latestRevision += 1
      return latestRevision
    },
    isLatest(revision: number): boolean {
      return revision === latestRevision
    },
  }
}
