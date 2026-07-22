import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_SERVER_BASE_URL,
  browserWindowOptions,
  handshakeProblem,
  isAllowedExternalURL,
  isTrustedRendererURL,
  resolveAPIURL,
  resolveServerBaseURL,
  resolveWindowSize,
} from "../src/desktop-security.mjs";
import {
  importFilesDialogOptions,
  projectFolderDialogOptions,
  selectedImportFiles,
  selectedProjectFolder,
} from "../src/native-dialogs.mjs";

test("desktop shell keeps Node and navigation authority out of the renderer", () => {
  const options = browserWindowOptions("/tmp/preload.cjs");
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.webSecurity, true);
  assert.equal(options.webPreferences.preload, "/tmp/preload.cjs");
  assert.deepEqual(
    { width: options.width, height: options.height, minWidth: options.minWidth, minHeight: options.minHeight },
    { width: 1280, height: 820, minWidth: 480, minHeight: 600 },
  );
  assert.equal(isTrustedRendererURL("file:///app/index.html", "file:///app/index.html"), true);
  assert.equal(isTrustedRendererURL("https://example.com", "file:///app/index.html"), false);
});

test("acceptance window sizes are bounded while the production default stays stable", () => {
  assert.deepEqual(resolveWindowSize(["Linguist Agent"]), { width: 1280, height: 820 });
  assert.deepEqual(resolveWindowSize(["Linguist Agent", "--window-size=1024,700"]), { width: 1024, height: 700 });
  assert.deepEqual(resolveWindowSize(["Linguist Agent", "--window-size=320,200"]), { width: 480, height: 600 });
  assert.deepEqual(resolveWindowSize(["Linguist Agent", "--window-size=99999,99999"]), { width: 4096, height: 4096 });
  assert.deepEqual(resolveWindowSize(["Linguist Agent", "--window-size=bad"]), { width: 1280, height: 820 });
});

test("runtime endpoint cannot escape loopback", () => {
  assert.equal(resolveServerBaseURL({}), DEFAULT_SERVER_BASE_URL);
  assert.equal(resolveServerBaseURL({ LA_MAC_LOCAL_SERVER_URL: "http://localhost:18787" }), "http://localhost:18787");
  assert.equal(resolveServerBaseURL({ LA_MAC_LOCAL_SERVER_URL: "https://example.com:8787" }), DEFAULT_SERVER_BASE_URL);
  assert.equal(resolveServerBaseURL({ LA_MAC_LOCAL_SERVER_URL: "http://127.0.0.1:8787/private" }), DEFAULT_SERVER_BASE_URL);
  assert.equal(resolveServerBaseURL({ LA_MAC_LOCAL_SERVER_URL: "http://token@127.0.0.1:8787" }), DEFAULT_SERVER_BASE_URL);
  assert.equal(resolveAPIURL(DEFAULT_SERVER_BASE_URL, "/api/projects"), "http://127.0.0.1:8787/api/projects");
  assert.throws(() => resolveAPIURL(DEFAULT_SERVER_BASE_URL, "//example.com/api/projects"));
  assert.throws(() => resolveAPIURL(DEFAULT_SERVER_BASE_URL, "/settings"));
});

test("external navigation is limited to credential-free HTTPS URLs", () => {
  assert.equal(isAllowedExternalURL("https://auth.example.com/device?code=123"), true);
  assert.equal(isAllowedExternalURL("http://auth.example.com"), false);
  assert.equal(isAllowedExternalURL("https://user:secret@auth.example.com"), false);
  assert.equal(isAllowedExternalURL("file:///private/customer"), false);
});

test("Pi OAuth UI delegates only credential-free verification links to the trusted shell", async () => {
  const settings = await readFile(new URL("../src/renderer/settings/SettingsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(settings, /window\.linguist\.system\.openExternal\(event\.url!\)/);
  assert.match(settings, /window\.linguist\.system\.openExternal\(event\.verificationUri!\)/);
  assert.doesNotMatch(settings, /auth\.json|accessToken/);
});

test("health compatibility requires the canonical native capabilities", () => {
  const health = {
    ok: true,
    apiProtocolVersion: 2,
    authRequired: true,
    dataSchemaVersion: 2,
    runtimeInstanceId: "runtime",
    capabilities: ["local-auth", "native-extension-ui-v1", "run-resource-profile-v1", "runtime-migrations", "task-workspace-v2"],
  };
  assert.equal(handshakeProblem(health), null);
  assert.match(handshakeProblem({ ...health, capabilities: ["local-auth"] }), /缺少能力/);
  assert.match(handshakeProblem({ ...health, authRequired: false }), /本地认证/);
});

test("native pickers require explicit user selection and never probe a default folder", () => {
  const project = projectFolderDialogOptions();
  assert.deepEqual(project.properties, ["openDirectory", "createDirectory"]);
  assert.equal("defaultPath" in project, false);

  const batch = importFilesDialogOptions("batch");
  const asset = importFilesDialogOptions("asset");
  assert.deepEqual(batch.properties, ["openFile", "multiSelections"]);
  assert.equal(batch.filters[0].extensions.includes("mxliff"), true);
  assert.equal(asset.filters[0].extensions.includes("pdf"), true);
  assert.equal(asset.filters[0].extensions.includes("tmx"), true);
  assert.equal("defaultPath" in batch, false);
  assert.throws(() => importFilesDialogOptions("unknown"));

  assert.equal(selectedProjectFolder({ canceled: true, filePaths: ["/private/customer"] }), null);
  assert.equal(selectedProjectFolder({ canceled: false, filePaths: ["/private/customer"] }), "/private/customer");
  assert.deepEqual(selectedImportFiles({ canceled: true, filePaths: ["/private/customer/file.xlf"] }), []);
  assert.deepEqual(selectedImportFiles({ canceled: false, filePaths: ["/private/customer/file.xlf"] }), ["/private/customer/file.xlf"]);
});

test("renderer can only request the fixed managed runtime repair action", async () => {
  const [main, preload, installer] = await Promise.all([
    readFile(new URL("../src/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/preload.cjs", import.meta.url), "utf8"),
    readFile(new URL("../src/runtime-installer.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(main, /ipcMain\.handle\("runtime:install-or-repair", async \(event\) => \{\s*requireTrustedRenderer\(event\);\s*return runtimeInstaller\.installOrRepair\(\);/);
  assert.match(preload, /installOrRepair: \(\) => ipcRenderer\.invoke\("runtime:install-or-repair"\)/);
  assert.match(main, /ipcMain\.handle\("runtime:install-candidate", async \(event, input\) => \{\s*requireTrustedRenderer\(event\);\s*return runtimeInstaller\.installCandidate\(input\);/);
  assert.match(preload, /installCandidate: \(input\) => ipcRenderer\.invoke\("runtime:install-candidate", input\)/);
  assert.match(preload, /openExternal: \(url\) => ipcRenderer\.invoke\("system:open-external", url\)/);
  assert.match(main, /ipcMain\.handle\("system:export-rich-artifact", async \(event, value\) => \{\s*requireTrustedRenderer\(event\);\s*return exportRichArtifact\(value, \{/);
  assert.match(preload, /exportRichArtifact: \(input\) => ipcRenderer\.invoke\("system:export-rich-artifact", input\)/);
  assert.match(installer, /"Library", "Application Support", "Linguist Agent"/);
  assert.match(installer, /join\(resourcesPath, "runtime"\)/);
  assert.match(installer, /http:\/\/127\.0\.0\.1:8787\/api\/health/);
  assert.doesNotMatch(preload, /installOrRepair: \([^)]*[a-zA-Z][^)]*\)/);
  assert.doesNotMatch(installer, /Desktop\/linguist-agent/);
});
