import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Fingerprint one selected Task Package resource without following symlinks.
 * The same function is used when the profile is resolved and immediately
 * before a Team child loads the resource, so approval and execution compare
 * the same recursive byte graph.
 */
export async function hashTaskPackageResource(path: string): Promise<string> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not valid Task Package resources: ${path}`);
  if (info.isFile()) {
    const hash = createHash("sha256");
    hash.update(await readFile(path));
    return `sha256-${hash.digest("base64")}`;
  }
  if (!info.isDirectory()) {
    const hash = createHash("sha256");
    hash.update(`${info.mode}:${info.size}:${info.mtimeMs}`);
    return `sha256-${hash.digest("base64")}`;
  }

  const hash = createHash("sha256");
  const names = (await readdir(path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  for (const item of names) {
    const childPath = resolve(path, item.name);
    const childInfo = await lstat(childPath);
    if (childInfo.isSymbolicLink()) throw new Error(`Symbolic links are not valid Task Package resources: ${childPath}`);
    hash.update(item.name);
    if (childInfo.isDirectory()) {
      hash.update("directory\0");
      hash.update(await hashTaskPackageResource(childPath));
    } else if (childInfo.isFile()) {
      hash.update("file\0");
      hash.update(await readFile(childPath));
    } else {
      hash.update("other\0");
      hash.update(`${childInfo.mode}:${childInfo.size}:${childInfo.mtimeMs}`);
    }
  }
  return `sha256-${hash.digest("base64")}`;
}
