export const TABLE_ID_ALIASES = new Set(["segmentid", "uniquekey", "key", "id", "唯一键"]);
export const TABLE_SOURCE_ALIASES = new Set(["source", "src", "zhcn", "zh", "chinese", "源文", "中文"]);
export const TABLE_TARGET_ALIASES = new Set(["target", "tgt", "enus", "stringenus", "translation", "english", "译文", "英文"]);
export const TABLE_STATE_ALIASES = new Set(["state", "status"]);
export const TABLE_NOTE_ALIASES = new Set(["note", "notes", "comment", "备注"]);

export function normalizeTableHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_/-]+/g, "");
}

export function pickTableColumn(headers: string[], aliases: Set<string>): number {
  return headers.findIndex((header) => aliases.has(normalizeTableHeader(header)));
}
