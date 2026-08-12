/**
 * @linguist/cat-formats — bilingual format adapters (PB-022).
 *
 * Adapter interface + registry + typed format errors + injectable hashing.
 * May import @linguist/cat-core only; no Proma/Pi/Electron/React, no fs.
 * Dependency direction: cat-core <- formats <- store <- tools.
 *
 * Test fixtures and the round-trip harness live under the `./testing`
 * subpath export so production imports stay lean.
 */

export {
  FORMAT_ERROR_CODES,
  FormatAmbiguousError,
  FormatError,
  FormatExportError,
  FormatParseError,
  FormatSegmentLostError,
  FormatUnsupportedError,
  type FormatErrorCode,
} from './errors'

export { sha256Hex, type HashFn } from './hash'

export {
  bindImportedSegments,
  type CatAsset,
  type CatFormatAdapter,
  type CatFormatExportInput,
  type CatFormatImportInput,
  type ImportedAssetInfo,
  type ImportedCatAsset,
  type ImportedCatSegment,
  type ImportWarning,
} from './adapter'

export { CatFormatRegistry, type DetectedAdapter } from './registry'

export { XLIFF_ADAPTER_ID, XliffAdapter } from './adapters/xliff'

export {
  MQXLIFF_ADAPTER_ID,
  MqXliffAdapter,
  writeMqXliffDefects,
  type MqXliffDefectWrite,
  type MqXliffDefectWriteResult,
} from './adapters/mqxliff'

export { SDLXLIFF_ADAPTER_ID, SdlXliffAdapter } from './adapters/sdlxliff'

export {
  PHRASE_MXLIFF_ADAPTER_ID,
  PhraseMxliffAdapter,
  probePhraseMasterPair,
  parsePhraseMxliffFormatConfig,
  serializePhraseMxliffFormatConfig,
  type PhraseMasterPairProbe,
  type PhraseMxliffFormatConfig,
  type PhraseMxliffTagMapping,
} from './adapters/phrasemxliff'

export { PHRASE_DOCX_ADAPTER_ID, PhraseDocxAdapter } from './adapters/phrasedocx'

export {
  CSV_ADAPTER_ID,
  CsvAdapter,
  normalizeDelimitedHeader,
  parseDelimitedTable,
  type CsvAdapterOptions,
  type CsvColumnMapping,
} from './adapters/csv'

export { JSON_ADAPTER_ID, JsonAdapter, type JsonAdapterOptions, type JsonArrayMapping } from './adapters/json'

export {
  XLSX_ADAPTER_ID,
  XLSX_FORMAT_CONFIG_VERSION,
  XlsxAdapter,
  parseXlsxFormatConfig,
  serializeXlsxFormatConfig,
  type XlsxAdapterOptions,
  type XlsxFormatConfig,
} from './adapters/xlsx'

export {
  parseTmx,
  type TmxEntry,
  type TmxParseResult,
} from './tmx'

export {
  parseTbx,
  type TbxEntry,
  type TbxParseResult,
  type TbxTermStatus,
} from './tbx'

export {
  parseXlsxWorkbook,
  XLSX_WORKBOOK_PARSER_ID,
  XLSX_WORKBOOK_PARSER_VERSION,
  type XlsxMergedRange,
  type XlsxSheetState,
  type XlsxSkippedSheet,
  type XlsxWorkbookCell,
  type XlsxWorkbookCellKind,
  type XlsxWorkbookDistortion,
  type XlsxWorkbookParseOptions,
  type XlsxWorkbookParseResult,
  type XlsxWorkbookRow,
  type XlsxWorkbookSheet,
  type XlsxWorkbookSheetStats,
  type XlsxWorkbookVerificationReport,
} from './workbook'

export type { XmlLocalePairOptions } from './xml-parser'
