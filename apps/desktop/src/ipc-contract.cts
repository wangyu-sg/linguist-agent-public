export const IPC_CHANNELS = Object.freeze({
  runtimeStatus: "runtime:status",
  runtimeInstallOrRepair: "runtime:install-or-repair",
  runtimeRestart: "runtime:restart",
  runtimeInstallCandidate: "runtime:install-candidate",
  workspaceCapability: "api:workspace-capability",
  pickProjectFolder: "system:pick-project-folder",
  pickImportFiles: "system:pick-import-files",
  refreshProjectAssets: "system:refresh-project-assets",
  openExternal: "system:open-external",
  revealProject: "system:reveal-project",
  revealMaintenanceCandidate: "system:reveal-maintenance-candidate",
  exportRichArtifact: "system:export-rich-artifact",
  showNotification: "system:show-notification",
  taskEventsSubscribe: "api:task-events:subscribe",
  taskChatStart: "api:task-chat:start",
  standaloneChatStart: "api:standalone-chat:start",
  streamCancel: "api:stream:cancel",
  streamUpdate: "api:stream:update",
  appCommand: "app:command",
  appNotification: "app:notification",
} as const);

export const APP_COMMANDS = Object.freeze([
  "new-project",
  "import-batch",
  "show-conversation",
  "show-cat",
  "show-settings",
  "show-command-palette",
  "toggle-sidebar",
  "toggle-inspector",
  "stop-run",
] as const);

export type AppCommand = typeof APP_COMMANDS[number];
export type StreamUpdate = Readonly<{
  id: string;
  kind: "event" | "state";
  value: unknown;
}>;

type WorkspaceMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
import * as workspaceCapabilities from "./workspace-capabilities.cjs";

export type WorkspaceCapability = string;
export type WorkspaceCapabilityRequest = Readonly<{
  capability: WorkspaceCapability;
  path: `/api/${string}`;
  body?: unknown;
}>;

export type NativeFileHandle = Readonly<{
  id: string;
  name: string;
}>;

export function isNativeFileHandle(value: unknown): value is NativeFileHandle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 2
    && Object.prototype.hasOwnProperty.call(input, "id")
    && Object.prototype.hasOwnProperty.call(input, "name")
    && typeof input.id === "string"
    && /^la-native-file-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.id)
    && typeof input.name === "string"
    && input.name.length > 0
    && input.name.length <= 255
    && !/[\\/\u0000-\u001f\u007f]/u.test(input.name);
}

export function requireNativeFileHandle(value: unknown): NativeFileHandle {
  if (!isNativeFileHandle(value)) throw new Error("Native file handle is invalid.");
  return value;
}

export function requireOpaqueId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f/\\]/u.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

export function workspaceCapabilityFor(method: unknown, path: unknown): WorkspaceCapability | null {
  const capability = workspaceCapabilities.workspaceCapabilityFor(method, path);
  return typeof capability === "string" ? capability : null;
}

export function resolveWorkspaceCapabilityRequest(value: unknown): { method: WorkspaceMethod; path: `/api/${string}`; body: unknown } {
  const resolved = workspaceCapabilities.resolveWorkspaceCapabilityRequest(value);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error("Workspace capability resolution returned an invalid request.");
  }
  const method = resolved.method;
  const path = resolved.path;
  if (!isWorkspaceMethod(method) || !isApiPath(path)) {
    throw new Error("Workspace capability resolution returned an invalid request.");
  }
  return { method, path, body: resolved.body };
}

function isWorkspaceMethod(value: unknown): value is WorkspaceMethod {
  return value === "GET" || value === "POST" || value === "PUT" || value === "PATCH" || value === "DELETE";
}

function isApiPath(value: unknown): value is `/api/${string}` {
  return typeof value === "string" && value.startsWith("/api/");
}

export function isAppCommand(value: unknown): value is AppCommand {
  return typeof value === "string" && (APP_COMMANDS as readonly string[]).includes(value);
}

export function isStreamUpdate(value: unknown): value is StreamUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return typeof input.id === "string"
    && (input.kind === "event" || input.kind === "state");
}
