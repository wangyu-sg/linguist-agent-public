import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { prepareNativeCapabilityAgentDir } from "../scripts/prepare-native-capabilities.mjs";

test("local acceptance stages Packages in Pi's canonical agentDir/npm layout and reuses only verified inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-native-capability-runtime-"));
  const sourceRoot = join(root, "source");
  const patchRoot = join(root, "patch");
  const agentDir = join(root, "agent");
  const dependencies = {
    "@earendil-works/pi-tui": "0.80.10",
    "@eko24ive/pi-ask": "1.1.0",
    "pi-docparser": "3.0.1",
    "pi-subagents": "0.35.1",
  };
  await mkdir(join(patchRoot, "src"), { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, "package.json"), `${JSON.stringify({ name: "fixture", dependencies })}\n`);
  await writeFile(join(sourceRoot, "package-lock.json"), `${JSON.stringify({ lockfileVersion: 3, packages: {} })}\n`);
  await writeFile(join(patchRoot, "src", "index.ts"), "// headless index v1\n");
  await writeFile(join(patchRoot, "src", "ask-tool.ts"), "// headless ask v1\n");

  let installs = 0;
  const execute = async (command, args, options) => {
    assert.equal(command, "npm");
    assert.deepEqual(args, ["ci", "--omit=dev", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"]);
    installs += 1;
    for (const [name, version] of Object.entries(dependencies)) {
      const packageRoot = join(options.cwd, "node_modules", ...name.split("/"));
      await mkdir(packageRoot, { recursive: true });
      await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name, version })}\n`);
    }
    return { stdout: "", stderr: "" };
  };

  const patches = [{ packageName: "@eko24ive/pi-ask", root: patchRoot, files: ["src/index.ts", "src/ask-tool.ts"] }];
  const first = await prepareNativeCapabilityAgentDir({ sourceRoot, agentDir, execute, patches });
  assert.equal(first.reused, false);
  assert.equal(installs, 1);
  const manager = new DefaultPackageManager({
    cwd: root,
    agentDir,
    settingsManager: SettingsManager.create(root, agentDir),
  });
  assert.equal(manager.getInstalledPath("npm:pi-docparser@3.0.1", "user"), join(agentDir, "npm", "node_modules", "pi-docparser"));
  assert.equal(
    await readFile(join(agentDir, "npm", "node_modules", "@eko24ive", "pi-ask", "src", "ask-tool.ts"), "utf8"),
    "// headless ask v1\n",
  );

  const reused = await prepareNativeCapabilityAgentDir({ sourceRoot, agentDir, execute, patches });
  assert.equal(reused.reused, true);
  assert.equal(installs, 1);

  await writeFile(join(patchRoot, "src", "ask-tool.ts"), "// headless ask v2\n");
  const refreshed = await prepareNativeCapabilityAgentDir({ sourceRoot, agentDir, execute, patches });
  assert.equal(refreshed.reused, false);
  assert.equal(installs, 2);
  assert.equal(
    await readFile(join(agentDir, "npm", "node_modules", "@eko24ive", "pi-ask", "src", "ask-tool.ts"), "utf8"),
    "// headless ask v2\n",
  );
});

test("the packaged Research overlay loads headlessly and rejects local, video, and media paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "la-native-research-load-"));
  const repoRoot = resolve(import.meta.dirname, "../../..");
  const previousHome = process.env.HOME;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  try {
    const prepared = await prepareNativeCapabilityAgentDir({ agentDir: join(root, "agent") });
    const packageRoot = join(root, "research-package");
    await cp(join(prepared.npmRoot, "node_modules", "pi-web-access"), packageRoot, { recursive: true });
    const peerRoot = join(packageRoot, "node_modules");
    await mkdir(join(peerRoot, "@earendil-works"), { recursive: true });
    for (const name of ["pi-ai", "pi-coding-agent"]) {
      await symlink(
        join(repoRoot, "node_modules", "@earendil-works", name),
        join(peerRoot, "@earendil-works", name),
        "dir",
      );
    }
    await symlink(
      join(prepared.npmRoot, "node_modules", "@earendil-works", "pi-tui"),
      join(peerRoot, "@earendil-works", "pi-tui"),
      "dir",
    );
    await symlink(join(repoRoot, "node_modules", "typebox"), join(peerRoot, "typebox"), "dir");
    for (const name of ["linkedom", "p-limit", "turndown", "unpdf"]) {
      await symlink(join(prepared.npmRoot, "node_modules", name), join(peerRoot, name), "dir");
    }
    await mkdir(join(peerRoot, "@mozilla"), { recursive: true });
    await symlink(
      join(prepared.npmRoot, "node_modules", "@mozilla", "readability"),
      join(peerRoot, "@mozilla", "readability"),
      "dir",
    );
    process.env.HOME = root;
    process.env.XDG_CONFIG_HOME = join(root, "config");
    const module = await import(`${pathToFileURL(join(packageRoot, "la-headless.ts")).href}?acceptance=${Date.now()}`);
    const tools = new Map();
    const commands = [];
    const shortcuts = [];
    module.default({
      registerTool: (tool) => tools.set(tool.name, tool),
      registerCommand: (...args) => commands.push(args),
      registerShortcut: (...args) => shortcuts.push(args),
      on: () => undefined,
      appendEntry: () => undefined,
      sendMessage: () => undefined,
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    });
    assert.deepEqual([...tools.keys()].sort(), ["fetch_content", "get_search_content", "web_search"]);
    assert.equal(commands.length, 0, "Research wrapper must not expose curator or browser commands");
    assert.equal(shortcuts.length, 0, "Research wrapper must not expose browser shortcuts");
    assert.match(tools.get("web_search").description, /browser-cookie auth, Gemini Web, and media upload are disabled/);

    const fetchContent = tools.get("fetch_content");
    for (const params of [
      { url: "file:///Users/private.txt" },
      { url: "http://example.com" },
      { url: "https://www.youtube.com/watch?v=abc" },
      { url: "https://example.com", prompt: "inspect the video" },
      { url: "https://example.com", timestamp: "00:10" },
      { url: "https://example.com", frames: 2 },
      { url: "https://example.com", model: "gemini-2.5-flash" },
    ]) {
      await assert.rejects(
        fetchContent.execute("research-test", params, undefined, undefined, {}),
        /Native Research|media upload|HTTPS URLs/,
      );
    }
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    await rm(root, { recursive: true, force: true });
  }
});
