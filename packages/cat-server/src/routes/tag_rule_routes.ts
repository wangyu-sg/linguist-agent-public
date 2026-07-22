import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AskTagRuleModel,
  TagRuleClass,
  TagRuleDiscoveryResult,
  TagRuleDiscoverySegment,
} from "@linguist-agent/cat-data";
import { randomUUID } from "node:crypto";

type DiscoveryStageId = "evidence" | "assistant" | "validation" | "write";
type DiscoveryStageStatus = "pending" | "running" | "complete" | "warning" | "error";
type DiscoveryJobStatus = "running" | "complete" | "error";

type DiscoveryJob = {
  jobId: string;
  projectId: string;
  batchId: string;
  status: DiscoveryJobStatus;
  stages: Array<{ id: DiscoveryStageId; status: DiscoveryStageStatus; message: string }>;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

const discoveryJobs = new Map<string, DiscoveryJob>();

function nowIso(): string {
  return new Date().toISOString();
}

function initialStages(): DiscoveryJob["stages"] {
  return [
    { id: "evidence", status: "running", message: "Sampling batch evidence." },
    { id: "assistant", status: "pending", message: "Waiting for model discovery." },
    { id: "validation", status: "pending", message: "Waiting for candidate validation." },
    { id: "write", status: "pending", message: "Waiting to persist candidates." },
  ];
}

function setJobStage(job: DiscoveryJob, id: DiscoveryStageId, status: DiscoveryStageStatus, message: string): void {
  job.stages = job.stages.map((stage) => stage.id === id ? { ...stage, status, message } : stage);
  job.updatedAt = nowIso();
}

function serializeJob(job: DiscoveryJob): DiscoveryJob {
  return { ...job, stages: job.stages.map((stage) => ({ ...stage })) };
}

function pruneDiscoveryJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  // ponytail: in-memory active-session jobs; persist only if restart recovery matters.
  for (const [jobId, job] of discoveryJobs) {
    if (Date.parse(job.updatedAt) < cutoff) discoveryJobs.delete(jobId);
  }
}

export interface TagRuleRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalNumber: (value: unknown) => number | undefined;
  readProjectTagRules: (workspaceRoot: string, projectId: string) => Promise<unknown>;
  createManualProjectTagRuleCandidate: (workspaceRoot: string, projectId: string, input: { id?: string; class?: TagRuleClass; pattern: string; flags?: string; note?: string }) => Promise<unknown>;
  confirmProjectTagRule: (workspaceRoot: string, projectId: string, ruleId: string) => Promise<unknown>;
  disableProjectTagRule: (workspaceRoot: string, projectId: string, ruleId: string) => Promise<unknown>;
  declareNoProjectTagRules: (workspaceRoot: string, projectId: string) => Promise<unknown>;
  readBatch: (workspaceRoot: string, projectId: string, batchId: string) => Promise<{ segments: Array<{ id: string; source: string; target: string }> }>;
  buildProjectTagRuleEvidence: (segments: TagRuleDiscoverySegment[], options?: { maxSegments?: number }) => unknown;
  discoverTagRulesFromEvidence: (evidence: any, askModel?: AskTagRuleModel) => Promise<TagRuleDiscoveryResult>;
  writeProjectTagRuleCandidates: (workspaceRoot: string, projectId: string, candidates: any[]) => Promise<unknown>;
  askTagRuleModelForProject?: (projectId: string) => Promise<{ askModel: AskTagRuleModel; assistantModel?: string } | undefined>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tagRuleClass(value: unknown): TagRuleClass | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string" && ["paired", "singleton", "formatting", "structural", "placeholder"].includes(value)) {
    return value as TagRuleClass;
  }
  throw new Error("tag rule class must be one of paired, singleton, formatting, structural, placeholder");
}

async function runDiscoveryJob(
  job: DiscoveryJob,
  deps: TagRuleRouteDeps,
  maxSegments?: number,
): Promise<void> {
  try {
    const batch = await deps.readBatch(deps.repoRoot, job.projectId, job.batchId);
    const evidence = deps.buildProjectTagRuleEvidence(
      batch.segments.map((segment) => ({
        batchId: job.batchId,
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
      })),
      { maxSegments },
    );
    setJobStage(job, "evidence", "complete", `Sampled ${batch.segments.length} segment(s).`);
    setJobStage(job, "assistant", "running", "Calling global model provider.");
    const model = await deps.askTagRuleModelForProject?.(job.projectId);
    const discovery = await deps.discoverTagRulesFromEvidence(evidence, model?.askModel);
    setJobStage(job, "assistant", discovery.assistantStatus === "error" ? "error" : discovery.assistantStatus === "not_configured" ? "warning" : "complete", `assistant ${discovery.assistantStatus}`);
    setJobStage(job, "validation", discovery.rejected.length ? "warning" : "complete", `Accepted ${discovery.candidates.length}; rejected ${discovery.rejected.length}.`);
    setJobStage(job, "write", "running", "Persisting candidate rules.");
    const tagRules = discovery.candidates.length
      ? await deps.writeProjectTagRuleCandidates(deps.repoRoot, job.projectId, discovery.candidates)
      : await deps.readProjectTagRules(deps.repoRoot, job.projectId);
    setJobStage(job, "write", "complete", `Persisted ${discovery.candidates.length} candidate(s).`);
    job.status = "complete";
    job.result = {
      ...discovery,
      assistantModel: model?.assistantModel,
      trace: [
        ...discovery.trace,
        `write: ${discovery.candidates.length} candidate(s) persisted; active rules still require explicit confirm`,
      ],
      tagRules,
    };
    job.updatedAt = nowIso();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.status = "error";
    job.error = message;
    setJobStage(job, "write", "error", message);
  }
}

export async function handleTagRuleRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  projectId: string,
  deps: TagRuleRouteDeps,
): Promise<boolean> {
  if (parts[3] !== "tag-rules") return false;

  if (parts.length === 4 && req.method === "GET") {
    deps.json(res, 200, await deps.readProjectTagRules(deps.repoRoot, projectId));
    return true;
  }

  if (parts[4] === "candidates" && parts.length === 5 && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    deps.json(res, 200, await deps.createManualProjectTagRuleCandidate(deps.repoRoot, projectId, {
      id: optionalString(body.id),
      class: tagRuleClass(body.class),
      pattern: deps.requireString(body.pattern, "pattern"),
      flags: optionalString(body.flags),
      note: optionalString(body.note),
    }));
    return true;
  }

  if (parts[4] === "discover-jobs" && parts.length === 5 && req.method === "POST") {
    pruneDiscoveryJobs();
    const body = await deps.readBody(req) as Record<string, unknown>;
    const batchId = deps.requireString(body.batchId, "batchId");
    const job: DiscoveryJob = {
      jobId: randomUUID(),
      projectId,
      batchId,
      status: "running",
      stages: initialStages(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    discoveryJobs.set(job.jobId, job);
    void runDiscoveryJob(job, deps, deps.optionalNumber(body.maxSegments));
    deps.json(res, 202, serializeJob(job));
    return true;
  }

  if (parts[4] === "discover-jobs" && parts[5] && req.method === "GET") {
    const job = discoveryJobs.get(decodeURIComponent(parts[5]));
    if (!job || job.projectId !== projectId) {
      deps.json(res, 404, { error: "tag rule discovery job not found" });
      return true;
    }
    deps.json(res, 200, serializeJob(job));
    return true;
  }

  if (parts[4] === "discover" && req.method === "POST") {
    const body = await deps.readBody(req) as Record<string, unknown>;
    const batchId = deps.requireString(body.batchId, "batchId");
    const batch = await deps.readBatch(deps.repoRoot, projectId, batchId);
    const evidence = deps.buildProjectTagRuleEvidence(
      batch.segments.map((segment) => ({
        batchId,
        segmentId: segment.id,
        source: segment.source,
        target: segment.target,
      })),
      { maxSegments: deps.optionalNumber(body.maxSegments) },
    );
    const model = await deps.askTagRuleModelForProject?.(projectId);
    const discovery = await deps.discoverTagRulesFromEvidence(evidence, model?.askModel);
    const tagRules = discovery.candidates.length
      ? await deps.writeProjectTagRuleCandidates(deps.repoRoot, projectId, discovery.candidates)
      : await deps.readProjectTagRules(deps.repoRoot, projectId);
    const persistedCount = discovery.candidates.length;
    deps.json(res, 200, {
      ...discovery,
      assistantModel: model?.assistantModel,
      trace: [
        ...discovery.trace,
        `write: ${persistedCount} candidate(s) persisted; active rules still require explicit confirm`,
      ],
      tagRules,
    });
    return true;
  }

  if (parts[4] === "declare-none" && req.method === "POST") {
    deps.json(res, 200, await deps.declareNoProjectTagRules(deps.repoRoot, projectId));
    return true;
  }

  if (parts[4] && parts[5] === "confirm" && req.method === "POST") {
    deps.json(res, 200, await deps.confirmProjectTagRule(deps.repoRoot, projectId, decodeURIComponent(parts[4])));
    return true;
  }

  if (parts[4] && parts[5] === "disable" && req.method === "POST") {
    deps.json(res, 200, await deps.disableProjectTagRule(deps.repoRoot, projectId, decodeURIComponent(parts[4])));
    return true;
  }

  return false;
}
