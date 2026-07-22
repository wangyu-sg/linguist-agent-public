import { dirname, relative } from "node:path";
import type { PackageManager, ResolvedPaths } from "@earendil-works/pi-coding-agent";

export type PiPackageScope = "global" | "project";
export type PiPackageSourceType = "npm" | "git" | "local";
export type PiPackageResourceType = "extensions" | "skills" | "prompts" | "themes";
export type PiPackageResourceScope = PiPackageScope | "temporary";
export type PiPackageResourceOrigin = "package" | "top-level";

const RESOURCE_TYPES: PiPackageResourceType[] = ["extensions", "skills", "prompts", "themes"];

export interface PiPackageInput {
  source: string;
  filters?: Partial<Record<PiPackageResourceType, string[]>>;
}

export interface PiPackageResourceToggleInput {
  type: PiPackageResourceType;
  path: string;
  enabled: boolean;
  source: string;
  scope: PiPackageScope;
  origin: PiPackageResourceOrigin;
  baseDir?: string;
}

export interface PiPackageEntry {
  scope: PiPackageScope;
  index: number;
  source: string;
  sourceType: PiPackageSourceType;
  filtered: boolean;
  filters: Partial<Record<PiPackageResourceType, string[]>>;
  raw: string | { source: string } & Partial<Record<PiPackageResourceType, string[]>>;
}

export interface PiPackagesCatalog {
  docs: string;
  paths: { global: string; project: string };
  entries: PiPackageEntry[];
  global: PiPackageEntry[];
  project: PiPackageEntry[];
  configuredPackages: ReturnType<PackageManager["listConfiguredPackages"]>;
  resources: PiPackageResourcesCatalog;
  risk: {
    requiresConfirmation: true;
    executesThirdPartyCode: false;
    message: string;
  };
}

type PackageSettingValue = string | ({ source: string } & Partial<Record<PiPackageResourceType, string[]>>);

export interface PiPackageResourceEntry {
  type: PiPackageResourceType;
  path: string;
  enabled: boolean;
  source: string;
  scope: PiPackageResourceScope;
  origin: PiPackageResourceOrigin;
  baseDir?: string;
}

export interface PiPackageResourceCount {
  total: number;
  enabled: number;
  disabled: number;
}

export interface PiPackageResourcesCatalog {
  docs: string;
  projectTrusted: boolean;
  defaultProjectTrust: "ask" | "always" | "never";
  skippedMissingSources: string[];
  counts: Record<PiPackageResourceType, PiPackageResourceCount>;
  entries: PiPackageResourceEntry[];
}

function classifySource(source: string): PiPackageSourceType {
  if (source.startsWith("npm:")) return "npm";
  if (source.startsWith("git:") || /^(https?|ssh|git):\/\//.test(source)) return "git";
  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../")) return "local";
  throw new Error(`Unsupported Pi package source: ${source}`);
}

function packageSourceOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = (value as Record<string, unknown>).source;
    return typeof source === "string" ? source : undefined;
  }
  return undefined;
}

function normalizeFilters(input: unknown): Partial<Record<PiPackageResourceType, string[]>> {
  const filters: Partial<Record<PiPackageResourceType, string[]>> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return filters;
  const record = input as Record<string, unknown>;
  for (const type of RESOURCE_TYPES) {
    const value = record[type];
    if (value === undefined) continue;
    if (!Array.isArray(value)) throw new Error(`${type} filter must be an array.`);
    filters[type] = value.map((item) => {
      if (typeof item !== "string") throw new Error(`${type} filter entries must be strings.`);
      return item.trim();
    }).filter(Boolean);
  }
  return filters;
}

function normalizePackageInput(input: PiPackageInput): PackageSettingValue {
  const source = input.source.trim();
  if (!source) throw new Error("Pi package source is required.");
  classifySource(source);
  const filters = normalizeFilters(input.filters);
  const hasFilters = RESOURCE_TYPES.some((type) => filters[type] !== undefined);
  if (!hasFilters) return source;
  return { source, ...filters };
}

function normalizePackageArray(value: unknown): PackageSettingValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Pi packages setting must be an array.");
  return value.map((entry) => normalizePackageInput({ source: packageSourceOf(entry) ?? "", filters: entry }));
}

export function buildPiPackagesCatalog(input: {
  globalSettings: Record<string, unknown>;
  projectSettings: Record<string, unknown>;
  paths: { global: string; project: string };
  configuredPackages?: ReturnType<PackageManager["listConfiguredPackages"]>;
  resources?: PiPackageResourcesCatalog;
}): PiPackagesCatalog {
  const globalPackages = normalizePackageArray(input.globalSettings.packages);
  const projectPackages = normalizePackageArray(input.projectSettings.packages);
  const entries = [
    ...globalPackages.map((entry, index) => packageEntry("global", index, entry)),
    ...projectPackages.map((entry, index) => packageEntry("project", index, entry)),
  ];
  return {
    docs: "https://pi.dev/docs/latest/packages",
    paths: input.paths,
    entries,
    global: entries.filter((entry) => entry.scope === "global"),
    project: entries.filter((entry) => entry.scope === "project"),
    configuredPackages: input.configuredPackages ?? [],
    resources: input.resources ?? emptyPackageResourcesCatalog(),
    risk: {
      requiresConfirmation: true,
      executesThirdPartyCode: false,
      message: "This API only edits Pi packages[] settings. Pi may install/load package code later when a trusted session starts or when a package executor is run.",
    },
  };
}

export function buildPiPackageResourceVisibility(input: {
  resolvedPaths: ResolvedPaths;
  projectTrusted: boolean;
  defaultProjectTrust?: "ask" | "always" | "never";
  skippedMissingSources?: string[];
}): PiPackageResourcesCatalog {
  const counts = emptyResourceCounts();
  const entries: PiPackageResourceEntry[] = [];
  for (const type of RESOURCE_TYPES) {
    for (const resource of input.resolvedPaths[type]) {
      counts[type].total += 1;
      if (resource.enabled) counts[type].enabled += 1;
      else counts[type].disabled += 1;
      entries.push({
        type,
        path: resource.path,
        enabled: resource.enabled,
        source: resource.metadata.source,
        scope: normalizeResourceScope(resource.metadata.scope),
        origin: resource.metadata.origin,
        baseDir: resource.metadata.baseDir,
      });
    }
  }
  return {
    docs: "https://pi.dev/docs/latest/packages#enable-and-disable-resources",
    projectTrusted: input.projectTrusted,
    defaultProjectTrust: input.defaultProjectTrust ?? "ask",
    skippedMissingSources: [...new Set(input.skippedMissingSources ?? [])],
    counts,
    entries,
  };
}

export function upsertPiPackageEntry(settings: Record<string, unknown>, input: PiPackageInput): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
  const entry = normalizePackageInput(input);
  const source = packageSourceOf(entry) ?? "";
  const packages = normalizePackageArray(next.packages).filter((item) => packageSourceOf(item) !== source);
  packages.push(entry);
  next.packages = packages;
  return next;
}

export function deletePiPackageEntry(settings: Record<string, unknown>, source: string): { settings: Record<string, unknown>; removed: boolean } {
  const cleanSource = source.trim();
  if (!cleanSource) throw new Error("Pi package source is required.");
  const next = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
  const before = normalizePackageArray(next.packages);
  const after = before.filter((entry) => packageSourceOf(entry) !== cleanSource);
  next.packages = after;
  return { settings: next, removed: after.length !== before.length };
}

export function togglePiPackageResource(settings: Record<string, unknown>, input: PiPackageResourceToggleInput): Record<string, unknown> {
  const clean = normalizeResourceToggleInput(input);
  const next = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
  const pattern = resourceTogglePattern(clean.path, clean.baseDir ?? dirname(clean.path));
  if (!pattern) throw new Error("Pi package resource path must resolve to a non-empty pattern.");

  if (clean.origin === "top-level") {
    const current = normalizeStringArraySetting(next[clean.type], clean.type);
    next[clean.type] = updateResourcePattern(current, pattern, clean.enabled);
    return next;
  }

  const packages = normalizePackageArray(next.packages);
  const pkgIndex = packages.findIndex((entry) => packageSourceOf(entry) === clean.source);
  if (pkgIndex === -1) throw new Error(`No matching Pi package entry found for ${clean.source}.`);

  const rawPackage = packages[pkgIndex];
  const packageObject = typeof rawPackage === "string" ? { source: rawPackage } : { ...rawPackage };
  const current = packageObject[clean.type] ?? [];
  packageObject[clean.type] = updateResourcePattern(current, pattern, clean.enabled);
  if (packageObject[clean.type]?.length === 0) delete packageObject[clean.type];
  packages[pkgIndex] = RESOURCE_TYPES.some((type) => packageObject[type] !== undefined) ? packageObject : packageObject.source;
  next.packages = packages;
  return next;
}

function packageEntry(scope: PiPackageScope, index: number, raw: PackageSettingValue): PiPackageEntry {
  const source = packageSourceOf(raw) ?? "";
  const filters = typeof raw === "string" ? {} : normalizeFilters(raw);
  return {
    scope,
    index,
    source,
    sourceType: classifySource(source),
    filtered: RESOURCE_TYPES.some((type) => filters[type] !== undefined),
    filters,
    raw,
  };
}

function emptyPackageResourcesCatalog(): PiPackageResourcesCatalog {
  return {
    docs: "https://pi.dev/docs/latest/packages#enable-and-disable-resources",
    projectTrusted: false,
    defaultProjectTrust: "ask",
    skippedMissingSources: [],
    counts: emptyResourceCounts(),
    entries: [],
  };
}

function emptyResourceCounts(): Record<PiPackageResourceType, PiPackageResourceCount> {
  return {
    extensions: { total: 0, enabled: 0, disabled: 0 },
    skills: { total: 0, enabled: 0, disabled: 0 },
    prompts: { total: 0, enabled: 0, disabled: 0 },
    themes: { total: 0, enabled: 0, disabled: 0 },
  };
}

function normalizeResourceScope(scope: string): PiPackageResourceScope {
  if (scope === "user") return "global";
  if (scope === "project" || scope === "temporary") return scope;
  return "global";
}

function normalizeResourceToggleInput(input: PiPackageResourceToggleInput): PiPackageResourceToggleInput {
  if (!RESOURCE_TYPES.includes(input.type)) throw new Error("Pi package resource type must be extensions, skills, prompts, or themes.");
  const path = stringField(input.path, "path");
  const source = stringField(input.source, "source");
  if (input.origin !== "package" && input.origin !== "top-level") throw new Error("Pi package resource origin must be package or top-level.");
  if (input.scope !== "global" && input.scope !== "project") throw new Error("Pi package resource scope must be global or project.");
  if (typeof input.enabled !== "boolean") throw new Error("Pi package resource enabled must be a boolean.");
  return {
    type: input.type,
    path,
    enabled: input.enabled,
    source,
    scope: input.scope,
    origin: input.origin,
    baseDir: typeof input.baseDir === "string" && input.baseDir.trim() ? input.baseDir.trim() : undefined,
  };
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Pi package resource ${label} is required.`);
  return value.trim();
}

function normalizeStringArraySetting(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Pi ${label} setting must be a string array.`);
  return value.map((entry) => {
    if (typeof entry !== "string") throw new Error(`Pi ${label} setting entries must be strings.`);
    return entry.trim();
  }).filter(Boolean);
}

function resourceTogglePattern(path: string, baseDir: string): string {
  return toPosixPath(relative(baseDir, path));
}

function updateResourcePattern(current: string[], pattern: string, enabled: boolean): string[] {
  const updated = current.filter((entry) => stripOverridePrefix(entry) !== pattern);
  updated.push(`${enabled ? "+" : "-"}${pattern}`);
  return updated;
}

function stripOverridePrefix(value: string): string {
  return value.startsWith("!") || value.startsWith("+") || value.startsWith("-") ? value.slice(1) : value;
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}
