import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  grepAssets,
  importGlossaryTable,
  lookupGlossary,
  readAssetText,
  type AssetGrepHit,
  type GlossaryMatch,
} from "@linguist-agent/cat-data";

const glossaryImportParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Absolute path or project-root-relative md/txt/csv/tsv glossary file." }),
  sourceColumn: Type.Optional(Type.String({ description: "Header name for source/term column." })),
  targetColumn: Type.Optional(Type.String({ description: "Header name for target/translation column." })),
  noteColumn: Type.Optional(Type.String({ description: "Optional header name for note/context column." })),
  append: Type.Optional(Type.Boolean({ default: false })),
});

const glossaryLookupParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  term: Type.String({ description: "Source term to look up." }),
  limit: Type.Optional(Type.Number({ default: 10, minimum: 1, maximum: 50 })),
});

const assetGrepParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  query: Type.String({ description: "Keyword to search in readable project assets." }),
  limit: Type.Optional(Type.Number({ default: 20, minimum: 1, maximum: 100 })),
});

const assetReadParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute asset path." }),
  maxChars: Type.Optional(Type.Number({ default: 12000, minimum: 1000, maximum: 50000 })),
});

function formatGlossaryMatches(matches: GlossaryMatch[]): string {
  if (!matches.length) return "No glossary matches found.";
  return matches
    .map((match, index) =>
      [
        `## ${index + 1}. ${match.matchType}`,
        `Source: ${match.source}`,
        `Target: ${match.target}`,
        match.note ? `Note: ${match.note}` : undefined,
        `Evidence: ${match.sourceFile}:${match.rowNo}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function formatAssetHits(hits: AssetGrepHit[]): string {
  if (!hits.length) return "No asset hits found.";
  return hits.map((hit) => `- ${hit.relPath}:${hit.lineNo}: ${hit.text}`).join("\n");
}

export function createGlossaryImportTool() {
  return defineTool<typeof glossaryImportParameters>({
    name: "glossary_import_table",
    label: "Glossary Import Table",
    description: "Import a simple md/txt/csv/tsv glossary table into LA workspace glossary.json.",
    promptSnippet: "glossary_import_table: import a mapped text/table glossary into project glossary state.",
    promptGuidelines: [
      "Use glossary_import_table only after checking the file role with project_read/onboarding.",
      "If column mapping is uncertain, ask the user or provide sourceColumn/targetColumn explicitly.",
      "Do not use this for binary XLSX yet; request a CSV/TSV export or wait for the XLSX mapping tool.",
    ],
    parameters: glossaryImportParameters,
    async execute(_toolCallId, params) {
      const result = await importGlossaryTable(process.cwd(), params);
      return {
        content: [
          {
            type: "text",
            text: [
              `Imported ${result.imported} glossary entries (${result.skipped} skipped).`,
              `Path: ${result.path}`,
              result.warnings.length ? `Warnings: ${result.warnings.join("; ")}` : undefined,
              result.sample.length
                ? `Sample:\n${result.sample.map((entry) => `- ${entry.source} -> ${entry.target} (${entry.rowNo})`).join("\n")}`
                : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        details: result,
      };
    },
  });
}

export function createGlossaryLookupTool() {
  return defineTool<typeof glossaryLookupParameters>({
    name: "glossary_lookup",
    label: "Glossary Lookup",
    description: "Look up imported project glossary entries by source term.",
    promptSnippet: "glossary_lookup: search imported project glossary before deciding terminology.",
    promptGuidelines: [
      "Call glossary_lookup before term-sensitive translation/edit/proof decisions.",
      "A glossary row is evidence only when Source/Target is relevant to the current segment.",
      "If no match exists, say that explicitly before using language judgment.",
    ],
    parameters: glossaryLookupParameters,
    async execute(_toolCallId, params) {
      const matches = await lookupGlossary(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatGlossaryMatches(matches) }],
        details: { matches },
      };
    },
  });
}

export function createAssetGrepTool() {
  return defineTool<typeof assetGrepParameters>({
    name: "asset_grep",
    label: "Asset Grep",
    description: "Search readable project reference/style/glossary/source assets for a keyword.",
    promptSnippet: "asset_grep: search readable project assets for evidence snippets.",
    promptGuidelines: [
      "Use asset_grep when TM/glossary is insufficient and the user asks about project references or style.",
      "Cite returned file:line hits when using them as evidence.",
    ],
    parameters: assetGrepParameters,
    async execute(_toolCallId, params) {
      const hits = await grepAssets(process.cwd(), params);
      return {
        content: [{ type: "text", text: formatAssetHits(hits) }],
        details: { hits },
      };
    },
  });
}

export function createAssetReadTool() {
  return defineTool<typeof assetReadParameters>({
    name: "asset_read",
    label: "Asset Read",
    description: "Read a readable project asset by path.",
    promptSnippet: "asset_read: read a readable project asset section when grep hits need more context.",
    promptGuidelines: [
      "Use asset_read after asset_grep or project_read identifies a specific readable asset.",
      "If skippedReason is returned, report it instead of pretending the asset was read.",
    ],
    parameters: assetReadParameters,
    async execute(_toolCallId, params) {
      const result = await readAssetText(process.cwd(), params);
      return {
        content: [
          {
            type: "text",
            text: result.skippedReason
              ? `Skipped ${result.relPath}: ${result.skippedReason}`
              : `# ${result.relPath}${result.truncated ? " (truncated)" : ""}\n\n${result.text}`,
          },
        ],
        details: result,
      };
    },
  });
}
