import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  ActivatedLapkgRecordV2,
  LapkgRegistryV2,
} from "./lapkg_activation.js";
import type {
  LapkgActivationJournalV1,
  LapkgRecoveryBlockedV1,
} from "./lapkg_activation_journal.js";

export interface LapkgPackageStorageAuthority {
  assertOwned(): Promise<void>;
}

export interface LapkgPackageContentResource {
  sha256: string;
  bytes: Uint8Array;
}

export interface LapkgPackageContentInspection {
  blobs: Array<{ schemaVersion: 1; sha256: string; bytes: number }>;
  references: Array<{
    schemaVersion: 1;
    refId: string;
    revision: number;
    createdAt: string;
    blobs: Array<{ schemaVersion: 1; sha256: string; bytes: number }>;
    manifestSha256: string;
  }>;
  orphanBlobs: string[];
  orphanStaging: string[];
  invalidBlobs: string[];
  invalidReferences: string[];
}

export interface LapkgPackageStorage {
  readRegistry(): Promise<{
    registry: LapkgRegistryV2;
    storageRevision: number;
  }>;
  initializeRegistry(registry: LapkgRegistryV2): Promise<void>;
  writeRegistry(input: {
    registry: LapkgRegistryV2;
    expectedStorageRevision: number;
  }): Promise<void>;
  readJournal(): Promise<LapkgActivationJournalV1 | null>;
  writeJournal(journal: LapkgActivationJournalV1): Promise<void>;
  removeJournal(): Promise<void>;
  readRecoveryBlock(): Promise<LapkgRecoveryBlockedV1 | null>;
  writeRecoveryBlock(value: LapkgRecoveryBlockedV1): Promise<void>;
  removeRecoveryBlock(): Promise<void>;
  publishContent(input: {
    packageId: string;
    packageVersion: string;
    treeHash: string;
    archiveBytes?: Uint8Array;
    resources: readonly LapkgPackageContentResource[];
  }): Promise<{ refId: string }>;
  verifyContent(record: ActivatedLapkgRecordV2): Promise<void>;
  inspectContent(): Promise<LapkgPackageContentInspection>;
  close(): void;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function lapkgContentRefId(
  packageId: string,
  packageVersion: string,
  treeHash: string,
): string {
  return `lapkg:${digest(`${packageId}\0${packageVersion}\0${treeHash}`)}`;
}

export function lapkgSqliteStorageRoot(repoRoot: string): string {
  return join(repoRoot, "data", "runtime", "package-registry-sqlite-v1");
}

export function lapkgSqliteMarkerPath(repoRoot: string): string {
  return join(lapkgSqliteStorageRoot(repoRoot), "authority-v1.json");
}
