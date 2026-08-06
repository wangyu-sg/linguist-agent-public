/**
 * PB-073 导出交付边界：renderer 只提交 project/asset id；主进程完成
 * staging、原生 Save 选择与复制，响应不暴露任何文件系统路径。
 */

import { basename } from 'node:path'
import {
  LINGUIST_ASSET_ID_PATTERN,
  type LinguistExportListResult,
  type LinguistExportSaveAssetResult,
  type LinguistIpcResult,
  type LinguistPrepareDeliveryResult,
} from '@proma/shared'
import { assertRecord, invalid, readProjectId, wrap } from './ipc-envelope'
import {
  LinguistDeliveryNotReadyError,
  LinguistExportBlockedByQaError,
} from './errors'
import { readLinguistExportManifests } from './export-manifest'
import type {
  LinguistPreparedDelivery,
  LinguistProjectService,
} from './project-service'
import { copyFileVerified, SecureExportError } from './secure-export'

export interface LinguistExportSavePickerOptions {
  title: string
  defaultPath: string
}

export interface LinguistExportSavePickerResult {
  canceled: boolean
  filePath?: string
}

export type LinguistExportSavePicker = (
  options: LinguistExportSavePickerOptions,
) => Promise<LinguistExportSavePickerResult>

function readAssetId(record: Record<string, unknown>): string {
  const assetId = record.assetId
  if (typeof assetId !== 'string' || !LINGUIST_ASSET_ID_PATTERN.test(assetId)) {
    invalid('assetId must be a valid Stable ID')
  }
  return assetId
}

function publicPreparation(
  prepared: LinguistPreparedDelivery,
): LinguistPrepareDeliveryResult {
  return {
    preflight: prepared.preflight,
    ...(prepared.verification !== undefined
      ? { verification: prepared.verification }
      : {}),
    reportMarkdown: prepared.reportMarkdown,
  }
}

export function createLinguistExportIpc(deps: {
  getService: () => LinguistProjectService
}) {
  return {
    prepareAsset(input: unknown): Promise<LinguistIpcResult<LinguistPrepareDeliveryResult>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const assetId = readAssetId(record)
        return publicPreparation(
          await deps.getService().prepareDelivery(projectId, assetId),
        )
      })
    },

    /**
     * PB-102：只读列出项目 exports/ 目录（交付物可发现）。renderer 只提交
     * projectId；主进程读目录，响应仅含 basename/大小/时间，绝不暴露路径。
     */
    list(input: unknown): Promise<LinguistIpcResult<LinguistExportListResult>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        return deps.getService().listExportFiles(projectId)
      })
    },

    saveAsset(
      input: unknown,
      pickDestination: LinguistExportSavePicker,
    ): Promise<LinguistIpcResult<LinguistExportSaveAssetResult>> {
      return wrap(async () => {
        const record = assertRecord(input)
        const projectId = readProjectId(record)
        const assetId = readAssetId(record)

        const service = deps.getService()
        const prepared = await service.prepareDelivery(projectId, assetId)
        if (prepared.staged === undefined || prepared.verification === undefined) {
          if (prepared.preflight.qa.openErrors > 0) {
            throw new LinguistExportBlockedByQaError(
              projectId,
              assetId,
              prepared.preflight.qa.openErrors,
            )
          }
          throw new LinguistDeliveryNotReadyError(
            projectId,
            assetId,
            prepared.preflight.blockers.length,
          )
        }
        const staged = prepared.staged
        const picked = await pickDestination({
          title: '导出翻译批次',
          defaultPath: staged.suggestedFilename,
        })
        if (picked.canceled || picked.filePath === undefined) {
          return { cancelled: true }
        }

        const manifest = readLinguistExportManifests(
          service.getProjectPaths(projectId).exportsDir,
        ).get(staged.artifact.id)
        if (
          manifest === undefined
          || manifest.sha256 !== staged.artifact.sha256
          || manifest.assetId !== staged.artifact.assetId
        ) {
          invalid('导出审计清单不可用，请重新生成交付物')
        }
        let delivery: ReturnType<typeof copyFileVerified>
        try {
          delivery = copyFileVerified({
            managedRoot: service.rootDir,
            sourcePath: staged.stagingPath,
            destinationPath: picked.filePath,
            expectedSha256: staged.artifact.sha256,
          })
        } catch (error) {
          if (error instanceof SecureExportError) invalid(error.message)
          throw error
        }
        const { id, assetId: artifactAssetId, sha256, segmentCount, createdAt } = staged.artifact
        console.log(
          `[Linguist IPC] 导出完成: 项目 ${projectId} 资产 ${assetId}（${staged.verifiedSegments} 段）`,
        )
        return {
          cancelled: false,
          filename: basename(picked.filePath),
          artifact: {
            id,
            assetId: artifactAssetId,
            sha256,
            segmentCount,
            createdAt,
          },
          delivery: {
            ...delivery,
            projectRevision: manifest.projectRevision,
          },
          verifiedSegments: staged.verifiedSegments,
          preparation: publicPreparation(prepared),
        }
      })
    },
  }
}
