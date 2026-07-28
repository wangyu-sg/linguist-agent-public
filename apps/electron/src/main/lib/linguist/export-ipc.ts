/**
 * PB-073 导出交付边界：renderer 只提交 project/asset id；主进程完成
 * staging、原生 Save 选择与复制，响应不暴露任何文件系统路径。
 */

import { constants, copyFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
import type {
  LinguistPreparedDelivery,
  LinguistProjectService,
} from './project-service'

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

function isInside(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === ''
    || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
}

function validateDestination(rootDir: string, filePath: string): string {
  if (filePath.trim() === '' || !isAbsolute(filePath)) {
    invalid('导出目标必须是绝对文件路径')
  }
  const destination = resolve(filePath)
  let canonicalParent: string
  try {
    canonicalParent = realpathSync(dirname(destination))
  } catch {
    invalid('导出目标目录不可用，请选择已有目录')
  }
  const canonicalDestination = join(canonicalParent, basename(destination))
  if (isInside(realpathSync(resolve(rootDir)), canonicalDestination)) {
    invalid('不能导出到 Linguist Agent 受管数据目录')
  }
  return canonicalDestination
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}

function readAssetId(record: Record<string, unknown>): string {
  const assetId = record.assetId
  if (typeof assetId !== 'string' || !LINGUIST_ASSET_ID_PATTERN.test(assetId)) {
    invalid('assetId must match ast-<16 lowercase hex>')
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
          title: '导出翻译资产',
          defaultPath: staged.suggestedFilename,
        })
        if (picked.canceled || picked.filePath === undefined) {
          return { cancelled: true }
        }

        const destination = validateDestination(service.rootDir, picked.filePath)
        try {
          copyFileSync(staged.stagingPath, destination, constants.COPYFILE_EXCL)
        } catch (error) {
          if (hasErrorCode(error, 'EEXIST')) {
            invalid('导出目标已存在，请选择新的文件名')
          }
          throw error
        }
        const { id, assetId: artifactAssetId, sha256, segmentCount, createdAt } = staged.artifact
        console.log(
          `[Linguist IPC] 导出完成: 项目 ${projectId} 资产 ${assetId}（${staged.verifiedSegments} 段）`,
        )
        return {
          cancelled: false,
          filename: basename(destination),
          artifact: {
            id,
            assetId: artifactAssetId,
            sha256,
            segmentCount,
            createdAt,
          },
          verifiedSegments: staged.verifiedSegments,
          preparation: publicPreparation(prepared),
        }
      })
    },
  }
}
