import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type PiTrustDecision = boolean | null;
export type PiDefaultProjectTrust = "ask" | "always" | "never";

export interface PiTrustStatus {
  trustPath: string;
  currentPath: string;
  parentPath?: string;
  hasTrustResources: boolean;
  defaultProjectTrust: PiDefaultProjectTrust;
  entry: { path: string; decision: boolean } | null;
  effectiveDecision: "trusted" | "untrusted" | "unset";
  decisions: Record<string, boolean | null>;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function trustPath(agentDir = join(homedir(), ".pi", "agent")): string {
  return join(agentDir, "trust.json");
}

async function readTrustFile(path: string): Promise<Record<string, boolean | null>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected object");
    const out: Record<string, boolean | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== true && value !== false && value !== null) throw new Error(`invalid value for ${key}`);
      out[key] = value;
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeTrustFile(path: string, decisions: Record<string, boolean | null>): Promise<void> {
  const sorted: Record<string, boolean | null> = {};
  for (const key of Object.keys(decisions).sort()) sorted[key] = decisions[key] ?? null;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
}

function nearestTrustEntry(decisions: Record<string, boolean | null>, cwd: string): { path: string; decision: boolean } | null {
  let current = canonicalPath(cwd);
  while (true) {
    const decision = decisions[current];
    if (decision === true || decision === false) return { path: current, decision };
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function hasTrustRequiringProjectResources(cwd: string, homeDir = homedir()): boolean {
  const current = canonicalPath(cwd);
  const piDir = join(current, ".pi");
  for (const entry of ["settings.json", "extensions", "skills", "prompts", "themes", "SYSTEM.md", "APPEND_SYSTEM.md"]) {
    if (existsSync(join(piDir, entry))) return true;
  }
  const userAgentsSkills = join(canonicalPath(homeDir), ".agents", "skills");
  let dir = current;
  while (true) {
    const agentsSkills = join(dir, ".agents", "skills");
    if (agentsSkills !== userAgentsSkills && existsSync(agentsSkills)) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** General Chat treats instruction context as directory-scoped input too. */
export function hasGeneralContextResources(cwd: string): boolean {
  let dir = canonicalPath(cwd);
  while (true) {
    if (["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"].some((name) => existsSync(join(dir, name)))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export async function readPiTrustStatus(input: {
  cwd: string;
  agentDir?: string;
  defaultProjectTrust?: PiDefaultProjectTrust;
  homeDir?: string;
}): Promise<PiTrustStatus> {
  const currentPath = canonicalPath(input.cwd);
  const parent = dirname(currentPath);
  const path = trustPath(input.agentDir);
  const decisions = await readTrustFile(path);
  const entry = nearestTrustEntry(decisions, currentPath);
  return {
    trustPath: path,
    currentPath,
    parentPath: parent === currentPath ? undefined : parent,
    hasTrustResources: hasTrustRequiringProjectResources(currentPath, input.homeDir),
    defaultProjectTrust: input.defaultProjectTrust ?? "ask",
    entry,
    effectiveDecision: entry ? (entry.decision ? "trusted" : "untrusted") : "unset",
    decisions,
  };
}

export async function writePiTrustDecision(input: {
  cwd: string;
  target: "current" | "parent";
  decision: PiTrustDecision;
  agentDir?: string;
  defaultProjectTrust?: PiDefaultProjectTrust;
  homeDir?: string;
}): Promise<PiTrustStatus> {
  const currentPath = canonicalPath(input.cwd);
  const parentPath = dirname(currentPath);
  const path = trustPath(input.agentDir);
  const decisions = await readTrustFile(path);
  const targetPath = input.target === "parent" ? parentPath : currentPath;
  if (input.decision === null) delete decisions[targetPath];
  else decisions[targetPath] = input.decision;
  if (input.target === "parent") delete decisions[currentPath];
  await writeTrustFile(path, decisions);
  return readPiTrustStatus(input);
}
