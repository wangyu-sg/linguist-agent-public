const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");
const {
  APP_COMMANDS,
  IPC_CHANNELS,
  isAppCommand,
  isNativeFileHandle,
  isStreamUpdate,
  requireOpaqueId,
  resolveWorkspaceCapabilityRequest,
} = require("./ipc-contract.cjs") as typeof import("./ipc-contract.cjs");

let nextStreamId = 0;
type StreamState = { status: "connected" | "reconnecting" | "closed" | "error"; message?: string };
type StreamEntry = { onEvent: (value: unknown) => void; onState?: (value: StreamState) => void };
type StreamChannel = typeof IPC_CHANNELS.taskEventsSubscribe | typeof IPC_CHANNELS.taskChatStart | typeof IPC_CHANNELS.standaloneChatStart;

const streams = new Map<string, StreamEntry>();
const allowedCommands = new Set(APP_COMMANDS);
ipcRenderer.on(IPC_CHANNELS.streamUpdate, (_event, update: unknown) => {
  if (!isStreamUpdate(update)) return;
  const stream = streams.get(update.id);
  if (!stream) return;
  if (update.kind === "event") stream.onEvent(update.value);
  if (update.kind === "state" && update.value && typeof update.value === "object") stream.onState?.(update.value as StreamState);
});

function openStream(
  channel: StreamChannel,
  input: unknown,
  onEvent: (value: unknown) => void,
  onState?: (value: StreamState) => void,
) {
  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function.");
  const id = `${Date.now().toString(36)}-${(++nextStreamId).toString(36)}`;
  streams.set(id, { onEvent, onState: typeof onState === "function" ? onState : undefined });
  ipcRenderer.send(channel, { id, input });
  return () => {
    if (!streams.delete(id)) return;
    ipcRenderer.send(IPC_CHANNELS.streamCancel, { id });
  };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(message);
  return value as Record<string, unknown>;
}

function nativeHandle(value: unknown) {
  if (!isNativeFileHandle(value)) throw new TypeError("Native file handle is invalid.");
  return value;
}

function projectAssetRefreshInput(value: unknown) {
  const input = record(value, "Project asset refresh input must be an object.");
  if (Object.keys(input).some((key) => key !== "projectId" && key !== "handles")) throw new TypeError("Project asset refresh input contains an unsupported field.");
  requireOpaqueId(input.projectId, "Project id");
  if (!Array.isArray(input.handles) || input.handles.length === 0 || input.handles.length > 64) throw new TypeError("Project asset refresh requires between one and 64 native file handles.");
  input.handles.forEach(nativeHandle);
  return input;
}

function projectRevealInput(value: unknown) {
  const input = record(value, "Project reveal input must be an object.");
  if (Object.keys(input).some((key) => key !== "projectId")) throw new TypeError("Project reveal input contains an unsupported field.");
  requireOpaqueId(input.projectId, "Project id");
  return input;
}

function candidateRevealInput(value: unknown) {
  const input = record(value, "Maintenance candidate reveal input must be an object.");
  if (Object.keys(input).some((key) => key !== "candidateHandle")) throw new TypeError("Maintenance candidate reveal input contains an unsupported field.");
  nativeHandle(input.candidateHandle);
  return input;
}

function runtimeCandidateInput(value: unknown) {
  const input = record(value, "Runtime candidate input must be an object.");
  if (Object.keys(input).some((key) => key !== "candidateHandle")) throw new TypeError("Runtime candidate input contains an unsupported field.");
  nativeHandle(input.candidateHandle);
  return input;
}

contextBridge.exposeInMainWorld("linguist", Object.freeze({
  runtime: Object.freeze({
    status: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeStatus),
    installOrRepair: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeInstallOrRepair),
    restart: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeRestart),
    installCandidate: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.runtimeInstallCandidate, runtimeCandidateInput(input)),
  }),
  api: Object.freeze({
    invokeWorkspaceCapability: (input: unknown) => {
      resolveWorkspaceCapabilityRequest(input);
      return ipcRenderer.invoke(IPC_CHANNELS.workspaceCapability, input);
    },
    subscribeTaskEvents: (input: unknown, onEvent: (value: unknown) => void, onState?: (value: StreamState) => void) => openStream(IPC_CHANNELS.taskEventsSubscribe, input, onEvent, onState),
    streamTaskChat: (input: unknown, onEvent: (value: unknown) => void, onState?: (value: StreamState) => void) => openStream(IPC_CHANNELS.taskChatStart, input, onEvent, onState),
    streamStandaloneChat: (input: unknown, onEvent: (value: unknown) => void, onState?: (value: StreamState) => void) => openStream(IPC_CHANNELS.standaloneChatStart, input, onEvent, onState),
  }),
  system: Object.freeze({
    pickProjectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickProjectFolder),
    pickImportFiles: (kind: unknown) => {
      if (kind !== "batch" && kind !== "asset" && kind !== "lapkg") throw new TypeError("Unsupported import kind.");
      return ipcRenderer.invoke(IPC_CHANNELS.pickImportFiles, kind);
    },
    refreshProjectAssets: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.refreshProjectAssets, projectAssetRefreshInput(input)),
    openExternal: (url: unknown) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
    revealProject: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.revealProject, projectRevealInput(input)),
    revealMaintenanceCandidate: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.revealMaintenanceCandidate, candidateRevealInput(input)),
    exportRichArtifact: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.exportRichArtifact, input),
    showNotification: (candidate: unknown) => ipcRenderer.invoke(IPC_CHANNELS.showNotification, candidate),
    onNotification: (listener: (candidate: unknown) => void) => {
      if (typeof listener !== "function") throw new TypeError("listener must be a function.");
      const receive = (_event: Electron.IpcRendererEvent, candidate: unknown) => listener(candidate);
      ipcRenderer.on(IPC_CHANNELS.appNotification, receive);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appNotification, receive);
    },
    onCommand: (listener: (command: typeof APP_COMMANDS[number]) => void) => {
      if (typeof listener !== "function") throw new TypeError("listener must be a function.");
      const receive = (_event: Electron.IpcRendererEvent, command: unknown) => {
        if (isAppCommand(command) && allowedCommands.has(command)) listener(command);
      };
      ipcRenderer.on(IPC_CHANNELS.appCommand, receive);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appCommand, receive);
    },
  }),
}));
