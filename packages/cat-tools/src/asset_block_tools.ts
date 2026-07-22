import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { buildAssetBlocks, buildAssetVectorIndex, buildAssetVectorIndexWithTdai, createWorkspace, probeTdaiEmbeddingBridge, readMemoryConfig, searchAssetBlocksWithReport } from "@linguist-agent/cat-data";

const assetBlocksBuildParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  buildVectorIndex: Type.Optional(Type.Boolean({ description: "Also build the asset vector candidate index.", default: true })),
  vectorBackend: Type.Optional(Type.String({ enum: ["local_e5", "tdai_embedding"], default: "local_e5", description: "local_e5 uses LA's pinned multilingual E5 managed pack; tdai_embedding is an optional legacy adapter." })),
});

const assetBlockSearchParameters = Type.Object({
  projectId: Type.String({ description: "Persisted LA project id." }),
  query: Type.String({ description: "Search query for indexed asset blocks." }),
  limit: Type.Optional(Type.Number({ default: 8, minimum: 1, maximum: 100 })),
  retrievalMode: Type.Optional(Type.String({ enum: ["lexical", "vector", "hybrid"], default: "hybrid", description: "hybrid keeps lexical evidence and adds vector candidates when the project index is ready." })),
});

export function createAssetBlocksBuildTool() {
  return defineTool<typeof assetBlocksBuildParameters>({
    name: "asset_blocks_build",
    label: "Build Asset Blocks",
    description: "Build searchable asset_blocks.jsonl from readable project reference/style/source assets.",
    promptSnippet: "asset_blocks_build: index readable project assets into block-level retrieval records.",
    promptGuidelines: [
      "Run asset_blocks_build after onboarding or after the user adds readable reference/style assets.",
      "Keep buildVectorIndex enabled for normal onboarding so hybrid recall is available; vectors are candidate records and do not replace asset_blocks.jsonl evidence.",
      "The default vector backend is LA's pinned multilingual E5 managed pack. If it is missing or corrupt, report lexical-only and ask the user to install or repair the pack; never disguise token hashing as semantic retrieval.",
      "This indexes readable md/txt/csv/tsv assets, deterministic DOCX/PPTX blocks, PDF text layers, and image OCR sidecars/metadata.",
      "For images without OCR sidecars, treat the indexed metadata block as a pointer for visual review, not as textual evidence.",
    ],
    parameters: assetBlocksBuildParameters,
    async execute(_toolCallId, params) {
      const report = await buildAssetBlocks(process.cwd(), params);
      const buildVectorIndexRequested = params.buildVectorIndex ?? true;
      const vectorBackend = params.vectorBackend ?? "local_e5";
      let vectorWarning: string | undefined;
      let vectorReport: Awaited<ReturnType<typeof buildAssetVectorIndex>> | Awaited<ReturnType<typeof buildAssetVectorIndexWithTdai>> | undefined;
      if (buildVectorIndexRequested) {
        if (vectorBackend === "local_e5") {
          try {
            vectorReport = await buildAssetVectorIndex(process.cwd(), { projectId: params.projectId });
          } catch (error) {
            vectorWarning = `${error instanceof Error ? error.message : String(error)} Semantic retrieval remains lexical-only.`;
          }
        } else {
          const memoryConfig = await readMemoryConfig(createWorkspace(process.cwd(), params.projectId));
          const gatewayUrl = memoryConfig?.gatewayUrl ?? "http://127.0.0.1:8420";
          const bridge = await probeTdaiEmbeddingBridge({ gatewayUrl, timeoutMs: 750 });
          if (bridge.state === "ready") {
            vectorReport = await buildAssetVectorIndexWithTdai(process.cwd(), { projectId: params.projectId, gatewayUrl });
          } else {
            vectorWarning = `TDAI embedding bridge unavailable (${bridge.state}${bridge.message ? `: ${bridge.message}` : ""}); semantic retrieval remains lexical-only.`;
          }
        }
      }
      return {
        content: [
          {
            type: "text",
            text: [
              `Asset blocks built: ${report.blocksWritten} blocks from ${report.assetsProcessed} assets.`,
              `Path: ${report.path}`,
              vectorWarning ? `Warning: ${vectorWarning}` : undefined,
              vectorReport ? `Asset vectors built: ${vectorReport.indexedBlocks} blocks with ${vectorReport.embeddingModel} (${vectorReport.backend}).` : undefined,
              report.skipped.length
                ? `Skipped:\n${report.skipped.map((item) => `- ${item.relPath}: ${item.reason}`).join("\n")}`
                : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        details: { ...report, vectorReport, vectorWarning },
      };
    },
  });
}

export function createAssetBlockSearchTool() {
  return defineTool<typeof assetBlockSearchParameters>({
    name: "asset_block_search",
    label: "Asset Block Search",
    description: "Search indexed asset blocks with file and line provenance.",
    promptSnippet: "asset_block_search: retrieve block-level evidence from indexed customer assets.",
    promptGuidelines: [
      "Use asset_block_search after asset_blocks_build for project-level reference evidence.",
      "Use lexical mode for exact client strings, tags, placeholders, numbers, IDs, and terminology-sensitive checks.",
      "Use hybrid mode only as candidate expansion; vector hits must still cite the rehydrated assetPath:lineNo text.",
      "Cite assetPath:lineNo when using a block as evidence.",
      "If no block matches, say so; do not fabricate asset evidence.",
    ],
    parameters: assetBlockSearchParameters,
    async execute(_toolCallId, params) {
      const report = await searchAssetBlocksWithReport(process.cwd(), {
        ...params,
        retrievalMode: (params.retrievalMode ?? "hybrid") as "lexical" | "vector" | "hybrid",
        embeddingGatewayUrl: (await readMemoryConfig(createWorkspace(process.cwd(), params.projectId))).gatewayUrl,
      });
      return {
        content: [
          {
            type: "text",
            text: [
              report.retrievalMode !== "lexical"
                ? `Semantic state: ${report.semanticState.state} (${report.semanticState.assetVectorIndex})`
                : undefined,
              report.hits.length
                ? report.hits.map((hit) => {
                    const semantic = hit.scoreBreakdown.semantic === undefined ? "" : ` semantic=${hit.scoreBreakdown.semantic.toFixed(2)}`;
                    return `- ${hit.assetPath}:${hit.lineNo} [${hit.blockType} ${hit.retrievalMode} score=${hit.score.toFixed(2)} lexical=${hit.scoreBreakdown.lexical.toFixed(2)}${semantic}] ${hit.text}`;
                  }).join("\n")
                : "No asset block hits found.",
            ].filter(Boolean).join("\n"),
          },
        ],
        details: report,
      };
    },
  });
}
