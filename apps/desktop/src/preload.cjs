const { contextBridge, ipcRenderer } = require("electron");

let nextStreamId = 0;
const streams = new Map();
const allowedCommands = new Set([
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
ipcRenderer.on("api:stream:update", (_event, update) => {
  const stream = streams.get(update?.id);
  if (!stream) return;
  if (update.kind === "event") stream.onEvent(update.value);
  if (update.kind === "state") stream.onState?.(update.value);
});

function openStream(channel, input, onEvent, onState) {
  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function.");
  const id = `${Date.now().toString(36)}-${(++nextStreamId).toString(36)}`;
  streams.set(id, { onEvent, onState: typeof onState === "function" ? onState : undefined });
  ipcRenderer.send(channel, { id, input });
  return () => {
    if (!streams.delete(id)) return;
    ipcRenderer.send("api:stream:cancel", { id });
  };
}

contextBridge.exposeInMainWorld("linguist", Object.freeze({
  runtime: Object.freeze({
    status: () => ipcRenderer.invoke("runtime:status"),
    installOrRepair: () => ipcRenderer.invoke("runtime:install-or-repair"),
    installCandidate: (input) => ipcRenderer.invoke("runtime:install-candidate", input),
  }),
  api: Object.freeze({
    request: (input) => ipcRenderer.invoke("api:request", input),
    subscribeTaskEvents: (input, onEvent, onState) => openStream("api:task-events:subscribe", input, onEvent, onState),
    streamTaskChat: (input, onEvent, onState) => openStream("api:task-chat:start", input, onEvent, onState),
    streamStandaloneChat: (input, onEvent, onState) => openStream("api:standalone-chat:start", input, onEvent, onState),
  }),
  system: Object.freeze({
    pickProjectFolder: () => ipcRenderer.invoke("system:pick-project-folder"),
    pickImportFiles: (kind) => ipcRenderer.invoke("system:pick-import-files", kind),
    openExternal: (url) => ipcRenderer.invoke("system:open-external", url),
    revealPath: (path) => ipcRenderer.invoke("system:reveal-path", path),
    exportRichArtifact: (input) => ipcRenderer.invoke("system:export-rich-artifact", input),
    showNotification: (candidate) => ipcRenderer.invoke("system:show-notification", candidate),
    onNotification: (listener) => {
      if (typeof listener !== "function") throw new TypeError("listener must be a function.");
      const receive = (_event, candidate) => listener(candidate);
      ipcRenderer.on("app:notification", receive);
      return () => ipcRenderer.removeListener("app:notification", receive);
    },
    onCommand: (listener) => {
      if (typeof listener !== "function") throw new TypeError("listener must be a function.");
      const receive = (_event, command) => {
        if (allowedCommands.has(command)) listener(command);
      };
      ipcRenderer.on("app:command", receive);
      return () => ipcRenderer.removeListener("app:command", receive);
    },
  }),
}));
