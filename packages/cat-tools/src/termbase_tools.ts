import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  auditTermbaseConflicts,
  importSdltbTermbase,
  importTbxTermbase,
  importTermbaseTable,
  lookupTermbase,
  readTermbaseEntries,
  readTermbaseOverrides,
  upsertTermbaseOverride,
  type TermbaseMatch,
} from "@linguist-agent/cat-data";

const termbaseImportTableParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute xlsx/csv/tsv/txt/md terminology table path." }),
  sheetName: Type.Optional(Type.String({ description: "Sheet name to import. Defaults to first sheet." })),
  sourceColumn: Type.String({ description: "Confirmed source/term column header." }),
  targetColumn: Type.String({ description: "Confirmed target/translation column header." }),
  noteColumn: Type.Optional(Type.String({ description: "Optional definition/note/context column header." })),
  srcLang: Type.Optional(Type.String({ description: "Override the project source locale for this import." })),
  tgtLang: Type.Optional(Type.String({ description: "Override the project target locale for this import." })),
  append: Type.Optional(Type.Boolean({ default: false })),
});

const termbaseImportTbxParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute TBX file path." }),
  srcLang: Type.Optional(Type.String({ description: "Override the project source locale for this import." })),
  tgtLang: Type.Optional(Type.String({ description: "Override the project target locale for this import." })),
  append: Type.Optional(Type.Boolean({ default: false })),
});

const termbaseImportSdltbParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  assetPath: Type.String({ description: "Project-root-relative or absolute SDL MultiTerm .sdltb file path." }),
  srcLang: Type.Optional(Type.String({ description: "Override the project source locale for this import." })),
  tgtLang: Type.Optional(Type.String({ description: "Override the project target locale for this import." })),
  append: Type.Optional(Type.Boolean({ default: false })),
});

const termbaseLookupParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  term: Type.String({ description: "Source term to search." }),
  srcLang: Type.Optional(Type.String({ description: "Defaults to the project source locale." })),
  tgtLang: Type.Optional(Type.String({ description: "Defaults to the project target locale." })),
  limit: Type.Optional(Type.Number({ default: 10, minimum: 1, maximum: 50 })),
});

const termbaseOverrideParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  source: Type.String({ description: "Source term to override." }),
  target: Type.String({ description: "Customer/session-confirmed target term." }),
  srcLang: Type.Optional(Type.String({ description: "Defaults to the project source locale." })),
  tgtLang: Type.Optional(Type.String({ description: "Defaults to the project target locale." })),
  reason: Type.Optional(Type.String({ description: "Why this override is authoritative." })),
  decidedBy: Type.Optional(Type.String({ description: "User/customer/person who confirmed the override." })),
});

const termbaseConflictAuditParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  start: Type.Optional(Type.Number({ default: 1, minimum: 1, description: "1-based start row for unresolved conflicts." })),
  limit: Type.Optional(Type.Number({ default: 50, minimum: 1, maximum: 200, description: "Unresolved conflicts to return in this page." })),
});

function formatMatches(matches: TermbaseMatch[]): string {
  if (!matches.length) return "No termbase matches found.";
  return matches
    .map((match, index) =>
      [
        `## ${index + 1}. ${match.matchType}`,
        `Source: ${match.source}`,
        `Target: ${match.target}`,
        match.note ? `Note: ${match.note}` : undefined,
        match.resolution ? `Resolution: ${match.resolution}` : undefined,
        match.overriddenBy ? `Overridden by: ${match.overriddenBy}` : undefined,
        match.conflictTargets?.length ? `Conflict targets: ${match.conflictTargets.join(" / ")}` : undefined,
        match.fields && Object.keys(match.fields).length
          ? `Fields: ${Object.entries(match.fields)
              .map(([key, values]) => `${key}=${values.join(" / ")}`)
              .join("; ")}`
          : undefined,
        `Lang: ${match.srcLang} -> ${match.tgtLang}`,
        `Evidence: ${match.sourceFile}${match.sheetName ? `#${match.sheetName}` : ""}:${match.rowNo}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function createTermbaseOverrideTool() {
  return defineTool<typeof termbaseOverrideParameters>({
    name: "termbase_override",
    label: "Termbase Override",
    description: "Persist a customer/session-confirmed source-target term override that takes priority over imported asset conflicts.",
    promptSnippet: "termbase_override: save a confirmed term choice so lookup, QA, proposals, and reports use it over stale imported assets.",
    promptGuidelines: [
      "Use this when the user/customer explicitly confirms a term that conflicts with imported assets.",
      "Include a short reason and decidedBy when available.",
      "Do not use this for routine translation suggestions without explicit confirmation.",
    ],
    parameters: termbaseOverrideParameters,
    async execute(_toolCallId, params) {
      const result = await upsertTermbaseOverride(process.cwd(), params.projectId, {
        source: params.source,
        target: params.target,
        srcLang: params.srcLang,
        tgtLang: params.tgtLang,
        reason: params.reason,
        decidedBy: params.decidedBy,
      });
      return {
        content: [{ type: "text", text: `Recorded term override: ${result.override.source} -> ${result.override.target}\nOverrides: ${result.total}\nPath: ${result.path}` }],
        details: result,
      };
    },
  });
}

export function createTermbaseConflictAuditTool() {
  return defineTool<typeof termbaseConflictAuditParameters>({
    name: "termbase_conflict_audit",
    label: "Termbase Conflict Audit",
    description: "List unresolved exact-source term conflicts after customer/session overrides are applied.",
    promptSnippet: "termbase_conflict_audit: find imported terms where one source has multiple targets and no override.",
    promptGuidelines: [
      "Run this after asset import and before proposal generation.",
      "Unresolved conflicts must be surfaced as review blockers instead of converted into confident terminology proposals.",
      "Page until Next start is none before declaring the conflict audit complete.",
    ],
    parameters: termbaseConflictAuditParameters,
    async execute(_toolCallId, params) {
      const [entries, overrides] = await Promise.all([readTermbaseEntries(process.cwd(), params.projectId), readTermbaseOverrides(process.cwd(), params.projectId)]);
      const conflicts = auditTermbaseConflicts(entries, overrides);
      const start = Math.max(1, Math.floor(params.start ?? 1));
      const limit = Math.max(1, Math.min(200, Math.floor(params.limit ?? 50)));
      const page = conflicts.slice(start - 1, start - 1 + limit);
      const nextStart = start - 1 + page.length < conflicts.length ? start + page.length : null;
      const text = conflicts.length
        ? [
            `Unresolved term conflicts: ${conflicts.length}`,
            `Showing ${page.length}/${conflicts.length} conflict(s) from ${start}.`,
            ...page.map((conflict) => `- ${conflict.source}: ${conflict.targets.join(" / ")} (${conflict.entries.map((entry) => `${entry.sheetName ?? entry.sourceFile}:${entry.rowNo}`).join(", ")})`),
            `Next start: ${nextStart ?? "none"}.`,
          ].join("\n")
        : "No unresolved exact-source term conflicts found.";
      return { content: [{ type: "text", text }], details: { conflicts, start, returned: page.length, nextStart } };
    },
  });
}

function formatImport(result: Awaited<ReturnType<typeof importTermbaseTable>>): string {
  return [
    `Imported ${result.imported} termbase entries (${result.skipped} skipped).`,
    `Path: ${result.path}`,
    result.warnings.length ? `Warnings: ${result.warnings.join("; ")}` : undefined,
    result.sample.length
      ? `Sample:\n${result.sample.map((entry) => `- ${entry.source} -> ${entry.target} (${entry.sourceFile}:${entry.rowNo})`).join("\n")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createTermbaseImportTableTool() {
  return defineTool<typeof termbaseImportTableParameters>({
    name: "termbase_import_table",
    label: "Termbase Import Table",
    description: "Import confirmed workbook/table terminology mapping into project termbase.json.",
    promptSnippet: "termbase_import_table: import a confirmed XLSX/CSV/TSV/TXT/MD source-target terminology table.",
    promptGuidelines: [
      "Call workbook_preview before this tool unless the user explicitly gives exact column names.",
      "Never guess low-confidence mappings; ask for confirmation.",
      "Use append=true only when adding to an existing project termbase.",
    ],
    parameters: termbaseImportTableParameters,
    async execute(_toolCallId, params) {
      const result = await importTermbaseTable(process.cwd(), params);
      return { content: [{ type: "text", text: formatImport(result) }], details: result };
    },
  });
}

export function createTermbaseImportTbxTool() {
  return defineTool<typeof termbaseImportTbxParameters>({
    name: "termbase_import_tbx",
    label: "Termbase Import TBX",
    description: "Import TBX terminology into project termbase.json. SDLTB binary files must be exported to TBX/table first.",
    promptSnippet: "termbase_import_tbx: import TBX termbase entries into project termbase state.",
    promptGuidelines: [
      "Use this for .tbx files only.",
      "If the asset is .sdltb, explain that LA v0.15 requires TBX/table export rather than pretending it was read.",
    ],
    parameters: termbaseImportTbxParameters,
    async execute(_toolCallId, params) {
      const result = await importTbxTermbase(process.cwd(), params);
      return { content: [{ type: "text", text: formatImport(result) }], details: result };
    },
  });
}

export function createTermbaseImportSdltbTool() {
  return defineTool<typeof termbaseImportSdltbParameters>({
    name: "termbase_import_sdltb",
    label: "Termbase Import SDLTB",
    description: "Import SDL MultiTerm .sdltb terminology through mdbtools into project termbase.json.",
    promptSnippet: "termbase_import_sdltb: import SDLTB binary termbases when mdbtools is installed.",
    promptGuidelines: [
      "Use this for .sdltb files only.",
      "If mdbtools is missing, report the exact fail-loud install instruction instead of pretending the file was read.",
      "Use append=true only when adding to an existing project termbase.",
    ],
    parameters: termbaseImportSdltbParameters,
    async execute(_toolCallId, params) {
      const result = await importSdltbTermbase(process.cwd(), params);
      return {
        content: [
          {
            type: "text",
            text: `${formatImport(result)}\nTables: ${result.sourceTable} -> ${result.targetTable}`,
          },
        ],
        details: result,
      };
    },
  });
}

export function createTermbaseLookupTool() {
  return defineTool<typeof termbaseLookupParameters>({
    name: "termbase_lookup",
    label: "Termbase Lookup",
    description: "Look up imported project termbase entries and their provenance/binding metadata by source term.",
    promptSnippet: "termbase_lookup: use imported TB/table terminology before term-sensitive T/E/P decisions.",
    promptGuidelines: [
      "Call termbase_lookup before changing or translating named terms.",
      "Follow the returned typed authority and scope. Do not promote a termbase row into a universal priority over another recorded project authority.",
      "Cite the returned Evidence line in proposal evidenceSources when claiming term/terminology authority.",
    ],
    parameters: termbaseLookupParameters,
    async execute(_toolCallId, params) {
      const matches = await lookupTermbase(process.cwd(), params);
      return { content: [{ type: "text", text: formatMatches(matches) }], details: { matches } };
    },
  });
}
