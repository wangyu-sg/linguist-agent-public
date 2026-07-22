import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { TaskWorkspaceSnapshot } from "../../../packages/cat-data/src/task_workspace_contract.ts";
import {
  workspaceClient,
  type PiProviderCatalog,
  type PiSettingsCatalog,
  type PiThemesCatalog,
} from "../src/renderer/data/workspace-client.ts";
import { availableModels, displayHash, latestManifestRun } from "../src/renderer/settings/settings-model.ts";

test("settings writes use only the canonical runtime routes and exact bodies", async () => {
  const originalWindow = globalThis.window;
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: unknown) => {
            calls.push(input);
            return { ok: true, status: 200, data: {} };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.updatePiSetting("global", "defaultModel", "model-one");
    await workspaceClient.savePiProviderApiKey("provider-one", "secret-value");
    await workspaceClient.updateAgentPermissions({ mode: "custom", customRules: { fileRead: "auto", bash: "ask" } });
    await workspaceClient.updatePiThemeSelection("native-theme");
    await workspaceClient.updatePiKeybindingAction({ id: "app.model.select", keys: ["ctrl+l"] });
    await workspaceClient.updateNotificationPreferences({
      enabled: true,
      categories: { waiting: true, failed: false, completed: true, permission: true },
      expectedUpdatedAt: null,
    });
    assert.deepEqual(calls, [
      {
        method: "PUT",
        path: "/api/pi/settings",
        body: { scope: "global", path: "defaultModel", value: "model-one", unset: false },
      },
      {
        method: "POST",
        path: "/api/pi/auth/api-key",
        body: { provider: "provider-one", apiKey: "secret-value" },
      },
      {
        method: "PUT",
        path: "/api/agent/permissions",
        body: { mode: "custom", customRules: { fileRead: "auto", bash: "ask" } },
      },
      {
        method: "PUT",
        path: "/api/pi/themes/selection",
        body: { scope: "global", theme: "native-theme" },
      },
      {
        method: "PUT",
        path: "/api/pi/keybindings/action",
        body: { id: "app.model.select", keys: ["ctrl+l"] },
      },
      {
        method: "PUT",
        path: "/api/notifications/preferences",
        body: { enabled: true, categories: { waiting: true, failed: false, completed: true, permission: true }, expectedUpdatedAt: null },
      },
    ]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("Pi OAuth settings use the server-owned login coordinator routes", async () => {
  const originalWindow = globalThis.window;
  const calls: unknown[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      linguist: {
        api: {
          request: async (input: unknown) => {
            calls.push(input);
            return { ok: true, status: 200, data: { attemptId: "attempt-one", status: "pending", events: [] } };
          },
        },
      },
    },
  });
  try {
    await workspaceClient.startPiProviderLogin("openai-codex");
    await workspaceClient.fetchPiProviderLogin("attempt-one");
    await workspaceClient.answerPiProviderLogin("attempt-one", "event-one", "verification-code");
    await workspaceClient.cancelPiProviderLogin("attempt-one");
    await workspaceClient.logoutPiProviderAuth("openai-codex");
    assert.deepEqual(calls, [
      { method: "POST", path: "/api/pi/auth/login/start", body: { provider: "openai-codex" } },
      { method: "GET", path: "/api/pi/auth/login/status?attemptId=attempt-one" },
      { method: "POST", path: "/api/pi/auth/login/answer", body: { attemptId: "attempt-one", eventId: "event-one", value: "verification-code" } },
      { method: "POST", path: "/api/pi/auth/login/cancel", body: { attemptId: "attempt-one" } },
      { method: "POST", path: "/api/pi/auth/logout", body: { provider: "openai-codex" } },
    ]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});

test("model choices expose only server-reported available models", () => {
  const catalog = {
    providers: [{
      id: "provider-one",
      displayName: "Provider One",
      kind: "model",
      configured: true,
      authStatus: { configured: true },
      usesOAuth: false,
      keyLink: "https://example.invalid",
      modelCount: 2,
      availableModelCount: 1,
      models: [
        { id: "offline", provider: "provider-one", available: false },
        { id: "ready", name: "Ready Model", provider: "provider-one", available: true },
      ],
    }],
  } as PiProviderCatalog;
  assert.deepEqual(availableModels(catalog, "provider-one").map((model) => model.id), ["ready"]);
});

test("resource manifest selects the latest canonical Run instead of inferring packages", () => {
  const snapshot = {
    runs: [
      { id: "older", updatedAt: "2026-07-16T01:00:00Z", resourceManifest: { profile: "main", packages: [], activeToolNames: [] } },
      { id: "newer", updatedAt: "2026-07-16T02:00:00Z", resourceManifest: { profile: "team", packages: [], activeToolNames: [] } },
      { id: "without-manifest", updatedAt: "2026-07-16T03:00:00Z" },
    ],
  } as unknown as TaskWorkspaceSnapshot;
  assert.equal(latestManifestRun(snapshot)?.id, "newer");
  assert.equal(displayHash("1234567890abcdefghijklmnopqrstuvwxyz"), "1234567890abcdefghijklmnopqrstuvwxyz");
});

test("notification settings use the canonical runtime preference route", async () => {
  const source = await readFile(new URL("../src/renderer/settings/SettingsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /saveNotifications/);
  assert.match(source, /expectedUpdatedAt/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("settings read DTOs remain structural and do not require renderer defaults", () => {
  const catalog = { fields: [{ path: "defaultModel", effectiveValue: "canonical-model" }] } as PiSettingsCatalog;
  const themes = { selected: { effective: "canonical-theme" } } as PiThemesCatalog;
  assert.equal(catalog.fields[0]?.effectiveValue, "canonical-model");
  assert.equal(themes.selected.effective, "canonical-theme");
});
