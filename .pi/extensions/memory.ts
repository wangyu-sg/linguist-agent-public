/**
 * Linguist Agent — TencentDB-Agent-Memory extension (CLI path)
 *
 * Registers the legacy project memory_search adapter only when a project has
 * explicitly enabled it. Long-term writes use LA's proposed -> user-confirmed
 * memory lifecycle; raw turns are never captured automatically. Reads per-project toggle from
 * data/projects/<id>/cat-agent-memory.json via the LA data layer.
 *
 * This extension fires when `pi` is run directly (not via cat-server).
 * cat-server wires memory via createCatAgentSession({ memoryConfig }).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createMemorySearchTool,
  gatewayHealthy,
} from "@linguist-agent/cat-tools";
import { createWorkspace } from "@linguist-agent/cat-data";

// ── Config resolution ─────────────────────────────────────────────────────────

interface MemoryCfg {
  enabled: boolean;
  gatewayUrl: string;
}

interface ResolvedMemoryCfg {
  config: MemoryCfg;
  projectId: string;
  repoRoot: string;
}

const DEFAULT_GATEWAY = "http://127.0.0.1:8420";
const DEFAULT_CFG: MemoryCfg = { enabled: false, gatewayUrl: DEFAULT_GATEWAY };

async function resolveProjectId(cwd: string): Promise<string | undefined> {
  // Look for a cat-agent-memory.json in ancestor data/projects/*/
  // Simpler: check AGENTS.md for projectId field, or derive from dir name
  try {
    const agentsPath = join(cwd, "AGENTS.md");
    const raw = await readFile(agentsPath, "utf8");
    const m = raw.match(/projectId:\s*(\S+)/);
    if (m) return m[1];
  } catch { /* no AGENTS.md */ }
  // Fall back to the name of the projects/<id> parent dir (two levels up from cwd)
  return undefined;
}

async function readMemoryCfg(cwd: string): Promise<ResolvedMemoryCfg | null> {
  // Check if cwd is inside data/projects/<id>
  const m = cwd.match(/data[/\\]projects[/\\]([^/\\]+)/);
  const projectId = m?.[1] ?? await resolveProjectId(cwd);
  if (!projectId) return null;

  // Walk up to repo root (find package.json)
  let root = resolve(cwd);
  for (let i = 0; i < 6; i++) {
    try {
      await readFile(join(root, "package.json"), "utf8");
      break;
    } catch { root = join(root, ".."); }
  }
  try {
    const cfgPath = join(root, "data", "projects", projectId, "cat-agent-memory.json");
    const raw = await readFile(cfgPath, "utf8");
    return { config: { ...DEFAULT_CFG, ...(JSON.parse(raw) as Partial<MemoryCfg>) }, projectId, repoRoot: root };
  } catch { return { config: DEFAULT_CFG, projectId, repoRoot: root }; }
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  const cwd = process.cwd();
  const resolved = await readMemoryCfg(cwd);

  if (!resolved || !resolved.config.enabled) return; // memory disabled for this project

  const cfg = resolved.config;
  const alive = await gatewayHealthy(cfg.gatewayUrl);
  if (!alive) {
    console.warn(`[memory] TDAI Gateway not reachable at ${cfg.gatewayUrl} — memory tools skipped. Run: npm run tdai:start`);
    return;
  }

  const projectId = resolved.projectId;
  const auditWorkspace = createWorkspace(resolved.repoRoot, projectId);

  pi.registerTool(createMemorySearchTool(cfg, projectId, auditWorkspace));
}
