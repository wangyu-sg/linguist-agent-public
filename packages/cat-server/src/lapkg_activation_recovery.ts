import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  hashLapkgRegistry,
  lapkgV2Root,
  listActivatedLapkgPackages,
  makeLapkgTreeRemovable,
  verifyActivatedLapkgContent,
  type ActivatedLapkgRecordV2,
} from "./lapkg_activation.js";
import {
  journalPath,
  readLapkgActivationJournal,
  recoveryBlockedPath,
  removeLapkgActivationJournal,
  removeLapkgRecoveryBlocked,
  writeLapkgRecoveryBlocked,
  type LapkgActivationJournalV1,
} from "./lapkg_activation_journal.js";
import type { LapkgPackageStorage } from "./lapkg_package_storage.js";

export type LapkgRecoveryStatus = "clean" | "rolled_back" | "finalized" | "blocked";

export interface LapkgActivationRecoveryReportV1 {
  schemaVersion: 1;
  status: LapkgRecoveryStatus;
  activationId: string | null;
  reason: string;
  removedOrphanStaging: number;
  recoveredAt: string;
}

export class LapkgRecoveryError extends Error {
  constructor(
    public readonly code: "LAPKG_RECOVERY_EXCLUSIVE_REQUIRED" | "LAPKG_RECOVERY_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "LapkgRecoveryError";
  }
}

function recordHash(record: ActivatedLapkgRecordV2): string {
  const registry = { schemaVersion: 2 as const, revision: record.activationRevision, packages: [record] };
  return hashLapkgRegistry(registry);
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

function safeChild(root: string, relativePath: string): string {
  const candidate = resolve(root, relativePath);
  const rel = relative(resolve(root), candidate);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new LapkgRecoveryError("LAPKG_RECOVERY_INVALID", "Recovery state escapes the v2 Package root.");
  return candidate;
}

async function removeTree(path: string): Promise<void> {
  await makeLapkgTreeRemovable(path);
  await rm(path, { recursive: true, force: true });
}

async function removeKnownOrphanStaging(root: string, preserve?: string): Promise<number> {
  const stagingRoot = join(root, ".staging");
  const entries = await readdir(stagingRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  let removed = 0;
  for (const entry of entries) {
    const rel = `.staging/${entry.name}`;
    if (rel === preserve) continue;
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/u.test(entry.name)) {
      throw new LapkgRecoveryError("LAPKG_RECOVERY_INVALID", "The staging root contains an unknown entry.");
    }
    await removeTree(join(stagingRoot, entry.name));
    removed += 1;
  }
  return removed;
}

async function cleanupRecoveredState(root: string, journal: LapkgActivationJournalV1, storage?: LapkgPackageStorage): Promise<number> {
  const stage = safeChild(root, journal.stageDirectory);
  if (await exists(stage)) await removeTree(stage);
  const removedOrphanStaging = await removeKnownOrphanStaging(root);
  if (storage) await storage.removeJournal();
  else await removeLapkgActivationJournal(root);
  await rm(join(root, ".activation-lock"), { recursive: true, force: true });
  if (storage) await storage.removeRecoveryBlock();
  else await removeLapkgRecoveryBlocked(root);
  return removedOrphanStaging;
}

async function block(
  root: string,
  journal: LapkgActivationJournalV1 | null,
  reason: string,
  now: Date,
  storage?: LapkgPackageStorage,
): Promise<LapkgActivationRecoveryReportV1> {
  const value = {
    schemaVersion: 1,
    activationId: journal?.activationId ?? null,
    reason,
    blockedAt: now.toISOString(),
  } as const;
  if (storage) await storage.writeRecoveryBlock(value);
  else await writeLapkgRecoveryBlocked(root, value);
  return {
    schemaVersion: 1,
    status: "blocked",
    activationId: journal?.activationId ?? null,
    reason,
    removedOrphanStaging: 0,
    recoveredAt: now.toISOString(),
  };
}

function exactRecordMatches(left: ActivatedLapkgRecordV2, right: ActivatedLapkgRecordV2): boolean {
  return recordHash(left) === recordHash(right);
}

export async function recoverLapkgActivation(
  runtimeRoot: string,
  options: {
    exclusiveStartup: boolean;
    now?: Date;
    onBeforeRollbackRemove?: () => void | Promise<void>;
    storage?: LapkgPackageStorage;
  },
): Promise<LapkgActivationRecoveryReportV1> {
  if (options.exclusiveStartup !== true) {
    throw new LapkgRecoveryError("LAPKG_RECOVERY_EXCLUSIVE_REQUIRED", "Recovery requires exclusive startup ownership before routes or Package writers start.");
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new LapkgRecoveryError("LAPKG_RECOVERY_INVALID", "Recovery time is invalid.");
  const root = lapkgV2Root(runtimeRoot);
  const existingBlock = options.storage ? await options.storage.readRecoveryBlock() : await exists(recoveryBlockedPath(root));
  if (existingBlock) {
    return {
      schemaVersion: 1,
      status: "blocked",
      activationId: null,
      reason: "existing_recovery_block",
      removedOrphanStaging: 0,
      recoveredAt: now.toISOString(),
    };
  }

  let journal: LapkgActivationJournalV1 | null;
  try {
    journal = options.storage ? await options.storage.readJournal() : await readLapkgActivationJournal(root);
  } catch {
    return block(root, null, "journal_invalid", now, options.storage);
  }
  if (!journal) {
    try {
      const removedOrphanStaging = await removeKnownOrphanStaging(root);
      await rm(join(root, ".activation-lock"), { recursive: true, force: true });
      return {
        schemaVersion: 1,
        status: "clean",
        activationId: null,
        reason: removedOrphanStaging > 0 ? "orphan_staging_removed" : "no_incomplete_activation",
        removedOrphanStaging,
        recoveredAt: now.toISOString(),
      };
    } catch {
      return block(root, null, "orphan_staging_cleanup_failed", now, options.storage);
    }
  }

  let registry;
  try {
    registry = await listActivatedLapkgPackages(runtimeRoot, { storage: options.storage });
  } catch {
    return block(root, journal, "registry_invalid", now, options.storage);
  }
  const identityMatches = registry.packages.filter((item) =>
    item.packageId === journal.record.packageId && item.packageVersion === journal.record.packageVersion);
  const contentPath = safeChild(root, journal.record.contentDirectory);

  if (registry.revision === journal.targetRegistryRevision && hashLapkgRegistry(registry) === journal.targetRegistryHash &&
    identityMatches.length === 1 && exactRecordMatches(identityMatches[0]!, journal.record)) {
    try {
      await verifyActivatedLapkgContent(contentPath, journal.record);
      if (options.storage) await options.storage.verifyContent(journal.record);
      const removedOrphanStaging = await cleanupRecoveredState(root, journal, options.storage);
      return {
        schemaVersion: 1,
        status: "finalized",
        activationId: journal.activationId,
        reason: "target_registry_and_content_verified",
        removedOrphanStaging,
        recoveredAt: now.toISOString(),
      };
    } catch {
      return block(root, journal, "committed_content_invalid", now, options.storage);
    }
  }

  if (registry.revision === journal.previousRegistryRevision && hashLapkgRegistry(registry) === journal.previousRegistryHash && identityMatches.length === 0) {
    try {
      if (await exists(contentPath)) {
        if (journal.contentExistedBefore) await verifyActivatedLapkgContent(contentPath, journal.record);
        else {
          await options.onBeforeRollbackRemove?.();
          await removeTree(contentPath);
        }
      }
      const removedOrphanStaging = await cleanupRecoveredState(root, journal, options.storage);
      return {
        schemaVersion: 1,
        status: "rolled_back",
        activationId: journal.activationId,
        reason: "previous_registry_verified",
        removedOrphanStaging,
        recoveredAt: now.toISOString(),
      };
    } catch {
      return block(root, journal, "rollback_failed", now, options.storage);
    }
  }

  return block(root, journal, "registry_revision_or_hash_ambiguous", now, options.storage);
}

export async function readLapkgRecoveryBlock(runtimeRoot: string, options: { storage?: LapkgPackageStorage } = {}): Promise<unknown | null> {
  if (options.storage) return options.storage.readRecoveryBlock();
  const path = recoveryBlockedPath(lapkgV2Root(runtimeRoot));
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export { journalPath };
