import type {
  TaskAgentIdentity,
  TaskAgentThread,
  TaskRunStatus,
} from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

/**
 * Persona registry for the conversation timeline (Agent 人设系统).
 *
 * Model-backed roles get an authored persona — English name, professional
 * title, and a hand-drawn SVG mark rendered on a muted duotone tile.
 * Setup/final are two runtime contracts owned by the same Lead Linguist.
 * Deterministic roles (loc_engineer_gate / delivery_manager, see
 * packages/cat-data team_workflow DETERMINISTIC_TEAM_ROLE_IDS) stay
 * non-human station identities in neutral slate.
 * Unknown roleIds fall back to the server-provided displayName/roleLabel
 * with a neutral avatar — never throw.
 *
 * hueKey maps onto the `--la-persona-<hueKey>` / `--la-persona-<hueKey>-surface`
 * token pair (see styles/tokens.css); components only read the CSS variables.
 * Persona hues render only inside the avatar tile and status dot.
 */

export type PersonaHueKey =
  | "translator"
  | "editor"
  | "proofreader"
  | "lead-final"
  | "lead-setup"
  | "pre-lqa"
  | "producer"
  | "culturalization"
  | "slate"
  | "neutral";

export type PersonaStatus = "running" | "waiting" | "done" | "failed" | "stopped";

/** Deterministic station glyph keys, rendered by PersonaAvatar. */
export type PersonaIconKey = "cog" | "package-check" | "wrench";

/**
 * Persona mark glyph keys. Each model-backed persona has its own mark
 * (never a letter): the avatar tile shows the mark, not a monogram.
 */
export type PersonaMarkKey =
  | "swap"
  | "nib"
  | "lens-check"
  | "seal"
  | "compass"
  | "scan"
  | "clapper"
  | "globe"
  | "flag"
  | "person";

export interface Persona {
  /** Stable registry key, e.g. "translator", "loc_engineer_gate", "main". */
  key: string;
  /** Persona name (e.g. Jules); deterministic roles use station names. */
  personaName: string;
  /** English job title; deterministic roles are explicitly systems. */
  title: string;
  /** Suffix of the --la-persona-* token pair. */
  hueKey: PersonaHueKey;
  /** Authored mark glyph rendered inside the avatar tile. */
  mark: PersonaMarkKey;
  /** 一句话性格（title 提示用）；确定性工序描述其工序职责。 */
  blurb: string;
  /** Deterministic station (工程台/交付台)：不装人，System 身份。 */
  deterministic: boolean;
  /** Deterministic station glyph. */
  icon?: PersonaIconKey;
}

type PersonaEntry = Omit<Persona, "key">;

const TEAM_PERSONAS: Record<string, PersonaEntry> = {
  translator: {
    personaName: "Jules",
    title: "Translator",
    hueKey: "translator",
    mark: "swap",
    blurb: "先啃最难的句子，术语一律先过库。",
    deterministic: false,
  },
  editor: {
    personaName: "Noa",
    title: "Editor",
    hueKey: "editor",
    mark: "nib",
    blurb: "管语气和一致性，专挑不顺眼的地方。",
    deterministic: false,
  },
  proofreader: {
    personaName: "Wren",
    title: "Proofreader",
    hueKey: "proofreader",
    mark: "lens-check",
    blurb: "标点、空格、拼写，最后一个过手的人。",
    deterministic: false,
  },
  lead_linguist_final: {
    personaName: "Auden",
    title: "Lead Linguist",
    hueKey: "lead-final",
    mark: "seal",
    blurb: "终审把最后一道，不过关不出货。",
    deterministic: false,
  },
  lead_linguist_setup: {
    personaName: "Auden",
    title: "Lead Linguist",
    hueKey: "lead-final",
    mark: "seal",
    blurb: "开局先定调：风格、术语、禁区。",
    deterministic: false,
  },
  pre_lqa_reviewer: {
    personaName: "Kit",
    title: "Pre-LQA Reviewer",
    hueKey: "pre-lqa",
    mark: "scan",
    blurb: "问题在上 LQA 之前拦下来。",
    deterministic: false,
  },
  producer: {
    personaName: "Marlow",
    title: "Producer",
    hueKey: "producer",
    mark: "clapper",
    blurb: "排期、节奏、资源，一样不掉。",
    deterministic: false,
  },
  culturalization_reviewer: {
    personaName: "Sana",
    title: "Culturalization Reviewer",
    hueKey: "culturalization",
    mark: "globe",
    blurb: "梗、俚语、雷区，能不能落地先问他。",
    deterministic: false,
  },
  loc_engineer_gate: {
    personaName: "Engineering Gate",
    title: "Deterministic System",
    hueKey: "slate",
    mark: "person",
    blurb: "确定性工程检查：占位符、标签、格式，不调用模型。",
    deterministic: true,
    icon: "cog",
  },
  delivery_manager: {
    personaName: "Delivery Gate",
    title: "Deterministic System",
    hueKey: "slate",
    mark: "person",
    blurb: "确定性交付工序：校验与导出，不调用模型。",
    deterministic: true,
    icon: "package-check",
  },
};

const MAIN_PERSONA: PersonaEntry = {
  personaName: "Rowan",
  title: "Studio Lead",
  hueKey: "neutral",
  mark: "flag",
  blurb: "听懂你要什么，再把活分给合适的人。",
  deterministic: false,
};

function withKey(key: string, entry: PersonaEntry): Persona {
  return { key, ...entry };
}

export function personaForRole(roleId: string): Persona | undefined {
  if (roleId === "main" || roleId === "linguist-agent") return withKey("main", MAIN_PERSONA);
  const known = TEAM_PERSONAS[roleId];
  return known ? withKey(roleId, known) : undefined;
}

/**
 * Maps a canonical TaskAgentIdentity to its persona. `null`/`undefined`
 * identity resolves to the Main persona (used by the live streaming reply,
 * whose durable thread is always the Main Agent). Unknown roleIds keep the
 * original displayName/roleLabel with a neutral avatar.
 */
export function resolvePersona(identity?: TaskAgentIdentity | null): Persona {
  if (!identity) return withKey("main", MAIN_PERSONA);
  const known = personaForRole(identity.kind === "main" ? "main" : identity.roleId);
  if (known) return known;
  if (identity.kind === "deterministic" || identity.disclosureLabel === "System") {
    return {
      key: `deterministic:${identity.roleId}`,
      personaName: identity.displayName,
      title: identity.roleLabel || "Deterministic System",
      hueKey: "slate",
      mark: "person",
      blurb: "Deterministic system; no model call.",
      deterministic: true,
      icon: "wrench",
    };
  }
  return {
    key: `unknown:${identity.roleId}`,
    personaName: identity.displayName,
    title: identity.roleLabel,
    hueKey: "neutral",
    mark: "person",
    blurb: "",
    deterministic: false,
  };
}

/** Thread/run status → avatar status dot. */
export function personaStatusForRunStatus(status: TaskRunStatus): PersonaStatus {
  if (status === "active" || status === "pending") return "running";
  if (status === "awaiting_input" || status === "waiting") return "waiting";
  if (status === "complete") return "done";
  if (status === "failed" || status === "stale") return "failed";
  return "stopped";
}

export function personaStatusForThread(thread: TaskAgentThread): PersonaStatus {
  return personaStatusForRunStatus(thread.status);
}
