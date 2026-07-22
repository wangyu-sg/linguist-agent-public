import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  defaultSubagentAsyncRoot,
  TEAM_EVIDENCE_TOOL_NAMES,
  type TaskActivity,
  type TaskRunEventDraft,
  type TaskToolEffect,
} from "@linguist-agent/cat-data";

const CAT_EVIDENCE_TOOLS = new Set<string>(TEAM_EVIDENCE_TOOL_NAMES);

const GENERIC_READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob", "web_search", "web_fetch", "fetch_content"]);
const WRITE_TOOL_PATTERN = /(?:^|_)(?:write|edit|set|apply|import|export|save|delete|remove|create|update)(?:_|$)/i;

interface PiSubagentEvent extends Record<string, unknown> {
  type?: string;
  observedAt?: number;
  ts?: number;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  message?: unknown;
  event?: unknown;
  error?: unknown;
}

export interface SubagentTaskActivityBridgeInput {
  asyncDir: string;
  asyncRoot?: string;
  subagentRunId: string;
  taskId: string;
  runId: string;
  agentThreadId: string;
  roleId: string;
  displayName: string;
  existingActivityIds?: Iterable<string>;
  firstSeq: number;
  fallbackTimestamp: string;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function bounded(value: string, limit = 800): string {
  const text = value.trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 14)}... [truncated]`;
}

function contentText(value: unknown): string {
  const row = object(value);
  const content = Array.isArray(row?.content) ? row.content : [];
  return content
    .flatMap((part) => {
      const item = object(part);
      return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
    })
    .join("\n")
    .trim();
}

function eventTimestamp(event: PiSubagentEvent, fallback: string): string {
  const message = object(event.message);
  const control = object(event.event);
  const value = event.observedAt ?? event.ts ?? control?.ts ?? message?.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return fallback;
}

export function taskToolEffect(name: string): TaskToolEffect {
  if (CAT_EVIDENCE_TOOLS.has(name) || GENERIC_READ_TOOLS.has(name)) return "read";
  if (WRITE_TOOL_PATTERN.test(name) || name === "write" || name === "edit") return "write";
  return "execute";
}

export function isCatEvidenceTool(name: string): boolean {
  return CAT_EVIDENCE_TOOLS.has(name);
}

function toolTarget(args: unknown): string | null {
  const row = object(args);
  if (!row) return null;
  for (const key of ["path", "file", "filePath", "segmentId", "batchId", "query", "url"]) {
    const value = row[key];
    if (typeof value !== "string" || !value.trim()) continue;
    if (key === "url") {
      try {
        const url = new URL(value);
        return bounded(`${url.origin}${url.pathname}`, 240);
      } catch {
        return bounded(value.split(/[?#]/, 1)[0]!, 240);
      }
    }
    return bounded(value, 240);
  }
  return null;
}

function evidenceRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const evidence = /^\s*Evidence\s*:\s*(.+?)\s*$/.exec(line)?.[1];
    const file = /^\s*[-*]\s+(.+?):(\d+):\s+/.exec(line);
    const ref = evidence?.trim() || (file ? `${file[1]!.trim()}:${file[2]}` : undefined);
    if (ref) refs.add(bounded(ref, 300));
  }
  return [...refs];
}

function activity(input: SubagentTaskActivityBridgeInput, lineNo: number, suffix: string, value: Omit<TaskActivity, "id" | "taskId" | "runId" | "agentThreadId" | "seq" | "actor" | "createdAt" | "updatedAt"> & { timestamp: string }): TaskRunEventDraft {
  const id = `pi.${input.subagentRunId}.${lineNo}.${suffix}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return {
    type: "activity_append",
    agentThreadId: input.agentThreadId,
    occurredAt: value.timestamp,
    activity: {
      id,
      taskId: input.taskId,
      runId: input.runId,
      agentThreadId: input.agentThreadId,
      seq: 0,
      type: value.type,
      status: value.status,
      actor: { kind: "agent", id: input.roleId, displayName: input.displayName, agentThreadId: input.agentThreadId },
      title: value.title,
      body: value.body,
      tool: value.tool,
      refs: value.refs,
      createdAt: value.timestamp,
      updatedAt: value.timestamp,
    },
  };
}

function projectEvent(input: SubagentTaskActivityBridgeInput, event: PiSubagentEvent, lineNo: number): TaskRunEventDraft | undefined {
  const timestamp = eventTimestamp(event, input.fallbackTimestamp);
  if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
    const evidence = CAT_EVIDENCE_TOOLS.has(event.toolName);
    const target = toolTarget(event.args);
    return activity(input, lineNo, "tool-start", {
      timestamp,
      type: evidence ? "evidence_read" : "tool_action",
      status: "running",
      title: `${input.displayName} started ${event.toolName}`,
      body: target,
      tool: { name: event.toolName, effect: taskToolEffect(event.toolName), target, outcome: null },
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
    });
  }
  if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
    const evidence = CAT_EVIDENCE_TOOLS.has(event.toolName);
    const text = evidence ? contentText(event.result) : "";
    return activity(input, lineNo, "tool-end", {
      timestamp,
      type: evidence ? "evidence_read" : "tool_action",
      status: event.isError ? "error" : "done",
      title: `${input.displayName} ${event.isError ? "failed" : "completed"} ${event.toolName}`,
      body: text ? bounded(text) : null,
      tool: { name: event.toolName, effect: taskToolEffect(event.toolName), target: null, outcome: event.isError ? "failed" : "completed" },
      refs: { artifactIds: [], evidenceRefs: evidence ? evidenceRefs(text) : [], decisionIds: [] },
    });
  }
  if (event.type === "turn_start" || event.type === "agent_start") {
    return activity(input, lineNo, "turn-start", {
      timestamp,
      type: "progress",
      status: "running",
      title: event.type === "agent_start" ? `${input.displayName} started` : `${input.displayName} started a turn`,
      body: null,
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
    });
  }
  if (event.type === "turn_end" || event.type === "agent_end") {
    return activity(input, lineNo, "turn-end", {
      timestamp,
      type: "progress",
      status: "done",
      title: event.type === "agent_end" ? `${input.displayName} finished` : `${input.displayName} completed a turn`,
      body: null,
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
    });
  }
  if (event.type === "message_end") {
    const message = object(event.message);
    if (message?.role !== "assistant") return undefined;
    const error = typeof message.errorMessage === "string" ? message.errorMessage : undefined;
    const text = contentText(message);
    if (!error && !text) return undefined;
    return activity(input, lineNo, error ? "message-error" : "message", {
      timestamp,
      type: error ? "error" : "progress",
      status: error ? "error" : "done",
      title: error ? `${input.displayName} response failed` : `${input.displayName} reported progress`,
      body: bounded(error ?? text),
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
    });
  }
  const control = object(event.event);
  if (event.type === "subagent.control" && control?.type === "needs_attention") {
    return activity(input, lineNo, "needs-attention", {
      timestamp,
      type: "progress",
      status: "blocked",
      title: `${input.displayName} needs attention`,
      body: typeof control.message === "string" ? bounded(control.message) : null,
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
    });
  }
  if (event.type === "subagent.step.paused") {
    return activity(input, lineNo, "paused", {
      timestamp,
      type: "progress",
      status: "blocked",
      title: `${input.displayName} paused`,
      body: typeof event.error === "string" ? bounded(event.error) : null,
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
    });
  }
  if (event.type === "subagent.step.failed" || event.type === "subagent.run.timed_out" || event.type === "subagent.run.repaired_stale" || event.type === "subagent.events.truncated") {
    const message = typeof event.error === "string" ? event.error : typeof event.message === "string" ? event.message : event.type.replaceAll(".", " ");
    return activity(input, lineNo, "error", {
      timestamp,
      type: "error",
      status: "error",
      title: `${input.displayName} failed`,
      body: bounded(message),
      tool: null,
      refs: { artifactIds: [], evidenceRefs: [], decisionIds: [] },
    });
  }
  return undefined;
}

export async function readSubagentTaskActivityDrafts(input: SubagentTaskActivityBridgeInput): Promise<TaskRunEventDraft[]> {
  const root = resolve(input.asyncRoot ?? defaultSubagentAsyncRoot());
  const dir = resolve(input.asyncDir);
  if (!inside(root, dir)) throw new Error(`Subagent async dir must be inside ${root}.`);
  let raw: string;
  try {
    raw = await readFile(join(dir, "events.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const existing = new Set(input.existingActivityIds ?? []);
  const drafts: TaskRunEventDraft[] = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    let event: PiSubagentEvent;
    try {
      event = JSON.parse(line) as PiSubagentEvent;
    } catch (error) {
      if (index === lines.length - 1 || (index === lines.length - 2 && !lines.at(-1)?.trim())) continue;
      throw new Error(`Invalid pi-subagents events JSONL at line ${index + 1}: ${(error as Error).message}`);
    }
    const draft = projectEvent(input, event, index + 1);
    if (!draft?.activity || existing.has(draft.activity.id)) continue;
    draft.activity.seq = input.firstSeq + drafts.length;
    drafts.push(draft);
  }
  return drafts;
}
