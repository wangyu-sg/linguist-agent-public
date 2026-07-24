import { createHash, randomUUID } from "node:crypto";
import {
  agentPermissionAction,
  type AgentPermissionAction,
  type AgentPermissionRequest,
  type AgentPermissionUserDecision,
} from "@linguist-agent/cat-runtime";

export interface PendingPermissionRequest extends Required<Pick<AgentPermissionRequest, "requestId">>, Omit<AgentPermissionRequest, "requestId"> {
  createdAt: string;
  expiresAt: string;
}

export interface PermissionRequestFilter {
  taskId?: string;
  runId?: string;
  projectId?: string;
  sessionId?: string;
}

export interface PermissionDecisionRegistry {
  request(input: Omit<AgentPermissionRequest, "requestId">): {
    request: PendingPermissionRequest;
    decision: Promise<AgentPermissionUserDecision>;
    autoApproved?: boolean;
  };
  decide(requestId: string, decision: AgentPermissionUserDecision): { ok: boolean; request?: PendingPermissionRequest };
  pending(filter?: PermissionRequestFilter): PendingPermissionRequest[];
  pendingCount(filter?: PermissionRequestFilter): number;
  cancelForSession(sessionId: string, reason?: string): number;
}

interface PendingEntry {
  request: PendingPermissionRequest;
  resolve: (decision: AgentPermissionUserDecision) => void;
  timer: NodeJS.Timeout;
}

interface ConversationGrant {
  sessionId: string;
  domain: string;
  toolName: string;
  targetFingerprint: string;
}

function matchesFilter(request: PendingPermissionRequest, filter: PermissionRequestFilter = {}): boolean {
  return (filter.taskId === undefined || request.taskId === filter.taskId)
    && (filter.runId === undefined || request.runId === filter.runId)
    && (filter.projectId === undefined || request.projectId === filter.projectId)
    && (filter.sessionId === undefined || request.sessionId === filter.sessionId);
}

/** Stable, bounded target identity used by conversation-scoped grants. */
export function permissionTargetFingerprint(request: Pick<AgentPermissionRequest, "toolName" | "domain" | "argsSummary">): string {
  return createHash("sha256")
    .update(JSON.stringify({ toolName: request.toolName, domain: request.domain, argsSummary: request.argsSummary }))
    .digest("hex");
}

function legacyDecision(action: AgentPermissionAction, reason?: string): AgentPermissionUserDecision {
  // Keep the old shape for timeout/cancel paths so older in-process clients can
  // still distinguish a server-side denial while new user actions use `action`.
  if (action === "deny") return { decision: "deny", ...(reason ? { reason } : {}) };
  return { action, ...(reason ? { reason } : {}) };
}

export function createPermissionDecisionRegistry(options: { timeoutMs?: number } = {}): PermissionDecisionRegistry {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const pending = new Map<string, PendingEntry>();
  const conversationGrants: ConversationGrant[] = [];

  function hasConversationGrant(request: PendingPermissionRequest): boolean {
    if (!request.sessionId || request.kind === "pi_resource_trust") return false;
    const targetFingerprint = permissionTargetFingerprint(request);
    return conversationGrants.some((grant) => grant.sessionId === request.sessionId
      && grant.domain === request.domain
      && grant.toolName === request.toolName
      && grant.targetFingerprint === targetFingerprint);
  }

  function settle(requestId: string, decision: AgentPermissionUserDecision): { ok: boolean; request?: PendingPermissionRequest } {
    const entry = pending.get(requestId);
    if (!entry) return { ok: false };
    pending.delete(requestId);
    clearTimeout(entry.timer);
    const action = agentPermissionAction(decision);
    // Resource trust is exact-path/digest trust, never a generic conversation
    // or standing permission grant.
    if (entry.request.kind === "pi_resource_trust" && action !== "allow_once" && action !== "deny") {
      entry.resolve({ action: "deny", reason: "resource trust requires an exact summary decision" });
      return { ok: true, request: entry.request };
    }
    if (action === "allow_conversation" && entry.request.sessionId && entry.request.kind !== "pi_resource_trust") {
      const grant = {
        sessionId: entry.request.sessionId,
        domain: entry.request.domain,
        toolName: entry.request.toolName,
        targetFingerprint: permissionTargetFingerprint(entry.request),
      } satisfies ConversationGrant;
      if (!conversationGrants.some((candidate) => candidate.sessionId === grant.sessionId
        && candidate.domain === grant.domain
        && candidate.toolName === grant.toolName
        && candidate.targetFingerprint === grant.targetFingerprint)) conversationGrants.push(grant);
    }
    entry.resolve(decision);
    return { ok: true, request: entry.request };
  }

  return {
    request(input) {
      const now = Date.now();
      const request: PendingPermissionRequest = {
        requestId: randomUUID(),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + timeoutMs).toISOString(),
        ...input,
        kind: input.kind ?? "tool",
      };
      let resolveDecision!: (decision: AgentPermissionUserDecision) => void;
      const decision = new Promise<AgentPermissionUserDecision>((resolve) => {
        resolveDecision = resolve;
      });
      if (hasConversationGrant(request)) {
        resolveDecision({ action: "allow_conversation", reason: "Allowed by this conversation's grant." });
        return { request, decision, autoApproved: true };
      }
      const timer = setTimeout(() => {
        settle(request.requestId, legacyDecision("deny", "permission request timed out"));
      }, timeoutMs);
      pending.set(request.requestId, { request, resolve: resolveDecision, timer });
      return { request, decision };
    },
    decide: settle,
    pending(filter = {}) {
      return [...pending.values()]
        .map((entry) => entry.request)
        .filter((request) => matchesFilter(request, filter));
    },
    pendingCount(filter = {}) {
      return [...pending.values()].filter((entry) => matchesFilter(entry.request, filter)).length;
    },
    cancelForSession(sessionId, reason = "permission request cancelled because the session ended") {
      let count = 0;
      for (const entry of [...pending.values()]) {
        if (entry.request.sessionId !== sessionId) continue;
        if (settle(entry.request.requestId, legacyDecision("deny", reason)).ok) count += 1;
      }
      // Conversation grants are deliberately ephemeral and tied to the Pi
      // session; stopping that session must not leak them into a new Task.
      for (let index = conversationGrants.length - 1; index >= 0; index -= 1) {
        if (conversationGrants[index]?.sessionId === sessionId) conversationGrants.splice(index, 1);
      }
      return count;
    },
  };
}
