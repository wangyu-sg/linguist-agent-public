/**
 * Context Doc 文本抽取边界。
 *
 * 只接收已由主进程读取的字节与无路径文件名，避免把 native picker 的绝对
 * 路径带进项目服务或错误信封。DOCX 先用 mammoth，失败或空文本时再用
 * officeparser；两个解析器都失败或均无正文时 fail closed。
 */

import { extname } from 'node:path'
import { parseXlsxWorkbook } from '@linguist/cat-formats'
import { LinguistContextDocExtractError } from './errors'

export const CONTEXT_DOC_TEXT_EXTRACT_MAX_CHARS = 200_000

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])

interface MammothModule {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>
}

interface OfficeParserModule {
  parseOfficeAsync(file: Buffer): Promise<string>
}

function capped(text: string): string {
  return text.slice(0, CONTEXT_DOC_TEXT_EXTRACT_MAX_CHARS)
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes)
  let parserAcceptedDocument = false

  try {
    const mammoth = await import('mammoth') as unknown as MammothModule
    const result = await mammoth.extractRawText({ buffer })
    parserAcceptedDocument = true
    const text = result.value.trim()
    if (text.length > 0) return capped(text)
  } catch {
    // 固定诊断在两种解析器均尝试后统一产出，不把库错误或文件路径透出。
  }

  try {
    const officeParser = await import('officeparser') as unknown as OfficeParserModule
    const text = (await officeParser.parseOfficeAsync(buffer)).trim()
    parserAcceptedDocument = true
    if (text.length > 0) return capped(text)
  } catch {
    // 同上：错误细节可能含内部路径，不能进入 IPC 信封。
  }

  throw new LinguistContextDocExtractError(
    parserAcceptedDocument ? 'DOCX_EMPTY_TEXT' : 'DOCX_PARSE_FAILED',
  )
}

async function extractXlsx(bytes: Uint8Array, filename: string): Promise<string> {
  const workbook = await parseXlsxWorkbook(bytes, { filename })
  const lines = [
    `Workbook: sheets=${workbook.report.scannedSheets}/${workbook.report.totalSheets} sha256=${workbook.report.sourceSha256}`,
  ]
  for (const sheet of workbook.sheets) {
    lines.push('', `Sheet: ${JSON.stringify(sheet.name)} state=${sheet.state}`)
    const rows = [...sheet.skippedRowsAboveHeader, ...sheet.headers, ...sheet.rows]
      .sort((left, right) => left.rowNo - right.rowNo)
    for (const row of rows) {
      lines.push([
        `row=${row.rowNo}`,
        ...row.cells.map((cell) => `${cell.ref}=${JSON.stringify(cell.value)}`),
      ].join('\t'))
    }
  }
  return lines.join('\n')
}

/**
 * 提取可供 Agent 阅读的正文。未知文档类型仍作为附件保存，但不会伪称可读。
 */
export async function extractContextDocText(
  bytes: Uint8Array,
  filename: string,
): Promise<string | undefined> {
  const extension = extname(filename).toLowerCase()
  if (TEXT_EXTENSIONS.has(extension)) {
    return capped(new TextDecoder('utf-8').decode(bytes))
  }
  if (extension === '.docx') return extractDocx(bytes)
  if (extension === '.xlsx') return extractXlsx(bytes, filename)
  return undefined
}
