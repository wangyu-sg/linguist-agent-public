import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { browserWindowOptions, isAllowedExternalURL, isTrustedRendererURL, resolveWindowSize } from "./desktop-security.mjs";
import {
  importFilesDialogOptions,
  projectFolderDialogOptions,
  selectedImportFiles,
  selectedProjectFolder,
} from "./native-dialogs.mjs";
import { inspectRuntime, requestRuntime, streamStandaloneChat, streamTaskChat, streamTaskEvents } from "./runtime-client.mjs";
import { createManagedRuntimeInstaller } from "./runtime-installer.mjs";
import { parseNotificationCandidate } from "./notification-policy.mjs";
import { exportRichArtifact } from "./rich-artifact-export.mjs";
import { createNativeFileHandleRegistry } from "./native-file-handles.mjs";
import {
  APP_COMMANDS,
  IPC_CHANNELS,
  requireNativeFileHandle,
  requireOpaqueId,
  resolveWorkspaceCapabilityRequest,
  type AppCommand,
} from "./ipc-contract.cjs";

let mainWindow: BrowserWindow | undefined;
let trustedRendererURL: string | undefined;
const streams = new Map<string, AbortController>();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const RENDERER_COMMANDS = new Set<AppCommand>(APP_COMMANDS);

function requireTrustedRenderer(event: IpcMainEvent | IpcMainInvokeEvent) {
  if (!trustedRendererURL || !isTrustedRendererURL(event.senderFrame?.url ?? "", trustedRendererURL)) {
    throw new Error("Untrusted renderer.");
  }
}

function streamKey(sender: WebContents, id: string) {
  return `${sender.id}:${id}`;
}

function startStream(
  event: IpcMainEvent,
  message: unknown,
  run: (input: unknown, callbacks: {
    signal: AbortSignal;
    onEvent: (value: unknown) => void;
    onState: (value: unknown) => void;
  }) => Promise<unknown>,
) {
  requireTrustedRenderer(event);
  const payload = message && typeof message === "object" && !Array.isArray(message)
    ? message as Record<string, unknown>
    : {};
  const id = typeof payload.id === "string" && payload.id.length <= 128 ? payload.id : "";
  if (!id) return;
  const key = streamKey(event.sender, id);
  streams.get(key)?.abort();
  const controller = new AbortController();
  streams.set(key, controller);
  const send = (kind: "event" | "state", value: unknown) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.streamUpdate, { id, kind, value });
  };
  void run(payload.input, {
    signal: controller.signal,
    onEvent: (value) => send("event", value),
    onState: (value) => send("state", value),
  }).catch((error) => send("state", { status: "error", message: error instanceof Error ? error.message : "Desktop stream failed." }))
    .finally(() => streams.delete(key));
}

function cancelSenderStreams(sender: WebContents) {
  const prefix = `${sender.id}:`;
  for (const [key, controller] of streams) {
    if (!key.startsWith(prefix)) continue;
    controller.abort();
    streams.delete(key);
  }
}

function installMenu() {
  const sendCommand = (command: AppCommand) => {
    if (!RENDERER_COMMANDS.has(command) || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(IPC_CHANNELS.appCommand, command);
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Linguist Agent",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "设置…", accelerator: "CommandOrControl+,", click: () => sendCommand("show-settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "文件",
      submenu: [
        { label: "创建项目…", accelerator: "CommandOrControl+N", click: () => sendCommand("new-project") },
        { label: "导入批次…", accelerator: "CommandOrControl+Shift+B", click: () => sendCommand("import-batch") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "Task",
      submenu: [
        { label: "显示对话", accelerator: "CommandOrControl+1", click: () => sendCommand("show-conversation") },
        { label: "显示 CAT", accelerator: "CommandOrControl+2", click: () => sendCommand("show-cat") },
        { type: "separator" },
        { label: "停止当前运行", accelerator: "CommandOrControl+.", click: () => sendCommand("stop-run") },
      ],
    },
    {
      label: "显示",
      submenu: [
        { label: "搜索项目与命令…", accelerator: "CommandOrControl+K", click: () => sendCommand("show-command-palette") },
        { type: "separator" },
        { label: "切换项目侧边栏", accelerator: "CommandOrControl+Control+S", click: () => sendCommand("toggle-sidebar") },
        { label: "切换上下文检查器", accelerator: "CommandOrControl+Shift+I", click: () => sendCommand("toggle-inspector") },
        { type: "separator" },
        { label: "跟随系统外观", type: "radio", checked: nativeTheme.themeSource === "system", click: () => { nativeTheme.themeSource = "system"; } },
        { label: "浅色外观", type: "radio", checked: nativeTheme.themeSource === "light", click: () => { nativeTheme.themeSource = "light"; } },
        { label: "深色外观", type: "radio", checked: nativeTheme.themeSource === "dark", click: () => { nativeTheme.themeSource = "dark"; } },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ]));
}

async function showOpenDialog(event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requiredBody(value: unknown, label: string): Record<string, unknown> {
  return record(value, `${label} requires an object body.`);
}

function nativeHandles(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error(`${label} requires between one and 64 native file handles.`);
  }
  return value.map(requireNativeFileHandle);
}

function opaqueString(value: unknown, label: string): string {
  return requireOpaqueId(value, label);
}

type CanonicalProject = Readonly<{
  root: string;
  projectName: string;
  sourceLanguage: string;
  targetLanguage: string;
}>;

async function canonicalProject(projectId: string): Promise<CanonicalProject> {
  const response = await requestRuntime({ method: "GET", path: `/api/projects/${encodeURIComponent(projectId)}` });
  if (!response.ok) throw new Error("Canonical Project could not be resolved for this native operation.");
  const data = record(response.data, "Canonical Project response is invalid.");
  const manifest = record(data.manifest, "Canonical Project manifest is invalid.");
  const root = typeof manifest.root === "string" && manifest.root.trim() ? manifest.root : null;
  const projectName = typeof manifest.projectName === "string" && manifest.projectName.trim() ? manifest.projectName : null;
  const sourceLanguage = typeof manifest.sourceLanguage === "string" && manifest.sourceLanguage.trim() ? manifest.sourceLanguage : null;
  const targetLanguage = typeof manifest.targetLanguage === "string" && manifest.targetLanguage.trim() ? manifest.targetLanguage : null;
  if (!root || !projectName || !sourceLanguage || !targetLanguage) throw new Error("Canonical Project manifest is incomplete.");
  return { root, projectName, sourceLanguage, targetLanguage };
}

async function resolveNativeWorkspaceRequest(
  value: unknown,
  handles: ReturnType<typeof createNativeFileHandleRegistry>,
) {
  const input = record(value, "Workspace capability input must be an object.");
  const capability = typeof input.capability === "string" ? input.capability : "";
  const request = resolveWorkspaceCapabilityRequest(input);
  const body = request.body;

  if (capability === "projects-create") {
    const source = requiredBody(body, "Project creation");
    if (hasOwn(source, "rootPath")) throw new Error("Project creation must use a native folder handle, not rootPath.");
    const rootHandle = requireNativeFileHandle(source.rootHandle);
    const { rootHandle: _rootHandle, ...rest } = source;
    return { ...request, body: { ...rest, rootPath: await handles.resolve(rootHandle, "project-folder") } };
  }
  if (capability === "batch-import") {
    const source = requiredBody(body, "Batch import");
    if (hasOwn(source, "filePath")) throw new Error("Batch import must use a native file handle, not filePath.");
    const fileHandle = requireNativeFileHandle(source.fileHandle);
    const { fileHandle: _fileHandle, ...rest } = source;
    return { ...request, body: { ...rest, filePath: await handles.resolve(fileHandle, "batch") } };
  }
  if (capability === "package-lapkg-write") {
    const source = requiredBody(body, "Package operation");
    if (hasOwn(source, "archivePath")) throw new Error("Package operation must use a native file handle, not archivePath.");
    const archiveHandle = requireNativeFileHandle(source.archiveHandle);
    const { archiveHandle: _archiveHandle, ...rest } = source;
    return { ...request, body: { ...rest, archivePath: await handles.resolve(archiveHandle, "lapkg") } };
  }
  if (capability === "library-write" && request.path === "/api/library/import") {
    const source = requiredBody(body, "Library import");
    if (hasOwn(source, "sourcePaths")) throw new Error("Library import must use native file handles, not sourcePaths.");
    const sourceHandles = nativeHandles(source.sourceHandles, "Library import");
    const { sourceHandles: _sourceHandles, ...rest } = source;
    return { ...request, body: { ...rest, sourcePaths: await Promise.all(sourceHandles.map((handle) => handles.resolve(handle, "asset"))) } };
  }
  if (capability === "document-evidence") {
    const source = requiredBody(body, "Document evidence extraction");
    if (hasOwn(source, "sourcePath")) throw new Error("Document evidence extraction must use a native file handle, not sourcePath.");
    const sourceHandle = requireNativeFileHandle(source.sourceHandle);
    const { sourceHandle: _sourceHandle, ...rest } = source;
    return { ...request, body: { ...rest, sourcePath: await handles.resolve(sourceHandle, "asset") } };
  }
  if (capability === "chat-file-grant-write" && request.path.endsWith("/file-grants")) {
    const source = requiredBody(body, "Chat file grant");
    if (hasOwn(source, "path")) throw new Error("Chat file grant must use a native file handle, not path.");
    const fileHandle = requireNativeFileHandle(source.fileHandle);
    const grantKind = source.kind === "directory" ? "project-folder" : source.kind === "file" ? "asset" : null;
    if (!grantKind) throw new Error("Chat file grant kind is invalid.");
    const { fileHandle: _fileHandle, ...rest } = source;
    return { ...request, body: { ...rest, path: await handles.resolve(fileHandle, grantKind) } };
  }
  return request;
}

async function redactNativeWorkspaceResponse(
  value: unknown,
  response: Awaited<ReturnType<typeof requestRuntime>>,
  handles: ReturnType<typeof createNativeFileHandleRegistry>,
) {
  const input = record(value, "Workspace capability input must be an object.");
  if (input.capability !== "chat-maintenance-write" || typeof input.path !== "string" || !input.path.endsWith("/maintenance/activate") || !response.ok) return response;
  const data = record(response.data, "Maintenance response is invalid.");
  const handoff = record(data.handoff, "Maintenance handoff is invalid.");
  if (handoff.action === "electron_runtime_installer" && typeof handoff.candidateBundleRoot === "string") {
    const candidateHandle = await handles.issue(handoff.candidateBundleRoot, "maintenance-candidate");
    const { candidateBundleRoot: _candidateBundleRoot, ...rest } = handoff;
    return { ...response, data: { ...data, handoff: { ...rest, candidateHandle } } };
  }
  if (handoff.action === "install_full_app_candidate" && typeof handoff.candidateAppPath === "string") {
    const candidateHandle = await handles.issue(handoff.candidateAppPath, "maintenance-candidate");
    const { candidateAppPath: _candidateAppPath, ...rest } = handoff;
    return { ...response, data: { ...data, handoff: { ...rest, candidateHandle } } };
  }
  return response;
}

function createWindow() {
  const rendererFile = join(app.getAppPath(), "dist", "renderer", "index.html");
  trustedRendererURL = pathToFileURL(rendererFile).href;
  const windowSize = resolveWindowSize() as { width: number; height: number };
  const window = new BrowserWindow(browserWindowOptions(
    join(app.getAppPath(), "dist", "electron", "preload.cjs"),
    nativeTheme.shouldUseDarkColors,
    windowSize,
  ));
  const contents = window.webContents;

  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererURL(url, trustedRendererURL)) event.preventDefault();
  });
  contents.on("render-process-gone", () => cancelSenderStreams(contents));
  window.on("closed", () => cancelSenderStreams(contents));
  window.once("ready-to-show", () => window.show());
  void window.loadFile(rendererFile);
  return window;
}

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

if (hasSingleInstanceLock) app.whenReady().then(() => {
  app.setName("Linguist Agent");
  const runtimeInstaller = createManagedRuntimeInstaller({ resourcesPath: process.resourcesPath });
  const nativeFileHandles = createNativeFileHandleRegistry();
  ipcMain.handle(IPC_CHANNELS.runtimeStatus, async (event) => {
    requireTrustedRenderer(event);
    return inspectRuntime();
  });
  ipcMain.handle(IPC_CHANNELS.runtimeInstallOrRepair, async (event) => {
    requireTrustedRenderer(event);
    return runtimeInstaller.installOrRepair();
  });
  ipcMain.handle(IPC_CHANNELS.runtimeRestart, async (event) => {
    requireTrustedRenderer(event);
    return runtimeInstaller.restart();
  });
  ipcMain.handle(IPC_CHANNELS.runtimeInstallCandidate, async (event, input) => {
    requireTrustedRenderer(event);
    const source = record(input, "Runtime candidate input must be an object.");
    if (Object.keys(source).some((key) => key !== "candidateHandle")) throw new Error("Runtime candidate input contains an unsupported field.");
    const candidateHandle = requireNativeFileHandle(source.candidateHandle);
    return runtimeInstaller.installCandidate({ bundleRoot: await nativeFileHandles.resolve(candidateHandle, "maintenance-candidate") });
  });
  ipcMain.handle(IPC_CHANNELS.workspaceCapability, async (event, input) => {
    requireTrustedRenderer(event);
    const response = await requestRuntime(await resolveNativeWorkspaceRequest(input, nativeFileHandles));
    return redactNativeWorkspaceResponse(input, response, nativeFileHandles);
  });
  ipcMain.handle(IPC_CHANNELS.pickProjectFolder, async (event) => {
    requireTrustedRenderer(event);
    const selected = selectedProjectFolder(await showOpenDialog(event, projectFolderDialogOptions() as Electron.OpenDialogOptions));
    return selected ? nativeFileHandles.issue(selected, "project-folder") : null;
  });
  ipcMain.handle(IPC_CHANNELS.pickImportFiles, async (event, kind) => {
    requireTrustedRenderer(event);
    const selectionKind = kind === "batch" ? "batch" : kind === "asset" ? "asset" : kind === "lapkg" ? "lapkg" : null;
    if (!selectionKind) throw new Error("Unsupported import kind.");
    const selected = selectedImportFiles(await showOpenDialog(event, importFilesDialogOptions(kind) as Electron.OpenDialogOptions));
    return Promise.all(selected.map((path: string) => nativeFileHandles.issue(path, selectionKind)));
  });
  ipcMain.handle(IPC_CHANNELS.refreshProjectAssets, async (event, input) => {
    requireTrustedRenderer(event);
    const source = record(input, "Project asset refresh input must be an object.");
    if (Object.keys(source).some((key) => key !== "projectId" && key !== "handles")) {
      throw new Error("Project asset refresh input contains an unsupported field.");
    }
    const projectId = opaqueString(source.projectId, "Project id");
    const selected = nativeHandles(source.handles, "Project asset refresh");
    const project = await canonicalProject(projectId);
    const files = await nativeFileHandles.resolveProjectAssets(selected, project.root);
    const response = await requestRuntime({
      method: "POST",
      path: "/api/projects",
      body: {
        projectId,
        rootPath: project.root,
        projectName: project.projectName,
        sourceLanguage: project.sourceLanguage,
        targetLanguage: project.targetLanguage,
      },
    });
    if (!response.ok) throw new Error("Canonical Project asset refresh failed.");
    return { files };
  });
  ipcMain.handle(IPC_CHANNELS.openExternal, async (event, value) => {
    requireTrustedRenderer(event);
    if (!isAllowedExternalURL(value)) throw new Error("Only credential-free HTTPS links can be opened externally.");
    await shell.openExternal(value, { activate: true });
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.revealProject, async (event, value) => {
    requireTrustedRenderer(event);
    const source = record(value, "Project reveal input must be an object.");
    if (Object.keys(source).some((key) => key !== "projectId")) throw new Error("Project reveal input contains an unsupported field.");
    const project = await canonicalProject(opaqueString(source.projectId, "Project id"));
    shell.showItemInFolder(project.root);
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.revealMaintenanceCandidate, async (event, value) => {
    requireTrustedRenderer(event);
    const source = record(value, "Maintenance candidate reveal input must be an object.");
    if (Object.keys(source).some((key) => key !== "candidateHandle")) throw new Error("Maintenance candidate reveal input contains an unsupported field.");
    shell.showItemInFolder(await nativeFileHandles.resolve(requireNativeFileHandle(source.candidateHandle), "maintenance-candidate"));
    return true;
  });
  ipcMain.handle(IPC_CHANNELS.exportRichArtifact, async (event, value) => {
    requireTrustedRenderer(event);
    const result = await exportRichArtifact(value, {
      BrowserWindow,
      dialog,
      owner: BrowserWindow.fromWebContents(event.sender),
    });
    if (result.canceled || !result.path) return result;
    const file = await nativeFileHandles.issue(result.path, "export");
    const { path: _path, ...rest } = result;
    return { ...rest, file };
  });
  ipcMain.handle(IPC_CHANNELS.showNotification, async (event, value) => {
    requireTrustedRenderer(event);
    const candidate = parseNotificationCandidate(value);
    if (!candidate || !Notification.isSupported()) return false;
    const notification = new Notification({ title: candidate.title, body: candidate.body });
    notification.on("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send(IPC_CHANNELS.appNotification, candidate);
    });
    notification.show();
    return true;
  });
  ipcMain.on(IPC_CHANNELS.taskEventsSubscribe, (event, message) => startStream(event, message, streamTaskEvents));
  ipcMain.on(IPC_CHANNELS.taskChatStart, (event, message) => startStream(event, message, streamTaskChat));
  ipcMain.on(IPC_CHANNELS.standaloneChatStart, (event, message) => startStream(event, message, streamStandaloneChat));
  ipcMain.on(IPC_CHANNELS.streamCancel, (event, message) => {
    requireTrustedRenderer(event);
    const payload = message && typeof message === "object" && !Array.isArray(message)
      ? message as Record<string, unknown>
      : {};
    const id = typeof payload.id === "string" ? payload.id : "";
    const key = streamKey(event.sender, id);
    streams.get(key)?.abort();
    streams.delete(key);
  });
  mainWindow = createWindow();
  installMenu();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
