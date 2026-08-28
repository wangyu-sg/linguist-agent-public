import { extname } from 'node:path'
import { sha256Hex, type EvidenceGap } from '@linguist/cat-core'
import type { ProjectInventoryGapInput } from '@linguist/cat-store'
import type {
  LinguistImportResourceItem,
  LinguistImportResourcesResult,
  LinguistProjectEvidenceInventoryResult,
} from '@linguist/cat-tools'
import type { LinguistProjectService } from './project-service'
import { importProjectResources } from './project-file-intake'
import type {
  ProjectDiscoveryScope,
  UnavailableProjectDiscoveryLocation,
} from './project-discovery-scope'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])
const encoder = new TextEncoder()

interface BuildProjectEvidenceInventoryInput {
  discoveryScopeHash: string
  managedEvidenceCount: number
  unavailable: readonly UnavailableProjectDiscoveryLocation[]
  scan: LinguistImportResourcesResult
}

interface ProjectEvidenceInventoryDraft {
  summary: Omit<LinguistProjectEvidenceInventoryResult, 'gaps'>
  gaps: ProjectInventoryGapInput[]
}

function gap(
  code: ProjectInventoryGapInput['code'],
  severity: ProjectInventoryGapInput['severity'],
  summary: string,
  suggestedAction: string,
): ProjectInventoryGapInput {
  return {
    id: `inv_gap_${sha256Hex(encoder.encode(`${code}\u0000${summary}`)).slice(0, 24)}`,
    code,
    severity,
    summary,
    suggestedAction,
  }
}

function versionCandidateFilenames(items: readonly LinguistImportResourceItem[]): string[] {
  const candidates = new Map<string, { filename: string; versions: Set<string> }>()
  for (const item of items) {
    if (item.sourceSha256 === undefined) continue
    const key = item.filename.normalize('NFKC').toLocaleLowerCase('en-US')
    const current = candidates.get(key) ?? { filename: item.filename, versions: new Set<string>() }
    current.versions.add(item.sourceSha256)
    candidates.set(key, current)
  }
  return [...candidates.values()]
    .filter((item) => item.versions.size > 1)
    .map((item) => item.filename)
    .sort((left, right) => left.localeCompare(right))
}

function statusFor(gaps: readonly Pick<ProjectInventoryGapInput, 'severity'>[]): 'ready' | 'needs-input' | 'blocked' {
  if (gaps.some((item) => item.severity === 'blocking')) return 'blocked'
  return gaps.length === 0 ? 'ready' : 'needs-input'
}

export function buildProjectEvidenceInventory(
  input: BuildProjectEvidenceInventoryInput,
): ProjectEvidenceInventoryDraft {
  const gaps: ProjectInventoryGapInput[] = []
  for (const location of input.unavailable) {
    gaps.push(gap(
      'REQUIRED_RESOURCE_MISSING',
      'blocking',
      `${location.name} 所在授权位置不可用（${location.reason}）`,
      '重新附加该文件或目录，或由用户确认不再需要',
    ))
  }
  for (const item of input.scan.items) {
    if (item.status === 'failed') {
      gaps.push(gap('RESOURCE_IMPORT_FAILED', 'blocking', `${item.filename} 无法读取或解析`, '修复文件后刷新项目资产盘点'))
    } else if (item.status === 'needs-input') {
      gaps.push(gap('RESOURCE_MAPPING_AMBIGUOUS', 'blocking', `${item.filename} 需要明确用途或映射`, item.message ?? '确认资源类型与映射'))
    } else if (item.status === 'unsupported') {
      gaps.push(gap('UNMAPPED_CLIENT_VISIBLE_CONTENT', 'warning', `${item.filename} 尚未识别`, '确认文件用途、补充适配器或显式排除'))
    }
  }
  if (input.scan.truncated) {
    gaps.push(gap('REQUIRED_RESOURCE_MISSING', 'blocking', '授权范围超过单次 500 文件扫描上限', '缩小或拆分授权目录后重新刷新'))
  }
  const duplicates = versionCandidateFilenames(input.scan.items)
  for (const filename of duplicates) {
    gaps.push(gap('VERSION_CONFLICT', 'blocking', `${filename} 存在多个同名版本候选`, '由用户确认当前有效版本'))
  }
  if (input.scan.found === 0 && input.managedEvidenceCount === 0 && input.unavailable.length === 0) {
    gaps.push(gap('REQUIRED_RESOURCE_MISSING', 'blocking', '项目尚无受管资产或可扫描的授权文件', '导入主批次或附加项目资料'))
  }

  return {
    summary: {
      status: statusFor(gaps),
      discoveryScopeHash: input.discoveryScopeHash,
      discovered: input.scan.found + input.unavailable.length,
      registered: input.managedEvidenceCount,
      readyToImport: input.scan.ready + input.scan.imported + input.scan.skippedDuplicate,
      unmapped: input.scan.needsInput,
      media: input.scan.items.filter((item) => IMAGE_EXTENSIONS.has(extname(item.filename).toLowerCase())).length,
      versionConflicts: duplicates.length,
      unsupported: input.scan.unsupported,
      failed: input.scan.failed + input.unavailable.length,
      truncated: input.scan.truncated,
      items: input.scan.items,
    },
    gaps,
  }
}

const EMPTY_SCAN: LinguistImportResourcesResult = {
  found: 0,
  ready: 0,
  imported: 0,
  skippedDuplicate: 0,
  needsInput: 0,
  unsupported: 0,
  failed: 0,
  truncated: false,
  items: [],
}

/** 复用现有 dry-run 分类，并只持久化项目级 Gap；模型不参与路径选择。 */
export async function refreshProjectEvidenceInventory(
  service: LinguistProjectService,
  projectId: string,
  scope: ProjectDiscoveryScope,
): Promise<LinguistProjectEvidenceInventoryResult> {
  const paths = [...scope.roots, ...scope.files].map((location) => location.path)
  const scan = paths.length === 0
    ? EMPTY_SCAN
    : await importProjectResources(service, projectId, service.rootDir, {
        paths,
        recursive: true,
        kind: 'auto',
        dryRun: true,
      })
  const draft = buildProjectEvidenceInventory({
    discoveryScopeHash: scope.hash,
    managedEvidenceCount: scope.managedEvidence.length,
    unavailable: scope.unavailable,
    scan,
  })
  const persisted = service.openProject(projectId).stageEvidence
    .replaceProjectInventoryGaps(draft.gaps)
  const openGaps = persisted.filter((item): item is EvidenceGap => item.status === 'open')
  return {
    ...draft.summary,
    status: statusFor(openGaps),
    gaps: openGaps,
  }
}
