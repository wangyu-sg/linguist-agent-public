import { createHmac, randomBytes } from "node:crypto";
import { writeSync } from "node:fs";
import { createInterface } from "node:readline";
import type {
  AgentToolResult,
  Extension,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

const piRuntime = await import(process.argv[3] ?? "");
const DefaultResourceLoader = piRuntime.DefaultResourceLoader as typeof import("@earendil-works/pi-coding-agent").DefaultResourceLoader;
const SettingsManager = piRuntime.SettingsManager as typeof import("@earendil-works/pi-coding-agent").SettingsManager;

const MAX_MESSAGE_BYTES = 1_048_576;
const secret = randomBytes(32).toString("hex");
const tools = new Map<string, ToolDefinition>();

interface HostPlan {
  schemaVersion: 1;
  apiVersion: 1;
  extensionPath: string;
  extensionSha256: string;
  cwd: string;
  capabilityGrants: [];
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

function sendRaw(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > MAX_MESSAGE_BYTES) throw new Error("EXTENSION_PROTOCOL_INVALID: Response exceeded the size limit.");
  writeSync(1, `${serialized}\n`);
}

function sendSigned(unsigned: Record<string, unknown>): void {
  sendRaw({
    ...unsigned,
    mac: createHmac("sha256", secret).update(canonicalJson(unsigned)).digest("hex"),
  });
}

function errorCode(error: unknown): string {
  const record = isRecord(error) ? error : undefined;
  const cause = record && isRecord(record.cause) ? record.cause : undefined;
  const code = typeof record?.code === "string" ? record.code : typeof cause?.code === "string" ? cause.code : "";
  const message = error instanceof Error ? error.message : String(error);
  if (["ERR_ACCESS_DENIED", "EPERM", "EACCES"].includes(code) || /permission|operation not permitted|fetch failed|network|sandbox/iu.test(message)) {
    return "EXTENSION_CAPABILITY_DENIED";
  }
  if (/^EXTENSION_[A-Z_]+:/u.test(message)) return message.slice(0, message.indexOf(":"));
  return "EXTENSION_EXECUTION_FAILED";
}

function publicMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("EXTENSION_")) return message.slice(message.indexOf(":") + 1).trim();
  if (process.env.LA_EXTENSION_HOST_DEBUG === "1") {
    const resource = isRecord(error) && typeof error.resource === "string" ? ` resource=${error.resource}` : "";
    return `${message}${resource}`;
  }
  return "The isolated Extension operation failed.";
}

function assertSupportedExtension(extension: Extension): void {
  const unsupported: string[] = [];
  if (extension.handlers.size > 0) unsupported.push("event handlers");
  if (extension.commands.size > 0) unsupported.push("commands");
  if (extension.flags.size > 0) unsupported.push("flags");
  if (extension.shortcuts.size > 0) unsupported.push("shortcuts");
  if (extension.messageRenderers.size > 0) unsupported.push("message renderers");
  if ((extension.entryRenderers?.size ?? 0) > 0) unsupported.push("entry renderers");
  for (const { definition } of extension.tools.values()) {
    if (definition.prepareArguments) unsupported.push(`${definition.name}.prepareArguments`);
    if (definition.renderCall) unsupported.push(`${definition.name}.renderCall`);
    if (definition.renderResult) unsupported.push(`${definition.name}.renderResult`);
  }
  if (unsupported.length > 0) {
    throw new Error(`EXTENSION_API_UNSUPPORTED: Extension Host v1 does not support ${unsupported.join(", ")}.`);
  }
}

function serializeTool(tool: ToolDefinition): Record<string, unknown> {
  const descriptor: Record<string, unknown> = {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
  };
  if (tool.promptSnippet) descriptor.promptSnippet = tool.promptSnippet;
  if (tool.promptGuidelines) descriptor.promptGuidelines = tool.promptGuidelines;
  if (tool.executionMode) descriptor.executionMode = tool.executionMode;
  JSON.stringify(descriptor);
  return descriptor;
}

function isolatedContext(): ExtensionContext {
  return new Proxy({} as ExtensionContext, {
    get: (_target, property) => {
      if (property === "cwd") return process.cwd();
      if (property === "mode") return "rpc";
      if (property === "hasUI") return false;
      throw new Error(`EXTENSION_API_UNSUPPORTED: Extension context property ${String(property)} is unavailable in Host v1.`);
    },
  });
}

function validateResult(value: unknown): AgentToolResult<unknown> {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new Error("EXTENSION_PROTOCOL_INVALID: Tool result must contain a content array.");
  }
  for (const item of value.content) {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      throw new Error("EXTENSION_API_UNSUPPORTED: Host v1 only supports text tool results.");
    }
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > MAX_MESSAGE_BYTES) {
    throw new Error("EXTENSION_PROTOCOL_INVALID: Tool result exceeded the size limit.");
  }
  return value as unknown as AgentToolResult<unknown>;
}

async function start(plan: HostPlan): Promise<Record<string, unknown>[]> {
  if (plan.schemaVersion !== 1 || plan.apiVersion !== 1 || plan.capabilityGrants.length !== 0) {
    throw new Error("EXTENSION_API_UNSUPPORTED: Invalid Extension Host v1 plan.");
  }
  const settings = SettingsManager.inMemory({}, { projectTrusted: false });
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: process.cwd(),
    settingsManager: settings,
    additionalExtensionPaths: [plan.extensionPath],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload({ resolveProjectTrust: async () => true });
  const loaded = loader.getExtensions();
  if (loaded.errors.length > 0) {
    throw new Error(`EXTENSION_LOAD_FAILED: ${loaded.errors.map((entry) => entry.error).join("; ")}`);
  }
  if (loaded.extensions.length !== 1) {
    throw new Error("EXTENSION_LOAD_FAILED: Host v1 requires exactly one staged Extension.");
  }
  const extension = loaded.extensions[0];
  if (!extension || extension.resolvedPath !== plan.extensionPath) {
    throw new Error("EXTENSION_LOAD_FAILED: Loader did not return the exact staged Extension.");
  }
  assertSupportedExtension(extension);
  for (const [name, registered] of extension.tools) {
    if (tools.has(name)) throw new Error(`EXTENSION_LOAD_FAILED: Duplicate tool ${name}.`);
    tools.set(name, registered.definition);
  }
  return [...tools.values()].map(serializeTool);
}

async function invoke(toolName: string, params: unknown): Promise<AgentToolResult<unknown>> {
  const tool = tools.get(toolName);
  if (!tool) throw new Error(`EXTENSION_TOOL_UNKNOWN: Unknown isolated tool ${toolName}.`);
  return validateResult(await tool.execute(`isolated-${Date.now()}`, params, undefined, undefined, isolatedContext()));
}

for (const method of ["log", "info", "warn", "error", "debug"] as const) {
  console[method] = (...values: unknown[]) => process.stderr.write(`${values.map(String).join(" ")}\n`);
}

sendRaw({ type: "hello", secret });

let parsedPlan: HostPlan;
try {
  parsedPlan = JSON.parse(process.argv[2] ?? "null") as HostPlan;
} catch (error) {
  process.stderr.write(`Invalid Extension Host plan: ${String(error)}\n`);
  process.exit(2);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  void (async () => {
    let requestId = "invalid";
    try {
      if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error("EXTENSION_PROTOCOL_INVALID: Request exceeded the size limit.");
      const request = JSON.parse(line) as unknown;
      if (!isRecord(request) || typeof request.requestId !== "string" || typeof request.operation !== "string") {
        throw new Error("EXTENSION_PROTOCOL_INVALID: Invalid request.");
      }
      requestId = request.requestId;
      let result: unknown;
      if (request.operation === "start") result = await start(parsedPlan);
      else if (request.operation === "invoke") {
        if (typeof request.toolName !== "string") throw new Error("EXTENSION_PROTOCOL_INVALID: Missing tool name.");
        result = await invoke(request.toolName, request.params);
      } else if (request.operation === "dispose") {
        result = { disposed: true };
      } else {
        throw new Error("EXTENSION_PROTOCOL_INVALID: Unknown operation.");
      }
      sendSigned({ requestId, ok: true, result });
      if (request.operation === "dispose") input.close();
    } catch (error) {
      sendSigned({ requestId, ok: false, code: errorCode(error), message: publicMessage(error) });
    }
  })();
});
