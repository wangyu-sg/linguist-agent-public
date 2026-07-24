import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Check, ChevronDown, Crosshair, Hand, Paperclip, Plus, Settings2, ShieldCheck, X } from "lucide-react";
import type { TaskAgentThread } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type { TaskUsage } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import type {
  AgentNativeCapabilityCatalog,
  AgentPermissionContract,
  AgentPermissionMode,
  AgentSessionInfo,
  AgentSessionSummary,
  AgentThinkingLevel,
  NativeComposerCapabilityId,
  PiProviderCatalog,
  ProjectAssetsCatalog,
  ProjectSummary,
  StandaloneFileGrantDTO,
} from "../data/workspace-client.ts";
import { workspaceClient } from "../data/workspace-client.ts";
import { ingestProjectAssets } from "../assets/actions.ts";
import { PersonaAvatar } from "../conversation/PersonaAvatar.tsx";
import { resolvePersona } from "../conversation/personas.ts";
import type { ConversationRecipient } from "../conversation/TaskConversation.tsx";
import { useDismissibleDetails } from "../ui/index.ts";
import { ComposerPowerSlider } from "./ComposerPowerSlider.tsx";
import {
  readPersistedThinkingLevel,
  thinkingLevelLabels,
  writePersistedThinkingLevel,
} from "./composer-power.ts";

export { thinkingLevelLabels };

/* ============================================================
   全局唯一 composer 控件层:任何"给 Agent 发消息"的表面都组装
   同一套控件([+][范围][发送对象] … [上下文仪表][模型][发送]),
   只随容器尺寸自适应,不允许出现第二种形态。
   ============================================================ */

export type ComposerRouteSelection = {
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: AgentThinkingLevel;
};

type ComposerPopoverSide = "up" | "down";

type ComposerPopoverPlacement = {
  side: ComposerPopoverSide;
  maxHeight: number;
};

/**
 * Composer menus normally rise from the footer, but a Batch composer can sit
 * in the middle of a page. Pick the roomier side at the moment a native
 * <details> disclosure opens so its first rows never disappear beneath the
 * fixed desktop toolbar.
 */
function useComposerPopoverSide(ref: RefObject<HTMLDetailsElement | null>) {
  const [placement, setPlacement] = useState<ComposerPopoverPlacement>({ side: "up", maxHeight: 320 });
  const position = useCallback(() => {
    window.requestAnimationFrame(() => {
      const details = ref.current;
      if (!details?.open) return;
      const rect = details.getBoundingClientRect();
      const toolbarBottom = document.querySelector<HTMLElement>(".product-toolbar")?.getBoundingClientRect().bottom ?? 0;
      const spaceAbove = Math.max(0, rect.top - toolbarBottom - 8);
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - 8);
      const side: ComposerPopoverSide = spaceBelow > spaceAbove ? "down" : "up";
      const maxHeight = Math.floor(side === "down" ? spaceBelow : spaceAbove);
      setPlacement((current) => (
        current.side === side && current.maxHeight === maxHeight
          ? current
          : { side, maxHeight }
      ));
    });
  }, [ref]);

  useEffect(() => {
    const reposition = () => position();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [position]);

  return { ...placement, position };
}

export const capabilityStatusLabels: Record<AgentNativeCapabilityCatalog["capabilities"][number]["status"], string> = {
  ready: "可用",
  unavailable: "不可用",
  setup_required: "需要设置",
  permission_required: "需要权限",
  consent_required: "需要确认",
};

export interface ComposerData {
  assetCatalog: ProjectAssetsCatalog | null;
  assetState: "idle" | "loading" | "ready" | "error";
  assetError: string | null;
  selectedAssetPaths: string[];
  isImportingAssets: boolean;
  capabilityCatalog: AgentNativeCapabilityCatalog | null;
  capabilityState: "idle" | "loading" | "ready" | "error";
  selectedCapabilityIds: NativeComposerCapabilityId[];
  providerCatalog: PiProviderCatalog | null;
  providerState: "idle" | "loading" | "ready" | "error";
  sessionInfo: AgentSessionInfo | null;
  routeSelection: ComposerRouteSelection;
  routeSelectionError: string | null;
  setRouteSelection: (selection: ComposerRouteSelection) => void;
  toggleAsset: (path: string) => void;
  toggleCapability: (id: NativeComposerCapabilityId) => void;
  removeAsset: (path: string) => void;
  importProjectAssets: () => Promise<void>;
  refreshSession: () => Promise<void>;
  resetTransientSelections: () => void;
}

/**
 * Composer 控件的全量数据:项目资料、能力插件、Provider 目录、
 * 会话用量与路由选择。taskId 为空(批次首启)时跳过会话加载,
 * 其余控件照常工作。
 */
export function useComposerData(
  project: ProjectSummary | null,
  taskId: string | null,
): ComposerData {
  const projectId = project?.projectId ?? null;
  const [assetCatalog, setAssetCatalog] = useState<ProjectAssetsCatalog | null>(null);
  const [assetState, setAssetState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [assetError, setAssetError] = useState<string | null>(null);
  const [selectedAssetPaths, setSelectedAssetPaths] = useState<string[]>([]);
  const [isImportingAssets, setIsImportingAssets] = useState(false);
  const [capabilityCatalog, setCapabilityCatalog] = useState<AgentNativeCapabilityCatalog | null>(null);
  const [capabilityState, setCapabilityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<NativeComposerCapabilityId[]>([]);
  const [providerCatalog, setProviderCatalog] = useState<PiProviderCatalog | null>(null);
  const [providerState, setProviderState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sessionInfo, setSessionInfo] = useState<AgentSessionInfo | null>(null);
  const [routeSelection, setRouteSelectionState] = useState<ComposerRouteSelection>({});
  const routeSelectionRef = useRef<ComposerRouteSelection>({});
  const modelPreferenceRequestRef = useRef(0);
  const [routeSelectionError, setRouteSelectionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAssetCatalog(null);
    setSelectedAssetPaths([]);
    setAssetError(null);
    if (!projectId) {
      setAssetState("idle");
      return () => { cancelled = true; };
    }
    setAssetState("loading");
    void workspaceClient.listProjectAssets(projectId).then((catalog) => {
      if (cancelled) return;
      setAssetCatalog(catalog);
      setAssetState("ready");
    }).catch((error) => {
      if (cancelled) return;
      setAssetState("error");
      setAssetError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [projectId]);

  // Pi's provider directory is global runtime state. A projectless Chat is
  // still a real Agent conversation, so it must get the same model selector
  // as a Project Task instead of an intentionally empty control.
  useEffect(() => {
    let cancelled = false;
    setProviderCatalog(null);
    setProviderState("loading");
    void workspaceClient.fetchPiProviders().then((catalog) => {
      if (cancelled) return;
      setProviderCatalog(catalog);
      setProviderState("ready");
      setRouteSelectionState((current) => {
        // The runtime catalog already resolved the user-owned Pi preference
        // (or the bundled project fallback before a user has chosen one).
        // Preserve a choice made while this request was in flight.
        const next: ComposerRouteSelection = {
          ...current,
          ...(current.modelProvider && current.modelId ? {} : {
            modelProvider: catalog.defaults?.provider,
            modelId: catalog.defaults?.modelId,
          }),
          ...(current.thinkingLevel ? {} : { thinkingLevel: catalog.defaults?.thinkingLevel }),
        };
        routeSelectionRef.current = next;
        return next;
      });
    }).catch(() => {
      if (!cancelled) setProviderState("error");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCapabilityCatalog(null);
    setSessionInfo(null);
    setSelectedCapabilityIds([]);
    // 思考级别是 Task 级偏好(Power Slider):切换 Task 时恢复该 Task
    // 持久化的选择。模型则是本机用户偏好，绝不能随着 Task 被清掉。
    setRouteSelectionState((current) => {
      const next = { ...current, thinkingLevel: readPersistedThinkingLevel(globalThis.localStorage, taskId) ?? current.thinkingLevel };
      routeSelectionRef.current = next;
      return next;
    });
    if (!projectId) {
      setCapabilityState("idle");
      return () => { cancelled = true; };
    }
    setCapabilityState("loading");
    void workspaceClient.fetchAgentNativeCapabilities().then((catalog) => {
      if (cancelled) return;
      setCapabilityCatalog(catalog);
      setCapabilityState("ready");
    }).catch(() => {
      if (!cancelled) setCapabilityState("error");
    });
    if (taskId) {
      void workspaceClient.fetchTaskAgentSession(projectId, taskId).then((session) => {
        if (!cancelled) setSessionInfo(session);
      }).catch(() => {
        if (!cancelled) setSessionInfo(null);
      });
    }
    return () => { cancelled = true; };
  }, [projectId, taskId]);

  const refreshSession = useCallback(async () => {
    if (!projectId || !taskId) return;
    try {
      const session = await workspaceClient.fetchTaskAgentSession(projectId, taskId);
      setSessionInfo(session);
    } catch {
      // Keep the last server snapshot; a missing diagnostic must not become fake zero usage.
    }
  }, [projectId, taskId]);

  const importProjectAssets = useCallback(async () => {
    if (!project || isImportingAssets) return;
    setIsImportingAssets(true);
    setAssetError(null);
    try {
      const catalog = assetCatalog ?? await workspaceClient.listProjectAssets(project.projectId);
      const outcome = await ingestProjectAssets(
        {
          projectId: project.projectId,
        },
        {
          pickImportFiles: () => window.linguist.system.pickImportFiles("asset"),
          refreshProjectAssets: (input) => window.linguist.system.refreshProjectAssets(input),
          listAssets: (projectId) => workspaceClient.listProjectAssets(projectId),
          parseAsset: (projectId, assetPath) => workspaceClient.parseProjectAsset(projectId, assetPath, "structured"),
          readAsset: (projectId, assetPath) => workspaceClient.readProjectAsset(projectId, assetPath),
        },
      );
      const nextCatalog = outcome.catalog ?? catalog;
      setAssetCatalog(nextCatalog);
      setAssetState("ready");
      const failures = outcome.files.filter((file) => file.error).map((file) => `${file.relPath ?? file.handle.name}: ${file.error}`);
      setAssetError(failures.length ? failures.join("\n") : null);
    } catch (error) {
      setAssetState("error");
      setAssetError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsImportingAssets(false);
    }
  }, [assetCatalog, isImportingAssets, project]);

  const toggleAsset = useCallback((path: string) => {
    setSelectedAssetPaths((current) => {
      if (current.includes(path)) return current.filter((candidate) => candidate !== path);
      if (current.length >= 12) return current;
      return [...current, path];
    });
  }, []);

  const removeAsset = useCallback((path: string) => {
    setSelectedAssetPaths((current) => current.filter((candidate) => candidate !== path));
  }, []);

  const toggleCapability = useCallback((id: NativeComposerCapabilityId) => {
    if (!capabilityCatalog?.capabilities.some((capability) => capability.id === id && capability.selectable && capability.status === "ready")) return;
    setSelectedCapabilityIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]);
  }, [capabilityCatalog]);

  const setRouteSelection = useCallback((next: ComposerRouteSelection) => {
    const previous = routeSelectionRef.current;
    routeSelectionRef.current = next;
    setRouteSelectionState(next);
    setRouteSelectionError(null);

    const modelChanged = Boolean(
      next.modelProvider
      && next.modelId
      && (next.modelProvider !== previous.modelProvider || next.modelId !== previous.modelId),
    );
    if (!modelChanged || !next.modelProvider || !next.modelId) return;

    const request = ++modelPreferenceRequestRef.current;
    void workspaceClient.savePiModelPreference(next.modelProvider, next.modelId).then(() => {
      if (request === modelPreferenceRequestRef.current) setRouteSelectionError(null);
    }).catch((error) => {
      if (request !== modelPreferenceRequestRef.current) return;
      // Do not lie about a model choice the runtime rejected. Restore the
      // prior known-good selection and show the actionable failure in Composer.
      routeSelectionRef.current = previous;
      setRouteSelectionState(previous);
      setRouteSelectionError(`当前模型没有保存：${error instanceof Error ? error.message : String(error)}`);
    });
  }, []);

  const resetTransientSelections = useCallback(() => {
    // 发送/切换追问只清一次性资料与能力。模型是用户的本机当前选择，
    // 思考级别是 Task 偏好；两者都不能因发送一条消息而被重置。
    setSelectedAssetPaths([]);
    setSelectedCapabilityIds([]);
  }, []);

  useEffect(() => {
    writePersistedThinkingLevel(globalThis.localStorage, taskId, routeSelection.thinkingLevel);
  }, [taskId, routeSelection.thinkingLevel]);

  return {
    assetCatalog,
    assetState,
    assetError,
    selectedAssetPaths,
    isImportingAssets,
    capabilityCatalog,
    capabilityState,
    selectedCapabilityIds,
    providerCatalog,
    providerState,
    sessionInfo,
    routeSelection,
    routeSelectionError,
    setRouteSelection,
    toggleAsset,
    toggleCapability,
    removeAsset,
    importProjectAssets,
    refreshSession,
    resetTransientSelections,
  };
}

export function currentSessionSummary(session: AgentSessionInfo | null): AgentSessionSummary | null {
  if (!session) return null;
  return session.sessions.find((candidate) => candidate.id === session.activeSessionId) ?? session.sessions[0] ?? null;
}

export function ComposerAttachmentTray({
  paths,
  onRemove,
  labelForPath = (path) => path.startsWith("/") ? fileName(path) : path,
}: {
  paths: string[];
  onRemove: (path: string) => void;
  labelForPath?: (path: string) => string;
}) {
  return (
    <div className="agent-composer__attachment-list" aria-label="已附加到下一次 Run 的项目资料">
      {paths.map((path) => (
        <span className="agent-composer__attachment" key={path}>
          <Paperclip aria-hidden="true" />
          <span title={path}>{labelForPath(path)}</span>
          <button type="button" onClick={() => onRemove(path)} aria-label={`移除附件 ${labelForPath(path)}`}><X aria-hidden="true" /></button>
        </span>
      ))}
    </div>
  );
}

/**
 * Standalone Chat does not inherit arbitrary disk access. This is the small,
 * visible bridge between the user's native file picker and the server-owned
 * file-grant ledger. Selection is for the next Run only. File grants are
 * managed here, rather than being confused with the Agent autonomy policy in
 * the adjacent shield control.
 */
export function ComposerChatAttachmentDisclosure({
  disabled = false,
  grants,
  isPicking = false,
  onPickFiles,
  onRevokeGrant,
  onToggleGrant,
  revokeBusyGrantId,
  selectedGrantIds,
}: {
  disabled?: boolean;
  grants: StandaloneFileGrantDTO[];
  isPicking?: boolean;
  onPickFiles: () => Promise<void>;
  onRevokeGrant: (grantId: string) => Promise<void>;
  onToggleGrant: (grantId: string) => void;
  revokeBusyGrantId?: string | null;
  selectedGrantIds: string[];
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(detailsRef);
  const popover = useComposerPopoverSide(detailsRef);
  return (
    <details
      className="conversation-composer__add conversation-composer__chat-attachments"
      ref={detailsRef}
      data-popover-side={popover.side}
      style={{ "--composer-popover-max-height": `${popover.maxHeight}px` } as CSSProperties}
      onToggle={popover.position}
    >
      <summary aria-label="添加文件到下一次 Run" title={disabled ? "Run 进行中，文件会在下一次 Run 生效" : "添加文件到下一次 Run"} aria-disabled={disabled}>
        <Plus aria-hidden="true" />
      </summary>
      <div className="conversation-composer__add-popover" aria-label="添加文件">
        <header>添加到下一次 Run</header>
        <section className="conversation-composer__add-section" aria-labelledby="composer-chat-files-heading">
          <h3 id="composer-chat-files-heading">已授权文件</h3>
          {grants.length ? (
            <fieldset disabled={disabled}>
              <legend className="la-sr-only">选择要附加的文件</legend>
              {grants.filter((grant) => grant.kind === "file").map((grant) => {
                const selected = selectedGrantIds.includes(grant.id);
                const blocked = !selected && selectedGrantIds.length >= 12;
                return (
                  <label className="conversation-composer__asset-option" key={grant.id} title={blocked ? "一次 Run 最多附加 12 个文件" : grant.realPath}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={blocked}
                      onChange={() => onToggleGrant(grant.id)}
                    />
                    <span>{fileName(grant.realPath)}</span>
                    <small>{grant.access === "read_write" ? "读写" : "只读"}</small>
                  </label>
                );
              })}
            </fieldset>
          ) : <p>这个 Chat 还没有授权文件。</p>}
          <button
            type="button"
            className="conversation-composer__add-action"
            disabled={disabled || isPicking}
            onClick={() => { void onPickFiles(); }}
          >
            <Paperclip aria-hidden="true" />
            <span>{isPicking ? "正在添加文件…" : "从电脑选择文件…"}</span>
          </button>
          {grants.length ? (
            <details className="conversation-composer__attachment-management">
              <summary>管理已授权文件</summary>
              <div className="conversation-composer__permissions-files" aria-label="已授权文件列表">
                {grants.map((grant) => (
                  <div key={grant.id}>
                    <span title={grant.realPath}>{fileName(grant.realPath)}</span>
                    <small>{grant.kind === "directory" ? "文件夹" : "文件"} · {grant.access === "read_write" ? "读写" : "只读"}</small>
                    <button
                      type="button"
                      disabled={disabled || revokeBusyGrantId === grant.id}
                      onClick={() => { void onRevokeGrant(grant.id); }}
                    >{revokeBusyGrantId === grant.id ? "正在撤销…" : "撤销"}</button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          <p className="conversation-composer__add-note">文件只会授予这个 Chat；图片在支持视觉输入的模型上作为下一次 Run 的附件，其余文件仍可由受控工具读取。</p>
        </section>
      </div>
    </details>
  );
}

/**
 * The shield is Agent autonomy, not a file-access ledger. It writes the
 * server-owned Pi permission contract used by the next Run. Project Tasks
 * receive the same control and surface as Chats, with a scoped policy route.
 */
export function ComposerPermissionDisclosure({
  disabled = false,
  onOpenSettings,
  projectId,
}: {
  disabled?: boolean;
  onOpenSettings?: () => void;
  projectId?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [contract, setContract] = useState<AgentPermissionContract | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  useDismissibleDetails(detailsRef);
  const popover = useComposerPopoverSide(detailsRef);
  useEffect(() => {
    let active = true;
    setState("loading");
    setError(null);
    setContract(null);
    void workspaceClient.fetchAgentPermissions(projectId).then((next) => {
      if (!active) return;
      setContract(next);
      setState("ready");
    }).catch((cause) => {
      if (!active) return;
      setState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [projectId]);

  const activePreset = contract?.presets.find((preset) => preset.id === contract.mode) ?? null;
  const summaryLabel = state === "loading" ? "读取权限…" : activePreset?.label ?? "权限";
  const chooseMode = async (mode: AgentPermissionMode) => {
    if (!contract || disabled || state === "saving" || mode === contract.mode) return;
    setState("saving");
    setError(null);
    try {
      const next = await workspaceClient.updateAgentPermissions({
        mode,
        ...(mode === "custom" ? { customRules: contract.customRules } : {}),
      }, projectId);
      setContract(next);
      setState("ready");
      if (detailsRef.current) detailsRef.current.open = false;
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <details
      className="conversation-composer__add conversation-composer__permissions"
      ref={detailsRef}
      data-popover-side={popover.side}
      style={{ "--composer-popover-max-height": `${popover.maxHeight}px` } as CSSProperties}
      onToggle={popover.position}
    >
      <summary aria-label={`调整 Agent 权限，当前为${summaryLabel}`} title="调整 Agent 权限">
        <ShieldCheck aria-hidden="true" />
        <span>{summaryLabel}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="conversation-composer__permissions-popover" aria-label="Agent 权限">
        <header><span>Agent 权限</span><strong>应如何批准 Agent 操作？</strong></header>
        {contract ? (
          <div className="conversation-composer__permission-options" role="radiogroup" aria-label="Agent 权限模式">
            {contract.presets.map((preset) => {
              const selected = preset.id === contract.mode;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-mode={preset.id}
                  disabled={disabled || state === "saving"}
                  onClick={() => { void chooseMode(preset.id); }}
                >
                  <PermissionPresetIcon mode={preset.id} />
                  <span><strong>{preset.label}</strong><small>{preset.description}</small></span>
                  {selected ? <Check aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        ) : <p role={state === "error" ? "alert" : "status"}>{error ?? "正在读取当前权限策略…"}</p>}
        <p>{projectId ? "仅作用于当前 Project；已经开始的 Run 不会被中途改写。" : "作用于无项目 Chat；已经开始的 Run 不会被中途改写。"}</p>
        {contract?.mode === "custom" && onOpenSettings ? (
          <button type="button" onClick={() => { if (detailsRef.current) detailsRef.current.open = false; onOpenSettings(); }}>
            <Settings2 aria-hidden="true" /><span>在设置中编辑详细规则</span>
          </button>
        ) : null}
      </div>
    </details>
  );
}

function PermissionPresetIcon({ mode }: { mode: AgentPermissionMode }) {
  if (mode === "ask") return <Hand aria-hidden="true" />;
  if (mode === "custom") return <Settings2 aria-hidden="true" />;
  return <ShieldCheck aria-hidden="true" />;
}

function fileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? path;
}

export function ComposerAddDisclosure({
  assets,
  assetError,
  assetState,
  capabilityCatalog,
  capabilityState,
  disabled,
  isImportingAssets,
  onImportAssets,
  onToggleAsset,
  onToggleCapability,
  selectedAssetPaths,
  selectedCapabilityIds,
}: {
  assets: ProjectAssetsCatalog | null;
  assetError: string | null;
  assetState: "idle" | "loading" | "ready" | "error";
  capabilityCatalog: AgentNativeCapabilityCatalog | null;
  capabilityState: "idle" | "loading" | "ready" | "error";
  disabled?: boolean;
  isImportingAssets: boolean;
  onImportAssets: () => void;
  onToggleAsset: (path: string) => void;
  onToggleCapability: (id: NativeComposerCapabilityId) => void;
  selectedAssetPaths: string[];
  selectedCapabilityIds: NativeComposerCapabilityId[];
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(detailsRef);
  const popover = useComposerPopoverSide(detailsRef);
  const assetsCount = assets?.assets.length ?? 0;
  const selectableCapabilities = capabilityCatalog?.capabilities.filter((capability) => capability.selectable && capability.status === "ready") ?? [];
  return (
    <details
      className="conversation-composer__add"
      ref={detailsRef}
      data-popover-side={popover.side}
      style={{ "--composer-popover-max-height": `${popover.maxHeight}px` } as CSSProperties}
      onToggle={popover.position}
    >
      <summary aria-label="为下一次 Run 添加资料或能力" title="添加资料或能力(⌘⇧A)" aria-disabled={disabled}>
        <Plus aria-hidden="true" />
      </summary>
      <div className="conversation-composer__add-popover" aria-label="添加到当前工作">
        <header>添加到下一次 Main Agent Run</header>
        <section className="conversation-composer__add-section" aria-labelledby="composer-assets-heading">
          <h3 id="composer-assets-heading">项目资料</h3>
          {assetState === "loading" ? <p>正在载入项目资料…</p> : null}
          {assetState === "error" ? <p role="alert">{assetError ?? "项目资料暂时不可用。"}</p> : null}
          {assetState === "ready" && assetsCount === 0 ? <p>当前 Project 还没有可附加的资料。</p> : null}
          {assetsCount ? (
            <fieldset disabled={disabled}>
              <legend className="la-sr-only">选择项目资料</legend>
              {assets!.assets.map((asset) => {
                const selected = selectedAssetPaths.includes(asset.relPath);
                const blocked = !selected && selectedAssetPaths.length >= 12;
                return (
                  <label className="conversation-composer__asset-option" key={asset.relPath} title={blocked ? "一次 Run 最多附加 12 个项目资料" : asset.relPath}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={blocked}
                      onChange={() => onToggleAsset(asset.relPath)}
                    />
                    <span>{asset.relPath}</span>
                    <small>{asset.selectedRole || asset.kind}</small>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          <button type="button" className="conversation-composer__add-action" disabled={disabled || isImportingAssets} onClick={onImportAssets}>
            <Paperclip aria-hidden="true" />
            <span>{isImportingAssets ? "正在登记资料…" : "从项目文件夹选择资料…"}</span>
          </button>
          <p className="conversation-composer__add-note">只登记当前 Project 文件夹内的文件;不会复制客户文件,也不会触发模型调用。</p>
        </section>
        <section className="conversation-composer__add-section" aria-labelledby="composer-capabilities-heading">
          <h3 id="composer-capabilities-heading">能力插件</h3>
          {capabilityState === "loading" ? <p>正在检查能力插件…</p> : null}
          {capabilityState === "error" ? <p>能力目录暂时不可用。</p> : null}
          {capabilityCatalog?.capabilities.map((capability) => {
            const selected = selectedCapabilityIds.includes(capability.id);
            const selectable = capability.selectable && capability.status === "ready";
            return (
              <label className="conversation-composer__asset-option" key={capability.id} title={capability.reason ?? capability.description}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={disabled || !selectable}
                  onChange={() => onToggleCapability(capability.id)}
                />
                <span>{capability.label}</span>
            <small>{capabilityStatusLabels[capability.status]}</small>
              </label>
            );
          })}
          {!selectableCapabilities.length && capabilityState === "ready" ? <p>当前没有可直接启用的能力插件。</p> : null}
          {capabilityCatalog?.capabilities.some((capability) => capability.reason) ? (
            <p className="conversation-composer__add-note">不可用能力会明确显示设置、权限或确认要求;不会伪装成已启用。</p>
          ) : null}
        </section>
      </div>
    </details>
  );
}

export function ComposerScopeDisclosure({
  batchLabel,
  focusedSegmentId,
  hasBatch = true,
  hideProject = false,
  projectName,
  recipient,
  defaultRecipientLabel = "Main Agent",
  scopeLabel,
  taskLabel = "Task",
  taskTitle,
}: {
  batchLabel: string | null;
  focusedSegmentId: string | null;
  hasBatch?: boolean;
  /** Projectless Chats have no user-facing Project scope. */
  hideProject?: boolean;
  projectName: string;
  recipient: ConversationRecipient | null;
  defaultRecipientLabel?: string;
  /** A Batch can be scoped before it has created a Task. */
  scopeLabel?: string;
  taskLabel?: string;
  taskTitle?: string | null;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(detailsRef);
  const popover = useComposerPopoverSide(detailsRef);
  const resolvedScopeLabel = scopeLabel ?? (focusedSegmentId ? `句段 ${shortSegmentLabel(focusedSegmentId)}` : hasBatch ? "当前 Task" : "当前项目");
  return (
    <details
      className="conversation-composer__scope"
      ref={detailsRef}
      data-popover-side={popover.side}
      style={{ "--composer-popover-max-height": `${popover.maxHeight}px` } as CSSProperties}
      onToggle={popover.position}
    >
      <summary aria-label={`查看发送范围,${resolvedScopeLabel}`} title="查看发送范围">
        <Crosshair aria-hidden="true" />
        <span data-composer-collapse="wide">{resolvedScopeLabel}</span>
      </summary>
      <div className="conversation-composer__scope-popover" aria-label="当前消息范围">
        <header>发送范围</header>
        <dl>
          {!hideProject ? <div><dt>项目</dt><dd>{projectName}</dd></div> : null}
          {batchLabel ? <div><dt>Batch</dt><dd>{batchLabel}</dd></div> : null}
          {taskTitle ? <div><dt>{taskLabel}</dt><dd>{taskTitle}</dd></div> : null}
          {focusedSegmentId ? <div><dt>句段</dt><dd>{focusedSegmentId}</dd></div> : null}
          <div><dt>发送给</dt><dd>{recipient ? recipient.displayName : defaultRecipientLabel}</dd></div>
        </dl>
      </div>
    </details>
  );
}

function shortSegmentLabel(segmentId: string): string {
  const suffix = segmentId.match(/(?:^|[-_])0*(\d+)$/)?.[1];
  return suffix ? String(Number(suffix)) : segmentId;
}

/** 各家 provider 的小徽记:抽象几何形,12px stroke。未知厂商回退 Sparkles。 */
function ProviderGlyph({ providerId }: { providerId?: string | null }) {
  const id = (providerId ?? "").toLowerCase();
  let body: ReactNode = <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />;
  if (id.includes("anthropic") || id.includes("claude")) {
    body = <g><path d="M12 4v16" /><path d="M5.5 8l13 8" /><path d="M18.5 8l-13 8" /></g>;
  } else if (id.includes("openai") || id.includes("gpt") || id.includes("azure")) {
    body = <path d="M12 4l7 4v8l-7 4-7-4V8z" />;
  } else if (id.includes("google") || id.includes("gemini") || id.includes("vertex")) {
    body = <path d="M12 3c1 5 4 8 9 9-5 1-8 4-9 9-1-5-4-8-9-9 5-1 8-4 9-9z" />;
  } else if (id.includes("deepseek")) {
    body = <path d="M3 15c2.5 0 2.5-4 5-4s2.5 4 5 4 2.5-4 5-4 2.5 4 3 4" />;
  } else if (id.includes("moonshot") || id.includes("kimi")) {
    body = <path d="M14.5 4a8 8 0 100 16 6.8 6.8 0 010-16z" />;
  } else if (id.includes("qwen") || id.includes("alibaba") || id.includes("dashscope")) {
    body = <g><path d="M6 16a4 4 0 01.6-7.95A5 5 0 0116 9.5 3.5 3.5 0 0117.5 16z" /></g>;
  } else if (id.includes("mistral")) {
    body = <g><path d="M5 6h4v4H5zM10 10h4v4h-4zM15 6h4v4h-4zM7.5 14h4v4h-4zM13.5 14h4v4h-4z" /></g>;
  } else if (id.includes("xai") || id.includes("grok")) {
    body = <g><path d="M5 5l14 14M19 5L5 19" /></g>;
  } else if (id.includes("opencode") || id.includes("openrouter") || id.includes("ollama")) {
    body = <g><path d="M8 6l-5 6 5 6M16 6l5 6-5 6" /></g>;
  }
  return (
    <svg
      className="composer-provider-glyph"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  );
}

/** 发送对象 chip:追问专家(可取消)或 Main Agent。 */
export function ComposerRecipientChip({ recipient, threads, onCancelRecipient, showDefaultRecipient = true }: {
  recipient: ConversationRecipient | null;
  threads: TaskAgentThread[];
  onCancelRecipient?: () => void;
  /** No-project Chat does not need to expose the internal Main-Agent routing chip. */
  showDefaultRecipient?: boolean;
}) {
  if (!recipient) {
    if (!showDefaultRecipient) return null;
    return (
      <span className="conversation-composer__recipient conversation-composer__recipient--main" title="发送给 Main Agent">
        <PersonaAvatar persona={resolvePersona(null)} size="sm" />
        <span data-composer-collapse="wide">Main Agent</span>
      </span>
    );
  }
  const thread = threads.find((candidate) => candidate.id === recipient.threadId);
  const persona = thread
    ? resolvePersona(thread.identity)
    : resolvePersona({ kind: "specialist", roleId: "unknown", displayName: recipient.displayName, roleLabel: "", disclosureLabel: "Agent" });
  return (
    <span className="conversation-composer__recipient" data-hue={persona.hueKey} title={`追问 ${persona.personaName}(${persona.title})`}>
      <PersonaAvatar persona={persona} size="sm" />
      <span>追问 {persona.personaName}</span>
      {onCancelRecipient ? <button type="button" onClick={onCancelRecipient} aria-label={`取消追问 ${persona.personaName}`}><X aria-hidden="true" /></button> : null}
    </span>
  );
}

export function ContextUsageDisclosure({ session, taskUsage }: { session: AgentSessionInfo | null; taskUsage?: TaskUsage }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(detailsRef);
  const popover = useComposerPopoverSide(detailsRef);
  const activeSession = currentSessionSummary(session);
  const contextPct = activeSession?.contextPct;
  const hasContextPct = contextPct !== undefined && contextPct !== null && Number.isFinite(contextPct);
  const pct = hasContextPct ? Math.max(0, Math.min(100, Math.round(contextPct))) : null;
  const cacheRead = taskUsage?.cacheReadTokens ?? activeSession?.cacheReadTokens ?? null;
  const cacheInput = taskUsage?.inputTokens ?? activeSession?.inputTokens ?? null;
  const cacheRate = cacheRead !== null && cacheInput !== null && cacheRead + cacheInput > 0
    ? cacheRead / (cacheRead + cacheInput)
    : null;
  const formatTokens = (value?: number | null) => value === undefined || value === null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString();
  const formatCost = (value?: number) => value === undefined || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: value < 0.01 ? 4 : 2 }).format(value);
  const gaugeTone = pct === null ? undefined : pct >= 90 ? "danger" : pct >= 75 ? "warning" : undefined;
  return (
    <details
      className="conversation-composer__capability conversation-composer__context"
      ref={detailsRef}
      data-popover-side={popover.side}
      style={{ "--composer-popover-max-height": `${popover.maxHeight}px` } as CSSProperties}
      onToggle={popover.position}
    >
      <summary aria-label="查看真实上下文与 Task 累计用量" title="真实上下文、缓存命中率、Task 累计 tokens 与成本">
        <span className="conversation-composer__gauge" data-tone={gaugeTone}>
          <span
            className="conversation-composer__gauge-ring"
            style={{ "--gauge-pct": pct ?? 0 } as CSSProperties}
            aria-hidden="true"
          />
          <span className="conversation-composer__gauge-label la-sr-only">{pct === null ? "上下文用量未知" : `上下文 ${pct}%`}</span>
        </span>
      </summary>
      <div className="conversation-composer__capability-popover">
        <header><span>服务器用量</span><strong>上下文与 Task 累计</strong></header>
        <dl>
          <div><dt>当前上下文</dt><dd>{formatTokens(activeSession?.contextTokens)} / {formatTokens(activeSession?.contextWindow)} tokens</dd></div>
          <div><dt>上下文比例</dt><dd>{hasContextPct ? `${contextPct.toFixed(1)}%` : "—"}</dd></div>
          <div><dt>缓存命中率</dt><dd>{cacheRate === null ? "—" : `${(cacheRate * 100).toFixed(1)}%`}</dd></div>
          <div><dt>缓存读 / 写</dt><dd>{cacheRead === null ? "—" : `${formatTokens(cacheRead)} / ${formatTokens(taskUsage?.cacheWriteTokens ?? activeSession?.cacheWriteTokens)} tokens`}</dd></div>
          <div><dt>Task 累计 tokens</dt><dd>{formatTokens(taskUsage?.totalTokens)}</dd></div>
          <div><dt>Task 累计成本</dt><dd>{formatCost(taskUsage?.costUSD)}</dd></div>
        </dl>
        <p>以上值来自 runtime 的 session 与 canonical Task usage;未报告时显示为 —。</p>
      </div>
    </details>
  );
}

export function ModelDisclosure({
  detailsRef: externalDetailsRef,
  disabled = false,
  onChange,
  onOpenSettings,
  providers,
  selection,
}: {
  /** Slash 命令"选择模型…"需要程序化打开弹层时传入外部 ref。 */
  detailsRef?: RefObject<HTMLDetailsElement | null>;
  disabled?: boolean;
  onChange: (selection: ComposerRouteSelection) => void;
  onOpenSettings?: () => void;
  providers: PiProviderCatalog | null;
  selection: ComposerRouteSelection;
}) {
  const internalDetailsRef = useRef<HTMLDetailsElement>(null);
  const detailsRef = externalDetailsRef ?? internalDetailsRef;
  useDismissibleDetails(detailsRef);
  const popover = useComposerPopoverSide(detailsRef);
  const modelProviders = providers?.providers.filter((provider) => (
    provider.kind === "model" && provider.models.some((model) => model.available)
  )) ?? [];
  const modelOptions = modelProviders.flatMap((provider) => provider.models
    .filter((model) => model.available)
    .map((model) => ({
      key: `${provider.id}\u0000${model.id}`,
      provider,
      model,
    })));
  const selectedOption = modelOptions.find((option) => (
    option.provider.id === selection.modelProvider && option.model.id === selection.modelId
  ));
  const selectedProvider = selectedOption?.provider
    ?? modelProviders.find((provider) => provider.id === selection.modelProvider);
  const selectedModel = selectedOption?.model;
  const summaryLabel = selectedModel?.name ?? selection.modelId ?? "当前模型";
  const glyphProvider = selectedProvider?.id;
  const chooseModel = (option: typeof modelOptions[number]) => {
    onChange({
      modelProvider: option.provider.id,
      modelId: option.model.id,
      thinkingLevel: selection.thinkingLevel,
    });
  };
  const chooseThinking = (thinkingLevel?: AgentThinkingLevel) => {
    onChange({
      modelProvider: selection.modelProvider,
      modelId: selection.modelId,
      thinkingLevel,
    });
  };
  return (
    <details
      className="conversation-composer__capability conversation-composer__next-run"
      ref={detailsRef}
      data-popover-side={popover.side}
      style={{ "--composer-popover-max-height": `${popover.maxHeight}px` } as CSSProperties}
      onToggle={popover.position}
    >
      <summary aria-label={`选择下一次 Run 的模型与思考级别,${summaryLabel}`} title="选择下一次 Run 的模型与思考级别" aria-disabled={disabled}>
        <ProviderGlyph providerId={glyphProvider} />
        <span data-composer-collapse="wide">{summaryLabel}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="conversation-composer__capability-popover">
        <header><span>下一次 Run</span><strong>模型与思考级别</strong></header>
        <section className="conversation-model-picker__section" aria-labelledby="composer-model-heading">
          <h3 id="composer-model-heading">模型</h3>
          <div className="conversation-model-picker__list" role="radiogroup" aria-label="选择下一次 Run 的模型">
            {modelProviders.map((provider) => (
              <div className="conversation-model-picker__provider" key={provider.id}>
                <span>{provider.displayName}</span>
                {provider.models.filter((model) => model.available).map((model) => {
                  const option = { key: `${provider.id}\u0000${model.id}`, provider, model };
                  const selected = selectedOption?.key === option.key;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-selected={selected || undefined}
                      disabled={disabled || !option}
                      onClick={() => chooseModel(option)}
                    >
                      <span className="conversation-model-picker__option-copy"><ProviderGlyph providerId={provider.id} /><span>{model.name ?? model.id}</span></span>
                      {selected ? <Check aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
        <section className="conversation-model-picker__section" aria-labelledby="composer-effort-heading">
          <h3 id="composer-effort-heading">思考级别</h3>
          <ComposerPowerSlider
            defaultLevel={providers?.defaults?.thinkingLevel}
            disabled={disabled}
            explicitLevel={selection.thinkingLevel}
            onChange={chooseThinking}
          />
        </section>
        <p>模型会保存为本机当前选择；思考级别固定到当前 Task。两者只从下一条新 Run 生效，进行中的 Run 不会被中途改写。</p>
        {onOpenSettings ? (
          <button type="button" onClick={() => { if (detailsRef.current) detailsRef.current.open = false; onOpenSettings(); }}>
            <Settings2 aria-hidden="true" /><span>模型与能力设置</span>
          </button>
        ) : null}
      </div>
    </details>
  );
}
