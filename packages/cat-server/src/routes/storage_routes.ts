import type { IncomingMessage, ServerResponse } from "node:http";
import {
  executeLegacyTaskBackfill,
  executeRuntimeStorageAction,
  previewLegacyTaskBackfill,
  previewRuntimeStorageAction,
  runtimeStorageSummary,
  type RuntimeStorageCleanupAction,
} from "@linguist-agent/cat-data";

const CLEANUP_ACTIONS = new Set<RuntimeStorageCleanupAction>([
  "pruneCaches",
  "rotateLogs",
  "deleteProjectCache",
  "deleteOldReports",
  "pruneLegacyCache",
  "migrateLegacyCache",
]);

function parseStorageAction(body: Record<string, unknown>): {
  action?: RuntimeStorageCleanupAction;
  projectId?: string;
  keepNewestReports?: number;
  logMaxBytes?: number;
  logKeep?: number;
  planHash?: string;
  execute?: boolean;
} {
  return {
    action: typeof body.action === "string" ? body.action as RuntimeStorageCleanupAction : undefined,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    keepNewestReports: typeof body.keepNewestReports === "number" ? body.keepNewestReports : undefined,
    logMaxBytes: typeof body.logMaxBytes === "number" ? body.logMaxBytes : undefined,
    logKeep: typeof body.logKeep === "number" ? body.logKeep : undefined,
    planHash: typeof body.planHash === "string" ? body.planHash : undefined,
    execute: body.execute === true || body.confirm === true,
  };
}

function validateAction(action: RuntimeStorageCleanupAction | undefined, projectId: string | undefined): string | undefined {
  if (!action || !CLEANUP_ACTIONS.has(action)) return "Unsupported storage cleanup action.";
  if (action === "deleteProjectCache" && !projectId) return "projectId is required for deleteProjectCache.";
  return undefined;
}

function actionInput(input: ReturnType<typeof parseStorageAction>, action: RuntimeStorageCleanupAction) {
  return {
    action,
    projectId: input.projectId,
    keepNewestReports: input.keepNewestReports,
    logMaxBytes: input.logMaxBytes,
    logKeep: input.logKeep,
  };
}

export async function handleStorageRoute(req: IncomingMessage, res: ServerResponse, parts: string[], deps: {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  hasActiveRuns?: () => boolean;
}): Promise<boolean> {
  if (parts[0] !== "api" || parts[1] !== "storage") return false;
  if (parts[2] === "summary" && req.method === "GET") {
    deps.json(res, 200, await runtimeStorageSummary(deps.repoRoot));
    return true;
  }
  if (parts[2] === "legacy-task-backfill" && parts[3] === "preview" && req.method === "GET") {
    deps.json(res, 200, await previewLegacyTaskBackfill(deps.repoRoot));
    return true;
  }
  if (parts[2] === "legacy-task-backfill" && parts[3] === "execute" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    if (typeof body.planHash !== "string" || !body.planHash) {
      deps.json(res, 400, { error: "planHash is required for legacy Task backfill." });
      return true;
    }
    if (!Array.isArray(body.selectedCandidateIds) || !body.selectedCandidateIds.every((value) => typeof value === "string")) {
      deps.json(res, 400, { error: "selectedCandidateIds must be an array of candidate ids." });
      return true;
    }
    if (deps.hasActiveRuns?.()) {
      deps.json(res, 409, { error: "Stop all active Agent, Team, and Eval runs before historical Task backfill." });
      return true;
    }
    try {
      deps.json(res, 200, await executeLegacyTaskBackfill(deps.repoRoot, {
        planHash: body.planHash,
        selectedCandidateIds: body.selectedCandidateIds as string[],
      }));
    } catch (error) {
      deps.json(res, 409, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }
  if (parts[2] === "actions" && parts[3] === "preview" && req.method === "POST") {
    const input = parseStorageAction(await deps.readBody(req) as Record<string, unknown>);
    const error = validateAction(input.action, input.projectId);
    if (error || !input.action) {
      deps.json(res, 400, { error });
      return true;
    }
    deps.json(res, 200, await previewRuntimeStorageAction(deps.repoRoot, actionInput(input, input.action)));
    return true;
  }
  if (parts[2] === "actions" && parts[3] === "execute" && req.method === "POST") {
    const input = parseStorageAction(await deps.readBody(req) as Record<string, unknown>);
    const error = validateAction(input.action, input.projectId);
    if (error || !input.action) {
      deps.json(res, 400, { error });
      return true;
    }
    if (!input.planHash) {
      deps.json(res, 400, { error: "planHash is required for storage cleanup execute." });
      return true;
    }
    try {
      deps.json(res, 200, await executeRuntimeStorageAction(deps.repoRoot, { ...actionInput(input, input.action), planHash: input.planHash }));
    } catch (error) {
      deps.json(res, 409, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }
  if (parts[2] === "cleanup" && req.method === "POST") {
    const input = parseStorageAction(await deps.readBody(req) as Record<string, unknown>);
    const error = validateAction(input.action, input.projectId);
    if (error || !input.action) {
      deps.json(res, 400, { error });
      return true;
    }
    if (!input.execute) {
      deps.json(res, 200, await previewRuntimeStorageAction(deps.repoRoot, actionInput(input, input.action)));
      return true;
    }
    if (!input.planHash) {
      deps.json(res, 400, { error: "planHash is required for confirmed storage cleanup." });
      return true;
    }
    try {
      deps.json(res, 200, await executeRuntimeStorageAction(deps.repoRoot, { ...actionInput(input, input.action), planHash: input.planHash }));
    } catch (error) {
      deps.json(res, 409, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }
  deps.json(res, 404, { error: "Not found" });
  return true;
}
