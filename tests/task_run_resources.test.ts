import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildCatRequestShape,
  buildTeamEvidenceChildRequestShape,
  NATIVE_CAPABILITY_PACKAGES,
} from "@linguist-agent/cat-runtime";
import { TEAM_EVIDENCE_TOOL_NAMES } from "@linguist-agent/cat-data";
import {
  composeTeamRunResourceManifest,
  computeInstalledPackageClosureIntegrity,
  computeLockedPackageClosureIntegrity,
  invalidateTaskRunResourceCache,
  resolveTaskRunResources,
  serverOwnedRunDisabledTools,
} from "../packages/cat-server/src/task_run_resources.js";

const legacyProjectDisabledTools = ["ask_user", "document_parse", "document_search", "document_screenshot", "tm_lookup"];
const canonicalDisabledTools = serverOwnedRunDisabledTools(legacyProjectDisabledTools);
assert.deepEqual(canonicalDisabledTools, ["subagent", "wait"]);
for (const required of legacyProjectDisabledTools) {
  assert.equal(canonicalDisabledTools.includes(required), false, `legacy project settings cannot disable canonical Run tool ${required}`);
}

const root = await mkdtemp(join(tmpdir(), "la-task-run-resources-"));
const testPatchTarget = "src/ask-tool.ts";
const fixturePeerDependencies: Record<string, Record<string, string>> = {
  subagents: {
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
  },
  docparser: {
    "@earendil-works/pi-ai": "^0.74.0",
    "@earendil-works/pi-coding-agent": "^0.74.0",
  },
  ask: {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    typebox: "*",
  },
};

try {
  const installed = new Map<string, string>();
  const expectedExtensions: string[] = [];
  const expectedTreeHashes: Record<string, string> = {};
  const expectedPatchHashes: Record<string, string> = {};
  const lockPackages: Record<string, {
    name: string;
    version: string;
    integrity: string;
    dependencies?: Record<string, string>;
  }> = {};
  for (const entry of NATIVE_CAPABILITY_PACKAGES.filter(({ activation }) => activation === "core" || activation === "main" || activation === "team")) {
    const packageRoot = join(root, "install", "node_modules", ...entry.packageName.split("/"));
    const extensionPath = join(packageRoot, entry.extensionPath);
    await mkdir(join(extensionPath, ".."), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: entry.packageName,
      version: entry.version,
      peerDependencies: fixturePeerDependencies[entry.id],
      peerDependenciesMeta: entry.id === "subagents"
        ? { "@earendil-works/pi-agent-core": { optional: true } }
        : undefined,
    }));
    const extension = `export default function ${entry.id}Extension() {}\n`;
    await writeFile(extensionPath, extension);
    await mkdir(join(packageRoot, "src"), { recursive: true });
    await writeFile(join(packageRoot, "src", "imported.ts"), `export const ${entry.id}Imported = true;\n`);
    installed.set(entry.source, packageRoot);
    expectedExtensions.push(await realpath(extensionPath));
    if (entry.patch) {
      const patchedTarget = `export const ${entry.id}HeadlessPatch = true;\n`;
      const patchedTargetPath = join(packageRoot, testPatchTarget);
      await mkdir(join(patchedTargetPath, ".."), { recursive: true });
      await writeFile(patchedTargetPath, patchedTarget);
      expectedPatchHashes[entry.patch] = `sha256-${createHash("sha256").update(patchedTarget).digest("base64")}`;
    }
    lockPackages[`node_modules/${entry.packageName}`] = {
      name: entry.packageName,
      version: entry.version,
      integrity: entry.integrity,
    };
  }
  const subagents = NATIVE_CAPABILITY_PACKAGES.find(({ id }) => id === "subagents")!;
  lockPackages[`node_modules/${subagents.packageName}`]!.dependencies = { "fixture-runtime-dependency": "1.0.0" };
  lockPackages["node_modules/fixture-runtime-dependency"] = {
    name: "fixture-runtime-dependency",
    version: "1.0.0",
    integrity: "sha512-fixture-runtime-dependency",
  };
  const fixtureDependency = join(root, "install", "node_modules", "fixture-runtime-dependency");
  await mkdir(fixtureDependency, { recursive: true });
  await writeFile(join(fixtureDependency, "package.json"), JSON.stringify({ name: "fixture-runtime-dependency", version: "1.0.0" }));
  await writeFile(join(fixtureDependency, "index.js"), "export const fixtureDependency = true;\n");
  const lockPath = join(root, "install", "package-lock.json");
  await writeFile(lockPath, JSON.stringify({ lockfileVersion: 3, packages: lockPackages }));

  const hostPeerVersions: Record<string, string> = {
    "@earendil-works/pi-coding-agent": "0.80.10",
    "@earendil-works/pi-ai": "0.80.10",
    "@earendil-works/pi-tui": "0.80.10",
    typebox: "1.1.38",
  };
  const hostCodingAgentRoot = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
  const hostPeerRoots: Record<string, string> = {
    "@earendil-works/pi-coding-agent": hostCodingAgentRoot,
    "@earendil-works/pi-ai": join(hostCodingAgentRoot, "node_modules", "@earendil-works", "pi-ai"),
    "@earendil-works/pi-tui": join(hostCodingAgentRoot, "node_modules", "@earendil-works", "pi-tui"),
    typebox: join(hostCodingAgentRoot, "node_modules", "typebox"),
  };
  const hostLockPackages: Record<string, { version: string }> = {};
  const hostPeerPackageBytes: Record<string, Buffer> = {};
  const hostPeerExecutablePaths: Record<string, string> = {};
  const expectedHostPeerManifests: Array<{ name: string; source: string; version: string; integrity: string }> = [];
  for (const name of Object.keys(hostPeerRoots).sort()) {
    const packageRoot = hostPeerRoots[name]!;
    const bytes = Buffer.from(JSON.stringify({
      name,
      version: hostPeerVersions[name],
      hostFixture: true,
      ...(name === "@earendil-works/pi-coding-agent" ? { bin: { pi: "dist/cli.js" } } : {}),
    }));
    hostPeerPackageBytes[name] = bytes;
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), bytes);
    const executablePath = join(
      packageRoot,
      "dist",
      name === "@earendil-works/pi-coding-agent" ? "cli.js" : "index.js",
    );
    await mkdir(join(executablePath, ".."), { recursive: true });
    await writeFile(executablePath, name === "@earendil-works/pi-coding-agent"
      ? "#!/usr/bin/env node\nconsole.log('0.80.10');\n"
      : `export const hostPeer = ${JSON.stringify(name)};\n`);
    if (name === "@earendil-works/pi-coding-agent") await chmod(executablePath, 0o755);
    hostPeerExecutablePaths[name] = executablePath;
    hostLockPackages[packageRoot.slice(root.length + 1)] = { version: hostPeerVersions[name]! };
    expectedHostPeerManifests.push({
      name,
      source: `npm:${name}@${hostPeerVersions[name]}`,
      version: hostPeerVersions[name]!,
      integrity: "pending",
    });
  }
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: hostLockPackages }));
  for (const manifest of expectedHostPeerManifests) {
    manifest.integrity = await computeLockedPackageClosureIntegrity({
      installRoot: root,
      rootKey: hostPeerRoots[manifest.name]!.slice(root.length + 1),
    });
  }

  await mkdir(join(root, "agent"), { recursive: true });
  await symlink(join(root, "install"), join(root, "agent", "npm"));

  for (const [source, path] of installed) {
    installed.set(source, path.replace(join(root, "install"), join(root, "agent", "npm")));
  }
  expectedExtensions.splice(0, expectedExtensions.length, ...await Promise.all(
    NATIVE_CAPABILITY_PACKAGES
      .filter(({ activation }) => activation === "core" || activation === "main")
      .map((entry) => realpath(join(installed.get(entry.source)!, entry.extensionPath))),
  ));
  for (const entry of NATIVE_CAPABILITY_PACKAGES.filter(({ activation }) => activation === "core" || activation === "main" || activation === "team")) {
    expectedTreeHashes[entry.id] = await computeInstalledPackageClosureIntegrity({
      packageRoot: installed.get(entry.source)!,
      packageName: entry.packageName,
    });
  }

  let packageLockVerificationCount = 0;
  const verifyFixturePackageLock = async (input: {
    packageRoot: string;
    packageName: string;
    version: string;
    integrity: string;
  }): Promise<boolean> => {
    packageLockVerificationCount += 1;
    let nodeModules = input.packageRoot;
    for (const _ of input.packageName.split("/")) nodeModules = dirname(nodeModules);
    const installRoot = dirname(nodeModules);
    const lock = JSON.parse(await readFile(join(installRoot, "package-lock.json"), "utf8")) as {
      packages?: Record<string, { version?: unknown; integrity?: unknown }>;
    };
    const entry = lock.packages?.[`node_modules/${input.packageName}`];
    return entry?.version === input.version && entry.integrity === input.integrity;
  };
  let patchVerificationCount = 0;
  const verifyFixturePatch = async (id: keyof typeof expectedPatchHashes, packageRoot: string) => {
    patchVerificationCount += 1;
    const bytes = await readFile(join(packageRoot, testPatchTarget));
    const actual = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
    if (actual !== expectedPatchHashes[id]) {
      throw new Error(`Native capability patch target failed integrity: ${id}`);
    }
    return actual;
  };

  const resolveProfile = (
    profile: "main" | "team",
    getInstalledPath: (source: string) => string | undefined = (source) => installed.get(source),
  ) => resolveTaskRunResources(profile, {
    cwd: root,
    agentDir: join(root, "agent"),
    packageManager: { getInstalledPath },
    expectedTreeHashes,
    verifyIntegrity: verifyFixturePackageLock,
    verifyPatch: verifyFixturePatch,
  });
  const resolveMain = (
    getInstalledPath: (source: string) => string | undefined = (source) => installed.get(source),
  ) => resolveProfile("main", getInstalledPath);

  const resolved = await resolveMain();
  const mainColdVerificationCount = packageLockVerificationCount;
  const mainColdPatchCount = patchVerificationCount;
  const mainWarmStartedAt = performance.now();
  const warmMain = await resolveMain();
  const mainWarmMs = performance.now() - mainWarmStartedAt;
  assert.deepEqual(warmMain, resolved);
  assert.equal(packageLockVerificationCount, mainColdVerificationCount, "warm Main resolution must reuse the verified package graph");
  assert.equal(patchVerificationCount, mainColdPatchCount, "warm Main resolution must reuse verified patch state");
  assert.ok(mainWarmMs < 100, `warm Main resolution must stay below 100ms; measured ${mainWarmMs.toFixed(1)}ms`);

  invalidateTaskRunResourceCache();
  const checksBeforeExplicitInvalidation = packageLockVerificationCount;
  await resolveMain();
  assert.ok(
    packageLockVerificationCount > checksBeforeExplicitInvalidation,
    "an explicit Package action invalidation must force canonical re-verification",
  );

  assert.deepEqual(resolved.isolatedResources, {
    extensionPaths: expectedExtensions,
  });
  assert.equal(resolved.verifiedPiBinaryPath, undefined, "Main resources must not expose a Team child runtime path");
  assert.equal(resolved.manifest.profile, "main");
  assert.deepEqual(resolved.manifest.activeToolNames, []);
  assert.deepEqual(
    resolved.manifest.packages,
    [...NATIVE_CAPABILITY_PACKAGES
      .filter(({ activation }) => activation === "core" || activation === "main")
      .map((entry) => ({
        name: entry.packageName,
        source: entry.source,
        version: entry.version,
        integrity: expectedTreeHashes[entry.id],
      })), ...expectedHostPeerManifests],
  );
  assert.equal(JSON.stringify(resolved.manifest).includes(root), false, "manifest must not expose installed paths");
  assert.deepEqual(
    resolved.manifest.packages.filter(({ name }) => Object.hasOwn(hostPeerVersions, name)).map(({ name, version }) => ({ name, version })),
    Object.keys(hostPeerVersions).sort().map((name) => ({ name, version: hostPeerVersions[name] })),
    "the Run manifest must attest the exact active Pi host peer versions",
  );

  const hostPiAiExecutable = hostPeerExecutablePaths["@earendil-works/pi-ai"]!;
  const originalHostPiAiIntegrity = resolved.manifest.packages.find(({ name }) => name === "@earendil-works/pi-ai")!.integrity;
  await writeFile(hostPiAiExecutable, "export const hostPeer = 'tampered';\n");
  const changedHostPiAiIntegrity = (await resolveMain()).manifest.packages.find(({ name }) => name === "@earendil-works/pi-ai")!.integrity;
  assert.notEqual(changedHostPiAiIntegrity, originalHostPiAiIntegrity, "host peer integrity must cover executable files, not only package.json");
  await writeFile(hostPiAiExecutable, `export const hostPeer = ${JSON.stringify("@earendil-works/pi-ai")};\n`);

  const subagentsEntry = NATIVE_CAPABILITY_PACKAGES.find(({ id }) => id === "subagents")!;
  const teamResolved = await resolveProfile("team");
  const teamColdVerificationCount = packageLockVerificationCount;
  const teamWarmStartedAt = performance.now();
  const warmTeam = await resolveProfile("team");
  const teamWarmMs = performance.now() - teamWarmStartedAt;
  assert.deepEqual(warmTeam, teamResolved);
  assert.equal(packageLockVerificationCount, teamColdVerificationCount, "warm Team resolution must reuse the verified package graph");
  assert.ok(teamWarmMs < 100, `warm Team resolution must stay below 100ms; measured ${teamWarmMs.toFixed(1)}ms`);
  const expectedPiBinaryPath = await realpath(hostPeerExecutablePaths["@earendil-works/pi-coding-agent"]!);
  assert.equal(
    teamResolved.verifiedPiBinaryPath,
    expectedPiBinaryPath,
    "Team must bind the Pi CLI from the same verified host package closure",
  );
  assert.equal(
    Object.keys(teamResolved).includes("verifiedPiBinaryPath"),
    false,
    "the runtime-only Pi path must be non-enumerable",
  );
  assert.equal(
    JSON.stringify(teamResolved).includes(expectedPiBinaryPath),
    false,
    "the runtime-only Pi path must never serialize with the canonical resource manifest",
  );
  assert.deepEqual(teamResolved.isolatedResources, {
    extensionPaths: [await realpath(join(installed.get(subagentsEntry.source)!, subagentsEntry.extensionPath))],
  });
  assert.deepEqual(teamResolved.manifest, {
    profile: "team",
    packages: [
      {
        name: subagentsEntry.packageName,
        source: subagentsEntry.source,
        version: subagentsEntry.version,
        integrity: expectedTreeHashes[subagentsEntry.id],
      },
      ...expectedHostPeerManifests
        .filter(({ name }) => name === "@earendil-works/pi-ai" || name === "@earendil-works/pi-coding-agent")
        .map((manifest) => manifest),
    ],
    activeToolNames: [],
  }, "the Team profile must expose only pi-subagents and its active host peers");

  const originalPiHostIntegrity = teamResolved.manifest.packages.find(
    ({ name }) => name === "@earendil-works/pi-coding-agent",
  )!.integrity;
  await writeFile(expectedPiBinaryPath, "#!/usr/bin/env node\nconsole.log('tampered');\n");
  const changedPiHost = await resolveProfile("team");
  assert.equal(changedPiHost.verifiedPiBinaryPath, expectedPiBinaryPath);
  assert.notEqual(
    changedPiHost.manifest.packages.find(({ name }) => name === "@earendil-works/pi-coding-agent")!.integrity,
    originalPiHostIntegrity,
    "changing the bound Pi CLI must invalidate and recompute its attested host closure",
  );
  await writeFile(expectedPiBinaryPath, "#!/usr/bin/env node\nconsole.log('0.80.10');\n");
  await chmod(expectedPiBinaryPath, 0o644);
  await assert.rejects(
    () => resolveProfile("team"),
    /Pi executable is not executable/,
    "warm cache validation must not retain a Pi CLI that lost execute permission",
  );
  await chmod(expectedPiBinaryPath, 0o755);

  const teamProfilePath = join(root, ".pi", "agents", "la-team-translator.md");
  const teamExtensionPath = join(root, ".pi", "extensions", "team-evidence-child.ts");
  const scopedTeamTools = TEAM_EVIDENCE_TOOL_NAMES.slice(0, 2);
  await mkdir(join(teamProfilePath, ".."), { recursive: true });
  await mkdir(join(teamExtensionPath, ".."), { recursive: true });
  const writeTeamProfile = (suffix: string) => writeFile(teamProfilePath, [
    "---",
    "name: la-team-translator",
    `tools: ${TEAM_EVIDENCE_TOOL_NAMES.join(", ")}`,
    "extensions:",
    "subagentOnlyExtensions: .pi/extensions/team-evidence-child.ts",
    "systemPromptMode: replace",
    "inheritProjectContext: false",
    "inheritSkills: false",
    "defaultContext: fresh",
    "completionGuard: false",
    "---",
    `You are the Translator.${suffix}`,
  ].join("\n"));
  await writeTeamProfile("");
  await writeFile(teamExtensionPath, "export default function teamEvidenceChild() {}\n");
  const childShape = await buildTeamEvidenceChildRequestShape({
    repoRoot: root,
    roleIds: ["translator"],
    activeToolNames: [...scopedTeamTools],
  });
  const supervisorShape = buildCatRequestShape({
    systemPrompt: "Team supervisor",
    activeToolNames: ["subagent"],
    tools: [{ name: "subagent", description: "Spawn one selected Team child.", parameters: { type: "object" } }],
    resources: [],
  });
  const completeTeamManifest = composeTeamRunResourceManifest({
    packages: teamResolved.manifest.packages,
    supervisor: supervisorShape,
    children: childShape,
  });
  assert.deepEqual(completeTeamManifest.activeToolNames, ["batch_read", "subagent", "tm_lookup"]);
  assert.deepEqual(completeTeamManifest.requestShape, {
    schemaVersion: 2,
    systemPromptChars: supervisorShape.systemPromptChars + childShape.systemPromptChars,
    activeToolCount: 3,
    resourceCount: supervisorShape.resourceCount + childShape.resourceCount,
  });
  assert.match(completeTeamManifest.requestShapeHash ?? "", /^[a-f0-9]{64}$/);
  assert.match(completeTeamManifest.toolSurfaceHash ?? "", /^[a-f0-9]{64}$/);
  assert.match(completeTeamManifest.resourceIndexHash ?? "", /^[a-f0-9]{64}$/);
  const mainShape = buildCatRequestShape({
    systemPrompt: "Main Agent",
    activeToolNames: ["ask_user", "tm_lookup"],
    tools: [
      { name: "ask_user", description: "Ask one structured question.", parameters: { type: "object" } },
      { name: "tm_lookup", description: "Read translation memory.", parameters: { type: "object" } },
    ],
    resources: [],
  });
  const mainManifest = {
    profile: "main",
    packages: resolved.manifest.packages,
    activeToolNames: mainShape.activeToolNames,
    requestShapeHash: mainShape.requestShapeHash,
    systemPromptHash: mainShape.systemPromptHash,
    toolSurfaceHash: mainShape.toolSurfaceHash,
    resourceIndexHash: mainShape.resourceIndexHash,
    mainSurface: {
      packageNames: resolved.manifest.packages.map(({ name }) => name),
      requestShape: mainShape,
    },
  };
  const promotedManifest = composeTeamRunResourceManifest({
    packages: teamResolved.manifest.packages,
    supervisor: supervisorShape,
    children: childShape,
    previous: mainManifest,
  });
  assert.equal(promotedManifest.profile, "main+team");
  assert.deepEqual(promotedManifest.mainSurface, mainManifest.mainSurface);
  assert.deepEqual(promotedManifest.activeToolNames, ["ask_user", "batch_read", "subagent", "tm_lookup"]);
  assert.deepEqual(
    promotedManifest.packages.map(({ name }) => name),
    [...new Set([...mainManifest.packages, ...teamResolved.manifest.packages].map(({ name }) => name))],
  );
  assert.deepEqual(composeTeamRunResourceManifest({
    packages: teamResolved.manifest.packages,
    supervisor: supervisorShape,
    children: childShape,
    previous: promotedManifest,
  }), promotedManifest, "recomposing an unchanged promoted Run must be stable");
  const clearedProfile = composeTeamRunResourceManifest({
    packages: teamResolved.manifest.packages,
    supervisor: supervisorShape,
    children: childShape,
    profileRevision: null,
    profileHash: null,
    previous: { ...promotedManifest, profileRevision: 2, profileHash: "stale" },
  });
  assert.equal(clearedProfile.profileRevision, null);
  assert.equal(clearedProfile.profileHash, null);
  assert.throws(() => composeTeamRunResourceManifest({
    packages: teamResolved.manifest.packages,
    supervisor: supervisorShape,
    children: childShape,
    previous: { ...mainManifest, mainSurface: undefined },
  }), /legacy Main Run without mainSurface/);
  assert.throws(() => composeTeamRunResourceManifest({
    packages: [{ ...mainManifest.packages[0]!, version: "999.0.0" }],
    supervisor: supervisorShape,
    children: childShape,
    previous: mainManifest,
  }), /changed during Main to Team promotion/);
  await writeTeamProfile(" Changed.");
  const changedChildShape = await buildTeamEvidenceChildRequestShape({
    repoRoot: root,
    roleIds: ["translator"],
    activeToolNames: [...scopedTeamTools],
  });
  assert.notEqual(changedChildShape.requestShapeHash, childShape.requestShapeHash, "Team child prompt/resource changes must invalidate the Run request shape");
  await writeTeamProfile("");

  const projectPiSettingsPath = join(root, ".pi", "settings.json");
  await writeFile(projectPiSettingsPath, JSON.stringify({
    subagents: { agentOverrides: { "la-team-translator": { disabled: true } } },
  }));
  await assert.rejects(
    () => buildTeamEvidenceChildRequestShape({
      repoRoot: root,
      roleIds: ["translator"],
      activeToolNames: [...scopedTeamTools],
    }),
    /do not allow project Pi subagents settings or Agent overrides/,
    "project settings must not silently disable or rewrite a canonical Team Agent",
  );
  await writeFile(projectPiSettingsPath, "{}\n");

  const validProfile = await readFile(teamProfilePath, "utf8");
  await writeFile(teamProfilePath, validProfile.replace("extensions:\n", "extensions: .pi/extensions/rogue.ts\n"));
  await assert.rejects(
    () => buildTeamEvidenceChildRequestShape({
      repoRoot: root,
      roleIds: ["translator"],
      activeToolNames: [...scopedTeamTools],
    }),
    /must set extensions: \(empty\)/,
    "canonical Team profiles must fail closed instead of loading an unmanifested Extension",
  );
  await writeFile(teamProfilePath, validProfile);

  const globalSubagentConfig = join(root, "agent", "extensions", "subagent", "config.json");
  await mkdir(join(globalSubagentConfig, ".."), { recursive: true });
  await writeFile(globalSubagentConfig, JSON.stringify({ scheduledRuns: { enabled: true } }));
  await assert.rejects(
    () => resolveProfile("team"),
    /cannot inherit the user-global pi-subagents config/,
    "Team must fail closed instead of inheriting Package scheduling or budget state outside the Run manifest",
  );
  await rm(globalSubagentConfig, { force: true });

  const hostTuiRoot = hostPeerRoots["@earendil-works/pi-tui"]!;
  await rm(hostTuiRoot, { recursive: true, force: true });
  await assert.rejects(
    () => resolveMain(),
    /Required Pi host peer is not installed.*pi-tui/,
    "a declared Package host peer must resolve from the active Pi host",
  );
  await mkdir(hostTuiRoot, { recursive: true });
  await writeFile(join(hostTuiRoot, "package.json"), hostPeerPackageBytes["@earendil-works/pi-tui"]!);

  const hostTuiLockKey = hostTuiRoot.slice(root.length + 1);
  hostLockPackages[hostTuiLockKey]!.version = "0.79.0";
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: hostLockPackages }));
  await assert.rejects(
    () => resolveMain(),
    /Pi host peer lock mismatch.*pi-tui@0\.80\.10/,
    "the attested host peer version must match the active host lockfile",
  );
  hostLockPackages[hostTuiLockKey]!.version = hostPeerVersions["@earendil-works/pi-tui"]!;
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: hostLockPackages }));

  await writeFile(join(fixtureDependency, "index.js"), "export const fixtureDependency = false;\n");
  await assert.rejects(
    () => resolveProfile("team"),
    /package tree integrity mismatch.*pi-subagents/,
    "tampering a transitive runtime dependency must invalidate the Package closure",
  );
  await writeFile(join(fixtureDependency, "index.js"), "export const fixtureDependency = true;\n");

  const ask = NATIVE_CAPABILITY_PACKAGES.find(({ id }) => id === "ask")!;
  await assert.rejects(
    () => resolveTaskRunResources("main", {
      cwd: root,
      agentDir: join(root, "agent"),
      packageManager: { getInstalledPath: (source) => installed.get(source) },
    }),
    /patch target failed integrity.*pi-ask-headless-v1/,
    "production resolution must pin the tracked pi-ask headless patch when no test hash is injected",
  );

  await assert.rejects(
    () => resolveMain((source) => source === ask.source ? undefined : installed.get(source)),
    /not installed.*pi-ask/,
  );

  lockPackages[`node_modules/${ask.packageName}`]!.integrity = "sha512-not-the-approved-package";
  await writeFile(lockPath, JSON.stringify({ lockfileVersion: 3, packages: lockPackages }));
  await assert.rejects(
    () => resolveMain(),
    /integrity mismatch/,
  );

  lockPackages[`node_modules/${ask.packageName}`]!.integrity = ask.integrity;
  await writeFile(lockPath, JSON.stringify({ lockfileVersion: 3, packages: lockPackages }));
  const askRoot = installed.get(ask.source)!;
  await writeFile(join(askRoot, "package.json"), JSON.stringify({ name: ask.packageName, version: "9.9.9" }));
  await assert.rejects(
    () => resolveMain(),
    /identity mismatch.*pi-ask@1\.1\.0/,
  );

  await writeFile(join(askRoot, "package.json"), JSON.stringify({
    name: ask.packageName,
    version: ask.version,
    peerDependencies: fixturePeerDependencies[ask.id],
  }));
  const docparser = NATIVE_CAPABILITY_PACKAGES.find(({ id }) => id === "docparser")!;
  const docparserImported = join(installed.get(docparser.source)!, "src", "imported.ts");
  await writeFile(docparserImported, "export const docparserImported = false;\n");
  await assert.rejects(
    () => resolveMain(),
    /package tree integrity mismatch.*pi-docparser/,
    "tampering a non-entry imported file must invalidate the complete package tree",
  );
  await writeFile(docparserImported, `export const ${docparser.id}Imported = true;\n`);

  const askExtension = join(askRoot, ask.extensionPath);
  const askPatchedTarget = join(askRoot, testPatchTarget);
  await writeFile(askPatchedTarget, "export const tampered = true;\n");
  await assert.rejects(
    () => resolveMain(),
    /patch target failed integrity.*pi-ask-headless-v1/,
  );

  await writeFile(askPatchedTarget, `export const ${ask.id}HeadlessPatch = true;\n`);
  const outsideExtension = join(root, "outside-extension.ts");
  await rm(askExtension);
  await writeFile(outsideExtension, "export default function outside() {}\n");
  await symlink(outsideExtension, askExtension);
  await assert.rejects(
    () => resolveMain(),
    /extension escapes package root/,
  );

  await rm(askExtension);
  await assert.rejects(
    () => resolveMain(),
    /extension is missing/,
  );

  const globalFallback = join(root, "global", "node_modules", ...ask.packageName.split("/"));
  await mkdir(globalFallback, { recursive: true });
  await assert.rejects(
    () => resolveMain((source) => source === ask.source ? globalFallback : installed.get(source)),
    /outside the managed npm install root.*pi-ask/,
  );

  const replacementRoot = join(root, "replacement", ...ask.packageName.split("/"));
  await mkdir(join(replacementRoot, ask.extensionPath, ".."), { recursive: true });
  await writeFile(join(replacementRoot, "package.json"), JSON.stringify({ name: ask.packageName, version: ask.version }));
  await writeFile(join(replacementRoot, ask.extensionPath), `export default function ${ask.id}Extension() {}\n`);
  await rm(askRoot, { recursive: true, force: true });
  await symlink(replacementRoot, askRoot);
  await assert.rejects(
    () => resolveMain(),
    /package root was replaced or escaped managed npm.*pi-ask/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("task run resource tests passed");
