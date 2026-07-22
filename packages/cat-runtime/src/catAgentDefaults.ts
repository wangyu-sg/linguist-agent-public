/**
 * Single source of truth for the web/server agent session policy.
 *
 * createCatAgentSession uses these values to configure the Pi session, and the
 * runtime-health surface reads the SAME constants — so the health report can
 * never green-certify a stance the session does not actually apply. Flip a value
 * here and both the real behavior and the health check change together.
 */
export const BROWSER_SESSION_POLICY = {
  /** Product sessions load only server-selected Package resources for their Run profile. */
  noExtensions: true,
  /** CAT tools are still provided explicitly via customTools. */
  useCustomTools: true,
  /** Read/search built-ins stay active; generic edit/write are excluded from CAT sessions. */
  builtinTools: true,
  /** Runtime hooks remain defense in depth around the explicit CAT write surface. */
  dataStoreWriteGuard: true,
  /** Non-CAT inherited/built-in results are advisory unless promoted through CAT evidence gates. */
  nonCatToolResultsCitable: false,
} as const;

/** Default session mode for web/server: one durable, project-local session. */
export const DEFAULT_PROJECT_SESSION_MODE = "project" as const;

/** Project sessions resolve to a deterministic project-local session id. */
export const PROJECT_SESSION_STRATEGY = "deterministic-project-session-id" as const;

/**
 * Session presets. A preset is just a named bundle of createAgentSession options
 * (tool surface + system framing) — which is exactly how Pi natively models this; there
 * is no `preset` enum in the SDK, so LA owns this registry. Confirmed against the 0.76
 * SDK: createAgentSession(tools/noTools/customTools/systemPromptOverride) IS the preset
 * mechanism. Listing/switching uses native SessionManager.list + getContextUsage.
 *
 * - cat     → the full CAT workspace (all custom CAT tools).
 * - dev     → LA edits its own source; built-in coding tools only, CAT tools off. Pair
 *             with the dev-code-proposals extension so edits become reviewable proposals.
 * - scratch → conversational general linguist agent, no project tools (Discord-reachable).
 */
export type CatSessionPreset = "cat" | "dev" | "scratch" | "eval";

export interface CatSessionPresetDef {
  preset: CatSessionPreset;
  label: string;
  toolMode: "cat" | "code" | "conversational";
  systemAppendix?: string;
}

export const CAT_SESSION_PRESETS: Record<CatSessionPreset, CatSessionPresetDef> = {
  cat: {
    preset: "cat",
    label: "CAT workspace",
    toolMode: "cat",
  },
  dev: {
    preset: "dev",
    label: "LA source (dev)",
    toolMode: "code",
    systemAppendix:
      "Dev mode: you may edit Linguist Agent's own source. When the dev-code-proposals extension is active, every edit/write is captured as a reviewable code-proposal rather than applied directly. Never auto-push to main.",
  },
  scratch: {
    preset: "scratch",
    label: "Scratch",
    toolMode: "conversational",
    systemAppendix:
      "Scratch mode: general game-localization assistant with no open CAT project. Establish the source and target locales from the request instead of assuming a language pair. Do not claim to read or write project TM/TB/segments; direct real CAT work to the project workspace.",
  },
  eval: {
    preset: "eval",
    label: "Private Eval",
    toolMode: "conversational",
    systemAppendix:
      "Private Eval generation: produce only the requested candidate output from the supplied source/evidence packet. Reference targets and project mutation are unavailable by design.",
  },
};

export const DEFAULT_SESSION_PRESET: CatSessionPreset = "cat";

/** Minimal active tool surface for one selected-segment CAT turn. */
export const CAT_SEGMENT_RUN_TOOLS = [
  "ask_user",
  "document_parse",
  "document_search",
  "document_screenshot",
  "tm_lookup",
  "termbase_lookup",
  "glossary_lookup",
  "asset_block_search",
  "asset_read",
  "constraint_pack",
  "exemplar_lookup",
  "segment_set_target",
  "proposal_create",
  "quality_audit",
  "expressive_audit",
] as const;
