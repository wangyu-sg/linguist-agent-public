import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import {
  filterCommunityPackageCatalog,
  getCommunityPackageCatalog,
  listManagedPackages,
  PackageCenterError,
  previewManagedPackageInstall,
  promoteManagedPackageInstall,
  resolveApprovedManagedPackageResources,
} from "../packages/cat-server/src/package_center.js";

const root = await mkdtemp(join(tmpdir(), "la-package-center-"));
const fixture = await mkdtemp(join(tmpdir(), "la-package-fixture-"));
const dependencyFixture = await mkdtemp(join(tmpdir(), "la-package-dependency-fixture-"));
const shrinkwrapFixture = await mkdtemp(join(tmpdir(), "la-package-shrinkwrap-fixture-"));
const fakeBin = await mkdtemp(join(tmpdir(), "la-package-fake-bin-"));

try {
  await mkdir(join(fixture, "extensions"), { recursive: true });
  await mkdir(join(fixture, "skills", "review"), { recursive: true });
  await writeFile(join(fixture, "package.json"), JSON.stringify({
    name: "fixture-pi-package",
    version: "1.2.3",
    license: "MIT",
    keywords: ["pi-package"],
    scripts: { postinstall: "node setup.js" },
    pi: {
      extensions: ["./extensions/index.ts"],
      skills: ["./skills/review/SKILL.md"],
    },
    peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
  }, null, 2));
  await writeFile(join(fixture, "extensions", "index.ts"), [
    "import { readFile } from 'node:fs/promises';",
    "import { execFile } from 'node:child_process';",
    "export default function(pi: any) { pi.registerCommand('fixture', { handler: async () => fetch(process.env.WEBHOOK_URL!) }); }",
  ].join("\n"));
  await writeFile(join(fixture, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review files\n---\nRead the selected file.\n");
  const archivePath = join(root, "fixture.tgz");
  await tar.c({ gzip: true, file: archivePath, cwd: fixture, prefix: "package/" }, ["package.json", "extensions", "skills"]);
  const archive = await readFile(archivePath);
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;

  let searchCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://pi.dev/packages") {
      searchCalls += 1;
      return new Response(`
        <span class="packages-count">1-1 / 1</span>
        <article data-package-card="true" data-package-name="fixture-pi-package" data-package-types="extension skill" data-package-downloads="180" data-package-date="1784505600000">
          <p class="packages-desc">Fixture package</p>
          <div class="packages-meta"><span>fixture</span><span>180/mo</span></div>
          <a href="https://www.npmjs.com/package/fixture-pi-package">npm</a>
          <a href="https://example.test/repo">repo</a>
          <a href="https://github.com/earendil-works/pi/issues/new?package-name=fixture-pi-package&amp;package-version=1.2.3">report</a>
        </article>
      `, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url.includes("/-/v1/search")) {
      searchCalls += 1;
      return new Response(JSON.stringify({
        total: 2,
        objects: [{
          package: {
            name: "fixture-pi-package",
            version: "1.2.3",
            description: "Fixture package",
            keywords: ["pi-package", "extension"],
            publisher: { username: "fixture" },
            date: "2026-07-20T00:00:00.000Z",
            links: { npm: "https://www.npmjs.com/package/fixture-pi-package", repository: "https://example.test/repo" },
          },
          downloads: { weekly: 42 },
        }, {
          package: {
            name: "not-a-pi-package",
            version: "1.0.0",
            keywords: ["other"],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("fixture-pi-package/1.2.3")) {
      return new Response(JSON.stringify({
        name: "fixture-pi-package",
        version: "1.2.3",
        license: "MIT",
        dist: { tarball: "https://registry.npmjs.org/fixture-pi-package/-/fixture-pi-package-1.2.3.tgz", integrity },
        peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("fixture-pi-package-1.2.3.tgz")) {
      return new Response(archive, { status: 200, headers: { "content-length": String(archive.length) } });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };

  const catalog = await getCommunityPackageCatalog(root, { fetchImpl, force: true, maxPages: 1, now: new Date("2026-07-20T01:00:00.000Z") });
  assert.equal(catalog.items.length, 1, "catalog must keep only pi-package entries");
  assert.equal(catalog.items[0]?.name, "fixture-pi-package");
  assert.equal(catalog.cursor, 1);
  assert.equal(searchCalls, 1);
  const cached = await getCommunityPackageCatalog(root, { fetchImpl: async () => { throw new Error("must not refresh"); }, now: new Date("2026-07-20T02:00:00.000Z") });
  assert.equal(cached.offline, false);
  const offline = await getCommunityPackageCatalog(root, { fetchImpl: async () => { throw new Error("offline"); }, force: true, now: new Date("2026-07-22T02:00:00.000Z") });
  assert.equal(offline.offline, true);
  assert.equal(offline.stale, true);
  const page = filterCommunityPackageCatalog(catalog, { query: "fixture", cursor: 0, limit: 10 });
  assert.equal(page.returned, 1);

  const preview = await previewManagedPackageInstall(root, { name: "fixture-pi-package", version: "1.2.3" }, {
    fetchImpl,
    now: new Date("2026-07-20T03:00:00.000Z"),
  });
  assert.equal(preview.descriptor.package.integrity, integrity);
  assert.equal(preview.descriptor.trust, "quarantined");
  assert.deepEqual(preview.descriptor.resources.extensions, ["./extensions/index.ts"]);
  assert.equal(preview.requiredRiskIds.includes("extension_code"), true);
  assert.equal(preview.requiredRiskIds.includes("skill_instructions"), true);
  assert.equal(preview.requiredRiskIds.includes("lifecycle_scripts"), true);
  assert.equal(preview.requiredRiskIds.includes("process_execution"), true);
  assert.equal(preview.requiredRiskIds.includes("secret_access"), true);

  const dependencyArchivePath = join(root, "dependency-fixture.tgz");
  await writeFile(join(dependencyFixture, "package.json"), JSON.stringify({
    name: "dependency-fixture",
    version: "1.0.0",
    dependencies: { unsafe: "file:/tmp/host-package" },
  }, null, 2));
  await tar.c({ gzip: true, file: dependencyArchivePath, cwd: dependencyFixture, prefix: "package/" }, ["package.json"]);
  const dependencyArchive = await readFile(dependencyArchivePath);
  const dependencyIntegrity = `sha512-${createHash("sha512").update(dependencyArchive).digest("base64")}`;
  const npmMarker = join(root, "npm-was-started");
  const fakeNpm = join(fakeBin, "npm");
  await writeFile(fakeNpm, `#!/bin/sh\nprintf started > "${npmMarker}"\n`, "utf8");
  await chmod(fakeNpm, 0o755);
  let dependencyFetchCalls = 0;
  const dependencyFetch: typeof fetch = async (input) => {
    dependencyFetchCalls += 1;
    const url = String(input);
    if (url.includes("dependency-fixture/1.0.0")) {
      return new Response(JSON.stringify({
        name: "dependency-fixture",
        version: "1.0.0",
        dist: { tarball: "https://registry.npmjs.org/dependency-fixture/-/dependency-fixture-1.0.0.tgz", integrity: dependencyIntegrity },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.endsWith("dependency-fixture-1.0.0.tgz")) return new Response(dependencyArchive, { status: 200 });
    throw new Error(`Unexpected dependency fixture URL: ${url}`);
  };
  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath ?? ""}`;
  try {
    await assert.rejects(
      previewManagedPackageInstall(root, { name: "dependency-fixture", version: "1.0.0" }, { fetchImpl: dependencyFetch }),
      (error: unknown) => error instanceof PackageCenterError && error.code === "unsafe_archive" && /dependencies/i.test(error.message),
    );
  } finally {
    process.env.PATH = originalPath;
  }
  await assert.rejects(readFile(npmMarker), /ENOENT/, "Stable preview must not start npm or any dependency installer");
  assert.equal(dependencyFetchCalls, 2, "preview may fetch only metadata and the selected archive");

  for (const dependencyCase of [
    { suffix: "git", spec: "git+https://example.test/unsafe.git" },
    { suffix: "url", spec: "https://example.test/unsafe.tgz" },
  ]) {
    const packageName = `dependency-fixture-${dependencyCase.suffix}`;
    await writeFile(join(dependencyFixture, "package.json"), JSON.stringify({
      name: packageName,
      version: "1.0.0",
      dependencies: { unsafe: dependencyCase.spec },
    }, null, 2));
    const archivePathForCase = join(root, `${packageName}.tgz`);
    await tar.c({ gzip: true, file: archivePathForCase, cwd: dependencyFixture, prefix: "package/" }, ["package.json"]);
    const archiveForCase = await readFile(archivePathForCase);
    const integrityForCase = `sha512-${createHash("sha512").update(archiveForCase).digest("base64")}`;
    let fetchCalls = 0;
    const fetchForCase: typeof fetch = async (input) => {
      fetchCalls += 1;
      return String(input).endsWith(`${packageName}-1.0.0.tgz`)
        ? new Response(archiveForCase, { status: 200 })
        : new Response(JSON.stringify({
          name: packageName,
          version: "1.0.0",
          dist: { tarball: `https://registry.npmjs.org/${packageName}/-/${packageName}-1.0.0.tgz`, integrity: integrityForCase },
        }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await assert.rejects(
      previewManagedPackageInstall(root, { name: packageName, version: "1.0.0" }, { fetchImpl: fetchForCase }),
      (error: unknown) => error instanceof PackageCenterError && error.code === "unsafe_archive" && /dependencies/i.test(error.message),
    );
    assert.equal(fetchCalls, 2, `${dependencyCase.suffix} dependency preview must perform no dependency fetch`);
  }

  const shrinkwrapArchivePath = join(root, "shrinkwrap-fixture.tgz");
  await writeFile(join(shrinkwrapFixture, "package.json"), JSON.stringify({ name: "shrinkwrap-fixture", version: "1.0.0" }));
  await writeFile(join(shrinkwrapFixture, "npm-shrinkwrap.json"), JSON.stringify({ name: "shrinkwrap-fixture", version: "1.0.0", lockfileVersion: 3 }));
  await tar.c({ gzip: true, file: shrinkwrapArchivePath, cwd: shrinkwrapFixture, prefix: "package/" }, ["package.json", "npm-shrinkwrap.json"]);
  const shrinkwrapArchive = await readFile(shrinkwrapArchivePath);
  const shrinkwrapIntegrity = `sha512-${createHash("sha512").update(shrinkwrapArchive).digest("base64")}`;
  const shrinkwrapFetch: typeof fetch = async (input) => String(input).endsWith("shrinkwrap-fixture-1.0.0.tgz")
    ? new Response(shrinkwrapArchive, { status: 200 })
    : new Response(JSON.stringify({
      name: "shrinkwrap-fixture",
      version: "1.0.0",
      dist: { tarball: "https://registry.npmjs.org/shrinkwrap-fixture/-/shrinkwrap-fixture-1.0.0.tgz", integrity: shrinkwrapIntegrity },
    }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(
    previewManagedPackageInstall(root, { name: "shrinkwrap-fixture", version: "1.0.0" }, { fetchImpl: shrinkwrapFetch }),
    (error: unknown) => error instanceof PackageCenterError && error.code === "unsafe_archive" && /shrinkwrap/i.test(error.message),
  );

  await assert.rejects(
    promoteManagedPackageInstall(root, {
      planHash: preview.planHash,
      name: "fixture-pi-package",
      version: "1.2.3",
      confirmedVersion: "1.2.3",
      acceptedRiskIds: [],
    }, { now: new Date("2026-07-20T04:00:00.000Z") }),
    (error: unknown) => error instanceof PackageCenterError && error.code === "approval_required",
  );

  const installed = await promoteManagedPackageInstall(root, {
    planHash: preview.planHash,
    name: "fixture-pi-package",
    version: "1.2.3",
    confirmedVersion: "1.2.3",
    acceptedRiskIds: preview.requiredRiskIds,
  }, { now: new Date("2026-07-20T04:00:00.000Z") });
  assert.equal(installed.descriptor.trust, "approved");
  assert.equal((await listManagedPackages(root)).length, 1);
  const resources = await resolveApprovedManagedPackageResources(root);
  assert.deepEqual(resources.extensions, [join(installed.installPath, "extensions", "index.ts")]);
  assert.deepEqual(resources.skills, [join(installed.installPath, "skills", "review", "SKILL.md")]);
  await assert.rejects(readFile(join(root, ".pi", "settings.json")), /ENOENT/, "managed install must not edit Pi settings");

  console.log("package center tests passed");
} finally {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(fixture, { recursive: true, force: true }),
    rm(dependencyFixture, { recursive: true, force: true }),
    rm(shrinkwrapFixture, { recursive: true, force: true }),
    rm(fakeBin, { recursive: true, force: true }),
  ]);
}
