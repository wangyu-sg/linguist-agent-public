export type PiUsageParityStatus = "implemented" | "native_equivalent" | "intentionally_unsupported";

export type PiUsageParityItem = {
  id: string;
  category: string;
  official: string;
  status: PiUsageParityStatus;
  laSurface: string;
  notes: string;
  tests: string[];
};

export type PiUsageParityCatalog = {
  docs: Record<string, string>;
  checkedAt: string;
  pinnedSources: string[];
  policy: string[];
  items: PiUsageParityItem[];
};

const docs = {
  usage: "https://pi.dev/docs/latest/usage",
  sdk: "https://pi.dev/docs/latest/sdk",
  json: "https://pi.dev/docs/latest/json",
  rpc: "https://pi.dev/docs/latest/rpc",
};

const pinnedSources = [
  "node_modules/@earendil-works/pi-coding-agent/dist/cli/args.js",
  "node_modules/@earendil-works/pi-coding-agent/dist/main.js",
  "node_modules/@earendil-works/pi-coding-agent/dist/modes/print-mode.js",
  "node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js",
  "node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts",
  "node_modules/@earendil-works/pi-coding-agent/dist/cli/file-processor.js",
  "node_modules/@earendil-works/pi-coding-agent/dist/cli/list-models.js",
];

const policy = [
  "Persisted Pi configuration belongs in Settings, providers/auth, models, packages/resources, keybindings, themes, and sessions.",
  "One-shot startup flags belong to AgentRunOptions and are consumed by the next scoped Task/CAT stream.",
  "Exact stdin/stdout process protocols are not persisted settings; LA exposes native HTTP/SSE/App UI equivalents and does not spawn raw pi --mode rpc from Settings.",
  "Literal one-shot API keys are intentionally not accepted through stream URLs or docs; provider secrets stay in Keychain or official env references.",
  "CAT sessions do not expose system prompt replacement because CAT runtime appendix and gates must remain in force.",
];

const items: PiUsageParityItem[] = [
  {
    id: "route.provider_model_thinking",
    category: "model",
    official: "--provider, --model, --models, --thinking",
    status: "implemented",
    laSurface: "Model route popover, Pi settings defaults, project route overrides, and AgentRunOptions model-safe stream startup behavior.",
    notes: "LA uses Pi model registry/resolver semantics without requiring users to reopen the CLI.",
    tests: ["tests/pi_settings_parity.test.ts", "apps/desktop/tests/settings.test.ts"],
  },
  {
    id: "auth.api_key",
    category: "auth",
    official: "--api-key <key>",
    status: "intentionally_unsupported",
    laSurface: "Provider Key Console saves API keys to macOS Keychain or writes official $ENV_VAR auth references.",
    notes: "The exact literal one-shot CLI secret is not exposed as a stream/query field because it would leak into URLs, logs, docs, and app state.",
    tests: ["tests/pi_keychain_credentials.test.ts", "tests/pi_auth_login.test.ts"],
  },
  {
    id: "prompt.system_prompt",
    category: "prompt",
    official: "--system-prompt, --append-system-prompt",
    status: "intentionally_unsupported",
    laSurface: "No CAT Settings control. Prompt/resource behavior remains controlled by LA runtime appendix, prompts, skills, and package resources.",
    notes: "Replacing CAT system prompts from Settings would bypass CAT evidence/write gates. Standalone General Chats retain Pi's base prompt plus the General Core boundary; they do not grant CAT authority.",
    tests: ["tests/cat_stream_rules.test.ts", "tests/runtime_hooks.test.ts"],
  },
  {
    id: "session.controls",
    category: "session",
    official: "--continue, --resume, --session, --session-id, --fork, --session-dir, --name, --export",
    status: "implemented",
    laSurface: "Pi Sessions card preserves global history and project JSONL sessions for inspection, naming, deletion, trees, forks, clones, export, and share.",
    notes: "Session controls call Pi SessionManager/exporter APIs through LA routes instead of shelling out to the CLI.",
    tests: ["tests/pi_sessions.test.ts", "apps/desktop/tests/settings.test.ts"],
  },
  {
    id: "startup.tools_resources",
    category: "startup",
    official: "--no-tools, --no-builtin-tools, --tools, --exclude-tools, --extension, --skill, --prompt-template, --theme, --no-extensions, --no-skills, --no-prompt-templates, --no-themes, --no-context-files, --approve, --no-approve, --no-session",
    status: "implemented",
    laSurface: "Pi One-shot Run card stores AgentRunOptions for the next real scoped Task/CAT stream and then clears them.",
    notes: "The server passes these options to Pi DefaultResourceLoader, SettingsManager, SessionManager, and createAgentSession.",
    tests: ["tests/agent_run_options.test.ts", "tests/pi_usage_parity.test.ts", "apps/desktop/tests/settings.test.ts"],
  },
  {
    id: "mode.text_print",
    category: "io",
    official: "--mode text, --print/-p",
    status: "native_equivalent",
    laSurface: "Native Task/CAT composer streams the turn in-app; noSession can make the next turn ephemeral.",
    notes: "LA keeps transcript and CAT approval surfaces visible instead of dumping only final text to stdout.",
    tests: ["tests/agent_run_options.test.ts", "tests/cat_stream_rules.test.ts"],
  },
  {
    id: "mode.json",
    category: "io",
    official: "--mode json",
    status: "native_equivalent",
    laSurface: "Task/project SSE streams plus canonical Task Run, Activity, and Artifact snapshots expose structured events.",
    notes: "Exact JSONL stdout is a process transport. LA's structured API is the supported app equivalent.",
    tests: ["tests/agent_events.test.ts", "tests/task_workspace_contract.test.ts", "tests/pi_usage_parity.test.ts"],
  },
  {
    id: "mode.rpc",
    category: "io",
    official: "--mode rpc",
    status: "intentionally_unsupported",
    laSurface: "LA exposes its own HTTP/SSE/native API surface over the embedded Pi SDK runtime.",
    notes: "Settings does not spawn raw stdin/stdout Pi RPC because that would create a second process boundary outside LA CAT gates and resident-runtime policy. New RPC data shapes are mirrored through LA-native APIs where useful.",
    tests: ["tests/cat_stream_rules.test.ts", "tests/web_tool_parity.test.ts", "tests/pi_usage_parity.test.ts"],
  },
  {
    id: "rpc.session_entries_tree",
    category: "io",
    official: "RPC get_entries, get_tree",
    status: "native_equivalent",
    laSurface: "Pi Sessions HTTP/native contract exposes /api/pi/sessions/entries and /api/pi/sessions/tree for global-history/project session files.",
    notes: "LA uses Pi SessionManager in-process and keeps raw stdin/stdout RPC unsupported while still exposing the current pinned-Pi session entry and tree read shapes.",
    tests: ["tests/pi_sessions.test.ts", "tests/pi_usage_parity.test.ts", "apps/desktop/tests/settings.test.ts"],
  },
  {
    id: "input.stdin",
    category: "input",
    official: "piped stdin",
    status: "native_equivalent",
    laSurface: "Native Task composer and scoped project stream endpoints carry user messages explicitly.",
    notes: "Exact terminal stdin is a CLI transport, not a persisted configuration field.",
    tests: ["tests/agent_run_options.test.ts", "apps/desktop/tests/settings.test.ts"],
  },
  {
    id: "input.file_args",
    category: "input",
    official: "@file arguments",
    status: "intentionally_unsupported",
    laSurface: "CAT import and Assets workflows own project evidence files; generic composer @file attachment is not a Settings control.",
    notes: "Do not describe CAT import/assets as full generic @file parity. A future composer attachment feature would be outside Pi Settings.",
    tests: ["tests/import_upload.test.ts", "tests/asset_api.test.ts"],
  },
  {
    id: "metadata.list_models",
    category: "metadata",
    official: "--list-models [search]",
    status: "native_equivalent",
    laSurface: "Model catalog, provider auth diagnostics, Custom Models editor, and composer model selector show available models.",
    notes: "The UI exposes richer provider/model state than the tabular CLI output.",
    tests: ["tests/pi_auth_login.test.ts", "tests/custom_models_document.test.ts", "apps/desktop/tests/settings.test.ts"],
  },
  {
    id: "metadata.help_version_offline",
    category: "metadata",
    official: "--help, --version, --verbose, --offline",
    status: "native_equivalent",
    laSurface: "Docs/Settings/Diagnostics expose current version, API contracts, runtime health, and resident/runtime roots.",
    notes: "Offline mode remains an environment/runtime concern; LA does not persist it as a Settings toggle.",
    tests: ["tests/runtime_health.test.ts", "tests/completion_audit.test.ts"],
  },
];

export function readPiUsageParityCatalog(): PiUsageParityCatalog {
  return {
    docs,
    checkedAt: "2026-06-26",
    pinnedSources,
    policy,
    items,
  };
}
