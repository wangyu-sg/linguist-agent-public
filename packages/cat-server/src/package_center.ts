import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as tar from "tar";

const execFileAsync = promisify(execFile);
const CATALOG_TTL_MS = 24 * 60 * 60 * 1_000;
const QUARANTINE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 500 * 1024 * 1024;
const MAX_FILES = 30_000;
const REGISTRY = "https://registry.npmjs.org";
const PI_PACKAGE_DOCS = "https://pi.dev/docs/latest/packages";

export const LA_CORE_PACKAGES = [
  { name: "pi-docparser", version: "3.0.1", reason: "Document parsing" },
  { name: "@eko24ive/pi-ask", version: "1.1.0", reason: "Structured user decisions" },
  { name: "pi-web-access", version: "0.13.0", reason: "Audited headless web research" },
  { name: "pi-subagents", version: "0.35.1", reason: "Canonical delegation bridge" },
] as const;

export class PackageCenterError extends Error {
  constructor(
    public readonly status: 400 | 409 | 410 | 422 | 503,
    public readonly code:
      | "invalid_request"
      | "catalog_unavailable"
      | "package_changed"
      | "preview_expired"
      | "approval_required"
      | "package_exists"
      | "unsafe_archive"
      | "unsafe_installer_retired",
    message: string,
  ) {
    super(message);
    this.name = "PackageCenterError";
  }
}

export interface CommunityPackageCatalogItem {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  license: string | null;
  publisher: string | null;
  publishedAt: string | null;
  weeklyDownloads: number | null;
  monthlyDownloads?: number | null;
  npmUrl: string;
  piGalleryUrl: string;
  repositoryUrl: string | null;
}

export interface CommunityPackageCatalogSnapshot {
  schemaVersion: 1;
  source: string;
  docs: string;
  fetchedAt: string;
  total: number;
  cursor: number;
  sourceCursor?: number;
  complete?: boolean;
  items: CommunityPackageCatalogItem[];
  stale: boolean;
  offline: boolean;
  refreshError?: string;
}

export interface PackageRiskFlag {
  id: "extension_code" | "skill_instructions" | "lifecycle_scripts" | "file_access" | "network_access" | "process_execution" | "secret_access" | "custom_ui" | "possible_exfiltration" | "unknown_license";
  severity: "info" | "medium" | "high" | "critical";
  detected: boolean;
  evidence: string[];
}

export interface PackageDependencyRecord {
  path: string;
  name: string;
  version: string | null;
  integrity: string | null;
  license: string | null;
}

export interface CapabilityDescriptorV1 {
  schemaVersion: 1;
  package: {
    name: string;
    version: string;
    source: string;
    integrity: string;
    tarball: string;
    license: string | null;
    repository: string | null;
  };
  tier: "core" | "labs";
  trust: "quarantined" | "approved";
  resources: {
    extensions: string[];
    skills: string[];
    prompts: string[];
    themes: string[];
  };
  dependencyClosure: PackageDependencyRecord[];
  lifecycleScripts: Array<{ packagePath: string; script: string; command: string }>;
  risks: PackageRiskFlag[];
  compatibility: {
    node: string | null;
    piPeers: Record<string, string>;
    runtime: "compatible" | "review_required";
    notes: string[];
  };
  audit: {
    treeHash: string;
    archiveBytes: number;
    extractedBytes: number;
    fileCount: number;
    scannedTextFiles: number;
    createdAt: string;
  };
}

export interface PackageInstallPreview {
  mode: "preview";
  planHash: string;
  descriptor: CapabilityDescriptorV1;
  requiredRiskIds: string[];
  expiresAt: string;
  docs: string;
}

export interface ManagedPackageRecord {
  packageName: string;
  version: string;
  installedAt: string;
  installPath: string;
  planHash: string;
  acceptedRiskIds: string[];
  descriptor: CapabilityDescriptorV1;
}

interface NpmVersionMetadata {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  license?: unknown;
  repository?: unknown;
  dist?: { tarball?: unknown; integrity?: unknown; shasum?: unknown };
  pi?: unknown;
  dependencies?: unknown;
  peerDependencies?: unknown;
  bundledDependencies?: unknown;
  bundleDependencies?: unknown;
  scripts?: unknown;
  engines?: unknown;
}

interface PreviewRecord extends PackageInstallPreview {
  packageName: string;
  version: string;
  quarantinePath: string;
}

interface PackageCenterFetchOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
}

function centerRoot(runtimeRoot: string): string {
  return join(runtimeRoot, "data", "assistant", "capabilities", "packages");
}

function catalogPath(runtimeRoot: string): string {
  return join(centerRoot(runtimeRoot), "catalog-v1.json");
}

function registryPath(runtimeRoot: string): string {
  return join(centerRoot(runtimeRoot), "installed-v1.json");
}

function quarantineRoot(runtimeRoot: string): string {
  return join(centerRoot(runtimeRoot), ".quarantine");
}

function installedRoot(runtimeRoot: string): string {
  return join(centerRoot(runtimeRoot), "installed");
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readJson<T>(path: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (fallback !== undefined && (error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.map(string).filter((entry): entry is string => Boolean(entry));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function repositoryUrl(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return string(record(value).url) ?? null;
}

function exactPackageName(value: unknown): string {
  const name = string(value);
  if (!name || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new PackageCenterError(400, "invalid_request", "A valid npm package name is required.");
  }
  return name;
}

function exactVersion(value: unknown): string {
  const version = string(value);
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new PackageCenterError(400, "invalid_request", "An exact npm package version is required; tags and ranges are not accepted.");
  }
  return version;
}

function safePackageDirectory(name: string): string {
  const slug = name.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "__").slice(0, 96) || "package";
  return `${slug}-${sha256(name).slice(0, 10)}`;
}

function isFresh(snapshot: CommunityPackageCatalogSnapshot, now: Date): boolean {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAt) && now.getTime() - fetchedAt < CATALOG_TTL_MS;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15_000, Math.max(500, seconds * 1_000));
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(15_000, Math.max(500, at - Date.now()));
  }
  return Math.min(15_000, 750 * (2 ** attempt));
}

async function fetchCatalogPage(fetchImpl: typeof fetch, url: string, accept = "application/json"): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetchImpl(url, { headers: { accept, "user-agent": "Linguist-Agent-Package-Center/1" } });
    if (response.ok) return response;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 5) {
      throw new Error(`package catalog returned HTTP ${response.status}`);
    }
    await wait(retryDelay(response, attempt));
  }
  throw new Error("package catalog retry loop ended unexpectedly");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function plainHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function htmlAttribute(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1] === undefined ? undefined : decodeHtml(match[1]);
}

function parseGalleryPage(html: string): { items: CommunityPackageCatalogItem[]; total: number } {
  const count = html.match(/packages-count[^>]*>[^<]*\/\s*([\d,]+)/i);
  const total = Number((count?.[1] ?? "0").replace(/,/g, "")) || 0;
  const items: CommunityPackageCatalogItem[] = [];
  const cards = html.match(/<article\b[^>]*data-package-card="true"[\s\S]*?<\/article>/gi) ?? [];
  for (const card of cards) {
    const name = htmlAttribute(card, "data-package-name");
    const versionMatch = card.match(/package-version=([^"&<]+)/i);
    const version = versionMatch?.[1] ? decodeURIComponent(decodeHtml(versionMatch[1])) : undefined;
    if (!name || !version) continue;
    const description = plainHtml(card.match(/<p\b[^>]*class="packages-desc"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "");
    const publisher = plainHtml(card.match(/class="packages-meta"[^>]*>\s*<span>([\s\S]*?)<\/span>/i)?.[1] ?? "") || null;
    const monthly = Number(htmlAttribute(card, "data-package-downloads"));
    const publishedMillis = Number(htmlAttribute(card, "data-package-date"));
    const types = (htmlAttribute(card, "data-package-types") ?? "").split(/\s+/).filter(Boolean);
    const hrefs = [...card.matchAll(/href="([^"]+)"/gi)].map((match) => decodeHtml(match[1] ?? ""));
    const npmUrl = hrefs.find((href) => href.startsWith("https://www.npmjs.com/package/")) ?? `https://www.npmjs.com/package/${encodeURIComponent(name)}`;
    const repository = hrefs.find((href) => /^https:\/\/github\.com\//.test(href) && !href.includes("earendil-works/pi/issues")) ?? null;
    items.push({
      name,
      version,
      description,
      keywords: ["pi-package", ...types],
      license: null,
      publisher,
      publishedAt: Number.isFinite(publishedMillis) && publishedMillis > 0 ? new Date(publishedMillis).toISOString() : null,
      weeklyDownloads: null,
      monthlyDownloads: Number.isFinite(monthly) ? monthly : null,
      npmUrl,
      piGalleryUrl: `https://pi.dev/packages/${encodeURIComponent(name)}`,
      repositoryUrl: repository,
    });
  }
  return { items, total };
}

export async function getCommunityPackageCatalog(
  runtimeRoot: string,
  options: PackageCenterFetchOptions & { force?: boolean; maxPages?: number } = {},
): Promise<CommunityPackageCatalogSnapshot> {
  const now = options.now ?? new Date();
  const cached = await readJson<CommunityPackageCatalogSnapshot | undefined>(catalogPath(runtimeRoot), undefined).catch(() => undefined);
  if (!options.force && cached && isFresh(cached, now)) return { ...cached, stale: false, offline: false, refreshError: undefined };
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = 50;
  const maxPages = Math.max(1, Math.min(200, options.maxPages ?? 200));
  try {
    const byName = new Map<string, CommunityPackageCatalogItem>();
    const firstResponse = await fetchCatalogPage(fetchImpl, "https://pi.dev/packages", "text/html");
    const first = parseGalleryPage(await firstResponse.text());
    for (const item of first.items) byName.set(item.name, item);
    const total = Math.max(first.total, first.items.length);
    const pageCount = Math.min(maxPages, Math.max(1, Math.ceil(total / pageSize)));
    let pagesFetched = 1;
    for (let start = 2; start <= pageCount; start += 6) {
      const pages = Array.from({ length: Math.min(6, pageCount - start + 1) }, (_value, index) => start + index);
      const results = await Promise.all(pages.map(async (page) => {
        const response = await fetchCatalogPage(fetchImpl, `https://pi.dev/packages?page=${page}`, "text/html");
        return parseGalleryPage(await response.text());
      }));
      for (const result of results) for (const item of result.items) byName.set(item.name, item);
      pagesFetched += results.length;
      if (start + pages.length <= pageCount) await wait(100);
    }
    const items = [...byName.values()].sort((left, right) =>
      (right.monthlyDownloads ?? right.weeklyDownloads ?? -1) - (left.monthlyDownloads ?? left.weeklyDownloads ?? -1) || left.name.localeCompare(right.name));
    const sourceCursor = Math.min(total, pagesFetched * pageSize);
    const snapshot: CommunityPackageCatalogSnapshot = {
      schemaVersion: 1,
      source: "https://pi.dev/packages (official npm pi-package gallery)",
      docs: PI_PACKAGE_DOCS,
      fetchedAt: now.toISOString(),
      total: Math.max(total, items.length),
      cursor: items.length,
      sourceCursor,
      complete: total === 0 || sourceCursor >= total,
      items,
      stale: false,
      offline: false,
    };
    await writeJsonAtomic(catalogPath(runtimeRoot), snapshot);
    return snapshot;
  } catch (error) {
    if (cached) {
      return {
        ...cached,
        stale: true,
        offline: true,
        refreshError: error instanceof Error ? error.message : String(error),
      };
    }
    throw new PackageCenterError(503, "catalog_unavailable", error instanceof Error ? error.message : String(error));
  }
}

function integrityParts(value: string): { algorithm: string; digest: string } {
  const candidate = value.split(/\s+/).find((entry) => /^(sha512|sha384|sha256)-/.test(entry));
  if (!candidate) throw new PackageCenterError(422, "unsafe_archive", "The npm package has no supported registry integrity digest.");
  const separator = candidate.indexOf("-");
  return { algorithm: candidate.slice(0, separator), digest: candidate.slice(separator + 1) };
}

function verifyIntegrity(buffer: Buffer, integrity: string): void {
  const { algorithm, digest } = integrityParts(integrity);
  const actual = createHash(algorithm).update(buffer).digest("base64");
  if (actual !== digest) throw new PackageCenterError(422, "unsafe_archive", "The downloaded npm archive does not match its registry integrity digest.");
}

function safeArchivePath(path: string): boolean {
  if (!path || path.includes("\\") || path.includes("\0") || isAbsolute(path)) return false;
  const parts = path.split("/").filter(Boolean);
  return parts.every((part) => part !== "." && part !== "..");
}

async function validateArchive(archivePath: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  await tar.t({
    file: archivePath,
    strict: true,
    onentry(entry) {
      if (!safeArchivePath(entry.path)) throw new PackageCenterError(422, "unsafe_archive", `Unsafe archive path: ${entry.path}`);
      if (["SymbolicLink", "Link", "BlockDevice", "CharacterDevice", "FIFO"].includes(entry.type)) {
        throw new PackageCenterError(422, "unsafe_archive", `Unsupported archive entry type ${entry.type}: ${entry.path}`);
      }
      if (entry.type === "File" || entry.type === "OldFile" || entry.type === "ContiguousFile") {
        files += 1;
        bytes += Number(entry.size) || 0;
      }
      if (files > MAX_FILES || bytes > MAX_EXTRACTED_BYTES) {
        throw new PackageCenterError(422, "unsafe_archive", "The package exceeds LA quarantine size limits.");
      }
    },
  });
  return { files, bytes };
}

async function installDependenciesWithoutScripts(packageRoot: string): Promise<void> {
  const manifest = await readJson<Record<string, unknown>>(join(packageRoot, "package.json"));
  if (!Object.keys(record(manifest.dependencies)).length) return;
  const userConfig = join(packageRoot, ".la-empty-npmrc");
  await writeFile(userConfig, "ignore-scripts=true\naudit=false\nfund=false\n", "utf8");
  try {
    await execFileAsync("npm", [
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--package-lock=true",
      "--no-audit",
      "--no-fund",
      `--registry=${REGISTRY}`,
      `--userconfig=${userConfig}`,
    ], {
      cwd: packageRoot,
      timeout: 5 * 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        npm_config_ignore_scripts: "true",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_registry: REGISTRY,
        npm_config_userconfig: userConfig,
      },
    });
  } finally {
    await rm(userConfig, { force: true });
  }
}

interface TreeFile {
  absolute: string;
  relative: string;
  size: number;
}

async function walkTree(root: string): Promise<{ files: TreeFile[]; bytes: number }> {
  const files: TreeFile[] = [];
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const rel = relative(root, absolute).split(sep).join("/");
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new PackageCenterError(422, "unsafe_archive", `Symbolic links are not allowed in managed packages: ${rel}`);
      if (info.isDirectory()) await visit(absolute);
      else if (info.isFile()) {
        files.push({ absolute, relative: rel, size: info.size });
        bytes += info.size;
        if (files.length > MAX_FILES || bytes > MAX_EXTRACTED_BYTES) {
          throw new PackageCenterError(422, "unsafe_archive", "The installed dependency closure exceeds LA quarantine limits.");
        }
      }
    }
  };
  await visit(root);
  files.sort((left, right) => left.relative.localeCompare(right.relative));
  return { files, bytes };
}

async function hashTree(files: TreeFile[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of files) {
    if (file.relative.startsWith(".la/")) continue;
    hash.update(file.relative).update("\0").update(await readFile(file.absolute)).update("\0");
  }
  return hash.digest("hex");
}

function resourceManifest(manifest: Record<string, unknown>, packageRoot: string, files: TreeFile[]) {
  const pi = record(manifest.pi);
  const conventional = (directory: string, predicate: (relativePath: string) => boolean): string[] => {
    const prefix = `${directory}/`;
    return files.filter((file) => file.relative.startsWith(prefix) && predicate(file.relative)).map((file) => `./${file.relative}`);
  };
  return {
    extensions: stringArray(pi.extensions).length
      ? stringArray(pi.extensions)
      : conventional("extensions", (path) => /\.[cm]?[jt]s$/i.test(path)),
    skills: stringArray(pi.skills).length
      ? stringArray(pi.skills)
      : conventional("skills", (path) => /(?:^|\/)SKILL\.md$/i.test(path) || /skills\/[^/]+\.md$/i.test(path)),
    prompts: stringArray(pi.prompts).length
      ? stringArray(pi.prompts)
      : conventional("prompts", (path) => /\.md$/i.test(path)),
    themes: stringArray(pi.themes).length
      ? stringArray(pi.themes)
      : conventional("themes", (path) => /\.json$/i.test(path)),
    packageRoot,
  };
}

function dependencyName(path: string): string {
  const marker = "node_modules/";
  const tail = path.slice(path.lastIndexOf(marker) + marker.length);
  const parts = tail.split("/");
  return parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : parts[0] ?? path;
}

async function dependencyClosure(packageRoot: string): Promise<PackageDependencyRecord[]> {
  const lock = await readJson<{ packages?: Record<string, Record<string, unknown>> }>(join(packageRoot, "package-lock.json"), { packages: {} });
  return Object.entries(lock.packages ?? {})
    .filter(([path]) => path.includes("node_modules/"))
    .map(([path, entry]) => ({
      path,
      name: string(entry.name) ?? dependencyName(path),
      version: string(entry.version) ?? null,
      integrity: string(entry.integrity) ?? null,
      license: string(entry.license) ?? null,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

const LIFECYCLE_NAMES = new Set(["preinstall", "install", "postinstall", "prepare", "prepublish", "prepack", "postpack"]);

async function lifecycleScripts(files: TreeFile[]): Promise<Array<{ packagePath: string; script: string; command: string }>> {
  const output: Array<{ packagePath: string; script: string; command: string }> = [];
  for (const file of files) {
    if (basename(file.relative) !== "package.json" || file.size > 2 * 1024 * 1024) continue;
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(await readFile(file.absolute, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const [script, command] of Object.entries(record(manifest.scripts))) {
      if (LIFECYCLE_NAMES.has(script) && typeof command === "string" && command.trim()) {
        output.push({ packagePath: file.relative, script, command: command.trim().slice(0, 1_000) });
      }
    }
  }
  return output;
}

interface ScanCategory {
  id: PackageRiskFlag["id"];
  severity: PackageRiskFlag["severity"];
  pattern: RegExp;
}

const SCAN_CATEGORIES: ScanCategory[] = [
  { id: "file_access", severity: "high", pattern: /(?:node:fs|from\s+["']fs["']|\b(?:readFile|writeFile|readdir|createReadStream|createWriteStream)\b)/i },
  { id: "network_access", severity: "high", pattern: /(?:\bfetch\s*\(|node:https?|from\s+["'](?:https?|net|dns|undici)["']|\b(?:axios|WebSocket)\b)/i },
  { id: "process_execution", severity: "critical", pattern: /(?:node:child_process|\b(?:execFile|exec|spawn|fork)\s*\(|\bpi\.exec\s*\(|Deno\.Command|Bun\.spawn)/i },
  { id: "secret_access", severity: "critical", pattern: /(?:process\.env|auth\.json|\.env\b|keychain|api[_-]?key|access[_-]?token|secret[_-]?key)/i },
  { id: "custom_ui", severity: "medium", pattern: /(?:ctx\.ui|setWidget|setEditorComponent|\.custom\s*\(|registerCommand\s*\()/i },
  { id: "possible_exfiltration", severity: "critical", pattern: /(?:webhook|upload|exfiltrat|multipart\/form-data|sendBeacon)/i },
];

async function scanTextRisks(files: TreeFile[]): Promise<{ evidence: Map<PackageRiskFlag["id"], string[]>; scanned: number }> {
  const evidence = new Map<PackageRiskFlag["id"], string[]>();
  let scanned = 0;
  for (const file of files) {
    if (file.size > 2 * 1024 * 1024 || !/\.(?:[cm]?[jt]s|md|json|ya?ml|toml|sh|py|rb|go|rs)$/i.test(file.relative)) continue;
    const text = await readFile(file.absolute, "utf8").catch(() => "");
    scanned += 1;
    for (const category of SCAN_CATEGORIES) {
      if (!category.pattern.test(text)) continue;
      const entries = evidence.get(category.id) ?? [];
      if (entries.length < 20) entries.push(file.relative);
      evidence.set(category.id, entries);
    }
  }
  return { evidence, scanned };
}

function riskFlags(input: {
  resources: ReturnType<typeof resourceManifest>;
  lifecycle: Array<{ packagePath: string; script: string; command: string }>;
  evidence: Map<PackageRiskFlag["id"], string[]>;
  license: string | null;
}): PackageRiskFlag[] {
  const flag = (id: PackageRiskFlag["id"], severity: PackageRiskFlag["severity"], evidence: string[]): PackageRiskFlag => ({
    id,
    severity,
    detected: evidence.length > 0,
    evidence,
  });
  return [
    flag("extension_code", "high", input.resources.extensions),
    flag("skill_instructions", "medium", input.resources.skills),
    flag("lifecycle_scripts", "critical", input.lifecycle.map((entry) => `${entry.packagePath}#${entry.script}`)),
    ...SCAN_CATEGORIES.map((category) => flag(category.id, category.severity, input.evidence.get(category.id) ?? [])),
    flag("unknown_license", "high", input.license ? [] : ["package.json: license missing"]),
  ];
}

function coreTier(name: string, version: string): "core" | "labs" {
  return LA_CORE_PACKAGES.some((entry) => entry.name === name && entry.version === version) ? "core" : "labs";
}

async function fetchMetadata(name: string, version: string, fetchImpl: typeof fetch): Promise<NpmVersionMetadata> {
  const url = `${REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "Linguist-Agent-Package-Center/1" } });
  if (!response.ok) throw new PackageCenterError(response.status === 404 ? 400 : 503, response.status === 404 ? "invalid_request" : "catalog_unavailable", `npm metadata returned HTTP ${response.status}`);
  return response.json() as Promise<NpmVersionMetadata>;
}

async function buildDescriptor(input: {
  metadata: NpmVersionMetadata;
  packageRoot: string;
  archiveBytes: number;
  createdAt: string;
}): Promise<CapabilityDescriptorV1> {
  const manifest = await readJson<Record<string, unknown>>(join(input.packageRoot, "package.json"));
  const name = exactPackageName(manifest.name);
  const version = exactVersion(manifest.version);
  const tree = await walkTree(input.packageRoot);
  const resources = resourceManifest(manifest, input.packageRoot, tree.files);
  const lifecycle = await lifecycleScripts(tree.files);
  const scan = await scanTextRisks(tree.files);
  const license = string(manifest.license) ?? string(input.metadata.license) ?? null;
  const peers = record(manifest.peerDependencies);
  const piPeers = Object.fromEntries(Object.entries(peers)
    .filter(([dependency]) => dependency.startsWith("@earendil-works/pi-") || dependency === "typebox")
    .map(([dependency, range]) => [dependency, String(range)]));
  const notes: string[] = [];
  if (Object.values(piPeers).some((range) => !range || range === "*")) notes.push("Pi peer compatibility is declared but unbounded.");
  const descriptor: CapabilityDescriptorV1 = {
    schemaVersion: 1,
    package: {
      name,
      version,
      source: `npm:${name}@${version}`,
      integrity: string(input.metadata.dist?.integrity) ?? "",
      tarball: string(input.metadata.dist?.tarball) ?? "",
      license,
      repository: repositoryUrl(manifest.repository ?? input.metadata.repository),
    },
    tier: coreTier(name, version),
    trust: "quarantined",
    resources: {
      extensions: resources.extensions,
      skills: resources.skills,
      prompts: resources.prompts,
      themes: resources.themes,
    },
    dependencyClosure: await dependencyClosure(input.packageRoot),
    lifecycleScripts: lifecycle,
    risks: riskFlags({ resources, lifecycle, evidence: scan.evidence, license }),
    compatibility: {
      node: string(record(manifest.engines).node) ?? null,
      piPeers,
      runtime: notes.length ? "review_required" : "compatible",
      notes,
    },
    audit: {
      treeHash: await hashTree(tree.files),
      archiveBytes: input.archiveBytes,
      extractedBytes: tree.bytes,
      fileCount: tree.files.length,
      scannedTextFiles: scan.scanned,
      createdAt: input.createdAt,
    },
  };
  return descriptor;
}

export async function previewManagedPackageInstall(
  runtimeRoot: string,
  input: { name: unknown; version: unknown },
  options: PackageCenterFetchOptions & { installDependencies?: (packageRoot: string) => Promise<void> } = {},
): Promise<PackageInstallPreview> {
  const name = exactPackageName(input.name);
  const version = exactVersion(input.version);
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const metadata = await fetchMetadata(name, version, fetchImpl);
  if (metadata.name !== name || metadata.version !== version) throw new PackageCenterError(409, "package_changed", "npm returned metadata for a different package version.");
  const tarball = string(metadata.dist?.tarball);
  const integrity = string(metadata.dist?.integrity);
  if (!tarball || !integrity || !tarball.startsWith("https://")) {
    throw new PackageCenterError(422, "unsafe_archive", "The package has no HTTPS tarball with an integrity digest.");
  }

  const temp = join(quarantineRoot(runtimeRoot), `.preparing-${randomUUID()}`);
  const archivePath = join(temp, "package.tgz");
  const packageRoot = join(temp, "package");
  await mkdir(packageRoot, { recursive: true });
  try {
    const response = await fetchImpl(tarball, { headers: { accept: "application/octet-stream", "user-agent": "Linguist-Agent-Package-Center/1" } });
    if (!response.ok) throw new PackageCenterError(503, "catalog_unavailable", `npm archive returned HTTP ${response.status}`);
    const declaredBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_ARCHIVE_BYTES) throw new PackageCenterError(422, "unsafe_archive", "The npm archive exceeds LA's quarantine download limit.");
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.length > MAX_ARCHIVE_BYTES) throw new PackageCenterError(422, "unsafe_archive", "The npm archive exceeds LA's quarantine download limit.");
    verifyIntegrity(archive, integrity);
    await writeFile(archivePath, archive);
    await validateArchive(archivePath);
    await tar.x({ file: archivePath, cwd: packageRoot, strip: 1, strict: true, preservePaths: false });
    const extractedManifest = await readJson<Record<string, unknown>>(join(packageRoot, "package.json"));
    if (extractedManifest.name !== name || extractedManifest.version !== version) {
      throw new PackageCenterError(409, "package_changed", "The archive manifest does not match the confirmed package and version.");
    }
    await (options.installDependencies ?? installDependenciesWithoutScripts)(packageRoot);
    const descriptor = await buildDescriptor({ metadata, packageRoot, archiveBytes: archive.length, createdAt: now.toISOString() });
    const requiredRiskIds = descriptor.risks.filter((risk) => risk.detected).map((risk) => risk.id).sort();
    const expiresAt = new Date(now.getTime() + QUARANTINE_TTL_MS).toISOString();
    const planHash = sha256(stable({ descriptor, requiredRiskIds, expiresAt }));
    const finalPath = join(quarantineRoot(runtimeRoot), planHash);
    const preview: PreviewRecord = {
      mode: "preview",
      planHash,
      descriptor,
      requiredRiskIds,
      expiresAt,
      docs: PI_PACKAGE_DOCS,
      packageName: name,
      version,
      quarantinePath: finalPath,
    };
    await mkdir(join(packageRoot, ".la"), { recursive: true });
    await writeJsonAtomic(join(packageRoot, ".la", "package-audit.json"), descriptor);
    await writeJsonAtomic(join(packageRoot, ".la", "install-preview.json"), preview);
    await mkdir(quarantineRoot(runtimeRoot), { recursive: true });
    try {
      await rename(temp, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
      await rm(temp, { recursive: true, force: true });
    }
    return preview;
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

async function readPreview(runtimeRoot: string, planHash: string): Promise<PreviewRecord> {
  if (!/^[0-9a-f]{64}$/.test(planHash)) throw new PackageCenterError(400, "invalid_request", "A valid package planHash is required.");
  const path = join(quarantineRoot(runtimeRoot), planHash, "package", ".la", "install-preview.json");
  try {
    return await readJson<PreviewRecord>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PackageCenterError(409, "preview_expired", "The package preview is missing or expired; preview it again.");
    throw error;
  }
}

export async function listManagedPackages(runtimeRoot: string): Promise<ManagedPackageRecord[]> {
  return readJson<ManagedPackageRecord[]>(registryPath(runtimeRoot), []);
}

export async function promoteManagedPackageInstall(
  runtimeRoot: string,
  input: {
    planHash: unknown;
    name: unknown;
    version: unknown;
    confirmedVersion: unknown;
    acceptedRiskIds: unknown;
  },
  options: { now?: Date } = {},
): Promise<ManagedPackageRecord> {
  const planHash = string(input.planHash) ?? "";
  const name = exactPackageName(input.name);
  const version = exactVersion(input.version);
  const confirmedVersion = exactVersion(input.confirmedVersion);
  if (version !== confirmedVersion) throw new PackageCenterError(409, "approval_required", "The exact package version must be confirmed before installation.");
  const acceptedRiskIds = stringArray(input.acceptedRiskIds).sort();
  const preview = await readPreview(runtimeRoot, planHash);
  const now = options.now ?? new Date();
  if (Date.parse(preview.expiresAt) <= now.getTime()) throw new PackageCenterError(409, "preview_expired", "The package preview expired; preview and review it again.");
  if (preview.planHash !== planHash || preview.packageName !== name || preview.version !== version) {
    throw new PackageCenterError(409, "package_changed", "The package install request no longer matches its preview.");
  }
  const missingApprovals = preview.requiredRiskIds.filter((risk) => !acceptedRiskIds.includes(risk));
  if (missingApprovals.length) throw new PackageCenterError(409, "approval_required", `Explicit risk approval is required for: ${missingApprovals.join(", ")}`);

  const source = join(quarantineRoot(runtimeRoot), planHash, "package");
  const tree = await walkTree(source);
  const actualTreeHash = await hashTree(tree.files);
  if (actualTreeHash !== preview.descriptor.audit.treeHash) throw new PackageCenterError(409, "package_changed", "The quarantined package tree changed after audit.");

  const target = join(installedRoot(runtimeRoot), safePackageDirectory(name), version);
  const existing = await stat(target).then(() => true, () => false);
  if (existing) throw new PackageCenterError(409, "package_exists", `${name}@${version} is already installed in the LA managed package directory.`);
  await mkdir(dirname(target), { recursive: true });
  const descriptor: CapabilityDescriptorV1 = { ...preview.descriptor, trust: "approved" };
  const record: ManagedPackageRecord = {
    packageName: name,
    version,
    installedAt: now.toISOString(),
    installPath: target,
    planHash,
    acceptedRiskIds,
    descriptor,
  };
  const before = await listManagedPackages(runtimeRoot);
  await rename(source, target);
  try {
    await writeJsonAtomic(join(target, ".la", "package-audit.json"), descriptor);
    await writeJsonAtomic(registryPath(runtimeRoot), [...before, record]
      .sort((left, right) => left.packageName.localeCompare(right.packageName) || left.version.localeCompare(right.version)));
  } catch (error) {
    await mkdir(dirname(source), { recursive: true });
    await rename(target, source).catch(() => undefined);
    throw error;
  }
  await rm(join(quarantineRoot(runtimeRoot), planHash), { recursive: true, force: true });
  return record;
}

function safeManagedResourcePath(installPath: string, resourcePath: string): string | undefined {
  const clean = resourcePath.replace(/^\.\//, "");
  if (!clean || clean.includes("\0") || clean.includes("\\") || clean.startsWith("!") || clean.startsWith("+") || clean.startsWith("-") || isAbsolute(clean)) return undefined;
  if (clean.split("/").some((part) => part === "..")) return undefined;
  const candidate = join(resolve(installPath), clean);
  const staticPrefix = candidate.split(/[*?[{]/, 1)[0] ?? candidate;
  const rel = relative(resolve(installPath), staticPrefix);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return candidate;
}

export async function resolveApprovedManagedPackageResources(runtimeRoot: string): Promise<{
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
  packages: ManagedPackageRecord[];
}> {
  const packages = await listManagedPackages(runtimeRoot);
  const resources = { extensions: [] as string[], skills: [] as string[], prompts: [] as string[], themes: [] as string[] };
  for (const pkg of packages) {
    for (const type of ["extensions", "skills", "prompts", "themes"] as const) {
      for (const resource of pkg.descriptor.resources[type]) {
        const path = safeManagedResourcePath(pkg.installPath, resource);
        if (path) resources[type].push(path);
      }
    }
  }
  return {
    extensions: [...new Set(resources.extensions)].sort(),
    skills: [...new Set(resources.skills)].sort(),
    prompts: [...new Set(resources.prompts)].sort(),
    themes: [...new Set(resources.themes)].sort(),
    packages,
  };
}

export function filterCommunityPackageCatalog(
  snapshot: CommunityPackageCatalogSnapshot,
  input: { query?: string; cursor?: number; limit?: number },
): CommunityPackageCatalogSnapshot & { nextCursor: number | null; returned: number } {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const filtered = query
    ? snapshot.items.filter((item) => `${item.name} ${item.description} ${item.keywords.join(" ")}`.toLocaleLowerCase().includes(query))
    : snapshot.items;
  const cursor = Math.max(0, Math.floor(input.cursor ?? 0));
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 50)));
  const items = filtered.slice(cursor, cursor + limit);
  return {
    ...snapshot,
    total: filtered.length,
    cursor,
    items,
    returned: items.length,
    nextCursor: cursor + items.length < filtered.length ? cursor + items.length : null,
  };
}
