/**
 * 主进程默认 CAT 格式注册表（PB-030）：登记产品随附的七个 adapter
 * （XLIFF / CSV / JSON，PB-022~023；XLSX，PB-081；SDLXLIFF，PB-086；
 * Phrase MXLIFF，PB-087；Phrase bilingual DOCX，PB-088）。registry 从空
 * 开始是 cat-formats 的刻意设计——谁发布谁登记；测试可注入自定义 registry。
 */

import {
  CatFormatRegistry,
  CsvAdapter,
  JsonAdapter,
  PhraseDocxAdapter,
  PhraseMxliffAdapter,
  SdlXliffAdapter,
  XliffAdapter,
  XlsxAdapter,
} from '@linguist/cat-formats'

export function createDefaultCatFormatRegistry(): CatFormatRegistry {
  return new CatFormatRegistry()
    .register(new XliffAdapter())
    .register(new SdlXliffAdapter())
    .register(new PhraseMxliffAdapter())
    .register(new PhraseDocxAdapter())
    .register(new CsvAdapter())
    .register(new JsonAdapter())
    .register(new XlsxAdapter())
}
