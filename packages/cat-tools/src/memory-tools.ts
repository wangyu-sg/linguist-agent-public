import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendMemoryAudit } from "@linguist-agent/cat-data";
import type { CatWorkspace, MemoryConfig } from "@linguist-agent/cat-data";

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function gatewayPost<T>(gatewayUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${gatewayUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TDAI Gateway ${path} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function gatewayHealthy(gatewayUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export interface MemoryRecallMetadata {
  source: "tencentdb-agent-memory";
  projectId: string;
  gatewayUrl: string;
  queriedAt: string;
  query: string;
  limit: number;
  total: number;
  strategy: string;
  cacheSafety: "tool_tail_only";
  evidencePolicy: "memory_is_recall_not_citable_evidence";
}

function memoryRecallMetadata(input: {
  config: MemoryConfig;
  projectId: string;
  query: string;
  limit: number;
  total: number;
  strategy: string;
}): MemoryRecallMetadata {
  return {
    source: "tencentdb-agent-memory",
    projectId: input.projectId,
    gatewayUrl: input.config.gatewayUrl,
    queriedAt: new Date().toISOString(),
    query: input.query,
    limit: input.limit,
    total: input.total,
    strategy: input.strategy,
    cacheSafety: "tool_tail_only",
    evidencePolicy: "memory_is_recall_not_citable_evidence",
  };
}

async function safeAppendMemoryAudit(workspace: CatWorkspace | undefined, event: Parameters<typeof appendMemoryAudit>[1]): Promise<void> {
  if (!workspace) return;
  try {
    await appendMemoryAudit(workspace, event);
  } catch (err) {
    console.error(`[memory] audit write failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Capture (called after each agent turn, not an LLM-callable tool) ──────────

export async function captureMemoryTurn(opts: {
  gatewayUrl: string;
  projectId: string;
  userContent: string;
  assistantContent: string;
  sessionId?: string;
  auditWorkspace?: CatWorkspace;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const { gatewayUrl, projectId, userContent, assistantContent, sessionId, auditWorkspace } = opts;
  if (!userContent.trim() || !assistantContent.trim()) return { ok: true, skipped: true };
  try {
    await gatewayPost(gatewayUrl, "/capture", {
      user_content: userContent,
      assistant_content: assistantContent,
      session_key: projectId,
      session_id: sessionId,
    });
    await safeAppendMemoryAudit(auditWorkspace, {
      kind: "capture_success",
      gatewayUrl,
      sessionId,
      contentPreview: userContent.slice(0, 180),
    });
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await safeAppendMemoryAudit(auditWorkspace, {
      kind: "capture_failed",
      gatewayUrl,
      sessionId,
      contentPreview: userContent.slice(0, 180),
      error,
    });
    // Non-fatal — log but never block the CAT workflow
    console.error(`[memory] capture failed: ${error}`);
    return { ok: false, error };
  }
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const memorySearchParameters = Type.Object({
  query: Type.String({
    description: "What to search for in past session memory (e.g. 'preferred translation for 技能', 'client style guide rules').",
  }),
  limit: Type.Optional(
    Type.Number({ description: "Max results to return (default 5).", minimum: 1, maximum: 20 }),
  ),
});

const memoryStoreParameters = Type.Object({
  content: Type.String({
    description: "The fact, decision, or preference to store (plain text, be specific).",
  }),
  context: Type.Optional(
    Type.String({ description: "Additional context or why this matters (optional)." }),
  ),
});

// ── memory_search tool ────────────────────────────────────────────────────────

export function createMemorySearchTool(config: MemoryConfig, projectId: string, auditWorkspace?: CatWorkspace) {
  return defineTool<typeof memorySearchParameters>({
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search per-project memory for relevant context from past sessions. Returns recalled facts, decisions, and conversation snippets. Use before starting a new task to recall prior work on this project.",
    promptSnippet: "Search per-project long-term memory for prior context",
    promptGuidelines: [
      "Use memory_search at the start of a session to recall past decisions or context relevant to the current task.",
      "Pass a concise query describing what you need to remember — e.g. a term, an issue description, or a client preference.",
    ],
    parameters: memorySearchParameters,
    async execute(_id, params) {
      interface SearchResponse { results: string; total: number; strategy: string }
      const limit = params.limit ?? 5;
      let result: SearchResponse;
      try {
        result = await gatewayPost<SearchResponse>(config.gatewayUrl, "/search/memories", {
          query: params.query,
          limit,
          scene: projectId,
        });
      } catch (err) {
        await safeAppendMemoryAudit(auditWorkspace, {
          kind: "search_failed",
          gatewayUrl: config.gatewayUrl,
          query: params.query,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const metadata = memoryRecallMetadata({
        config,
        projectId,
        query: params.query,
        limit,
        total: result.total,
        strategy: result.strategy,
      });
      const text = result.results?.trim()
        ? [
            `Memory recall (${result.total} total, strategy: ${result.strategy})`,
            `Freshness: queried_at ${metadata.queriedAt}`,
            `Provenance: memory:${projectId} via TencentDB-Agent-Memory`,
            "Cache safety: tool_tail_only; memory is recall context, not citable CAT evidence.",
            "",
            result.results,
          ].join("\n")
        : [
            "No relevant memories found.",
            `Freshness: queried_at ${metadata.queriedAt}`,
            `Provenance: memory:${projectId} via TencentDB-Agent-Memory`,
            "Cache safety: tool_tail_only; memory is recall context, not citable CAT evidence.",
          ].join("\n");
      await safeAppendMemoryAudit(auditWorkspace, {
        kind: "search_success",
        gatewayUrl: config.gatewayUrl,
        query: params.query,
        resultCount: result.total,
        strategy: result.strategy,
      });
      return { content: [{ type: "text" as const, text }], details: metadata };
    },
  });
}

// ── memory_store tool ─────────────────────────────────────────────────────────

export function createMemoryStoreTool(config: MemoryConfig, projectId: string, auditWorkspace?: CatWorkspace) {
  return defineTool<typeof memoryStoreParameters>({
    name: "memory_store",
    label: "Memory Store",
    description:
      "Explicitly save a specific fact, decision, or preference to long-term project memory. Use for important one-off facts you want to recall in future sessions (client preferences, glossary decisions, QA rules).",
    promptSnippet: "Store an explicit fact or decision in per-project memory",
    promptGuidelines: [
      "Use memory_store when the user asks you to remember something, or when you discover an important project-level decision.",
      "Do not store routine translations — store facts that affect future work (client rules, style decisions, glossary choices).",
    ],
    parameters: memoryStoreParameters,
    async execute(_id, params) {
      const combined = params.context ? `${params.content}\n\nContext: ${params.context}` : params.content;
      interface CaptureResponse { l0_recorded: number; scheduler_notified: boolean }
      try {
        await gatewayPost<CaptureResponse>(config.gatewayUrl, "/capture", {
          user_content: "Memory store request",
          assistant_content: combined,
          session_key: projectId,
        });
      } catch (err) {
        await safeAppendMemoryAudit(auditWorkspace, {
          kind: "store_failed",
          gatewayUrl: config.gatewayUrl,
          contentPreview: params.content.slice(0, 180),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      await safeAppendMemoryAudit(auditWorkspace, {
        kind: "store_success",
        gatewayUrl: config.gatewayUrl,
        contentPreview: params.content.slice(0, 180),
      });
      return {
        content: [{ type: "text" as const, text: `Stored to project memory: ${params.content.slice(0, 120)}` }],
        details: {},
      };
    },
  });
}
