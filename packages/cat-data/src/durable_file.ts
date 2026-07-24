import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export type DurableFileFaultPoint =
  | "before_write"
  | "after_write"
  | "after_file_sync"
  | "before_rename"
  | "after_rename"
  | "after_parent_sync";

interface DurableFileOptions {
  faultInjection?: (point: DurableFileFaultPoint) => void;
}

export async function syncParentDirectory(path: string, options: DurableFileOptions = {}): Promise<void> {
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
    options.faultInjection?.("after_parent_sync");
  } finally {
    await directory.close();
  }
}

export async function writeDurableFileAtomic(
  path: string,
  data: string | Uint8Array,
  options: DurableFileOptions = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      options.faultInjection?.("before_write");
      await handle.writeFile(data);
      options.faultInjection?.("after_write");
      await handle.sync();
      options.faultInjection?.("after_file_sync");
    } finally {
      await handle.close();
    }
    options.faultInjection?.("before_rename");
    await rename(temporary, path);
    options.faultInjection?.("after_rename");
    await syncParentDirectory(path, options);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function appendDurableFile(
  path: string,
  data: string | Uint8Array,
  options: DurableFileOptions = {},
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a", 0o600);
  try {
    options.faultInjection?.("before_write");
    await handle.writeFile(data);
    options.faultInjection?.("after_write");
    await handle.sync();
    options.faultInjection?.("after_file_sync");
  } finally {
    await handle.close();
  }
  await syncParentDirectory(path, options);
}
