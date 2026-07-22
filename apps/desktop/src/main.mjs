import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, shell } from "electron";
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

let mainWindow;
let trustedRendererURL;
const streams = new Map();
const RENDERER_COMMANDS = new Set([
  "new-project",
  "import-batch",
  "show-conversation",
  "show-cat",
  "show-settings",
  "show-command-palette",
  "toggle-sidebar",
  "toggle-inspector",
  "stop-run",
]);

function requireTrustedRenderer(event) {
  if (!trustedRendererURL || !isTrustedRendererURL(event.senderFrame?.url ?? "", trustedRendererURL)) {
    throw new Error("Untrusted renderer.");
  }
}

function streamKey(sender, id) {
  return `${sender.id}:${id}`;
}

function startStream(event, message, run) {
  requireTrustedRenderer(event);
  const id = typeof message?.id === "string" && message.id.length <= 128 ? message.id : "";
  if (!id) return;
  const key = streamKey(event.sender, id);
  streams.get(key)?.abort();
  const controller = new AbortController();
  streams.set(key, controller);
  const send = (kind, value) => {
    if (!event.sender.isDestroyed()) event.sender.send("api:stream:update", { id, kind, value });
  };
  void run(message.input, {
    signal: controller.signal,
    onEvent: (value) => send("event", value),
    onState: (value) => send("state", value),
  }).catch((error) => send("state", { status: "error", message: error instanceof Error ? error.message : "Desktop stream failed." }))
    .finally(() => streams.delete(key));
}

function cancelSenderStreams(sender) {
  const prefix = `${sender.id}:`;
  for (const [key, controller] of streams) {
    if (!key.startsWith(prefix)) continue;
    controller.abort();
    streams.delete(key);
  }
}

function installMenu() {
  const sendCommand = (command) => {
    if (!RENDERER_COMMANDS.has(command) || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("app:command", command);
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

async function showOpenDialog(event, options) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
}

function createWindow() {
  const rendererFile = join(app.getAppPath(), "dist", "renderer", "index.html");
  trustedRendererURL = pathToFileURL(rendererFile).href;
  const window = new BrowserWindow(browserWindowOptions(
    join(app.getAppPath(), "src", "preload.cjs"),
    nativeTheme.shouldUseDarkColors,
    resolveWindowSize(),
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

app.whenReady().then(() => {
  app.setName("Linguist Agent");
  const runtimeInstaller = createManagedRuntimeInstaller({ resourcesPath: process.resourcesPath });
  ipcMain.handle("runtime:status", async (event) => {
    requireTrustedRenderer(event);
    return inspectRuntime();
  });
  ipcMain.handle("runtime:install-or-repair", async (event) => {
    requireTrustedRenderer(event);
    return runtimeInstaller.installOrRepair();
  });
  ipcMain.handle("runtime:install-candidate", async (event, input) => {
    requireTrustedRenderer(event);
    return runtimeInstaller.installCandidate(input);
  });
  ipcMain.handle("api:request", async (event, input) => {
    requireTrustedRenderer(event);
    return requestRuntime(input);
  });
  ipcMain.handle("system:pick-project-folder", async (event) => {
    requireTrustedRenderer(event);
    return selectedProjectFolder(await showOpenDialog(event, projectFolderDialogOptions()));
  });
  ipcMain.handle("system:pick-import-files", async (event, kind) => {
    requireTrustedRenderer(event);
    return selectedImportFiles(await showOpenDialog(event, importFilesDialogOptions(kind)));
  });
  ipcMain.handle("system:open-external", async (event, value) => {
    requireTrustedRenderer(event);
    if (!isAllowedExternalURL(value)) throw new Error("Only credential-free HTTPS links can be opened externally.");
    await shell.openExternal(value, { activate: true });
    return true;
  });
  ipcMain.handle("system:reveal-path", async (event, value) => {
    requireTrustedRenderer(event);
    if (typeof value !== "string" || !value.trim()) throw new Error("reveal-path requires a non-empty absolute path.");
    shell.showItemInFolder(value);
    return true;
  });
  ipcMain.handle("system:export-rich-artifact", async (event, value) => {
    requireTrustedRenderer(event);
    return exportRichArtifact(value, {
      BrowserWindow,
      dialog,
      owner: BrowserWindow.fromWebContents(event.sender),
    });
  });
  ipcMain.handle("system:show-notification", async (event, value) => {
    requireTrustedRenderer(event);
    const candidate = parseNotificationCandidate(value);
    if (!candidate || !Notification.isSupported()) return false;
    const notification = new Notification({ title: candidate.title, body: candidate.body });
    notification.on("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("app:notification", candidate);
    });
    notification.show();
    return true;
  });
  ipcMain.on("api:task-events:subscribe", (event, message) => startStream(event, message, streamTaskEvents));
  ipcMain.on("api:task-chat:start", (event, message) => startStream(event, message, streamTaskChat));
  ipcMain.on("api:standalone-chat:start", (event, message) => startStream(event, message, streamStandaloneChat));
  ipcMain.on("api:stream:cancel", (event, message) => {
    requireTrustedRenderer(event);
    const id = typeof message?.id === "string" ? message.id : "";
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
