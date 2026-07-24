"use strict";

const WORKSPACE_ROUTES = Object.freeze([
  { id: "pi-settings-read", method: "GET", pathname: /^\/api\/pi\/settings-catalog$/ },
  { id: "pi-settings-write", method: "PUT", pathname: /^\/api\/pi\/(?:settings|model-preference)$/ },
  { id: "pi-providers-read", method: "GET", pathname: /^\/api\/pi\/providers$/ },
  { id: "pi-auth-write", method: "POST", pathname: /^\/api\/pi\/auth\/(?:api-key|login\/(?:start|answer|cancel)|logout)$/ },
  { id: "pi-auth-status-read", method: "GET", pathname: /^\/api\/pi\/auth\/login\/status$/ },
  { id: "pi-packages-read", method: "GET", pathname: /^\/api\/pi\/packages$/ },
  { id: "pi-keybindings-read", method: "GET", pathname: /^\/api\/pi\/keybindings$/ },
  { id: "pi-keybindings-write", method: "PUT", pathname: /^\/api\/pi\/keybindings\/action$/ },
  { id: "pi-themes-read", method: "GET", pathname: /^\/api\/pi\/themes$/ },
  { id: "pi-theme-write", method: "PUT", pathname: /^\/api\/pi\/themes\/selection$/ },
  { id: "agent-bridges-read", method: "GET", pathname: /^\/api\/agent\/(?:bridges|native-capabilities)$/ },
  { id: "agent-permissions-read", method: "GET", pathname: /^\/api\/(?:agent\/permissions(?:\/pending)?|projects\/[^/]+\/agent\/permissions)$/ },
  { id: "agent-permissions-write", method: "PUT", pathname: /^\/api\/(?:agent\/permissions|projects\/[^/]+\/agent\/permissions)$/ },
  { id: "agent-permission-decision", method: "POST", pathname: /^\/api\/agent\/permissions\/decision$/ },
  { id: "runtime-health-read", method: "GET", pathname: /^\/api\/runtime\/health$/ },
  { id: "storage-summary-read", method: "GET", pathname: /^\/api\/storage\/summary$/ },
  { id: "storage-action", method: "POST", pathname: /^\/api\/storage\/actions\/(?:preview|execute)$/ },
  { id: "package-catalog-read", method: "GET", pathname: /^\/api\/package-center\/(?:catalog|installed)$/ },
  { id: "package-lapkg-write", method: "POST", pathname: /^\/api\/package-center\/lapkg\/(?:preview|activate)$/ },
  { id: "notifications-read", method: "GET", pathname: /^\/api\/notifications\/preferences$/ },
  { id: "notifications-write", method: "PUT", pathname: /^\/api\/notifications\/preferences$/ },
  { id: "project-memory-read", method: "GET", pathname: /^\/api\/projects\/[^/]+\/memory\/(?:status|guidance)$/ },
  { id: "project-memory-write", method: "PUT", pathname: /^\/api\/projects\/[^/]+\/memory\/guidance$/ },
  { id: "projects-read", method: "GET", pathname: /^\/api\/projects$/ },
  { id: "projects-create", method: "POST", pathname: /^\/api\/projects$/ },
  { id: "project-delete", method: "DELETE", pathname: /^\/api\/projects\/[^/]+$/ },
  { id: "project-assets-read", method: "GET", pathname: /^\/api\/projects\/[^/]+\/assets(?:\/(?:search|read|workbook-preview|workbook-rows))?$/ },
  { id: "project-assets-parse", method: "POST", pathname: /^\/api\/projects\/[^/]+\/assets\/parse-preview$/ },
  { id: "batch-import", method: "POST", pathname: /^\/api\/projects\/[^/]+\/batches$/ },
  { id: "batch-read", method: "GET", pathname: /^\/api\/projects\/[^/]+\/batches\/[^/]+$/ },
  { id: "batch-quality-read", method: "GET", pathname: /^\/api\/projects\/[^/]+\/batches\/[^/]+\/(?:quality|delivery-readiness)$/ },
  { id: "batch-segment-evidence-read", method: "GET", pathname: /^\/api\/projects\/[^/]+\/batches\/[^/]+\/segments\/[^/]+\/evidence$/ },
  { id: "batch-quality-write", method: "POST", pathname: /^\/api\/projects\/[^/]+\/batches\/[^/]+\/(?:delivery-qa|delivery-qa-review|quality\/waivers|export)$/ },
  { id: "batch-segment-write", method: "POST", pathname: /^\/api\/projects\/[^/]+\/batches\/[^/]+\/segments\/[^/]+$/ },
  { id: "cat-tag-tokens", method: "POST", pathname: /^\/api\/cat\/tag-tokens$/ },
  { id: "project-tasks-read", method: "GET", pathname: /^\/api\/projects\/[^/]+\/tasks(?:\/[^/]+(?:\/(?:session|agent-session))?)?$/ },
  { id: "project-tasks-create", method: "POST", pathname: /^\/api\/projects\/[^/]+\/tasks$/ },
  { id: "project-task-write", method: "PATCH", pathname: /^\/api\/projects\/[^/]+\/tasks\/[^/]+$/ },
  { id: "library-read", method: "GET", pathname: /^\/api\/library(?:\/search)?$/ },
  { id: "library-write", method: "POST", pathname: /^\/api\/library\/(?:import|reindex)$/ },
  { id: "library-document-delete", method: "DELETE", pathname: /^\/api\/library\/documents\/[^/]+$/ },
  { id: "embedding-read", method: "GET", pathname: /^\/api\/capabilities\/embeddings\/multilingual-e5$/ },
  { id: "embedding-install", method: "POST", pathname: /^\/api\/capabilities\/embeddings\/multilingual-e5\/install$/ },
  { id: "document-capabilities-read", method: "GET", pathname: /^\/api\/capabilities\/documents$/ },
  { id: "document-capability-write", method: "POST", pathname: /^\/api\/capabilities\/documents\/[^/]+\/(?:preview|install)$/ },
  { id: "document-evidence", method: "POST", pathname: /^\/api\/documents\/evidence$/ },
  { id: "memories-read", method: "GET", pathname: /^\/api\/memories(?:\/search)?$/ },
  { id: "memories-create", method: "POST", pathname: /^\/api\/memories$/ },
  { id: "memory-confirm", method: "POST", pathname: /^\/api\/memories\/[^/]+\/confirm$/ },
  { id: "memory-update", method: "PATCH", pathname: /^\/api\/memories\/[^/]+$/ },
  { id: "memory-delete", method: "DELETE", pathname: /^\/api\/memories\/[^/]+$/ },
  { id: "chats-read", method: "GET", pathname: /^\/api\/tasks(?:\/[^/]+(?:\/file-grants|\/maintenance\/build)?)?$/ },
  { id: "chat-create", method: "POST", pathname: /^\/api\/tasks$/ },
  { id: "chat-rename", method: "PATCH", pathname: /^\/api\/tasks\/[^/]+$/ },
  { id: "chat-file-grant-write", method: "POST", pathname: /^\/api\/tasks\/[^/]+\/(?:file-grants|working-directory)$/ },
  { id: "chat-file-grant-delete", method: "DELETE", pathname: /^\/api\/tasks\/[^/]+\/file-grants\/[^/]+$/ },
  { id: "chat-maintenance-write", method: "POST", pathname: /^\/api\/tasks\/[^/]+\/maintenance\/(?:preview|build|activate)$/ },
  { id: "chat-archive", method: "POST", pathname: /^\/api\/tasks\/[^/]+\/(?:archive|restore)$/ },
  { id: "chat-message", method: "POST", pathname: /^\/api\/tasks\/[^/]+\/messages$/ },
  { id: "project-task-message", method: "POST", pathname: /^\/api\/projects\/[^/]+\/tasks\/[^/]+\/messages$/ },
  { id: "task-queue-read", method: "GET", pathname: /^\/api\/(?:tasks\/[^/]+|projects\/[^/]+\/tasks\/[^/]+)\/message-queue$/ },
  { id: "task-queue-edit", method: "PATCH", pathname: /^\/api\/(?:tasks\/[^/]+|projects\/[^/]+\/tasks\/[^/]+)\/message-queue\/[^/]+$/ },
  { id: "task-queue-delete", method: "DELETE", pathname: /^\/api\/(?:tasks\/[^/]+|projects\/[^/]+\/tasks\/[^/]+)\/message-queue(?:\/[^/]+)?$/ },
  { id: "task-queue-action", method: "POST", pathname: /^\/api\/(?:tasks\/[^/]+|projects\/[^/]+\/tasks\/[^/]+)\/message-queue(?:\/(?:reorder|pause|resume)|\/[^/]+\/(?:retry|steer))?$/ },
  { id: "chat-runtime-action", method: "POST", pathname: /^\/api\/tasks\/[^/]+\/(?:compact|forks|handoff|stop)$/ },
  { id: "project-task-runtime-action", method: "POST", pathname: /^\/api\/projects\/[^/]+\/tasks\/[^/]+\/(?:stop|decision-interactions\/[^/]+|decisions\/[^/]+|threads\/[^/]+\/follow-up)$/ },
  { id: "workflow-action", method: "POST", pathname: /^\/api\/projects\/[^/]+\/workflows\/[^/]+\/(?:preflight|stop|role-stop|start|resume)$/ },
  { id: "private-eval-read", method: "GET", pathname: /^\/api\/evals\/private(?:\/[^/]+(?:\/(?:runs(?:\/[^/]+\/outputs)?|blind-reviews(?:\/[^/]+)?|scorecards\/[^/]+|comparison))?)?$/ },
  { id: "private-eval-write", method: "POST", pathname: /^\/api\/evals\/private\/[^/]+\/(?:runs(?:\/[^/]+\/stop)?|blind-reviews(?:\/[^/]+\/judgments)?|scorecards)$/ },
]);

function parsedApiPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192 || !value.startsWith("/api/")) return null;
  try {
    const parsed = new URL(value, "http://127.0.0.1");
    return parsed.origin === "http://127.0.0.1" && parsed.pathname.startsWith("/api/") ? parsed : null;
  } catch {
    return null;
  }
}

function workspaceCapabilityFor(method, path) {
  const parsed = parsedApiPath(path);
  const normalizedMethod = typeof method === "string" ? method.toUpperCase() : "";
  if (!parsed) return null;
  return WORKSPACE_ROUTES.find((route) => route.method === normalizedMethod && route.pathname.test(parsed.pathname))?.id ?? null;
}

function resolveWorkspaceCapabilityRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Workspace capability input must be an object.");
  const input = value;
  if (typeof input.capability !== "string" || typeof input.path !== "string") throw new Error("Workspace capability and path are required.");
  if (Object.keys(input).some((key) => key !== "capability" && key !== "path" && key !== "body")) {
    throw new Error("Workspace capability input contains an unsupported field.");
  }
  const route = WORKSPACE_ROUTES.find((entry) => entry.id === input.capability);
  if (!route || workspaceCapabilityFor(route.method, input.path) !== route.id) {
    throw new Error("Workspace capability does not match the requested path.");
  }
  return Object.prototype.hasOwnProperty.call(input, "body")
    ? { method: route.method, path: input.path, body: input.body }
    : { method: route.method, path: input.path };
}

exports.workspaceCapabilityFor = workspaceCapabilityFor;
exports.resolveWorkspaceCapabilityRequest = resolveWorkspaceCapabilityRequest;
