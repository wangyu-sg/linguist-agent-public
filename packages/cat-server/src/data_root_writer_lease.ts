import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DataRootWriterLeaseErrorCode =
  | "DATA_ROOT_WRITER_LEASE_HELD"
  | "DATA_ROOT_WRITER_LEASE_AMBIGUOUS"
  | "DATA_ROOT_WRITER_LEASE_LOST"
  | "DATA_ROOT_WRITER_LEASE_INVALID";

export class DataRootWriterLeaseError extends Error {
  constructor(public readonly code: DataRootWriterLeaseErrorCode, message: string) {
    super(message);
    this.name = "DataRootWriterLeaseError";
  }
}

export interface DataRootWriterLeaseOwnerV1 {
  schemaVersion: 1;
  pid: number;
  nonce: string;
  processStartedAt: string;
  productVersion: string;
}

export interface DataRootWriterLease {
  owner: DataRootWriterLeaseOwnerV1;
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

interface AcquireOptions {
  pid?: number;
  now?: Date;
  productVersion: string;
  isProcessAlive?: (pid: number) => boolean;
}

function leaseDirectory(runtimeRoot: string): string {
  // Keep ownership metadata beside data/, not inside it: schema migrations
  // atomically exchange the data directory and must not move the live lease.
  return join(runtimeRoot, ".data-root-writer-lease");
}

export function dataRootWriterLeaseOwnerPath(runtimeRoot: string): string {
  return join(leaseDirectory(runtimeRoot), "owner-v1.json");
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function parseOwner(value: unknown): DataRootWriterLeaseOwnerV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.pid) || Number(record.pid) < 1 ||
    typeof record.nonce !== "string" || !/^[0-9a-f-]{36}$/u.test(record.nonce) ||
    typeof record.processStartedAt !== "string" || !Number.isFinite(Date.parse(record.processStartedAt)) ||
    new Date(Date.parse(record.processStartedAt)).toISOString() !== record.processStartedAt ||
    typeof record.productVersion !== "string" || !record.productVersion.trim() || record.productVersion.length > 128) return null;
  return {
    schemaVersion: 1,
    pid: Number(record.pid),
    nonce: record.nonce,
    processStartedAt: record.processStartedAt,
    productVersion: record.productVersion,
  };
}

async function readOwner(runtimeRoot: string): Promise<DataRootWriterLeaseOwnerV1 | null> {
  try {
    return parseOwner(JSON.parse(await readFile(dataRootWriterLeaseOwnerPath(runtimeRoot), "utf8")) as unknown);
  } catch {
    return null;
  }
}

function sameOwner(left: DataRootWriterLeaseOwnerV1 | null, right: DataRootWriterLeaseOwnerV1): boolean {
  return Boolean(left && left.pid === right.pid && left.nonce === right.nonce &&
    left.processStartedAt === right.processStartedAt && left.productVersion === right.productVersion);
}

/**
 * Acquires the single writer authority for a runtime data root. A live PID
 * always blocks takeover, including a possible PID-reuse case. Only an owner
 * whose PID is provably absent may be replaced; malformed state fails closed.
 */
export async function acquireDataRootWriterLease(
  runtimeRoot: string,
  options: AcquireOptions,
): Promise<DataRootWriterLease> {
  const pid = options.pid ?? process.pid;
  const now = options.now ?? new Date();
  if (!Number.isSafeInteger(pid) || pid < 1 || !Number.isFinite(now.getTime()) ||
    !options.productVersion.trim() || options.productVersion.length > 128) {
    throw new DataRootWriterLeaseError("DATA_ROOT_WRITER_LEASE_INVALID", "Data root writer lease input is invalid.");
  }

  const directory = leaseDirectory(runtimeRoot);
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await mkdir(directory, { mode: 0o700 });
      const owner: DataRootWriterLeaseOwnerV1 = {
        schemaVersion: 1,
        pid,
        nonce: randomUUID(),
        processStartedAt: now.toISOString(),
        productVersion: options.productVersion,
      };
      try {
        await writeFile(dataRootWriterLeaseOwnerPath(runtimeRoot), `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      const assertOwned = async (): Promise<void> => {
        if (!sameOwner(await readOwner(runtimeRoot), owner)) {
          throw new DataRootWriterLeaseError("DATA_ROOT_WRITER_LEASE_LOST", "The runtime no longer owns the data root writer lease.");
        }
      };
      return {
        owner,
        assertOwned,
        release: async () => {
          await assertOwned();
          await rm(directory, { recursive: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readOwner(runtimeRoot);
      if (!existing) {
        throw new DataRootWriterLeaseError("DATA_ROOT_WRITER_LEASE_AMBIGUOUS", "The data root has an ambiguous writer lease owner.");
      }
      if ((options.isProcessAlive ?? processAlive)(existing.pid)) {
        throw new DataRootWriterLeaseError("DATA_ROOT_WRITER_LEASE_HELD", `Process ${existing.pid} already owns the data root.`);
      }
      await rm(directory, { recursive: true });
    }
  }
  throw new DataRootWriterLeaseError("DATA_ROOT_WRITER_LEASE_HELD", "The data root writer lease could not be acquired deterministically.");
}
