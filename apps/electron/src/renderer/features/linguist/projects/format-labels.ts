/** 批次格式 ID → 用户可读标签；未知 ID 保留原值便于发现漏登记的 Adapter。 */
const LINGUIST_FORMAT_LABELS: Record<string, string> = {
  xliff_1_2: 'XLIFF 1.2',
  mqxliff_1_2: 'memoQ MQXLIFF',
  sdlxliff_1_2: 'SDL Trados XLIFF',
  phrase_mxliff_1_2: 'Phrase MXLIFF',
  phrase_bilingual_docx_1: 'Phrase 双语 DOCX',
  xlsx_ooxml: 'Excel 工作簿',
  csv_rfc4180: 'CSV 表格',
  json_i18n: 'JSON 国际化',
}

export function describeLinguistFormat(formatId: string): string {
  return LINGUIST_FORMAT_LABELS[formatId] ?? formatId
}

/** `.mqxliff` 未被专用 Adapter 命中时，必须向用户明示通用 XLIFF 边界。 */
export function isGenericXliffFallback(filename: string, formatId: string): boolean {
  return formatId === 'xliff_1_2' && filename.toLowerCase().endsWith('.mqxliff')
}

export const GENERIC_XLIFF_FALLBACK_NOTICE = '已按通用 XLIFF 打开；memoQ 专有结构未完全验证'

export function describeFormatCapability(formatId: string): string | undefined {
  if (formatId === 'mqxliff_1_2') {
    return '专用解析：已启用 · Tag round-trip：合成样例已验证，真实样本待验证'
  }
  if (formatId === 'phrase_mxliff_1_2') {
    return 'Phrase split/master：内容配对已启用 · verified 导出会检查 Tag Mapping'
  }
  return undefined
}
