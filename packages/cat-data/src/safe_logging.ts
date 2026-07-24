export type SafeLogLevel = "debug" | "info" | "warn" | "error";

export interface SafeLogInput {
  level: SafeLogLevel;
  event: string;
  context?: unknown;
}

export interface SafeLogRecord {
  schemaVersion: 1;
  ts: string;
  diagnosticId: string;
  level: SafeLogLevel;
  event: string;
  context?: unknown;
}

export interface SafeLogger {
  debug(event: string, context?: unknown): void;
  info(event: string, context?: unknown): void;
  warn(event: string, context?: unknown): void;
  error(event: string, context?: unknown): void;
}

const REDACTED = "[REDACTED]";
const REDACTED_CONTENT = "[REDACTED_CONTENT]";
const REDACTED_PATH = "[REDACTED_PATH]";
const CIRCULAR = "[CIRCULAR]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = 16;
const MAX_NODES = 2_000;
const MAX_STRING = 2_000;
const MAX_ARRAY = 100;
const MAX_KEYS = 100;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sensitiveKey(key: string): boolean {
  return /(?:authorization|proxyauthorization|cookie|setcookie|password|passwd|secret|token|apikey|accesskey|credential|privatekey|clientsecret|refresh)/.test(normalizedKey(key));
}

function contentKey(key: string): boolean {
  return /^(?:body|content|customertext|document|input|message|output|prompt|response|source|sourcetext|target|targettext|text|transcript|translation)$/.test(normalizedKey(key));
}

function pathKey(key: string): boolean {
  return /(?:^|(?:file|local|project|repo|root|socket|source|target))(?:path|dir|directory)$/.test(normalizedKey(key));
}

function identifierKey(key: string): boolean {
  return /^(?:projectid|batchid|taskid|runid|sessionid|artifactid|decisionid|diagnosticid)$/.test(normalizedKey(key));
}

function safeIdentifier(value: string): string {
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : REDACTED;
}

function safeStringKey(key: string): boolean {
  return /^(?:action|code|event|host|kind|method|mode|modelid|provider|reasoncode|severity|signal|status|transport|version)$/.test(normalizedKey(key));
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const name of Array.from(url.searchParams.keys())) url.searchParams.set(name, REDACTED);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function redactString(value: string): string {
  let redacted = value
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|pk|api)[-_][A-Za-z0-9._-]{8,}\b/g, REDACTED)
    .replace(/(?:\/Users\/|\/home\/|\/root\/|\/private\/|\/var\/|\/tmp\/)[^\n\r"',;)}]+/g, REDACTED_PATH)
    .replace(/[A-Za-z]:\\[^\n\r"',;)}]+/g, REDACTED_PATH);
  redacted = redacted.replace(/https?:\/\/[^\s"']+/g, (match) => redactUrl(match));
  if (redacted.length > MAX_STRING) return `${redacted.slice(0, MAX_STRING)}${TRUNCATED}`;
  return redacted;
}

interface RedactionState {
  remaining: number;
  seen: WeakSet<object>;
}

function redactValue(value: unknown, key: string, depth: number, state: RedactionState): unknown {
  if (state.remaining-- <= 0 || depth > MAX_DEPTH) return TRUNCATED;
  if (sensitiveKey(key)) return REDACTED;
  if (contentKey(key)) return REDACTED_CONTENT;
  if (pathKey(key)) return REDACTED_PATH;
  if (typeof value === "string") {
    if (identifierKey(key)) return safeIdentifier(value);
    if (/^(?:endpoint|origin|url)$/.test(normalizedKey(key))) return redactUrl(redactString(value));
    return safeStringKey(key) ? safeIdentifier(value) : REDACTED_CONTENT;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (!(value instanceof Object)) return redactString(String(value));
  if (state.seen.has(value)) return CIRCULAR;
  state.seen.add(value);
  try {
    if (value instanceof Error) {
      const record: Record<string, unknown> = {
        name: safeIdentifier(value.name),
        message: REDACTED_CONTENT,
      };
      const error = value as Error & { code?: unknown; cause?: unknown };
      if (error.code !== undefined) record.code = redactValue(error.code, "code", depth + 1, state);
      if (error.cause !== undefined) record.cause = redactValue(error.cause, "cause", depth + 1, state);
      for (const extraKey of Object.keys(value).slice(0, MAX_KEYS)) {
        if (extraKey === "name" || extraKey === "message" || extraKey === "stack" || extraKey === "code" || extraKey === "cause") continue;
        record[extraKey] = redactValue((value as unknown as Record<string, unknown>)[extraKey], extraKey, depth + 1, state);
      }
      return record;
    }
    if (Array.isArray(value)) {
      const result = value.slice(0, MAX_ARRAY).map((entry) => redactValue(entry, "item", depth + 1, state));
      if (value.length > MAX_ARRAY) result.push(TRUNCATED);
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    const keys = Object.keys(value).slice(0, MAX_KEYS);
    for (const childKey of keys) {
      try {
        result[childKey] = redactValue((value as Record<string, unknown>)[childKey], childKey, depth + 1, state);
      } catch {
        result[childKey] = "[UNAVAILABLE]";
      }
    }
    if (Object.keys(value).length > keys.length) result[TRUNCATED] = TRUNCATED;
    return result;
  } finally {
    state.seen.delete(value);
  }
}

export function redactLogContext(value: unknown): unknown {
  return redactValue(value, "context", 0, { remaining: MAX_NODES, seen: new WeakSet() });
}

function assertEventName(event: string): string {
  const normalized = event.trim();
  if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(normalized)) throw new Error("Safe log event name is invalid.");
  return normalized;
}

export function createDiagnosticId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function serializeSafeLogEvent(
  input: SafeLogInput,
  now = () => new Date().toISOString(),
  createDiagnosticIdFactory = createDiagnosticId,
): string {
  const diagnosticId = safeIdentifier(createDiagnosticIdFactory());
  if (diagnosticId === REDACTED) throw new Error("Safe log diagnostic ID is invalid.");
  const record: SafeLogRecord = {
    schemaVersion: 1,
    ts: now(),
    diagnosticId,
    level: input.level,
    event: assertEventName(input.event),
    ...(input.context === undefined ? {} : { context: redactLogContext(input.context) }),
  };
  return `${JSON.stringify(record)}\n`;
}

export function createSafeLogger(options: {
  write?: (line: string, level: SafeLogLevel) => void;
  now?: () => string;
  createDiagnosticId?: () => string;
} = {}): SafeLogger {
  const write = options.write ?? ((line: string, level: SafeLogLevel) => {
    const output = line.trimEnd();
    if (level === "error") console.error(output);
    else if (level === "warn") console.warn(output);
    else console.log(output);
  });
  const emit = (level: SafeLogLevel, event: string, context?: unknown): void => {
    write(serializeSafeLogEvent({ level, event, context }, options.now, options.createDiagnosticId), level);
  };
  return Object.freeze({
    debug: (event: string, context?: unknown) => emit("debug", event, context),
    info: (event: string, context?: unknown) => emit("info", event, context),
    warn: (event: string, context?: unknown) => emit("warn", event, context),
    error: (event: string, context?: unknown) => emit("error", event, context),
  });
}

export const safeLogger = createSafeLogger();
