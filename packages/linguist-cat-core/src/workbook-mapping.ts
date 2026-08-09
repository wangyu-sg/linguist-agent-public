export type WorkbookMappingColumnRole =
  | 'key'
  | 'source'
  | 'target'
  | 'context'
  | 'speaker'
  | 'status'

export interface WorkbookMappingColumns {
  key?: string
  source: string
  target: string
  context?: string
  speaker?: string
  status?: string
}

export interface LinguistWorkbookMappingProfile {
  id: string
  name?: string
  workbookFingerprint: string
  filenamePattern: string
  sheetName: string
  headerSignature: string
  columns: WorkbookMappingColumns
  createdAt: string
  updatedAt: string
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** project.json 信任边界：非法 profile 整条丢弃，不猜测或修复列映射。 */
export function normalizeWorkbookMappingProfiles(
  value: unknown,
): LinguistWorkbookMappingProfile[] {
  if (!Array.isArray(value)) return []
  return value.filter((profile): profile is LinguistWorkbookMappingProfile => {
    if (typeof profile !== 'object' || profile === null) return false
    const item = profile as Partial<LinguistWorkbookMappingProfile>
    const columns = item.columns as Partial<WorkbookMappingColumns> | undefined
    const optionalColumn = (role: 'key' | 'context' | 'speaker' | 'status'): boolean =>
      columns?.[role] === undefined
      || (typeof columns[role] === 'string' && columns[role]!.trim() !== '')
    return typeof item.id === 'string'
      && item.id.trim() !== ''
      && (item.name === undefined || (typeof item.name === 'string' && item.name.trim() !== ''))
      && typeof item.workbookFingerprint === 'string'
      && SHA256_PATTERN.test(item.workbookFingerprint)
      && typeof item.filenamePattern === 'string'
      && item.filenamePattern.trim() !== ''
      && typeof item.sheetName === 'string'
      && item.sheetName.trim() !== ''
      && typeof item.headerSignature === 'string'
      && SHA256_PATTERN.test(item.headerSignature)
      && typeof columns?.source === 'string'
      && columns.source.trim() !== ''
      && typeof columns.target === 'string'
      && columns.target.trim() !== ''
      && optionalColumn('key')
      && optionalColumn('context')
      && optionalColumn('speaker')
      && optionalColumn('status')
      && typeof item.createdAt === 'string'
      && typeof item.updatedAt === 'string'
  })
}
