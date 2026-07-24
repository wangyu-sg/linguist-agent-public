import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { handshakeProblem, resolveAPIURL, resolveServerBaseURL } from "./desktop-security.mjs";
import { requestUnixRuntime, runtimeTransportPaths } from "./runtime-transport.mjs";

const run = promisify(execFile);
const KEYCHAIN_SERVICE = "com.linguist-agent.local-transport";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
let cachedCredential;

async function readCredential(environment) {
  const explicit = environment.LA_LOCAL_API_TOKEN?.trim();
  if (explicit) return explicit;
  if (cachedCredential) return cachedCredential;
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await run("/usr/bin/security", [
      "find-generic-password",
      "-a",
      userInfo().username,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ], { maxBuffer: 4096 });
    cachedCredential = stdout.trim() || undefined;
    return cachedCredential ?? null;
  } catch {
    return null;
  }
}

function legacyLoopbackEnabled(environment) {
  return environment.LA_LOCAL_TRANSPORT_MODE === "loopback";
}

async function requestLocalRuntime(input, environment, credential) {
  if (legacyLoopbackEnabled(environment)) {
    return fetch(resolveAPIURL(resolveServerBaseURL(environment), input.path), {
      method: input.method,
      headers: {
        authorization: `Bearer ${credential}`,
        ...(input.headers ?? {}),
      },
      body: input.body,
      signal: input.signal,
    });
  }
  const paths = runtimeTransportPaths(environment.LA_RUNTIME_TRANSPORT_ROOT?.trim() || undefined);
  return requestUnixRuntime({
    ...paths,
    bootstrapToken: credential,
    method: input.method,
    path: input.path,
    headers: input.headers,
    body: input.body,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    expectedRoot: paths.root,
  });
}

export async function requestRuntime(input, environment = process.env) {
  const method = typeof input?.method === "string" ? input.method.toUpperCase() : "";
  if (!ALLOWED_METHODS.has(method)) throw new Error("Unsupported LA API method.");
  const path = resolveAPIURL("http://127.0.0.1", input?.path).replace("http://127.0.0.1", "");
  const credential = await readCredential(environment);
  if (!credential) throw new Error("Local runtime credential is unavailable.");

  const response = await requestLocalRuntime({
    method,
    path,
    headers: input.body === undefined ? undefined : { "content-type": "application/json" },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(60_000),
  }, environment, credential);
  const text = await response.text();
  if (response.status === 401) cachedCredential = undefined;
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: response.ok, status: response.status, data };
}

function requiredId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) throw new Error(`${label} is invalid.`);
  return value.trim();
}

async function consumeSSE(response, onEvent, signal) {
  if (!response.body) throw new Error("LA stream returned no body.");
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks = response.body && typeof response.body.getReader === "function"
    ? (async function* () {
      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        yield value;
      }
    })()
    : response.body;
  for await (const value of chunks) {
    if (signal.aborted) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replaceAll("\r\n", "\n");
    if (buffer.length > 16 * 1024 * 1024) throw new Error("LA stream event exceeded the desktop limit.");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try { onEvent(JSON.parse(data)); } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
}

function waitForReconnect(milliseconds, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function streamTaskEvents(input, handlers, environment = process.env) {
  const taskId = requiredId(input?.taskId, "taskId");
  const kind = input?.kind === "standalone" ? "standalone" : "project";
  const projectId = kind === "project" ? requiredId(input?.projectId, "projectId") : null;
  let cursor = typeof input?.afterCursor === "string" && input.afterCursor.trim() ? input.afterCursor.trim() : `${taskId}:0`;
  if (cursor.length > 1_024) throw new Error("afterCursor is invalid.");
  let attempt = 0;
  try {
    while (!handlers.signal.aborted) {
      if (attempt) {
        handlers.onState({ status: "reconnecting", message: "正在恢复 Task 事件连接。" });
        await waitForReconnect(Math.min(5_000, 250 * (2 ** Math.min(attempt - 1, 5))), handlers.signal);
        if (handlers.signal.aborted) break;
      }
      try {
        const credential = await readCredential(environment);
        if (!credential) throw new Error("Local runtime credential is unavailable.");
        const path = kind === "standalone"
          ? `/api/tasks/${encodeURIComponent(taskId)}/events/stream?after=${encodeURIComponent(cursor)}`
          : `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/events/stream?after=${encodeURIComponent(cursor)}`;
        const response = await requestLocalRuntime({
          method: "GET",
          path,
          signal: handlers.signal,
        }, environment, credential);
        if (response.status === 401) {
          cachedCredential = undefined;
          handlers.onState({ status: "error", message: "本机 runtime 凭据已失效。" });
          return;
        }
        if (!response.ok) throw new Error(`Task event stream returned HTTP ${response.status}.`);
        attempt = 0;
        handlers.onState({ status: "connected" });
        await consumeSSE(response, (event) => {
          if (event && typeof event.cursor === "string") cursor = event.cursor;
          handlers.onEvent(event);
        }, handlers.signal);
        if (!handlers.signal.aborted) attempt = 1;
      } catch (error) {
        if (handlers.signal.aborted) break;
        attempt += 1;
        if (attempt >= 8) {
          handlers.onState({ status: "error", message: error instanceof Error ? error.message : "Task 事件连接失败。" });
          return;
        }
      }
    }
  } finally {
    handlers.onState({ status: "closed" });
  }
}

export async function streamTaskChat(input, handlers, environment = process.env) {
  const projectId = requiredId(input?.projectId, "projectId");
  const taskId = requiredId(input?.taskId, "taskId");
  if (typeof input?.message !== "string" || !input.message.trim()) throw new Error("message is required.");
  const credential = await readCredential(environment);
  if (!credential) throw new Error("Local runtime credential is unavailable.");
  const path = `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/chat/stream`;
  try {
    const response = await requestLocalRuntime({
      method: "POST",
      path,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        ...(typeof input.runId === "string" && input.runId.trim() ? { runId: input.runId.trim() } : {}),
        ...(typeof input.segmentId === "string" && input.segmentId.trim() ? { segmentId: input.segmentId.trim() } : {}),
        ...(typeof input.modelProvider === "string" && input.modelProvider.trim() ? { modelProvider: input.modelProvider.trim() } : {}),
        ...(typeof input.modelId === "string" && input.modelId.trim() ? { modelId: input.modelId.trim() } : {}),
        ...(typeof input.thinkingLevel === "string" && input.thinkingLevel.trim() ? { thinkingLevel: input.thinkingLevel.trim() } : {}),
        ...(Array.isArray(input.assetPaths) ? { assetPaths: input.assetPaths } : {}),
        ...(Array.isArray(input.capabilityIds) ? { capabilityIds: input.capabilityIds } : {}),
      }),
      signal: handlers.signal,
    }, environment, credential);
    if (response.status === 401) cachedCredential = undefined;
    if (!response.ok) throw new Error(`Task chat stream returned HTTP ${response.status}.`);
    handlers.onState({ status: "connected" });
    await consumeSSE(response, handlers.onEvent, handlers.signal);
  } catch (error) {
    if (!handlers.signal.aborted) handlers.onState({ status: "error", message: error instanceof Error ? error.message : "Task 对话连接失败。" });
  } finally {
    handlers.onState({ status: "closed" });
  }
}

export async function streamStandaloneChat(input, handlers, environment = process.env) {
  const taskId = requiredId(input?.taskId, "taskId");
  if (typeof input?.message !== "string" || !input.message.trim()) throw new Error("message is required.");
  if (input?.delivery !== undefined && !["auto", "steer", "follow_up"].includes(input.delivery)) {
    throw new Error("delivery is invalid.");
  }
  const credential = await readCredential(environment);
  if (!credential) throw new Error("Local runtime credential is unavailable.");
  const path = `/api/tasks/${encodeURIComponent(taskId)}/messages/stream`;
  try {
    const response = await requestLocalRuntime({
      method: "POST",
      path,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.message.trim(),
        ...(typeof input.delivery === "string" ? { delivery: input.delivery } : {}),
        ...(typeof input.agentThreadId === "string" && input.agentThreadId.trim() ? { agentThreadId: input.agentThreadId.trim() } : {}),
        ...(typeof input.modelProvider === "string" && input.modelProvider.trim() ? { modelProvider: input.modelProvider.trim() } : {}),
        ...(typeof input.modelId === "string" && input.modelId.trim() ? { modelId: input.modelId.trim() } : {}),
        ...(typeof input.thinkingLevel === "string" && input.thinkingLevel.trim() ? { thinkingLevel: input.thinkingLevel.trim() } : {}),
      }),
      signal: handlers.signal,
    }, environment, credential);
    if (response.status === 401) cachedCredential = undefined;
    if (!response.ok) throw new Error(`Standalone chat stream returned HTTP ${response.status}.`);
    handlers.onState({ status: "connected" });
    await consumeSSE(response, handlers.onEvent, handlers.signal);
  } catch (error) {
    if (!handlers.signal.aborted) handlers.onState({ status: "error", message: error instanceof Error ? error.message : "Standalone Chat connection failed." });
  } finally {
    handlers.onState({ status: "closed" });
  }
}

async function get(path, environment, credential) {
  return requestLocalRuntime({
    method: "GET",
    path,
    signal: AbortSignal.timeout(5_000),
    timeoutMs: 5_000,
  }, environment, credential);
}

export async function inspectRuntime(environment = process.env) {
  const baseURL = legacyLoopbackEnabled(environment) ? resolveServerBaseURL(environment) : "unix://authenticated-rendezvous";
  if (!legacyLoopbackEnabled(environment)) {
    const paths = runtimeTransportPaths(environment.LA_RUNTIME_TRANSPORT_ROOT?.trim() || undefined);
    try {
      await access(paths.rendezvousPath);
    } catch {
      return { status: "offline", message: "无法连接本机 Linguist Agent runtime。", baseURL };
    }
  }
  const credential = await readCredential(environment);
  if (!credential) {
    return { status: "credential-unavailable", message: "未能从登录钥匙串读取本机安装凭据。", baseURL };
  }
  let health;
  try {
    const response = await get("/api/health", environment, credential);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health = await response.json();
  } catch {
    return { status: "offline", message: "无法连接本机 Linguist Agent runtime。", baseURL };
  }

  const incompatibility = handshakeProblem(health);
  const runtime = {
    productVersion: typeof health.productVersion === "string" ? health.productVersion : "—",
    piVersion: typeof health.pi === "string" ? health.pi : "—",
    protocolVersion: typeof health.apiProtocolVersion === "number" ? health.apiProtocolVersion : null,
  };
  if (incompatibility) return { status: "incompatible", message: incompatibility, baseURL, runtime };

  try {
    const response = await get("/api/projects", environment, credential);
    await response.arrayBuffer();
    if (response.status === 401) {
      cachedCredential = undefined;
      return { status: "credential-rejected", message: "钥匙串凭据与当前 runtime 不匹配。", baseURL, runtime };
    }
    if (!response.ok) {
      return { status: "error", message: `runtime 返回 HTTP ${response.status}。`, baseURL, runtime };
    }
    return { status: "ready", message: "本机工作区已就绪。", baseURL, runtime };
  } catch {
    return { status: "offline", message: "runtime 在认证检查期间断开连接。", baseURL, runtime };
  }
}
