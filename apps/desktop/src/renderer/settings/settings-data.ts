import { useCallback, useEffect, useRef, useState } from "react";
import {
  workspaceClient,
  type AgentBridgeCatalog,
  type AgentPermissionContract,
  type AgentPermissionDecision,
  type AgentPermissionMode,
  type PiKeybindingsCatalog,
  type NotificationPreferences,
  type NotificationCategory,
  type PiAuthLoginSnapshot,
  type PiPackagesCatalog,
  type PiProviderCatalog,
  type PiSettingsCatalog,
  type PiThemesCatalog,
  type RuntimeHealthReport,
} from "../data/workspace-client.ts";

export interface SettingsData {
  settings: PiSettingsCatalog | null;
  providers: PiProviderCatalog | null;
  bridges: AgentBridgeCatalog | null;
  permissions: AgentPermissionContract | null;
  runtime: RuntimeHealthReport | null;
  packages: PiPackagesCatalog | null;
  keybindings: PiKeybindingsCatalog | null;
  notifications: NotificationPreferences | null;
  themes: PiThemesCatalog | null;
}

type SettingsDataKey = keyof SettingsData;
export type SettingsMutation = "model" | "connection" | "oauth" | "permissions" | "theme" | "keybinding" | "notifications";

const emptyData: SettingsData = {
  settings: null,
  providers: null,
  bridges: null,
  permissions: null,
  runtime: null,
  packages: null,
  keybindings: null,
  notifications: null,
  themes: null,
};

const loaders: Array<[SettingsDataKey, string, () => Promise<SettingsData[SettingsDataKey]>]> = [
  ["settings", "Pi 设置", workspaceClient.fetchPiSettings],
  ["providers", "模型连接", workspaceClient.fetchPiProviders],
  ["bridges", "能力连接", workspaceClient.fetchAgentBridges],
  ["permissions", "Agent 权限", workspaceClient.fetchAgentPermissions],
  ["runtime", "runtime", workspaceClient.fetchRuntimeHealth],
  ["packages", "Package", workspaceClient.fetchPiPackages],
  ["keybindings", "快捷键", workspaceClient.fetchPiKeybindings],
  ["notifications", "通知", workspaceClient.fetchNotificationPreferences],
  ["themes", "Pi 主题", workspaceClient.fetchPiThemes],
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function loginNeedsInput(snapshot: PiAuthLoginSnapshot): boolean {
  return snapshot.events.some((event) => (
    (event.type === "prompt" || event.type === "select" || event.type === "manual_code")
      && event.answered !== true
  ));
}

export function settingValue(catalog: PiSettingsCatalog | null, path: string): unknown {
  return catalog?.fields.find((field) => field.path === path)?.effectiveValue;
}

export function useSettingsData() {
  const [data, setData] = useState<SettingsData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [mutation, setMutation] = useState<SettingsMutation | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<SettingsMutation | null>(null);
  const [providerLogin, setProviderLogin] = useState<PiAuthLoginSnapshot | null>(null);
  const requestId = useRef(0);
  const loginGeneration = useRef(0);

  useEffect(() => () => { loginGeneration.current += 1; }, []);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setErrors([]);
    setMutationSuccess(null);
    const settled = await Promise.allSettled(loaders.map(([, , loader]) => loader()));
    if (request !== requestId.current) return;
    const next = { ...emptyData };
    const nextErrors: string[] = [];
    settled.forEach((result, index) => {
      const [key, label] = loaders[index]!;
      if (result.status === "fulfilled") {
        (next as Record<SettingsDataKey, SettingsData[SettingsDataKey]>)[key] = result.value;
      } else {
        nextErrors.push(`${label}：${message(result.reason)}`);
      }
    });
    setData(next);
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveModel = useCallback(async (input: { provider: string; model: string; thinking: string }) => {
    setMutation("model");
    setMutationError(null);
    setMutationSuccess(null);
    let next = data.settings;
    try {
      const writes: Array<[string, string]> = [
        ["defaultProvider", input.provider],
        ["defaultModel", input.model],
        ["defaultThinkingLevel", input.thinking],
      ];
      for (const [path, value] of writes) {
        if (settingValue(next, path) === value) continue;
        next = await workspaceClient.updatePiSetting("global", path, value);
      }
      if (next) setData((current) => ({ ...current, settings: next }));
      setMutationSuccess("model");
    } catch (error) {
      try {
        const canonical = await workspaceClient.fetchPiSettings();
        setData((current) => ({ ...current, settings: canonical }));
      } catch {
        // Keep the original mutation error. The next full refresh remains available.
      }
      setMutationError(message(error));
      throw error;
    } finally {
      setMutation(null);
    }
  }, [data.settings]);

  const saveApiKey = useCallback(async (provider: string, apiKey: string) => {
    setMutation("connection");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const providers = await workspaceClient.savePiProviderApiKey(provider, apiKey);
      setData((current) => ({ ...current, providers }));
      setMutationSuccess("connection");
    } catch (error) {
      setMutationError(message(error));
      throw error;
    } finally {
      setMutation(null);
    }
  }, []);

  const pollProviderLogin = useCallback(async (attemptId: string, generation: number) => {
    for (let index = 0; index < 180 && loginGeneration.current === generation; index += 1) {
      await pause(1_000);
      if (loginGeneration.current !== generation) return;
      try {
        const snapshot = await workspaceClient.fetchPiProviderLogin(attemptId);
        if (loginGeneration.current !== generation) return;
        setProviderLogin(snapshot);
        if (snapshot.status === "completed") {
          const providers = await workspaceClient.fetchPiProviders();
          if (loginGeneration.current === generation) {
            setData((current) => ({ ...current, providers }));
            setMutationSuccess("oauth");
          }
          return;
        }
        if (snapshot.status === "failed" || snapshot.status === "cancelled" || loginNeedsInput(snapshot)) return;
      } catch (error) {
        if (loginGeneration.current === generation) setMutationError(message(error));
        return;
      }
    }
  }, []);

  const startProviderLogin = useCallback(async (provider: string) => {
    const generation = ++loginGeneration.current;
    setMutation("oauth");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const snapshot = await workspaceClient.startPiProviderLogin(provider);
      if (loginGeneration.current !== generation) return;
      setProviderLogin(snapshot);
      void pollProviderLogin(snapshot.attemptId, generation);
    } catch (error) {
      if (loginGeneration.current === generation) setMutationError(message(error));
      throw error;
    } finally {
      if (loginGeneration.current === generation) setMutation(null);
    }
  }, [pollProviderLogin]);

  const answerProviderLogin = useCallback(async (eventId: string, value?: string) => {
    const current = providerLogin;
    if (!current) throw new Error("No Pi provider login is in progress.");
    const generation = ++loginGeneration.current;
    setMutation("oauth");
    setMutationError(null);
    try {
      const snapshot = await workspaceClient.answerPiProviderLogin(current.attemptId, eventId, value);
      if (loginGeneration.current !== generation) return;
      setProviderLogin(snapshot);
      void pollProviderLogin(snapshot.attemptId, generation);
    } catch (error) {
      if (loginGeneration.current === generation) setMutationError(message(error));
      throw error;
    } finally {
      if (loginGeneration.current === generation) setMutation(null);
    }
  }, [pollProviderLogin, providerLogin]);

  const cancelProviderLogin = useCallback(async () => {
    const current = providerLogin;
    if (!current) return;
    const generation = ++loginGeneration.current;
    setMutation("oauth");
    setMutationError(null);
    try {
      const snapshot = await workspaceClient.cancelPiProviderLogin(current.attemptId);
      if (loginGeneration.current === generation) setProviderLogin(snapshot);
    } catch (error) {
      if (loginGeneration.current === generation) setMutationError(message(error));
      throw error;
    } finally {
      if (loginGeneration.current === generation) setMutation(null);
    }
  }, [providerLogin]);

  const logoutProvider = useCallback(async (provider: string) => {
    ++loginGeneration.current;
    setMutation("oauth");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const response = await workspaceClient.logoutPiProviderAuth(provider);
      setProviderLogin(null);
      setData((current) => ({ ...current, providers: response.catalog }));
      setMutationSuccess("oauth");
    } catch (error) {
      setMutationError(message(error));
      throw error;
    } finally {
      setMutation(null);
    }
  }, []);

  const savePermissions = useCallback(async (mode: AgentPermissionMode, customRules: Record<string, AgentPermissionDecision>) => {
    setMutation("permissions");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const permissions = await workspaceClient.updateAgentPermissions({
        mode,
        ...(mode === "custom" ? { customRules } : {}),
      });
      setData((current) => ({ ...current, permissions }));
      setMutationSuccess("permissions");
    } catch (error) {
      setMutationError(message(error));
      throw error;
    } finally {
      setMutation(null);
    }
  }, []);

  const saveTheme = useCallback(async (theme: string) => {
    setMutation("theme");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const themes = await workspaceClient.updatePiThemeSelection(theme, "global");
      setData((current) => ({ ...current, themes }));
      setMutationSuccess("theme");
    } catch (error) {
      setMutationError(message(error));
      throw error;
    } finally {
      setMutation(null);
    }
  }, []);

  const saveKeybinding = useCallback(async (input: { id: string; keys?: string[]; unset?: boolean }) => {
    setMutation("keybinding");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const keybindings = await workspaceClient.updatePiKeybindingAction(input);
      setData((current) => ({ ...current, keybindings }));
      setMutationSuccess("keybinding");
      return keybindings;
    } catch (error) {
      setMutationError(message(error));
      throw error;
    } finally {
      setMutation(null);
    }
  }, []);

  const saveNotifications = useCallback(async (input: {
    enabled: boolean;
    categories: Record<NotificationCategory, boolean>;
    expectedUpdatedAt: string | null;
  }) => {
    setMutation("notifications");
    setMutationError(null);
    setMutationSuccess(null);
    try {
      const notifications = await workspaceClient.updateNotificationPreferences(input);
      setData((current) => ({ ...current, notifications }));
      setMutationSuccess("notifications");
      return notifications;
    } catch (error) {
      setMutationError(message(error));
      throw error;
    } finally {
      setMutation(null);
    }
  }, []);

  return {
    data,
    errors,
    load,
    loading,
    mutation,
    mutationError,
    mutationSuccess,
    providerLogin,
    answerProviderLogin,
    cancelProviderLogin,
    logoutProvider,
    saveApiKey,
    saveModel,
    savePermissions,
    saveTheme,
    saveKeybinding,
    saveNotifications,
    startProviderLogin,
  };
}
