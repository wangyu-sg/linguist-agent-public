import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  addVoiceExemplar,
  buildVoiceProfileRoster,
  confirmVoiceProfile,
  deleteVoiceExemplar,
  listVoiceExemplars,
  promoteReviewedToExemplars,
  readVoiceProfile,
  upsertVoiceProfile,
  type VoiceExemplarOrigin,
  type VoiceExemplarTextType,
  type VoiceProfileStatus,
} from "@linguist-agent/cat-data";

export interface VoiceRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  requireString: (value: unknown, label: string) => string;
  optionalString: (value: unknown) => string | undefined;
}

const VOICE_PROFILE_STATUSES = new Set<VoiceProfileStatus>(["not_started", "draft", "confirmed"]);
const TEXT_TYPES = new Set<VoiceExemplarTextType>(["dialogue", "ui", "skill_desc", "system", "lore", "marketing"]);
const EXEMPLAR_ORIGINS = new Set<VoiceExemplarOrigin>(["golden", "reviewed_tm_clean", "styleguide", "external_ref"]);

function asTextType(value: unknown): VoiceExemplarTextType {
  const text = typeof value === "string" ? value : "";
  if (TEXT_TYPES.has(text as VoiceExemplarTextType)) return text as VoiceExemplarTextType;
  throw new Error(`Invalid voice textType "${text}". Expected one of ${Array.from(TEXT_TYPES).join(", ")}.`);
}

function asExemplarOrigin(value: unknown): VoiceExemplarOrigin {
  const text = typeof value === "string" ? value : "";
  if (EXEMPLAR_ORIGINS.has(text as VoiceExemplarOrigin)) return text as VoiceExemplarOrigin;
  throw new Error(`Invalid voice exemplar origin "${text}". Expected one of ${Array.from(EXEMPLAR_ORIGINS).join(", ")}.`);
}

function asVoiceProfileStatus(value: unknown): VoiceProfileStatus | undefined {
  const text = typeof value === "string" ? value : undefined;
  if (text && VOICE_PROFILE_STATUSES.has(text as VoiceProfileStatus)) return text as VoiceProfileStatus;
  if (text) throw new Error(`Invalid voice profile status "${text}". Expected one of ${Array.from(VOICE_PROFILE_STATUSES).join(", ")}.`);
  return undefined;
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

function asVoiceProfileEntry(value: unknown): VoiceProfileEntryInput {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object") throw new Error("voice profile entry must be an object.");
  return {
    id: typeof row.id === "string" && row.id.trim() ? row.id : `vp-${randomId()}`,
    textType: asTextType(row.textType),
    speaker: row.speaker === null || row.speaker === undefined ? null : requireLocalString(row.speaker, "speaker"),
    register: requireLocalString(row.register, "register"),
    person: optionalLocalString(row.person),
    contractionLevel: optionalLocalString(row.contractionLevel),
    toneMarkers: optionalStringArray(row.toneMarkers, "toneMarkers"),
    taboos: optionalStringArray(row.taboos, "taboos"),
    notes: optionalLocalString(row.notes),
  };
}

function randomId(): string {
  return randomUUID().slice(0, 12);
}

function requireLocalString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} required`);
  return value;
}

function optionalLocalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Handles voice-layer routes:
 *   GET/PUT  /api/projects/:projectId/batches/:batchId/voice-profile
 *   POST     /api/projects/:projectId/batches/:batchId/voice-profile/confirm
 *   GET      /api/projects/:projectId/batches/:batchId/voice-profile/roster
 *   GET/POST /api/projects/:projectId/voice-exemplars
 *   DELETE   /api/projects/:projectId/voice-exemplars/:exemplarId
 *   POST     /api/projects/:projectId/voice-exemplars/promote-reviewed
 */
export async function handleVoiceRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  projectId: string,
  deps: VoiceRouteDeps,
): Promise<boolean> {
  if (parts[0] !== "api" || parts[1] !== "projects" || !parts[2] || parts[2] !== projectId) return false;

  // Project-level exemplar routes: /api/projects/:projectId/voice-exemplars[/:id[/promote-reviewed]]
  if (parts[3] === "voice-exemplars") {
    if (parts.length === 4 && req.method === "GET") {
      const url = new URL(req.url ?? "", "http://localhost");
      const textType = deps.optionalString(url.searchParams.get("textType") ?? undefined);
      const speaker = deps.optionalString(url.searchParams.get("speaker") ?? undefined);
      const limitRaw = url.searchParams.get("limit");
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
      deps.json(
        res,
        200,
        await listVoiceExemplars(deps.repoRoot, projectId, {
          textType: textType ? asTextType(textType) : undefined,
          speaker,
          limit: Number.isFinite(limit) && (limit ?? 0) > 0 ? limit : undefined,
        }),
      );
      return true;
    }
    if (parts.length === 4 && req.method === "POST") {
      const body = (await deps.readBody(req)) as Record<string, unknown>;
      const exemplar = await addVoiceExemplar(deps.repoRoot, projectId, {
        textType: asTextType(body.textType),
        speaker: body.speaker === null || body.speaker === undefined ? null : deps.requireString(body.speaker, "speaker"),
        register: deps.requireString(body.register, "register"),
        source: deps.requireString(body.source, "source"),
        target: deps.requireString(body.target, "target"),
        origin: asExemplarOrigin(body.origin ?? "golden"),
        evidenceSource: deps.requireString(body.evidenceSource, "evidenceSource"),
        srcLang: deps.optionalString(body.srcLang),
        tgtLang: deps.optionalString(body.tgtLang),
      });
      deps.json(res, 201, exemplar);
      return true;
    }
    if (parts.length === 5 && req.method === "DELETE") {
      await deleteVoiceExemplar(deps.repoRoot, projectId, decodeURIComponent(parts[4]));
      res.statusCode = 204;
      res.end();
      return true;
    }
    if (parts.length === 5 && parts[4] === "promote-reviewed" && req.method === "POST") {
      const body = (await deps.readBody(req)) as Record<string, unknown>;
      deps.json(
        res,
        200,
        await promoteReviewedToExemplars(deps.repoRoot, projectId, {
          batchId: deps.requireString(body.batchId, "batchId"),
          maxDefectSeverity: deps.optionalString(body.maxDefectSeverity),
        }),
      );
      return true;
    }
    return false;
  }

  // Batch-level voice-profile routes: /api/projects/:projectId/batches/:batchId/voice-profile[/{confirm,roster}]
  if (parts[3] === "batches" && parts[4] && parts[5] === "voice-profile") {
    const batchId = decodeURIComponent(parts[4]);
    if (parts.length === 6 && req.method === "GET") {
      deps.json(res, 200, await readVoiceProfile(deps.repoRoot, projectId, batchId));
      return true;
    }
    if (parts.length === 6 && req.method === "PUT") {
      const body = (await deps.readBody(req)) as Record<string, unknown>;
      deps.json(
        res,
        200,
        await upsertVoiceProfile(deps.repoRoot, projectId, batchId, {
          status: asVoiceProfileStatus(body.status),
          updatedBy: deps.optionalString(body.updatedBy),
          entries: Array.isArray(body.entries) ? body.entries.map(asVoiceProfileEntry) : undefined,
          replaceEntries: Boolean(body.replaceEntries),
        }),
      );
      return true;
    }
    if (parts.length === 7 && parts[6] === "confirm" && req.method === "POST") {
      const body = (await deps.readBody(req)) as Record<string, unknown>;
      deps.json(
        res,
        200,
        await confirmVoiceProfile(deps.repoRoot, projectId, batchId, deps.requireString(body.confirmedBy, "confirmedBy")),
      );
      return true;
    }
    if (parts.length === 7 && parts[6] === "roster" && req.method === "GET") {
      deps.json(res, 200, { schemaVersion: 1, projectId, batchId, roster: await buildVoiceProfileRoster(deps.repoRoot, projectId, batchId) });
      return true;
    }
    return false;
  }

  return false;
}

// Local type for the incoming entries array; matches VoiceProfileEntry minus the server-assigned id handling.
interface VoiceProfileEntryInput {
  id: string;
  textType: VoiceExemplarTextType;
  speaker: string | null;
  register: string;
  person?: string;
  contractionLevel?: string;
  toneMarkers?: string[];
  taboos?: string[];
  notes?: string;
}
