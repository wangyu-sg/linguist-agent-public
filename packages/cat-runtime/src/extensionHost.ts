import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentToolResult, ToolDefinition } from "@earendil-works/pi-coding-agent";

const MAX_LINE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExtensionHostPlanV1 {
  schemaVersion: 1;
  apiVersion: 1;
  extensionPath: string;
  extensionSha256: string;
  cwd: string;
  capabilityGrants: [];
}

export interface IsolatedExtensionTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  executionMode?: "sequential" | "parallel";
}

export interface IsolatedExtensionHost {
  readonly tools: readonly IsolatedExtensionTool[];
  invoke(toolName: string, params: unknown): Promise<AgentToolResult<unknown>>;
  dispose(): Promise<void>;
}

interface HostResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  code?: string;
  message?: string;
  mac: string;
}

function fail(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function packageRoot(specifier: string): string {
  const resolved = fileURLToPath(import.meta.resolve(specifier));
  const normalized = resolved.replaceAll("\\", "/");
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0] ?? specifier;
  const needle = `/node_modules/${packageName}/`;
  const index = normalized.lastIndexOf(needle);
  if (index < 0) throw fail("EXTENSION_HOST_UNAVAILABLE", `Cannot locate package root for ${specifier}.`);
  return normalized.slice(0, index + needle.length - 1);
}

function nodeModulesRoot(): string {
  const packagePath = packageRoot("@earendil-works/pi-coding-agent").replaceAll("\\", "/");
  const marker = "/node_modules/";
  const index = packagePath.lastIndexOf(marker);
  if (index < 0) throw fail("EXTENSION_HOST_UNAVAILABLE", "Cannot locate the workspace node_modules root.");
  return packagePath.slice(0, index + marker.length - 1);
}

function srtCliPath(): string {
  return join(packageRoot("@anthropic-ai/sandbox-runtime"), "dist", "cli.js");
}

async function extensionHostEntry(privateRoot: string): Promise<string> {
  const source = fileURLToPath(new URL("./extension_host_entry.ts", import.meta.url));
  const compiled = fileURLToPath(new URL("./extension_host_entry.js", import.meta.url));
  if (!import.meta.url.endsWith(".ts")) return compiled;
  const typescript = await import("typescript");
  const output = typescript.transpileModule(await readFile(source, "utf8"), {
    compilerOptions: {
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: source,
  }).outputText;
  const outputPath = join(privateRoot, "extension-host-entry.mjs");
  await writeFile(outputPath, output, { mode: 0o400 });
  return outputPath;
}

export async function assertExtensionHostPlan(plan: ExtensionHostPlanV1): Promise<void> {
  if (!isRecord(plan) || !Array.isArray(plan.capabilityGrants) ||
    typeof plan.extensionPath !== "string" || typeof plan.extensionSha256 !== "string" ||
    typeof plan.cwd !== "string") {
    throw fail("EXTENSION_PLAN_INVALID", "Extension Host plan fields are invalid.");
  }
  if (plan.schemaVersion !== 1 || plan.apiVersion !== 1) {
    throw fail("EXTENSION_API_UNSUPPORTED", "Only Extension Host protocol v1 is supported.");
  }
  if (!isAbsolute(plan.extensionPath) || !isAbsolute(plan.cwd)) {
    throw fail("EXTENSION_PLAN_INVALID", "extensionPath and cwd must be absolute.");
  }
  if (!/^[a-f0-9]{64}$/u.test(plan.extensionSha256)) {
    throw fail("EXTENSION_PLAN_INVALID", "extensionSha256 must be a lowercase SHA-256 digest.");
  }
  if (plan.capabilityGrants.length !== 0) {
    throw fail("EXTENSION_CAPABILITY_UNSUPPORTED", "Extension Host v1 grants no direct host capabilities.");
  }
  const canonical = await realpath(plan.extensionPath);
  if (canonical !== plan.extensionPath) {
    throw fail("EXTENSION_PLAN_INVALID", "extensionPath must be canonical.");
  }
  const metadata = await stat(canonical);
  if (!metadata.isFile() || (metadata.mode & 0o222) !== 0) {
    throw fail("EXTENSION_PLAN_INVALID", "Extension must be a read-only regular staged file.");
  }
  const actual = digest(await readFile(canonical));
  if (actual !== plan.extensionSha256) {
    throw fail("EXTENSION_DIGEST_MISMATCH", "Staged Extension bytes do not match the approved digest.");
  }
}

function parseTools(value: unknown): IsolatedExtensionTool[] {
  if (!Array.isArray(value)) throw fail("EXTENSION_PROTOCOL_INVALID", "Host did not return a tool list.");
  const names = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.label !== "string" ||
      typeof item.description !== "string" || !isRecord(item.parameters)) {
      throw fail("EXTENSION_PROTOCOL_INVALID", "Host returned an invalid tool descriptor.");
    }
    if (item.name.length === 0 || names.has(item.name)) {
      throw fail("EXTENSION_PROTOCOL_INVALID", "Host returned an empty or duplicate tool name.");
    }
    names.add(item.name);
    const tool: IsolatedExtensionTool = {
      name: item.name,
      label: item.label,
      description: item.description,
      parameters: item.parameters,
    };
    if (typeof item.promptSnippet === "string") tool.promptSnippet = item.promptSnippet;
    if (Array.isArray(item.promptGuidelines) && item.promptGuidelines.every((entry) => typeof entry === "string")) {
      tool.promptGuidelines = item.promptGuidelines;
    }
    if (item.executionMode === "sequential" || item.executionMode === "parallel") tool.executionMode = item.executionMode;
    return tool;
  });
}

function parseToolResult(value: unknown): AgentToolResult<unknown> {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw fail("EXTENSION_PROTOCOL_INVALID", "Host returned an invalid tool result.");
  }
  const content = value.content.map((item) => {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      throw fail("EXTENSION_PROTOCOL_INVALID", "Extension Host v1 only accepts text result content.");
    }
    return { type: "text" as const, text: item.text };
  });
  return { content, details: value.details };
}

export async function launchIsolatedExtensionHost(
  plan: ExtensionHostPlanV1,
  options: { requestTimeoutMs?: number } = {},
): Promise<IsolatedExtensionHost> {
  await assertExtensionHostPlan(plan);
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw fail("EXTENSION_PLAN_INVALID", "Invalid request timeout.");

  const requestedPrivateRoot = await mkdtemp(join(tmpdir(), "la-extension-host-"));
  const privateRoot = await realpath(requestedPrivateRoot);
  await mkdir(join(privateRoot, ".git"));
  const approvedBytes = await readFile(plan.extensionPath);
  if (digest(approvedBytes) !== plan.extensionSha256) {
    await rm(privateRoot, { recursive: true, force: true });
    throw fail("EXTENSION_DIGEST_MISMATCH", "Staged Extension changed before private Host staging.");
  }
  const privateExtensionPath = join(privateRoot, "approved-extension.ts");
  await writeFile(privateExtensionPath, approvedBytes, { mode: 0o400 });
  const hostPlan: ExtensionHostPlanV1 = { ...plan, extensionPath: privateExtensionPath };
  const settingsPath = join(privateRoot, "srt-settings.json");
  const entryPath = await extensionHostEntry(privateRoot);
  const readable = [nodeModulesRoot(), privateRoot];
  const sandboxReadable = [dirname(nodeModulesRoot()), privateRoot];
  await writeFile(settingsPath, `${JSON.stringify({
    network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: false },
    filesystem: {
      denyRead: ["/Users", "/home", "/private/tmp", "/tmp"],
      allowRead: sandboxReadable,
      allowWrite: [],
      denyWrite: [],
    },
    allowPty: false,
    allowGitConfig: false,
    allowAppleEvents: false,
  })}\n`, { mode: 0o400 });
  await chmod(settingsPath, 0o400);

  const nodeArgs = ["--permission", ...readable.map((path) => `--allow-fs-read=${path}`)];
  const piRuntimeUrl = pathToFileURL(join(packageRoot("@earendil-works/pi-coding-agent"), "dist", "index.js")).href;
  nodeArgs.push(entryPath, JSON.stringify(hostPlan), piRuntimeUrl);
  const child = spawn(process.execPath, [srtCliPath(), "--settings", settingsPath, "--", process.execPath, ...nodeArgs], {
    cwd: privateRoot,
    env: {
      HOME: privateRoot,
      TMPDIR: privateRoot,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      ...(process.env.LA_EXTENSION_HOST_DEBUG === "1" ? { SRT_DEBUG: "true", LA_EXTENSION_HOST_DEBUG: "1" } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let secret: string | undefined;
  let buffer = "";
  let closed = false;
  let stderr = "";
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  let helloResolve!: () => void;
  let helloReject!: (error: Error) => void;
  const hello = new Promise<void>((resolveHello, rejectHello) => { helloResolve = resolveHello; helloReject = rejectHello; });

  const rejectAll = (error: Error): void => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4096); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_LINE_BYTES && !buffer.includes("\n")) {
      child.kill("SIGKILL");
      rejectAll(fail("EXTENSION_PROTOCOL_INVALID", "Host response exceeded the line limit."));
      return;
    }
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!secret) {
          if (!isRecord(parsed) || parsed.type !== "hello" || typeof parsed.secret !== "string" || parsed.secret.length < 32) {
            throw fail("EXTENSION_PROTOCOL_INVALID", "Invalid host handshake.");
          }
          secret = parsed.secret;
          helloResolve();
          continue;
        }
        if (!isRecord(parsed) || typeof parsed.requestId !== "string" || typeof parsed.ok !== "boolean" || typeof parsed.mac !== "string") {
          throw fail("EXTENSION_PROTOCOL_INVALID", "Invalid authenticated host response.");
        }
        const response = parsed as unknown as HostResponse;
        const unsigned = { requestId: response.requestId, ok: response.ok, ...(response.ok ? { result: response.result } : { code: response.code, message: response.message }) };
        const expected = createHmac("sha256", secret).update(canonicalJson(unsigned)).digest();
        const actual = Buffer.from(response.mac, "hex");
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          throw fail("EXTENSION_PROTOCOL_INVALID", "Host response authentication failed.");
        }
        const request = pending.get(response.requestId);
        if (!request) continue;
        pending.delete(response.requestId);
        clearTimeout(request.timer);
        if (response.ok) request.resolve(response.result);
        else request.reject(fail(response.code ?? "EXTENSION_EXECUTION_FAILED", response.message ?? "Extension request failed."));
      } catch (error) {
        const failure = error instanceof Error ? error : fail("EXTENSION_PROTOCOL_INVALID", String(error));
        child.kill("SIGKILL");
        helloReject(failure);
        rejectAll(failure);
      }
    }
  });
  child.once("error", (error) => {
    const failure = fail("EXTENSION_HOST_UNAVAILABLE", error.message);
    helloReject(failure);
    rejectAll(failure);
  });
  child.once("exit", (code, signal) => {
    closed = true;
    const detail = process.env.LA_EXTENSION_HOST_DEBUG === "1"
      ? stderr.trim() || `exit=${String(code)} signal=${String(signal)}`
      : "The isolated Extension Host exited unexpectedly.";
    const failure = fail("EXTENSION_HOST_CRASHED", detail);
    helloReject(failure);
    rejectAll(failure);
  });

  const send = async (operation: string, payload: Record<string, unknown>): Promise<unknown> => {
    await hello;
    if (closed) {
      const detail = process.env.LA_EXTENSION_HOST_DEBUG === "1"
        ? stderr.trim() || "Extension Host is not running."
        : "The isolated Extension Host is not running.";
      throw fail("EXTENSION_HOST_CRASHED", detail);
    }
    const requestId = randomUUID();
    const request = { requestId, operation, ...payload };
    const promise = new Promise<unknown>((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        child.kill("SIGKILL");
        rejectRequest(fail("EXTENSION_HOST_TIMEOUT", `Extension Host request exceeded ${timeoutMs}ms.`));
      }, timeoutMs);
      pending.set(requestId, { resolve: resolveRequest, reject: rejectRequest, timer });
    });
    child.stdin.write(`${JSON.stringify(request)}\n`);
    return promise;
  };

  try {
    const tools = parseTools(await send("start", {}));
    return {
      tools,
      invoke: async (toolName, params) => parseToolResult(await send("invoke", { toolName, params })),
      dispose: async () => {
        if (!closed) {
          try {
            await send("dispose", {});
          } catch (error) {
            if (process.env.LA_EXTENSION_HOST_DEBUG === "1") process.stderr.write(`Extension Host dispose RPC failed: ${String(error)}\n`);
          }
          child.kill("SIGTERM");
        }
        await rm(privateRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await rm(privateRoot, { recursive: true, force: true });
    throw error;
  }
}

export function createIsolatedExtensionToolDefinitions(host: IsolatedExtensionHost): ToolDefinition[] {
  return host.tools.map((tool) => ({
    ...tool,
    parameters: tool.parameters as ToolDefinition["parameters"],
    execute: async (_toolCallId, params) => host.invoke(tool.name, params),
  } as ToolDefinition));
}
