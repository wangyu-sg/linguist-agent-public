import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  assertCatCoreLegacyAllowed,
  assertCatGovernanceLegacyAllowed,
  assertWorkflowEvalLegacyAllowed,
  proposeAssistantMemory,
  readLibraryCatalog,
  structuredStorageStatus,
} from "@linguist-agent/cat-data";
import { listActivatedLapkgPackages } from "../packages/cat-server/src/lapkg_activation.js";
import { prepareSettingsGrantsTrustSqliteCutover } from "../packages/cat-server/src/settings_grants_trust_sqlite_cutover.js";

const authority = { assertOwned: async () => undefined };

type ParsedSource = {
  relativePath: string;
  source: ts.SourceFile;
};

async function parseSource(relativePath: string): Promise<ParsedSource> {
  const source = await (await import("node:fs/promises")).readFile(join(process.cwd(), relativePath), "utf8");
  return {
    relativePath,
    source: ts.createSourceFile(relativePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS),
  };
}

function callName(node: ts.CallExpression): string | null {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return null;
}

function callsIn(node: ts.Node, expectedName: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && callName(candidate) === expectedName) calls.push(candidate);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return calls;
}

function namedFunction(source: ts.SourceFile, expectedName: string): ts.FunctionDeclaration | ts.MethodDeclaration {
  let match: ts.FunctionDeclaration | ts.MethodDeclaration | undefined;
  const visit = (candidate: ts.Node): void => {
    if (match) return;
    if (ts.isFunctionDeclaration(candidate) && candidate.name?.text === expectedName) {
      match = candidate;
      return;
    }
    if (ts.isMethodDeclaration(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === expectedName) {
      match = candidate;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(source);
  assert.ok(match, `${source.fileName} must retain the ${expectedName} legacy compatibility boundary`);
  return match!;
}

function assertWriterGuarded(
  parsed: ParsedSource,
  functionName: string,
  guardName: string,
  writerName: string,
): void {
  const boundary = namedFunction(parsed.source, functionName);
  const guards = callsIn(boundary, guardName);
  const writers = callsIn(boundary, writerName);
  assert.ok(writers.length > 0, `${parsed.relativePath}::${functionName} must retain its ${writerName} legacy writer characterization`);
  for (const writer of writers) {
    assert.ok(
      guards.some((guard) => guard.getStart(parsed.source) < writer.getStart(parsed.source)),
      `${parsed.relativePath}::${functionName} must deny legacy authority before ${writerName}`,
    );
  }
}

function assertSingleStartupPrepare(server: ParsedSource, prepareName: string, listenBoundary: number): void {
  const calls = callsIn(server.source, prepareName);
  assert.equal(calls.length, 1, `server must have one ${prepareName} startup owner`);
  assert.ok(calls[0]!.getStart(server.source) < listenBoundary, `${prepareName} must complete before the transport can exist`);
}

const server = await parseSource("packages/cat-server/src/server.ts");
const createServer = callsIn(server.source, "createServer");
assert.equal(createServer.length, 1, "server must create one local transport listener");
const listenBoundary = createServer[0]!.getStart(server.source);
for (const prepareName of [
  "prepareSettingsGrantsTrustSqliteCutover",
  "prepareLapkgSqliteCutover",
  "prepareAssistantMemorySqliteCutover",
  "prepareAssistantLibrarySqliteCutover",
  "prepareCatCoreSqliteCutover",
  "prepareCatGovernanceSqliteCutover",
  "prepareWorkflowEvalSqliteCutover",
]) {
  assertSingleStartupPrepare(server, prepareName, listenBoundary);
}

const guardedWriters: Array<[string, string, string, string]> = [
  ["packages/cat-data/src/assistant_memory.ts", "writeFile", "assertLegacyAuthorityAvailable", "writeJsonFile"],
  ["packages/cat-data/src/assistant_library.ts", "legacyLibraryPersistence", "assertLegacyAuthorityAvailable", "writeJsonFile"],
  ["packages/cat-data/src/project_manifest.ts", "writeProjectManifest", "assertCatCoreLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/batch_workspace.ts", "writeBatch", "assertCatCoreLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/tm.ts", "writeEntries", "assertCatCoreLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/termbase.ts", "writeTermbaseEntries", "assertCatCoreLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/termbase.ts", "writeTermbaseOverrides", "assertCatCoreLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/proposals.ts", "createProposalSet", "assertCatGovernanceLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/proposals.ts", "applyProposalSet", "assertCatGovernanceLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/quality_checklist.ts", "writeQualityChecklist", "assertCatGovernanceLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/quality_decision_ledger.ts", "appendQualityDecisionLedgerInputs", "assertCatGovernanceLegacyAllowed", "appendDurableFile"],
  ["packages/cat-data/src/delivery.ts", "appendExportAudit", "assertCatGovernanceLegacyAllowed", "appendFile"],
  ["packages/cat-data/src/workflow_plan.ts", "writeStoredWorkflow", "assertWorkflowEvalLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/workflow_artifacts.ts", "writeWorkflowArtifactsUnlocked", "assertWorkflowEvalLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/private_eval.ts", "writeEvalRecord", "assertWorkflowEvalLegacyAllowed", "writeJsonFile"],
  ["packages/cat-data/src/private_eval.ts", "writeEvalRows", "assertWorkflowEvalLegacyAllowed", "writeJsonl"],
];
for (const [relativePath, functionName, guardName, writerName] of guardedWriters) {
  assertWriterGuarded(await parseSource(relativePath), functionName, guardName, writerName);
}

const lapkg = await parseSource("packages/cat-server/src/lapkg_activation.ts");
assertWriterGuarded(lapkg, "listActivatedLapkgPackages", "lapkgSqliteMarkerPath", "lapkgRegistryPath");
assertWriterGuarded(lapkg, "activateLapkg", "listActivatedLapkgPackages", "writeRegistryAtomic");
const settingsCutover = await parseSource("packages/cat-server/src/settings_grants_trust_sqlite_cutover.ts");
assertWriterGuarded(settingsCutover, "prepareSettingsGrantsTrustSqliteCutover", "prepareSqliteSettingsGrantsTrustCutover", "installStructuredStorageBackend");

const root = await mkdtemp(join(tmpdir(), "la-025-legacy-writer-gate-"));
const markerPaths = [
  "data/runtime/package-registry-sqlite-v1/authority-v1.json",
  "data/runtime/assistant-memory-sqlite-v1/authority-v1.json",
  "data/runtime/assistant-library-sqlite-v1/authority-v1.json",
  "data/runtime/cat-core-sqlite-v1/authority-v1.json",
  "data/runtime/cat-governance-sqlite-v1/authority-v1.json",
  "data/runtime/workflow-eval-sqlite-v1/authority-v1.json",
];

try {
  for (const relativePath of markerPaths) {
    const markerPath = join(root, relativePath);
    await mkdir(join(markerPath, ".."), { recursive: true });
    await writeFile(markerPath, "{\"authority\":\"sqlite\"}\n");
  }

  await assert.rejects(
    listActivatedLapkgPackages(root),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "LAPKG_RECOVERY_REQUIRED",
    "Package legacy registry reads must fail closed after the SQLite marker",
  );
  await assert.rejects(
    proposeAssistantMemory(root, {
      scope: { kind: "personal" },
      kind: "fact",
      text: "Synthetic legacy writer denial",
      source: { taskId: "synthetic-task" },
    }),
    /authoritative/u,
  );
  await assert.rejects(readLibraryCatalog(root, { kind: "personal" }), /authoritative/u);
  await assert.rejects(assertCatCoreLegacyAllowed(root), /authoritative/u);
  await assert.rejects(assertCatGovernanceLegacyAllowed(root), /authoritative/u);
  await assert.rejects(assertWorkflowEvalLegacyAllowed(root), /authoritative/u);

  const settingsRoot = await mkdtemp(join(tmpdir(), "la-025-settings-authority-"));
  try {
    const prepared = await prepareSettingsGrantsTrustSqliteCutover({
      repoRoot: settingsRoot,
      authority,
      activeRunCount: 0,
      piAgentDir: join(settingsRoot, "pi-agent"),
      now: () => new Date("2026-07-23T00:00:00.000Z"),
    });
    assert.deepEqual(structuredStorageStatus(), { authority: "installed", root: resolve(settingsRoot) });
    prepared.close();
  } finally {
    await rm(settingsRoot, { recursive: true, force: true });
  }

  console.log("LA-025 legacy writer authority gate passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
