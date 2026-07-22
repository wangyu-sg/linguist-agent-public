import { readBatch, type BatchSegment } from "./batch_workspace.js";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";

export type VoiceProfileStatus = "not_started" | "draft" | "confirmed";
export type VoiceTextType = "dialogue" | "ui" | "skill_desc" | "system" | "lore" | "marketing";

export interface VoiceProfileEntry {
  id: string;
  textType: VoiceTextType;
  speaker: string | null;
  register: string;
  person?: string;
  contractionLevel?: string;
  toneMarkers?: string[];
  taboos?: string[];
  notes?: string;
}

export interface VoiceProfileRosterEntry {
  speaker: string | null;
  segmentIds: string[];
  count: number;
  textTypes?: VoiceTextType[];
}

export interface VoiceProfile {
  schemaVersion: 1;
  projectId: string;
  batchId: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  status: VoiceProfileStatus;
  updatedAt: string | null;
  updatedBy: string | null;
  entries: VoiceProfileEntry[];
  roster: VoiceProfileRosterEntry[];
}

interface VoiceProfileDocument {
  schemaVersion: 1;
  profile: VoiceProfile | null;
}

function voiceProfilePath(workspaceRoot: string, projectId: string, batchId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "batches", batchId, "voice_profile.json");
}

function emptyProfile(projectId: string, batchId: string): VoiceProfile {
  return {
    schemaVersion: 1,
    projectId,
    batchId,
    status: "not_started",
    updatedAt: null,
    updatedBy: null,
    entries: [],
    roster: [],
  };
}

function normalizeDocument(raw: VoiceProfileDocument | VoiceProfile | null | undefined, projectId: string, batchId: string): VoiceProfileDocument {
  if (!raw) return { schemaVersion: 1, profile: emptyProfile(projectId, batchId) };
  if ("profile" in raw && raw.profile !== undefined) {
    return { schemaVersion: 1, profile: raw.profile ?? emptyProfile(projectId, batchId) };
  }
  // Tolerate a bare profile object written directly.
  const profile = raw as VoiceProfile;
  return { schemaVersion: 1, profile: { ...emptyProfile(projectId, batchId), ...profile } };
}

export async function readVoiceProfile(workspaceRoot: string, projectId: string, batchId: string): Promise<VoiceProfile> {
  const doc = normalizeDocument(
    await readJsonFile<VoiceProfileDocument | null>(voiceProfilePath(workspaceRoot, projectId, batchId), null),
    projectId,
    batchId,
  );
  const profile = doc.profile ?? emptyProfile(projectId, batchId);
  // Backfill batch-derived fields so the frontend can mirror the contract
  // without re-deriving language pair or speaker roster.
  try {
    const batch = await readBatch(workspaceRoot, projectId, batchId);
    return {
      ...profile,
      sourceLanguage: profile.sourceLanguage ?? batch.sourceLanguage,
      targetLanguage: profile.targetLanguage ?? batch.targetLanguage,
      roster: buildRosterFromSegments(batch.segments),
    };
  } catch {
    return profile;
  }
}

async function writeVoiceProfile(workspaceRoot: string, projectId: string, batchId: string, profile: VoiceProfile): Promise<VoiceProfile> {
  await writeJsonFile(voiceProfilePath(workspaceRoot, projectId, batchId), { schemaVersion: 1, profile });
  return profile;
}

export interface VoiceProfileUpsertInput {
  status?: VoiceProfileStatus;
  updatedBy?: string;
  entries?: VoiceProfileEntry[];
  /** When true, replace the whole entries array; when false (default), upsert by entry id. */
  replaceEntries?: boolean;
}

export async function upsertVoiceProfile(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  input: VoiceProfileUpsertInput,
): Promise<VoiceProfile> {
  const current = await readVoiceProfile(workspaceRoot, projectId, batchId);
  const entries = input.replaceEntries && input.entries
    ? input.entries
    : input.entries
      ? mergeEntries(current.entries, input.entries)
      : current.entries;
  const next: VoiceProfile = {
    ...current,
    status: input.status ?? current.status,
    updatedBy: input.updatedBy ?? current.updatedBy,
    updatedAt: new Date().toISOString(),
    entries,
  };
  return writeVoiceProfile(workspaceRoot, projectId, batchId, next);
}

function mergeEntries(current: VoiceProfileEntry[], incoming: VoiceProfileEntry[]): VoiceProfileEntry[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    byId.set(entry.id, { ...byId.get(entry.id), ...entry });
  }
  return Array.from(byId.values());
}

export async function confirmVoiceProfile(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
  confirmedBy: string,
): Promise<VoiceProfile> {
  return upsertVoiceProfile(workspaceRoot, projectId, batchId, { status: "confirmed", updatedBy: confirmedBy });
}

/**
 * Build a roster (speaker -> segment ids) from the batch segments. This is a
 * deterministic helper the frontend can call without re-deriving; a fuller
 * draft-profile generator (LLM-assisted) is a later implementation step.
 */
export async function buildVoiceProfileRoster(
  workspaceRoot: string,
  projectId: string,
  batchId: string,
): Promise<VoiceProfileRosterEntry[]> {
  const batch = await readBatch(workspaceRoot, projectId, batchId);
  return buildRosterFromSegments(batch.segments);
}

function buildRosterFromSegments(segments: BatchSegment[]): VoiceProfileRosterEntry[] {
  const bySpeaker = new Map<string | null, { ids: string[]; textTypes: Set<VoiceTextType> }>();
  for (const segment of segments) {
    // BatchSegment carries optional speaker metadata; fall back to null (non-diegetic).
    const speaker = (segment as { speaker?: string | null }).speaker ?? null;
    const textType = inferTextType(segment.source) ?? null;
    const bucket = bySpeaker.get(speaker) ?? { ids: [], textTypes: new Set<VoiceTextType>() };
    bucket.ids.push(segment.id);
    if (textType) bucket.textTypes.add(textType);
    bySpeaker.set(speaker, bucket);
  }
  return Array.from(bySpeaker.entries()).map(([speaker, bucket]) => ({
    speaker,
    segmentIds: bucket.ids,
    count: bucket.ids.length,
    textTypes: bucket.textTypes.size ? Array.from(bucket.textTypes) : undefined,
  }));
}

// Minimal heuristic text-type inference used only for roster grouping until a
// classifier-backed builder lands. Conservative: returns undefined when unsure.
function inferTextType(source: string): VoiceTextType | undefined {
  const text = source.trim();
  if (!text) return undefined;
  // Very short UI-like labels (no terminal punctuation, <= 12 chars).
  if (text.length <= 12 && !/[。！？.!?]/.test(text)) return "ui";
  return undefined;
}
