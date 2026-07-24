import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writeDurableFileAtomic } from "@linguist-agent/cat-data";

export interface RuntimeRendezvousRecord {
  schemaVersion: 1;
  transport: "unix";
  runtimeInstanceId: string;
  socketPath: string;
  nonce: string;
  issuedAt: string;
  signature: string;
}

function canonicalPayload(record: Omit<RuntimeRendezvousRecord, "signature">): string {
  return JSON.stringify([
    record.schemaVersion,
    record.transport,
    record.runtimeInstanceId,
    record.socketPath,
    record.nonce,
    record.issuedAt,
  ]);
}

function hmac(token: string, purpose: string, payload: string): string {
  return createHmac("sha256", token).update(`${purpose}\0${payload}`).digest("base64url");
}

export function runtimeTransportPaths(rootOverride?: string): {
  root: string;
  rendezvousPath: string;
} {
  const uid = typeof process.getuid === "function" ? process.getuid() : process.pid;
  const root = resolve(rootOverride?.trim() || join("/tmp", `linguist-agent-${uid}`));
  return { root, rendezvousPath: join(root, "rendezvous.json") };
}

export function randomRuntimeSocketPath(root: string, random = () => randomBytes(8).toString("hex")): string {
  const path = join(root, `runtime-${random()}.sock`);
  if (Buffer.byteLength(path) > 103) {
    throw new Error("Local runtime socket path exceeds the macOS Unix-domain limit.");
  }
  return path;
}

export function createRuntimeRendezvous(input: {
  bootstrapToken: string;
  runtimeInstanceId: string;
  socketPath: string;
  nonce?: string;
  issuedAt?: string;
}): RuntimeRendezvousRecord {
  const bootstrapToken = input.bootstrapToken.trim();
  const runtimeInstanceId = input.runtimeInstanceId.trim();
  const socketPath = resolve(input.socketPath);
  if (!bootstrapToken || !runtimeInstanceId || !isAbsolute(socketPath)) {
    throw new Error("Runtime rendezvous input is invalid.");
  }
  if (Buffer.byteLength(socketPath) > 103) {
    throw new Error("Local runtime socket path exceeds the macOS Unix-domain limit.");
  }
  const unsigned = {
    schemaVersion: 1 as const,
    transport: "unix" as const,
    runtimeInstanceId,
    socketPath,
    nonce: input.nonce?.trim() || randomBytes(32).toString("base64url"),
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
  return { ...unsigned, signature: hmac(bootstrapToken, "LA-RENDEZVOUS-v1", canonicalPayload(unsigned)) };
}

export function verifyRuntimeRendezvous(
  bootstrapToken: string,
  record: RuntimeRendezvousRecord,
  expectedRoot: string,
): void {
  const root = resolve(expectedRoot);
  const socketPath = resolve(record.socketPath);
  const withinRoot = relative(root, socketPath);
  if (!withinRoot || withinRoot.startsWith("..") || isAbsolute(withinRoot) || !socketPath.endsWith(".sock")) {
    throw new Error("Runtime rendezvous socket path escaped its trusted root.");
  }
  const unsigned = {
    schemaVersion: record.schemaVersion,
    transport: record.transport,
    runtimeInstanceId: record.runtimeInstanceId,
    socketPath: record.socketPath,
    nonce: record.nonce,
    issuedAt: record.issuedAt,
  };
  const expected = Buffer.from(hmac(bootstrapToken, "LA-RENDEZVOUS-v1", canonicalPayload(unsigned)));
  const actual = Buffer.from(record.signature ?? "");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Runtime rendezvous signature is invalid.");
  }
}

export function deriveRuntimeSessionCredential(
  bootstrapToken: string,
  record: RuntimeRendezvousRecord,
): string {
  const unsigned = {
    schemaVersion: record.schemaVersion,
    transport: record.transport,
    runtimeInstanceId: record.runtimeInstanceId,
    socketPath: record.socketPath,
    nonce: record.nonce,
    issuedAt: record.issuedAt,
  };
  return hmac(bootstrapToken, "LA-SESSION-v1", canonicalPayload(unsigned));
}

export async function publishRuntimeRendezvous(path: string, record: RuntimeRendezvousRecord): Promise<void> {
  await prepareRuntimeTransportRoot(dirname(path));
  await writeDurableFileAtomic(path, `${JSON.stringify(record)}\n`);
  await chmod(path, 0o600);
}

export async function prepareRuntimeTransportRoot(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function secureRuntimeSocket(path: string): Promise<void> {
  await chmod(path, 0o600);
}
