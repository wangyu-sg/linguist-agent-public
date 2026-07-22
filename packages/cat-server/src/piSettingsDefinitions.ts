export type PiSettingValueType = "string" | "boolean" | "number" | "object" | "array";

export interface PiSettingObjectFieldDefinition {
  path: string;
  type: PiSettingValueType;
  description: string;
  minimum?: number;
  maximum?: number;
  step?: number;
}

export interface PiSettingDefinition {
  path: string;
  section: string;
  type: PiSettingValueType;
  defaultValue?: unknown;
  options?: string[];
  itemType?: "string";
  objectFields?: PiSettingObjectFieldDefinition[];
  minimum?: number;
  maximum?: number;
  step?: number;
  description: string;
  editable: boolean;
  restartRequired: boolean;
  sensitive?: boolean;
  globalOnly?: boolean;
}

export const OFFICIAL_PI_SETTING_PATHS = [
  "defaultProvider",
  "defaultModel",
  "defaultThinkingLevel",
  "hideThinkingBlock",
  "showCacheMissNotices",
  "thinkingBudgets",
  "theme",
  "externalEditor",
  "quietStartup",
  "defaultProjectTrust",
  "collapseChangelog",
  "enableInstallTelemetry",
  "enableAnalytics",
  "trackingId",
  "doubleEscapeAction",
  "treeFilterMode",
  "editorPaddingX",
  "outputPad",
  "autocompleteMaxVisible",
  "showHardwareCursor",
  "httpProxy",
  "warnings.anthropicExtraUsage",
  "compaction.enabled",
  "compaction.reserveTokens",
  "compaction.keepRecentTokens",
  "branchSummary.reserveTokens",
  "branchSummary.skipPrompt",
  "retry.enabled",
  "retry.maxRetries",
  "retry.baseDelayMs",
  "retry.provider.timeoutMs",
  "retry.provider.maxRetries",
  "retry.provider.maxRetryDelayMs",
  "steeringMode",
  "followUpMode",
  "transport",
  "httpIdleTimeoutMs",
  "websocketConnectTimeoutMs",
  "terminal.showImages",
  "terminal.imageWidthCells",
  "terminal.clearOnShrink",
  "images.autoResize",
  "images.blockImages",
  "shellPath",
  "shellCommandPrefix",
  "npmCommand",
  "sessionDir",
  "enabledModels",
  "markdown.codeBlockIndent",
  "packages",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "enableSkillCommands",
] as const;

export const PI_SETTING_DEFINITIONS: PiSettingDefinition[] = [
  { path: "lastChangelogVersion", section: "Updates", type: "string", description: "Last Pi changelog version shown to the user.", editable: true, restartRequired: true, globalOnly: true },
  { path: "defaultProvider", section: "Model & Thinking", type: "string", description: "Default provider id.", editable: true, restartRequired: false },
  { path: "defaultModel", section: "Model & Thinking", type: "string", description: "Default model id.", editable: true, restartRequired: false },
  { path: "defaultThinkingLevel", section: "Model & Thinking", type: "string", options: ["off", "minimal", "low", "medium", "high", "xhigh", "max"], description: "Default thinking level: off, minimal, low, medium, high, xhigh, max.", editable: true, restartRequired: false },
  { path: "hideThinkingBlock", section: "Model & Thinking", type: "boolean", defaultValue: false, description: "Hide thinking blocks in output.", editable: true, restartRequired: false },
  { path: "showCacheMissNotices", section: "Model & Thinking", type: "boolean", defaultValue: false, description: "Show transcript notices for significant prompt-cache misses.", editable: true, restartRequired: false },
  {
    path: "thinkingBudgets",
    section: "Model & Thinking",
    type: "object",
    objectFields: [
      { path: "minimal", type: "number", minimum: 0, step: 1024, description: "Token budget for minimal thinking." },
      { path: "low", type: "number", minimum: 0, step: 1024, description: "Token budget for low thinking." },
      { path: "medium", type: "number", minimum: 0, step: 1024, description: "Token budget for medium thinking." },
      { path: "high", type: "number", minimum: 0, step: 1024, description: "Token budget for high thinking." },
    ],
    description: "Custom token budgets per thinking level.",
    editable: true,
    restartRequired: false,
  },
  { path: "theme", section: "UI & Display", type: "string", defaultValue: "dark", description: "Pi terminal theme name.", editable: true, restartRequired: true },
  { path: "externalEditor", section: "UI & Display", type: "string", description: "Command for Ctrl+G external editor; takes precedence over VISUAL and EDITOR.", editable: true, restartRequired: true },
  { path: "quietStartup", section: "UI & Display", type: "boolean", defaultValue: false, description: "Hide startup header.", editable: true, restartRequired: true },
  { path: "defaultProjectTrust", section: "UI & Display", type: "string", defaultValue: "ask", options: ["ask", "always", "never"], description: "Fallback project trust behavior: ask, always, or never.", editable: true, restartRequired: true, globalOnly: true },
  { path: "collapseChangelog", section: "UI & Display", type: "boolean", defaultValue: false, description: "Show condensed changelog after updates.", editable: true, restartRequired: true },
  { path: "enableInstallTelemetry", section: "Telemetry", type: "boolean", defaultValue: true, description: "Anonymous install/update version ping. Does not disable update checks.", editable: true, restartRequired: true },
  { path: "enableAnalytics", section: "Telemetry", type: "boolean", defaultValue: false, description: "Opt-in analytics data sharing.", editable: true, restartRequired: true },
  { path: "trackingId", section: "Telemetry", type: "string", description: "Analytics tracking identifier generated when analytics are enabled.", editable: true, restartRequired: true },
  { path: "doubleEscapeAction", section: "UI & Display", type: "string", defaultValue: "tree", options: ["tree", "fork", "none"], description: "Action for double escape: tree, fork, or none.", editable: true, restartRequired: true },
  { path: "treeFilterMode", section: "UI & Display", type: "string", defaultValue: "default", options: ["default", "no-tools", "user-only", "labeled-only", "all"], description: "Default /tree filter mode.", editable: true, restartRequired: true },
  { path: "editorPaddingX", section: "UI & Display", type: "number", defaultValue: 0, minimum: 0, maximum: 3, step: 1, description: "Horizontal input editor padding.", editable: true, restartRequired: true },
  { path: "outputPad", section: "UI & Display", type: "number", defaultValue: 1, minimum: 0, maximum: 1, step: 1, description: "Horizontal padding for user messages, assistant messages, and thinking.", editable: true, restartRequired: true },
  { path: "autocompleteMaxVisible", section: "UI & Display", type: "number", defaultValue: 5, minimum: 3, maximum: 20, step: 1, description: "Max visible autocomplete items.", editable: true, restartRequired: true },
  { path: "showHardwareCursor", section: "UI & Display", type: "boolean", defaultValue: false, description: "Show terminal cursor while TUI positions it for IME support.", editable: true, restartRequired: true },
  { path: "httpProxy", section: "Network", type: "string", description: "HTTP proxy URL applied as HTTP_PROXY and HTTPS_PROXY.", editable: true, restartRequired: true, globalOnly: true },
  { path: "warnings.anthropicExtraUsage", section: "Warnings", type: "boolean", defaultValue: true, description: "Warn when Anthropic subscription auth may use paid extra usage.", editable: true, restartRequired: true },
  { path: "compaction.enabled", section: "Compaction", type: "boolean", defaultValue: true, description: "Enable Pi auto-compaction.", editable: true, restartRequired: false },
  { path: "compaction.reserveTokens", section: "Compaction", type: "number", defaultValue: 16384, description: "Tokens reserved for LLM response.", editable: true, restartRequired: false },
  { path: "compaction.keepRecentTokens", section: "Compaction", type: "number", defaultValue: 20000, description: "Recent tokens to keep unsummarized.", editable: true, restartRequired: false },
  { path: "branchSummary.reserveTokens", section: "Branch Summary", type: "number", defaultValue: 16384, description: "Tokens reserved for branch summarization.", editable: true, restartRequired: false },
  { path: "branchSummary.skipPrompt", section: "Branch Summary", type: "boolean", defaultValue: false, description: "Skip branch summary prompt on /tree navigation.", editable: true, restartRequired: false },
  { path: "retry.enabled", section: "Retry", type: "boolean", defaultValue: true, description: "Enable agent-level retry.", editable: true, restartRequired: false },
  { path: "retry.maxRetries", section: "Retry", type: "number", defaultValue: 3, description: "Maximum agent-level retry attempts.", editable: true, restartRequired: false },
  { path: "retry.baseDelayMs", section: "Retry", type: "number", defaultValue: 2000, description: "Base delay for agent-level exponential backoff.", editable: true, restartRequired: false },
  { path: "retry.provider.timeoutMs", section: "Retry", type: "number", description: "Provider/SDK request timeout in milliseconds.", editable: true, restartRequired: false },
  { path: "retry.provider.maxRetries", section: "Retry", type: "number", defaultValue: 0, description: "Provider/SDK retry attempts.", editable: true, restartRequired: false },
  { path: "retry.provider.maxRetryDelayMs", section: "Retry", type: "number", defaultValue: 60000, description: "Max provider-requested retry delay before failing.", editable: true, restartRequired: false },
  { path: "steeringMode", section: "Message Delivery", type: "string", defaultValue: "one-at-a-time", options: ["all", "one-at-a-time"], description: "How steering messages are sent.", editable: true, restartRequired: false },
  { path: "followUpMode", section: "Message Delivery", type: "string", defaultValue: "one-at-a-time", options: ["all", "one-at-a-time"], description: "How follow-up messages are sent.", editable: true, restartRequired: false },
  { path: "transport", section: "Message Delivery", type: "string", defaultValue: "auto", options: ["sse", "websocket", "websocket-cached", "auto"], description: "Preferred provider transport.", editable: true, restartRequired: false },
  { path: "httpIdleTimeoutMs", section: "Message Delivery", type: "number", defaultValue: 300000, minimum: 0, step: 1000, description: "HTTP idle timeout in milliseconds.", editable: true, restartRequired: false },
  { path: "websocketConnectTimeoutMs", section: "Message Delivery", type: "number", defaultValue: 15000, minimum: 0, step: 1000, description: "WebSocket connect/open handshake timeout.", editable: true, restartRequired: false },
  { path: "terminal.showImages", section: "Terminal & Images", type: "boolean", defaultValue: true, description: "Show images in terminal if supported.", editable: true, restartRequired: true },
  { path: "terminal.imageWidthCells", section: "Terminal & Images", type: "number", defaultValue: 60, minimum: 1, step: 1, description: "Inline image width in terminal cells.", editable: true, restartRequired: true },
  { path: "terminal.clearOnShrink", section: "Terminal & Images", type: "boolean", defaultValue: false, description: "Clear empty rows when content shrinks.", editable: true, restartRequired: true },
  { path: "terminal.showTerminalProgress", section: "Terminal & Images", type: "boolean", description: "Show terminal progress indicators when Pi reports them.", editable: true, restartRequired: true },
  { path: "images.autoResize", section: "Terminal & Images", type: "boolean", defaultValue: true, description: "Resize images before sending to LLM.", editable: true, restartRequired: true },
  { path: "images.blockImages", section: "Terminal & Images", type: "boolean", defaultValue: false, description: "Block images from being sent to LLM.", editable: true, restartRequired: true },
  { path: "shellPath", section: "Shell", type: "string", description: "Custom shell path.", editable: true, restartRequired: true },
  { path: "shellCommandPrefix", section: "Shell", type: "string", description: "Prefix for bash commands.", editable: true, restartRequired: true },
  { path: "npmCommand", section: "Shell", type: "array", itemType: "string", description: "Command argv for npm package operations.", editable: true, restartRequired: true },
  { path: "sessionDir", section: "Sessions", type: "string", description: "Directory where Pi session files are stored.", editable: true, restartRequired: true },
  { path: "enabledModels", section: "Model Cycling", type: "array", itemType: "string", description: "Model patterns for Ctrl+P cycling.", editable: true, restartRequired: true },
  { path: "markdown.codeBlockIndent", section: "Markdown", type: "string", defaultValue: "  ", description: "Indentation for code blocks.", editable: true, restartRequired: true },
  { path: "packages", section: "Resources", type: "array", defaultValue: [], description: "npm/git packages to load Pi resources from.", editable: true, restartRequired: true },
  { path: "extensions", section: "Resources", type: "array", itemType: "string", defaultValue: [], description: "Local extension paths or directories.", editable: true, restartRequired: true },
  { path: "skills", section: "Resources", type: "array", itemType: "string", defaultValue: [], description: "Local skill paths or directories.", editable: true, restartRequired: true },
  { path: "prompts", section: "Resources", type: "array", itemType: "string", defaultValue: [], description: "Local prompt paths or directories.", editable: true, restartRequired: true },
  { path: "themes", section: "Resources", type: "array", itemType: "string", defaultValue: [], description: "Local theme paths or directories.", editable: true, restartRequired: true },
  { path: "enableSkillCommands", section: "Resources", type: "boolean", defaultValue: true, description: "Register skills as /skill:name commands.", editable: true, restartRequired: true },
];

function getPathValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined), obj);
}

export function findProjectRawGlobalOnlySettings(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return PI_SETTING_DEFINITIONS
    .filter((definition) => definition.globalOnly && getPathValue(value, definition.path) !== undefined)
    .map((definition) => definition.path);
}

export function validatePiSettingDefinitionValue(def: PiSettingDefinition, value: unknown): void {
  if (value === undefined) return;
  if (def.type === "array" && !Array.isArray(value)) throw new Error(`${def.path} must be an array.`);
  if (def.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error(`${def.path} must be an object.`);
  if (def.type !== "array" && def.type !== "object" && typeof value !== def.type) throw new Error(`${def.path} must be ${def.type}.`);
  if (def.type === "array" && def.itemType === "string" && Array.isArray(value) && value.some((item) => typeof item !== "string")) {
    throw new Error(`${def.path} must contain only strings.`);
  }
  if (def.type === "object" && def.objectFields && value && typeof value === "object" && !Array.isArray(value)) {
    for (const field of def.objectFields) {
      const fieldValue = (value as Record<string, unknown>)[field.path];
      if (fieldValue === undefined) continue;
      validatePiSettingDefinitionValue({ ...field, path: `${def.path}.${field.path}`, section: def.section, editable: true, restartRequired: def.restartRequired }, fieldValue);
    }
  }
  if (def.options && typeof value === "string" && !def.options.includes(value)) {
    throw new Error(`${def.path} must be one of: ${def.options.join(", ")}.`);
  }
  if (def.type === "number" && typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${def.path} must be a finite number.`);
    if (def.minimum !== undefined && value < def.minimum) throw new Error(`${def.path} must be >= ${def.minimum}.`);
    if (def.maximum !== undefined && value > def.maximum) throw new Error(`${def.path} must be <= ${def.maximum}.`);
  }
}
