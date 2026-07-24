import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeDurableFileAtomic } from "@linguist-agent/cat-data";
import * as tar from "tar";
import {
  inspectLapkgArchiveBytes,
  LAPKG_RESOURCE_TYPES,
  LapkgFormatError,
  type InspectedLapkgV1,
  type LapkgResourceType,
} from "./lapkg_format.js";
import {
  assertLapkgPreviewCurrent,
  LapkgPreviewError,
  type LapkgInstallPreviewV1,
} from "./lapkg_preview.js";
import {
  LapkgSignatureError,
  verifyLapkgSignature,
  type LapkgTrustRootV1,
} from "./lapkg_signature.js";
import {
  advanceLapkgActivationJournal,
  assertLapkgActivationWritable,
  removeLapkgActivationJournal,
  writeLapkgActivationJournal,
  type LapkgActivationJournalV1,
} from "./lapkg_activation_journal.js";
import {
  lapkgContentRefId,
  lapkgSqliteMarkerPath,
  type LapkgPackageStorage,
} from "./lapkg_package_storage.js";

export type LapkgActivationErrorCode =
  | "LAPKG_ACTIVATION_INVALID"
  | "LAPKG_APPROVAL_INVALID"
  | "LAPKG_APPROVAL_EXPIRED"
  | "LAPKG_ACTIVATION_BUSY"
  | "LAPKG_PACKAGE_EXISTS"
  | "LAPKG_CONTENT_CHANGED"
  | "LAPKG_REGISTRY_INVALID"
  | "LAPKG_RECOVERY_REQUIRED"
  | "LAPKG_RECOVERY_BLOCKED";

export class LapkgActivationError extends Error {
  constructor(
    public readonly code: LapkgActivationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LapkgActivationError";
  }
}

export type LapkgActivationPhase =
  | "lock_acquired"
  | "staging_verified"
  | "content_published"
  | "before_registry_commit"
  | "registry_committed";

export type LapkgActivationCrashPoint =
  | "journal_prepared"
  | "staging_verified"
  | "content_published"
  | "registry_renamed"
  | "registry_committed";

export class LapkgSimulatedCrashError extends Error {
  constructor(public readonly point: LapkgActivationCrashPoint) {
    super(`Simulated abrupt termination after ${point}.`);
    this.name = "LapkgSimulatedCrashError";
  }
}

export interface ActivatedLapkgResourceV2 {
  id: string;
  type: LapkgResourceType;
  path: string;
  sha256: string;
  size: number;
  mediaType?: string;
}

export interface ActivatedLapkgRecordV2 {
  schemaVersion: 2;
  packageId: string;
  packageVersion: string;
  publisherId: string;
  license: string;
  activatedAt: string;
  activationRevision: number;
  previewPlanHash: string;
  source: LapkgInstallPreviewV1["source"];
  signer: LapkgInstallPreviewV1["signer"];
  archiveSha256: string;
  manifestSha256: string;
  treeHash: string;
  contentDirectory: string;
  contentBlobRefId?: string;
  resources: ActivatedLapkgResourceV2[];
}

export interface LapkgRegistryV2 {
  schemaVersion: 2;
  revision: number;
  packages: ActivatedLapkgRecordV2[];
}

export interface ActivatedLapkgResult extends ActivatedLapkgRecordV2 {
  contentPath: string;
}

export interface ActivateLapkgInput {
  runtimeRoot: string;
  archiveBytes: Buffer;
  preview: LapkgInstallPreviewV1;
  expectedPlanHash: string;
  trustRoots: readonly LapkgTrustRootV1[];
  storage?: LapkgPackageStorage;
}

function fail(code: LapkgActivationErrorCode, message: string): never {
  throw new LapkgActivationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function lapkgV2Root(runtimeRoot: string): string {
  return join(runtimeRoot, "data", "assistant", "capabilities", "packages-v2");
}

export function lapkgRegistryPath(runtimeRoot: string): string {
  return join(lapkgV2Root(runtimeRoot), "registry-v2.json");
}

function exactTime(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

export function parseLapkgRegistry(value: unknown): LapkgRegistryV2 {
  if (!isRecord(value) || value.schemaVersion !== 2 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.packages)) {
    fail("LAPKG_REGISTRY_INVALID", "The v2 Package registry is invalid.");
  }
  const packages: ActivatedLapkgRecordV2[] = [];
  const identities = new Set<string>();
  for (const item of value.packages) {
    if (!isRecord(item) || item.schemaVersion !== 2 || typeof item.packageId !== "string" || typeof item.packageVersion !== "string" ||
      typeof item.publisherId !== "string" || typeof item.license !== "string" || !exactTime(item.activatedAt) ||
      !Number.isSafeInteger(item.activationRevision) || Number(item.activationRevision) < 1 ||
      typeof item.previewPlanHash !== "string" || !/^[a-f0-9]{64}$/u.test(item.previewPlanHash) ||
      typeof item.archiveSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.archiveSha256) ||
      typeof item.manifestSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.manifestSha256) ||
      typeof item.treeHash !== "string" || !/^[a-f0-9]{64}$/u.test(item.treeHash) ||
      item.contentDirectory !== `content/${item.treeHash}` ||
      (item.contentBlobRefId !== undefined && (typeof item.contentBlobRefId !== "string"
        || item.contentBlobRefId !== lapkgContentRefId(String(item.packageId), String(item.packageVersion), String(item.treeHash)))) ||
      !Array.isArray(item.resources) || !isRecord(item.source) ||
      item.source.schemaVersion !== 1 || (item.source.kind !== "local_file" && item.source.kind !== "catalog") ||
      typeof item.source.sourceId !== "string" || !exactTime(item.source.acquiredAt) ||
      item.source.expectedArchiveSha256 !== item.archiveSha256 || !isRecord(item.signer) ||
      item.signer.schemaVersion !== 1 || item.signer.packageId !== item.packageId || item.signer.packageVersion !== item.packageVersion ||
      item.signer.publisherId !== item.publisherId || typeof item.signer.keyId !== "string" ||
      typeof item.signer.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(item.signer.payloadSha256) ||
      item.signer.treeHash !== item.treeHash || !exactTime(item.signer.verifiedAt)) {
      fail("LAPKG_REGISTRY_INVALID", "A v2 Package registry record is invalid.");
    }
    for (const resource of item.resources) {
      if (!isRecord(resource) || typeof resource.id !== "string" || typeof resource.type !== "string" ||
        !(LAPKG_RESOURCE_TYPES as readonly string[]).includes(resource.type) || typeof resource.path !== "string" ||
        !resource.path.startsWith("resources/") || isAbsolute(resource.path) || resource.path.split("/").some((part) => !part || part === "." || part === "..") ||
        typeof resource.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(resource.sha256) ||
        !Number.isSafeInteger(resource.size) || Number(resource.size) < 0 ||
        (resource.mediaType !== undefined && typeof resource.mediaType !== "string")) {
        fail("LAPKG_REGISTRY_INVALID", "A v2 Package registry resource is invalid.");
      }
    }
    const identity = `${item.packageId}\0${item.packageVersion}`;
    if (identities.has(identity)) fail("LAPKG_REGISTRY_INVALID", "The v2 Package registry contains duplicate package identities.");
    identities.add(identity);
    packages.push(item as unknown as ActivatedLapkgRecordV2);
  }
  return { schemaVersion: 2, revision: Number(value.revision), packages };
}

export async function listActivatedLapkgPackages(
  runtimeRoot: string,
  options: { storage?: LapkgPackageStorage } = {},
): Promise<LapkgRegistryV2> {
  if (options.storage) return (await options.storage.readRegistry()).registry;
  if (await lstat(lapkgSqliteMarkerPath(runtimeRoot)).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  })) {
    fail("LAPKG_RECOVERY_REQUIRED", "The Package registry is owned by SQLite after cutover.");
  }
  const path = lapkgRegistryPath(runtimeRoot);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) fail("LAPKG_REGISTRY_INVALID", "The v2 Package registry must be a regular file.");
    return parseLapkgRegistry(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 2, revision: 0, packages: [] };
    if (error instanceof LapkgActivationError) throw error;
    fail("LAPKG_REGISTRY_INVALID", "The v2 Package registry cannot be read.");
  }
}

export function hashLapkgRegistry(registry: LapkgRegistryV2): string {
  return createHash("sha256").update(JSON.stringify(registry)).digest("hex");
}

async function writeRegistryAtomic(path: string, registry: LapkgRegistryV2, onRenamed: () => void): Promise<void> {
  await writeDurableFileAtomic(path, `${JSON.stringify(registry, null, 2)}\n`, {
    faultInjection: (point) => { if (point === "after_rename") onRenamed(); },
  });
}

async function extractArchiveBytes(archiveBytes: Buffer, destination: string): Promise<void> {
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const extractor = tar.x({ cwd: destination, strict: true, preservePaths: false });
  const complete = new Promise<void>((resolveComplete, rejectComplete) => {
    extractor.once("error", rejectComplete);
    extractor.once("close", resolveComplete);
  });
  extractor.end(archiveBytes);
  await complete;
}

async function verifyExtractedTree(root: string, inspected: InspectedLapkgV1): Promise<void> {
  for (const resource of inspected.resources) {
    const path = join(root, resource.path);
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isFile() || info.isSymbolicLink() || info.size !== resource.size || sha256(await readFile(path)) !== resource.sha256) {
      fail("LAPKG_CONTENT_CHANGED", `Staged resource ${resource.id} does not match its verified archive bytes.`);
    }
  }
}

export async function verifyActivatedLapkgContent(root: string, record: ActivatedLapkgRecordV2): Promise<void> {
  for (const resource of record.resources) {
    const path = join(root, resource.path);
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isFile() || info.isSymbolicLink() || info.size !== resource.size || sha256(await readFile(path)) !== resource.sha256) {
      fail("LAPKG_CONTENT_CHANGED", `Active resource ${resource.id} no longer matches its registry digest.`);
    }
  }
}

async function makeReadOnly(root: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        await chmod(path, 0o555);
      } else if (entry.isFile()) {
        await chmod(path, 0o444);
      } else {
        fail("LAPKG_CONTENT_CHANGED", "The staged Package contains a non-file entry.");
      }
    }
  };
  await visit(root);
  await chmod(root, 0o555);
}

export async function makeLapkgTreeRemovable(root: string): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    await chmod(directory, 0o755);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) await visit(join(directory, entry.name));
    }
  };
  await visit(root).catch(() => undefined);
}

function validateApproval(
  input: ActivateLapkgInput,
  inspected: InspectedLapkgV1,
  now: Date,
): void {
  try {
    assertLapkgPreviewCurrent(input.preview, input.expectedPlanHash, now);
  } catch (error) {
    if (error instanceof LapkgPreviewError && error.code === "LAPKG_PREVIEW_EXPIRED") {
      fail("LAPKG_APPROVAL_EXPIRED", "The approved Package Preview has expired.");
    }
    if (error instanceof LapkgPreviewError) fail("LAPKG_APPROVAL_INVALID", "The approved Package Preview is invalid or changed.");
    throw error;
  }
  if (sha256(input.archiveBytes) !== input.preview.source.expectedArchiveSha256 || inspected.archiveSha256 !== input.preview.archiveSha256 ||
    inspected.manifestSha256 !== input.preview.manifestSha256 || inspected.treeHash !== input.preview.treeHash ||
    inspected.manifest.id !== input.preview.package.id || inspected.manifest.version !== input.preview.package.version ||
    inspected.manifest.publisher.id !== input.preview.package.publisherId || inspected.manifest.license !== input.preview.package.license) {
    fail("LAPKG_APPROVAL_INVALID", "The activation archive does not match the approved Package Preview.");
  }
  try {
    const signer = verifyLapkgSignature(inspected, input.trustRoots, { now });
    if (signer.keyId !== input.preview.signer.keyId || signer.publisherId !== input.preview.signer.publisherId ||
      signer.payloadSha256 !== input.preview.signer.payloadSha256 || signer.treeHash !== input.preview.signer.treeHash) {
      fail("LAPKG_APPROVAL_INVALID", "The current signature attestation does not match the approved Preview.");
    }
  } catch (error) {
    if (error instanceof LapkgActivationError) throw error;
    if (error instanceof LapkgSignatureError) fail("LAPKG_APPROVAL_INVALID", "The Package signature is no longer accepted.");
    throw error;
  }
}

function toRecord(
  inspected: InspectedLapkgV1,
  preview: LapkgInstallPreviewV1,
  activatedAt: string,
  activationRevision: number,
  storage?: LapkgPackageStorage,
): ActivatedLapkgRecordV2 {
  return {
    schemaVersion: 2,
    packageId: inspected.manifest.id,
    packageVersion: inspected.manifest.version,
    publisherId: inspected.manifest.publisher.id,
    license: inspected.manifest.license,
    activatedAt,
    activationRevision,
    previewPlanHash: preview.planHash,
    source: preview.source,
    signer: preview.signer,
    archiveSha256: inspected.archiveSha256,
    manifestSha256: inspected.manifestSha256,
    treeHash: inspected.treeHash,
    contentDirectory: `content/${inspected.treeHash}`,
    ...(storage ? { contentBlobRefId: lapkgContentRefId(inspected.manifest.id, inspected.manifest.version, inspected.treeHash) } : {}),
    resources: inspected.resources,
  };
}

export async function activateLapkg(
  input: ActivateLapkgInput,
  options: {
    now?: Date;
    onPhase?: (phase: LapkgActivationPhase) => void | Promise<void>;
    faultInjectionCrashAfter?: LapkgActivationCrashPoint;
  } = {},
): Promise<ActivatedLapkgResult> {
  const now = options.now ?? new Date();
  if (!isRecord(input) || typeof input.runtimeRoot !== "string" || !isAbsolute(input.runtimeRoot) || !Buffer.isBuffer(input.archiveBytes) ||
    !Array.isArray(input.trustRoots) || !Number.isFinite(now.getTime())) {
    fail("LAPKG_ACTIVATION_INVALID", "Package activation input is invalid.");
  }
  let inspected: InspectedLapkgV1;
  try {
    inspected = await inspectLapkgArchiveBytes(input.archiveBytes);
  } catch (error) {
    if (error instanceof LapkgFormatError || (error instanceof Error && "tarCode" in error)) {
      fail("LAPKG_APPROVAL_INVALID", "The activation archive is not the approved valid Package archive.");
    }
    throw error;
  }
  validateApproval(input, inspected, now);

  const root = lapkgV2Root(input.runtimeRoot);
  const stagingRoot = join(root, ".staging");
  const stage = join(stagingRoot, randomUUID());
  const contentPath = join(root, "content", inspected.treeHash);
  const lockPath = join(root, ".activation-lock");
  await mkdir(root, { recursive: true });
  try {
    if (input.storage) {
      if (await input.storage.readRecoveryBlock()) fail("LAPKG_RECOVERY_BLOCKED", "Package activation is blocked pending explicit recovery.");
      if (await input.storage.readJournal()) fail("LAPKG_RECOVERY_REQUIRED", "An incomplete Package activation must be recovered before another write.");
    } else {
      await assertLapkgActivationWritable(root);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "LAPKG_RECOVERY_REQUIRED") fail("LAPKG_RECOVERY_REQUIRED", error.message);
    if (error instanceof Error && "code" in error && error.code === "LAPKG_RECOVERY_BLOCKED") fail("LAPKG_RECOVERY_BLOCKED", error.message);
    throw error;
  }
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("LAPKG_ACTIVATION_BUSY", "Another v2 Package activation owns the writer lock.");
    throw error;
  }
  let contentPublished = false;
  let registryCommitted = false;
  let simulatedCrash = false;
  let journal: LapkgActivationJournalV1 | null = null;
  const crashAfter = (point: LapkgActivationCrashPoint): void => {
    if (options.faultInjectionCrashAfter === point) {
      simulatedCrash = true;
      throw new LapkgSimulatedCrashError(point);
    }
  };
  try {
    await options.onPhase?.("lock_acquired");
    const storedRegistry = input.storage ? await input.storage.readRegistry() : undefined;
    const registry = storedRegistry?.registry ?? await listActivatedLapkgPackages(input.runtimeRoot);
    if (registry.packages.some((item) => item.packageId === inspected.manifest.id && item.packageVersion === inspected.manifest.version)) {
      fail("LAPKG_PACKAGE_EXISTS", `${inspected.manifest.id}@${inspected.manifest.version} is already active.`);
    }
    const record = toRecord(inspected, input.preview, now.toISOString(), registry.revision + 1, input.storage);
    const next: LapkgRegistryV2 = {
      schemaVersion: 2,
      revision: registry.revision + 1,
      packages: [...registry.packages, record].sort((left, right) => left.packageId.localeCompare(right.packageId) || left.packageVersion.localeCompare(right.packageVersion)),
    };
    const contentExistedBefore = await stat(contentPath).then((info) => info.isDirectory(), (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    journal = {
      schemaVersion: 1,
      activationId: randomUUID(),
      phase: "prepared",
      previousRegistryRevision: registry.revision,
      previousRegistryHash: hashLapkgRegistry(registry),
      targetRegistryRevision: next.revision,
      targetRegistryHash: hashLapkgRegistry(next),
      stageDirectory: relative(root, stage).split(sep).join("/"),
      contentExistedBefore,
      record,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (input.storage) await input.storage.writeJournal(journal);
    else await writeLapkgActivationJournal(root, journal);
    crashAfter("journal_prepared");
    await mkdir(stagingRoot, { recursive: true });
    await extractArchiveBytes(input.archiveBytes, stage);
    await verifyExtractedTree(stage, inspected);
    journal = input.storage
      ? { ...journal, phase: "staging_verified", updatedAt: now.toISOString() }
      : await advanceLapkgActivationJournal(root, journal, "staging_verified", now);
    if (input.storage) await input.storage.writeJournal(journal);
    await options.onPhase?.("staging_verified");
    crashAfter("staging_verified");
    await mkdir(dirname(contentPath), { recursive: true });
    try {
      await rename(stage, contentPath);
      contentPublished = true;
      await makeReadOnly(contentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
      await verifyExtractedTree(contentPath, inspected);
      await rm(stage, { recursive: true, force: true });
    }
    if (input.storage) {
      const resources = await Promise.all(inspected.resources.map(async (resource) => ({
        sha256: resource.sha256,
        bytes: await readFile(join(contentPath, resource.path)),
      })));
      await input.storage.publishContent({
        packageId: inspected.manifest.id,
        packageVersion: inspected.manifest.version,
        treeHash: inspected.treeHash,
        archiveBytes: input.archiveBytes,
        resources,
      });
    }
    journal = input.storage
      ? { ...journal, phase: "content_published", updatedAt: now.toISOString() }
      : await advanceLapkgActivationJournal(root, journal, "content_published", now);
    if (input.storage) await input.storage.writeJournal(journal);
    await options.onPhase?.("content_published");
    crashAfter("content_published");
    await options.onPhase?.("before_registry_commit");
    if (input.storage) {
      await input.storage.writeRegistry({ registry: next, expectedStorageRevision: storedRegistry?.storageRevision ?? 0 });
      registryCommitted = true;
    } else {
      await writeRegistryAtomic(lapkgRegistryPath(input.runtimeRoot), next, () => { registryCommitted = true; });
    }
    crashAfter("registry_renamed");
    journal = input.storage
      ? { ...journal, phase: "registry_committed", updatedAt: now.toISOString() }
      : await advanceLapkgActivationJournal(root, journal, "registry_committed", now);
    if (input.storage) await input.storage.writeJournal(journal);
    await options.onPhase?.("registry_committed");
    crashAfter("registry_committed");
    if (input.storage) await input.storage.removeJournal();
    else await removeLapkgActivationJournal(root);
    journal = null;
    return { ...record, contentPath };
  } finally {
    if (!simulatedCrash) {
      await makeLapkgTreeRemovable(stage);
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
      if (contentPublished && !registryCommitted) {
        await makeLapkgTreeRemovable(contentPath);
        await rm(contentPath, { recursive: true, force: true }).catch(() => undefined);
      }
      if (!registryCommitted && journal) {
        if (input.storage) await input.storage.removeJournal().catch(() => undefined);
        else await removeLapkgActivationJournal(root).catch(() => undefined);
      }
      await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function resolveActivatedLapkgResources(
  runtimeRoot: string,
  options: { storage?: LapkgPackageStorage } = {},
): Promise<{
  packages: ActivatedLapkgRecordV2[];
  extensions: [];
  skills: string[];
  prompts: string[];
  themes: string[];
  glossaries: string[];
  qaProfiles: string[];
  templates: string[];
  formatMappings: string[];
  roleRecipes: string[];
}> {
  const registry = await listActivatedLapkgPackages(runtimeRoot, options);
  const output = {
    packages: registry.packages,
    extensions: [] as [],
    skills: [] as string[],
    prompts: [] as string[],
    themes: [] as string[],
    glossaries: [] as string[],
    qaProfiles: [] as string[],
    templates: [] as string[],
    formatMappings: [] as string[],
    roleRecipes: [] as string[],
  };
  const key: Record<LapkgResourceType, Exclude<keyof typeof output, "extensions" | "packages">> = {
    skill: "skills",
    prompt: "prompts",
    theme: "themes",
    glossary: "glossaries",
    qa_profile: "qaProfiles",
    template: "templates",
    format_mapping: "formatMappings",
    role_recipe: "roleRecipes",
  };
  const root = lapkgV2Root(runtimeRoot);
  for (const pkg of registry.packages) {
    const contentRoot = resolve(root, pkg.contentDirectory);
    for (const resource of pkg.resources) {
      const path = resolve(contentRoot, resource.path);
      const rel = relative(contentRoot, path);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) fail("LAPKG_REGISTRY_INVALID", "A v2 resource escapes its content root.");
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) fail("LAPKG_CONTENT_CHANGED", `Active resource ${resource.id} is missing.`);
      output[key[resource.type]].push(path.split(sep).join(sep));
    }
    await verifyActivatedLapkgContent(contentRoot, pkg);
    if (options.storage) {
      try {
        await options.storage.verifyContent(pkg);
      } catch (error) {
        fail("LAPKG_CONTENT_CHANGED", error instanceof Error ? error.message : "Package content blob verification failed.");
      }
    }
  }
  for (const values of [output.skills, output.prompts, output.themes, output.glossaries, output.qaProfiles, output.templates, output.formatMappings, output.roleRecipes]) values.sort();
  return output;
}
