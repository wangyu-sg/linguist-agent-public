import { createHash, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const SHA256 = /^[a-f0-9]{64}$/u;
const REF_ID_MAX_BYTES = 512;

export interface ContentBlobStoreAuthority {
  assertOwned(): Promise<void>;
}

export interface ContentBlobRefV1 {
  schemaVersion: 1;
  sha256: string;
  bytes: number;
}

export interface ContentBlobReferenceManifestV1 {
  schemaVersion: 1;
  refId: string;
  revision: number;
  createdAt: string;
  blobs: ContentBlobRefV1[];
  manifestSha256: string;
}

export interface ContentBlobPublishResult {
  status: "published" | "deduplicated";
  ref: ContentBlobRefV1;
}

export interface ContentBlobInspectionV1 {
  blobs: ContentBlobRefV1[];
  references: ContentBlobReferenceManifestV1[];
  orphanBlobs: string[];
  orphanStaging: string[];
  invalidBlobs: string[];
  invalidReferences: string[];
}

export class BlobDigestMismatchError extends Error {
  constructor(readonly expectedSha256: string, readonly actualSha256: string) {
    super(`Content blob SHA-256 ${actualSha256} does not match expected ${expectedSha256}.`);
    this.name = "BlobDigestMismatchError";
  }
}

export class BlobReferenceRevisionConflictError extends Error {
  constructor(readonly refId: string, readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Content blob reference ${refId} revision ${actualRevision} does not match expected ${expectedRevision}.`);
    this.name = "BlobReferenceRevisionConflictError";
  }
}

export class BlobReferenceBusyError extends Error {
  constructor(readonly refId: string) {
    super(`Content blob reference ${refId} is being updated by another writer.`);
    this.name = "BlobReferenceBusyError";
  }
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredSha256(value: string, label: string): string {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function requiredRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("expectedRevision must be a non-negative safe integer.");
  }
  return value;
}

function requiredRefId(value: string): string {
  if (!value || value.includes("\0") || Buffer.byteLength(value, "utf8") > REF_ID_MAX_BYTES) {
    throw new Error("refId must be a non-empty UTF-8 identifier no longer than 512 bytes.");
  }
  return value;
}

function canonicalManifestPayload(manifest: Omit<ContentBlobReferenceManifestV1, "manifestSha256">): string {
  return JSON.stringify(manifest);
}

function sortedRefs(refs: readonly ContentBlobRefV1[]): ContentBlobRefV1[] {
  return [...refs].sort((left, right) => left.sha256.localeCompare(right.sha256));
}

function parseBlobRef(value: unknown, label: string): ContentBlobRefV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["bytes", "schemaVersion", "sha256"])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
  if (row.schemaVersion !== 1 || typeof row.sha256 !== "string" || !SHA256.test(row.sha256)
    || typeof row.bytes !== "number" || !Number.isSafeInteger(row.bytes) || row.bytes < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return { schemaVersion: 1, sha256: row.sha256, bytes: row.bytes };
}

function parseReferenceManifest(value: unknown): ContentBlobReferenceManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Content blob reference manifest is invalid.");
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["blobs", "createdAt", "manifestSha256", "refId", "revision", "schemaVersion"])) {
    throw new Error("Content blob reference manifest has unknown or missing fields.");
  }
  if (row.schemaVersion !== 1 || typeof row.refId !== "string" || typeof row.createdAt !== "string"
    || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Array.isArray(row.blobs)
    || typeof row.manifestSha256 !== "string" || !SHA256.test(row.manifestSha256)) {
    throw new Error("Content blob reference manifest is invalid.");
  }
  const createdAt = new Date(row.createdAt);
  if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== row.createdAt) {
    throw new Error("Content blob reference manifest timestamp is invalid.");
  }
  const refId = requiredRefId(row.refId);
  const revision = row.revision as number;
  const blobs = row.blobs.map((blob, index) => parseBlobRef(blob, `Content blob reference ${refId} blob ${index}`));
  const sorted = sortedRefs(blobs);
  if (new Set(sorted.map((blob) => blob.sha256)).size !== sorted.length
    || JSON.stringify(blobs) !== JSON.stringify(sorted)) {
    throw new Error(`Content blob reference ${refId} blobs must be unique and sorted.`);
  }
  const payload: Omit<ContentBlobReferenceManifestV1, "manifestSha256"> = {
    schemaVersion: 1,
    refId,
    revision,
    createdAt: row.createdAt,
    blobs,
  };
  if (sha256(canonicalManifestPayload(payload)) !== row.manifestSha256) {
    throw new Error(`Content blob reference ${refId} manifest digest is invalid.`);
  }
  return { ...payload, manifestSha256: row.manifestSha256 };
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAtomic(path: string, bytes: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporary, bytes, { encoding: "utf8", mode: 0o600 });
    await syncFile(temporary);
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

async function childNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export class ContentBlobStore {
  readonly #root: string;
  readonly #blobRoot: string;
  readonly #referenceRoot: string;
  readonly #stagingRoot: string;
  readonly #lockRoot: string;
  readonly #authority: ContentBlobStoreAuthority;

  constructor(root: string, options: { authority: ContentBlobStoreAuthority }) {
    if (!root.trim()) throw new Error("Content blob store root is required.");
    this.#root = resolve(root);
    this.#blobRoot = join(this.#root, "blobs", "sha256");
    this.#referenceRoot = join(this.#root, "refs", "sha256");
    this.#stagingRoot = join(this.#root, ".staging");
    this.#lockRoot = join(this.#root, ".locks");
    this.#authority = options.authority;
  }

  pathFor(sha256Value: string): string {
    const digest = requiredSha256(sha256Value, "sha256");
    return join(this.#blobRoot, digest.slice(0, 2), digest);
  }

  referencePathFor(refId: string): string {
    const id = requiredRefId(refId);
    const digest = sha256(id);
    return join(this.#referenceRoot, digest.slice(0, 2), `${digest}.json`);
  }

  async putBytes(
    input: Uint8Array,
    options: { expectedSha256?: string } = {},
  ): Promise<ContentBlobPublishResult> {
    const bytes = Uint8Array.from(input);
    const actualSha256 = sha256(bytes);
    if (options.expectedSha256 !== undefined) {
      const expectedSha256 = requiredSha256(options.expectedSha256, "expectedSha256");
      if (expectedSha256 !== actualSha256) throw new BlobDigestMismatchError(expectedSha256, actualSha256);
    }
    await this.#authority.assertOwned();
    const ref: ContentBlobRefV1 = { schemaVersion: 1, sha256: actualSha256, bytes: bytes.byteLength };
    const destination = this.pathFor(actualSha256);
    const stagingDirectory = join(this.#stagingRoot, randomUUID());
    const stagingPath = join(stagingDirectory, "blob");
    let published = false;
    try {
      await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
      await writeFile(stagingPath, Buffer.from(bytes), { mode: 0o600 });
      await syncFile(stagingPath);
      await chmod(stagingPath, 0o444);
      await this.#authority.assertOwned();
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      try {
        await link(stagingPath, destination);
        published = true;
        await syncDirectory(dirname(destination));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await this.#verifyBlobPath(destination, ref);
      }
      await this.#authority.assertOwned();
      return { status: published ? "published" : "deduplicated", ref };
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  async readBytes(refOrSha256: ContentBlobRefV1 | string): Promise<Buffer> {
    const ref = typeof refOrSha256 === "string"
      ? { schemaVersion: 1 as const, sha256: requiredSha256(refOrSha256, "sha256"), bytes: -1 }
      : parseBlobRef(refOrSha256, "Content blob reference");
    const path = this.pathFor(ref.sha256);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Content blob ${ref.sha256} is not a regular file.`);
    const bytes = await readFile(path);
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== ref.sha256 || (ref.bytes >= 0 && bytes.byteLength !== ref.bytes)) {
      throw new Error(`Content blob ${ref.sha256} failed integrity verification.`);
    }
    return bytes;
  }

  async publishReference(input: {
    refId: string;
    expectedRevision: number;
    blobs: readonly ContentBlobRefV1[];
    now?: () => Date;
  }): Promise<ContentBlobReferenceManifestV1> {
    const refId = requiredRefId(input.refId);
    const expectedRevision = requiredRevision(input.expectedRevision);
    const blobs = sortedRefs(input.blobs.map((blob, index) => parseBlobRef(blob, `Content blob reference ${refId} blob ${index}`)));
    if (new Set(blobs.map((blob) => blob.sha256)).size !== blobs.length) {
      throw new Error(`Content blob reference ${refId} contains duplicate blobs.`);
    }
    const path = this.referencePathFor(refId);
    const lockPath = join(this.#lockRoot, `${sha256(refId)}.lock`);
    await this.#authority.assertOwned();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await mkdir(this.#lockRoot, { recursive: true, mode: 0o700 });
    let lock;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new BlobReferenceBusyError(refId);
      throw error;
    }
    try {
      const current = await this.readReference(refId);
      const actualRevision = current?.revision ?? 0;
      if (actualRevision !== expectedRevision) {
        throw new BlobReferenceRevisionConflictError(refId, expectedRevision, actualRevision);
      }
      for (const blob of blobs) await this.readBytes(blob);
      const payload: Omit<ContentBlobReferenceManifestV1, "manifestSha256"> = {
        schemaVersion: 1,
        refId,
        revision: expectedRevision + 1,
        createdAt: (input.now?.() ?? new Date()).toISOString(),
        blobs,
      };
      const manifest: ContentBlobReferenceManifestV1 = {
        ...payload,
        manifestSha256: sha256(canonicalManifestPayload(payload)),
      };
      await this.#authority.assertOwned();
      await writeAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);
      await this.#authority.assertOwned();
      return manifest;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
      await syncDirectory(this.#lockRoot);
    }
  }

  async readReference(refId: string): Promise<ContentBlobReferenceManifestV1 | null> {
    const path = this.referencePathFor(refId);
    try {
      return parseReferenceManifest(JSON.parse(await readFile(path, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async inspect(): Promise<ContentBlobInspectionV1> {
    const blobs: ContentBlobRefV1[] = [];
    const invalidBlobs: string[] = [];
    for (const prefix of await childNames(this.#blobRoot)) {
      for (const name of await childNames(join(this.#blobRoot, prefix))) {
        const path = join(this.#blobRoot, prefix, name);
        if (prefix.length !== 2 || !SHA256.test(name)) {
          invalidBlobs.push(relative(this.#root, path));
          continue;
        }
        try {
          const bytes = await this.readBytes(name);
          blobs.push({ schemaVersion: 1, sha256: name, bytes: bytes.byteLength });
        } catch {
          invalidBlobs.push(relative(this.#root, path));
        }
      }
    }
    const references: ContentBlobReferenceManifestV1[] = [];
    const invalidReferences: string[] = [];
    for (const prefix of await childNames(this.#referenceRoot)) {
      for (const name of await childNames(join(this.#referenceRoot, prefix))) {
        const path = join(this.#referenceRoot, prefix, name);
        try {
          references.push(parseReferenceManifest(JSON.parse(await readFile(path, "utf8")) as unknown));
        } catch {
          invalidReferences.push(relative(this.#root, path));
        }
      }
    }
    const referenced = new Set(references.flatMap((reference) => reference.blobs.map((blob) => blob.sha256)));
    for (const reference of references) {
      if (reference.blobs.some((blob) => !blobs.some((stored) => stored.sha256 === blob.sha256))) {
        invalidReferences.push(reference.refId);
      }
    }
    return {
      blobs: blobs.sort((left, right) => left.sha256.localeCompare(right.sha256)),
      references: references.sort((left, right) => left.refId.localeCompare(right.refId)),
      orphanBlobs: blobs.map((blob) => blob.sha256).filter((digest) => !referenced.has(digest)),
      orphanStaging: await childNames(this.#stagingRoot),
      invalidBlobs: invalidBlobs.sort(),
      invalidReferences: [...new Set(invalidReferences)].sort(),
    };
  }

  async recover(options: { pruneStaging?: boolean } = {}): Promise<ContentBlobInspectionV1> {
    const report = await this.inspect();
    if (options.pruneStaging) {
      for (const entry of report.orphanStaging) await rm(join(this.#stagingRoot, entry), { recursive: true, force: true });
      await syncDirectory(this.#stagingRoot).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return report;
  }

  async #verifyBlobPath(path: string, ref: ContentBlobRefV1): Promise<void> {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Content blob ${ref.sha256} is not a regular file.`);
    const bytes = await readFile(path);
    if (bytes.byteLength !== ref.bytes || sha256(bytes) !== ref.sha256) {
      throw new Error(`Content blob ${ref.sha256} failed deduplication integrity verification.`);
    }
  }
}
