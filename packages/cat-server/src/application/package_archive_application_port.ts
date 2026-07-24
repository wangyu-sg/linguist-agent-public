import { lstat, readFile } from "node:fs/promises";

const MAX_LAPKG_ARCHIVE_BYTES = 100 * 1024 * 1024;

export class PackageArchiveApplicationError extends Error {
  constructor(public readonly status: 400 | 413, public readonly code: string, message: string) {
    super(message);
    this.name = "PackageArchiveApplicationError";
  }
}

export interface PackageArchiveApplicationPort {
  readLocalArchive(path: string): Promise<Buffer>;
}

/**
 * The Package route validates the user-selected transport field; this port
 * owns the local-file boundary and its stable regular-file/size policy.
 */
export const packageArchiveApplicationPort: PackageArchiveApplicationPort = {
  async readLocalArchive(path: string): Promise<Buffer> {
    const info = await lstat(path).catch(() => {
      throw new PackageArchiveApplicationError(400, "invalid_lapkg_path", "The selected .lapkg could not be read.");
    });
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new PackageArchiveApplicationError(400, "invalid_lapkg_path", "The selected .lapkg must be a regular file, not a link.");
    }
    if (info.size > MAX_LAPKG_ARCHIVE_BYTES) {
      throw new PackageArchiveApplicationError(413, "lapkg_too_large", "The selected .lapkg exceeds the stable Package Center size limit.");
    }
    return readFile(path).catch(() => {
      throw new PackageArchiveApplicationError(400, "invalid_lapkg_path", "The selected .lapkg could not be read.");
    });
  },
};
