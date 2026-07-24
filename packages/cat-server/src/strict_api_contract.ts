import { LocalTransportError, readLocalJsonBody } from "./local_transport_security.js";

/** A stable, client-safe failure for malformed HTTP input. */
export class StrictApiInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415 = 400,
    readonly code: "invalid_request" | "body_too_large" | "unsupported_media_type" = "invalid_request",
  ) {
    super(message);
    this.name = "StrictApiInputError";
  }
}

export interface StrictApiSchema<T> {
  readonly kind: "array" | "boolean" | "json" | "object" | "optional" | "string";
  readonly optional?: boolean;
  readonly name?: string;
  readonly keys?: readonly string[];
  parse(value: unknown, path: string): T;
}

type StrictApiObjectShape = Record<string, StrictApiSchema<unknown>>;

function invalid(message: string): never {
  throw new StrictApiInputError(message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} must be a JSON object.`);
  return value as Record<string, unknown>;
}

export function strictApiString(input: { minLength?: number; maxLength?: number } = {}): StrictApiSchema<string> {
  return {
    kind: "string",
    parse(value, path) {
      if (typeof value !== "string") invalid(`${path} must be a string.`);
      if (input.minLength !== undefined && value.length < input.minLength) invalid(`${path} must be at least ${input.minLength} characters.`);
      if (input.maxLength !== undefined && value.length > input.maxLength) invalid(`${path} must be ${input.maxLength} characters or fewer.`);
      return value;
    },
  };
}

export function strictApiBoolean(): StrictApiSchema<boolean> {
  return {
    kind: "boolean",
    parse(value, path) {
      if (typeof value !== "boolean") invalid(`${path} must be a boolean.`);
      return value;
    },
  };
}

/** Accepts only JSON data, without coercion or prototype-bearing values. */
export function strictApiJsonValue(): StrictApiSchema<unknown> {
  const validate = (value: unknown, path: string): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid(`${path} must be a finite JSON number.`);
      return value;
    }
    if (Array.isArray(value)) return value.map((entry, index) => validate(entry, `${path}[${index}]`));
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, validate(entry, `${path}.${key}`)]));
    }
    invalid(`${path} must be JSON data.`);
  };
  return { kind: "json", parse: validate };
}

export function strictApiArray<T>(
  item: StrictApiSchema<T>,
  input: { minItems?: number; maxItems?: number } = {},
): StrictApiSchema<T[]> {
  return {
    kind: "array",
    parse(value, path) {
      if (!Array.isArray(value)) invalid(`${path} must be an array.`);
      if (input.minItems !== undefined && value.length < input.minItems) invalid(`${path} must contain at least ${input.minItems} items.`);
      if (input.maxItems !== undefined && value.length > input.maxItems) invalid(`${path} must contain ${input.maxItems} items or fewer.`);
      return value.map((entry, index) => item.parse(entry, `${path}[${index}]`));
    },
  };
}

export function strictApiOptional<T>(schema: StrictApiSchema<T>): StrictApiSchema<T | undefined> {
  return {
    kind: "optional",
    optional: true,
    parse(value, path) {
      return value === undefined ? undefined : schema.parse(value, path);
    },
  };
}

export function strictApiObject(
  shape: StrictApiObjectShape,
  input: { name?: string } = {},
): StrictApiSchema<Record<string, unknown>> {
  const name = input.name?.trim() || "request body";
  const keys = Object.keys(shape);
  return {
    kind: "object",
    name,
    keys: [...keys].sort(),
    parse(value, path) {
      const inputObject = object(value, path);
      for (const key of Object.keys(inputObject)) {
        if (!Object.hasOwn(shape, key)) invalid(`${path} contains unknown field ${key}.`);
      }
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        const schema = shape[key]!;
        const parsed = schema.parse(inputObject[key], `${path}.${key}`);
        if (parsed !== undefined) result[key] = parsed;
      }
      return result;
    },
  };
}

/** Creates one reusable object schema from a declared external field vocabulary. */
export function strictApiDeclaredObject(
  keys: readonly string[],
  input: { name?: string } = {},
): StrictApiSchema<Record<string, unknown>> {
  return strictApiObject(
    Object.fromEntries([...new Set(keys)].map((key) => [key, strictApiOptional(strictApiJsonValue())])),
    input,
  );
}

// This is the canonical top-level vocabulary accepted by the local HTTP API.
// Individual route handlers narrow it further with their own exact schemas;
// keeping the transport allowlist here ensures a newly invented field cannot
// cross the renderer/server boundary by accident.
export const API_REQUEST_BODY_FIELDS = [
  "acceptedBy", "access", "action", "activityId", "agentThreadId", "apiKey", "apiKeyEnvVar", "append", "archivePath",
  "artifactId", "assetPath", "assetPaths", "assetRoleOverrides", "async", "asyncDir", "attachmentGrantIds", "attemptId",
  "background", "batch", "batchId", "blockId", "candidateIds", "capabilityIds", "captures", "category", "changeType", "checkpoint",
  "class", "code", "confirm", "confirmation", "confirmedBy", "confirmedMappings", "confirmedTypedCandidateIds", "conflictKey",
  "currentQaRowCount", "currentSegmentId", "currentTargets", "customInstructions", "customRules", "decidedBy", "decision", "decisionKey",
  "decisions", "delivery", "detail", "disposition", "entries", "entryId", "env", "error", "evalSetId", "eventId", "evidence",
  "evidenceSource", "evidenceSources", "executableApprovals", "execute", "executionProfile", "expectedPlanHash", "expectedRevision",
  "expectedSegmentUpdatedAt", "fileDataBase64", "fileName", "filePath", "finalIgnoreState", "findingId", "flags", "force", "forceAllRoles",
  "format", "grantId", "guidance", "hasLoadMore", "id", "ignoreChunkSize", "ignoreFalsePositives", "importReviewedTm", "includeReadiness",
  "initialMessage", "inputArtifactRefs", "intent", "keepNewestReports", "kind", "label", "lastAction", "lastVerifiedSegmentId", "llmAssisted",
  "localProposal", "lockedSegmentIds", "logKeep", "logMaxBytes", "mappingProfileId", "masterFileDataBase64", "masterFileName", "masterXliffPath",
  "maxDefectSeverity", "maxLoadMorePasses", "maxSegments", "maxSheets", "mechanicalOptions", "message", "messageIds", "mode", "model", "modelId",
  "modelProvider", "modelRoutes", "name", "note", "observedAt", "operation", "optionId",
  "origin", "outputArtifactRefs", "outputPath", "overwrite", "parseMode", "parserEvidence", "path", "pattern", "permissionMode", "permissionRules",
  "phraseEvidence", "planHash", "position", "preview", "previousQaRowCount", "projectId", "projectName", "propagateDuplicates", "proposalIds",
  "proposalSetId", "proposals", "provider", "providerId", "purpose", "readbackState", "readbackTargets", "reason", "recursive", "register",
  "rejectProposalIds", "rejectUnselected", "replaceEntries", "reportId", "reportSha256", "requestId", "responseMode", "resumedFromRunId", "reviewId",
  "role", "roleId", "rootPath", "rows", "runId", "runIds", "sampleRows", "sampleSize", "scope", "seed", "segmentId", "segmentIds",
  "segmentLimit", "selectedCandidateIds", "selections", "semantic", "sessionId", "sheetOffset", "sheetOverrides", "source", "sourceLanguage", "sourceLocale",
  "sourcePath", "sourcePaths", "sourceRoot", "sourceThreadId", "speaker", "srcLang", "state", "status", "stopOnFailure", "subagentRunId", "supersedes",
  "surface", "target", "targetLanguage", "targetLocale", "targetPiVersion", "taskId", "templateDocxPath", "text", "textType", "tgtLang", "theme",
  "thinking", "thinkingLevel", "throughActivityId", "tier", "title", "transcriptRef", "ts", "turnId", "unset", "updatedBy", "useOrientation", "userRequest",
  "validFrom", "validUntil", "value", "warnings", "workflowId", "workflowStage", "writeFile", "xlsxPath", "answers", "segmentSource",
  "acceptedRiskCodes", "agentBacked", "artifactContent", "artifactSummary", "artifactTitle", "artifactType", "artifacts", "awaitUntilPause",
  "candidateTargets", "deliveryQa", "deps", "expectedCurrentTarget", "expectedQaScope", "findings", "knownFindingIds", "knownFindingSegments",
  "output", "project", "readBody", "rolePass", "statusOutputFile", "summary", "useOrientation",
] as const;

export const externalApiRequestSchema = strictApiDeclaredObject(API_REQUEST_BODY_FIELDS, { name: "local API request body" });

/**
 * Transport-level object boundary. Route schemas must subsequently name their
 * accepted fields; this only prevents scalar/array bodies from reaching a
 * route handler that expects named properties.
 */
export function strictApiJsonObject(): StrictApiSchema<Record<string, unknown>> {
  return {
    kind: "object",
    name: "request body",
    parse(value, path) {
      return object(value, path);
    },
  };
}

export function describeStrictApiSchema(schema: StrictApiSchema<unknown>): { kind: "object"; name: string; keys: string[] } {
  if (schema.kind !== "object") throw new Error("Only object API schemas can describe a request body.");
  return {
    kind: "object",
    name: schema.name ?? "request body",
    keys: [...(schema.keys ?? [])],
  };
}

function isJsonContentType(value: string | string[] | undefined): boolean {
  if (typeof value !== "string") return false;
  return value.split(";", 1)[0]?.trim().toLocaleLowerCase() === "application/json";
}

/** Parses only declared JSON and delegates all field validation to a strict schema. */
export async function readStrictApiJsonBody<T>(
  input: AsyncIterable<Uint8Array | string>,
  options: {
    contentType: string | string[] | undefined;
    maxBytes?: number;
    schema: StrictApiSchema<T>;
  },
): Promise<T> {
  if (!isJsonContentType(options.contentType)) {
    throw new StrictApiInputError("Request body must use content-type application/json.", 415, "unsupported_media_type");
  }
  try {
    return options.schema.parse(await readLocalJsonBody(input, options.maxBytes), "request body");
  } catch (error) {
    if (error instanceof StrictApiInputError) throw error;
    if (error instanceof LocalTransportError) {
      throw new StrictApiInputError(error.message, error.status === 413 ? 413 : 400, error.code === "body_too_large" ? "body_too_large" : "invalid_request");
    }
    throw error;
  }
}
