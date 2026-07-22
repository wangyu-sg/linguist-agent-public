import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  TaskWorkspaceConflictError,
  createDocumentEvidenceRichArtifact,
  createTaskWorkspace,
  extractPaddleOcrEvidence,
  inspectManagedDocumentCapabilities,
  resolveStandaloneFileGrantAccess,
  standaloneTaskWorkspaceRoot,
  writeJsonFile,
  type DocumentEvidenceV1,
  type ManagedDocumentCapabilityStatuses,
} from "@linguist-agent/cat-data";
import {
  ManagedDocumentInstallError,
  installManagedDocumentCapability,
  previewManagedDocumentCapabilityInstall,
  type ManagedDocumentInstallPlan,
} from "../managed_document_installer.js";

export interface DocumentCapabilityRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  inspectCapabilities?: (repoRoot: string) => Promise<ManagedDocumentCapabilityStatuses>;
  extractOcr?: (repoRoot: string, sourcePath: string, options?: { useOrientation?: boolean }) => Promise<DocumentEvidenceV1>;
  previewInstall?: (repoRoot: string, id: "python" | "ocr" | "mineru" | "office") => ManagedDocumentInstallPlan;
  installCapability?: (repoRoot: string, input: { capabilityId: "python" | "ocr" | "mineru" | "office"; planHash: string }) => Promise<unknown>;
  acquireCapabilityMutation?: () => (() => void) | undefined;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function isInside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function authorizedSource(repoRoot: string, taskId: string, requestedPath: string): Promise<{ path: string; grantId?: string }> {
  const access = await resolveStandaloneFileGrantAccess(repoRoot, taskId);
  const path = await realpath(requestedPath);
  if (isInside(access.workspaceRoot, path)) return { path };
  const grant = access.grants.find((candidate) => {
    if (candidate.kind === "file" || !candidate.recursive) return candidate.realPath === path;
    return isInside(candidate.realPath, path);
  });
  if (!grant) throw new Error("The source file is outside this Chat's explicit file grants.");
  return { path, grantId: grant.id };
}

async function persistEvidence(deps: DocumentCapabilityRouteDeps, input: {
  taskId: string;
  sourcePath: string;
  useOrientation?: boolean;
}): Promise<unknown> {
  const workspace = createTaskWorkspace(deps.repoRoot);
  const before = await workspace.open({ kind: "standalone", taskId: input.taskId });
  if (before.task.status === "archived") throw new TaskWorkspaceConflictError("Restore this Chat before creating document evidence.");
  if (before.activeRunId) throw new TaskWorkspaceConflictError("Finish or stop the active Run before starting a document evidence Run.");
  const source = await authorizedSource(deps.repoRoot, input.taskId, input.sourcePath);
  const evidence = await (deps.extractOcr ?? extractPaddleOcrEvidence)(deps.repoRoot, source.path, { useOrientation: input.useOrientation });
  const now = new Date().toISOString();
  const runId = `document_${randomUUID()}`;
  const threadId = `${runId}.document-analyst`;
  const activityId = `${runId}.evidence`;
  const artifactId = `${runId}.document-evidence`;
  const artifactPath = join(standaloneTaskWorkspaceRoot(deps.repoRoot, input.taskId), "artifacts", `${artifactId}.json`);
  await writeJsonFile(artifactPath, evidence);
  const document = createDocumentEvidenceRichArtifact(evidence);
  await workspace.appendGenerated({
    kind: "standalone",
    taskId: input.taskId,
    runId,
    events: [{
      type: "run_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      run: {
        id: runId,
        taskId: input.taskId,
        mode: "pipeline",
        status: "complete",
        rootAgentThreadId: threadId,
        planHash: null,
        estimatedCalls: 0,
        estimatedCallsBySource: {},
        startedAt: now,
        updatedAt: now,
        completedAt: now,
        stopAvailable: false,
        resumeAvailable: false,
      },
    }, {
      type: "thread_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      thread: {
        id: threadId,
        taskId: input.taskId,
        runId,
        parentThreadId: null,
        identity: { kind: "deterministic", roleId: "document-analyst", displayName: "Document Analyst", roleLabel: "Document Evidence", disclosureLabel: "System" },
        status: "complete",
        canReceiveUserMessage: false,
        handoffSummary: `Extracted ${evidence.pages.length} page(s) of local document evidence.`,
        latestActivityId: activityId,
        childThreadIds: [],
        createdAt: now,
        updatedAt: now,
      },
    }, {
      type: "artifact_upsert",
      agentThreadId: threadId,
      occurredAt: now,
      artifact: {
        id: artifactId,
        taskId: input.taskId,
        runId,
        type: "document_evidence",
        status: "reviewable",
        title: `Document evidence · ${source.path.split("/").at(-1) ?? "document"}`,
        summary: `${evidence.pages.reduce((sum, page) => sum + page.blocks.length, 0)} text regions across ${evidence.pages.length} page(s); low-confidence regions are preserved for review.`,
        scope: { kind: "standalone", fileGrantIds: source.grantId ? [source.grantId] : [] },
        version: 1,
        provenance: { agentThreadId: threadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
        availableDecisions: [],
        content: { ...evidence, document, artifactPath },
        createdAt: now,
        updatedAt: now,
      },
    }, {
      type: "activity_append",
      agentThreadId: threadId,
      occurredAt: now,
      activity: {
        id: activityId,
        taskId: input.taskId,
        runId,
        agentThreadId: threadId,
        seq: 1,
        type: "artifact_update",
        status: "done",
        actor: { kind: "system", id: "document-evidence", displayName: "Document Analyst", agentThreadId: threadId },
        title: "Local document evidence extracted",
        body: "PaddleOCR ran inside the verified LA managed runtime. No source file was modified and no customer data was sent over the network.",
        tool: { name: "document_extract_evidence", effect: "read", target: source.path, outcome: `${evidence.pages.length} page(s)` },
        refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
        createdAt: now,
        updatedAt: now,
      },
    }],
  });
  return workspace.open({ kind: "standalone", taskId: input.taskId });
}

export async function handleDocumentCapabilityRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  deps: DocumentCapabilityRouteDeps,
): Promise<boolean> {
  if (parts[0] !== "api") return false;
  try {
    if (parts.length === 3 && parts[1] === "capabilities" && parts[2] === "documents") {
      if (req.method !== "GET") {
        deps.json(res, 405, { error: { code: "method_not_allowed", message: "Document capability status is read-only." } });
        return true;
      }
      deps.json(res, 200, await (deps.inspectCapabilities ?? inspectManagedDocumentCapabilities)(deps.repoRoot));
      return true;
    }
    if (parts.length === 5 && parts[1] === "capabilities" && parts[2] === "documents") {
      const id = parts[3];
      if (id !== "python" && id !== "ocr" && id !== "mineru" && id !== "office") throw new Error(`Unknown document capability ${id}.`);
      if (parts[4] === "preview" && req.method === "POST") {
        deps.json(res, 200, (deps.previewInstall ?? previewManagedDocumentCapabilityInstall)(deps.repoRoot, id));
        return true;
      }
      if (parts[4] === "install" && req.method === "POST") {
        const body = object(await deps.readBody(req));
        if (!body) throw new Error("Document capability install body is required.");
        const release = deps.acquireCapabilityMutation?.();
        if (deps.acquireCapabilityMutation && !release) {
          deps.json(res, 409, { error: { code: "document_capability_active_run", message: "Finish active Agent Runs before installing or repairing document capabilities." } });
          return true;
        }
        try {
          deps.json(res, 200, await (deps.installCapability ?? installManagedDocumentCapability)(deps.repoRoot, {
            capabilityId: id,
            planHash: string(body.planHash, "planHash"),
          }));
        } finally {
          release?.();
        }
        return true;
      }
      deps.json(res, 405, { error: { code: "method_not_allowed", message: "Unsupported document capability install operation." } });
      return true;
    }
    if (parts.length === 3 && parts[1] === "documents" && parts[2] === "evidence") {
      if (req.method !== "POST") {
        deps.json(res, 405, { error: { code: "method_not_allowed", message: "Document evidence requires POST." } });
        return true;
      }
      const body = object(await deps.readBody(req));
      if (!body) throw new Error("Document evidence request body is required.");
      deps.json(res, 201, await persistEvidence(deps, {
        taskId: string(body.taskId, "taskId"),
        sourcePath: string(body.sourcePath, "sourcePath"),
        useOrientation: body.useOrientation === true,
      }));
      return true;
    }
  } catch (error) {
    if (error instanceof ManagedDocumentInstallError) {
      deps.json(res, error.code === "plan_hash_mismatch" ? 409 : 400, { error: { code: error.code, message: error.message } });
      return true;
    }
    if (error instanceof TaskWorkspaceConflictError) {
      deps.json(res, 409, { error: { code: "document_evidence_conflict", message: error.message } });
      return true;
    }
    deps.json(res, 400, { error: { code: "document_capability_invalid", message: error instanceof Error ? error.message : String(error) } });
    return true;
  }
  return false;
}
