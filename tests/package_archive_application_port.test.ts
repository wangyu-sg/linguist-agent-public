import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PackageArchiveApplicationError,
  packageArchiveApplicationPort,
} from "../packages/cat-server/src/application/package_archive_application_port.js";

const root = await mkdtemp(join(tmpdir(), "la-package-archive-port-"));
const archive = join(root, "signed.lapkg");
const alias = join(root, "signed-link.lapkg");

try {
  await writeFile(archive, "synthetic signed archive", "utf8");
  assert.equal((await packageArchiveApplicationPort.readLocalArchive(archive)).toString("utf8"), "synthetic signed archive");

  await symlink(archive, alias);
  await assert.rejects(
    packageArchiveApplicationPort.readLocalArchive(alias),
    (error: unknown) => error instanceof PackageArchiveApplicationError
      && error.status === 400
      && error.code === "invalid_lapkg_path",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("package archive application port tests passed");
