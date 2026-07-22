import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ApiKeyCredential, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

function isCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === "api_key" || type === "oauth";
}

function parseCredentialDocument(raw: string | undefined): Record<string, Credential> {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Pi auth.json must contain a JSON object.");
  }
  for (const [provider, credential] of Object.entries(parsed)) {
    if (!isCredential(credential)) throw new Error(`Pi auth.json contains an invalid credential for ${provider}.`);
  }
  return parsed as Record<string, Credential>;
}

function unquoteShellValue(value: string): string {
  if (!value.startsWith("'") || !value.endsWith("'")) throw new Error("Unsupported Pi credential command quoting.");
  return value.slice(1, -1).replaceAll("'\\''", "'");
}

async function resolveApiKeyReference(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  if (key.startsWith("$")) {
    const name = key.slice(1);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error("Unsupported Pi environment credential reference.");
    return process.env[name];
  }
  if (!key.startsWith("!")) return key;

  const match = /^!security find-generic-password -a ('.*') -s ('.*') -w$/.exec(key);
  if (!match) {
    throw new Error("LA only executes its own macOS Keychain credential command; replace this Pi auth command with an environment variable or Keychain entry.");
  }
  const { stdout } = await execFileAsync("/usr/bin/security", [
    "find-generic-password",
    "-a",
    unquoteShellValue(match[1]),
    "-s",
    unquoteShellValue(match[2]),
    "-w",
  ]);
  return stdout.trim() || undefined;
}

/** App-owned persistent store injected into Pi's canonical ModelRuntime. */
export class PiAuthCredentialStore implements CredentialStore {
  private readonly lockPath: string;

  constructor(readonly authPath = join(getAgentDir(), "auth.json")) {
    this.lockPath = `${authPath}.lock`;
  }

  private async readDocument(): Promise<Record<string, Credential>> {
    try {
      return parseCredentialDocument(await readFile(this.authPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async acquireLock(): Promise<void> {
    await mkdir(dirname(this.authPath), { recursive: true, mode: 0o700 });
    const startedAt = Date.now();
    while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
      try {
        await mkdir(this.lockPath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const lock = await stat(this.lockPath);
          if (Date.now() - lock.mtimeMs > STALE_LOCK_MS) {
            await rmdir(this.lockPath);
            continue;
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code !== "ENOENT") throw lockError;
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
      }
    }
    throw new Error(`Timed out waiting for Pi credential lock: ${this.lockPath}`);
  }

  private async withLock<T>(operation: (document: Record<string, Credential>) => Promise<T>): Promise<T> {
    await this.acquireLock();
    try {
      return await operation(await this.readDocument());
    } finally {
      try {
        await rmdir(this.lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async writeDocument(document: Record<string, Credential>): Promise<void> {
    const temporaryPath = `${this.authPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.authPath);
      await chmod(this.authPath, 0o600);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch {
        // The rename may already have consumed the temporary file.
      }
      throw error;
    }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const credential = await this.readStored(providerId);
    if (credential?.type !== "api_key") return credential;
    const key = await resolveApiKeyReference(credential.key);
    return { ...credential, key } satisfies ApiKeyCredential;
  }

  /** Read auth.json metadata/config without resolving or exposing the API key. */
  async readStored(providerId: string): Promise<Credential | undefined> {
    return (await this.readDocument())[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(await this.readDocument()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.withLock(async (document) => {
      const next = await update(document[providerId]);
      if (next === undefined) return document[providerId];
      document[providerId] = next;
      await this.writeDocument(document);
      return next;
    });
  }

  async delete(providerId: string): Promise<void> {
    await this.withLock(async (document) => {
      delete document[providerId];
      await this.writeDocument(document);
    });
  }
}

const piCredentials = new PiAuthCredentialStore();
let piModelRuntime: Promise<ModelRuntime> | undefined;

export function getPiCredentialStore(): PiAuthCredentialStore {
  return piCredentials;
}

export function getPiModelRuntime(): Promise<ModelRuntime> {
  piModelRuntime ??= ModelRuntime.create({ credentials: piCredentials });
  return piModelRuntime;
}

export async function refreshPiModelRuntime(): Promise<ModelRuntime> {
  const runtime = await getPiModelRuntime();
  await runtime.refresh({ allowNetwork: false });
  return runtime;
}
