import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  RpcExtensionUIRequest,
} from "@earendil-works/pi-coding-agent";
import {
  defaultSubagentAsyncRoot,
  writeJsonFile,
  type SubagentAsyncStatus,
  type TaskDecisionRequestProvenance,
} from "@linguist-agent/cat-data";
import type { TaskPackageResolvedResource } from "./task_package_profile.js";
import { hashTaskPackageResource } from "./task_package_resource_integrity.js";

const MAX_RPC_LINE_BYTES = 4 * 1024 * 1024;
const MAX_EXTENSION_SOURCE_BYTES = 2 * 1024 * 1024;
const UNSUPPORTED_RPC_UI = /(?:\.custom\s*\(|\.(?:setFooter|setHeader|setEditorComponent|addAutocompleteProvider|getEditorComponent|getEditorText|setTheme|getTheme|getAllThemes|onTerminalInput|setWorkingMessage|setWorkingVisible|setWorkingIndicator|setHiddenThinkingLabel|getToolsExpanded|setToolsExpanded)\s*\()/;

export type TeamChildPackageExecution =
  | { mode: "pi_subagents"; blockers: []; provenance?: undefined; extension?: undefined }
  | { mode: "pi_rpc_v1"; blockers: []; provenance?: TaskDecisionRequestProvenance; extension?: TaskPackageResolvedResource }
  | { mode: "blocked"; blockers: string[]; provenance?: undefined; extension?: undefined };

function sha256(bytes: Buffer): string {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

/**
 * Pi RPC v1 carries a child UI request id but not the originating Extension.
 * LA therefore permits this adapter only when exactly one executable Package
 * Extension is loaded. That makes the package/resource caller provenance
 * deterministic instead of guessing among multiple Extension candidates.
 */
export async function resolveTeamChildPackageExecution(
  resources: readonly TaskPackageResolvedResource[],
): Promise<TeamChildPackageExecution> {
  if (resources.length === 0) return { mode: "pi_subagents", blockers: [] };
  for (const resource of resources) {
    let actualIntegrity: string;
    try {
      actualIntegrity = await hashTaskPackageResource(resource.path);
    } catch (error) {
      return {
        mode: "blocked",
        blockers: [`Team child RPC could not verify ${resource.packageName}@${resource.version} (${resource.resourceId}): ${error instanceof Error ? error.message : String(error)}`],
      };
    }
    if (actualIntegrity !== resource.integrity) {
      return {
        mode: "blocked",
        blockers: [`Team child RPC resource bytes changed after selection: ${resource.packageName}@${resource.version} (${resource.resourceId}).`],
      };
    }
  }
  const extensions = resources.filter((resource) => resource.resourceType === "extension");
  if (extensions.some((resource) => !resource.executable)) {
    return {
      mode: "blocked",
      blockers: ["Team child RPC accepts only digest-approved Package-origin Extensions; top-level executable resources are not part of a Task Package approval."],
    };
  }
  if (extensions.length === 0) return { mode: "pi_rpc_v1", blockers: [] };
  if (extensions.length !== 1) {
    return {
      mode: "blocked",
      blockers: [
        "Pi RPC v1 does not identify the Extension that emitted a child UI request. Select at most one executable Package extension for a Team Run so LA can preserve exact caller provenance.",
      ],
    };
  }

  const extension = extensions[0]!;
  let info;
  let bytes: Buffer;
  try {
    info = await lstat(extension.path);
    if (!info.isFile() || info.size > MAX_EXTENSION_SOURCE_BYTES) {
      return {
        mode: "blocked",
        blockers: [`Team child RPC requires one regular Extension file no larger than ${MAX_EXTENSION_SOURCE_BYTES} bytes: ${extension.resourceId}.`],
      };
    }
    bytes = await readFile(extension.path);
  } catch (error) {
    return {
      mode: "blocked",
      blockers: [`Team child RPC could not read ${extension.packageName}@${extension.version} (${extension.resourceId}): ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  // Regular Extension files use the same digest as the generic resource
  // fingerprint. Keep this local assertion next to the source compatibility
  // scan so a future hashing change cannot silently desynchronize the two.
  if (sha256(bytes) !== extension.integrity) throw new Error(`Team child RPC Extension integrity implementation mismatch: ${extension.resourceId}.`);
  if (UNSUPPORTED_RPC_UI.test(bytes.toString("utf8"))) {
    return {
      mode: "blocked",
      blockers: [
        `Team child RPC supports native select, confirm, input, editor, notify, status, string-widget, title, and editor-text requests only. ${extension.packageName}@${extension.version} (${extension.resourceId}) uses custom UI that Pi RPC v1 cannot represent.`,
      ],
    };
  }

  return {
    mode: "pi_rpc_v1",
    blockers: [],
    extension,
    provenance: {
      kind: "package_extension",
      transport: "pi-rpc-v1",
      packageSource: extension.packageSource,
      packageName: extension.packageName,
      packageVersion: extension.version,
      resourceId: extension.resourceId,
      integrity: extension.integrity,
    },
  };
}

interface RpcResponse {
  type: "response";
  id: string;
  success: boolean;
  error?: string;
}

interface PendingCommand {
  resolve(value: RpcResponse): void;
  reject(error: Error): void;
}

export interface StartTeamChildRpcRunInput {
  verifiedPiBinaryPath: string;
  cwd: string;
  cliArgs: string[];
  env?: NodeJS.ProcessEnv;
  prompt: string;
  runId: string;
  agent: string;
  model?: string;
  asyncDir?: string;
  uiContext: ExtensionUIContext;
  commandTimeoutMs?: number;
}

export interface BuildTeamChildRpcCliArgsInput {
  sessionDir: string;
  sessionId: string;
  model?: string;
  systemPromptPath: string;
  allowedToolNames: string[];
  extensionPaths: string[];
  skillPaths?: string[];
  promptTemplatePaths?: string[];
}

/** Build an isolated Pi CLI resource graph; ambient user/project resources stay off. */
export function buildTeamChildRpcCliArgs(input: BuildTeamChildRpcCliArgsInput): string[] {
  const paths = [
    input.sessionDir,
    input.systemPromptPath,
    ...input.extensionPaths,
    ...(input.skillPaths ?? []),
    ...(input.promptTemplatePaths ?? []),
  ];
  if (paths.some((path) => !isAbsolute(path))) throw new Error("Team child RPC resource paths must be absolute.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(input.sessionId)) throw new Error("Team child RPC sessionId is invalid.");
  if (!input.extensionPaths.length) throw new Error("Team child RPC requires the server-owned evidence Extension.");
  const args = [
    "--session-dir", input.sessionDir,
    "--session-id", input.sessionId,
    "--no-extensions",
    ...input.extensionPaths.flatMap((path) => ["--extension", path]),
    "--no-skills",
    ...(input.skillPaths ?? []).flatMap((path) => ["--skill", path]),
    "--no-prompt-templates",
    ...(input.promptTemplatePaths ?? []).flatMap((path) => ["--prompt-template", path]),
    "--no-themes",
    "--no-context-files",
    "--system-prompt", input.systemPromptPath,
    "--tools", [...new Set(input.allowedToolNames)].join(","),
  ];
  if (input.model) args.push("--model", input.model);
  return args;
}

export interface TeamChildRpcCompletion {
  state: "complete" | "failed";
  runId: string;
  asyncDir: string;
  outputFile: string;
  error?: string;
}

export interface TeamChildRpcRunHandle {
  runId: string;
  asyncDir: string;
  outputFile: string;
  abort(): Promise<void>;
  stop(): Promise<void>;
  completion: Promise<TeamChildRpcCompletion>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function optionalTimeout(value: unknown): ExtensionUIDialogOptions | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? { timeout: value } : undefined;
}

function assistantText(value: Record<string, unknown>): string | undefined {
  if (value.type !== "message_end") return undefined;
  const message = object(value.message);
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return undefined;
  const output = message.content.flatMap((part) => {
    const row = object(part);
    return row?.type === "text" && typeof row.text === "string" ? [row.text] : [];
  }).join("\n").trim();
  return output || undefined;
}

function assertInsideAsyncRoot(asyncDir: string): void {
  const root = resolve(defaultSubagentAsyncRoot());
  const candidate = resolve(asyncDir);
  const rel = relative(root, candidate);
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
    throw new Error(`Team child RPC async directory must be a child of ${root}.`);
  }
}

async function terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

export async function startTeamChildRpcRun(input: StartTeamChildRpcRunInput): Promise<TeamChildRpcRunHandle> {
  if (!isAbsolute(input.verifiedPiBinaryPath)) throw new Error("Verified Pi child binary path must be absolute.");
  if (!input.prompt.trim()) throw new Error("Team child RPC prompt must not be empty.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(input.runId)) throw new Error("Team child RPC runId is invalid.");
  const asyncDir = resolve(input.asyncDir ?? join(defaultSubagentAsyncRoot(), input.runId));
  assertInsideAsyncRoot(asyncDir);
  await mkdir(asyncDir, { recursive: true, mode: 0o700 });
  const outputFile = join(asyncDir, "output-0.log");
  const statusFile = join(asyncDir, "status.json");
  const startedAt = Date.now();
  const baseStatus: SubagentAsyncStatus = {
    lifecycleArtifactVersion: 1,
    runId: input.runId,
    mode: "single",
    state: "running",
    agent: input.agent,
    startedAt,
    lastUpdate: startedAt,
    cwd: input.cwd,
    outputFile,
    steps: [{ agent: input.agent, model: input.model, status: "running" }],
  };
  await writeJsonFile(statusFile, baseStatus);

  const child = spawn(input.verifiedPiBinaryPath, ["--mode", "rpc", ...input.cliArgs], {
    cwd: input.cwd,
    env: input.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<string, PendingCommand>();
  const uiWork = new Set<Promise<void>>();
  let requestIndex = 0;
  let latestAssistantText: string | undefined;
  let settled = false;
  let aborted = false;
  let stderr = "";
  let resolveSettled!: () => void;
  let rejectSettled!: (error: Error) => void;
  const settledPromise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveSettled = resolvePromise;
    rejectSettled = rejectPromise;
  });
  // A spawn/pipe error can reject this before the prompt acknowledgement
  // resolves. The completion path still awaits the original promise when it
  // reaches that phase; this observer only prevents a premature rejection
  // from becoming an unhandled process-level error.
  void settledPromise.catch(() => undefined);

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });

  const write = (value: Record<string, unknown>): void => {
    if (!child.stdin.writable || child.stdin.destroyed) throw new Error(`Pi RPC child stdin is unavailable. ${stderr}`.trim());
    child.stdin.write(`${JSON.stringify(value)}\n`);
  };

  const sendCommand = (command: Record<string, unknown>): Promise<RpcResponse> => {
    const id = `la-child-${++requestIndex}-${randomUUID()}`;
    return new Promise<RpcResponse>((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCommand(new Error(`Timed out waiting for Pi RPC child command ${String(command.type ?? "unknown")}.`));
      }, input.commandTimeoutMs ?? 15_000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolveCommand(value); },
        reject: (error) => { clearTimeout(timer); rejectCommand(error); },
      });
      try {
        write({ ...command, id });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        rejectCommand(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const answerDialog = (id: string, result: string | boolean | undefined): void => {
    if (typeof result === "boolean") write({ type: "extension_ui_response", id, confirmed: result });
    else if (typeof result === "string") write({ type: "extension_ui_response", id, value: result });
    else write({ type: "extension_ui_response", id, cancelled: true });
  };

  const handleUi = async (request: RpcExtensionUIRequest): Promise<void> => {
    const row = request as unknown as Record<string, unknown>;
    const id = text(row.id, "Pi RPC UI id");
    switch (request.method) {
      case "select":
        answerDialog(id, await input.uiContext.select(request.title, request.options, optionalTimeout(request.timeout)));
        return;
      case "confirm":
        answerDialog(id, await input.uiContext.confirm(request.title, request.message, optionalTimeout(request.timeout)));
        return;
      case "input":
        answerDialog(id, await input.uiContext.input(request.title, request.placeholder, optionalTimeout(request.timeout)));
        return;
      case "editor":
        answerDialog(id, await input.uiContext.editor(request.title, request.prefill));
        return;
      case "notify":
        input.uiContext.notify(request.message, request.notifyType);
        return;
      case "setStatus":
        input.uiContext.setStatus(request.statusKey, request.statusText);
        return;
      case "setWidget":
        input.uiContext.setWidget(request.widgetKey, request.widgetLines, request.widgetPlacement ? { placement: request.widgetPlacement } : undefined);
        return;
      case "setTitle":
        input.uiContext.setTitle(request.title);
        return;
      case "set_editor_text":
        input.uiContext.setEditorText(request.text);
        return;
      default:
        throw new Error(`Pi RPC child emitted unsupported Extension UI method: ${String(row.method)}.`);
    }
  };

  const fail = (error: Error): void => {
    if (settled) return;
    settled = true;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    rejectSettled(error);
  };

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (Buffer.byteLength(line) > MAX_RPC_LINE_BYTES) {
      fail(new Error("Pi RPC child emitted an oversized JSONL record."));
      return;
    }
    let value: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      value = object(parsed) ?? (() => { throw new Error("Pi RPC child emitted a non-object JSONL record."); })();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (value.type === "response" && typeof value.id === "string") {
      const waiter = pending.get(value.id);
      if (!waiter) return;
      pending.delete(value.id);
      const response = value as unknown as RpcResponse;
      if (response.success) waiter.resolve(response);
      else waiter.reject(new Error(response.error ?? "Pi RPC child command failed."));
      return;
    }
    if (value.type === "extension_ui_request") {
      const work = handleUi(value as unknown as RpcExtensionUIRequest).catch((error) => {
        try {
          if (typeof value.id === "string") write({ type: "extension_ui_response", id: value.id, cancelled: true });
        } catch {
          // The original UI failure is more useful than a secondary closed-pipe error.
        }
        fail(error instanceof Error ? error : new Error(String(error)));
      });
      uiWork.add(work);
      void work.finally(() => uiWork.delete(work));
      return;
    }
    if (value.type === "extension_error") {
      fail(new Error(`Pi RPC child Extension failed (${String(value.extensionPath ?? "unknown")} / ${String(value.event ?? "unknown")}): ${String(value.error ?? "unknown error")}`));
      return;
    }
    latestAssistantText = assistantText(value) ?? latestAssistantText;
    if (value.type === "agent_settled" && !settled) {
      settled = true;
      resolveSettled();
    }
  });
  child.once("error", (error) => fail(new Error(`Pi RPC child failed to start: ${error.message}`)));
  child.once("exit", (code, signal) => {
    if (!settled) fail(new Error(`Pi RPC child exited before settling (code=${code} signal=${signal}). ${stderr}`.trim()));
  });

  const completion = (async (): Promise<TeamChildRpcCompletion> => {
    let failure: Error | undefined;
    try {
      await sendCommand({ type: "prompt", message: input.prompt });
      await settledPromise;
      await Promise.all([...uiWork]);
      if (aborted) throw new Error("Team child RPC Run was stopped.");
      if (!latestAssistantText) throw new Error("Pi RPC child settled without a final assistant text result.");
      await writeFile(outputFile, latestAssistantText, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      if (!settled) {
        settled = true;
        for (const waiter of pending.values()) waiter.reject(failure);
        pending.clear();
        resolveSettled();
      }
      await writeFile(outputFile, "", { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
    }
    const endedAt = Date.now();
    const state = failure ? "failed" as const : "complete" as const;
    await writeJsonFile(statusFile, {
      ...baseStatus,
      state,
      endedAt,
      lastUpdate: endedAt,
      steps: [{ agent: input.agent, model: input.model, status: state }],
      ...(failure ? { error: failure.message } : {}),
    } satisfies SubagentAsyncStatus);
    lines.close();
    await terminate(child);
    return {
      state,
      runId: input.runId,
      asyncDir,
      outputFile,
      ...(failure ? { error: failure.message } : {}),
    };
  })();

  const abort = async (): Promise<void> => {
    if (aborted) return;
    aborted = true;
    try {
      // Pi RPC command ids are optional. Stop is fire-and-forget here so a
      // wedged child cannot make canonical Stop wait for another RPC timeout.
      write({ type: "abort" });
    } catch {
      // Completion records the stopped result even when the pipe is closed.
    }
    const stopped = new Error("Team child RPC Run was stopped.");
    for (const waiter of pending.values()) waiter.reject(stopped);
    pending.clear();
    if (!settled) {
      settled = true;
      resolveSettled();
    }
  };

  return { runId: input.runId, asyncDir, outputFile, abort, stop: abort, completion };
}
