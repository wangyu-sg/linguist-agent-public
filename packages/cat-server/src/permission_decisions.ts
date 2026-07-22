import type { AgentPermissionRequest, AgentPermissionUserDecision } from "@linguist-agent/cat-runtime";
import { randomUUID } from "node:crypto";

export interface PendingPermissionRequest extends Required<Pick<AgentPermissionRequest, "requestId">>, Omit<AgentPermissionRequest, "requestId"> {
  createdAt: string;
  expiresAt: string;
}

export interface PermissionDecisionRegistry {
  request(input: Omit<AgentPermissionRequest, "requestId">): {
    request: PendingPermissionRequest;
    decision: Promise<AgentPermissionUserDecision>;
  };
  decide(requestId: string, decision: AgentPermissionUserDecision): { ok: boolean; request?: PendingPermissionRequest };
  pending(): PendingPermissionRequest[];
  pendingCount(): number;
  cancelForSession(sessionId: string, reason?: string): number;
}

interface PendingEntry {
  request: PendingPermissionRequest;
  resolve: (decision: AgentPermissionUserDecision) => void;
  timer: NodeJS.Timeout;
}

export function createPermissionDecisionRegistry(options: { timeoutMs?: number } = {}): PermissionDecisionRegistry {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 120_000);
  const pending = new Map<string, PendingEntry>();

  function settle(requestId: string, decision: AgentPermissionUserDecision): { ok: boolean; request?: PendingPermissionRequest } {
    const entry = pending.get(requestId);
    if (!entry) return { ok: false };
    pending.delete(requestId);
    clearTimeout(entry.timer);
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
      };
      let resolveDecision!: (decision: AgentPermissionUserDecision) => void;
      const decision = new Promise<AgentPermissionUserDecision>((resolve) => {
        resolveDecision = resolve;
      });
      const timer = setTimeout(() => {
        settle(request.requestId, { decision: "deny", reason: "permission request timed out" });
      }, timeoutMs);
      pending.set(request.requestId, { request, resolve: resolveDecision, timer });
      return { request, decision };
    },
    decide: settle,
    pending() {
      return [...pending.values()].map((entry) => entry.request);
    },
    pendingCount() {
      return pending.size;
    },
    cancelForSession(sessionId, reason = "permission request cancelled because the session ended") {
      let count = 0;
      for (const entry of [...pending.values()]) {
        if (entry.request.sessionId !== sessionId) continue;
        if (settle(entry.request.requestId, { decision: "deny", reason }).ok) count += 1;
      }
      return count;
    },
  };
}
