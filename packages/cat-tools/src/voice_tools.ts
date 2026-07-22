import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  addVoiceExemplar,
  buildVoiceProfileRoster,
  confirmVoiceProfile,
  listVoiceExemplars,
  readVoiceProfile,
  upsertVoiceProfile,
  type CatWorkspace,
  type VoiceExemplarOrigin,
  type VoiceExemplarTextType,
  type VoiceProfileEntry,
  type VoiceProfileRosterEntry,
  type VoiceTextType,
} from "@linguist-agent/cat-data";

const voiceProfileBuildParameters = Type.Object({
  batchId: Type.String({ description: "Batch id to build a draft voice profile for." }),
  replace: Type.Optional(Type.Boolean({ description: "Replace existing profile entries. Defaults to false." })),
  updatedBy: Type.Optional(Type.String({ description: "Author recorded on the voice profile. Defaults to agent." })),
});

const voiceProfileConfirmParameters = Type.Object({
  batchId: Type.String({ description: "Batch id whose voice profile should be confirmed." }),
  confirmedBy: Type.Optional(Type.String({ description: "Reviewer/user recorded as confirming the profile. Defaults to agent." })),
});

const exemplarLookupParameters = Type.Object({
  textType: Type.Optional(Type.String({ description: "Optional exemplar text type filter: dialogue, ui, skill_desc, system, lore, marketing." })),
  speaker: Type.Optional(Type.String({ description: "Optional speaker filter. Omit for all speakers." })),
  limit: Type.Optional(Type.Number({ description: "Maximum exemplars to return. Defaults to 10." })),
});

const exemplarAddParameters = Type.Object({
  textType: Type.String({ description: "Exemplar text type: dialogue, ui, skill_desc, system, lore, marketing." }),
  source: Type.String({ description: "Source line." }),
  target: Type.String({ description: "High-quality target line." }),
  register: Type.Optional(Type.String({ description: "Register label. Defaults to golden." })),
  speaker: Type.Optional(Type.String({ description: "Optional speaker name." })),
  origin: Type.Optional(Type.String({ description: "golden, reviewed_tm_clean, styleguide, or external_ref. Defaults to golden." })),
  evidenceSource: Type.Optional(Type.String({ description: "Evidence/source label. Defaults to agent:manual." })),
  srcLang: Type.Optional(Type.String({ description: "Optional source language code." })),
  tgtLang: Type.Optional(Type.String({ description: "Optional target language code." })),
});

const TEXT_TYPES = new Set<VoiceExemplarTextType>(["dialogue", "ui", "skill_desc", "system", "lore", "marketing"]);
const ORIGINS = new Set<VoiceExemplarOrigin>(["golden", "reviewed_tm_clean", "styleguide", "external_ref"]);

function asTextType(value: string | undefined, fallback: VoiceExemplarTextType = "ui"): VoiceExemplarTextType {
  if (!value) return fallback;
  if (TEXT_TYPES.has(value as VoiceExemplarTextType)) return value as VoiceExemplarTextType;
  throw new Error(`Invalid textType "${value}". Expected one of ${Array.from(TEXT_TYPES).join(", ")}.`);
}

function optionalTextType(value: string | undefined): VoiceExemplarTextType | undefined {
  return value ? asTextType(value) : undefined;
}

function asOrigin(value: string | undefined): VoiceExemplarOrigin {
  if (!value) return "golden";
  if (ORIGINS.has(value as VoiceExemplarOrigin)) return value as VoiceExemplarOrigin;
  throw new Error(`Invalid exemplar origin "${value}". Expected one of ${Array.from(ORIGINS).join(", ")}.`);
}

function defaultRegister(textType: VoiceTextType, targetLanguage?: string): string {
  const locale = targetLanguage?.trim() ? ` for ${targetLanguage.trim()}` : " in the target language";
  switch (textType) {
    case "dialogue":
      return "natural character dialogue; preserve speaker voice and avoid flat literal phrasing";
    case "lore":
      return "polished fantasy-game lore; clear, elevated where the source is elevated";
    case "marketing":
      return `persuasive game marketing${locale}; idiomatic, not word-for-word`;
    case "skill_desc":
      return `concise gameplay description${locale}; exact mechanics first, natural target-language phrasing second`;
    case "system":
      return `clear system-message phrasing${locale}; follow target-platform conventions`;
    case "ui":
    default:
      return `concise natural game UI${locale}`;
  }
}

function draftEntriesFromRoster(roster: VoiceProfileRosterEntry[], targetLanguage?: string): VoiceProfileEntry[] {
  const entries: VoiceProfileEntry[] = [];
  for (const row of roster) {
    const textTypes = row.textTypes?.length ? row.textTypes : ["ui" as VoiceTextType];
    for (const textType of textTypes) {
      entries.push({
        id: `vp-${entries.length + 1}`,
        textType,
        speaker: row.speaker ?? null,
        register: defaultRegister(textType, targetLanguage),
        toneMarkers: [],
        taboos: ["avoid translationese", "do not ignore confirmed TM/TB constraints"],
        notes: `${row.count} segment(s) in batch roster.`,
      });
    }
  }
  if (!entries.length) {
    entries.push({
      id: "vp-1",
      textType: "ui",
      speaker: null,
      register: defaultRegister("ui", targetLanguage),
      toneMarkers: [],
      taboos: ["avoid translationese", "do not ignore confirmed TM/TB constraints"],
    });
  }
  return entries;
}

export function createVoiceProfileBuildTool(workspace: CatWorkspace) {
  return defineTool<typeof voiceProfileBuildParameters>({
    name: "voice_profile_build",
    label: "Build Voice Profile",
    description: "Build an optional draft batch voice profile from recurring speaker, register, or brand evidence when it will improve cross-segment consistency.",
    promptSnippet: "voice_profile_build: create and confirm a reusable voice profile when recurring speakers, brand voice, or a coherent expressive batch justify it; skip ceremony for small one-off work.",
    promptGuidelines: [
      "Use when recurring speakers, brand voice, or enough coherent expressive evidence make a reusable profile valuable; it is not mandatory for every new batch.",
      "Do not overwrite a confirmed profile unless the user asks for a rebuild.",
      "After building, summarize the proposed register/speaker rules and ask for confirmation or call voice_profile_confirm when already explicitly approved.",
    ],
    parameters: voiceProfileBuildParameters,
    async execute(_id, params) {
      const current = await readVoiceProfile(workspace.root, workspace.projectId, params.batchId);
      if (current.status === "confirmed" && !params.replace) {
        return {
          content: [{ type: "text" as const, text: `Voice profile already confirmed for ${params.batchId}; not overwritten. Use replace=true only with explicit approval.` }],
          details: current,
        };
      }
      const roster = await buildVoiceProfileRoster(workspace.root, workspace.projectId, params.batchId);
      const entries = params.replace || !current.entries.length ? draftEntriesFromRoster(roster, current.targetLanguage) : current.entries;
      const profile = await upsertVoiceProfile(workspace.root, workspace.projectId, params.batchId, {
        status: "draft",
        updatedBy: params.updatedBy ?? "agent",
        entries,
        replaceEntries: true,
      });
      return {
        content: [{
          type: "text" as const,
          text: [
            `Voice profile draft · ${params.batchId} · ${profile.entries.length} entry(ies), ${profile.roster.length} roster row(s).`,
            `Showing ${Math.min(20, profile.entries.length)}/${profile.entries.length} draft entry(ies); the structured result contains the complete profile.`,
            ...profile.entries.slice(0, 20).map((entry) => `- ${entry.textType}${entry.speaker ? ` · ${entry.speaker}` : ""}: ${entry.register}`),
          ].join("\n"),
        }],
        details: profile,
      };
    },
  });
}

export function createVoiceProfileConfirmTool(workspace: CatWorkspace) {
  return defineTool<typeof voiceProfileConfirmParameters>({
    name: "voice_profile_confirm",
    label: "Confirm Voice Profile",
    description: "Confirm a batch voice profile so constraint_pack and expressive_audit can treat it as the governing voice/register source.",
    promptSnippet: "voice_profile_confirm: mark a reviewed batch voice profile as confirmed before relying on voice constraints.",
    promptGuidelines: [
      "Use only after the user has approved the profile or after you have clearly presented it and received confirmation.",
      "Confirmed voice profiles affect constraint_pack and expressive_audit; do not confirm placeholder profiles silently.",
    ],
    parameters: voiceProfileConfirmParameters,
    async execute(_id, params) {
      const profile = await confirmVoiceProfile(workspace.root, workspace.projectId, params.batchId, params.confirmedBy ?? "agent");
      return {
        content: [{ type: "text" as const, text: `Voice profile confirmed · ${params.batchId} · ${profile.entries.length} entry(ies).` }],
        details: profile,
      };
    },
  });
}

export function createExemplarLookupTool(workspace: CatWorkspace) {
  return defineTool<typeof exemplarLookupParameters>({
    name: "exemplar_lookup",
    label: "Voice Exemplar Lookup",
    description: "Look up curated voice exemplars for a project by text type or speaker. Exemplars are quality-ceiling examples, separate from TM consistency matches.",
    promptSnippet: "exemplar_lookup: retrieve curated voice examples before writing expressive or register-sensitive target lines.",
    promptGuidelines: [
      "Use exemplars as style/voice anchors, not as mandatory TM targets.",
      "Prefer golden and clean reviewed-TM exemplars when choosing register for a new batch.",
    ],
    parameters: exemplarLookupParameters,
    async execute(_id, params) {
      const result = await listVoiceExemplars(workspace.root, workspace.projectId, {
        textType: optionalTextType(params.textType),
        speaker: params.speaker,
        limit: params.limit ?? 10,
      });
      const lines = result.exemplars.map((exemplar) => `- ${exemplar.textType}${exemplar.speaker ? ` · ${exemplar.speaker}` : ""} · ${exemplar.origin}: ${exemplar.source} → ${exemplar.target}`);
      return {
        content: [{ type: "text" as const, text: [`Voice exemplars · ${result.count} result(s).`, ...lines].join("\n") }],
        details: result,
      };
    },
  });
}

export function createExemplarAddTool(workspace: CatWorkspace) {
  return defineTool<typeof exemplarAddParameters>({
    name: "exemplar_add",
    label: "Add Voice Exemplar",
    description: "Add a manual golden-line or styleguide voice exemplar to the project exemplar store.",
    promptSnippet: "exemplar_add: persist a user-approved high-quality example as a voice exemplar.",
    promptGuidelines: [
      "Use only for customer-approved or user-approved high-quality examples.",
      "Do not add ordinary machine output or uncertain proposals as golden exemplars.",
    ],
    parameters: exemplarAddParameters,
    async execute(_id, params) {
      const exemplar = await addVoiceExemplar(workspace.root, workspace.projectId, {
        textType: asTextType(params.textType),
        speaker: params.speaker ?? null,
        register: params.register ?? "golden",
        source: params.source,
        target: params.target,
        origin: asOrigin(params.origin),
        evidenceSource: params.evidenceSource ?? "agent:manual",
        srcLang: params.srcLang,
        tgtLang: params.tgtLang,
      });
      return {
        content: [{ type: "text" as const, text: `Voice exemplar added · ${exemplar.id} · ${exemplar.textType}${exemplar.speaker ? ` · ${exemplar.speaker}` : ""}.` }],
        details: exemplar,
      };
    },
  });
}
