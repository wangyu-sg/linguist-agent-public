import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface CatWorkspace {
  root: string;
  projectId: string;
}

export function createWorkspace(root: string, projectId = "demo"): CatWorkspace {
  return {
    root: resolve(root),
    projectId,
  };
}

export function workspacePath(workspace: CatWorkspace, ...parts: string[]): string {
  return join(workspace.root, "data", "projects", workspace.projectId, ...parts);
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    // A torn/corrupt file must never be silently replaced by fallback data:
    // preserve the raw payload, then surface the failure.
    const backupPath = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    let backupNote = "";
    try {
      await writeFile(backupPath, raw, "utf8");
      backupNote = ` (raw content preserved at ${backupPath})`;
    } catch {
      backupNote = "";
    }
    throw new Error(`Invalid JSON in ${path}${backupNote}: ${(error as Error).message}`);
  }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Write-then-rename keeps the previous file intact if the process dies mid-write.
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmpPath, path);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

export async function readJsonlFile<T>(path: string): Promise<T[]> {
  try {
    const raw = await readFile(path, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    const rows: T[] = [];
    for (const [index, line] of lines.entries()) {
      try {
        rows.push(JSON.parse(line) as T);
      } catch (error) {
        // Only a torn trailing line (crash mid-append) is tolerated; corruption
        // anywhere else still fails loudly.
        if (index === lines.length - 1) continue;
        throw new Error(`Invalid JSONL in ${path} at line ${index + 1}: ${(error as Error).message}`);
      }
    }
    return rows;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
