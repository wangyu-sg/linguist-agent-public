import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const updateScript = fileURLToPath(new URL("../../../scripts/mac-local-update.sh", import.meta.url));

async function updateKind(paths) {
  const { stdout } = await run("/bin/bash", [
    "-c",
    'source "$1"; update_kind "$2"',
    "la-local-update-test",
    updateScript,
    paths,
  ]);
  return stdout.trim();
}

test("local updater classifies Electron, runtime, and documentation changes", async () => {
  assert.equal(await updateKind(""), "none");
  assert.equal(await updateKind("apps/desktop/src/main.mjs"), "app_runtime");
  assert.equal(await updateKind("apps/desktop/package-lock.json\npackages/cat-server/src/server.ts"), "app_runtime");
  assert.equal(await updateKind("packages/cat-server/src/server.ts"), "runtime");
  assert.equal(await updateKind("apps/desktop/docs/electron-acceptance/README.md"), "docs");
  assert.equal(await updateKind("apps/desktop/tests/security.test.mjs"), "docs");
});

test("local updater requires an explicit check or install action", async () => {
  await assert.rejects(
    run("/bin/bash", [updateScript]),
    (error) => error.code === 2 && /Usage:/.test(String(error.stderr)),
  );
  await assert.rejects(
    run("/bin/bash", [updateScript, "--check", "--install"]),
    (error) => error.code === 2 && /exactly one/.test(String(error.stderr)),
  );
  await assert.rejects(
    run("/bin/bash", [updateScript, "--check", "--repo"]),
    (error) => error.code === 2 && /requires a path/.test(String(error.stderr)),
  );
});

test("local updater uses the signed Electron package and dynamic bundle executable", async () => {
  const source = await readFile(updateScript, "utf8");
  assert.match(source, /npm --prefix "\$REPO_ROOT\/apps\/desktop" run package/);
  assert.match(source, /npm --prefix "\$REPO_ROOT\/apps\/desktop" run verify -- --app="\$app_dir"/);
  assert.match(source, /bundle_plist_value "\$1" CFBundleExecutable/);
  assert.doesNotMatch(source, /apps\/mac\/script\/build_and_run\.sh/);
});

test("app replacement validates the destination and restores the prior bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-electron-update-"));
  await run("/bin/bash", [
    "-c",
    `source "$1"
work="$2"
mkdir -p "$work/dest" "$work/source-good" "$work/source-bad"
printf old > "$work/dest/payload"
printf new > "$work/source-good/payload"
touch "$work/source-good/valid"
printf broken > "$work/source-bad/payload"
validate_app_bundle() { [[ -f "$1/valid" ]]; }
replace_app_bundle "$work/source-good" "$work/dest"
[[ "$(cat "$work/dest/payload")" == new ]]
if replace_app_bundle "$work/source-bad" "$work/dest"; then
  exit 91
fi
[[ "$(cat "$work/dest/payload")" == new ]]
[[ -z "$(find "$work" -maxdepth 1 -name 'dest.previous.*' -print -quit)" ]]`,
    "la-local-update-test",
    updateScript,
    root,
  ]);
});
