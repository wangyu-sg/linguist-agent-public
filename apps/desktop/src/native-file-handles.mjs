import { randomUUID as systemRandomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";

const HANDLE_PREFIX = "la-native-file-";
const HANDLE_ID = /^la-native-file-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HANDLE_KINDS = new Set(["project-folder", "asset", "batch", "lapkg", "chat-file", "chat-directory", "export", "document-evidence", "maintenance-candidate"]);
const DEFAULT_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_MAX_HANDLES = 128;

function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value;
}

function nativeHandleReference(value) {
  const input = object(value, "Native file handle must be an object.");
  if (Object.keys(input).some((key) => key !== "id" && key !== "name")) {
    throw new Error("Native file handle contains an unsupported field.");
  }
  if (typeof input.id !== "string" || !HANDLE_ID.test(input.id)) {
    throw new Error("Native file handle id is invalid.");
  }
  if (typeof input.name !== "string" || !input.name || input.name.length > 255 || /[\\/\u0000-\u001f\u007f]/u.test(input.name)) {
    throw new Error("Native file handle name is invalid.");
  }
  return { id: input.id, name: input.name };
}

function kind(value) {
  if (typeof value !== "string" || !HANDLE_KINDS.has(value)) throw new Error("Native file handle kind is invalid.");
  return value;
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return Boolean(path) && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
}

async function canonicalIdentity(path) {
  if (typeof path !== "string" || !path.trim()) throw new Error("Native file selection path is invalid.");
  try {
    const canonicalPath = await realpath(path);
    const metadata = await stat(canonicalPath);
    return { path: canonicalPath, device: metadata.dev, inode: metadata.ino, directory: metadata.isDirectory() };
  } catch {
    throw new Error("Selected native file changed after selection.");
  }
}

export function createNativeFileHandleRegistry({
  randomUUID = systemRandomUUID,
  now = Date.now,
  ttlMs = DEFAULT_TTL_MS,
  maxHandles = DEFAULT_MAX_HANDLES,
} = {}) {
  if (typeof randomUUID !== "function" || typeof now !== "function" || !Number.isSafeInteger(ttlMs) || ttlMs <= 0
    || !Number.isSafeInteger(maxHandles) || maxHandles < 1) {
    throw new Error("Native file handle registry configuration is invalid.");
  }
  const handles = new Map();

  function prune() {
    const current = now();
    for (const [id, entry] of handles) {
      if (entry.expiresAt < current) handles.delete(id);
    }
  }

  async function issue(path, requestedKind) {
    const expectedKind = kind(requestedKind);
    prune();
    if (handles.size >= maxHandles) throw new Error("Too many native file selections are active.");
    const identity = await canonicalIdentity(path);
    const permitsDirectory = expectedKind === "project-folder" || expectedKind === "maintenance-candidate";
    if (expectedKind === "project-folder" && !identity.directory) throw new Error("Project folder selection must be a directory.");
    if (!permitsDirectory && identity.directory) throw new Error("Native file selection must be a file.");
    const uuid = randomUUID();
    if (typeof uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(uuid)) {
      throw new Error("Native file handle random identifier is invalid.");
    }
    const id = `${HANDLE_PREFIX}${uuid}`;
    if (handles.has(id)) throw new Error("Native file handle collision.");
    const entry = {
      id,
      name: basename(identity.path),
      kind: expectedKind,
      path: identity.path,
      device: identity.device,
      inode: identity.inode,
      expiresAt: now() + ttlMs,
    };
    handles.set(id, entry);
    return { id: entry.id, name: entry.name };
  }

  async function resolve(value, requestedKind) {
    const reference = nativeHandleReference(value);
    const expectedKind = kind(requestedKind);
    prune();
    const entry = handles.get(reference.id);
    if (!entry) throw new Error("Native file handle is unknown or expired.");
    if (entry.name !== reference.name) throw new Error("Native file handle name does not match the selected file.");
    if (entry.kind !== expectedKind) throw new Error(`Native file handle is not valid for ${expectedKind}.`);
    const current = await canonicalIdentity(entry.path);
    if (current.path !== entry.path || current.device !== entry.device || current.inode !== entry.inode) {
      throw new Error("Selected native file changed after selection.");
    }
    return entry.path;
  }

  async function resolveProjectAssets(values, projectRoot) {
    if (!Array.isArray(values) || values.length === 0 || values.length > 64) {
      throw new Error("Project asset selections must contain between one and 64 native file handles.");
    }
    const root = await canonicalIdentity(projectRoot);
    if (!root.directory) throw new Error("Canonical Project root must be a directory.");
    const resolved = [];
    const seen = new Set();
    for (const value of values) {
      const reference = nativeHandleReference(value);
      if (seen.has(reference.id)) throw new Error("Project asset selections must not repeat a native file handle.");
      seen.add(reference.id);
      const path = await resolve(reference, "asset");
      if (!isInside(root.path, path)) throw new Error("Selected native file is not inside the canonical Project root.");
      resolved.push({ ...reference, relPath: relative(root.path, path).split(sep).join("/") });
    }
    return resolved;
  }

  return Object.freeze({ issue, resolve, resolveProjectAssets });
}
