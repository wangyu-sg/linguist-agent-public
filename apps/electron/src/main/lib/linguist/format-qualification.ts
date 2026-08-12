import type { LinguistFormatQualification } from '@proma/shared'
import {
  CSV_ADAPTER_ID,
  JSON_ADAPTER_ID,
  MQXLIFF_ADAPTER_ID,
  PHRASE_DOCX_ADAPTER_ID,
  PHRASE_MXLIFF_ADAPTER_ID,
  SDLXLIFF_ADAPTER_ID,
  XLIFF_ADAPTER_ID,
  XLSX_ADAPTER_ID,
} from '@linguist/cat-formats'
import { createDefaultCatFormatRegistry } from './format-registry'

/** 当前发布树已有自动化 import/export/round-trip 覆盖的 Adapter。 */
const INTERNALLY_VERIFIED_FORMAT_IDS = new Set<string>([
  MQXLIFF_ADAPTER_ID,
  XLIFF_ADAPTER_ID,
  SDLXLIFF_ADAPTER_ID,
  PHRASE_MXLIFF_ADAPTER_ID,
  PHRASE_DOCX_ADAPTER_ID,
  CSV_ADAPTER_ID,
  JSON_ADAPTER_ID,
  XLSX_ADAPTER_ID,
])

export function listDefaultFormatQualifications(): LinguistFormatQualification[] {
  return createDefaultCatFormatRegistry().list().map((adapter) => ({
    formatId: adapter.id,
    extensions: [...adapter.extensions],
    internalVerification: INTERNALLY_VERIFIED_FORMAT_IDS.has(adapter.id) ? 'passed' : 'failed',
    // 取得真实文件/平台回传/原生目标证据前不得提升。
    platformQualification: 'unverified',
  }))
}
