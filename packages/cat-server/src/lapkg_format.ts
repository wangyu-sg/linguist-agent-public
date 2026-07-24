import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import * as tar from "tar";

export const LAPKG_RESOURCE_TYPES = [
  "skill",
  "prompt",
  "theme",
  "glossary",
  "qa_profile",
  "template",
  "format_mapping",
  "role_recipe",
] as const;

export type LapkgResourceType = typeof LAPKG_RESOURCE_TYPES[number];

export interface LapkgResourceV1 {
  id: string;
  type: LapkgResourceType;
  path: string;
  sha256: string;
  mediaType?: string;
}

export interface LapkgManifestV1 {
  schemaVersion: 1;
  id: string;
  version: string;
  publisher: {
    id: string;
    name?: string;
  };
  license: string;
  resources: LapkgResourceV1[];
  signature: {
    algorithm: "ed25519";
    keyId: string;
    value: string;
  };
}

export interface InspectedLapkgV1 {
  manifest: LapkgManifestV1;
  manifestSha256: string;
  archiveSha256: string;
  treeHash: string;
  totalResourceBytes: number;
  resources: Array<LapkgResourceV1 & { size: number }>;
}

export interface LapkgFormatLimits {
  maxArchiveBytes: number;
  maxResourceBytes: number;
  maxFileBytes: number;
  maxFiles: number;
  maxPathBytes: number;
  maxPathDepth: number;
}

export const DEFAULT_LAPKG_FORMAT_LIMITS: Readonly<LapkgFormatLimits> = Object.freeze({
  maxArchiveBytes: 25 * 1024 * 1024,
  maxResourceBytes: 50 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxFiles: 2_000,
  maxPathBytes: 512,
  maxPathDepth: 16,
});

export class LapkgFormatError extends Error {
  readonly code = "LAPKG_FORMAT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "LapkgFormatError";
  }
}

interface ArchiveFile {
  path: string;
  bytes: Buffer;
  sha256: string;
  size: number;
}

const RESOURCE_TYPE_SET = new Set<string>(LAPKG_RESOURCE_TYPES);
const EXECUTABLE_EXTENSIONS = new Set([
  ".app", ".bat", ".bash", ".bin", ".cjs", ".class", ".cmd", ".command",
  ".dll", ".dylib", ".exe", ".fish", ".jar", ".js", ".jsx", ".mjs",
  ".node", ".php", ".pl", ".ps1", ".py", ".rb", ".sh", ".so", ".ts",
  ".tsx", ".wasm", ".zsh",
]);
const JSON_RESOURCE_TYPES = new Set<LapkgResourceType>(["theme", "format_mapping", "role_recipe"]);
const RESOURCE_EXTENSIONS: Readonly<Record<LapkgResourceType, ReadonlySet<string>>> = {
  skill: new Set([".md"]),
  prompt: new Set([".md"]),
  theme: new Set([".json"]),
  glossary: new Set([".csv", ".json", ".tbx", ".tmx", ".tsv", ".txt"]),
  qa_profile: new Set([".json", ".yaml", ".yml"]),
  template: new Set([".csv", ".json", ".md", ".tsv", ".txt", ".yaml", ".yml"]),
  format_mapping: new Set([".json"]),
  role_recipe: new Set([".json"]),
};
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const PACKAGE_MANAGER_PATHS = new Set(["node_modules", "package.json", "package-lock.json", "npm-shrinkwrap.json"]);

function invalid(message: string): never {
  throw new LapkgFormatError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) invalid(`Unknown ${label} field ${unknown[0]}.`);
}

function requiredString(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > maximum) {
    invalid(`${label} must be a non-empty bounded string without surrounding whitespace.`);
  }
  return value;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveLimits(input: Partial<LapkgFormatLimits>): LapkgFormatLimits {
  const limit = (key: keyof LapkgFormatLimits): number => {
    const value = input[key] ?? DEFAULT_LAPKG_FORMAT_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1) invalid(`Invalid ${key} limit.`);
    return Math.min(value, DEFAULT_LAPKG_FORMAT_LIMITS[key]);
  };
  return {
    maxArchiveBytes: limit("maxArchiveBytes"),
    maxResourceBytes: limit("maxResourceBytes"),
    maxFileBytes: limit("maxFileBytes"),
    maxFiles: limit("maxFiles"),
    maxPathBytes: limit("maxPathBytes"),
    maxPathDepth: limit("maxPathDepth"),
  };
}

function portablePathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function validatePortablePath(path: string, limits: LapkgFormatLimits, label: string): void {
  if (!path || isAbsolute(path) || path.includes("\\") || path.includes("\0") ||
    Buffer.byteLength(path) > limits.maxPathBytes) {
    invalid(`Invalid ${label}: path must be relative and portable.`);
  }
  const parts = path.split("/");
  if (parts.length > limits.maxPathDepth || parts.some((part) =>
    !part || part === "." || part === ".." || /[\u0000-\u001f:]/u.test(part) ||
    part.startsWith(".") || /[. ]$/u.test(part) || WINDOWS_RESERVED.test(part) ||
    PACKAGE_MANAGER_PATHS.has(part.toLowerCase()))) {
    invalid(`Invalid ${label}: path contains a forbidden or non-portable segment.`);
  }
}

function parseManifest(value: unknown, limits: LapkgFormatLimits): LapkgManifestV1 {
  if (!isRecord(value)) invalid("lapkg.json must contain an object.");
  exactKeys(value, ["schemaVersion", "id", "version", "publisher", "license", "resources", "signature"], "manifest");
  if (value.schemaVersion !== 1) invalid("Only .lapkg schemaVersion 1 is supported.");
  const id = requiredString(value.id, "Package id", 128);
  if (!/^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/u.test(id)) invalid("Package id must be a lowercase dotted identifier.");
  const version = requiredString(value.version, "Package version", 128);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)) invalid("Package version must be exact SemVer.");

  if (!isRecord(value.publisher)) invalid("publisher must be an object.");
  exactKeys(value.publisher, ["id", "name"], "publisher");
  const publisherId = requiredString(value.publisher.id, "Publisher id", 128);
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(publisherId)) invalid("Publisher id is invalid.");
  const publisherName = value.publisher.name === undefined ? undefined : requiredString(value.publisher.name, "Publisher name", 256);
  const license = requiredString(value.license, "License", 128);

  if (!Array.isArray(value.resources) || value.resources.length === 0 || value.resources.length > limits.maxFiles) {
    invalid("resources must be a non-empty bounded array.");
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  const resources = value.resources.map((item, index): LapkgResourceV1 => {
    if (!isRecord(item)) invalid(`Resource ${index} must be an object.`);
    exactKeys(item, ["id", "type", "path", "sha256", "mediaType"], "resource");
    const resourceId = requiredString(item.id, `Resource ${index} id`, 128);
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(resourceId)) invalid(`Resource ${index} id is invalid.`);
    if (ids.has(resourceId)) invalid(`Duplicate resource id ${resourceId}.`);
    ids.add(resourceId);
    if (typeof item.type !== "string" || !RESOURCE_TYPE_SET.has(item.type)) invalid(`Unsupported resource type ${String(item.type)}.`);
    const type = item.type as LapkgResourceType;
    const path = requiredString(item.path, `Resource ${resourceId} path`, limits.maxPathBytes);
    validatePortablePath(path, limits, "resource path");
    if (!path.startsWith("resources/")) invalid(`Invalid resource path ${path}: resources must stay below resources/.`);
    const portableKey = portablePathKey(path);
    if (paths.has(portableKey)) invalid(`Portable path collision for ${path}.`);
    paths.add(portableKey);
    if (path.normalize("NFC") !== path) invalid(`Invalid resource path ${path}: path must be NFC-normalized.`);
    const extension = extname(path).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(extension)) invalid(`Executable resource path ${path} is forbidden.`);
    if (!RESOURCE_EXTENSIONS[type].has(extension)) invalid(`Resource ${resourceId} has an unsupported file extension for ${type}.`);
    if (type === "skill" && !path.endsWith("/SKILL.md")) invalid(`Skill resource ${resourceId} must end in /SKILL.md.`);
    const resourceSha256 = requiredString(item.sha256, `Resource ${resourceId} sha256`, 64);
    if (!/^[a-f0-9]{64}$/u.test(resourceSha256)) invalid(`Resource ${resourceId} sha256 is invalid.`);
    const mediaType = item.mediaType === undefined ? undefined : requiredString(item.mediaType, `Resource ${resourceId} mediaType`, 128);
    return { id: resourceId, type, path, sha256: resourceSha256, ...(mediaType === undefined ? {} : { mediaType }) };
  });

  if (!isRecord(value.signature)) invalid("signature must be an object.");
  exactKeys(value.signature, ["algorithm", "keyId", "value"], "signature");
  if (value.signature.algorithm !== "ed25519") invalid("Only ed25519 signatures are supported.");
  const keyId = requiredString(value.signature.keyId, "Signature keyId", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(keyId)) invalid("Signature keyId is invalid.");
  const signatureValue = requiredString(value.signature.value, "Signature value", 256);
  const decodedSignature = Buffer.from(signatureValue, "base64");
  if (decodedSignature.length !== 64 || decodedSignature.toString("base64") !== signatureValue) {
    invalid("Signature value must be one canonical 64-byte Ed25519 signature.");
  }
  return {
    schemaVersion: 1,
    id,
    version,
    publisher: { id: publisherId, ...(publisherName === undefined ? {} : { name: publisherName }) },
    license,
    resources,
    signature: { algorithm: "ed25519", keyId, value: signatureValue },
  };
}

function validateResourceText(resource: LapkgResourceV1, bytes: Buffer): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid(`Resource ${resource.id} is not valid UTF-8 text.`);
  }
  if (text.includes("\0")) invalid(`Resource ${resource.id} contains a NUL byte.`);
  if (/^\uFEFF?#!/u.test(text)) invalid(`Resource ${resource.id} contains an executable shebang.`);
  if (JSON_RESOURCE_TYPES.has(resource.type) || resource.path.toLowerCase().endsWith(".json")) {
    try {
      JSON.parse(text);
    } catch {
      invalid(`Resource ${resource.id} must contain valid JSON.`);
    }
  }
}

async function readArchiveFiles(archiveBytes: Buffer, limits: LapkgFormatLimits): Promise<Map<string, ArchiveFile>> {
  const files = new Map<string, ArchiveFile>();
  const portablePaths = new Set<string>();
  const pending: Promise<void>[] = [];
  let entries = 0;
  let declaredBytes = 0;
  let validationError: unknown;
  const parser = tar.t({
    strict: true,
    noResume: true,
    onentry(entry) {
      if (validationError !== undefined) {
        entry.resume();
        return;
      }
      try {
        entries += 1;
        if (entries > limits.maxFiles + 1) invalid("The .lapkg archive exceeds the file count limit.");
        const directory = entry.type === "Directory";
        const path = directory && entry.path.endsWith("/") ? entry.path.slice(0, -1) : entry.path;
        validatePortablePath(path, limits, "archive path");
        const portableKey = portablePathKey(path);
        if (portablePaths.has(portableKey)) invalid(`Portable path collision for archive entry ${path}.`);
        portablePaths.add(portableKey);
        if (path.normalize("NFC") !== path) invalid(`Invalid archive path ${path}: path must be NFC-normalized.`);
        if (directory) {
          entry.resume();
          return;
        }
        if (!["File", "OldFile", "ContiguousFile"].includes(entry.type)) {
          invalid(`Unsupported archive entry type ${entry.type}: ${path}.`);
        }
        if (files.has(path)) invalid(`Duplicate archive file ${path}.`);
        const size = Number(entry.size);
        if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxFileBytes) {
          invalid(`Archive file ${path} exceeds the per-file byte limit.`);
        }
        const mode = Number(entry.mode ?? 0);
        if (!Number.isSafeInteger(mode) || (mode & 0o7111) !== 0) {
          invalid(`Archive file ${path} has executable or special permission bits.`);
        }
        declaredBytes += size;
        if (declaredBytes > limits.maxResourceBytes + 1024 * 1024) {
          invalid("The .lapkg archive exceeds the resource byte limit.");
        }
        pending.push(new Promise<void>((resolveEntry, rejectEntry) => {
          const chunks: Buffer[] = [];
          let actualBytes = 0;
          entry.on("data", (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            actualBytes += buffer.length;
            chunks.push(buffer);
          });
          entry.once("error", rejectEntry);
          entry.once("end", () => {
            try {
              if (actualBytes !== size) invalid(`Archive file ${path} size does not match its header.`);
              const bytes = Buffer.concat(chunks);
              files.set(path, { path, bytes, sha256: sha256(bytes), size });
              resolveEntry();
            } catch (error) {
              rejectEntry(error);
            }
          });
        }));
      } catch (error) {
        validationError = error;
        entry.resume();
      }
    },
  });
  const parsed = new Promise<void>((resolveParse, rejectParse) => {
    parser.once("error", rejectParse);
    parser.once("end", resolveParse);
  });
  parser.end(archiveBytes);
  await parsed;
  if (validationError !== undefined) throw validationError;
  await Promise.all(pending);
  return files;
}

export async function inspectLapkgArchive(
  archivePath: string,
  inputLimits: Partial<LapkgFormatLimits> = {},
): Promise<InspectedLapkgV1> {
  const metadata = await stat(archivePath);
  if (!metadata.isFile()) invalid("The .lapkg input must be a regular file.");
  const archiveBytes = await readFile(archivePath);
  return inspectLapkgArchiveBytes(archiveBytes, inputLimits);
}

export async function inspectLapkgArchiveBytes(
  archiveBytes: Buffer,
  inputLimits: Partial<LapkgFormatLimits> = {},
): Promise<InspectedLapkgV1> {
  const limits = resolveLimits(inputLimits);
  if (archiveBytes.length > limits.maxArchiveBytes) invalid("The .lapkg archive exceeds the archive byte limit.");
  const files = await readArchiveFiles(archiveBytes, limits);
  const manifestFile = files.get("lapkg.json");
  if (!manifestFile) invalid("The .lapkg archive is missing lapkg.json.");
  if (manifestFile.size > 1024 * 1024) invalid("lapkg.json exceeds the manifest byte limit.");
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.bytes)) as unknown;
  } catch {
    invalid("lapkg.json must be valid UTF-8 JSON.");
  }
  const manifest = parseManifest(manifestValue, limits);
  const declaredPaths = new Set(manifest.resources.map((resource) => resource.path));
  for (const path of files.keys()) {
    if (path !== "lapkg.json" && !declaredPaths.has(path)) invalid(`Undeclared archive file ${path}.`);
  }
  const inspectedResources = manifest.resources.map((resource) => {
    const file = files.get(resource.path);
    if (!file) invalid(`Missing declared resource ${resource.path}.`);
    if (file.sha256 !== resource.sha256) invalid(`Resource ${resource.id} digest mismatch.`);
    validateResourceText(resource, file.bytes);
    return { ...resource, size: file.size };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const totalResourceBytes = inspectedResources.reduce((sum, resource) => sum + resource.size, 0);
  if (totalResourceBytes > limits.maxResourceBytes) invalid("The .lapkg resources exceed the resource byte limit.");
  const tree = createHash("sha256");
  for (const resource of inspectedResources) {
    tree.update(resource.path).update("\0").update(resource.sha256).update("\0").update(String(resource.size)).update("\0");
  }
  return {
    manifest,
    manifestSha256: manifestFile.sha256,
    archiveSha256: sha256(archiveBytes),
    treeHash: tree.digest("hex"),
    totalResourceBytes,
    resources: inspectedResources,
  };
}
