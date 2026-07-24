import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_FILES = 30_000;
const MAX_BYTES = 500 * 1024 * 1024;

export type LegacyPackageClassification = "declarative_candidate" | "manual_review";

export interface LegacyPackageInventoryEntryV1 {
  recordIndex: number;
  packageName: string | null;
  version: string | null;
  classification: LegacyPackageClassification;
  reasons: string[];
  detectedRiskIds: string[];
  original: {
    installPath: string | null;
    source: string | null;
    integrity: string | null;
    treeHash: string | null;
    planHash: string | null;
    acceptedRiskIds: string[];
  };
  actualTreeHash: string | null;
}

export interface LegacyPackageInventoryReportV1 {
  schemaVersion: 1;
  registryStatus: "missing" | "present" | "corrupt";
  registryPath: string;
  legacyInstalledRoot: string;
  generatedAt: string;
  totalRecords: number;
  counts: {
    declarativeCandidate: number;
    manualReview: number;
    corruptRecord: number;
  };
  registryIssues: string[];
  entries: LegacyPackageInventoryEntryV1[];
}

interface LegacyRecordView {
  packageName: string;
  version: string;
  installPath: string;
  planHash: string;
  acceptedRiskIds: string[];
  source: string;
  integrity: string;
  treeHash: string;
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
  dependencyCount: number;
  lifecycleCount: number;
  detectedRiskIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : null;
}

function parseLegacyRecord(value: unknown): LegacyRecordView | null {
  if (!isRecord(value) || !isRecord(value.descriptor)) return null;
  const descriptor = value.descriptor;
  if (!isRecord(descriptor.package) || !isRecord(descriptor.resources) || !isRecord(descriptor.audit)) return null;
  const packageName = string(value.packageName);
  const version = string(value.version);
  const installPath = string(value.installPath);
  const planHash = string(value.planHash);
  const acceptedRiskIds = stringArray(value.acceptedRiskIds);
  const source = string(descriptor.package.source);
  const integrity = string(descriptor.package.integrity);
  const treeHash = string(descriptor.audit.treeHash);
  const extensions = stringArray(descriptor.resources.extensions);
  const skills = stringArray(descriptor.resources.skills);
  const prompts = stringArray(descriptor.resources.prompts);
  const themes = stringArray(descriptor.resources.themes);
  if (!packageName || !version || !installPath || !isAbsolute(installPath) || !planHash || !/^[a-f0-9]{64}$/u.test(planHash) ||
    acceptedRiskIds === null || !source || integrity === null || !treeHash || !/^[a-f0-9]{64}$/u.test(treeHash) ||
    extensions === null || skills === null || prompts === null || themes === null ||
    !Array.isArray(descriptor.dependencyClosure) || !Array.isArray(descriptor.lifecycleScripts) || !Array.isArray(descriptor.risks)) {
    return null;
  }
  const detectedRiskIds: string[] = [];
  for (const risk of descriptor.risks) {
    if (!isRecord(risk) || typeof risk.id !== "string" || typeof risk.detected !== "boolean") return null;
    if (risk.detected) detectedRiskIds.push(risk.id);
  }
  return {
    packageName,
    version,
    installPath,
    planHash,
    acceptedRiskIds: [...acceptedRiskIds].sort(),
    source,
    integrity,
    treeHash,
    extensions,
    skills,
    prompts,
    themes,
    dependencyCount: descriptor.dependencyClosure.length,
    lifecycleCount: descriptor.lifecycleScripts.length,
    detectedRiskIds: [...new Set(detectedRiskIds)].sort(),
  };
}

function corruptEntry(value: unknown, recordIndex: number): LegacyPackageInventoryEntryV1 {
  const record = isRecord(value) ? value : {};
  const descriptor = isRecord(record.descriptor) ? record.descriptor : {};
  const packageInfo = isRecord(descriptor.package) ? descriptor.package : {};
  const audit = isRecord(descriptor.audit) ? descriptor.audit : {};
  return {
    recordIndex,
    packageName: string(record.packageName),
    version: string(record.version),
    classification: "manual_review",
    reasons: ["corrupt_registry_record"],
    detectedRiskIds: [],
    original: {
      installPath: string(record.installPath),
      source: string(packageInfo.source),
      integrity: string(packageInfo.integrity),
      treeHash: string(audit.treeHash),
      planHash: string(record.planHash),
      acceptedRiskIds: stringArray(record.acceptedRiskIds) ?? [],
    },
    actualTreeHash: null,
  };
}

async function hashLegacyTree(root: string): Promise<{ hash: string; paths: Set<string> }> {
  const files: Array<{ absolute: string; relative: string; size: number }> = [];
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error("installed_tree_symlink");
      if (info.isDirectory()) await visit(absolute);
      else if (info.isFile()) {
        files.push({ absolute, relative: path, size: info.size });
        bytes += info.size;
        if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new Error("installed_tree_limit_exceeded");
      }
    }
  };
  await visit(root);
  files.sort((left, right) => left.relative.localeCompare(right.relative));
  const hash = createHash("sha256");
  for (const file of files) {
    if (file.relative.startsWith(".la/")) continue;
    hash.update(file.relative).update("\0").update(await readFile(file.absolute)).update("\0");
  }
  return { hash: hash.digest("hex"), paths: new Set(files.map((file) => file.relative)) };
}

function cleanResourcePath(value: string): string | null {
  const clean = value.replace(/^\.\//u, "");
  if (!clean || isAbsolute(clean) || clean.includes("\\") || clean.includes("\0") || clean.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return clean;
}

async function inspectRecord(
  record: LegacyRecordView,
  recordIndex: number,
  legacyInstalledRoot: string,
): Promise<LegacyPackageInventoryEntryV1> {
  const reasons = new Set<string>();
  let actualTreeHash: string | null = null;
  const executableRiskIds = new Set(["extension_code", "lifecycle_scripts", "process_execution", "custom_ui", "possible_exfiltration"]);
  if (record.extensions.length > 0) reasons.add("executable_extension");
  if (record.lifecycleCount > 0) reasons.add("lifecycle_scripts");
  if (record.dependencyCount > 0) reasons.add("dependency_closure_requires_review");
  if (record.detectedRiskIds.some((id) => executableRiskIds.has(id))) reasons.add("executable_or_high_authority_risk");

  const installedRootResolved = resolve(legacyInstalledRoot);
  const candidateResolved = resolve(record.installPath);
  const lexicalRelative = relative(installedRootResolved, candidateResolved);
  if (!lexicalRelative || lexicalRelative.startsWith("..") || isAbsolute(lexicalRelative)) {
    reasons.add("install_path_outside_legacy_root");
  } else {
    try {
      const [rootRealPath, candidateRealPath] = await Promise.all([realpath(installedRootResolved), realpath(candidateResolved)]);
      const realRelative = relative(rootRealPath, candidateRealPath);
      if (!realRelative || realRelative.startsWith("..") || isAbsolute(realRelative)) {
        reasons.add("install_path_outside_legacy_root");
      } else {
        const tree = await hashLegacyTree(candidateRealPath);
        actualTreeHash = tree.hash;
        if (tree.hash !== record.treeHash) reasons.add("tree_digest_mismatch");
        for (const resource of [...record.skills, ...record.prompts, ...record.themes]) {
          const path = cleanResourcePath(resource);
          if (!path || !tree.paths.has(path)) reasons.add("declared_resource_missing_or_unsafe");
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") reasons.add("installed_tree_missing");
      else if (error instanceof Error && ["installed_tree_symlink", "installed_tree_limit_exceeded"].includes(error.message)) reasons.add(error.message);
      else reasons.add("installed_tree_unreadable");
    }
  }
  return {
    recordIndex,
    packageName: record.packageName,
    version: record.version,
    classification: reasons.size === 0 ? "declarative_candidate" : "manual_review",
    reasons: [...reasons].sort(),
    detectedRiskIds: record.detectedRiskIds,
    original: {
      installPath: record.installPath,
      source: record.source,
      integrity: record.integrity,
      treeHash: record.treeHash,
      planHash: record.planHash,
      acceptedRiskIds: record.acceptedRiskIds,
    },
    actualTreeHash,
  };
}

export async function inventoryLegacyManagedPackages(
  runtimeRoot: string,
  options: { now?: Date } = {},
): Promise<LegacyPackageInventoryReportV1> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("Inventory time is invalid.");
  const packageRoot = join(runtimeRoot, "data", "assistant", "capabilities", "packages");
  const registryPath = join(packageRoot, "installed-v1.json");
  const legacyInstalledRoot = join(packageRoot, "installed");
  const empty = (registryStatus: LegacyPackageInventoryReportV1["registryStatus"], registryIssues: string[]): LegacyPackageInventoryReportV1 => ({
    schemaVersion: 1,
    registryStatus,
    registryPath,
    legacyInstalledRoot,
    generatedAt: now.toISOString(),
    totalRecords: 0,
    counts: { declarativeCandidate: 0, manualReview: 0, corruptRecord: 0 },
    registryIssues,
    entries: [],
  });
  let registryBytes: string;
  try {
    const info = await lstat(registryPath);
    if (!info.isFile() || info.isSymbolicLink()) return empty("corrupt", ["registry_not_regular_file"]);
    registryBytes = await readFile(registryPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty("missing", ["registry_missing"]);
    return empty("corrupt", ["registry_unreadable"]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(registryBytes) as unknown;
  } catch {
    return empty("corrupt", ["registry_json_invalid"]);
  }
  if (!Array.isArray(raw)) return empty("corrupt", ["registry_root_not_array"]);
  const entries: LegacyPackageInventoryEntryV1[] = [];
  let corruptRecord = 0;
  for (const [recordIndex, candidate] of raw.entries()) {
    const parsed = parseLegacyRecord(candidate);
    if (!parsed) {
      corruptRecord += 1;
      entries.push(corruptEntry(candidate, recordIndex));
    } else {
      entries.push(await inspectRecord(parsed, recordIndex, legacyInstalledRoot));
    }
  }
  const declarativeCandidate = entries.filter((entry) => entry.classification === "declarative_candidate").length;
  return {
    schemaVersion: 1,
    registryStatus: "present",
    registryPath,
    legacyInstalledRoot,
    generatedAt: now.toISOString(),
    totalRecords: raw.length,
    counts: {
      declarativeCandidate,
      manualReview: entries.length - declarativeCandidate,
      corruptRecord,
    },
    registryIssues: [],
    entries,
  };
}
