import type { IncomingMessage, ServerResponse } from "node:http";
import {
  removePiProviderKeychainCredential,
  savePiProviderKeychainCredential,
  testPiProviderKeychainCredential,
  updatePiProviderScopedEnvCredential,
} from "../keychain_credentials.js";
import type { PiSessionBranchOperation, PiSessionExportFormat, PiSessionSurface } from "../pi_sessions.js";
import type { PiPackageActionInput } from "../pi_package_executor.js";
import { NotificationPreferencesConflictError } from "../notification_preferences.js";

type PiSettingScope = "global" | "project";
type PiTrustDecision = boolean | null;
type PiTrustTarget = "current" | "parent";

export interface PiSettingsRouteDeps {
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  readPiSettingsCatalog: () => Promise<unknown>;
  readPiSettingsAudit: (limit?: number) => Promise<unknown[]>;
  readPiUsageCatalog: () => Promise<unknown> | unknown;
  writePiSetting: (scope: PiSettingScope, path: string, value: unknown, unset?: boolean) => Promise<unknown>;
  writePiSettingsRaw: (scope: PiSettingScope, value: unknown) => Promise<unknown>;
  readPiTrustStatus: () => Promise<unknown>;
  writePiTrustDecision: (target: PiTrustTarget, decision: PiTrustDecision) => Promise<unknown>;
  readPiPackagesCatalog: () => Promise<unknown>;
  upsertPiPackageEntry: (scope: PiSettingScope, input: Record<string, unknown>) => Promise<unknown>;
  deletePiPackageEntry: (scope: PiSettingScope, source: string) => Promise<unknown>;
  togglePiPackageResource: (input: Record<string, unknown>) => Promise<unknown>;
  previewPiPackageAction: (input: PiPackageActionInput) => Promise<unknown>;
  runPiPackageAction: (input: PiPackageActionInput) => Promise<unknown>;
  readPiKeybindingsCatalog: () => Promise<unknown>;
  writePiKeybindingAction: (input: Record<string, unknown>) => Promise<unknown>;
  readNotificationPreferences: () => Promise<unknown>;
  writeNotificationPreferences: (input: Record<string, unknown>) => Promise<unknown>;
  readPiThemesCatalog: () => Promise<unknown>;
  writePiThemeSelection: (scope: PiSettingScope, theme: string) => Promise<unknown>;
  writePiCustomTheme: (input: Record<string, unknown>) => Promise<unknown>;
  readPiSessionsCatalog: (surface: PiSessionSurface, projectId?: string) => Promise<unknown>;
  readPiSessionTree: (surface: PiSessionSurface, projectId: string | undefined, sessionId: string) => Promise<unknown>;
  readPiSessionEntries: (surface: PiSessionSurface, projectId: string | undefined, sessionId: string, since?: string) => Promise<unknown>;
  renamePiSession: (surface: PiSessionSurface, projectId: string | undefined, sessionId: string, name: string) => Promise<unknown>;
  deletePiSession: (surface: PiSessionSurface, projectId: string | undefined, sessionId: string) => Promise<unknown>;
  exportPiSession: (surface: PiSessionSurface, projectId: string | undefined, sessionId: string, format?: PiSessionExportFormat, outputPath?: string) => Promise<unknown>;
  sharePiSession: (surface: PiSessionSurface, projectId: string | undefined, sessionId: string) => Promise<unknown>;
  branchPiSession: (input: {
    surface: PiSessionSurface;
    projectId?: string;
    sessionId: string;
    operation: PiSessionBranchOperation;
    entryId?: string;
    name?: string;
  }) => Promise<unknown>;
  readPiProviderCatalog: () => Promise<unknown>;
  readCustomModelsCatalog: () => Promise<unknown>;
  writeCustomModelsRaw: (value: unknown) => Promise<unknown>;
  upsertCustomModelProvider: (input: Record<string, unknown>) => Promise<unknown>;
  deleteCustomModelProvider: (providerId: string) => Promise<unknown>;
  upsertCustomModel: (input: Record<string, unknown>) => Promise<unknown>;
  deleteCustomModel: (providerId: string, modelId: string) => Promise<unknown>;
  startPiProviderLogin: (provider: string) => Promise<unknown> | unknown;
  readPiProviderLogin: (attemptId: string) => unknown;
  answerPiProviderLogin: (input: { attemptId: string; eventId: string; value?: string }) => unknown;
  cancelPiProviderLogin: (attemptId: string) => unknown;
  logoutPiProviderAuth: (provider: string) => Promise<unknown> | unknown;
  appendPiSettingsAudit: (entry: { scope: PiSettingScope; path: string; sensitive?: boolean }) => Promise<void>;
  savePiProviderApiKey?: typeof savePiProviderKeychainCredential;
  removePiProviderApiKey?: typeof removePiProviderKeychainCredential;
  testPiProviderApiKey?: typeof testPiProviderKeychainCredential;
  updatePiProviderEnv?: typeof updatePiProviderScopedEnvCredential;
}

function piSessionSurface(value: unknown): PiSessionSurface {
  if (value === undefined || value === null || value === "") return "global";
  if (value === "global" || value === "project") return value;
  throw new Error("surface must be global or project");
}

export async function handlePiSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: PiSettingsRouteDeps,
): Promise<boolean> {
  if (url.pathname === "/api/pi/settings-catalog" && req.method === "GET") {
    deps.json(res, 200, await deps.readPiSettingsCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/settings-audit" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 80);
    deps.json(res, 200, { entries: await deps.readPiSettingsAudit(limit) });
    return true;
  }
  if (url.pathname === "/api/pi/usage" && req.method === "GET") {
    deps.json(res, 200, await deps.readPiUsageCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/settings" && req.method === "PUT") {
    const body = await deps.readBody(req) as { scope?: PiSettingScope; path?: string; value?: unknown; unset?: boolean };
    deps.json(res, 200, await deps.writePiSetting(body.scope === "global" ? "global" : "project", deps.requireString(body.path, "path"), body.value, body.unset === true));
    return true;
  }
  if (url.pathname === "/api/pi/settings-raw" && req.method === "PUT") {
    const body = await deps.readBody(req) as { scope?: PiSettingScope; value?: unknown };
    deps.json(res, 200, await deps.writePiSettingsRaw(body.scope === "global" ? "global" : "project", body.value));
    return true;
  }
  if (url.pathname === "/api/pi/trust" && req.method === "GET") {
    deps.json(res, 200, await deps.readPiTrustStatus());
    return true;
  }
  if (url.pathname === "/api/pi/trust" && req.method === "PUT") {
    const body = await deps.readBody(req) as { target?: PiTrustTarget; decision?: boolean | null };
    const target = body.target === "parent" ? "parent" : "current";
    const decision = body.decision === true ? true : body.decision === false ? false : null;
    deps.json(res, 200, await deps.writePiTrustDecision(target, decision));
    return true;
  }
  if (url.pathname === "/api/pi/packages" && req.method === "GET") {
    deps.json(res, 200, await deps.readPiPackagesCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/packages/entry" && req.method === "PUT") {
    const body = await deps.readBody(req) as { scope?: PiSettingScope } & Record<string, unknown>;
    deps.json(res, 200, await deps.upsertPiPackageEntry(body.scope === "global" ? "global" : "project", body));
    return true;
  }
  if (url.pathname === "/api/pi/packages/entry" && req.method === "DELETE") {
    const body = await deps.readBody(req) as { scope?: PiSettingScope; source?: string };
    deps.json(res, 200, await deps.deletePiPackageEntry(body.scope === "global" ? "global" : "project", deps.requireString(body.source, "source")));
    return true;
  }
  if (url.pathname === "/api/pi/packages/resource" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.togglePiPackageResource(body));
    return true;
  }
  if (url.pathname === "/api/pi/packages/action/preview" && req.method === "POST") {
    deps.json(res, 410, { error: { code: "unsafe_installer_retired", message: "Direct Pi package installation is retired. Use Package Center quarantine, audit, and exact-version approval." } });
    return true;
  }
  if (url.pathname === "/api/pi/packages/action" && req.method === "POST") {
    deps.json(res, 410, { error: { code: "unsafe_installer_retired", message: "Direct Pi package installation is retired. Use Package Center quarantine, audit, and exact-version approval." } });
    return true;
  }
  if (url.pathname === "/api/pi/keybindings" && req.method === "GET") {
    deps.json(res, 200, await deps.readPiKeybindingsCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/keybindings/action" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.writePiKeybindingAction(body));
    return true;
  }
  if (url.pathname === "/api/notifications/preferences" && req.method === "GET") {
    deps.json(res, 200, await deps.readNotificationPreferences());
    return true;
  }
  if (url.pathname === "/api/notifications/preferences" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    try {
      deps.json(res, 200, await deps.writeNotificationPreferences(body));
    } catch (error) {
      if (error instanceof NotificationPreferencesConflictError) {
        deps.json(res, error.status, { error: { code: error.code, message: error.message } });
        return true;
      }
      throw error;
    }
    return true;
  }
  if (url.pathname === "/api/pi/themes" && req.method === "GET") {
    deps.json(res, 200, await deps.readPiThemesCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/themes/selection" && req.method === "PUT") {
    const body = await deps.readBody(req) as { scope?: PiSettingScope; theme?: string };
    deps.json(res, 200, await deps.writePiThemeSelection(body.scope === "global" ? "global" : "project", deps.requireString(body.theme, "theme")));
    return true;
  }
  if (url.pathname === "/api/pi/themes/custom" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.writePiCustomTheme(body));
    return true;
  }
  if (url.pathname === "/api/pi/sessions" && req.method === "GET") {
    const surface = piSessionSurface(url.searchParams.get("surface"));
    deps.json(res, 200, await deps.readPiSessionsCatalog(surface, url.searchParams.get("projectId") ?? undefined));
    return true;
  }
  if (url.pathname === "/api/pi/sessions/tree" && req.method === "GET") {
    const surface = piSessionSurface(url.searchParams.get("surface"));
    deps.json(res, 200, await deps.readPiSessionTree(surface, url.searchParams.get("projectId") ?? undefined, deps.requireString(url.searchParams.get("sessionId"), "sessionId")));
    return true;
  }
  if (url.pathname === "/api/pi/sessions/entries" && req.method === "GET") {
    const surface = piSessionSurface(url.searchParams.get("surface"));
    deps.json(res, 200, await deps.readPiSessionEntries(
      surface,
      url.searchParams.get("projectId") ?? undefined,
      deps.requireString(url.searchParams.get("sessionId"), "sessionId"),
      url.searchParams.get("since") ?? undefined,
    ));
    return true;
  }
  if (url.pathname === "/api/pi/sessions/name" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const surface = piSessionSurface(body.surface);
    deps.json(res, 200, await deps.renamePiSession(surface, typeof body.projectId === "string" ? body.projectId : undefined, deps.requireString(body.sessionId, "sessionId"), deps.requireString(body.name, "name")));
    return true;
  }
  if (url.pathname === "/api/pi/sessions" && req.method === "DELETE") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const surface = piSessionSurface(body.surface);
    deps.json(res, 200, await deps.deletePiSession(surface, typeof body.projectId === "string" ? body.projectId : undefined, deps.requireString(body.sessionId, "sessionId")));
    return true;
  }
  if (url.pathname === "/api/pi/sessions/branch" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const surface = piSessionSurface(body.surface);
    const operation = body.operation === "fork" || body.operation === "clone" ? body.operation : "tree";
    deps.json(res, 200, await deps.branchPiSession({
      surface,
      projectId: typeof body.projectId === "string" ? body.projectId : undefined,
      sessionId: deps.requireString(body.sessionId, "sessionId"),
      operation,
      entryId: typeof body.entryId === "string" ? body.entryId : undefined,
      name: typeof body.name === "string" ? body.name : undefined,
    }));
    return true;
  }
  if (url.pathname === "/api/pi/sessions/export" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const surface = piSessionSurface(body.surface);
    deps.json(res, 200, await deps.exportPiSession(
      surface,
      typeof body.projectId === "string" ? body.projectId : undefined,
      deps.requireString(body.sessionId, "sessionId"),
      body.format === "jsonl" ? "jsonl" : "html",
      typeof body.outputPath === "string" ? body.outputPath : undefined,
    ));
    return true;
  }
  if (url.pathname === "/api/pi/sessions/share" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const surface = piSessionSurface(body.surface);
    deps.json(res, 200, await deps.sharePiSession(
      surface,
      typeof body.projectId === "string" ? body.projectId : undefined,
      deps.requireString(body.sessionId, "sessionId"),
    ));
    return true;
  }
  if (url.pathname === "/api/pi/providers" && req.method === "GET") {
    deps.json(res, 200, await deps.readPiProviderCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/custom-models" && req.method === "GET") {
    deps.json(res, 200, await deps.readCustomModelsCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/custom-models/raw" && req.method === "PUT") {
    const body = await deps.readBody(req) as { value?: unknown };
    deps.json(res, 200, await deps.writeCustomModelsRaw(body.value));
    return true;
  }
  if (url.pathname === "/api/pi/custom-models/provider" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.upsertCustomModelProvider(body));
    return true;
  }
  if (url.pathname === "/api/pi/custom-models/provider" && req.method === "DELETE") {
    const body = await deps.readBody(req) as { providerId?: string };
    deps.json(res, 200, await deps.deleteCustomModelProvider(deps.requireString(body.providerId, "providerId")));
    return true;
  }
  if (url.pathname === "/api/pi/custom-models/model" && req.method === "PUT") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.upsertCustomModel(body));
    return true;
  }
  if (url.pathname === "/api/pi/custom-models/model" && req.method === "DELETE") {
    const body = await deps.readBody(req) as { providerId?: string; modelId?: string };
    deps.json(res, 200, await deps.deleteCustomModel(deps.requireString(body.providerId, "providerId"), deps.requireString(body.modelId, "modelId")));
    return true;
  }
  if (url.pathname === "/api/pi/auth/api-key" && req.method === "POST") {
    const body = await deps.readBody(req) as { provider?: string; apiKey?: string; env?: Record<string, unknown> };
    const provider = deps.requireString(body.provider, "provider");
    const apiKey = deps.requireString(body.apiKey, "apiKey");
    const saveApiKey = deps.savePiProviderApiKey ?? savePiProviderKeychainCredential;
    await saveApiKey({ provider, apiKey, env: body.env });
    await deps.appendPiSettingsAudit({ scope: "global", path: `auth.${provider}`, sensitive: true });
    deps.json(res, 200, await deps.readPiProviderCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/auth/api-key" && req.method === "DELETE") {
    const body = await deps.readBody(req) as { provider?: string };
    const provider = deps.requireString(body.provider, "provider");
    const removeApiKey = deps.removePiProviderApiKey ?? removePiProviderKeychainCredential;
    await removeApiKey({ provider });
    await deps.appendPiSettingsAudit({ scope: "global", path: `auth.${provider}`, sensitive: true });
    deps.json(res, 200, await deps.readPiProviderCatalog());
    return true;
  }
  if (url.pathname === "/api/pi/auth/api-key/test" && req.method === "POST") {
    const body = await deps.readBody(req) as { provider?: string };
    const provider = deps.requireString(body.provider, "provider");
    const testApiKey = deps.testPiProviderApiKey ?? testPiProviderKeychainCredential;
    deps.json(res, 200, await testApiKey({ provider }));
    return true;
  }
  if (url.pathname === "/api/pi/auth/env" && req.method === "PUT") {
    const body = await deps.readBody(req) as { provider?: string; env?: Record<string, unknown>; apiKeyEnvVar?: string };
    const provider = deps.requireString(body.provider, "provider");
    const updateEnv = deps.updatePiProviderEnv ?? updatePiProviderScopedEnvCredential;
    const result = await updateEnv({ provider, env: body.env, apiKeyEnvVar: body.apiKeyEnvVar });
    await deps.appendPiSettingsAudit({ scope: "global", path: `auth.${result.provider}.env`, sensitive: true });
    deps.json(res, 200, { result, catalog: await deps.readPiProviderCatalog() });
    return true;
  }
  if (url.pathname === "/api/pi/auth/login/start" && req.method === "POST") {
    const body = await deps.readBody(req) as { provider?: string };
    const provider = deps.requireString(body.provider, "provider");
    const result = await deps.startPiProviderLogin(provider);
    await deps.appendPiSettingsAudit({ scope: "global", path: `auth.${provider.trim()}`, sensitive: true });
    deps.json(res, 200, result);
    return true;
  }
  if (url.pathname === "/api/pi/auth/login/status" && req.method === "GET") {
    deps.json(res, 200, deps.readPiProviderLogin(deps.requireString(url.searchParams.get("attemptId"), "attemptId")));
    return true;
  }
  if (url.pathname === "/api/pi/auth/login/answer" && req.method === "POST") {
    const body = await deps.readBody(req) as { attemptId?: string; eventId?: string; value?: string };
    deps.json(res, 200, deps.answerPiProviderLogin({
      attemptId: deps.requireString(body.attemptId, "attemptId"),
      eventId: deps.requireString(body.eventId, "eventId"),
      value: typeof body.value === "string" ? body.value : undefined,
    }));
    return true;
  }
  if (url.pathname === "/api/pi/auth/login/cancel" && req.method === "POST") {
    const body = await deps.readBody(req) as { attemptId?: string };
    deps.json(res, 200, deps.cancelPiProviderLogin(deps.requireString(body.attemptId, "attemptId")));
    return true;
  }
  if (url.pathname === "/api/pi/auth/logout" && req.method === "POST") {
    const body = await deps.readBody(req) as { provider?: string };
    const provider = deps.requireString(body.provider, "provider");
    const result = await deps.logoutPiProviderAuth(provider);
    await deps.appendPiSettingsAudit({ scope: "global", path: `auth.${provider}`, sensitive: true });
    deps.json(res, 200, { result, catalog: await deps.readPiProviderCatalog() });
    return true;
  }
  return false;
}
