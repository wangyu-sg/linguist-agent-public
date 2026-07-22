import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  createTmStore,
  importSdltmMemory,
  importTmTable,
  importTmxMemory,
  readProjectLocalePair,
  type CatWorkspace,
  type TmConcordanceMatch,
  type TmImportResult,
  type TmMatch,
} from "@linguist-agent/cat-data";

const tmImportTableParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute xlsx/csv/tsv/txt/md TM table path." }),
  sheetName: Type.Optional(Type.String({ description: "Sheet name to import. Defaults to first sheet." })),
  sourceColumn: Type.String({ description: "Confirmed source column header." }),
  targetColumn: Type.String({ description: "Confirmed target column header." }),
  noteColumn: Type.Optional(Type.String({ description: "Optional note/context/status column header." })),
  srcLang: Type.Optional(Type.String({ description: "Override the project source locale for this import." })),
  tgtLang: Type.Optional(Type.String({ description: "Override the project target locale for this import." })),
  append: Type.Optional(Type.Boolean({ default: false })),
});

const tmImportTmxParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute TMX file path." }),
  srcLang: Type.Optional(Type.String({ description: "Override the project source locale for this import." })),
  tgtLang: Type.Optional(Type.String({ description: "Override the project target locale for this import." })),
  append: Type.Optional(Type.Boolean({ default: false })),
});

const tmImportSdltmParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute SDLTM file path." }),
  srcLang: Type.Optional(Type.String({ description: "Override the project source locale for this import." })),
  tgtLang: Type.Optional(Type.String({ description: "Override the project target locale for this import." })),
  append: Type.Optional(Type.Boolean({ default: false })),
});

const tmConcordanceParameters = Type.Object({
  query: Type.String({ description: "Term, phrase, source substring, target substring, or note text to search in TM." }),
  srcLang: Type.Optional(Type.String({ description: "Defaults to the project source locale." })),
  tgtLang: Type.Optional(Type.String({ description: "Defaults to the project target locale." })),
  origin: Type.Optional(
    Type.Union(
      [
        Type.Literal("any"),
        Type.Literal("reviewed"),
        Type.Literal("client_tm"),
        Type.Literal("imported"),
        Type.Literal("unknown"),
        Type.Literal("mt"),
      ],
      { default: "any", description: "Filter by TM origin/trust role. Unreviewed mt is still hidden unless includeUnreviewedMt=true." },
    ),
  ),
  minQuality: Type.Optional(Type.Number({ default: 0, minimum: 0, maximum: 100 })),
  field: Type.Optional(
    Type.Union([Type.Literal("source"), Type.Literal("target"), Type.Literal("note"), Type.Literal("both")], {
      default: "both",
      description: "Search source only, target only, or both source/target plus notes.",
    }),
  ),
  topK: Type.Optional(Type.Number({ default: 20, minimum: 1, maximum: 100 })),
  includeUnreviewedMt: Type.Optional(Type.Boolean({ default: false })),
});

function formatMatches(matches: TmMatch[]): string {
  if (!matches.length) {
    return "No TM matches found.";
  }
  return matches
    .map((match, index) => {
      const pct = Math.round(match.score * 100);
      return [
        `## ${index + 1}. ${pct}% ${match.matchType} · ${match.origin}${match.quality ? ` · q${match.quality}` : ""}${match.origin === "mt" ? " · NOT_AUTHORITATIVE" : ""}`,
        `Source: ${match.source}`,
        `Target: ${match.target}`,
        match.note ? `Note: ${match.note}` : undefined,
        match.project ? `Project: ${match.project}` : undefined,
        `Evidence: tm:${match.id}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function formatConcordance(matches: TmConcordanceMatch[]): string {
  if (!matches.length) {
    return "No TM concordance matches found.";
  }
  return matches
    .map((match, index) =>
      [
        `## ${index + 1}. ${match.field} · ${Math.round(match.score * 100)}% · ${match.origin}${match.quality ? ` · q${match.quality}` : ""}${match.origin === "mt" ? " · NOT_AUTHORITATIVE" : ""}`,
        `Source: ${match.source}`,
        `Target: ${match.target}`,
        `Snippet: ${match.snippet}`,
        match.note ? `Note: ${match.note}` : undefined,
        match.project ? `Project: ${match.project}` : undefined,
        `Evidence: tm:${match.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function formatImport(result: TmImportResult): string {
  return [
    `Imported ${result.imported} TM rows (${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped, ${result.replaced} replaced).`,
    `Path: ${result.path}`,
    `Source file: ${result.sourceFile}`,
    result.warnings.length ? `Warnings: ${result.warnings.join("; ")}` : undefined,
    result.sample.length
      ? `Sample:\n${result.sample.map((entry) => `- ${entry.source} -> ${entry.target} (${entry.origin})`).join("\n")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createTmImportTableTool() {
  return defineTool<typeof tmImportTableParameters>({
    name: "tm_import_table",
    label: "TM Import Table",
    description: "Import confirmed workbook/table translation memory rows into project tm.json without overwriting reviewed TM.",
    promptSnippet: "tm_import_table: import client TM from XLSX/CSV/TSV/TXT/MD after workbook_preview confirms source/target columns.",
    promptGuidelines: [
      "Call workbook_preview before this tool unless the user explicitly gives exact column names.",
      "Use this for bilingual memory tables, not terminology-only tables.",
      "append=false replaces previous client/imported TM for the same project and language pair but preserves reviewed TM.",
    ],
    parameters: tmImportTableParameters,
    async execute(_toolCallId, params) {
      const result = await importTmTable(process.cwd(), params);
      return { content: [{ type: "text", text: formatImport(result) }], details: result };
    },
  });
}

export function createTmImportTmxTool() {
  return defineTool<typeof tmImportTmxParameters>({
    name: "tm_import_tmx",
    label: "TM Import TMX",
    description: "Import client TMX translation memory into project tm.json without overwriting reviewed TM.",
    promptSnippet: "tm_import_tmx: import client TM from TMX files for the active language pair.",
    promptGuidelines: [
      "Use this for .tmx files only.",
      "Confirm srcLang/tgtLang when the TMX language pair is unclear.",
      "append=false replaces previous client/imported TM for the same project and language pair but preserves reviewed TM.",
    ],
    parameters: tmImportTmxParameters,
    async execute(_toolCallId, params) {
      const result = await importTmxMemory(process.cwd(), params);
      return { content: [{ type: "text", text: formatImport(result) }], details: result };
    },
  });
}

export function createTmImportSdltmTool() {
  return defineTool<typeof tmImportSdltmParameters>({
    name: "tm_import_sdltm",
    label: "TM Import SDLTM",
    description: "Import client Trados SDLTM translation memory into project tm.json without overwriting reviewed TM.",
    promptSnippet: "tm_import_sdltm: import client TM from Trados .sdltm files for the active language pair.",
    promptGuidelines: [
      "Use this for .sdltm files only.",
      "Confirm srcLang/tgtLang when the SDLTM language pair is unclear.",
      "append=false replaces previous client/imported TM for the same project and language pair but preserves reviewed TM.",
    ],
    parameters: tmImportSdltmParameters,
    async execute(_toolCallId, params) {
      const result = await importSdltmMemory(process.cwd(), params);
      return { content: [{ type: "text", text: formatImport(result) }], details: result };
    },
  });
}

export function createTmLookupTool(workspace: CatWorkspace) {
  const store = createTmStore(workspace);

  return defineTool({
    name: "tm_lookup",
    label: "TM Lookup",
    description: "Look up Translation Memory matches for a source string in the active CAT workspace.",
    promptSnippet: "tm_lookup: search project Translation Memory by source string before translating or revising.",
    promptGuidelines: [
      "Call tm_lookup before writing a translation draft or proposing an edit/proof change.",
      "Prefer origin='reviewed' and higher quality values.",
      "A TM match is evidence only when the returned Source/Target pair is relevant to the current segment.",
      "If no relevant TM match exists, say that explicitly and proceed with a language judgment or another lookup.",
    ],
    parameters: Type.Object({
      source: Type.String({ description: "Source text to search in the TM." }),
      srcLang: Type.Optional(Type.String({ description: "Defaults to the project source locale." })),
      tgtLang: Type.Optional(Type.String({ description: "Defaults to the project target locale." })),
      origin: Type.Optional(
        Type.Union(
          [
            Type.Literal("any"),
            Type.Literal("reviewed"),
            Type.Literal("client_tm"),
            Type.Literal("imported"),
            Type.Literal("unknown"),
            Type.Literal("mt"),
          ],
          { default: "any", description: "Filter by TM origin/trust role. Unreviewed mt is still hidden unless includeUnreviewedMt=true." },
        ),
      ),
      minQuality: Type.Optional(Type.Number({ default: 0, minimum: 0, maximum: 100 })),
      threshold: Type.Optional(Type.Number({ default: 0.7, minimum: 0, maximum: 1 })),
      topK: Type.Optional(Type.Number({ default: 5, minimum: 1, maximum: 20 })),
      includeUnreviewedMt: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params) {
      const locales = await readProjectLocalePair(workspace.root, workspace.projectId, {
        sourceLanguage: params.srcLang,
        targetLanguage: params.tgtLang,
      });
      const matches = await store.lookup({
        source: params.source,
        srcLang: locales.sourceLanguage,
        tgtLang: locales.targetLanguage,
        origin: params.origin,
        minQuality: params.minQuality,
        threshold: params.threshold,
        topK: params.topK,
        includeUnreviewedMt: params.includeUnreviewedMt,
      });
      return {
        content: [{ type: "text", text: formatMatches(matches) }],
        details: { matches },
      };
    },
  });
}

export function createTmConcordanceTool(workspace: CatWorkspace) {
  const store = createTmStore(workspace);

  return defineTool({
    name: "tm_concordance",
    label: "TM Concordance",
    description: "Search Translation Memory by source/target substring for consistency and precedent checks.",
    promptSnippet: "tm_concordance: search TM source/target/note text when checking consistency or historical phrasing.",
    promptGuidelines: [
      "Use tm_concordance when checking how a term or English phrase has been used across prior TM rows.",
      "Concordance results are evidence only when the returned Source/Target/Snippet is relevant to the current decision.",
      "Unreviewed MT rows are hidden by default and are never authoritative evidence unless explicitly requested for diagnostics.",
      "For exact current-source matching, prefer tm_lookup; for historical phrasing or consistency patterns, use tm_concordance.",
    ],
    parameters: tmConcordanceParameters,
    async execute(_toolCallId, params) {
      const locales = await readProjectLocalePair(workspace.root, workspace.projectId, {
        sourceLanguage: params.srcLang,
        targetLanguage: params.tgtLang,
      });
      const matches = await store.concordance({
        query: params.query,
        srcLang: locales.sourceLanguage,
        tgtLang: locales.targetLanguage,
        origin: params.origin,
        minQuality: params.minQuality,
        field: params.field,
        topK: params.topK,
        includeUnreviewedMt: params.includeUnreviewedMt,
      });
      return {
        content: [{ type: "text", text: formatConcordance(matches) }],
        details: { matches },
      };
    },
  });
}
