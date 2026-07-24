export const LEGACY_TASK_SQLITE_MAPPING_SCHEMA_VERSION = 1 as const;

export type LegacyTaskMappingSourceId =
  | "task_workspace"
  | "task_run_event"
  | "quality_decision_ledger"
  | "task_message_queue"
  | "task_package_profile";

export interface LegacyTaskMappingEntity {
  readonly id: string;
  readonly fields: readonly string[];
}

export interface LegacyTaskMappingSource {
  readonly id: LegacyTaskMappingSourceId;
  readonly sourceSchemaVersion: number;
  readonly entities: readonly LegacyTaskMappingEntity[];
  readonly ordering: readonly string[];
  readonly revisions: readonly string[];
  readonly blobBoundaries: readonly string[];
}

export interface LegacyTaskSqliteMappingContractV1 {
  readonly schemaVersion: typeof LEGACY_TASK_SQLITE_MAPPING_SCHEMA_VERSION;
  readonly storageSchemaVersion: 2;
  readonly sources: readonly LegacyTaskMappingSource[];
  readonly excludedRuntimeFields: readonly string[];
}

const fields = (...values: string[]): readonly string[] => values;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/**
 * LA-085 freezes the exact legacy fields that later importers may map.
 * It is deliberately data-only and has no dependency on a production writer.
 */
export const LEGACY_TASK_SQLITE_MAPPING_CONTRACT: LegacyTaskSqliteMappingContractV1 = deepFreeze({
  schemaVersion: LEGACY_TASK_SQLITE_MAPPING_SCHEMA_VERSION,
  storageSchemaVersion: 2,
  sources: [
    {
      id: "task_workspace",
      sourceSchemaVersion: 2,
      entities: [
        { id: "snapshot", fields: fields("schemaVersion", "task", "activeRunId", "eventCursor", "projectedAt", "usage", "runs", "agentThreads", "activities", "artifacts", "decisions") },
        { id: "task", fields: fields("id", "owner", "scope", "title", "intent", "kind", "status", "titleGeneration", "createdAt", "updatedAt") },
        { id: "owner", fields: fields("kind", "projectId") },
        { id: "standalone_scope", fields: fields("kind", "workingDirectoryGrantId", "fileGrantIds") },
        { id: "project_scope", fields: fields("kind", "batchId", "segmentIds", "sourceLocale", "targetLocale") },
        { id: "title_generation", fields: fields("status", "requestedAt", "attemptId", "startedAt", "completedAt", "provider", "modelId", "usage", "error") },
        { id: "usage", fields: fields("inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens", "costUSD", "modelCalls") },
        { id: "run", fields: fields("id", "taskId", "mode", "status", "rootAgentThreadId", "planHash", "estimatedCalls", "estimatedCallsBySource", "modelRoutes", "startedAt", "updatedAt", "completedAt", "stopAvailable", "resumeAvailable", "usage", "usageBySource", "resourceManifest", "executionSnapshots", "configChanges") },
        { id: "resource_manifest", fields: fields("schemaVersion", "profile", "piRuntimeVersion", "cwd", "fileGrantIds", "packages", "activeToolNames", "conflicts", "profileRevision", "profileHash", "resources", "requestShapeHash", "systemPromptHash", "toolSurfaceHash", "resourceIndexHash", "requestShape", "mainSurface") },
        { id: "resource_package", fields: fields("name", "source", "version", "integrity") },
        { id: "resource_conflict", fields: fields("kind", "name", "winnerPath", "shadowedPath") },
        { id: "resource_selection", fields: fields("packageSource", "resourceType", "resourceId", "enabled") },
        { id: "request_shape_summary", fields: fields("schemaVersion", "systemPromptChars", "activeToolCount", "resourceCount") },
        { id: "request_shape_manifest", fields: fields("schemaVersion", "systemPromptHash", "toolSurfaceHash", "resourceIndexHash", "requestShapeHash", "systemPromptChars", "activeToolCount", "resourceCount", "activeToolNames") },
        { id: "main_resource_surface", fields: fields("packageNames", "requestShape") },
        { id: "execution_snapshot", fields: fields("schemaVersion", "executionId", "runId", "threadId", "turnId", "runtimeEpochId", "configRevision", "providerId", "modelId", "reasoningEffort", "executionProfile", "promptHash", "toolManifestHash", "resourceSnapshotHash", "capabilityGrantHash", "contextInputHash", "createdAt") },
        { id: "config_change", fields: fields("schemaVersion", "changeId", "runId", "threadId", "actor", "fromRevision", "toRevision", "changes", "effectiveFrom", "compatibility", "createdAt") },
        { id: "config_change_fields", fields: fields("modelId", "reasoningEffort", "executionProfile", "permissionProfile", "retrievalProfile") },
        { id: "config_change_value", fields: fields("from", "to") },
        { id: "thread", fields: fields("id", "taskId", "runId", "parentThreadId", "identity", "status", "canReceiveUserMessage", "handoffSummary", "latestActivityId", "childThreadIds", "piSessionId", "piSessionFile", "piEntryId", "branchPointEntryId", "branchPosition", "createdAt", "updatedAt") },
        { id: "agent_identity", fields: fields("kind", "roleId", "displayName", "roleLabel", "disclosureLabel") },
        { id: "activity", fields: fields("id", "taskId", "runId", "agentThreadId", "seq", "type", "status", "actor", "title", "body", "tool", "refs", "createdAt", "updatedAt") },
        { id: "activity_actor", fields: fields("kind", "id", "displayName", "agentThreadId") },
        { id: "tool_activity", fields: fields("name", "effect", "target", "outcome") },
        { id: "activity_refs", fields: fields("artifactIds", "evidenceRefs", "decisionIds", "segmentIds") },
        { id: "artifact", fields: fields("id", "taskId", "runId", "type", "status", "title", "summary", "scope", "version", "provenance", "availableDecisions", "content", "createdAt", "updatedAt") },
        { id: "artifact_provenance", fields: fields("agentThreadId", "activityId", "evidenceRefs", "parentArtifactIds") },
        { id: "decision", fields: fields("id", "taskId", "runId", "requestedByThreadId", "requestProvenance", "artifactId", "kind", "status", "prompt", "options", "interactionId", "questionIndex", "selectionMode", "selectedOptionId", "selectedOptionIds", "responseText", "reason", "scope", "createdAt", "decidedAt") },
        { id: "decision_option", fields: fields("id", "label", "action", "destructive", "description", "preview") },
        { id: "decision_request_provenance", fields: fields("kind", "transport", "packageSource", "packageName", "packageVersion", "resourceId", "integrity") },
      ],
      ordering: [
        "snapshot arrays preserve legacy order",
        "activities are authoritative by activity.seq within a Run",
        "executionSnapshots and configChanges are append-only in stored array order",
      ],
      revisions: [
        "snapshot.eventCursor is the replay boundary",
        "activity.seq is the per-Run activity order",
        "artifact.version is the artifact revision",
        "executionSnapshot.configRevision and configChange fromRevision/toRevision form the explicit execution epoch history",
      ],
      blobBoundaries: [
        "artifact.content is legacy inline JSON in contract v1; LA-092 may externalize bytes without changing semantic content",
        "thread.piSessionFile and resource path fields are path references, never imported file bytes",
        "no Task workspace field is a CAS blob in contract v1",
      ],
    },
    {
      id: "task_run_event",
      sourceSchemaVersion: 2,
      entities: [
        { id: "event_page", fields: fields("schemaVersion", "taskId", "runId", "afterCursor", "nextCursor", "hasMore", "events") },
        { id: "event", fields: fields("id", "cursor", "seq", "taskId", "runId", "agentThreadId", "type", "occurredAt", "run", "thread", "activity", "artifact", "decision", "usageSource", "usage") },
      ],
      ordering: [
        "events import in ascending event.seq with cursor continuity",
        "an interior corrupt record blocks import; only the legacy reader's supported torn trailing record may be classified as recoverable",
      ],
      revisions: [
        "event.seq is the canonical stream revision",
        "event.cursor and page nextCursor are opaque replay cursors and must not be regenerated",
      ],
      blobBoundaries: [
        "nested run/thread/activity/artifact/decision/usage payloads remain inline JSON",
        "event pages contain no external blob bytes",
      ],
    },
    {
      id: "quality_decision_ledger",
      sourceSchemaVersion: 1,
      entities: [
        { id: "event", fields: fields("projectId", "batchId", "workflowId", "segmentId", "findingId", "code", "severity", "kind", "decision", "reason", "evidenceRefs", "actor", "recordedAt", "logicalEventId", "schemaVersion", "sequence", "previousHash", "hash") },
      ],
      ordering: [
        "events import in ascending sequence",
        "previousHash/hash continuity is authoritative and must be verified before mapping",
      ],
      revisions: [
        "sequence is the append revision",
        "logicalEventId is the replay idempotency key when present",
        "hash is preserved evidence and must never be recomputed to hide invalid input",
      ],
      blobBoundaries: [
        "evidenceRefs are references, not embedded evidence bytes",
        "quality decision events contain no CAS blob in contract v1",
      ],
    },
    {
      id: "task_message_queue",
      sourceSchemaVersion: 1,
      entities: [
        { id: "queue", fields: fields("schemaVersion", "taskId", "paused", "pausedReason", "messages", "updatedAt") },
        { id: "message", fields: fields("id", "taskId", "runId", "text", "delivery", "status", "error", "createdAt", "updatedAt") },
      ],
      ordering: [
        "messages preserve stored array order",
      ],
      revisions: [
        "legacy queue has no numeric revision; updatedAt is preserved but must not be promoted to an invented CAS revision",
        "message.id is the stable identity",
      ],
      blobBoundaries: [
        "message.text and error remain inline text",
        "message queue contains no external blob bytes",
      ],
    },
    {
      id: "task_package_profile",
      sourceSchemaVersion: 1,
      entities: [
        { id: "profile", fields: fields("schemaVersion", "taskId", "revision", "selections", "executableApprovals", "updatedAt") },
        { id: "selection", fields: fields("packageSource", "resourceType", "resourceId", "enabled") },
        { id: "executable_approval", fields: fields("packageSource", "version", "integrity", "approvedAt") },
      ],
      ordering: [
        "selections canonical sort key is packageSource/resourceType/resourceId",
        "executableApprovals canonical sort key is packageSource/version/integrity",
      ],
      revisions: [
        "profile.revision is the optimistic concurrency revision",
        "integrity is the exact approved executable digest and must be preserved",
      ],
      blobBoundaries: [
        "package selections and approvals contain metadata only",
        "package resource bytes and resolved absolute paths are outside this persisted profile",
      ],
    },
  ],
  excludedRuntimeFields: [
    "ResolvedTaskRunResources.verifiedPiBinaryPath",
    "TaskPackageResolvedResource.path",
    "live Run handles, workers, subscriptions, timers, and provider credentials",
  ],
});

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonObject;
}

function exact(row: JsonObject, allowedFields: readonly string[], label: string): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(row).find((field) => !allowed.has(field));
  if (unknown) throw new Error(`${label} has unknown field: ${unknown}.`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}

export function parseLegacyTaskSqliteMappingContract(value: unknown): LegacyTaskSqliteMappingContractV1 {
  const row = object(value, "legacy Task SQLite mapping contract");
  exact(row, ["schemaVersion", "storageSchemaVersion", "sources", "excludedRuntimeFields"], "legacy Task SQLite mapping contract");
  if (row.schemaVersion !== LEGACY_TASK_SQLITE_MAPPING_SCHEMA_VERSION) {
    throw new Error(`legacy Task SQLite mapping contract schemaVersion must be ${LEGACY_TASK_SQLITE_MAPPING_SCHEMA_VERSION}.`);
  }
  if (row.storageSchemaVersion !== 2) throw new Error("legacy Task SQLite mapping contract storageSchemaVersion must be 2.");
  if (!Array.isArray(row.sources)) throw new Error("legacy Task SQLite mapping contract sources must be an array.");
  const sourceIds = new Set<string>();
  const sources = row.sources.map((sourceValue, sourceIndex): LegacyTaskMappingSource => {
    const source = object(sourceValue, `sources[${sourceIndex}]`);
    exact(source, ["id", "sourceSchemaVersion", "entities", "ordering", "revisions", "blobBoundaries"], `sources[${sourceIndex}]`);
    const id = nonEmptyString(source.id, `sources[${sourceIndex}].id`) as LegacyTaskMappingSourceId;
    if (!["task_workspace", "task_run_event", "quality_decision_ledger", "task_message_queue", "task_package_profile"].includes(id)) {
      throw new Error(`sources[${sourceIndex}].id is unsupported.`);
    }
    if (sourceIds.has(id)) throw new Error(`duplicate mapping source ${id}.`);
    sourceIds.add(id);
    if (!Array.isArray(source.entities)) throw new Error(`sources[${sourceIndex}].entities must be an array.`);
    const entityIds = new Set<string>();
    const entities = source.entities.map((entityValue, entityIndex): LegacyTaskMappingEntity => {
      const entity = object(entityValue, `sources[${sourceIndex}].entities[${entityIndex}]`);
      exact(entity, ["id", "fields"], `sources[${sourceIndex}].entities[${entityIndex}]`);
      const entityId = nonEmptyString(entity.id, `sources[${sourceIndex}].entities[${entityIndex}].id`);
      if (entityIds.has(entityId)) throw new Error(`duplicate mapping entity ${id}/${entityId}.`);
      entityIds.add(entityId);
      const entityFields = stringArray(entity.fields, `sources[${sourceIndex}].entities[${entityIndex}].fields`);
      if (new Set(entityFields).size !== entityFields.length) throw new Error(`duplicate field in mapping entity ${id}/${entityId}.`);
      return { id: entityId, fields: entityFields };
    });
    return {
      id,
      sourceSchemaVersion: positiveInteger(source.sourceSchemaVersion, `sources[${sourceIndex}].sourceSchemaVersion`),
      entities,
      ordering: stringArray(source.ordering, `sources[${sourceIndex}].ordering`),
      revisions: stringArray(source.revisions, `sources[${sourceIndex}].revisions`),
      blobBoundaries: stringArray(source.blobBoundaries, `sources[${sourceIndex}].blobBoundaries`),
    };
  });
  if (sourceIds.size !== 5) throw new Error("legacy Task SQLite mapping contract must define all five source contracts.");
  return {
    schemaVersion: LEGACY_TASK_SQLITE_MAPPING_SCHEMA_VERSION,
    storageSchemaVersion: 2,
    sources,
    excludedRuntimeFields: stringArray(row.excludedRuntimeFields, "excludedRuntimeFields"),
  };
}

export function requireMappedLegacyFields(
  sourceId: LegacyTaskMappingSourceId,
  entityId: string,
  value: unknown,
): void {
  const source = LEGACY_TASK_SQLITE_MAPPING_CONTRACT.sources.find((candidate) => candidate.id === sourceId);
  const entity = source?.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`unknown legacy mapping entity: ${sourceId}/${entityId}.`);
  const row = object(value, `${sourceId}/${entityId}`);
  const allowed = new Set(entity.fields);
  const unknown = Object.keys(row).find((field) => !allowed.has(field));
  if (unknown) throw new Error(`${sourceId}/${entityId} has unmapped field: ${unknown}.`);
}

export function legacyTaskSqliteMappingContractJson(): string {
  return JSON.stringify(LEGACY_TASK_SQLITE_MAPPING_CONTRACT);
}
