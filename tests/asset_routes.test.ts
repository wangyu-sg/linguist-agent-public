import assert from "node:assert/strict";
import { handleAssetRoute } from "../packages/cat-server/src/routes/asset_routes.js";

function req(method: string, url = "/api/projects/proj/assets"): any {
  return { method, url };
}

function out() {
  let status = 0;
  let body: any;
  return {
    res: {} as any,
    json: (_res: unknown, nextStatus: number, data: unknown) => {
      status = nextStatus;
      body = data;
    },
    get status() {
      return status;
    },
    get body() {
      return body;
    },
  };
}

const deps: any = {
  repoRoot: "/repo",
  readBody: async () => ({}),
  requireString: (value: unknown, label: string) => {
    if (typeof value !== "string" || !value) throw new Error(`${label} is required`);
    return value;
  },
  optionalString: (value: unknown) => (typeof value === "string" ? value : undefined),
  optionalBoolean: (value: unknown) => (typeof value === "boolean" ? value : undefined),
  readProjectManifest: async () => ({
    scan: {
      assets: [
        {
          relPath: "style.md",
          role: "styleguide",
          reasons: ["manual"],
          sizeBytes: 512,
        },
      ],
    },
    assetRoleDecisions: [],
  }),
  planWorkbookAssetImport: async () => ({}),
  importWorkbookAssetPlan: async () => ({}),
  parseAsset: async () => ({}),
  suggestAssetMappings: async () => ({}),
  parseWorkbookTypedAsset: async () => ({}),
  readAssetTypedIndex: async () => ({
    assetPath: "refs.xlsx",
    rows: [
      {
        id: "typed-1",
        kind: "reference",
        assetPath: "refs.xlsx",
        rowNo: 4,
        source: "战旗说明",
        target: "War Banner note",
        role: "reference",
        sheetName: "Sheet1",
      },
    ],
  }),
  confirmTypedAssetCandidates: async () => ({}),
  readAssetMappingProfiles: async () => ({}),
  saveAssetMappingProfile: async () => ({}),
  readTermHistoryIndex: async () => ({}),
  readTermbaseEntries: async () => [
    {
      id: "term-1",
      source: "战旗",
      target: "War Banner",
      sourceFile: "terms.xlsx",
      rowNo: 2,
      sheetName: "Terms",
      origin: "client",
    },
  ],
  readTermbaseOverrides: async () => [],
  auditTermbaseConflicts: () => [],
  upsertTermbaseOverride: async () => ({}),
  grepAssets: async (_repoRoot: string, input: { query: string; limit?: number }) => [
    { relPath: "style.md", lineNo: 7, text: `hit:${input.query}:${input.limit}` },
  ],
  readAssetText: async (_repoRoot: string, input: { assetPath: string; maxChars?: number }) => ({
    relPath: input.assetPath,
    text: `read:${input.maxChars}`,
    truncated: false,
  }),
  readWorkbookNativePreview: async (_repoRoot: string, input: { assetPath: string }) => ({
    assetPath: input.assetPath,
    sheets: [{ sheetName: "Terms", rowCount: 5000, columnCount: 2, headers: ["中文", "English"], mergedRanges: [], columnWidths: [12, 18], rowHeights: {} }],
  }),
  readWorkbookSheetPage: async (_repoRoot: string, input: { assetPath: string; sheetName?: string; offset?: number; limit?: number }) => ({
    assetPath: input.assetPath,
    sheetName: input.sheetName,
    offset: input.offset,
    limit: input.limit,
    rowCount: 5000,
    columnCount: 2,
    headers: ["中文", "English"],
    rows: [{ rowNo: (input.offset ?? 0) + 1, cells: [{ value: "龙", displayValue: "龙" }, { value: "Dragon", displayValue: "Dragon" }] }],
    hasMore: true,
    mergedRanges: [],
    columnWidths: [12, 18],
    rowHeights: {},
  }),
};

{
  const response = out();
  assert.equal(
    await handleAssetRoute(
      req("GET", "/api/projects/proj/assets/search?q=战旗&limit=12"),
      response.res,
      ["api", "projects", "proj", "assets", "search"],
      "proj",
      { ...deps, json: response.json },
    ),
    true,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.query, "战旗");
  assert.equal(response.body.hits[0].text, "hit:战旗:12");
  assert.equal(response.body.sources[0].relPath, "style.md");
  assert.equal(response.body.groups.find((group: any) => group.id === "files").hits[0].kind, "file");
  assert.equal(response.body.groups.find((group: any) => group.id === "termbase").hits[0].target, "War Banner");
  assert.equal(response.body.groups.find((group: any) => group.id === "typed").hits[0].target, "War Banner note");
}

{
  const response = out();
  assert.equal(
    await handleAssetRoute(
      req("GET", "/api/projects/proj/assets/read?path=refs%2Fguide.md&maxChars=1000"),
      response.res,
      ["api", "projects", "proj", "assets", "read"],
      "proj",
      { ...deps, json: response.json },
    ),
    true,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.relPath, "refs/guide.md");
  assert.equal(response.body.text, "read:1000");
}

{
  const response = out();
  assert.equal(
    await handleAssetRoute(
      req("GET", "/api/projects/proj/assets/workbook-preview?path=terms.xlsx"),
      response.res,
      ["api", "projects", "proj", "assets", "workbook-preview"],
      "proj",
      { ...deps, json: response.json },
    ),
    true,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.sheets[0].rowCount, 5000);
}

{
  const response = out();
  assert.equal(
    await handleAssetRoute(
      req("GET", "/api/projects/proj/assets/workbook-rows?path=terms.xlsx&sheetName=Terms&offset=400&limit=200"),
      response.res,
      ["api", "projects", "proj", "assets", "workbook-rows"],
      "proj",
      { ...deps, json: response.json },
    ),
    true,
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.sheetName, "Terms");
  assert.equal(response.body.rows[0].rowNo, 401);
}

console.log("asset_routes tests passed");
