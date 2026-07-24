import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createRootTestChildEnvironment,
  discoverRootTests,
  extractLegacyTestFiles,
  orderTestsForMigration,
  runRootTestFiles,
  selectDiscoveredTests,
  validateServerLaunchEnvironment,
  validateLegacyParity,
} from "../scripts/test-discovery.js";

const fixtureRoot = mkdtempSync(path.join(tmpdir(), "la-test-discovery-"));

try {
  mkdirSync(path.join(fixtureRoot, "tests", "nested"), { recursive: true });
  writeFileSync(path.join(fixtureRoot, "tests", "alpha.test.ts"), "");
  writeFileSync(path.join(fixtureRoot, "tests", "nested", "beta.spec.ts"), "");
  writeFileSync(path.join(fixtureRoot, "tests", "helper.ts"), "");

  const discovered = discoverRootTests(fixtureRoot);
  assert.deepEqual(discovered, ["tests/alpha.test.ts", "tests/nested/beta.spec.ts"]);

  const legacy = extractLegacyTestFiles({
    "test:legacy:pre": "tsx tests/alpha.test.ts",
    "test:legacy": "tsx tests/alpha.test.ts && tsx tests/nested/beta.spec.ts",
    "test:legacy:post": "tsx tests/removed.test.ts",
  });
  assert.deepEqual(legacy, [
    "tests/alpha.test.ts",
    "tests/nested/beta.spec.ts",
    "tests/removed.test.ts",
  ]);
  assert.deepEqual(validateLegacyParity(discovered, legacy), {
    additions: [],
    errors: ["legacy test is no longer discovered: tests/removed.test.ts"],
  });

  const withNewTest = [...discovered, "tests/security_capability.test.ts"].sort();
  assert.deepEqual(validateLegacyParity(withNewTest, discovered), {
    additions: ["tests/security_capability.test.ts"],
    errors: [],
  });
  assert.deepEqual(
    orderTestsForMigration(withNewTest, ["tests/nested/beta.spec.ts", "tests/alpha.test.ts"]),
    ["tests/nested/beta.spec.ts", "tests/alpha.test.ts", "tests/security_capability.test.ts"],
  );

  assert.deepEqual(selectDiscoveredTests(withNewTest, { suite: "security" }), [
    "tests/security_capability.test.ts",
  ]);

  const rootTestEnvironment = createRootTestChildEnvironment(process.cwd(), {
    LA_TEST_MODE: "0",
    LA_TEST_REPO_ROOT: "/checkout/data",
    LA_TEST_PI_AGENT_DIR: "/home/user/.pi/agent",
  });
  try {
    assert.equal(rootTestEnvironment.env.LA_TEST_MODE, "1");
    assert.equal(rootTestEnvironment.env.LA_TEST_REPO_ROOT, rootTestEnvironment.root);
    assert.equal(rootTestEnvironment.env.LA_TEST_PI_AGENT_DIR, rootTestEnvironment.piAgentDir);
    assert.ok(existsSync(rootTestEnvironment.root));
    assert.ok(existsSync(rootTestEnvironment.piAgentDir));
    assert.equal(existsSync(path.join(rootTestEnvironment.root, "data")), false, "the synthetic child cwd must not expose checkout data");
    assert.equal(existsSync(path.join(rootTestEnvironment.root, ".git")), false, "the synthetic child cwd must not expose checkout git state");
    for (const entry of ["apps", "contracts", "docs", "packages", "patches", "scripts", "tests", "node_modules"]) {
      const viewEntry = path.join(rootTestEnvironment.root, entry);
      assert.ok(existsSync(viewEntry), `the synthetic child cwd must expose allowlisted ${entry}`);
      assert.ok(lstatSync(viewEntry).isSymbolicLink(), `the synthetic child cwd must not copy or broaden ${entry}`);
    }
    assert.ok(existsSync(path.join(rootTestEnvironment.root, "tests", "test_discovery.test.ts")));
    const piRoot = path.join(rootTestEnvironment.root, ".pi");
    assert.equal(
      readFileSync(path.join(piRoot, "APPEND_SYSTEM.md"), "utf8"),
      readFileSync(path.join(process.cwd(), ".pi", "APPEND_SYSTEM.md"), "utf8"),
      "the synthetic Pi root must retain the tracked runtime constitution",
    );
    assert.ok(lstatSync(path.join(piRoot, "agents")).isSymbolicLink(), "only tracked Team profiles may be linked into the synthetic Pi root");
    assert.ok(existsSync(path.join(piRoot, "agents", "la-team-translator.md")));
    assert.equal(
      readFileSync(path.join(piRoot, "extensions", "memory.ts"), "utf8"),
      readFileSync(path.join(process.cwd(), ".pi", "extensions", "memory.ts"), "utf8"),
    );
    assert.equal(
      readFileSync(path.join(piRoot, "extensions", "team-evidence-child.ts"), "utf8"),
      readFileSync(path.join(process.cwd(), ".pi", "extensions", "team-evidence-child.ts"), "utf8"),
      "the synthetic Pi root must expose the one Team child extension used by the production loader test",
    );
    assert.deepEqual(readdirSync(piRoot).sort(), ["APPEND_SYSTEM.md", "agents", "extensions", "prompts", "settings.json", "skills"]);
    assert.equal(existsSync(path.join(piRoot, "npm")), false);
    assert.equal(existsSync(path.join(piRoot, "extensions", "cat-tools.ts")), false);
    assert.equal(
      readFileSync(path.join(rootTestEnvironment.root, "AGENTS.md"), "utf8"),
      readFileSync(path.join(process.cwd(), "AGENTS.md"), "utf8"),
      "the synthetic child cwd must retain the one tracked Dev project-context file",
    );
    assert.deepEqual(readdirSync(rootTestEnvironment.root).sort(), [
      ".pi",
      "AGENTS.md",
      "apps",
      "contracts",
      "docs",
      "node_modules",
      "package-lock.json",
      "package.json",
      "packages",
      "patches",
      "pi-agent",
      "scripts",
      "tests",
      "tsconfig.json",
    ]);
  } finally {
    rootTestEnvironment.cleanup();
  }
  assert.equal(existsSync(rootTestEnvironment.root), false);

  const observedRoots: string[] = [];
  const runnerExitCode = runRootTestFiles(fixtureRoot, ["tests/alpha.test.ts", "tests/nested/beta.spec.ts"], (file, cwd, env) => {
    const observedRoot = env.LA_TEST_REPO_ROOT ?? "";
    observedRoots.push(observedRoot);
    assert.equal(file, path.join(fixtureRoot, file.includes("nested") ? "tests/nested/beta.spec.ts" : "tests/alpha.test.ts"));
    assert.equal(cwd, observedRoot, "the child process cwd must be its synthetic repository root");
    assert.equal(env.LA_TEST_MODE, "1");
    assert.ok(observedRoot.startsWith(tmpdir()));
    assert.ok(existsSync(observedRoot));
    assert.ok(existsSync(env.LA_TEST_PI_AGENT_DIR ?? ""));
    assert.equal(existsSync(path.join(observedRoot, "data")), false);
    return { status: 0 };
  }, process.cwd());
  assert.equal(runnerExitCode, 0);
  assert.equal(new Set(observedRoots).size, 2, "each root-test child must receive a distinct synthetic root");
  for (const observedRoot of observedRoots) {
    assert.equal(existsSync(observedRoot), false, "the runner must clean every synthetic root after its child exits");
  }

  writeFileSync(path.join(fixtureRoot, "tests", "unsafe-server.test.ts"), `spawn("npm", ["run", "server"], { env: {} });\n`);
  writeFileSync(path.join(fixtureRoot, "tests", "safe-server.test.ts"), `spawn("npm", ["run", "server"], { env: { ...process.env } });\n`);
  assert.deepEqual(validateServerLaunchEnvironment(fixtureRoot, ["tests/unsafe-server.test.ts"]), [
    "server-starting root test does not inherit the runner synthetic environment: tests/unsafe-server.test.ts",
  ]);
  assert.deepEqual(validateServerLaunchEnvironment(fixtureRoot, ["tests/safe-server.test.ts"]), []);

assert.deepEqual(
  selectDiscoveredTests(["tests/local_transport_rendezvous.test.ts"], { suite: "security" }),
  ["tests/local_transport_rendezvous.test.ts"],
);
assert.deepEqual(
  selectDiscoveredTests(["tests/safe_logging.test.ts"], { suite: "security" }),
  ["tests/safe_logging.test.ts"],
);

  const shardOne = selectDiscoveredTests(withNewTest, { suite: "all", shard: "1/2" });
  const shardTwo = selectDiscoveredTests(withNewTest, { suite: "all", shard: "2/2" });
  assert.deepEqual([...shardOne, ...shardTwo].sort(), withNewTest);
  assert.deepEqual(shardOne.filter((file) => shardTwo.includes(file)), []);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("test discovery tests passed\n");
