import { createHmac, timingSafeEqual } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";

function canonicalPayload(record) {
  return JSON.stringify([
    record.schemaVersion,
    record.transport,
    record.runtimeInstanceId,
    record.socketPath,
    record.nonce,
    record.issuedAt,
  ]);
}

function hmac(token, purpose, payload) {
  return createHmac("sha256", token).update(`${purpose}\0${payload}`).digest("base64url");
}

export function runtimeTransportPaths(rootOverride) {
  const uid = typeof process.getuid === "function" ? process.getuid() : process.pid;
  const root = resolve(rootOverride?.trim() || join("/tmp", `linguist-agent-${uid}`));
  return { root, rendezvousPath: join(root, "rendezvous.json") };
}

function verifiedRecord(value, bootstrapToken, expectedRoot) {
  if (
    !value
    || value.schemaVersion !== 1
    || value.transport !== "unix"
    || typeof value.runtimeInstanceId !== "string"
    || !value.runtimeInstanceId.trim()
    || typeof value.socketPath !== "string"
    || typeof value.nonce !== "string"
    || !value.nonce
    || typeof value.issuedAt !== "string"
    || !Number.isFinite(Date.parse(value.issuedAt))
    || typeof value.signature !== "string"
  ) throw new Error("Runtime rendezvous record is invalid.");
  const root = resolve(expectedRoot);
  const socketPath = resolve(value.socketPath);
  if (Buffer.byteLength(socketPath) > 103) throw new Error("Runtime Unix socket path exceeds the platform limit.");
  const withinRoot = relative(root, socketPath);
  if (!withinRoot || withinRoot.startsWith("..") || isAbsolute(withinRoot) || !socketPath.endsWith(".sock")) {
    throw new Error("Runtime rendezvous socket path escaped its trusted root.");
  }
  const expected = Buffer.from(hmac(bootstrapToken, "LA-RENDEZVOUS-v1", canonicalPayload(value)));
  const actual = Buffer.from(value.signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Runtime rendezvous signature is invalid.");
  }
  return Object.freeze({
    ...value,
    socketPath,
    sessionCredential: hmac(bootstrapToken, "LA-SESSION-v1", canonicalPayload(value)),
  });
}

export async function readVerifiedRuntimeRendezvous(input) {
  const rootMetadata = await lstat(input.expectedRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || (rootMetadata.mode & 0o077) !== 0) {
    throw new Error("Runtime rendezvous directory permissions are too broad.");
  }
  if (typeof process.getuid === "function" && rootMetadata.uid !== process.getuid()) {
    throw new Error("Runtime rendezvous directory owner is invalid.");
  }
  const metadata = await lstat(input.rendezvousPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024) {
    throw new Error("Runtime rendezvous file is invalid.");
  }
  if ((metadata.mode & 0o077) !== 0) throw new Error("Runtime rendezvous permissions are too broad.");
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("Runtime rendezvous owner is invalid.");
  }
  const value = JSON.parse(await readFile(input.rendezvousPath, "utf8"));
  return verifiedRecord(value, input.bootstrapToken, input.expectedRoot);
}

function consumeResponse(response) {
  let consumed;
  async function bytes() {
    if (!consumed) {
      consumed = (async () => {
        const chunks = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
      })();
    }
    return consumed;
  }
  return {
    ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
    status: response.statusCode ?? 0,
    headers: response.headers,
    body: response,
    async text() { return (await bytes()).toString("utf8"); },
    async json() { return JSON.parse((await bytes()).toString("utf8")); },
    async arrayBuffer() {
      const value = await bytes();
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    },
  };
}

export async function requestUnixRuntime(input) {
  if (typeof input.path !== "string" || !input.path.startsWith("/api/") || input.path.startsWith("//")) {
    throw new Error("Only LA API paths are allowed.");
  }
  const rendezvous = await readVerifiedRuntimeRendezvous(input);
  return new Promise((resolveResponse, reject) => {
    const request = httpRequest({
      socketPath: rendezvous.socketPath,
      method: input.method,
      path: input.path,
      headers: {
        ...(input.headers ?? {}),
        authorization: `Bearer ${rendezvous.sessionCredential}`,
      },
    }, (response) => resolveResponse(consumeResponse(response)));
    const abort = () => request.destroy(new Error("Runtime request was aborted."));
    input.signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => input.signal?.removeEventListener("abort", abort));
    request.once("error", reject);
    request.setTimeout(input.timeoutMs ?? 60_000, () => request.destroy(new Error("Runtime request timed out.")));
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}
