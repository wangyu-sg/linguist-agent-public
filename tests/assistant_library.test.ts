import { strict as assert } from "node:assert";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  importLibraryDocuments,
  readLibraryCatalog,
  reindexLibrary,
  searchLibrary,
  type LibraryScope,
  type LocalTextEmbedder,
} from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-assistant-library-"));

const fakeEmbedder: LocalTextEmbedder = {
  model: "test-multilingual-e5",
  dim: 3,
  provider: "transformers.js",
  async embed(texts) {
    return texts.map((text) => {
      const normalized = text.toLocaleLowerCase();
      if (/lightning|thunder|闪电|雷电/.test(normalized) && /formal|礼貌|polite|风格/.test(normalized)) return [1, 1, 0];
      if (/lightning|thunder|闪电|雷电/.test(normalized)) return [1, 0, 0];
      if (/formal|礼貌|polite|风格|writing|sound/.test(normalized)) return [0, 1, 0];
      return [0, 0, 1];
    });
  },
  split(text) { return [text]; },
};

const personal: LibraryScope = { kind: "personal" };
const projectA: LibraryScope = { kind: "project", projectId: "project-a" };
const projectB: LibraryScope = { kind: "project", projectId: "project-b" };

try {
  const personalFile = join(root, "personal-style.txt");
  const projectAFile = join(root, "project-a-terms.txt");
  const projectBFile = join(root, "project-b-secret.txt");
  const unrelated = join(root, "not-selected.txt");
  await writeFile(personalFile, "Prefer a polite and concise tone.\n", "utf8");
  await writeFile(projectAFile, "闪电伤害 must be translated as Thunder Damage.\n", "utf8");
  await writeFile(projectBFile, "SECRET_B_ONLY should never leave project B.\n", "utf8");
  await writeFile(unrelated, "UNSELECTED_MACHINE_FILE\n", "utf8");

  const personalImport = await importLibraryDocuments(root, {
    scope: personal,
    sourcePaths: [personalFile],
    embedder: fakeEmbedder,
  });
  assert.equal(personalImport.documents.length, 1);
  assert.equal(personalImport.semanticState, "ready");
  assert.equal((await stat(personalImport.documents[0]!.managedPath)).isFile(), true);

  await importLibraryDocuments(root, { scope: projectA, sourcePaths: [projectAFile], embedder: fakeEmbedder });
  await importLibraryDocuments(root, { scope: projectB, sourcePaths: [projectBFile], embedder: fakeEmbedder });

  const catalog = await readLibraryCatalog(root, personal);
  assert.equal(catalog.documents.length, 1, "only explicitly selected documents are imported");
  assert.equal(catalog.documents.some((document) => document.originalName === "not-selected.txt"), false);

  const personalSearch = await searchLibrary(root, {
    scope: personal,
    query: "How should the writing sound?",
    retrievalMode: "hybrid",
    embedder: fakeEmbedder,
  });
  assert.equal(personalSearch.hits.some((hit) => hit.text.includes("polite")), true);
  assert.equal(personalSearch.hits.every((hit) => hit.scope.kind === "personal"), true);
  assert.equal(personalSearch.hits.some((hit) => hit.text.includes("SECRET_B_ONLY")), false);

  const projectSearch = await searchLibrary(root, {
    scope: projectA,
    query: "游戏里的雷电伤害术语和写作风格",
    includePersonal: true,
    retrievalMode: "hybrid",
    embedder: fakeEmbedder,
  });
  assert.equal(projectSearch.hits.some((hit) => hit.text.includes("Thunder Damage")), true);
  assert.equal(projectSearch.hits.some((hit) => hit.text.includes("polite")), true);
  assert.equal(projectSearch.hits.some((hit) => hit.text.includes("SECRET_B_ONLY")), false, "another project's Library must never leak");
  assert.equal(projectSearch.hits[0]?.scope.kind, "project", "project evidence wins deterministic ties over Personal Library recall");
  for (const hit of projectSearch.hits) {
    assert.match(hit.sourceDigest, /^[a-f0-9]{64}$/);
    assert.equal((await stat(hit.managedPath)).isFile(), true, "every citation resolves to its managed source copy");
  }

  const lexicalOnly = await reindexLibrary(root, { scope: projectA, semantic: false });
  assert.equal(lexicalOnly.semanticState, "lexical_only");
  const lexicalReport = await searchLibrary(root, { scope: projectA, query: "Thunder Damage", includePersonal: false, retrievalMode: "hybrid" });
  assert.equal(lexicalReport.semanticState.state, "lexical_only");
  assert.equal(lexicalReport.hits[0]?.retrievalMode, "lexical");

  console.log("assistant_library tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
