import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createWorkspace, workspacePath } from "./workspace.js";
import { readBatch } from "./batch_workspace.js";
import { createTmStore, type TmEntry } from "./tm.js";

export type VoiceExemplarOrigin = "golden" | "reviewed_tm_clean" | "styleguide" | "external_ref";
export type VoiceExemplarTextType = "dialogue" | "ui" | "skill_desc" | "system" | "lore" | "marketing";

export interface VoiceExemplar {
  id: string;
  textType: VoiceExemplarTextType;
  speaker: string | null;
  register: string;
  source: string;
  target: string;
  origin: VoiceExemplarOrigin;
  evidenceSource: string;
  srcLang?: string;
  tgtLang?: string;
  createdAt: string;
}

export interface VoiceExemplarList {
  schemaVersion: 1;
  projectId: string;
  count: number;
  exemplars: VoiceExemplar[];
}

export interface VoiceExemplarInput {
  textType: VoiceExemplarTextType;
  speaker: string | null;
  register: string;
  source: string;
  target: string;
  origin: VoiceExemplarOrigin;
  evidenceSource: string;
  srcLang?: string;
  tgtLang?: string;
}

export interface VoiceExemplarPromotionResult {
  schemaVersion: 1;
  projectId: string;
  promoted: number;
  rejected: number;
  rejectedSamples: { segmentId: string; reason: string }[];
}

function voiceExemplarsPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "voice_exemplars.jsonl");
}

async function readAllExemplars(workspaceRoot: string, projectId: string): Promise<VoiceExemplar[]> {
  const path = voiceExemplarsPath(workspaceRoot, projectId);
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const exemplars: VoiceExemplar[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      exemplars.push(JSON.parse(line) as VoiceExemplar);
    } catch (error) {
      throw new Error(`Invalid voice exemplar JSONL at ${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return exemplars;
}

export async function listVoiceExemplars(
  workspaceRoot: string,
  projectId: string,
  options: { textType?: VoiceExemplarTextType; speaker?: string; limit?: number } = {},
): Promise<VoiceExemplarList> {
  let exemplars = await readAllExemplars(workspaceRoot, projectId);
  if (options.textType) exemplars = exemplars.filter((exemplar) => exemplar.textType === options.textType);
  if (options.speaker !== undefined) {
    exemplars = exemplars.filter((exemplar) => (exemplar.speaker ?? null) === (options.speaker ?? null));
  }
  if (options.limit && options.limit > 0) exemplars = exemplars.slice(0, options.limit);
  return { schemaVersion: 1, projectId, count: exemplars.length, exemplars };
}

export async function addVoiceExemplar(
  workspaceRoot: string,
  projectId: string,
  input: VoiceExemplarInput,
): Promise<VoiceExemplar> {
  if (!input.source.trim() || !input.target.trim()) {
    throw new Error("voice exemplar requires non-empty source and target.");
  }
  const exemplar: VoiceExemplar = {
    id: `vex-${randomUUID().slice(0, 12)}`,
    textType: input.textType,
    speaker: input.speaker,
    register: input.register,
    source: input.source,
    target: input.target,
    origin: input.origin,
    evidenceSource: input.evidenceSource,
    srcLang: input.srcLang,
    tgtLang: input.tgtLang,
    createdAt: new Date().toISOString(),
  };
  const path = voiceExemplarsPath(workspaceRoot, projectId);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(exemplar)}\n`, "utf8");
  return exemplar;
}

export async function deleteVoiceExemplar(workspaceRoot: string, projectId: string, exemplarId: string): Promise<void> {
  const exemplars = await readAllExemplars(workspaceRoot, projectId);
  const filtered = exemplars.filter((exemplar) => exemplar.id !== exemplarId);
  if (filtered.length === exemplars.length) return; // id not found: idempotent no-op
  const path = voiceExemplarsPath(workspaceRoot, projectId);
  const { writeFile } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, filtered.map((exemplar) => JSON.stringify(exemplar)).join("\n") + (filtered.length ? "\n" : ""), "utf8");
}

export async function promoteReviewedToExemplars(
  workspaceRoot: string,
  projectId: string,
  options: { batchId: string; maxDefectSeverity?: string },
): Promise<VoiceExemplarPromotionResult> {
  const batch = await readBatch(workspaceRoot, projectId, options.batchId);
  const existing = await readAllExemplars(workspaceRoot, projectId);
  const existingKeys = new Set(existing.map(exemplarKey));
  const tmEntries = await createTmStore(createWorkspace(workspaceRoot, projectId)).list();
  let promoted = 0;
  let rejected = 0;
  const rejectedSamples: VoiceExemplarPromotionResult["rejectedSamples"] = [];

  for (const entry of tmEntries) {
    const reason = rejectReviewedTmForExemplar(entry, batch.sourceLanguage, batch.targetLanguage, existingKeys);
    if (reason) {
      rejected += 1;
      if (rejectedSamples.length < 10) rejectedSamples.push({ segmentId: entry.id, reason });
      continue;
    }
    const exemplar = await addVoiceExemplar(workspaceRoot, projectId, {
      textType: inferTextType(entry.source),
      speaker: null,
      register: "reviewed TM",
      source: entry.source,
      target: entry.target,
      origin: "reviewed_tm_clean",
      evidenceSource: `tm:${entry.id}`,
      srcLang: entry.srcLang,
      tgtLang: entry.tgtLang,
    });
    existingKeys.add(exemplarKey(exemplar));
    promoted += 1;
  }

  return {
    schemaVersion: 1,
    projectId,
    promoted,
    rejected,
    rejectedSamples,
  };
}

function exemplarKey(exemplar: Pick<VoiceExemplar, "textType" | "speaker" | "source" | "target">): string {
  return [
    exemplar.textType,
    exemplar.speaker ?? "",
    exemplar.source.trim().toLocaleLowerCase(),
    exemplar.target.trim().toLocaleLowerCase(),
  ].join("\u0000");
}

function rejectReviewedTmForExemplar(entry: TmEntry, srcLang: string, tgtLang: string, existingKeys: Set<string>): string | null {
  if (entry.origin !== "reviewed") return "not reviewed TM";
  if (!entry.source.trim() || !entry.target.trim()) return "empty source or target";
  if ((entry.quality ?? 0) < 100) return "quality below 100";
  if (!langCompatible(entry.srcLang, srcLang) || !langCompatible(entry.tgtLang, tgtLang)) return "language pair mismatch";
  const candidate = { textType: inferTextType(entry.source), speaker: null, source: entry.source, target: entry.target };
  if (existingKeys.has(exemplarKey(candidate))) return "duplicate exemplar";
  return null;
}

function langCompatible(value: string | undefined, expected: string | undefined): boolean {
  if (!value || !expected) return true;
  return value.toLocaleLowerCase().split("-", 1)[0] === expected.toLocaleLowerCase().split("-", 1)[0];
}

function inferTextType(source: string): VoiceExemplarTextType {
  const text = source.trim();
  if (text.length <= 16 && !/[。！？.!?]/.test(text)) return "ui";
  return "system";
}
