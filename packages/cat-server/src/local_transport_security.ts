import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const LOCAL_TRANSPORT_KEYCHAIN_SERVICE = "com.linguist-agent.local-transport";
export const DEFAULT_LOCAL_BODY_BYTES = 8 * 1024 * 1024;

export class LocalTransportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "LocalTransportError";
  }
}

export interface LocalTransportRequest {
  method?: string;
  pathname: string;
  origin?: string;
  authorization?: string;
}

export type LocalTransportDecision =
  | { allowed: true; public: boolean }
  | { allowed: false; status: 401 | 403; code: "authentication_required" | "origin_denied"; message: string };

export interface LocalTransportSecurity {
  authorize(request: LocalTransportRequest): LocalTransportDecision;
  responseHeaders(origin?: string): Record<string, string>;
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual ?? "").digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function bearerToken(value: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(value?.trim() ?? "");
  return match?.[1];
}

export function createLocalTransportSecurity(input: {
  token: string;
  allowedOrigins?: string[];
  publicHealth?: boolean;
}): LocalTransportSecurity {
  const token = input.token.trim();
  if (!token) throw new Error("Local transport token is required.");
  const allowedOrigins = new Set((input.allowedOrigins ?? []).map((origin) => origin.trim()).filter(Boolean));
  return {
    authorize(request) {
      if (request.origin && !allowedOrigins.has(request.origin)) {
        return { allowed: false, status: 403, code: "origin_denied", message: "Browser origin is not allowed for the local LA transport." };
      }
      if (request.method === "OPTIONS" && request.origin && allowedOrigins.has(request.origin)) {
        return { allowed: true, public: true };
      }
      // Only the read-only health probe is public.  A POST/PUT to the same
      // pathname must not become an unauthenticated backdoor as routes evolve.
      if (input.publicHealth !== false && request.pathname === "/api/health" && (!request.method || request.method === "GET" || request.method === "HEAD")) {
        return { allowed: true, public: true };
      }
      if (!tokenMatches(bearerToken(request.authorization), token)) {
        return { allowed: false, status: 401, code: "authentication_required", message: "Local LA authentication is required." };
      }
      return { allowed: true, public: false };
    },
    responseHeaders(origin): Record<string, string> {
      if (!origin || !allowedOrigins.has(origin)) return {};
      return { "access-control-allow-origin": origin, vary: "Origin" };
    },
  };
}

export async function readLocalJsonBody(
  input: AsyncIterable<Uint8Array | string>,
  maxBytes = DEFAULT_LOCAL_BODY_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new LocalTransportError(`Request body exceeds ${maxBytes} bytes.`, 413, "body_too_large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new LocalTransportError("Request body is not valid JSON.", 400, "invalid_json");
  }
}

export async function resolveLocalTransportToken(input: {
  envToken?: string;
  platform?: NodeJS.Platform;
  readKeychain?: () => Promise<string | undefined>;
  writeKeychain?: (value: string) => Promise<void>;
  randomToken?: () => string;
} = {}): Promise<string> {
  const envToken = (input.envToken ?? process.env.LA_LOCAL_API_TOKEN)?.trim();
  if (envToken) return envToken;
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("LA_LOCAL_API_TOKEN is required when the LA server is not running on macOS.");
  }
  const existing = (await input.readKeychain?.())?.trim();
  if (existing) return existing;
  if (!input.writeKeychain) throw new Error("Local transport Keychain writer is unavailable.");
  const token = input.randomToken?.() ?? randomBytes(32).toString("base64url");
  await input.writeKeychain(token);
  return token;
}
