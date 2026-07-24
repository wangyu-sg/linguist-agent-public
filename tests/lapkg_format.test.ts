import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  inspectLapkgArchive,
  LapkgFormatError,
  type LapkgManifestV1,
} from "../packages/cat-server/src/lapkg_format.js";

const root = await mkdtemp(join(tmpdir(), "la-lapkg-format-"));

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifestFor(resources: LapkgManifestV1["resources"]): LapkgManifestV1 {
  return {
    schemaVersion: 1,
    id: "example.review-pack",
    version: "1.2.3",
    publisher: { id: "example", name: "Example Publisher" },
    license: "MIT",
    resources,
    signature: {
      algorithm: "ed25519",
      keyId: "example-2026",
      value: Buffer.alloc(64, 7).toString("base64"),
    },
  };
}

async function archiveFixture(
  name: string,
  manifest: unknown,
  files: Record<string, string | Buffer>,
): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "lapkg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [path, value] of Object.entries(files)) {
    await mkdir(join(directory, path, ".."), { recursive: true });
    await writeFile(join(directory, path), value);
  }
  const archive = join(root, `${name}.lapkg`);
  await tar.c({ file: archive, cwd: directory, portable: true }, ["lapkg.json", "resources"]);
  return archive;
}

async function rejectsFormat(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(action, (error: unknown) =>
    error instanceof LapkgFormatError && pattern.test(error.message));
}

try {
  const skill = "---\nname: review\ndescription: Review bilingual files\n---\nReview the selected file.\n";
  const glossary = "source,target\nStart,开始\n";
  const validManifest = manifestFor([
    { id: "review-skill", type: "skill", path: "resources/review/SKILL.md", sha256: sha256(skill), mediaType: "text/markdown" },
    { id: "core-glossary", type: "glossary", path: "resources/core.csv", sha256: sha256(glossary), mediaType: "text/csv" },
  ]);
  const validArchive = await archiveFixture("valid", validManifest, {
    "resources/review/SKILL.md": skill,
    "resources/core.csv": glossary,
  });
  const inspected = await inspectLapkgArchive(validArchive);
  assert.equal(inspected.manifest.id, "example.review-pack");
  assert.equal(inspected.resources.length, 2);
  assert.equal(inspected.resources[0]?.path, "resources/core.csv");
  assert.match(inspected.archiveSha256, /^[a-f0-9]{64}$/u);
  assert.match(inspected.treeHash, /^[a-f0-9]{64}$/u);
  assert.equal(inspected.totalResourceBytes, Buffer.byteLength(skill) + Buffer.byteLength(glossary));

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("unknown-field", { ...validManifest, scripts: {} }, {
      "resources/review/SKILL.md": skill,
      "resources/core.csv": glossary,
    })),
    /unknown manifest field scripts/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("duplicate-id", manifestFor([
      { id: "same", type: "prompt", path: "resources/a.md", sha256: sha256("a") },
      { id: "same", type: "prompt", path: "resources/b.md", sha256: sha256("b") },
    ]), { "resources/a.md": "a", "resources/b.md": "b" })),
    /duplicate resource id/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("unknown-type", manifestFor([
      { id: "extension", type: "extension" as "skill", path: "resources/extension.md", sha256: sha256("x") },
    ]), { "resources/extension.md": "x" })),
    /unsupported resource type/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("traversal", manifestFor([
      { id: "escape", type: "prompt", path: "resources/../escape.md", sha256: sha256("x") },
    ]), { "resources/escape.md": "x" })),
    /invalid resource path/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("case-collision", manifestFor([
      { id: "upper", type: "prompt", path: "resources/A.md", sha256: sha256("a") },
      { id: "lower", type: "prompt", path: "resources/a.md", sha256: sha256("a") },
    ]), { "resources/a.md": "a" })),
    /portable path collision/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("unicode-collision", manifestFor([
      { id: "nfc", type: "prompt", path: "resources/café.md", sha256: sha256("a") },
      { id: "nfd", type: "prompt", path: "resources/café.md", sha256: sha256("a") },
    ]), { "resources/café.md": "a" })),
    /portable path collision/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("hash-mismatch", manifestFor([
      { id: "prompt", type: "prompt", path: "resources/prompt.md", sha256: sha256("approved") },
    ]), { "resources/prompt.md": "changed" })),
    /digest mismatch/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("executable-extension", manifestFor([
      { id: "script", type: "template", path: "resources/setup.js", sha256: sha256("export {}") },
    ]), { "resources/setup.js": "export {}" })),
    /executable resource path/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("shebang", manifestFor([
      { id: "script", type: "template", path: "resources/setup.md", sha256: sha256("#!/bin/sh\necho unsafe\n") },
    ]), { "resources/setup.md": "#!/bin/sh\necho unsafe\n" })),
    /executable shebang/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("extra-file", validManifest, {
      "resources/review/SKILL.md": skill,
      "resources/core.csv": glossary,
      "resources/undeclared.md": "not approved",
    })),
    /undeclared archive file/iu,
  );

  await rejectsFormat(
    async () => inspectLapkgArchive(await archiveFixture("missing-file", validManifest, {
      "resources/review/SKILL.md": skill,
    })),
    /missing declared resource/iu,
  );

  const symlinkDirectory = join(root, "symlink");
  await mkdir(join(symlinkDirectory, "resources"), { recursive: true });
  await writeFile(join(symlinkDirectory, "lapkg.json"), `${JSON.stringify(manifestFor([
    { id: "link", type: "prompt", path: "resources/link.md", sha256: sha256("target") },
  ]))}\n`);
  await writeFile(join(symlinkDirectory, "target.md"), "target");
  await symlink("../target.md", join(symlinkDirectory, "resources", "link.md"));
  const symlinkArchive = join(root, "symlink.lapkg");
  await tar.c({ file: symlinkArchive, cwd: symlinkDirectory, portable: true }, ["lapkg.json", "resources"]);
  await rejectsFormat(() => inspectLapkgArchive(symlinkArchive), /unsupported archive entry type SymbolicLink/iu);

  const hardlinkDirectory = join(root, "hardlink");
  await mkdir(join(hardlinkDirectory, "resources"), { recursive: true });
  await writeFile(join(hardlinkDirectory, "lapkg.json"), `${JSON.stringify(manifestFor([
    { id: "a", type: "prompt", path: "resources/a.md", sha256: sha256("same") },
    { id: "b", type: "prompt", path: "resources/b.md", sha256: sha256("same") },
  ]))}\n`);
  await writeFile(join(hardlinkDirectory, "resources", "a.md"), "same");
  await link(join(hardlinkDirectory, "resources", "a.md"), join(hardlinkDirectory, "resources", "b.md"));
  const hardlinkArchive = join(root, "hardlink.lapkg");
  await tar.c({ file: hardlinkArchive, cwd: hardlinkDirectory, portable: true }, ["lapkg.json", "resources"]);
  await rejectsFormat(() => inspectLapkgArchive(hardlinkArchive), /unsupported archive entry type Link/iu);

  await rejectsFormat(
    () => inspectLapkgArchive(validArchive, { maxFiles: 1 }),
    /file count limit/iu,
  );
  await rejectsFormat(
    () => inspectLapkgArchive(validArchive, { maxResourceBytes: 4 }),
    /resource byte limit/iu,
  );

  const executableModeDirectory = join(root, "executable-mode");
  await mkdir(join(executableModeDirectory, "resources"), { recursive: true });
  await writeFile(join(executableModeDirectory, "lapkg.json"), `${JSON.stringify(manifestFor([
    { id: "prompt", type: "prompt", path: "resources/prompt.md", sha256: sha256("safe text") },
  ]))}\n`);
  await writeFile(join(executableModeDirectory, "resources", "prompt.md"), "safe text");
  await chmod(join(executableModeDirectory, "resources", "prompt.md"), 0o755);
  const executableModeArchive = join(root, "executable-mode.lapkg");
  await tar.c({ file: executableModeArchive, cwd: executableModeDirectory, portable: false }, ["lapkg.json", "resources"]);
  await rejectsFormat(() => inspectLapkgArchive(executableModeArchive), /executable or special permission bits/iu);

  console.log(".lapkg format tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
