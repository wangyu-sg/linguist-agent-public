import { spawn } from "node:child_process";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SessionManager,
  type SessionEntry,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";

export type PiSessionSurface = "global" | "project";
export type PiSessionBranchOperation = "tree" | "fork" | "clone";
export type PiSessionExportFormat = "html" | "jsonl";

export interface PiSessionScope {
  surface: PiSessionSurface;
  projectId?: string;
  cwd: string;
  sessionDir: string;
  activeSessionId: string;
  pendingBranchEntryId?: string;
}

export interface PiSessionEntrySummary {
  id: string;
  type: string;
  parentId: string | null;
  timestamp: string;
  role?: string;
  text?: string;
  label?: string;
  depth: number;
  childCount: number;
}

interface PiSessionTreeNodeLike {
  entry: SessionEntry;
  children: PiSessionTreeNodeLike[];
  label?: string;
}

export interface PiSessionTree {
  sessionId: string;
  path: string;
  cwd: string;
  version?: number;
  parentSessionPath?: string;
  leafId: string | null;
  entryCount: number;
  branchCount: number;
  labelCount: number;
  entries: PiSessionEntrySummary[];
}

export interface PiSessionEntries {
  sessionId: string;
  path: string;
  cwd: string;
  leafId: string | null;
  entryCount: number;
  entries: SessionEntry[];
}

export interface PiSessionSummary {
  id: string;
  path: string;
  cwd: string;
  displayName: string;
  name?: string;
  firstMessage: string;
  parentSessionPath?: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount: number;
  active: boolean;
  hasFile: boolean;
  tree?: Omit<PiSessionTree, "entries">;
}

export interface PiSessionsCatalog {
  docs: string;
  formatDocs: string;
  surface: PiSessionSurface;
  projectId?: string;
  cwd: string;
  sessionDir: string;
  activeSessionId: string;
  pendingBranchEntryId?: string;
  relation: string;
  commands: {
    storage: string;
    resume: string;
    name: string;
    tree: string;
    fork: string;
    clone: string;
    export: string;
    share: string;
    delete: string;
  };
  sessions: PiSessionSummary[];
}

export interface PiSessionMutationResult {
  catalog: PiSessionsCatalog;
  session?: PiSessionSummary;
  tree?: PiSessionTree;
  selectedSessionId?: string;
  pendingBranchEntryId?: string;
  createdSessionId?: string;
  createdPath?: string;
  deletedPath?: string;
}

export interface PiSessionArtifactResult {
  docs: string;
  surface: PiSessionSurface;
  projectId?: string;
  sessionId: string;
  sessionPath: string;
  format: PiSessionExportFormat;
  outputPath?: string;
  command: "/export" | "/share";
  gistUrl?: string;
  shareUrl?: string;
  message: string;
}

export interface PiSessionShareEnvironment {
  tmpDir?: string;
  runGh?: (args: string[]) => Promise<{ stdout: string; stderr: string; code: number | null }>;
}

const SESSIONS_DOCS = "https://pi.dev/docs/latest/sessions";
const SESSION_FORMAT_DOCS = "https://pi.dev/docs/latest/session-format";
const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

function dateToIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
}

function previewText(value: unknown): string | undefined {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const item = block as { type?: unknown; text?: unknown };
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 160) : undefined;
}

function entryRole(entry: SessionEntry): string | undefined {
  if (entry.type !== "message") return undefined;
  const message = (entry as { message?: { role?: unknown } }).message;
  return typeof message?.role === "string" ? message.role : undefined;
}

function entryText(entry: SessionEntry): string | undefined {
  if (entry.type === "message") {
    return previewText((entry as { message?: { content?: unknown } }).message?.content);
  }
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return previewText((entry as { summary?: unknown }).summary);
  }
  if (entry.type === "custom_message") {
    return previewText((entry as { content?: unknown }).content);
  }
  if (entry.type === "session_info") {
    return previewText((entry as { name?: unknown }).name);
  }
  if (entry.type === "model_change") {
    const model = entry as { provider?: unknown; modelId?: unknown };
    return typeof model.provider === "string" && typeof model.modelId === "string"
      ? `${model.provider}/${model.modelId}`
      : undefined;
  }
  if (entry.type === "thinking_level_change") {
    const thinking = (entry as { thinkingLevel?: unknown }).thinkingLevel;
    return typeof thinking === "string" ? thinking : undefined;
  }
  return undefined;
}

function flattenTree(nodes: PiSessionTreeNodeLike[], depth = 0): PiSessionEntrySummary[] {
  return nodes.flatMap((node) => [
    {
      id: node.entry.id,
      type: node.entry.type,
      parentId: node.entry.parentId,
      timestamp: node.entry.timestamp,
      role: entryRole(node.entry),
      text: entryText(node.entry),
      label: node.label,
      depth,
      childCount: node.children.length,
    },
    ...flattenTree(node.children, depth + 1),
  ]);
}

function branchCount(entries: SessionEntry[]): number {
  const childrenByParent = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.parentId) continue;
    childrenByParent.set(entry.parentId, (childrenByParent.get(entry.parentId) ?? 0) + 1);
  }
  return [...childrenByParent.values()].filter((count) => count > 1).length;
}

function relationFor(scope: PiSessionScope): string {
  return scope.surface === "global"
    ? "Historical global Pi sessions are preserved for inspection and export; product work runs in scoped Tasks."
    : "Project CAT sessions use the LA project-local Pi session directory and selected project session id.";
}

function displayName(session: SessionInfo): string {
  const named = session.name?.trim();
  if (named) return named;
  const first = session.firstMessage?.replace(/\s+/g, " ").trim();
  if (first) return first.length > 72 ? `${first.slice(0, 71)}...` : first;
  return session.id;
}

function assertInsideSessionDir(sessionDir: string, path: string): void {
  const rel = relative(resolve(sessionDir), resolve(path));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Session path is outside sessionDir: ${path}`);
  }
}

export function buildPiSessionTree(params: {
  sessionPath: string;
  sessionDir: string;
  cwd: string;
}): PiSessionTree {
  assertInsideSessionDir(params.sessionDir, params.sessionPath);
  const manager = SessionManager.open(params.sessionPath, params.sessionDir, params.cwd);
  return buildPiSessionTreeFromManager(manager, params.sessionPath);
}

function buildPiSessionTreeFromManager(manager: SessionManager, sessionPath?: string): PiSessionTree {
  const header = manager.getHeader();
  const entries = manager.getEntries();
  const tree = manager.getTree();
  const flat = flattenTree(tree);
  return {
    sessionId: manager.getSessionId(),
    path: manager.getSessionFile() ?? sessionPath ?? "",
    cwd: manager.getCwd(),
    version: header?.version,
    parentSessionPath: header?.parentSession,
    leafId: manager.getLeafId(),
    entryCount: entries.length,
    branchCount: branchCount(entries),
    labelCount: flat.filter((entry) => entry.label).length,
    entries: flat,
  };
}

function treeSummary(tree: PiSessionTree): Omit<PiSessionTree, "entries"> {
  const { entries: _entries, ...summary } = tree;
  return summary;
}

async function writeSessionSnapshot(manager: SessionManager, path: string): Promise<void> {
  const header = manager.getHeader();
  if (!header) throw new Error("Pi session has no header");
  await mkdir(dirname(path), { recursive: true });
  const lines = [header, ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(path, `${lines}\n`, "utf8");
}

async function sessionSummaries(scope: PiSessionScope): Promise<PiSessionSummary[]> {
  await mkdir(scope.sessionDir, { recursive: true });
  const sessions = await SessionManager.list(scope.cwd, scope.sessionDir);
  return sessions.map((session) => {
    const tree = buildPiSessionTree({
      sessionPath: session.path,
      sessionDir: scope.sessionDir,
      cwd: scope.cwd,
    });
    return {
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      displayName: displayName(session),
      name: session.name,
      firstMessage: session.firstMessage,
      parentSessionPath: session.parentSessionPath,
      createdAt: dateToIso(session.created),
      updatedAt: dateToIso(session.modified),
      messageCount: session.messageCount,
      active: session.id === scope.activeSessionId,
      hasFile: true,
      tree: treeSummary(tree),
    };
  });
}

export async function buildPiSessionsCatalog(scope: PiSessionScope): Promise<PiSessionsCatalog> {
  const sessions = await sessionSummaries(scope);
  if (!sessions.some((session) => session.id === scope.activeSessionId)) {
    sessions.push({
      id: scope.activeSessionId,
      path: "",
      cwd: scope.cwd,
      displayName: scope.surface === "global" && scope.activeSessionId === "la-assistant-global" ? "Historical global session" : "new session",
      firstMessage: "",
      messageCount: 0,
      active: true,
      hasFile: false,
    });
  }
  sessions.sort((a, b) => {
    if (a.active && !b.active) return -1;
    if (b.active && !a.active) return 1;
    return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
  });
  return {
    docs: SESSIONS_DOCS,
    formatDocs: SESSION_FORMAT_DOCS,
    surface: scope.surface,
    projectId: scope.projectId,
    cwd: scope.cwd,
    sessionDir: scope.sessionDir,
    activeSessionId: scope.activeSessionId,
    pendingBranchEntryId: scope.pendingBranchEntryId,
    relation: relationFor(scope),
    commands: {
      storage: "Pi stores sessions as JSONL trees under a session directory.",
      resume: "Select a session id to make LA continue that Pi session.",
      name: "Append a session_info entry, matching /name behavior.",
      tree: "Set a pending branch entry id so the next turn continues from that tree point.",
      fork: "Create a new session file from a selected tree entry.",
      clone: "Create a new session file from the current active branch.",
      export: "Export a selected session to HTML or JSONL, matching /export.",
      share: "Export HTML, upload it as a private GitHub gist with gh, and return the Pi viewer URL.",
      delete: "Delete the selected JSONL file after confirmation.",
    },
    sessions,
  };
}

async function findSession(scope: PiSessionScope, sessionId: string): Promise<SessionInfo> {
  const sessions = await SessionManager.list(scope.cwd, scope.sessionDir);
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session) throw new Error(`Pi session not found: ${sessionId}`);
  assertInsideSessionDir(scope.sessionDir, session.path);
  return session;
}

function exportFormat(input: { format?: unknown; outputPath?: unknown }): PiSessionExportFormat {
  if (input.format === "jsonl") return "jsonl";
  if (typeof input.outputPath === "string" && input.outputPath.toLowerCase().endsWith(".jsonl")) return "jsonl";
  return "html";
}

function defaultExportPath(scope: PiSessionScope, sessionId: string, format: PiSessionExportFormat): string {
  const extension = format === "jsonl" ? "jsonl" : "html";
  return resolve(scope.cwd, `pi-session-${sessionId}.${extension}`);
}

function resolveExportPath(scope: PiSessionScope, sessionId: string, format: PiSessionExportFormat, outputPath?: string): string {
  const cleanOutputPath = outputPath?.trim();
  if (!cleanOutputPath) return defaultExportPath(scope, sessionId, format);
  return isAbsolute(cleanOutputPath) ? cleanOutputPath : resolve(scope.cwd, cleanOutputPath);
}

async function loadPiExportFromFile(): Promise<(inputPath: string, options?: { outputPath?: string }) => Promise<string>> {
  const indexUrl = await import.meta.resolve("@earendil-works/pi-coding-agent");
  const packageRoot = dirname(dirname(fileURLToPath(indexUrl)));
  const moduleUrl = pathToFileURL(join(packageRoot, "dist/core/export-html/index.js")).href;
  const module = await import(moduleUrl) as {
    exportFromFile: (inputPath: string, options?: { outputPath?: string }) => Promise<string>;
  };
  return module.exportFromFile;
}

function shareViewerUrl(gistId: string): string {
  const baseUrl = process.env.PI_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
  return `${baseUrl}#${gistId}`;
}

function parseGistUrl(stdout: string): { gistUrl: string; gistId: string } {
  const gistUrl = stdout.match(/https:\/\/gist\.github\.com\/\S+/)?.[0]?.trim();
  if (!gistUrl) throw new Error("Failed to parse gist URL from gh output.");
  const gistId = new URL(gistUrl).pathname.split("/").filter(Boolean).pop();
  if (!gistId) throw new Error("Failed to parse gist ID from gh output.");
  return { gistUrl, gistId };
}

function runGh(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("gh", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => resolvePromise({ stdout, stderr, code }));
  });
}

export async function exportPiSession(scope: PiSessionScope, input: {
  sessionId: string;
  format?: PiSessionExportFormat;
  outputPath?: string;
}): Promise<PiSessionArtifactResult> {
  const session = await findSession(scope, input.sessionId);
  const format = exportFormat(input);
  const outputPath = resolveExportPath(scope, session.id, format, input.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  if (format === "jsonl") {
    await copyFile(session.path, outputPath);
  } else {
    const exportFromFile = await loadPiExportFromFile();
    await exportFromFile(session.path, { outputPath });
  }
  return {
    docs: SESSIONS_DOCS,
    surface: scope.surface,
    projectId: scope.projectId,
    sessionId: session.id,
    sessionPath: session.path,
    format,
    outputPath,
    command: "/export",
    message: `Exported Pi session ${session.id} to ${outputPath}.`,
  };
}

export async function sharePiSession(scope: PiSessionScope, input: {
  sessionId: string;
}, env: PiSessionShareEnvironment = {}): Promise<PiSessionArtifactResult> {
  const run = env.runGh ?? runGh;
  const auth = await run(["auth", "status"]);
  if (auth.code !== 0) {
    throw new Error(auth.stderr.trim() || "GitHub CLI is not logged in. Run gh auth login first.");
  }
  const session = await findSession(scope, input.sessionId);
  const tmpPath = join(env.tmpDir ?? tmpdir(), `la-pi-session-${session.id}-${Date.now().toString(36)}.html`);
  try {
    await exportPiSession(scope, { sessionId: session.id, format: "html", outputPath: tmpPath });
    const gist = await run(["gist", "create", "--public=false", tmpPath]);
    if (gist.code !== 0) {
      throw new Error(gist.stderr.trim() || "Failed to create private GitHub gist.");
    }
    const { gistUrl, gistId } = parseGistUrl(gist.stdout);
    const shareUrl = shareViewerUrl(gistId);
    return {
      docs: SESSIONS_DOCS,
      surface: scope.surface,
      projectId: scope.projectId,
      sessionId: session.id,
      sessionPath: session.path,
      format: "html",
      command: "/share",
      gistUrl,
      shareUrl,
      message: `Shared Pi session ${session.id}: ${shareUrl}`,
    };
  } finally {
    await rm(tmpPath, { force: true });
  }
}

export async function readPiSessionTree(scope: PiSessionScope, sessionId: string): Promise<PiSessionTree> {
  const session = await findSession(scope, sessionId);
  return buildPiSessionTree({ sessionPath: session.path, sessionDir: scope.sessionDir, cwd: scope.cwd });
}

export async function readPiSessionEntries(scope: PiSessionScope, sessionId: string, since?: string): Promise<PiSessionEntries> {
  const session = await findSession(scope, sessionId);
  const manager = SessionManager.open(session.path, scope.sessionDir, scope.cwd);
  let entries = manager.getEntries();
  if (since !== undefined) {
    const sinceIndex = entries.findIndex((entry) => entry.id === since);
    if (sinceIndex === -1) throw new Error(`Pi session entry not found: ${since}`);
    entries = entries.slice(sinceIndex + 1);
  }
  return {
    sessionId: manager.getSessionId(),
    path: manager.getSessionFile() ?? session.path,
    cwd: manager.getCwd(),
    leafId: manager.getLeafId(),
    entryCount: entries.length,
    entries,
  };
}

export async function renamePiSession(scope: PiSessionScope, sessionId: string, name: string): Promise<PiSessionMutationResult> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Pi session name is required");
  const session = await findSession(scope, sessionId);
  const manager = SessionManager.open(session.path, scope.sessionDir, scope.cwd);
  manager.appendSessionInfo(cleanName);
  return {
    catalog: await buildPiSessionsCatalog(scope),
    session: (await sessionSummaries(scope)).find((candidate) => candidate.id === sessionId),
  };
}

export async function deletePiSession(scope: PiSessionScope, sessionId: string): Promise<PiSessionMutationResult> {
  const session = await findSession(scope, sessionId);
  await rm(session.path, { force: true });
  return {
    catalog: await buildPiSessionsCatalog(scope),
    deletedPath: session.path,
  };
}

export async function clonePiSessionBranch(scope: PiSessionScope, params: {
  sessionId: string;
  operation: Exclude<PiSessionBranchOperation, "tree">;
  entryId?: string;
  name?: string;
}): Promise<PiSessionMutationResult> {
  const session = await findSession(scope, params.sessionId);
  const manager = SessionManager.open(session.path, scope.sessionDir, scope.cwd);
  const leafId = params.operation === "clone" ? manager.getLeafId() : params.entryId;
  if (!leafId) throw new Error(params.operation === "clone" ? "Pi session has no active leaf to clone" : "Pi fork entry id is required");
  if (!manager.getEntry(leafId)) throw new Error(`Pi session entry not found: ${leafId}`);
  const createdPath = manager.createBranchedSession(leafId);
  if (!createdPath) throw new Error("Pi session is not persisted");
  const createdSessionId = manager.getSessionId();
  if (params.name?.trim()) {
    manager.appendSessionInfo(params.name.trim());
  }
  await writeSessionSnapshot(manager, createdPath);
  const catalog = await buildPiSessionsCatalog({ ...scope, activeSessionId: createdSessionId });
  return {
    catalog,
    tree: buildPiSessionTreeFromManager(manager, createdPath),
    selectedSessionId: createdSessionId,
    createdSessionId,
    createdPath,
  };
}

export async function validatePiSessionBranchTarget(scope: PiSessionScope, sessionId: string, entryId: string): Promise<PiSessionMutationResult> {
  const cleanEntryId = entryId.trim();
  if (!cleanEntryId) throw new Error("Pi session entry id is required");
  const session = await findSession(scope, sessionId);
  const manager = SessionManager.open(session.path, scope.sessionDir, scope.cwd);
  const entry = manager.getEntry(cleanEntryId);
  if (!entry) throw new Error(`Pi session entry not found: ${cleanEntryId}`);
  return {
    catalog: await buildPiSessionsCatalog({ ...scope, pendingBranchEntryId: cleanEntryId }),
    tree: buildPiSessionTree({ sessionPath: session.path, sessionDir: scope.sessionDir, cwd: scope.cwd }),
    pendingBranchEntryId: cleanEntryId,
  };
}

export function describePiSessionFile(path: string): string {
  return basename(path);
}
