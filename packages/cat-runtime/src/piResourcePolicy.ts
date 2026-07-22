export interface PiPackageResource {
  source: string;
  tools?: string[];
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
}

export interface PiToolConflict {
  toolName: string;
  winner: string;
  shadowed: string[];
}

export type PiBridgeKind = "web" | "browser" | "mcp" | "utility";
export type PiBridgeStatus = "implemented" | "planned" | "blocked";
export type PiBridgeAllowlistState = "active" | "planned" | "blocked";
export type PiBridgeMutationRisk = "read_only" | "external_mutation_possible" | "per_tool_declared";

export interface PiBridgeControlPolicy {
  id: string;
  label: string;
  state: PiBridgeAllowlistState;
  description: string;
}

export interface PiBridgePolicy {
  id: string;
  label: string;
  kind: PiBridgeKind;
  desiredToolName: string;
  status: PiBridgeStatus;
  accessClass: string;
  mutationRisk: PiBridgeMutationRisk;
  purpose: string;
  catEvidencePolicy: string;
  evidenceBehavior: string;
  auditTrail: string;
  settingsSignals: string[];
  nextStep: string;
  blockedReason?: string;
  credentialProviderId?: string;
  configWhenRegistered?: "credential" | "none";
  controls: PiBridgeControlPolicy[];
}

/**
 * Canonical CLI-path Pi package tool surface LA ships, in the same order as the
 * global `~/.pi/agent/settings.json` `packages[]` (Pi resolves tool-name conflicts
 * first-registration-wins, so order is load-bearing): tavily is listed first and
 * therefore owns `web_search`; pi-web-access is second and is shadowed for that name.
 * Both the runtime-health surface and completion-audit consume THIS list so the
 * documented web_search precedence is evaluated against a real, non-empty resource
 * set instead of being self-asserted over an empty array.
 */
export const CAT_PI_PACKAGE_RESOURCES: PiPackageResource[] = [
  { source: "npm:@alexanderfortin/pi-tavily-tools", tools: ["web_search", "web_extract"] },
  { source: "npm:pi-web-access", tools: ["web_search", "fetch_content", "code_search", "get_search_content"] },
];

export const CAT_WEB_SESSION_BRIDGE_POLICIES: PiBridgePolicy[] = [
  {
    id: "web_search",
    label: "Web search",
    kind: "web",
    desiredToolName: "web_search",
    status: "implemented",
    accessClass: "public_web",
    mutationRisk: "read_only",
    purpose: "Find public evidence for terminology, references, and non-CAT development questions.",
    catEvidencePolicy: "CAT use must attach URL, excerpt, timestamp, and query to evidence cards before influencing translation edits.",
    evidenceBehavior: "Returns bounded public URL/query/excerpt/timestamp evidence; advisory only until cited in a CAT proposal or decision.",
    auditTrail: "Pi tool trace plus LA Evidence URL cards.",
    settingsSignals: ["@alexanderfortin/pi-tavily-tools", "pi-web-access"],
    nextStep: "Add a Tavily key in Providers & keys before relying on web_search for live evidence.",
    credentialProviderId: "tavily",
    configWhenRegistered: "credential",
    controls: [
      { id: "project_allowlist", label: "Project allowlist", state: "active", description: "Use the bridge toggle to allow or disable web_search for the active project." },
      { id: "credential", label: "Credential", state: "active", description: "Configure Tavily through Providers & keys or environment variables." },
      { id: "evidence_cards", label: "Evidence cards", state: "active", description: "Returned URLs are classified as web evidence in Trace/Evidence." },
    ],
  },
  {
    id: "web_fetch",
    label: "Web fetch",
    kind: "web",
    desiredToolName: "fetch_content",
    status: "implemented",
    accessClass: "public_web",
    mutationRisk: "read_only",
    purpose: "Fetch a specific URL for source verification, docs, term references, and project context through inherited pi-web-access.",
    catEvidencePolicy: "Fetched content must be quoted as bounded excerpts and cannot bypass lock, tag, terminology, or delivery gates.",
    evidenceBehavior: "Inherited fetch_content output is advisory until the relevant URL/excerpt/timestamp is captured in a CAT proposal or decision.",
    auditTrail: "Pi tool trace plus LA Evidence URL cards.",
    settingsSignals: ["pi-web-access"],
    nextStep: "Keep pi-web-access inherited; do not reintroduce the LA web_fetch shim unless a compatibility surface explicitly asks for it.",
    configWhenRegistered: "none",
    controls: [
      { id: "project_allowlist", label: "Project allowlist", state: "active", description: "Use the bridge toggle to allow or disable web_fetch for the active project." },
      { id: "url_policy", label: "URL policy", state: "planned", description: "Future control for domain allow/deny and cache policy." },
      { id: "evidence_cards", label: "Evidence cards", state: "active", description: "Fetched URLs are classified as web evidence in Trace/Evidence." },
    ],
  },
  {
    id: "weather",
    label: "Weather",
    kind: "utility",
    desiredToolName: "weather",
    status: "planned",
    accessClass: "public_utility",
    mutationRisk: "read_only",
    purpose: "General development utility for local planning or context questions outside CAT writes.",
    catEvidencePolicy: "General utility only by default; CAT use should require an explicit workflow reason and cannot bypass project evidence.",
    evidenceBehavior: "Utility output is not CAT authority unless a future workflow explicitly records why it matters.",
    auditTrail: "Pi tool trace; no CAT write impact without an explicit workflow decision.",
    settingsSignals: [],
    nextStep: "Bridge through a small LA utility tool or an MCP/weather provider when configured.",
    controls: [
      { id: "provider", label: "Provider", state: "planned", description: "No weather provider bridge is registered yet." },
      { id: "project_allowlist", label: "Project allowlist", state: "planned", description: "Will remain disabled until a named weather tool exists." },
    ],
  },
  {
    id: "browser_automation",
    label: "Browser automation",
    kind: "browser",
    desiredToolName: "browser",
    status: "blocked",
    accessClass: "authenticated_browser_session",
    mutationRisk: "external_mutation_possible",
    purpose: "Operate authenticated web apps such as Phrase with readback, checkpoints, and audit trace.",
    catEvidencePolicy: "Browser writes must be workflow-gated with read-before-write and readback verification.",
    evidenceBehavior: "Requires row label/source signature/target editor confirmation plus same-row readback before CAT state can trust a write.",
    auditTrail: "workflow_artifacts.browserAutomationChecks plus Pi trace and Platform Backfill readback rows.",
    settingsSignals: ["browser-tools", "playwright"],
    nextStep: "Enable only after production Chrome/Phrase adapter safeguards exist.",
    blockedReason: "Raw browser control can mutate Phrase or other external systems; LA requires production adapter safeguards before exposing a callable web bridge.",
    controls: [
      { id: "workflow_gate", label: "Workflow gate", state: "blocked", description: "Phrase/browser writes need read-before-write and readback state before enablement." },
      { id: "project_allowlist", label: "Project allowlist", state: "blocked", description: "Not editable until a named browser bridge tool is registered behind safeguards." },
      { id: "audit_trail", label: "Audit trail", state: "blocked", description: "Browser actions must emit trace events and platform readback evidence." },
    ],
  },
  {
    id: "mcp",
    label: "MCP tools",
    kind: "mcp",
    desiredToolName: "mcp_bridge",
    status: "implemented",
    accessClass: "per_tool_declared",
    mutationRisk: "per_tool_declared",
    purpose: "Discover selected external MCP servers and expose only explicitly allowlisted read-only tools without inheriting every global Pi package.",
    catEvidencePolicy: "MCP output is advisory/reference context until cited; it cannot bypass CAT evidence, lock, write, QA, or delivery gates.",
    evidenceBehavior: "Discovered tools are catalog entries only. Allowlisted v2.16 MCP tools are read-only by policy and remain non-authoritative until cited.",
    auditTrail: "MCP tools/list and tools/call trace plus LA bridge metadata; MCP annotations are recorded as hints, not security controls.",
    settingsSignals: ["mcp-builder", "mcp"],
    nextStep: "Configure explicit MCP servers in .pi/mcp-servers.json and allowlist read-only tools only after reviewing access class, evidence behavior, and credentials.",
    controls: [
      { id: "server_catalog", label: "Server catalog", state: "active", description: "Configured MCP servers are discovered through the LA MCP bridge catalog before tools can be selected." },
      { id: "per_tool_allowlist", label: "Per-tool allowlist", state: "active", description: "Each MCP tool needs access class, mutation risk, and evidence behavior before registration." },
      { id: "cat_write_gate", label: "CAT write gate", state: "active", description: "v2.16 MCP tools are catWriteEligible=false and cannot write segment/proposal/delivery state directly." },
      { id: "audit_trail", label: "Audit trail", state: "active", description: "MCP discovery and calls must be visible through bridge metadata and Pi trace before CAT edits can cite them." },
    ],
  },
];

export interface PiResourcePolicyReport {
  browserToolSurface: "isolated-la-cat+server-resources";
  cliToolSurface: "pi-resource-discovery";
  conflicts: PiToolConflict[];
  bridges: PiBridgePolicy[];
  webSearchProvider?: string;
  decisions: string[];
}

export function detectPiToolConflicts(resources: PiPackageResource[]): PiToolConflict[] {
  const owners = new Map<string, string[]>();
  for (const resource of resources) {
    for (const tool of resource.tools ?? []) {
      const list = owners.get(tool) ?? [];
      list.push(resource.source);
      owners.set(tool, list);
    }
  }
  return Array.from(owners.entries())
    .filter(([, sources]) => sources.length > 1)
    .map(([toolName, sources]) => ({
      toolName,
      winner: sources[0],
      shadowed: sources.slice(1),
    }));
}

export function buildPiResourcePolicyReport(resources: PiPackageResource[] = []): PiResourcePolicyReport {
  const conflicts = detectPiToolConflicts(resources);
  const webSearch = conflicts.find((conflict) => conflict.toolName === "web_search");
  return {
    browserToolSurface: "isolated-la-cat+server-resources",
    cliToolSurface: "pi-resource-discovery",
    conflicts,
    bridges: CAT_WEB_SESSION_BRIDGE_POLICIES,
    webSearchProvider: webSearch?.winner,
    decisions: [
      "Product CAT sessions use noExtensions=true and load only LA CAT tools plus server-selected resources for the canonical Run profile.",
      "Built-in read/search tools remain available; generic bash/edit/write and global Package tools stay outside the product CAT surface.",
      "The CAT runtime data/ write guard remains defense in depth, and server-selected or built-in output stays citable:false until promoted by CAT evidence/proposal tools.",
      "Pi CLI resource discovery remains available to explicit development sessions and advanced Settings, but product Sessions do not inherit user-global or project-global resources.",
      "When multiple packages register the same tool name, LA treats load-order precedence as unstable unless the order and filters are documented.",
      "Web research is activated only by the server-selected Run profile; pi-web-access exposes fetch_content rather than the older LA web_fetch tool name.",
      "Bridge tools cannot bypass CAT evidence, lock, write, formatting, QA, or delivery gates; read-only bridge output is advisory until cited in a governed CAT action.",
    ],
  };
}
