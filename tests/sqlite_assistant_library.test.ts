import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importLibraryDocuments,
  libraryCatalogPath,
  libraryScopeRoot,
  parseLibraryMetadataFile,
  readLibraryCatalog,
  reindexLibrary,
  searchLibrary,
  type LibraryScope,
} from "@linguist-agent/cat-data";
import {
  prepareAssistantLibrarySqliteCutover,
  type AssistantLibrarySqliteAuthority,
} from "../packages/cat-server/src/assistant_library_sqlite_cutover.js";

const root = await mkdtemp(join(tmpdir(), "la-sqlite-assistant-library-"));
const authority: AssistantLibrarySqliteAuthority = { assertOwned: async () => undefined };
const personal: LibraryScope = { kind: "personal" };
const project: LibraryScope = { kind: "project", projectId: "project-a" };
const firstSource = join(root, "fixtures", "glossary.md");
const secondSource = join(root, "fixtures", "glossary-copy.md");

function digest(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

try {
  const bytes = Buffer.from("# Glossary\n\nMoonblade\n", "utf8");
  await mkdir(join(root, "fixtures"), { recursive: true });
  await writeFile(firstSource, bytes);
  await writeFile(secondSource, bytes);

  await importLibraryDocuments(root, { scope: personal, sourcePaths: [firstSource], semantic: false });
  await importLibraryDocuments(root, { scope: project, sourcePaths: [secondSource], semantic: false });
  const legacyPersonal = await readLibraryCatalog(root, personal);
  const legacyProject = await readLibraryCatalog(root, project);
  assert.equal(legacyPersonal.documents[0]?.sourceDigest, digest(bytes));
  assert.equal(legacyProject.documents[0]?.sourceDigest, digest(bytes));

  const prepared = await prepareAssistantLibrarySqliteCutover({ root, authority, activeRunCount: 0 });
  assert.equal(prepared.status, "cutover");
  assert.equal(prepared.marker.authority, "sqlite");
  assert.equal(prepared.marker.scopes.length, 2);
  assert.equal(prepared.marker.excludes.includes("semantic-index"), true);

  assert.deepEqual(await readLibraryCatalog(root, personal, { persistence: prepared.persistence }), legacyPersonal);
  assert.deepEqual(await readLibraryCatalog(root, project, { persistence: prepared.persistence }), legacyProject);
  const lexical = await searchLibrary(root, {
    scope: project,
    query: "Moonblade",
    retrievalMode: "lexical",
    persistence: prepared.persistence,
  });
  assert.equal(lexical.hits[0]?.text, "Moonblade");
  assert.equal(lexical.semanticState.state, "lexical_only");

  const personalMetadata = await prepared.persistence.read(personal);
  const projectMetadata = await prepared.persistence.read(project);
  assert.ok(personalMetadata?.documents[0]?.contentBlobRefId);
  assert.equal(personalMetadata?.documents[0]?.contentBlobRefId, projectMetadata?.documents[0]?.contentBlobRefId);
  assert.equal(personalMetadata?.documents[0]?.sourceDigest, digest(bytes));
  const blobPath = prepared.blobStore.pathFor(personalMetadata!.documents[0]!.contentBlobRefId!);
  assert.deepEqual(await readFile(blobPath), bytes);

  const rebuilt = await reindexLibrary(root, { scope: personal, semantic: false, persistence: prepared.persistence });
  assert.equal(rebuilt.blocks, 2);
  assert.equal(rebuilt.semanticState, "lexical_only");
  const vectorsPath = join(libraryScopeRoot(root, personal), "vectors.jsonl");
  await assert.rejects(() => stat(vectorsPath), { code: "ENOENT" });

  await assert.rejects(
    () => importLibraryDocuments(root, { scope: personal, sourcePaths: [firstSource], semantic: false }),
    /SQLite Library storage is authoritative/,
  );

  const reopened = await prepareAssistantLibrarySqliteCutover({ root, authority, activeRunCount: 0 });
  assert.equal(reopened.status, "already-sqlite");
  const reopenedCatalog = await readLibraryCatalog(root, personal, { persistence: reopened.persistence });
  assert.deepEqual(reopenedCatalog.documents, legacyPersonal.documents);
  const parsed = parseLibraryMetadataFile(await reopened.persistence.read(personal), "reopened library");
  assert.equal(parsed.blocks.length, 2);

  const removed = await importLibraryDocuments(root, { scope: project, sourcePaths: [firstSource], semantic: false, persistence: reopened.persistence });
  assert.equal(removed.documents.length, 1);
  const projectCurrent = await reopened.persistence.read(project);
  assert.ok(projectCurrent);
  await reopened.persistence.removeDocument(project, parsed.documents[0]!);
  await reopened.persistence.write(project, { ...projectCurrent, documents: [], blocks: [], updatedAt: new Date().toISOString() }, projectCurrent);
  const inspected = await reopened.blobStore.inspect();
  assert.equal(inspected.orphanBlobs.length, 1);

  prepared.close();
  reopened.close();
  console.log("SQLite assistant library tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
