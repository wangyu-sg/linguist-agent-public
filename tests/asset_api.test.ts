import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import JSZip from "jszip";
import { parseWorkbookTypedAsset, suggestAssetMappings as suggestAssetMappingsDirect } from "@linguist-agent/cat-data";

const repoRoot = new URL("..", import.meta.url).pathname;
const port = 8902;
const base = `http://127.0.0.1:${port}`;
const projectId = `codex-asset-api-${Date.now()}`;
const apiToken = "asset-api-test-token";

function apiFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiToken}`);
  return fetch(input, { ...init, headers });
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function writeMultiSheetXlsx(path: string, sheets: Array<{ name: string; rows: string[][] }>): Promise<void> {
  const zip = new JSZip();
  const strings: string[] = [];
  const indexFor = (value: string) => {
    let index = strings.indexOf(value);
    if (index < 0) {
      strings.push(value);
      index = strings.length - 1;
    }
    return index;
  };
  const colName = (index: number) => String.fromCharCode(65 + index);
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const sheetRows = sheet.rows
      .map(
        (row, rowIndex) =>
          `<row r="${rowIndex + 1}">${row
            .map((cell, colIndex) => `<c r="${colName(colIndex)}${rowIndex + 1}" t="s"><v>${indexFor(cell)}</v></c>`)
            .join("")}</row>`,
      )
      .join("");
    zip.file(
      `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    );
  }
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((value) => `<si><t>${xmlEscape(value)}</t></si>`)
      .join("")}</sst>`,
  );
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

async function addExternalHyperlink(path: string): Promise<void> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const relsPath = "xl/worksheets/_rels/sheet1.xml.rels";
  zip.file(relsPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdBad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://同时，本身有独立维护的TB：CSH05157_IEG_OS_SC-EN.xlsx" TargetMode="External"/></Relationships>`);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const sheetXml = await zip.file(sheetPath)?.async("string") ?? "";
  zip.file(sheetPath, sheetXml.replace("</worksheet>", `<hyperlinks><hyperlink ref="A1" r:id="rIdBad"/></hyperlinks></worksheet>`));
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
}

function startServer(): ChildProcess {
  return spawn("npm", ["run", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LA_SERVER_PORT: String(port),
      LA_LOCAL_API_TOKEN: apiToken,
      LA_MODEL_PROVIDER: "__asset_api_test_provider__",
      LA_MODEL_ID: "__asset_api_test_model__",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
}

function stopServer(server: ChildProcess): void {
  server.stdout?.destroy();
  server.stderr?.destroy();
  try {
    if (server.pid) process.kill(-server.pid, "SIGTERM");
  } catch {
    if (!server.killed) server.kill("SIGTERM");
  }
}

async function ok(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(750) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await ok(`${base}/api/health`)) return;
    await sleep(250);
  }
  throw new Error("asset API test server did not become ready");
}

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await apiFetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

const projectRoot = await mkdtemp(join(tmpdir(), "la-asset-api-"));
const workbookPath = join(projectRoot, "os-assets.xlsx");
const hyperlinkedWorkbookPath = join(projectRoot, "hyperlinked-assets.xlsx");
const mxliffPath = join(projectRoot, "ops.mxliff");
const fakeMineruPath = join(projectRoot, "fake-mineru.mjs");
const mxliffFixture = `<?xml version="1.0"?>
<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file original="ops.xliff" source-language="zh-cn" target-language="en-us"><body>
  <group id="1" m:para-id="1"><context-group><context context-type="x-key">1001</context></context-group>
    <trans-unit id="job:1" m:para-id="1" m:locked="false"><source>&lt;u&gt;名称&lt;/u&gt;</source><target>&lt;u&gt;Name&lt;/u&gt;</target></trans-unit>
  </group>
</body></file></xliff>`;
await writeFile(mxliffPath, mxliffFixture, "utf8");
await writeMultiSheetXlsx(workbookPath, [
  {
    name: "归档术语表 Archived Terms",
    rows: [
      ["Terms - CN\n术语 - 中文", "Terms - EN\n术语 - 英文", "Description&Notes\n描述与备注 - 英语"],
      ["赤焰擂台", "Crimson Ring", "archived preferred"],
      ["赤焰擂台", "Crimson Arena", "stale conflicting row"],
    ],
  },
  {
    name: "项目说明 Style Guide",
    rows: [
      ["Rule", "Detail"],
      ["Currency", "Use Diamond x50 format."],
    ],
  },
  {
    name: "术语变更新增 Term Change Log",
    rows: [
      ["类型\nType", "术语 - 改前原文\nTerm - Old Source", "术语 - 改后原文\nTerm - New Source", "术语 - 改前译文\nTerm - Old Target", "术语 - 改后译文\nTerm - New Target", "最终确认\nFinal Confirm"],
      ["Change 变更", "小星灵", "", "Stella", "Little Stella", "Approved 已监修"],
      ["Change 变更", "闪现", "", "Leap", "Flash", ""],
    ],
  },
]);
await writeMultiSheetXlsx(hyperlinkedWorkbookPath, [
  {
    name: "Terms",
    rows: [
      ["Source", "Target"],
      ["赤焰擂台", "Crimson Ring"],
    ],
  },
]);
await addExternalHyperlink(hyperlinkedWorkbookPath);
await writeFile(fakeMineruPath, `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { default: JSZip } = await import(${JSON.stringify(new URL("../node_modules/jszip/lib/index.js", import.meta.url).href)});
const inputIndex = process.argv.indexOf("-p");
const input = inputIndex >= 0 ? process.argv[inputIndex + 1] : "";
if (input.endsWith(".xlsx")) {
  const zip = await JSZip.loadAsync(readFileSync(input));
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith(".rels")) continue;
    const xml = await zip.files[name].async("string");
    if (xml.includes("relationships/hyperlink")) {
      console.error("fake mineru received unnormalized hyperlink relationship");
      process.exit(42);
    }
  }
}
const outIndex = process.argv.indexOf("-o");
const output = outIndex >= 0 ? process.argv[outIndex + 1] : "";
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "mineru.md"), [
  "# MinerU parse",
  "",
  "| Source | Target | Note |",
  "| --- | --- | --- |",
  "| 赤焰擂台 | Crimson Ring | mineru table |",
  "",
  "Reference paragraph from MinerU.",
  ...Array.from({ length: 505 }, (_, index) => ["", "Synthetic MinerU block " + (index + 1)]).flat(),
].join("\\n"), "utf8");
`, "utf8");
await chmod(fakeMineruPath, 0o755);

const server = startServer();
try {
  await waitForServer();
  const onboard = await post("/api/projects", { rootPath: projectRoot, projectId, sourceLanguage: "zh-CN", targetLanguage: "en-US" });
  assert.equal(onboard.status, 200);
  const importedBatch = await post("/api/projects/import-upload", {
    projectId,
    batchId: "ops-batch",
    fileName: "ops.mxliff",
    fileDataBase64: (await readFile(mxliffPath)).toString("base64"),
  });
  assert.equal(importedBatch.status, 200);

  const workflowArtifacts = await apiFetch(`${base}/api/projects/${encodeURIComponent(projectId)}/workflow-artifacts`).then((res) => res.json()) as {
    projectId: string;
    reviewFindings: unknown[];
    phraseQaRows: unknown[];
    riskQueue: unknown[];
  };
  assert.equal(workflowArtifacts.projectId, projectId);
  assert.equal(workflowArtifacts.reviewFindings.length, 0);
  assert.equal(workflowArtifacts.phraseQaRows.length, 0);
  assert.equal(workflowArtifacts.riskQueue.length, 0);

  const backfillRun = await post(`/api/projects/${encodeURIComponent(projectId)}/workflow-artifacts/run-backfill`, {
    rows: [{ id: "bf-api", batchId: "ops-batch", segmentId: "job:1", target: "<u>Hero Name</u>", expectedCurrentTarget: "<u>Name</u>" }],
    currentTargets: { "job:1": "<u>Name</u>" },
    readbackTargets: { "job:1": "<u>Hero Name</u>" },
  });
  assert.equal(backfillRun.status, 200);
  assert.equal(((backfillRun.json.run as Record<string, unknown>).verified), 1);
  assert.equal(((backfillRun.json.artifacts as { backfillRows: Array<{ id: string; state: string }> }).backfillRows).some((row) => row.id === "bf-api" && row.state === "readback_verified"), true);

  const qaRun = await post(`/api/projects/${encodeURIComponent(projectId)}/workflow-artifacts/run-phrase-qa`, {
    captures: [{
      hasLoadMore: false,
      rows: [
        { id: "qa-api-1", segmentId: "job:1", category: "Unconfirmed", message: "未确认句段", evidence: "API captured QA row" },
      ],
    }],
  });
  assert.equal(qaRun.status, 200);
  assert.equal(((qaRun.json.run as Record<string, unknown>).hasLoadMore), false);
  assert.equal(((qaRun.json.artifacts as { phraseQaRows: Array<{ id: string; disposition: string }> }).phraseQaRows).some((row) => row.id === "qa-api-1" && row.disposition === "retained_unconfirmed"), true);

  const catalog = await apiFetch(`${base}/api/projects/${encodeURIComponent(projectId)}/assets`).then((res) => res.json()) as {
    assets: Array<{ relPath: string; kind: string }>;
  };
  assert.equal(catalog.assets.some((asset) => asset.relPath === "os-assets.xlsx" && asset.kind === "workbook"), true);

  const structuredPreview = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/parse-preview`, {
    assetPath: "os-assets.xlsx",
    mode: "structured",
    sampleRows: 4,
  });
  assert.equal(structuredPreview.status, 200);
  assert.equal((((structuredPreview.json.structuredPreview as Record<string, unknown>).structuredSheets as unknown[])).length, 3);

  const dualPreview = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/parse-compare`, {
    assetPath: "os-assets.xlsx",
    mineruCommand: fakeMineruPath,
    sampleRows: 4,
  });
  assert.equal(dualPreview.status, 200);
  assert.equal((dualPreview.json.comparison as { mineruStatus: string }).mineruStatus, "ready");
  assert.equal((dualPreview.json.comparison as { mineruTableBlockCount: number }).mineruTableBlockCount >= 1, true);
  assert.equal((dualPreview.json.comparison as { mineruBlockCount: number }).mineruBlockCount > 500, true, "MinerU parsing must not silently discard blocks after an arbitrary count");

  const hyperlinkedDualPreview = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/parse-compare`, {
    assetPath: "hyperlinked-assets.xlsx",
    mineruCommand: fakeMineruPath,
    sampleRows: 4,
  });
  assert.equal(hyperlinkedDualPreview.status, 200);
  assert.equal((hyperlinkedDualPreview.json.comparison as { mineruStatus: string }).mineruStatus, "ready");
  assert.equal(((hyperlinkedDualPreview.json.mineruPreview as { warnings: string[] }).warnings).some((warning) => warning.includes("removed 1 external workbook hyperlink")), true);

  const missingMineruPreview = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/parse-compare`, {
    assetPath: "os-assets.xlsx",
    mineruCommand: join(projectRoot, "missing-mineru"),
    sampleRows: 4,
  });
  assert.equal(missingMineruPreview.status, 200);
  assert.equal((missingMineruPreview.json.comparison as { mineruStatus: string }).mineruStatus, "unavailable");
  assert.equal(((missingMineruPreview.json.comparison as { warnings: string[] }).warnings).some((warning) => warning.includes("ENOENT")), false);

  const mappingSuggestions = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/mapping-suggestions`, {
    assetPath: "os-assets.xlsx",
    mode: "structured",
    purpose: "termbase",
  });
  assert.equal(mappingSuggestions.status, 200);
  assert.equal((mappingSuggestions.json as { assistantStatus: string }).assistantStatus, "not_configured");
  assert.equal(((mappingSuggestions.json as { warnings: string[] }).warnings).some((warning) =>
    warning.includes("LA_WORKBOOK_MAPPING_LLM_COMMAND")
  ), false);
  const suggestions = (mappingSuggestions.json as { suggestions: Array<Record<string, unknown>> }).suggestions;
  assert.equal(suggestions.some((suggestion) => suggestion.sheetName === "归档术语表 Archived Terms"), true);

  const providerSuggestions = await suggestAssetMappingsDirect(repoRoot, {
    projectId,
    assetPath: "os-assets.xlsx",
    mode: "structured",
    purpose: "termbase",
    assistantModel: "test/global-provider",
    askModel: async ({ prompt }) => {
      assert.match(prompt, /归档术语表 Archived Terms/);
      return `\`\`\`json\n${JSON.stringify({
        suggestions: [{
          sheetName: "归档术语表 Archived Terms",
          sourceColumn: "Terms - CN\n术语 - 中文",
          targetColumn: "Terms - EN\n术语 - 英文",
          noteColumn: "Description&Notes\n描述与备注 - 英语",
          role: "termbase",
          action: "import_terms",
          confidence: 0.91,
          reason: "Provider-selected mapping.",
        }],
      })}\n\`\`\``;
    },
  });
  assert.equal(providerSuggestions.assistantStatus, "ready");
  assert.equal(providerSuggestions.assistantModel, "test/global-provider");
  assert.equal(providerSuggestions.suggestions.some((suggestion) =>
    suggestion.source === "llm" && suggestion.reason === "Provider-selected mapping."
  ), true);

  const referenceProviderSuggestions = await suggestAssetMappingsDirect(repoRoot, {
    projectId,
    assetPath: "os-assets.xlsx",
    mode: "structured",
    purpose: "reference",
    assistantModel: "test/global-provider",
    askModel: async () => JSON.stringify({
      suggestions: [{
        sheetName: "项目说明 Style Guide",
        role: "style_guide",
        action: "index_reference",
        confidence: 0.88,
        reason: "Index whole style guide sheet.",
      }],
    }),
  });
  assert.equal(referenceProviderSuggestions.assistantStatus, "ready");
  assert.equal(referenceProviderSuggestions.suggestions.some((suggestion) =>
    suggestion.source === "llm" &&
    suggestion.sheetName === "项目说明 Style Guide" &&
    suggestion.role === "style_guide" &&
    suggestion.action === "index_reference" &&
    suggestion.sourceColumn == null &&
    suggestion.targetColumn == null
  ), true);

  const typedPreview = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/typed-preview`, {
    assetPath: "os-assets.xlsx",
    llmAssisted: false,
  });
  assert.equal(typedPreview.status, 200);
  assert.equal((typedPreview.json.summary as { typedRows: number }).typedRows, 5);
  assert.equal((typedPreview.json.summary as { candidateRows: number }).candidateRows, 4);
  assert.equal((typedPreview.json.summary as { referenceRows: number }).referenceRows, 1);
  assert.equal((typedPreview.json.rows as Array<{ kind: string }>).some((row) => row.kind === "style_guide"), true);

  const rejectedTypedLlm = await parseWorkbookTypedAsset(repoRoot, {
    projectId,
    assetPath: "os-assets.xlsx",
    askModel: async () => JSON.stringify({
      rows: [
        { sheetName: "Fake Sheet", rowNo: 999, kind: "term_candidate", fields: { Source: "fake" }, text: "fake", confidence: 0.99 },
        { sheetName: "项目说明 Style Guide", rowNo: 2, kind: "term_candidate", fields: { Source: "Currency" }, text: "fabricated term row", confidence: 0.99 },
      ],
    }),
  });
  assert.equal(rejectedTypedLlm.rows.some((row) => row.extractionSource === "llm"), false);

  const firstMapping = suggestions.find((suggestion) => suggestion.sheetName === "归档术语表 Archived Terms");
  assert.ok(firstMapping);
  const savedProfile = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/mapping-profiles`, {
    assetPath: "os-assets.xlsx",
    parseMode: "structured",
    confirmedMappings: [firstMapping],
    parserEvidence: {
      structured: {
        status: "ready",
        generatedAt: new Date().toISOString(),
        warnings: [],
        sheetCount: 3,
      },
    },
    llmAssisted: false,
    confirmedBy: "asset-api-test",
  });
  assert.equal(savedProfile.status, 200);
  const savedProfileId = ((savedProfile.json.profile as Record<string, unknown>).id) as string;
  assert.equal(typeof savedProfileId, "string");
  const profiles = await apiFetch(`${base}/api/projects/${encodeURIComponent(projectId)}/assets/mapping-profiles`).then((res) => res.json()) as {
    profiles: Array<{ id: string; confirmedMappings: unknown[] }>;
  };
  assert.equal(profiles.profiles.some((profile) => profile.id === savedProfileId && profile.confirmedMappings.length === 1), true);

  const plan = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/workbook-plan`, { assetPath: "os-assets.xlsx" });
  assert.equal(plan.status, 200);
  assert.equal((plan.json.summary as { importableTermRows: number }).importableTermRows, 2);
  assert.equal((plan.json.summary as { referenceBlocks: number }).referenceBlocks, 2);
  assert.equal((plan.json.summary as { needsResolution: number }).needsResolution, 1);
  assert.equal(
    (plan.json.sheets as Array<{ sheetName: string; role: string }>).find((sheet) => sheet.sheetName === "项目说明 Style Guide")?.role,
    "style_guide"
  );

  const overriddenPlan = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/workbook-plan`, {
    assetPath: "os-assets.xlsx",
    sheetOverrides: [{ sheetName: "归档术语表 Archived Terms", role: "reference", reason: "Treat noisy sheet as searchable reference." }],
  });
  assert.equal(overriddenPlan.status, 200);
  assert.equal((overriddenPlan.json.summary as { importableTermRows: number }).importableTermRows, 0);
  assert.equal((overriddenPlan.json.summary as { referenceBlocks: number }).referenceBlocks, 3);

  const mappedPlan = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/workbook-plan`, {
    assetPath: "os-assets.xlsx",
    parseMode: "structured",
    mappingProfileId: savedProfileId,
    confirmedMappings: [firstMapping],
  });
  assert.equal(mappedPlan.status, 200);
  assert.equal((mappedPlan.json as { mappingProfileId: string }).mappingProfileId, savedProfileId);
  assert.equal((mappedPlan.json.summary as { importableTermRows: number }).importableTermRows, 2);

  const imported = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/workbook-import`, { assetPath: "os-assets.xlsx" });
  assert.equal(imported.status, 200);
  assert.equal(imported.json.importedTerms, 0);
  assert.equal(imported.json.importedTermHistoryRows, 0);
  assert.equal(imported.json.typedRowsWritten, 5);
  assert.equal(imported.json.candidateRowsWritten, 4);
  assert.equal(imported.json.writtenReferenceBlocks, 1);

  const typedIndex = await apiFetch(`${base}/api/projects/${encodeURIComponent(projectId)}/assets/typed-index`).then((res) => res.json()) as {
    rows: Array<{ id: string; kind: string }>;
    summary: { candidateRows: number; referenceRows: number };
  };
  assert.equal(typedIndex.summary.candidateRows, 4);
  assert.equal(typedIndex.summary.referenceRows, 1);
  const candidateIds = typedIndex.rows.filter((row) => row.kind === "term_candidate" || row.kind === "term_history_candidate").map((row) => row.id);
  const confirmedTyped = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/typed-confirm`, {
    candidateIds,
    append: true,
  });
  assert.equal(confirmedTyped.status, 200);
  assert.equal(confirmedTyped.json.confirmedTermRows, 2);
  assert.equal(confirmedTyped.json.confirmedTermHistoryRows, 2);

  const history = await apiFetch(`${base}/api/projects/${encodeURIComponent(projectId)}/assets/term-history`).then((res) => res.json()) as {
    rows: Array<{ oldSource?: string; newTarget?: string }>;
    decisions: Array<{ source: string; status: string; target?: string }>;
  };
  assert.equal(history.rows.length, 2);
  assert.equal(history.decisions.some((decision) => decision.source === "小星灵" && decision.status === "current" && decision.target === "Little Stella"), true);
  assert.equal(history.decisions.some((decision) => decision.source === "闪现" && decision.status === "unconfirmed_later_row" && decision.target === "Flash"), true);

  const conflictsBefore = await apiFetch(`${base}/api/projects/${encodeURIComponent(projectId)}/assets/termbase-conflicts`).then((res) => res.json()) as {
    conflicts: Array<{ source: string; targets: string[] }>;
  };
  assert.equal(conflictsBefore.conflicts.some((conflict) => conflict.source === "赤焰擂台" && conflict.targets.length === 2), true);

  const override = await post(`/api/projects/${encodeURIComponent(projectId)}/assets/termbase-overrides`, {
    source: "赤焰擂台",
    target: "Crimson Ring",
    reason: "Synthetic reviewed correction.",
    decidedBy: "LA smoke",
  });
  assert.equal(override.status, 200);

  const conflictsAfter = await apiFetch(`${base}/api/projects/${encodeURIComponent(projectId)}/assets/termbase-conflicts`).then((res) => res.json()) as {
    conflicts: Array<{ source: string }>;
    overrideCount: number;
  };
  assert.equal(conflictsAfter.overrideCount, 1);
  assert.equal(conflictsAfter.conflicts.some((conflict) => conflict.source === "赤焰擂台"), false);
} finally {
  stopServer(server);
  await rm(projectRoot, { recursive: true, force: true });
  await rm(join(repoRoot, "data", "projects", projectId), { recursive: true, force: true });
}

console.log("asset_api tests passed");
