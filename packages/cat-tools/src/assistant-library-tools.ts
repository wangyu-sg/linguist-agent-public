import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  readLibraryCatalog,
  searchLibrary,
  type LibraryScope,
  type LibraryPersistence,
} from "@linguist-agent/cat-data";

const searchParameters = Type.Object({
  query: Type.String({ description: "Chinese or English query for explicitly imported Library documents." }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20, description: "Maximum cited blocks, default 8." })),
});

const listParameters = Type.Object({});

function location(hit: Awaited<ReturnType<typeof searchLibrary>>["hits"][number]): string {
  if (hit.page) return `page ${hit.page}`;
  if (hit.sheet) return `sheet ${hit.sheet}, row ${hit.lineNo}`;
  if (hit.slide) return `slide ${hit.slide}`;
  return `block ${hit.lineNo}`;
}

export function createAssistantLibraryTools(options: { runtimeRoot: string; scope: LibraryScope; includePersonal?: boolean; persistence?: LibraryPersistence }) {
  return [
    defineTool<typeof searchParameters>({
      name: "assistant_library_search",
      label: "Library Search",
      description: "Hybrid multilingual search over only documents the user explicitly imported. Returns resolvable managed-source citations.",
      promptSnippet: "Search explicitly imported Personal or Project Library documents",
      promptGuidelines: [
        "Use Library search when imported documents may answer the request.",
        "Preserve the returned filename, digest, and page/sheet/slide/block locator when citing a hit.",
        "Personal Library is recall context. In a Project Task, Project Library and approved client evidence have higher authority.",
      ],
      parameters: searchParameters,
      async execute(_id, params) {
        const report = await searchLibrary(options.runtimeRoot, {
          scope: options.scope,
          query: params.query,
          includePersonal: options.includePersonal,
          retrievalMode: "hybrid",
          limit: params.limit ?? 8,
          persistence: options.persistence,
        });
        const lines = report.hits.length
          ? report.hits.map((hit, index) => [
              `${index + 1}. [${hit.scope.kind}] ${hit.originalName} · ${location(hit)}`,
              `   digest=${hit.sourceDigest} parser=${hit.parserVersion ?? "unknown"} retrieval=${hit.retrievalMode}`,
              `   ${hit.text}`,
            ].join("\n"))
          : ["No matching Library blocks were found."];
        const state = report.semanticState.state === "ready"
          ? `semantic+lexical (${report.semanticState.embeddingModel ?? "managed local E5"})`
          : `${report.semanticState.state}${report.semanticState.message ? `: ${report.semanticState.message}` : ""}`;
        return {
          content: [{ type: "text" as const, text: [`Library retrieval: ${state}`, ...lines].join("\n") }],
          details: {
            scope: options.scope,
            semanticState: report.semanticState,
            citations: report.hits.map((hit) => ({
              blockId: hit.blockId,
              documentId: hit.documentId,
              sourceDigest: hit.sourceDigest,
              managedPath: hit.managedPath,
              page: hit.page,
              sheet: hit.sheet,
              slide: hit.slide,
              lineNo: hit.lineNo,
              parserVersion: hit.parserVersion,
            })),
          },
        };
      },
    }),
    defineTool<typeof listParameters>({
      name: "assistant_library_list",
      label: "Library List",
      description: "List the documents the user explicitly imported into the current Library scope.",
      promptSnippet: "List explicitly imported Library documents",
      parameters: listParameters,
      async execute() {
        const catalog = await readLibraryCatalog(options.runtimeRoot, options.scope, { persistence: options.persistence });
        const text = catalog.documents.length
          ? catalog.documents.map((document) => `- ${document.originalName} · ${document.blockCount} blocks · sha256:${document.sourceDigest}`).join("\n")
          : "No documents are imported in this Library scope.";
        return { content: [{ type: "text" as const, text }], details: { scope: options.scope, documentIds: catalog.documents.map((document) => document.id) } };
      },
    }),
  ];
}
