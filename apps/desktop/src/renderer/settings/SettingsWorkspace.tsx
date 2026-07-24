import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bot,
  Brain,
  CheckCircle,
  Cpu,
  ExternalLink,
  Keyboard,
  LogIn,
  LogOut,
  Package as PackageIcon,
  Palette,
  RefreshCw,
  Search,
  Shield,
  SunMoon,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { workspaceClient } from "../data/workspace-client.ts";
import type {
  AgentPermissionDecision,
  AgentPermissionMode,
  PiAuthLoginSnapshot,
  PiProviderCatalog,
  NotificationCategory,
  ProjectGuidanceDecision,
  ProjectGuidanceScope,
  ProjectMemoryStatus,
  CommunityPackageCatalogPage,
  ManagedPackageCatalog,
  PackageInstallPreview,
  ManagedDocumentCapabilityCatalog,
  ManagedDocumentInstallPlan,
} from "../data/workspace-client.ts";
import { workspaceStore, type WorkspaceStore } from "../data/workspace-store.ts";
import { applyFontChoice, applyCatEditorFontSize, currentCatEditorFontSize, currentFontChoice, type FontChoice } from "../font-choice.ts";
import { applyAppearance, currentAppearance, type AppearanceChoice } from "../theme-choice.ts";
import { Button, StatusLabel, type StatusState } from "../ui/index.ts";
import { settingValue, useSettingsData } from "./settings-data.ts";
import { availableModels, displayHash, formatBytes, formatUptime, latestManifestRun } from "./settings-model.ts";
import "./settings.css";

export interface SettingsWorkspaceProps {
  store?: WorkspaceStore;
  onClose?: () => void;
}

type SettingsPage = "models" | "notifications" | "permissions" | "memory" | "appearance" | "runtime" | "manifest" | "packages" | "keybindings" | "themes";

interface SettingsPageItem {
  id: SettingsPage;
  label: string;
  detail: string;
  icon: LucideIcon;
}

const pageGroups: Array<{ label: string; items: SettingsPageItem[] }> = [
  {
    label: "日常",
    items: [
      { id: "models", label: "模型与能力连接", detail: "当前模型、Provider 登录与 Run 能力", icon: Bot },
      { id: "notifications", label: "通知", detail: "系统授权与提醒边界", icon: Bell },
      { id: "permissions", label: "权限", detail: "通用 Agent 工具自主性", icon: Shield },
      { id: "memory", label: "Legacy recall", detail: "TDAI adapter 与项目指南", icon: Brain },
    ],
  },
  {
    label: "高级",
    items: [
      { id: "runtime", label: "Runtime", detail: "版本、安全与健康检查", icon: Cpu },
      { id: "manifest", label: "Run 资源", detail: "当前 Run 的资源清单", icon: CheckCircle },
      { id: "packages", label: "Packages", detail: "Pi Package 与已解析资源", icon: PackageIcon },
      { id: "keybindings", label: "键盘快捷键", detail: "Pi 有效绑定与冲突", icon: Keyboard },
      { id: "themes", label: "Pi 主题", detail: "Terminal theme 选择", icon: Palette },
      { id: "appearance", label: "外观", detail: "主题明暗、界面字体与 CAT 字号", icon: SunMoon },
    ],
  },
];

const pageItems = pageGroups.flatMap((group) => group.items);

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function statusForPass(value: string): StatusState {
  if (["pass", "ready", "running", "enabled", "configured"].includes(value)) return "complete";
  if (["warn", "warning", "available_to_bridge", "missing_credential"].includes(value)) return "waiting";
  if (["fail", "failed", "error", "blocked"].includes(value)) return "failed";
  return "neutral";
}

function Section({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <header className="settings-section__header">
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function Unavailable({ children = "当前 runtime 没有返回这部分设置。" }: { children?: ReactNode }) {
  return <p className="settings-unavailable" role="status">{children}</p>;
}

function SettingsSkeleton() {
  return (
    <div className="settings-skeleton" role="status" aria-label="正在载入设置">
      <span /><span /><span /><span />
    </div>
  );
}

function ModelSettings({
  catalog,
  providers,
  busy,
  saving,
  onSave,
}: {
  catalog: ReturnType<typeof useSettingsData>["data"]["settings"];
  providers: PiProviderCatalog | null;
  busy: boolean;
  saving: boolean;
  onSave(input: { provider: string; model: string; thinking: string }): Promise<void>;
}) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("medium");
  const configuredProviders = useMemo(
    () => (providers?.providers ?? []).filter((item) => item.kind === "model" && item.models.some((entry) => entry.available)),
    [providers],
  );
  const models = useMemo(() => availableModels(providers, provider), [provider, providers]);

  useEffect(() => {
    // `providers.defaults` is LA's resolved current selection: it gives the
    // global user preference precedence over the bundled project fallback.
    // The generic Pi settings catalog intentionally retains native project
    // merge semantics, so it cannot be the source of truth for this control.
    setProvider(providers?.defaults?.provider ?? asString(settingValue(catalog, "defaultProvider")));
    setModel(providers?.defaults?.modelId ?? asString(settingValue(catalog, "defaultModel")));
    setThinking(providers?.defaults?.thinkingLevel ?? (asString(settingValue(catalog, "defaultThinkingLevel")) || "medium"));
  }, [catalog, providers]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!provider || !model || !thinking) return;
    void onSave({ provider, model, thinking }).catch(() => undefined);
  };

  if (!catalog || !providers) return <Unavailable />;
  return (
    <form className="settings-form" onSubmit={submit}>
      <div className="settings-field-grid">
        <label className="settings-field">
          <span>Provider</span>
          <select
            value={provider}
            onChange={(event) => {
              const nextProvider = event.target.value;
              setProvider(nextProvider);
              setModel(availableModels(providers, nextProvider)[0]?.id ?? "");
            }}
          >
            {!configuredProviders.some((item) => item.id === provider) && provider ? <option value={provider}>{provider}</option> : null}
            {configuredProviders.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
          </select>
        </label>
        <label className="settings-field">
          <span>当前模型</span>
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            {!models.some((item) => item.id === model) && model ? <option value={model}>{model}</option> : null}
            {models.map((item) => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}
          </select>
        </label>
        <label className="settings-field">
          <span>思考级别</span>
          <select value={thinking} onChange={(event) => setThinking(event.target.value)}>
            {["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="settings-form__footer">
        <p>这是本机当前选择，不是临时“默认模型”。应用到新 Run；当前 Run 保留启动时记录的模型与资源。</p>
        <Button variant="primary" type="submit" loading={saving} loadingLabel="正在保存" disabled={busy || !provider || !model}>保存当前模型</Button>
      </div>
    </form>
  );
}

function OAuthLoginPanel({
  attempt,
  busy,
  onAnswer,
  onCancel,
}: {
  attempt: PiAuthLoginSnapshot;
  busy: boolean;
  onAnswer(eventId: string, value?: string): Promise<void>;
  onCancel(): Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const pending = attempt.status === "pending";
  const tone = attempt.status === "completed" ? "complete" : attempt.status === "failed" ? "failed" : pending ? "running" : "neutral";
  return (
    <section className="settings-oauth" aria-labelledby="settings-oauth-title">
      <header>
        <div>
          <h3 id="settings-oauth-title">{attempt.providerName} 登录</h3>
          <p>{attempt.message ?? "Pi 正在完成 provider 授权。"}</p>
        </div>
        <StatusLabel live state={tone}>{attempt.status}</StatusLabel>
      </header>
      <ol className="settings-oauth__events">
        {attempt.events.map((event) => {
          const interactive = event.answered !== true && (event.type === "prompt" || event.type === "manual_code" || event.type === "select");
          return (
            <li key={event.id} data-answered={event.answered || undefined}>
              {event.type === "auth" && event.url ? (
                <div className="settings-oauth__event-copy">
                  <strong>{event.instructions ?? "在浏览器中继续登录"}</strong>
                  <Button variant="secondary" onClick={() => void window.linguist.system.openExternal(event.url!)}>
                    <ExternalLink aria-hidden="true" />打开登录页面
                  </Button>
                </div>
              ) : event.type === "device_code" && event.verificationUri ? (
                <div className="settings-oauth__event-copy">
                  <span>设备代码</span><code>{event.userCode ?? "—"}</code>
                  <Button variant="secondary" onClick={() => void window.linguist.system.openExternal(event.verificationUri!)}>
                    <ExternalLink aria-hidden="true" />打开验证页面
                  </Button>
                </div>
              ) : event.type === "progress" ? (
                <p>{event.message ?? "正在等待 provider…"}</p>
              ) : event.type === "select" && interactive ? (
                <form onSubmit={(submitEvent) => {
                  submitEvent.preventDefault();
                  const value = answers[event.id];
                  if (value) void onAnswer(event.id, value);
                }}>
                  <label><span>{event.message ?? "请选择"}</span>
                    <select value={answers[event.id] ?? ""} onChange={(changeEvent) => setAnswers((current) => ({ ...current, [event.id]: changeEvent.target.value }))}>
                      <option value="">选择…</option>
                      {(event.options ?? []).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <Button type="submit" variant="primary" loading={busy} disabled={!answers[event.id]}>继续</Button>
                </form>
              ) : interactive ? (
                <form onSubmit={(submitEvent) => {
                  submitEvent.preventDefault();
                  const value = answers[event.id] ?? "";
                  if (value.trim() || event.allowEmpty) void onAnswer(event.id, value);
                }}>
                  <label><span>{event.message ?? "输入授权信息"}</span>
                    <input
                      autoComplete="off"
                      value={answers[event.id] ?? ""}
                      placeholder={event.placeholder}
                      onChange={(changeEvent) => setAnswers((current) => ({ ...current, [event.id]: changeEvent.target.value }))}
                    />
                  </label>
                  <Button type="submit" variant="primary" loading={busy} disabled={!event.allowEmpty && !(answers[event.id] ?? "").trim()}>继续</Button>
                </form>
              ) : (
                <p>{event.message ?? event.instructions ?? (event.answered ? "已提交" : event.type)}</p>
              )}
            </li>
          );
        })}
      </ol>
      {pending ? <footer><Button variant="ghost" disabled={busy} onClick={() => void onCancel()}>取消登录</Button></footer> : null}
    </section>
  );
}

function ProviderConnections({
  catalog,
  bridges,
  busy,
  saving,
  loginAttempt,
  onAnswerLogin,
  onCancelLogin,
  onLogin,
  onLogout,
  onSave,
}: {
  catalog: PiProviderCatalog | null;
  bridges: ReturnType<typeof useSettingsData>["data"]["bridges"];
  busy: boolean;
  saving: boolean;
  loginAttempt: PiAuthLoginSnapshot | null;
  onAnswerLogin(eventId: string, value?: string): Promise<void>;
  onCancelLogin(): Promise<void>;
  onLogin(provider: string): Promise<void>;
  onLogout(provider: string): Promise<void>;
  onSave(provider: string, key: string): Promise<void>;
}) {
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const providers = useMemo(
    () => [...(catalog?.providers ?? [])].sort((left, right) => Number(right.configured) - Number(left.configured) || left.displayName.localeCompare(right.displayName)),
    [catalog],
  );
  const keyProviders = useMemo(
    () => providers.filter((item) => !item.usesOAuth && (item.apiKeyEnvVars?.length ?? 0) > 0),
    [providers],
  );
  const connectedProviders = useMemo(() => providers.filter((item) => item.configured), [providers]);
  const otherProviders = useMemo(() => providers.filter((item) => !item.configured), [providers]);

  useEffect(() => {
    if (!provider && keyProviders[0]) setProvider(keyProviders[0].id);
  }, [keyProviders, provider]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (!provider || !key) return;
    void onSave(provider, key).then(() => setApiKey("")).catch(() => undefined);
  };

  if (!catalog || !bridges) return <Unavailable />;
  const providerRow = (item: PiProviderCatalog["providers"][number]) => (
    <li key={item.id}>
      <div className="settings-list-copy">
        <strong>{item.displayName}</strong>
        <span>{item.kind === "model" ? `${item.availableModelCount} / ${item.modelCount} 个模型可用` : item.authStatus.label ?? "能力凭据"}</span>
      </div>
      <div className="settings-provider-actions">
        <StatusLabel state={item.configured ? "complete" : "neutral"}>{item.configured ? "已连接" : "未连接"}</StatusLabel>
        {item.usesOAuth ? (
          item.configured
            ? <Button variant="ghost" disabled={busy} onClick={() => void onLogout(item.id)}><LogOut aria-hidden="true" />退出</Button>
            : <Button variant="secondary" loading={busy && loginAttempt?.provider === item.id} disabled={busy && loginAttempt?.provider !== item.id} onClick={() => void onLogin(item.id)}><LogIn aria-hidden="true" />登录</Button>
        ) : null}
      </div>
    </li>
  );
  return (
    <div className="settings-connections">
      <ul className="settings-flat-list" aria-label="模型 Provider 连接">
        {connectedProviders.map(providerRow)}
        {!connectedProviders.length ? <li><span>还没有已连接的 Provider。</span></li> : null}
      </ul>

      {otherProviders.length ? (
        <div className="settings-subsection">
          <h3>可连接的 Provider</h3>
          <p>OAuth Provider 与 API key Provider 都直接显示；不会为了简化页面而把可登录的连接藏起来。</p>
          <ul className="settings-flat-list" aria-label="可连接的模型 Provider">
            {otherProviders.map(providerRow)}
          </ul>
        </div>
      ) : null}

      {loginAttempt ? (
        <OAuthLoginPanel
          attempt={loginAttempt}
          busy={busy}
          onAnswer={onAnswerLogin}
          onCancel={onCancelLogin}
        />
      ) : null}

      {keyProviders.length ? (
        <form className="settings-inline-form" onSubmit={submit}>
          <label className="settings-field">
            <span>Provider</span>
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              {keyProviders.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
            </select>
          </label>
          <label className="settings-field settings-field--grow">
            <span>API key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder="只写入 macOS login Keychain"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <Button variant="primary" type="submit" loading={saving} loadingLabel="正在连接" disabled={busy || !apiKey.trim()}>保存连接</Button>
        </form>
      ) : null}

      <div className="settings-subsection">
        <h3>Run 能力</h3>
        <p>{bridges.policy.explanation}</p>
        <ul className="settings-flat-list" aria-label="Run 能力状态">
          {bridges.bridges.map((bridge) => (
            <li key={bridge.id}>
              <div className="settings-list-copy">
                <strong>{bridge.label}</strong>
                <span>{bridge.purpose}</span>
              </div>
              <StatusLabel state={statusForPass(bridge.status)}>{bridge.statusLabel}</StatusLabel>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PermissionSettings({
  contract,
  busy,
  saving,
  onSave,
}: {
  contract: ReturnType<typeof useSettingsData>["data"]["permissions"];
  busy: boolean;
  saving: boolean;
  onSave(mode: AgentPermissionMode, rules: Record<string, AgentPermissionDecision>): Promise<void>;
}) {
  const [mode, setMode] = useState<AgentPermissionMode>("ask");
  const [rules, setRules] = useState<Record<string, AgentPermissionDecision>>({});

  useEffect(() => {
    if (!contract) return;
    setMode(contract.mode);
    setRules(contract.customRules);
  }, [contract]);

  if (!contract) return <Unavailable />;
  return (
    <form className="settings-form" onSubmit={(event) => { event.preventDefault(); void onSave(mode, rules).catch(() => undefined); }}>
      <label className="settings-field settings-field--wide">
        <span>Agent 自主性</span>
        <select value={mode} onChange={(event) => setMode(event.target.value as AgentPermissionMode)}>
          {contract.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
        <small>{contract.presets.find((preset) => preset.id === mode)?.description}</small>
      </label>

      {mode === "custom" ? (
        <div className="settings-permission-grid">
          {contract.domains.map((domain) => (
            <label key={domain.id} className="settings-permission-row">
              <span><strong>{domain.label}</strong><small>{domain.description}</small></span>
              <select
                aria-label={`${domain.label} 权限`}
                value={rules[domain.id] ?? "ask"}
                onChange={(event) => setRules((current) => ({ ...current, [domain.id]: event.target.value as AgentPermissionDecision }))}
              >
                <option value="auto">自动允许</option>
                <option value="ask">每次询问</option>
                <option value="deny">拒绝</option>
              </select>
            </label>
          ))}
        </div>
      ) : null}

      <details className="settings-disclosure">
        <summary>查看不可覆盖的 CAT 安全边界</summary>
        <ul className="settings-flat-list">
          {contract.hardRails.map((rail) => (
            <li key={rail.domain}>
              <div className="settings-list-copy"><strong>{rail.label ?? rail.domain}</strong><span>{rail.source}</span></div>
              <StatusLabel state="neutral">服务端强制</StatusLabel>
            </li>
          ))}
        </ul>
      </details>

      <div className="settings-form__footer">
        <p>只影响通用 Agent 工具。CAT 写入、锁定句段和交付授权仍由服务端 gate 管理。</p>
        <Button variant="primary" type="submit" loading={saving} loadingLabel="正在保存" disabled={busy}>保存权限</Button>
      </div>
    </form>
  );
}

function RuntimeSettings({ state }: { state: ReturnType<typeof useSettingsData> }) {
  const runtime = state.data.runtime;
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof workspaceClient.fetchRuntimeStorageSummary>> | null>(null);
  const [cleanupPlan, setCleanupPlan] = useState<Awaited<ReturnType<typeof workspaceClient.previewRuntimeStorageAction>> | null>(null);
  const [action, setAction] = useState<"restart" | "repair" | "preview-cache" | "clear-cache" | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refreshStorage = async () => {
    try {
      setStorage(await workspaceClient.fetchRuntimeStorageSummary());
    } catch (error) {
      setActionMessage(`无法读取本机缓存状态：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  useEffect(() => { void refreshStorage(); }, []);

  const restartRuntime = async () => {
    setAction("restart");
    setActionMessage(null);
    try {
      const outcome = await window.linguist.runtime.restart();
      setActionMessage(outcome.message);
      if (outcome.ok) await state.load();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
    }
  };

  const repairRuntime = async () => {
    setAction("repair");
    setActionMessage(null);
    try {
      const outcome = await window.linguist.runtime.installOrRepair();
      setActionMessage(outcome.message);
      if (outcome.ok) await state.load();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
    }
  };

  const previewCacheCleanup = async () => {
    setAction("preview-cache");
    setActionMessage(null);
    try {
      setCleanupPlan(await workspaceClient.previewRuntimeStorageAction({ action: "pruneCaches" }));
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
    }
  };

  const clearPreviewedCaches = async () => {
    if (!cleanupPlan) return;
    setAction("clear-cache");
    setActionMessage(null);
    try {
      const result = await workspaceClient.executeRuntimeStorageAction({ action: cleanupPlan.action, planHash: cleanupPlan.planHash });
      setActionMessage(`已清理 ${formatBytes(result.deletedBytes)} 缓存（${result.deletedFiles} 个文件）。项目、Task、记忆与审计数据未被触碰。`);
      setCleanupPlan(null);
      await refreshStorage();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
    }
  };

  if (!runtime) return <Unavailable />;
  const resident = runtime.residentRuntime;
  return (
    <>
      <dl className="settings-facts">
        <div><dt>LA</dt><dd>{runtime.versions.la}</dd></div>
        <div><dt>Pi coding agent</dt><dd>{runtime.versions.piCodingAgent}</dd></div>
        <div><dt>Pi AI</dt><dd>{runtime.versions.piAi ?? "未报告"}</dd></div>
        <div><dt>Resident runtime</dt><dd>{resident?.state ?? runtime.status}</dd></div>
        <div><dt>Uptime</dt><dd>{formatUptime(resident?.uptimeSec)}</dd></div>
        <div><dt>Loopback only</dt><dd>{resident?.loopbackOnly === true ? "是" : resident?.loopbackOnly === false ? "否" : "未报告"}</dd></div>
      </dl>
      <ul className="settings-flat-list settings-checks" aria-label="Runtime checks">
        {runtime.checks.map((check) => (
          <li key={check.code}>
            <div className="settings-list-copy"><strong>{check.code}</strong><span>{check.message}</span></div>
            <StatusLabel state={statusForPass(check.status)}>{check.status}</StatusLabel>
          </li>
        ))}
      </ul>
      <div className="settings-runtime-actions">
        <div className="settings-subsection-header">
          <div><h3>运行时操作</h3><p>重启不会修改项目数据；修复会用当前已安装 App 内经过校验的 runtime 重新部署，并保留数据与备份。</p></div>
        </div>
        <div className="settings-runtime-actions__buttons">
          <Button variant="secondary" loading={action === "restart"} disabled={action !== null} onClick={() => void restartRuntime()}><RefreshCw aria-hidden="true" />重启 runtime</Button>
          <Button variant="secondary" loading={action === "repair"} disabled={action !== null} onClick={() => void repairRuntime()}><Cpu aria-hidden="true" />修复本机 runtime</Button>
        </div>
      </div>
      <div className="settings-runtime-actions">
        <div className="settings-subsection-header">
          <div><h3>可安全清理的缓存</h3><p>只清理 runtime 标记为可重建的缓存；清理前必须先生成预览和 planHash。</p></div>
          {storage ? <strong>{formatBytes(storage.removableBytes)} 可清理</strong> : null}
        </div>
        {storage ? <p className="settings-runtime-actions__storage">本机 runtime 共占用 {formatBytes(storage.totalBytes)}。不会把项目、Task、记忆、审计或客户文件算入此操作。</p> : <p className="settings-runtime-actions__storage">正在读取本机缓存状态…</p>}
        {!cleanupPlan ? <Button variant="secondary" loading={action === "preview-cache"} disabled={action !== null} onClick={() => void previewCacheCleanup()}><Trash2 aria-hidden="true" />查看可清理缓存</Button> : (
          <div className="settings-runtime-plan">
            <p>将清理 {formatBytes(cleanupPlan.bytes)}（{cleanupPlan.files} 个文件）。</p>
            {cleanupPlan.warnings.length ? <ul>{cleanupPlan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
            <details><summary>查看 {cleanupPlan.paths.length} 个路径</summary><ul>{cleanupPlan.paths.slice(0, 30).map((path) => <li key={path}><code>{path}</code></li>)}</ul></details>
            <div className="settings-runtime-actions__buttons">
              <Button variant="ghost" disabled={action !== null} onClick={() => setCleanupPlan(null)}>取消</Button>
              <Button variant="primary" loading={action === "clear-cache"} disabled={action !== null} onClick={() => void clearPreviewedCaches()}><Trash2 aria-hidden="true" />清理这些缓存</Button>
            </div>
          </div>
        )}
      </div>
      {actionMessage ? <p className="settings-runtime-actions__message" role="status">{actionMessage}</p> : null}
    </>
  );
}

function ResourceManifest({ store }: { store: WorkspaceStore }) {
  const workspace = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const run = latestManifestRun(workspace.task);
  const manifest = run?.resourceManifest;
  if (!run || !manifest) {
    return <Unavailable>当前 Task 还没有 Run resource manifest。启动 Run 后，服务端记录的 Package 版本、integrity、工具和 hashes 会显示在这里。</Unavailable>;
  }
  return (
    <div className="settings-manifest">
      <dl className="settings-facts">
        <div><dt>Task</dt><dd>{workspace.task?.task.title ?? workspace.taskId}</dd></div>
        <div><dt>Run</dt><dd><code>{run.id}</code></dd></div>
        <div><dt>Profile</dt><dd>{manifest.profile}</dd></div>
        <div><dt>状态</dt><dd>{run.status}</dd></div>
      </dl>
      <div className="settings-table-wrap" tabIndex={0} aria-label="当前 Run Package manifest">
        <table className="settings-table">
          <caption className="la-sr-only">当前 Run 实际加载的 Package、版本、来源与 integrity</caption>
          <thead><tr><th scope="col">Package</th><th scope="col">版本</th><th scope="col">来源</th><th scope="col">Integrity</th></tr></thead>
          <tbody>
            {manifest.packages.map((item) => (
              <tr key={`${item.name}:${item.integrity}`}>
                <th scope="row">{item.name}</th><td>{item.version}</td><td><code>{item.source}</code></td><td><code>{item.integrity}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="settings-hashes">
        <div><dt>Request</dt><dd title={manifest.requestShapeHash ?? undefined}>{displayHash(manifest.requestShapeHash)}</dd></div>
        <div><dt>System prompt</dt><dd title={manifest.systemPromptHash ?? undefined}>{displayHash(manifest.systemPromptHash)}</dd></div>
        <div><dt>Tool surface</dt><dd title={manifest.toolSurfaceHash ?? undefined}>{displayHash(manifest.toolSurfaceHash)}</dd></div>
        <div><dt>Resource index</dt><dd title={manifest.resourceIndexHash ?? undefined}>{displayHash(manifest.resourceIndexHash)}</dd></div>
      </dl>
      <details className="settings-disclosure">
        <summary>查看 {manifest.activeToolNames.length} 个实际工具</summary>
        <div className="settings-code-list">{manifest.activeToolNames.map((name) => <code key={name}>{name}</code>)}</div>
      </details>
    </div>
  );
}

function PackageSettings({ state }: { state: ReturnType<typeof useSettingsData> }) {
  const piCatalog = state.data.packages;
  const [community, setCommunity] = useState<CommunityPackageCatalogPage | null>(null);
  const [managed, setManaged] = useState<ManagedPackageCatalog | null>(null);
  const [documentCapabilities, setDocumentCapabilities] = useState<ManagedDocumentCapabilityCatalog | null>(null);
  const [documentPlan, setDocumentPlan] = useState<ManagedDocumentInstallPlan | null>(null);
  const [documentConfirmation, setDocumentConfirmation] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"load" | "preview" | "install" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PackageInstallPreview | null>(null);
  const [archiveHandle, setArchiveHandle] = useState<Awaited<ReturnType<typeof window.linguist.system.pickImportFiles>>[number] | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acceptedRisks, setAcceptedRisks] = useState<string[]>([]);

  const load = async (input: { refresh?: boolean; cursor?: number; append?: boolean; search?: string } = {}) => {
    setBusy("load");
    setError(null);
    try {
      const [catalog, installed, documents] = await Promise.all([
        workspaceClient.fetchCommunityPackageCatalog({
          query: input.search ?? query,
          cursor: input.cursor ?? 0,
          limit: 50,
          refresh: input.refresh,
        }),
        workspaceClient.fetchManagedPackages(),
        workspaceClient.fetchManagedDocumentCapabilities(),
      ]);
      setCommunity((current) => input.append && current
        ? { ...catalog, items: [...current.items, ...catalog.items] }
        : catalog);
      setManaged(installed);
      setDocumentCapabilities(documents);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => { void load(); }, []);

  const inspect = async () => {
    setBusy("preview");
    setError(null);
    try {
      const [selected] = await window.linguist.system.pickImportFiles("lapkg");
      if (!selected) return;
      const result = await workspaceClient.previewLapkgInstall(selected);
      setArchiveHandle(selected);
      setPreview(result);
      setConfirmation("");
      setAcceptedRisks([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const install = async () => {
    if (!preview || !archiveHandle) return;
    setBusy("install");
    setError(null);
    try {
      await workspaceClient.activateLapkg({
        archiveHandle,
        expectedPlanHash: preview.planHash,
        preview,
      });
      setPreview(null);
      setArchiveHandle(null);
      setConfirmation("");
      setAcceptedRisks([]);
      setManaged(await workspaceClient.fetchManagedPackages());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const previewDocumentInstall = async (capabilityId: keyof ManagedDocumentCapabilityCatalog) => {
    setBusy("preview");
    setError(null);
    try {
      setDocumentPlan(await workspaceClient.previewManagedDocumentCapabilityInstall(capabilityId));
      setDocumentConfirmation("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const installDocumentCapability = async () => {
    if (!documentPlan || documentConfirmation !== documentPlan.capabilityId) return;
    setBusy("install");
    setError(null);
    try {
      await workspaceClient.installManagedDocumentCapability(documentPlan.capabilityId, documentPlan.planHash);
      setDocumentCapabilities(await workspaceClient.fetchManagedDocumentCapabilities());
      setDocumentPlan(null);
      setDocumentConfirmation("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };

  const requiredAccepted = preview?.requiredRiskIds.every((risk) => acceptedRisks.includes(risk)) ?? false;
  return (
    <div className="settings-package-center">
      <div className="settings-warning-row" role="note">
        <Shield aria-hidden="true" />
        <span>Community Catalog 只是只读发现来源，不代表 LA 审核或信任，也不能触发安装。Stable 只激活用户选择且通过受信发布者签名、内容摘要和逐项风险确认的声明式 <code>.lapkg</code>。</span>
      </div>
      {error ? <div className="settings-warning-row" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span></div> : null}

      <section className="settings-package-section" aria-labelledby="package-core-title">
        <header className="settings-subsection-header">
          <div><h3 id="package-core-title">Signed declarative packages</h3><p>Stable 只接受受信发布者签名的 <code>.lapkg</code>。包不得包含脚本、npm 依赖、原生二进制或可执行 Extension。</p></div>
          <StatusLabel state={managed ? "complete" : "waiting"}>{managed?.packages.length ?? 0} active</StatusLabel>
        </header>
        <ul className="settings-flat-list">
          {(managed?.packages ?? []).map((item) => (
            <li key={`${item.packageId}@${item.packageVersion}`}>
              <div className="settings-list-copy"><strong>{item.packageId}@{item.packageVersion}</strong><span>{item.publisherId} · {item.resources.length} declarative resources · revision {item.activationRevision}</span></div>
              <StatusLabel state="complete">signature verified</StatusLabel>
            </li>
          ))}
          {managed && !managed.packages.length ? <li><span>尚未激活任何 Stable 声明式资源包。</span></li> : null}
        </ul>
        <div className="settings-form__footer">
          <p>旧 v1 registry 只读：{managed?.legacy.totalRecords ?? 0} records；不会加载、执行或迁移。</p>
          <Button variant="secondary" disabled={busy !== null || managed?.trustedPublisherCount === 0} loading={busy === "preview"} onClick={() => void inspect()}>选择签名 .lapkg</Button>
        </div>
        {managed?.trustedPublisherCount === 0 ? <p className="settings-readonly-note">当前构建尚未配置经产品确认的 Stable 发布者信任根，因此新激活保持 fail-closed。</p> : null}
      </section>

      <section className="settings-package-section" aria-labelledby="document-capability-title">
        <header className="settings-subsection-header">
          <div><h3 id="document-capability-title">Local document capabilities</h3><p>固定 CPython、PaddleOCR、MinerU 与 Office worker。模型和依赖必须由 capability lock 验证；缺失时不会调用系统 Python 或隐式联网。</p></div>
          <StatusLabel state={documentCapabilities?.python.state === "ready" && documentCapabilities.ocr.state === "ready" ? "complete" : "waiting"}>core document runtime</StatusLabel>
        </header>
        <ul className="settings-flat-list">
          {documentCapabilities ? Object.values(documentCapabilities).map((item) => (
            <li key={item.id}>
              <div className="settings-list-copy">
                <strong>{item.label}</strong>
                <span>
                  {item.lock
                    ? `${item.lock.packages.length} packages · ${item.lock.models.length} models${item.state === "unqualified" && item.message ? ` · ${item.message}` : ""}`
                    : item.message ?? "No capability lock"}
                </span>
              </div>
              <StatusLabel state={item.state === "ready" ? "complete" : item.state === "corrupt" || item.state === "unsupported" ? "failed" : "waiting"}>{item.tier} · {item.state}</StatusLabel>
              {item.state !== "ready" && item.state !== "unsupported" && item.state !== "unqualified" ? <Button variant="secondary" disabled={busy !== null} onClick={() => void previewDocumentInstall(item.id)}>安装预览</Button> : null}
            </li>
          )) : <li><span>Loading document capability locks…</span></li>}
        </ul>
        {documentPlan ? (
          <div className="settings-package-audit">
            <div className="settings-list-copy">
              <strong>{documentPlan.label} · {documentPlan.tier}</strong>
              <span>{documentPlan.packages.map((item) => `${item.name}@${item.version}`).join(" · ") || documentPlan.runtime.distribution}</span>
              <span>{documentPlan.models.map((item) => `${item.name}@${item.revision.slice(0, 10)}`).join(" · ") || "No model download"}</span>
              <span>Network: {documentPlan.networkHosts.join(" · ")} · lifecycle scripts disabled · plan <code>{documentPlan.planHash.slice(0, 12)}</code></span>
            </div>
            {documentPlan.prerequisiteIds.length ? <p className="settings-readonly-note">Prerequisite: {documentPlan.prerequisiteIds.join(", ")} must already be ready.</p> : null}
            <label className="settings-field settings-package-confirm">
              <span>输入 <code>{documentPlan.capabilityId}</code> 确认精确能力包及网络下载</span>
              <input value={documentConfirmation} onChange={(event) => setDocumentConfirmation(event.target.value)} placeholder={documentPlan.capabilityId} />
            </label>
            <div className="settings-form__footer">
              <Button variant="ghost" disabled={busy !== null} onClick={() => setDocumentPlan(null)}>取消</Button>
              <Button variant="primary" loading={busy === "install"} disabled={busy !== null || documentConfirmation !== documentPlan.capabilityId} onClick={() => void installDocumentCapability()}>批准并安装</Button>
            </div>
          </div>
        ) : null}
      </section>

      {preview ? (
        <section className="settings-package-audit" aria-labelledby="package-audit-title">
          <header className="settings-subsection-header">
            <div><h3 id="package-audit-title">Audit · {preview.package.id}@{preview.package.version}</h3><p>Approval expires {new Date(preview.expiresAt).toLocaleString()} · plan <code>{preview.planHash.slice(0, 12)}</code></p></div>
            <Button variant="ghost" onClick={() => { setPreview(null); setArchiveHandle(null); }}>关闭</Button>
          </header>
          <dl className="settings-facts">
            <div><dt>Publisher</dt><dd>{preview.signer.publisherId}</dd></div>
            <div><dt>Signing key</dt><dd>{preview.signer.keyId}</dd></div>
            <div><dt>License</dt><dd>{preview.package.license}</dd></div>
            <div><dt>Resources</dt><dd>{preview.resources.length}</dd></div>
            <div><dt>Executable</dt><dd>no</dd></div>
            <div><dt>Archive SHA</dt><dd><code>{preview.archiveSha256.slice(0, 16)}</code></dd></div>
          </dl>
          <div className="settings-package-risks" role="group" aria-label="Package risk approvals">
            {preview.requiredRiskIds.map((risk) => (
              <label key={risk} data-severity="medium">
                <input
                  type="checkbox"
                  checked={acceptedRisks.includes(risk)}
                  onChange={(event) => setAcceptedRisks((current) => event.target.checked
                    ? [...new Set([...current, risk])]
                    : current.filter((item) => item !== risk))}
                />
                <span><strong>{risk}</strong><small>该声明式资源会影响 Agent 指令、项目行为或产品呈现；不会执行本机代码。</small></span>
              </label>
            ))}
          </div>
          <label className="settings-field settings-package-confirm">
            <span>输入精确包 ID <code>{preview.package.id}</code> 以确认签名、内容摘要和风险计划</span>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={preview.package.id} />
          </label>
          <div className="settings-form__footer">
            <p>激活只写 v2 内容寻址 registry；不会写 legacy registry、运行 npm 或加载 Extension。运行中的 Agent 会阻止变更。</p>
            <Button
              variant="primary"
              loading={busy === "install"}
              loadingLabel="正在安全提升"
              disabled={busy !== null || !requiredAccepted || confirmation !== preview.package.id}
              onClick={() => void install()}
            >批准并安装</Button>
          </div>
        </section>
      ) : null}

      <section className="settings-package-section" aria-labelledby="package-community-title">
        <header className="settings-subsection-header">
          <div><h3 id="package-community-title">Pi community catalog</h3><p>{community ? `${community.total} results · fetched ${new Date(community.fetchedAt).toLocaleString()}` : "Loading npm pi-package catalog…"}</p></div>
          <StatusLabel state={community?.offline ? "waiting" : community ? "complete" : "neutral"}>{community?.offline ? "offline cache" : community?.stale ? "stale" : "catalog"}</StatusLabel>
        </header>
        <form className="settings-package-search" onSubmit={(event) => { event.preventDefault(); void load({ search: query }); }}>
          <label><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search packages, skills, browser, OCR…" /></label>
          <Button type="submit" variant="secondary" loading={busy === "load"}>搜索</Button>
          <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void load({ refresh: true, search: query })}><RefreshCw aria-hidden="true" />刷新目录</Button>
        </form>
        <ul className="settings-flat-list settings-package-results">
          {(community?.items ?? []).map((item) => {
            return (
              <li key={`${item.name}@${item.version}`}>
                <div className="settings-list-copy">
                  <strong>{item.name}@{item.version}</strong>
                  <span>{item.description || "No description"} · {item.monthlyDownloads !== undefined && item.monthlyDownloads !== null ? `${item.monthlyDownloads.toLocaleString()}/mo` : `${item.weeklyDownloads?.toLocaleString() ?? "?"}/wk`}</span>
                </div>
                <div className="settings-package-actions">
                  <Button variant="ghost" onClick={() => void window.linguist.system.openExternal(item.piGalleryUrl)} aria-label={`打开 ${item.name} Pi 页面`}><ExternalLink aria-hidden="true" /></Button>
                  <StatusLabel state="neutral">discovery only</StatusLabel>
                </div>
              </li>
            );
          })}
          {community && !community.items.length ? <li><span>没有匹配的 Pi Package。</span></li> : null}
        </ul>
        {community?.nextCursor !== null && community?.nextCursor !== undefined ? (
          <Button variant="ghost" disabled={busy !== null} onClick={() => void load({ cursor: community.nextCursor ?? 0, append: true, search: query })}>加载更多</Button>
        ) : null}
      </section>

      {piCatalog?.resources ? (
        <details className="settings-disclosure">
          <summary>查看现有 Pi settings 中 {piCatalog.resources.entries.length} 个外部资源（兼容视图）</summary>
          <ul className="settings-flat-list">
            {piCatalog.resources.entries.map((resource) => (
              <li key={`${resource.type}:${resource.scope}:${resource.path}`}>
                <div className="settings-list-copy"><strong>{resource.path}</strong><span>{resource.type} · {resource.source} · {resource.origin}</span></div>
                <StatusLabel state={resource.enabled ? "complete" : "neutral"}>{resource.enabled ? "启用" : "禁用"}</StatusLabel>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function KeybindingSettings({ state }: { state: ReturnType<typeof useSettingsData> }) {
  const catalog = state.data.keybindings;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!catalog) return;
    setDrafts(Object.fromEntries(catalog.actions.map((action) => [action.id, action.effectiveKeys.join(", ")] )));
  }, [catalog]);
  if (!catalog) return <Unavailable />;
  const customized = catalog.actions.filter((action) => action.customized);
  const save = (id: string) => {
    const keys = (drafts[id] ?? "").split(",").map((key) => key.trim()).filter(Boolean);
    return state.saveKeybinding({ id, keys });
  };
  return (
    <div>
      <div className="settings-summary-line">
        <span>{catalog.actions.length} 个动作，{customized.length} 个自定义</span>
        <StatusLabel state={catalog.conflicts.length ? "failed" : "complete"}>{catalog.conflicts.length ? `${catalog.conflicts.length} 个冲突` : "无冲突"}</StatusLabel>
      </div>
      {catalog.conflicts.map((conflict) => (
        <div key={`${conflict.key}:${conflict.actionIds.join(":")}`} className="settings-warning-row" role="alert">
          <AlertTriangle aria-hidden="true" /><span><code>{conflict.key}</code> 同时绑定到 {conflict.actionIds.join("、")}</span>
        </div>
      ))}
      <details className="settings-disclosure">
        <summary>查看全部 Pi keybindings</summary>
        <ul className="settings-flat-list">
          {catalog.actions.map((action) => (
            <li key={action.id}>
              <div className="settings-list-copy"><strong>{action.description}</strong><span><code>{action.id}</code> · {action.section}</span></div>
              <div className="settings-keybinding-editor">
                <input
                  aria-label={`${action.description} 快捷键`}
                  value={drafts[action.id] ?? ""}
                  placeholder="未绑定"
                  onChange={(event) => setDrafts((current) => ({ ...current, [action.id]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    void save(action.id).catch(() => undefined);
                  }}
                />
                <Button variant="secondary" type="button" loading={state.mutation === "keybinding"} onClick={() => void save(action.id).catch(() => undefined)}>保存</Button>
                {action.customized ? <Button variant="ghost" type="button" disabled={state.mutation !== null} onClick={() => void state.saveKeybinding({ id: action.id, unset: true }).then(() => setDrafts((current) => ({ ...current, [action.id]: action.defaultKeys.join(", ") }))).catch(() => undefined)}>恢复默认</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      </details>
      <p className="settings-readonly-note">快捷键写入 Pi 的全局 keybindings.json；保存后运行中的 Pi session 需要执行 /reload。多个组合键用逗号分隔，冲突会在上方保留真实提示。</p>
    </div>
  );
}

const notificationCategoryLabels: Array<[NotificationCategory, string, string]> = [
  ["waiting", "等待输入", "Agent 等待你的决定或补充信息"],
  ["failed", "运行失败", "Run 失败并保留在当前 Task 中"],
  ["completed", "运行完成", "Run 完成并产生结果或 Artifact"],
  ["permission", "权限请求", "需要确认一次能力或工具访问"],
];

function NotificationSettings({ state, store }: { state: ReturnType<typeof useSettingsData>; store: WorkspaceStore }) {
  const preferences = state.data.notifications;
  const [enabled, setEnabled] = useState(false);
  const [categories, setCategories] = useState<Record<NotificationCategory, boolean>>({ waiting: true, failed: true, completed: true, permission: true });
  useEffect(() => {
    if (!preferences) return;
    setEnabled(preferences.enabled);
    setCategories(preferences.categories);
  }, [preferences]);
  if (!preferences) return <Unavailable />;
  return (
    <form className="settings-form" onSubmit={(event) => {
      event.preventDefault();
      void state.saveNotifications({ enabled, categories, expectedUpdatedAt: preferences.updatedAt })
        .then((saved) => store.setNotificationPreferences(saved))
        .catch(() => undefined);
    }}>
      <label className="settings-toggle-row">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span><strong>允许 Linguist Agent 发送系统通知</strong><small>仅在窗口未聚焦或当前 Task 不同时提醒；当前 Task 前台工作保持安静。</small></span>
      </label>
      <div className="settings-option-list" aria-label="通知类别">
        {notificationCategoryLabels.map(([category, label, detail]) => (
          <label key={category} className="settings-toggle-row">
            <input type="checkbox" checked={categories[category]} disabled={!enabled} onChange={(event) => setCategories((current) => ({ ...current, [category]: event.target.checked }))} />
            <span><strong>{label}</strong><small>{detail}</small></span>
          </label>
        ))}
      </div>
      <div className="settings-form__footer">
        <p>偏好由当前 runtime 保存；系统首次展示通知时由 macOS 请求授权。</p>
        <Button variant="primary" type="submit" loading={state.mutation === "notifications"} disabled={state.mutation !== null}>保存通知偏好</Button>
      </div>
    </form>
  );
}

const guidanceScopeOptions: Array<{ value: ProjectGuidanceScope; label: string }> = [
  { value: "term", label: "术语" },
  { value: "style", label: "风格" },
  { value: "tm", label: "TM" },
  { value: "dup", label: "重复" },
  { value: "general", label: "通用" },
];

const guidanceScopeLabels: Record<ProjectGuidanceScope, string> = {
  term: "术语",
  style: "风格",
  tm: "TM",
  dup: "重复",
  general: "通用",
};

function memoryStatusTone(status: string | undefined): StatusState {
  if (status === "confirmed_memory_only") return "complete";
  if (status === "legacy_migration_required") return "waiting";
  return "neutral";
}

function memoryStatusText(status: string | undefined): string {
  if (status === "confirmed_memory_only") return "仅 Confirmed Memory";
  if (status === "legacy_migration_required") return "待迁移审阅";
  return status ?? "未报告";
}

function memoryBoolText(value: boolean | undefined): string {
  return value === true ? "是" : value === false ? "否" : "未报告";
}

function guidanceDateText(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleDateString("zh-CN");
}

function MemorySettings({ store }: { store: WorkspaceStore }) {
  const workspace = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const projectId = workspace.projectId;
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(projectId !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProjectMemoryStatus | null>(null);
  const [guidance, setGuidance] = useState<ProjectGuidanceDecision[] | null>(null);
  const [guidanceBusy, setGuidanceBusy] = useState(false);
  const [guidanceError, setGuidanceError] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<ProjectGuidanceScope>("general");
  const [draftText, setDraftText] = useState("");

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      setLoadError(null);
      setStatus(null);
      setGuidance(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setGuidanceError(null);
    void Promise.all([
      workspaceClient.fetchMemoryStatus(projectId),
      workspaceClient.fetchMemoryGuidance(projectId),
    ]).then(([nextStatus, nextGuidance]) => {
      if (cancelled) return;
      setStatus(nextStatus);
      setGuidance(nextGuidance.guidance);
      setLoading(false);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setLoadError(error instanceof Error ? error.message : "记忆设置载入失败");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  if (!projectId) {
    return <Unavailable>记忆与指南按项目保存。先在工作区打开一个项目，再回到这里配置。</Unavailable>;
  }
  if (loading) return <SettingsSkeleton />;
  if (loadError || !guidance) {
    return (
      <div className="settings-form">
        <div className="settings-warning-row" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>记忆设置载入失败:{loadError ?? "服务端没有返回记忆配置。"}</span>
        </div>
        <div className="settings-form__footer">
          <p>检查 runtime 连接后重试。</p>
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>重新载入</Button>
        </div>
      </div>
    );
  }

  const writeGuidance = async (next: ProjectGuidanceDecision[]): Promise<boolean> => {
    setGuidanceBusy(true);
    setGuidanceError(null);
    try {
      const saved = await workspaceClient.updateMemoryGuidance(projectId, next);
      setGuidance(saved.guidance);
      return true;
    } catch (error) {
      setGuidanceError(error instanceof Error ? error.message : "项目指南保存失败");
      return false;
    } finally {
      setGuidanceBusy(false);
    }
  };

  const addGuidance = (event: FormEvent) => {
    event.preventDefault();
    const text = draftText.trim();
    if (!text || guidanceBusy) return;
    const next: ProjectGuidanceDecision[] = [...guidance, {
      id: crypto.randomUUID(),
      scope: draftScope,
      text,
      createdAt: new Date().toISOString(),
      source: "settings",
    }];
    void writeGuidance(next).then((saved) => { if (saved) setDraftText(""); });
  };

  const removeGuidance = (id: string) => {
    if (guidanceBusy) return;
    void writeGuidance(guidance.filter((row) => row.id !== id));
  };

  return (
    <div className="settings-stack">
      <Section title="Memory migration" description="Confirmed Memory 是唯一可召回的长期记忆。旧 TDAI capture、store 和 recall 已停用，不能再通过设置重新开启。">
        <p className="settings-readonly-note">旧记录只能作为显式、只读的 MemoryCandidate 审阅输入；每条候选均须用户确认和备份后才会进入 Confirmed Memory。</p>
        {status ? (
          <div className="settings-subsection">
            <h3>记忆状态</h3>
            <dl className="settings-facts">
              <div><dt>状态</dt><dd><StatusLabel state={memoryStatusTone(status.status)}>{memoryStatusText(status.status)}</StatusLabel></dd></div>
              <div><dt>旧配置</dt><dd>{memoryBoolText(status.legacyTdai?.configurationDetected)}</dd></div>
              <div><dt>旧召回曾启用</dt><dd>{memoryBoolText(status.legacyTdai?.legacyRecallWasConfigured)}</dd></div>
              <div><dt>记忆工具</dt><dd>{memoryBoolText(status.toolsAvailable)}</dd></div>
              <div><dt>自动捕获</dt><dd>{memoryBoolText(status.captureEnabled)}</dd></div>
              <div><dt>自动存储</dt><dd>{memoryBoolText(status.storeEnabled)}</dd></div>
              <div><dt>旧记录召回</dt><dd>{memoryBoolText(status.recallEnabled)}</dd></div>
              {status.semantic ? (
                <div><dt>语义索引</dt><dd>
                  {status.semantic.state ?? status.semantic.assetVectorIndex ?? "未报告"}
                  {typeof status.semantic.indexedBlocks === "number" ? ` · ${status.semantic.indexedBlocks} 块` : ""}
                </dd></div>
              ) : null}
            </dl>
            {status.nextAction ? <p className="settings-readonly-note">{status.nextAction}</p> : null}
          </div>
        ) : null}
      </Section>

      <Section title="项目指南" description="注入 Agent 上下文的项目级长期偏好与决定,scope 决定类别。这是 recall context,不是可引用的 CAT 证据。">
        {guidance.length ? (
          <ul className="settings-flat-list" aria-label="项目指南列表">
            {guidance.map((row) => (
              <li key={row.id}>
                <div className="settings-guidance-item">
                  <span className="settings-scope-chip">{guidanceScopeLabels[row.scope] ?? row.scope}</span>
                  <div className="settings-list-copy">
                    <strong>{row.text}</strong>
                    <span>{guidanceDateText(row.createdAt)}{row.source ? ` · 来源 ${row.source}` : ""}</span>
                  </div>
                </div>
                <Button variant="ghost" disabled={guidanceBusy} aria-label={`删除指南:${row.text}`} onClick={() => removeGuidance(row.id)}>
                  <Trash2 aria-hidden="true" />删除
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-readonly-note">还没有项目指南。这里添加的内容会作为长期偏好注入之后每个 Run 的上下文。</p>
        )}
        {guidanceError ? (
          <div className="settings-warning-row" role="alert">
            <AlertTriangle aria-hidden="true" /><span>{guidanceError}</span>
          </div>
        ) : null}
        <form className="settings-inline-form" onSubmit={addGuidance}>
          <label className="settings-field">
            <span>类别</span>
            <select value={draftScope} onChange={(event) => setDraftScope(event.target.value as ProjectGuidanceScope)}>
              {guidanceScopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="settings-field settings-field--grow">
            <span>指南内容</span>
            <input
              value={draftText}
              placeholder="例如:品牌名「Linguist」一律不译"
              autoComplete="off"
              onChange={(event) => setDraftText(event.target.value)}
            />
          </label>
          <Button variant="primary" type="submit" loading={guidanceBusy} loadingLabel="正在写入" disabled={!draftText.trim()}>添加</Button>
        </form>
      </Section>
    </div>
  );
}

function AppearanceSettings() {
  const [appearance, setAppearance] = useState<AppearanceChoice>(() => currentAppearance());
  const [font, setFont] = useState<FontChoice>(() => currentFontChoice());
  const [catFs, setCatFs] = useState(() => currentCatEditorFontSize());
  return (
    <div className="settings-form">
      <label className="settings-field settings-field--wide">
        <span>主题明暗</span>
        <select
          value={appearance}
          onChange={(event) => {
            const choice = (event.target.value === "light" || event.target.value === "dark" ? event.target.value : "system") as AppearanceChoice;
            setAppearance(choice);
            applyAppearance(choice);
          }}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色（纸感)</option>
          <option value="dark">深色（墨色)</option>
        </select>
        <small>立即生效,只保存在本机。</small>
      </label>
      <label className="settings-field settings-field--wide">
        <span>界面字体</span>
        <select
          value={font}
          onChange={(event) => {
            const choice = event.target.value === "serif" ? "serif" : "sans";
            setFont(choice);
            applyFontChoice(choice);
          }}
        >
          <option value="sans">系统 Sans(SF Pro / 苹方)</option>
          <option value="serif">工作室宋体(New York / 宋体)</option>
        </select>
        <small>立即生效,只保存在本机;阅读面(CAT 文本、Agent 文档)始终为宋体系。</small>
      </label>
      <div className="settings-field settings-field--wide">
        <span>CAT 编辑器字号</span>
        <div className="settings-stepper" role="group" aria-label="CAT 编辑器字号">
          <button type="button" aria-label="减小字号" disabled={catFs <= 12} onClick={() => { const next = Math.max(12, catFs - 1); setCatFs(next); applyCatEditorFontSize(next); }}>A−</button>
          <strong>{catFs}px</strong>
          <button type="button" aria-label="增大字号" disabled={catFs >= 22} onClick={() => { const next = Math.min(22, catFs + 1); setCatFs(next); applyCatEditorFontSize(next); }}>A+</button>
        </div>
        <small>12–22px,立即生效,只保存在本机;与旧 Swift 版的编辑器字号偏好一致。</small>
      </div>
    </div>
  );
}

function ThemeSettings({ state }: { state: ReturnType<typeof useSettingsData> }) {
  const catalog = state.data.themes;
  const [theme, setTheme] = useState("");
  useEffect(() => { setTheme(catalog?.selected.effective ?? ""); }, [catalog]);
  if (!catalog) return <Unavailable />;
  const validThemes = catalog.themes.filter((item) => item.valid);
  return (
    <form className="settings-form" onSubmit={(event) => { event.preventDefault(); if (theme) void state.saveTheme(theme).catch(() => undefined); }}>
      <label className="settings-field settings-field--wide">
        <span>Pi terminal theme</span>
        <select value={theme} onChange={(event) => setTheme(event.target.value)}>
          {!validThemes.some((item) => item.name === theme) && theme ? <option value={theme}>{theme}</option> : null}
          {validThemes.map((item) => <option key={item.id} value={item.name}>{item.name} · {item.scope}</option>)}
        </select>
        <small>只改变 Pi terminal theme，不改变 Electron 的浅色或深色外观(见"外观"页)。</small>
      </label>
      <div className="settings-form__footer">
        <p>当前来源:{catalog.selected.source}</p>
        <Button variant="primary" type="submit" loading={state.mutation === "theme"} loadingLabel="正在保存" disabled={state.mutation !== null || !theme}>保存 Pi theme</Button>
      </div>
    </form>
  );
}

function SettingsPageContent({ page, state, store }: {
  page: SettingsPage;
  state: ReturnType<typeof useSettingsData>;
  store: WorkspaceStore;
}) {
  if (page === "models") {
    return (
      <>
        <Section title="当前模型" description="保存为此 Mac 上的当前模型选择；改变后只应用到新 Run，正在运行的工作保留启动时记录的配置。">
          <ModelSettings
            catalog={state.data.settings}
            providers={state.data.providers}
            busy={state.mutation !== null}
            saving={state.mutation === "model"}
            onSave={state.saveModel}
          />
        </Section>
        <Section title="Provider 与 Run 能力" description="Provider 凭据进入 Keychain；OAuth 登录、API key 连接和实际 Run 能力在同一处管理。">
          <ProviderConnections
            catalog={state.data.providers}
            bridges={state.data.bridges}
            busy={state.mutation !== null}
            saving={state.mutation === "connection"}
            loginAttempt={state.providerLogin}
            onAnswerLogin={state.answerProviderLogin}
            onCancelLogin={state.cancelProviderLogin}
            onLogin={state.startProviderLogin}
            onLogout={state.logoutProvider}
            onSave={state.saveApiKey}
          />
        </Section>
      </>
    );
  }
  if (page === "notifications") {
    return (
      <Section title="系统通知" description="偏好与 Task scope 由 runtime 保存，Electron 只负责安全呈现 macOS 系统通知。">
        <NotificationSettings state={state} store={store} />
      </Section>
    );
  }
  if (page === "permissions") {
    return (
      <Section title="Agent 自主性" description="控制通用工具的自动执行范围，不改变 CAT 写入、风险和交付权威规则。">
        <PermissionSettings
          contract={state.data.permissions}
          busy={state.mutation !== null}
          saving={state.mutation === "permissions"}
          onSave={state.savePermissions}
        />
      </Section>
    );
  }
  if (page === "memory") {
    return <MemorySettings store={store} />;
  }
  if (page === "runtime") {
    return (
      <Section title="Resident runtime" description="当前 runtime 的版本、进程边界和服务端健康检查。">
        <RuntimeSettings state={state} />
      </Section>
    );
  }
  if (page === "manifest") {
    return (
      <Section title="Run resource manifest" description="当前 Task 最近一次 Run 的服务端记录，不从本机设置推测。">
        <ResourceManifest store={store} />
      </Section>
    );
  }
  if (page === "packages") {
    return (
      <Section title="Pi Packages" description="实际配置来源、安装路径和已解析资源；执行第三方代码的操作保持显式。">
        <PackageSettings state={state} />
      </Section>
    );
  }
  if (page === "keybindings") {
    return (
      <Section title="Pi keybindings" description="有效快捷键、用户覆盖和 canonical 冲突报告。">
        <KeybindingSettings state={state} />
      </Section>
    );
  }
  if (page === "appearance") {
    return (
      <Section title="外观" description="主题明暗、界面字体与 CAT 编辑器字号;全部只保存在本机,即时生效。">
        <AppearanceSettings />
      </Section>
    );
  }
  return (
    <Section title="Pi terminal theme" description="只改变 Pi terminal theme；Electron 外观独立跟随系统。">
      <ThemeSettings state={state} />
    </Section>
  );
}

export function SettingsWorkspace({ store = workspaceStore, onClose }: SettingsWorkspaceProps) {
  const [page, setPage] = useState<SettingsPage>("models");
  const [query, setQuery] = useState("");
  const state = useSettingsData();
  const hasData = Object.values(state.data).some(Boolean);
  const activeItem = pageItems.find((item) => item.id === page) ?? pageItems[0]!;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGroups = pageGroups.map((group) => ({
    ...group,
    items: normalizedQuery
      ? group.items.filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase().includes(normalizedQuery))
      : group.items,
  })).filter((group) => group.items.length);
  return (
    <section className="settings-workspace" aria-label="Linguist Agent 设置">
      <nav className="settings-navigation" aria-label="设置分类">
        <div className="settings-navigation__chrome">
          <button type="button" className="settings-back" onClick={onClose} disabled={!onClose}>
            <ArrowLeft aria-hidden="true" />返回工作区
          </button>
          <label className="settings-search">
            <Search aria-hidden="true" />
            <span className="la-sr-only">搜索设置</span>
            <input type="search" value={query} placeholder="搜索设置…" onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="settings-navigation__scroll">
          {visibleGroups.map((group) => (
            <section key={group.label} className="settings-navigation__group" aria-labelledby={`settings-group-${group.label}`}>
              <h2 id={`settings-group-${group.label}`}>{group.label}</h2>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.detail}
                    aria-current={page === item.id ? "page" : undefined}
                    onClick={() => setPage(item.id)}
                  >
                    <Icon aria-hidden="true" /><span>{item.label}</span>
                  </button>
                );
              })}
            </section>
          ))}
          {!visibleGroups.length ? <p className="settings-navigation__empty">没有匹配的设置</p> : null}
        </div>
      </nav>
      <div className="settings-main" role="main" aria-labelledby="settings-page-title">
        <header className="settings-page-header">
          <div>
            <h1 id="settings-page-title">{activeItem.label}</h1>
            <p>{activeItem.detail}</p>
          </div>
          <Button variant="ghost" loading={state.loading} loadingLabel="正在刷新" disabled={state.mutation !== null} onClick={() => void state.load()}>
            <RefreshCw aria-hidden="true" />刷新
          </Button>
        </header>
        <div className="settings-scroll" tabIndex={-1} aria-busy={state.loading}>
          {state.errors.length ? (
            <div className="settings-load-errors" role="alert">
              <AlertTriangle aria-hidden="true" />
              <div><strong>部分设置没有载入</strong>{state.errors.map((error) => <span key={error}>{error}</span>)}</div>
            </div>
          ) : null}
          {state.mutationError ? (
            <div className="settings-load-errors" role="alert">
              <AlertTriangle aria-hidden="true" /><div><strong>设置没有保存</strong><span>{state.mutationError}</span></div>
            </div>
          ) : null}
          {state.mutationSuccess ? (
            <div className="settings-save-success" role="status">
              <CheckCircle aria-hidden="true" /><span>设置已由 runtime 保存。</span>
            </div>
          ) : null}
          {state.loading && !hasData ? <SettingsSkeleton /> : (
            <div className="settings-content" aria-label={`${activeItem.label}设置`}>
              <SettingsPageContent page={page} state={state} store={store} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
