export type MechanicalTextQaCode =
  | "SOURCE_EQUALS_TARGET"
  | "SOURCE_TARGET_INCONSISTENCY"
  | "TARGET_SOURCE_INCONSISTENCY"
  | "UNPAIRED_SYMBOL"
  | "UNPAIRED_QUOTE"
  | "REPEATED_WORD"
  | "DOUBLE_SPACE"
  | "EDGE_WHITESPACE"
  | "UPPERCASE_TOKEN_MISMATCH"
  | "CAMELCASE_TOKEN_MISMATCH";

export interface MechanicalTextQaSegment {
  id: string;
  source: string;
  target: string;
  locked?: boolean;
}

export interface MechanicalTextQaOptions {
  /** Xbench exposes this as an option. LA defaults to case-insensitive consistency. */
  caseSensitiveConsistency?: boolean;
  /** Optional high-noise parity checks; disabled unless a project deliberately enables them. */
  checkUppercaseTokens?: boolean;
  checkCamelCaseTokens?: boolean;
}

export function parseMechanicalTextQaOptions(value: unknown): MechanicalTextQaOptions | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("mechanicalOptions must be an object.");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["caseSensitiveConsistency", "checkUppercaseTokens", "checkCamelCaseTokens"]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`mechanicalOptions contains unsupported field(s): ${unknown.join(", ")}.`);
  const options: MechanicalTextQaOptions = {};
  for (const key of allowed) {
    const candidate = raw[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "boolean") throw new Error(`mechanicalOptions.${key} must be a boolean.`);
    options[key as keyof MechanicalTextQaOptions] = candidate;
  }
  return options;
}

export interface MechanicalTextQaIssue {
  code: MechanicalTextQaCode;
  segmentId: string;
  relatedSegmentIds: string[];
  message: string;
  evidence: string[];
}

function normalizeConsistency(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return caseSensitive ? normalized : normalized.toLocaleLowerCase();
}

function unpairedSymbolFamilies(value: string): string[] {
  const pairs = new Map<string, string>([
    [")", "("], ["]", "["], ["}", "{"], ["）", "（"], ["］", "［"], ["｝", "｛"],
    ["】", "【"], ["〉", "〈"], ["》", "《"], ["」", "「"], ["』", "『"],
  ]);
  const opens = new Set(pairs.values());
  const stack: string[] = [];
  const failures = new Set<string>();
  for (const char of value) {
    if (opens.has(char)) {
      stack.push(char);
      continue;
    }
    const expected = pairs.get(char);
    if (!expected) continue;
    if (stack.at(-1) === expected) stack.pop();
    else failures.add(`${expected}${char}`);
  }
  for (const open of stack) {
    const close = [...pairs].find(([, candidate]) => candidate === open)?.[0] ?? "?";
    failures.add(`${open}${close}`);
  }
  return [...failures];
}

function unpairedQuoteFamilies(value: string): string[] {
  const failures: string[] = [];
  const paired = [["“", "”"], ["«", "»"], ["‹", "›"]] as const;
  for (const [open, close] of paired) {
    const opens = [...value].filter((char) => char === open).length;
    const closes = [...value].filter((char) => char === close).length;
    if (opens !== closes) failures.push(`${open}${close}:${opens}/${closes}`);
  }
  const straightDouble = (value.match(/"/g) ?? []).length;
  if (straightDouble % 2 !== 0) failures.push(`\"\":${straightDouble}`);
  // Ignore apostrophes inside words (don't, hero's); only delimiter-like single quotes count.
  const withoutApostrophes = value.replace(/(?<=\p{L})['’](?=\p{L})/gu, "");
  const delimiterSingles = withoutApostrophes.match(/'/g)?.length ?? 0;
  if (delimiterSingles % 2 !== 0) failures.push(`'':${delimiterSingles}`);
  const curlySingleOpens = [...withoutApostrophes].filter((char) => char === "‘").length;
  const curlySingleCloses = [...withoutApostrophes].filter((char) => char === "’").length;
  if (curlySingleOpens !== curlySingleCloses) failures.push(`‘’:${curlySingleOpens}/${curlySingleCloses}`);
  return failures;
}

function repeatedWords(value: string): string[] {
  const words = Array.from(value.matchAll(/\p{L}+(?:['’]\p{L}+)*/gu));
  const repeated = new Set<string>();
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1];
    const current = words[index];
    const separator = value.slice((previous.index ?? 0) + previous[0].length, current.index ?? 0);
    if (/^\s+$/u.test(separator) && current[0].length > 1 && current[0].toLocaleLowerCase() === previous[0].toLocaleLowerCase()) {
      repeated.add(current[0]);
    }
  }
  return [...repeated];
}

function uppercaseTokens(value: string): string[] {
  return value.match(/\b[A-Z][A-Z0-9_-]{1,}\b/g) ?? [];
}

function camelCaseTokens(value: string): string[] {
  return value.match(/\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b/g) ?? [];
}

function sameMultiset(left: string[], right: string[]): boolean {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

export function findMechanicalTextQaIssues(
  segments: readonly MechanicalTextQaSegment[],
  options: MechanicalTextQaOptions = {},
): MechanicalTextQaIssue[] {
  const issues: MechanicalTextQaIssue[] = [];
  const caseSensitive = options.caseSensitiveConsistency ?? false;
  const sourceGroups = new Map<string, MechanicalTextQaSegment[]>();
  const targetGroups = new Map<string, MechanicalTextQaSegment[]>();

  for (const segment of segments) {
    if (segment.locked || !segment.target.trim()) continue;
    const source = segment.source.trim();
    const target = segment.target.trim();
    const local = (code: MechanicalTextQaCode, message: string, evidence: string[]) => issues.push({
      code,
      segmentId: segment.id,
      relatedSegmentIds: [],
      message,
      evidence,
    });

    if (source && source === target) local("SOURCE_EQUALS_TARGET", "Source and target are identical.", ["source equals target"]);

    const symbolFamilies = unpairedSymbolFamilies(segment.target);
    if (symbolFamilies.length) local("UNPAIRED_SYMBOL", "Target contains unpaired or misnested symbols.", symbolFamilies);

    const quoteFamilies = unpairedQuoteFamilies(segment.target);
    if (quoteFamilies.length) local("UNPAIRED_QUOTE", "Target contains unpaired quotation marks.", quoteFamilies);

    const repeated = repeatedWords(segment.target);
    if (repeated.length) local("REPEATED_WORD", `Target repeats adjacent word(s): ${repeated.join(", ")}.`, repeated);

    const doubleSpaces = Array.from(segment.target.matchAll(/ {2,}/g), (match) => `${match[0].length}@${match.index ?? 0}`);
    if (doubleSpaces.length) local("DOUBLE_SPACE", "Target contains consecutive spaces.", doubleSpaces);
    if (segment.target !== target) local("EDGE_WHITESPACE", "Target has leading or trailing whitespace.", ["target trim changes value"]);

    if (options.checkUppercaseTokens) {
      const sourceTokens = uppercaseTokens(segment.source);
      const targetTokens = uppercaseTokens(segment.target);
      if (!sameMultiset(sourceTokens, targetTokens)) {
        local("UPPERCASE_TOKEN_MISMATCH", "UPPERCASE token sets differ between source and target.", [`source:${sourceTokens.join("|")}`, `target:${targetTokens.join("|")}`]);
      }
    }
    if (options.checkCamelCaseTokens) {
      const sourceTokens = camelCaseTokens(segment.source);
      const targetTokens = camelCaseTokens(segment.target);
      if (!sameMultiset(sourceTokens, targetTokens)) {
        local("CAMELCASE_TOKEN_MISMATCH", "CamelCase token sets differ between source and target.", [`source:${sourceTokens.join("|")}`, `target:${targetTokens.join("|")}`]);
      }
    }

    const sourceKey = normalizeConsistency(source, caseSensitive);
    const targetKey = normalizeConsistency(target, caseSensitive);
    if (sourceKey) sourceGroups.set(sourceKey, [...(sourceGroups.get(sourceKey) ?? []), segment]);
    if (targetKey) targetGroups.set(targetKey, [...(targetGroups.get(targetKey) ?? []), segment]);
  }

  for (const group of sourceGroups.values()) {
    const targets = new Set(group.map((segment) => normalizeConsistency(segment.target, caseSensitive)));
    if (targets.size <= 1) continue;
    for (const segment of group) {
      issues.push({
        code: "SOURCE_TARGET_INCONSISTENCY",
        segmentId: segment.id,
        relatedSegmentIds: group.filter((row) => row.id !== segment.id).map((row) => row.id),
        message: "Same source has multiple targets.",
        evidence: group.map((row) => `${row.id}:${row.target}`),
      });
    }
  }
  for (const group of targetGroups.values()) {
    const sources = new Set(group.map((segment) => normalizeConsistency(segment.source, caseSensitive)));
    if (sources.size <= 1) continue;
    for (const segment of group) {
      issues.push({
        code: "TARGET_SOURCE_INCONSISTENCY",
        segmentId: segment.id,
        relatedSegmentIds: group.filter((row) => row.id !== segment.id).map((row) => row.id),
        message: "Different sources share the same target.",
        evidence: group.map((row) => `${row.id}:${row.source}`),
      });
    }
  }
  return issues;
}
