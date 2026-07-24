import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  TaskWorkspaceConflictError,
  createDocumentRouterRichArtifact,
  createTaskWorkspace,
  parseDocumentBackendResult,
  parseRichArtifactDocument,
  resolveStandaloneFileGrantAccess,
  standaloneTaskWorkspaceRoot,
  writeJsonFile,
  type TaskArtifact,
} from "@linguist-agent/cat-data";
import { routeDocumentWithPolicy, type DocumentRouterResult } from "@linguist-agent/cat-runtime";

export interface DocumentEvidenceApplicationInput {
  repoRoot: string;
  taskId: string;
  sourcePath: string;
  useOrientation?: boolean;
}

export interface DocumentEvidenceCorrectionInput {
  repoRoot: string;
  taskId: string;
  artifactId: string;
  blockId: string;
  text: string;
}

export interface DocumentEvidenceApplicationPort {
  createEvidence(input: DocumentEvidenceApplicationInput): Promise<unknown>;
  correctEvidence(input: DocumentEvidenceCorrectionInput): Promise<unknown>;
}

export interface DocumentEvidenceApplicationDeps {
  routeDocument?: (input: { runtimeRoot: string; taskId: string; sourcePath: string; useOrientation?: boolean }) => Promise<DocumentRouterResult>;
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

function correctionText(value: string): string {
  const text = value.trim();
  if (!text || text.length > 20_000 || text.includes("\0")) throw new Error("Correction text must be 1 to 20,000 non-NUL characters.");
  return text;
}

function correctionSource(artifact: TaskArtifact): { router: DocumentRouterResult; sourcePath: string } {
  if (artifact.type !== "document_evidence") throw new Error("Only document_evidence Artifacts can be corrected.");
  const router = artifact.content.router as Partial<DocumentRouterResult> | undefined;
  if (!router || router.schemaVersion !== 1 || !router.source || !Array.isArray(router.blocks) || !Array.isArray(router.pages)
    || !router.policy || !["complete", "partial", "blocked"].includes(router.status ?? "")) {
    throw new Error("Document evidence does not carry a complete canonical Router result.");
  }
  const parsed = parseDocumentBackendResult({ schemaVersion: router.schemaVersion, source: router.source, blocks: router.blocks });
  const source = parseRichArtifactDocument(artifact.content.document).blocks.find((block) => block.type === "file_reference" && block.file.role === "source");
  if (!source || source.type !== "file_reference" || source.file.sha256 !== parsed.source.sha256) throw new Error("Document evidence source provenance is unavailable.");
  return {
    router: { ...router, source: parsed.source, blocks: parsed.blocks } as DocumentRouterResult,
    sourcePath: source.file.path,
  };
}

/**
 * The route supplies a validated evidence request. This port owns grant
 * resolution, managed OCR execution, Artifact bytes, and the one canonical
 * Task/Run/Activity/Artifact append.
 */
export function createDocumentEvidenceApplicationPort(deps: DocumentEvidenceApplicationDeps = {}): DocumentEvidenceApplicationPort {
  const routeDocument = deps.routeDocument ?? routeDocumentWithPolicy;
  return {
    async createEvidence(input: DocumentEvidenceApplicationInput): Promise<unknown> {
      const workspace = createTaskWorkspace(input.repoRoot);
      const before = await workspace.open({ kind: "standalone", taskId: input.taskId });
      if (before.task.status === "archived") throw new TaskWorkspaceConflictError("Restore this Chat before creating document evidence.");
      if (before.activeRunId) throw new TaskWorkspaceConflictError("Finish or stop the active Run before starting a document evidence Run.");
      const source = await authorizedSource(input.repoRoot, input.taskId, input.sourcePath);
      const routed = await routeDocument({ runtimeRoot: input.repoRoot, taskId: input.taskId, sourcePath: source.path, useOrientation: input.useOrientation });
      if (routed.status === "blocked") throw new Error(`Document Router blocked every page: ${routed.pages.map((page) => `page ${page.page}: ${page.reason}`).join("; ")}`);
      const now = new Date().toISOString();
      const runId = `document_${randomUUID()}`;
      const threadId = `${runId}.document-analyst`;
      const activityId = `${runId}.evidence`;
      const artifactId = `${runId}.document-evidence`;
      const artifactPath = join(standaloneTaskWorkspaceRoot(input.repoRoot, input.taskId), "artifacts", `${artifactId}.json`);
      await writeJsonFile(artifactPath, routed);
      const document = createDocumentRouterRichArtifact(routed, { sourcePath: source.path, createdAt: now });
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
            handoffSummary: `Routed ${routed.pages.length} page(s) of local document evidence (${routed.status}).`,
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
            summary: `${routed.blocks.length} text regions across ${routed.pages.length} page(s); routing is ${routed.status} and every blocked page remains explicit.`,
            scope: { kind: "standalone", fileGrantIds: source.grantId ? [source.grantId] : [] },
            version: 1,
            provenance: { agentThreadId: threadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
            availableDecisions: [],
            content: { router: routed, document, artifactPath },
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
            body: `Document Router completed ${routed.pages.filter((page) => page.status === "complete").length}/${routed.pages.length} page(s) locally. No source file was modified and no customer data was sent over the network.`,
            tool: { name: "document_extract_evidence", effect: "read", target: source.path, outcome: `${routed.pages.length} page(s), ${routed.status}` },
            refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: now,
            updatedAt: now,
          },
        }],
      });
      return workspace.open({ kind: "standalone", taskId: input.taskId });
    },
    async correctEvidence(input: DocumentEvidenceCorrectionInput): Promise<unknown> {
      const workspace = createTaskWorkspace(input.repoRoot);
      const before = await workspace.open({ kind: "standalone", taskId: input.taskId });
      if (before.task.status === "archived") throw new TaskWorkspaceConflictError("Restore this Chat before recording a document correction.");
      if (before.activeRunId) throw new TaskWorkspaceConflictError("Finish or stop the active Run before recording a document correction.");
      const artifact = before.artifacts.find((candidate) => candidate.id === input.artifactId);
      if (!artifact) throw new Error(`Document evidence Artifact ${input.artifactId} was not found.`);
      const threadId = artifact.provenance.agentThreadId;
      if (!before.agentThreads.some((thread) => thread.id === threadId) || !before.runs.some((run) => run.id === artifact.runId)) {
        throw new Error("Document evidence no longer has a canonical Task Run and thread.");
      }
      const { router, sourcePath } = correctionSource(artifact);
      const block = router.blocks.find((candidate) => candidate.id === input.blockId);
      if (!block?.text) throw new Error(`Document text block ${input.blockId} was not found.`);
      const text = correctionText(input.text);
      const corrected = {
        ...router,
        blocks: router.blocks.map((candidate) => candidate.id === block.id
          ? { ...candidate, text, provenance: { ...candidate.provenance, userCorrected: true } }
          : candidate),
      };
      const now = new Date().toISOString();
      const suffix = randomUUID();
      const correctionId = `${artifact.id}.correction.${suffix}`;
      const activityId = `${correctionId}.recorded`;
      const artifactPath = join(standaloneTaskWorkspaceRoot(input.repoRoot, input.taskId), "artifacts", `${correctionId}.json`);
      const document = createDocumentRouterRichArtifact(corrected, {
        sourcePath,
        createdAt: now,
        title: `Document correction · ${artifact.title.replace(/^Document evidence · /, "")}`,
      });
      document.blocks.splice(1, 0, { id: "correction", type: "diff", label: `User correction · ${block.id}`, before: block.text, after: text });
      const correction = {
        schemaVersion: 1,
        parentArtifactId: artifact.id,
        blockId: block.id,
        sourceDigest: router.source.sha256,
        locator: block.locator,
        before: block.text,
        after: text,
      };
      await writeJsonFile(artifactPath, { router: corrected, correction });
      await workspace.appendGenerated({
        kind: "standalone",
        taskId: input.taskId,
        runId: artifact.runId,
        events: [{
          type: "artifact_upsert",
          agentThreadId: threadId,
          occurredAt: now,
          artifact: {
            id: correctionId,
            taskId: input.taskId,
            runId: artifact.runId,
            type: "document_evidence",
            status: "reviewable",
            title: document.title,
            summary: `User corrected block ${block.id}; original Document Router evidence remains unchanged.`,
            scope: artifact.scope,
            version: 1,
            provenance: { agentThreadId: threadId, activityId, evidenceRefs: artifact.provenance.evidenceRefs, parentArtifactIds: [artifact.id] },
            availableDecisions: [],
            content: { router: corrected, document, correction, artifactPath },
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
            runId: artifact.runId,
            agentThreadId: threadId,
            seq: 1,
            type: "artifact_update",
            status: "done",
            actor: { kind: "human", id: "user", displayName: "User", agentThreadId: threadId },
            title: "Document correction recorded",
            body: `Corrected block ${block.id}; the source file and original evidence remain unchanged.`,
            tool: null,
            refs: { artifactIds: [correctionId, artifact.id], evidenceRefs: artifact.provenance.evidenceRefs, decisionIds: [], segmentIds: [] },
            createdAt: now,
            updatedAt: now,
          },
        }],
      });
      return workspace.open({ kind: "standalone", taskId: input.taskId });
    },
  };
}

export const documentEvidenceApplicationPort = createDocumentEvidenceApplicationPort();
