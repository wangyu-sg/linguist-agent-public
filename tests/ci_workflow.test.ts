import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workflowsRoot = path.join(root, ".github", "workflows");
const ci = readFileSync(path.join(workflowsRoot, "ci.yml"), "utf8");

for (const job of ["validate", "unit", "security", "recovery", "macos", "release"]) {
  assert.match(ci, new RegExp(`^  ${job}:`, "m"), `CI must expose the ${job} job`);
}
assert.match(ci, /^  legacy-verify:/m, "CI must retain the old full verification path until remote suite parity is observed");

assert.match(ci, /^      - run: npm run roadmap:validate$/m);
assert.match(ci, /^      - run: npm run architecture:check$/m);
assert.match(ci, /^      - run: npm run test:unit$/m);
assert.match(ci, /^      - run: npm run test:security$/m);
assert.match(ci, /^      - run: npm run test:recovery$/m);
assert.match(ci, /^      - run: npm run mac:test$/m);
assert.match(ci, /^      - run: npm run release:check$/m);
assert.match(ci, /npm run test:list > "\$RUNNER_TEMP\/la-test-discovery\.txt"/);
assert.match(ci, /uses: actions\/upload-artifact@[0-9a-f]{40}/);
assert.doesNotMatch(ci, /rc:status/, "CI must not write a release-status report under data/**");

for (const entry of readdirSync(workflowsRoot).filter((file) => file.endsWith(".yml"))) {
  const source = readFileSync(path.join(workflowsRoot, entry), "utf8");
  assert.doesNotMatch(source, /uses:\s+[^\s@]+@(?:main|master|v\d+)/);
  for (const match of source.matchAll(/uses:\s+actions\/[^\s@]+@([^\s#]+)/g)) {
    assert.match(match[1], /^[0-9a-f]{40}$/, `${entry} must pin ${match[0]} to a full commit SHA`);
  }
}

process.stdout.write("CI workflow contract passed\n");
