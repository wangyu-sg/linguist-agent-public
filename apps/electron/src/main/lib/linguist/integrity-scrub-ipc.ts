import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type {
  LinguistIntegrityCancelResult,
  LinguistIntegrityExportReportResult,
  LinguistIntegrityScrubReport,
  LinguistIntegrityStartResult,
  LinguistIpcResult,
} from '@proma/shared'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import type { IntegrityScrubService } from './integrity-scrub-service'
import type { LinguistProjectService } from './project-service'
import { SecureExportError, writeBytesVerified } from './secure-export'

export interface IntegrityReportSavePickerOptions {
  title: string
  defaultPath: string
}

export type IntegrityReportSavePicker = (
  options: IntegrityReportSavePickerOptions,
) => Promise<{ canceled: boolean; filePath?: string }>

interface IntegrityScrubIpcDeps {
  getProjectService: () => LinguistProjectService
  scrub: Pick<IntegrityScrubService, 'start' | 'cancel' | 'getReport'>
}

function readJobId(record: Record<string, unknown>): string {
  const value = record.jobId
  if (typeof value !== 'string' || !/^scrub-[0-9a-f-]{36}$/.test(value)) {
    invalid('jobId 不是有效的完整性扫描任务 ID')
  }
  return value
}

/** 保存格式刻意去掉原始 projectId/jobId，只保留不可逆关联指纹。 */
export function buildRedactedIntegrityReport(report: LinguistIntegrityScrubReport) {
  return {
    schemaVersion: 1,
    kind: 'full_integrity_scrub',
    generatedAt: report.completedAt,
    outcome: report.outcome,
    executor: report.executor,
    correlation: {
      projectFingerprint: createHash('sha256').update(report.projectId).digest('hex'),
    },
    checks: report.checks,
    privacy: {
      redacted: true,
      autoUpload: false,
      contains: {
        projectId: false,
        jobId: false,
        filenames: false,
        customerText: false,
        absolutePaths: false,
        secrets: false,
        hiddenReasoning: false,
      },
    },
  } as const
}

export function createIntegrityScrubIpc(deps: IntegrityScrubIpcDeps) {
  return {
    start(input: unknown): Promise<LinguistIpcResult<LinguistIntegrityStartResult>> {
      return wrap(() => deps.scrub.start(readProjectId(assertRecord(input))))
    },

    cancel(input: unknown): Promise<LinguistIpcResult<LinguistIntegrityCancelResult>> {
      return wrap(() => {
        const record = assertRecord(input)
        return deps.scrub.cancel(readProjectId(record), readJobId(record))
      })
    },

    exportReport(
      input: unknown,
      pickDestination: IntegrityReportSavePicker,
    ): Promise<LinguistIpcResult<LinguistIntegrityExportReportResult>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const report = deps.scrub.getReport(projectId, readJobId(record))
        if (report === undefined) invalid('没有可导出的已完成完整性报告')
        const redacted = buildRedactedIntegrityReport(report)
        const picked = await pickDestination({
          title: '保存脱敏完整性报告',
          defaultPath: `linguist-integrity-${report.completedAt.replace(/[:.]/g, '-')}.json`,
        })
        if (picked.canceled || picked.filePath === undefined) return { cancelled: true }
        const bytes = new TextEncoder().encode(`${JSON.stringify(redacted, null, 2)}\n`)
        try {
          const verified = writeBytesVerified({
            managedRoot: deps.getProjectService().rootDir,
            destinationPath: picked.filePath,
            bytes,
          })
          return {
            cancelled: false,
            filename: basename(picked.filePath),
            ...verified,
          }
        } catch (error) {
          if (error instanceof SecureExportError) invalid(error.message)
          throw error
        }
      })
    },
  }
}
