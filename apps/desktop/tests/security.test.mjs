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
    capabilities: ["local-auth", "authenticated-unix-rendezvous-v1", "native-extension-ui-v1", "run-resource-profile-v1", "runtime-migrations", "task-workspace-v2"],
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
  const lapkg = importFilesDialogOptions("lapkg");
  assert.deepEqual(batch.properties, ["openFile", "multiSelections"]);
  assert.equal(batch.filters[0].extensions.includes("mxliff"), true);
  assert.equal(asset.filters[0].extensions.includes("pdf"), true);
  assert.equal(asset.filters[0].extensions.includes("tmx"), true);
  assert.deepEqual(lapkg.properties, ["openFile"]);
  assert.deepEqual(lapkg.filters[0].extensions, ["lapkg"]);
  assert.equal("defaultPath" in batch, false);
  assert.throws(() => importFilesDialogOptions("unknown"));

  assert.equal(selectedProjectFolder({ canceled: true, filePaths: ["/private/customer"] }), null);
  assert.equal(selectedProjectFolder({ canceled: false, filePaths: ["/private/customer"] }), "/private/customer");
  assert.deepEqual(selectedImportFiles({ canceled: true, filePaths: ["/private/customer/file.xlf"] }), []);
  assert.deepEqual(selectedImportFiles({ canceled: false, filePaths: ["/private/customer/file.xlf"] }), ["/private/customer/file.xlf"]);
});

test("Stable Package Center exposes only signed declarative activation", async () => {
  const client = await readFile(new URL("../src/renderer/data/workspace-client.ts", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/renderer/settings/SettingsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(client, /\/api\/package-center\/lapkg\/preview/u);
  assert.match(client, /\/api\/package-center\/lapkg\/activate/u);
  assert.doesNotMatch(client, /\/api\/package-center\/install(?:\/preview)?["`]/u);
  assert.match(settings, /discovery only/u);
  assert.match(settings, /不会执行本机代码/u);
  assert.doesNotMatch(settings, /previewManagedPackageInstall|installManagedPackage/u);
});

test("renderer can only request fixed managed runtime actions with opaque candidate handles", async () => {
  const [contract, main, preload, installer] = await Promise.all([
    readFile(new URL("../src/ipc-contract.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/runtime-installer.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(contract, /runtimeInstallOrRepair: "runtime:install-or-repair"/);
  assert.match(contract, /runtimeRestart: "runtime:restart"/);
  assert.match(contract, /runtimeInstallCandidate: "runtime:install-candidate"/);
  assert.match(contract, /openExternal: "system:open-external"/);
  assert.match(main, /ipcMain\.handle\(IPC_CHANNELS\.runtimeInstallOrRepair, async \(event\) => \{\s*requireTrustedRenderer\(event\);\s*return runtimeInstaller\.installOrRepair\(\);/);
  assert.match(preload, /installOrRepair: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.runtimeInstallOrRepair\)/);
  assert.match(main, /ipcMain\.handle\(IPC_CHANNELS\.runtimeRestart, async \(event\) => \{\s*requireTrustedRenderer\(event\);\s*return runtimeInstaller\.restart\(\);/);
  assert.match(preload, /restart: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.runtimeRestart\)/);
  assert.match(main, /nativeFileHandles\.resolve\(candidateHandle, "maintenance-candidate"\)/);
  assert.match(preload, /installCandidate: \(input: unknown\) => ipcRenderer\.invoke\(IPC_CHANNELS\.runtimeInstallCandidate, runtimeCandidateInput\(input\)\)/);
  assert.match(preload, /openExternal: \(url: unknown\) => ipcRenderer\.invoke\(IPC_CHANNELS\.openExternal, url\)/);
  assert.match(main, /const result = await exportRichArtifact\(value, \{/);
  assert.match(main, /nativeFileHandles\.issue\(result\.path, "export"\)/);
  assert.match(preload, /exportRichArtifact: \(input: unknown\) => ipcRenderer\.invoke\(IPC_CHANNELS\.exportRichArtifact, input\)/);
  assert.match(installer, /"Library", "Application Support", "Linguist Agent"/);
  assert.match(installer, /join\(resourcesPath, "runtime"\)/);
  assert.match(installer, /inspectRuntime\(\)/);
  assert.doesNotMatch(installer, /http:\/\/127\.0\.0\.1:8787\/api\/health/);
  assert.doesNotMatch(preload, /installOrRepair: \([^)]*[a-zA-Z][^)]*\)/);
  assert.doesNotMatch(installer, /Desktop\/linguist-agent/);
});

test("renderer native operations use opaque IDs or handles and never submit arbitrary local paths", async () => {
  const [contract, main, preload, client, desktopTypes, onboarding, assets, sidebar] = await Promise.all([
    readFile(new URL("../src/ipc-contract.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/data/workspace-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/desktop.d.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/onboarding/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/assets/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/workspace/WorkspaceSidebar.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(contract, /refreshProjectAssets: "system:refresh-project-assets"/);
  assert.match(contract, /revealProject: "system:reveal-project"/);
  assert.match(contract, /revealMaintenanceCandidate: "system:reveal-maintenance-candidate"/);
  assert.doesNotMatch(contract, /revealPath/);
  assert.match(main, /resolveNativeWorkspaceRequest/);
  assert.match(main, /must use a native file handle, not filePath/);
  assert.match(main, /resolveProjectAssets\(selected, project\.root\)/);
  assert.match(preload, /projectAssetRefreshInput/);
  assert.match(desktopTypes, /pickProjectFolder\(\): Promise<NativeFileHandle \| null>/);
  assert.match(desktopTypes, /pickImportFiles\(kind: ImportKind\): Promise<NativeFileHandle\[\]>/);
  assert.doesNotMatch(desktopTypes, /revealPath/);
  assert.match(client, /rootHandle: NativeFileHandle/);
  assert.match(client, /fileHandle: NativeFileHandle/);
  assert.match(client, /sourceHandles: NativeFileHandle\[\]/);
  assert.doesNotMatch(onboarding, /rootPath/);
  assert.doesNotMatch(assets, /rootPath|filePath/);
  assert.match(sidebar, /revealProject\(\{ projectId: project\.projectId \}\)/);
});

test("renderer workspace transport admits only declared capabilities", async () => {
  const [contract, main, preload, client] = await Promise.all([
    readFile(new URL("../src/ipc-contract.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/data/workspace-client.ts", import.meta.url), "utf8"),
  ]);
  assert.match(contract, /workspaceCapability: "api:workspace-capability"/u);
  assert.match(main, /IPC_CHANNELS\.workspaceCapability/u);
  assert.match(main, /resolveWorkspaceCapabilityRequest\(input\)/u);
  assert.match(preload, /invokeWorkspaceCapability/u);
  assert.match(preload, /resolveWorkspaceCapabilityRequest\(input\)/u);
  assert.match(client, /workspaceCapabilityFor\(method, path\)/u);
  assert.doesNotMatch(contract, /apiRequest/u);
  assert.doesNotMatch(main, /requestRuntime\(input\)/u);
  assert.doesNotMatch(preload, /request:\s*\(input/u);
  assert.doesNotMatch(client, /api\.request/u);
});
