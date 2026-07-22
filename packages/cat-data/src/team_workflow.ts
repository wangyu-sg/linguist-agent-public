import { createHash } from "node:crypto";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "./workspace.js";

export const TEAM_ROLE_IDS = [
  "producer",
  "loc_engineer_gate",
  "lead_linguist_setup",
  "translator",
  "editor",
  "proofreader",
  "culturalization_reviewer",
  "pre_lqa_reviewer",
  "delivery_manager",
  "lead_linguist_final",
] as const;

export type TeamRoleId = (typeof TEAM_ROLE_IDS)[number];

export const TEAM_ROLE_DISPLAY_NAMES: Record<TeamRoleId, string> = {
  producer: "Producer",
  loc_engineer_gate: "Loc Engineer Gate",
  lead_linguist_setup: "Lead Linguist Setup",
  translator: "Translator",
  editor: "Editor",
  proofreader: "Proofreader",
  culturalization_reviewer: "Culturalization Reviewer",
  pre_lqa_reviewer: "Pre-LQA Reviewer",
  delivery_manager: "Delivery Manager",
  lead_linguist_final: "Lead Linguist Final",
};

export function teamRoleDisplayName(roleId: TeamRoleId): string {
  return TEAM_ROLE_DISPLAY_NAMES[roleId];
}

export type TeamRoleStatus = "queued" | "running" | "waiting" | "stopping" | "stopped" | "failed" | "completed" | "skipped";

export const DETERMINISTIC_TEAM_ROLE_IDS = new Set<TeamRoleId>(["loc_engineer_gate", "delivery_manager"]);

export interface TeamRoleProfile {
  roleId: TeamRoleId;
  enabled: boolean;
  provider?: string;
  modelId?: string;
  thinking?: "minimal" | "low" | "medium" | "high" | "xhigh";
}

export interface TeamRoleSubagentSpawnRequest {
  protocol: "pi-subagents-rpc-v1";
  method: "spawn";
  params: {
    agent: string;
    task: string;
      context: "fresh" | "fork";
      agentScope: "project";
      async: true;
    clarify: false;
    artifacts: true;
    acceptance: {
      level: "none";
      reason: string;
    };
    output?: string;
    outputMode: "inline" | "file-only";
    sessionDir?: string;
    model?: string;
    turnBudget?: { maxTurns: number; graceTurns?: number };
    toolBudget?: { soft?: number; hard: number; block?: string[] | "*" };
  };
}

export interface TeamRoleSettings {
  profiles: TeamRoleProfile[];
  source?: {
    scope: "global" | "project";
    globalConfigured?: boolean;
    projectConfigured?: boolean;
  };
  profileSources?: Partial<Record<TeamRoleId, "global" | "project">>;
}

/**
 * The preflight contract is deliberately separate from the persisted role
 * passes.  A plan is a user-visible promise about what will run; a pass is
 * what actually happened.  Keeping the two distinct lets the native client
 * reject stale starts without guessing from a partially populated artifact
 * ledger.
 */
export interface TeamRoleActivation {
  roleId: TeamRoleId;
  enabled: boolean;
  reason: string;
  dependencies: TeamRoleId[];
  modelRoute?: string;
  estimatedCalls: number;
}

export interface TeamRunPlan {
  projectId: string;
  workflowId: string;
  batchId?: string;
  createdAt: string;
  forceAllRoles: boolean;
  readiness: {
    status: "ready" | "blocked";
    blockers: string[];
    notes: string[];
  };
  roles: TeamRoleActivation[];
  selectedRoleIds: TeamRoleId[];
  modelRoutes: Record<string, string>;
  estimatedCalls: number;
  planHash: string;
}

export interface TeamRunPlanInput {
  projectId: string;
  workflowId: string;
  batchId?: string;
  forceAllRoles?: boolean;
  inputChanged?: boolean;
  hasBrief?: boolean;
  hasStrategy?: boolean;
  pendingSegments?: number;
  hasCandidates?: boolean;
  hasFindings?: boolean;
  hasQueries?: boolean;
  hasAttachments?: boolean;
  blockers?: string[];
  notes?: string[];
  profiles?: TeamRoleProfile[];
}

function teamPlanHash(value: Omit<TeamRunPlan, "createdAt" | "planHash">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function roleModelRoute(profile: TeamRoleProfile | undefined): string | undefined {
  return profile?.provider && profile.modelId ? `${profile.provider}/${profile.modelId}` : profile?.modelId;
}

/**
 * Select the smallest useful role graph for the current evidence.  Every role
 * remains available and `forceAllRoles` is an explicit escape hatch, but a
 * normal run does not spend ten model calls when deterministic gates or the
 * current artifacts make a role irrelevant.
 */
export function buildTeamRunPlan(input: TeamRunPlanInput): TeamRunPlan {
  const profiles = new Map((input.profiles ?? defaultTeamRoleProfiles()).map((profile) => [profile.roleId, profile]));
  const forceAllRoles = input.forceAllRoles === true;
  const pending = input.pendingSegments ?? 0;
  const candidates = input.hasCandidates === true;
  const findings = input.hasFindings === true;
  const roleReasons: Record<TeamRoleId, { enabled: boolean; reason: string; dependencies: TeamRoleId[] }> = {
    producer: { enabled: forceAllRoles, reason: forceAllRoles ? "Producer was explicitly enabled with the full role graph." : "The typed Task and deterministic Intake already carry scope/readiness; add Producer only for an explicit production-planning need.", dependencies: [] },
    loc_engineer_gate: { enabled: true, reason: "Deterministic localization-engineering gate runs on every Team preflight.", dependencies: [] },
    lead_linguist_setup: { enabled: forceAllRoles, reason: forceAllRoles ? "Lead setup was explicitly enabled with the full role graph." : input.hasStrategy ? "The confirmed project strategy is already context, not a reason to rerun setup." : "The current Task can carry direct strategy; run Lead Setup when a reusable strategy artifact is explicitly useful.", dependencies: ["producer", "loc_engineer_gate"] },
    translator: { enabled: forceAllRoles || pending > 0, reason: pending > 0 ? `${pending} segment(s) need translation or retranslation.` : "No pending segments.", dependencies: ["loc_engineer_gate", "lead_linguist_setup"] },
    editor: { enabled: forceAllRoles || candidates, reason: candidates ? "Existing candidate targets require an explicit editorial review task." : "Do not add an automatic rubber-stamp pass to new Translator output; run Editor for an existing-candidate review or force-all.", dependencies: ["translator"] },
    proofreader: { enabled: forceAllRoles || findings, reason: findings ? "Existing findings justify a dedicated proof pass." : "Add Proofreader for an explicit final-copy pass or existing findings.", dependencies: ["editor"] },
    culturalization_reviewer: { enabled: forceAllRoles, reason: forceAllRoles ? "Culturalization review was explicitly enabled with the full role graph." : "Run only from an explicit cultural/market risk, not a generic expressive-text guess.", dependencies: ["translator"] },
    pre_lqa_reviewer: { enabled: forceAllRoles || input.hasAttachments === true, reason: input.hasAttachments ? "Attachments or UI-length evidence needs pre-LQA review." : "No screenshot/attachment/UI-length signal.", dependencies: ["translator"] },
    delivery_manager: { enabled: true, reason: "Deterministic Delivery QA is authoritative before delivery.", dependencies: ["proofreader", "pre_lqa_reviewer"] },
    lead_linguist_final: { enabled: forceAllRoles || findings || input.hasQueries === true, reason: findings || input.hasQueries ? "Existing findings or blocking queries require a specialist final decision." : "Ordinary proposals remain directly reviewable; add Lead Final for material conflicts/findings or force-all review.", dependencies: ["editor", "proofreader", "delivery_manager"] },
  };
  const roles = TEAM_ROLE_IDS.map((roleId) => {
    const activation = roleReasons[roleId];
    const profile = profiles.get(roleId);
    const enabled = activation.enabled && profile?.enabled !== false;
    const deterministic = DETERMINISTIC_TEAM_ROLE_IDS.has(roleId);
    return {
      roleId,
      enabled,
      reason: profile?.enabled === false ? "Disabled in Team Role Models settings." : activation.reason,
      dependencies: activation.dependencies.filter((dependency) => roleReasons[dependency].enabled),
      modelRoute: deterministic ? undefined : roleModelRoute(profile),
      estimatedCalls: enabled && !deterministic ? 1 : 0,
    } satisfies TeamRoleActivation;
  });
  const selectedRoleIds = roles.filter((role) => role.enabled).map((role) => role.roleId);
  const modelRoutes = Object.fromEntries(roles.filter((role) => role.enabled && role.modelRoute).map((role) => [role.roleId, role.modelRoute!]));
  const estimatedCalls = roles.reduce((total, role) => total + role.estimatedCalls, 0);
  const blockers = [...(input.blockers ?? [])].map((value) => value.trim()).filter(Boolean);
  if (!selectedRoleIds.length) blockers.push("No Team roles are enabled for this input.");
  const notes = [
    forceAllRoles
      ? `All ${selectedRoleIds.length} currently enabled roles were explicitly requested.`
      : "Adaptive role graph selected from current artifacts and input signals.",
    `Estimated model calls: ${estimatedCalls}; deterministic system roles: ${selectedRoleIds.filter((roleId) => DETERMINISTIC_TEAM_ROLE_IDS.has(roleId)).length}.`,
    ...(input.notes ?? []).map((value) => value.trim()).filter(Boolean),
  ];
  const base = {
    projectId: input.projectId,
    workflowId: input.workflowId,
    batchId: input.batchId,
    forceAllRoles,
    readiness: { status: blockers.length ? "blocked" as const : "ready" as const, blockers, notes },
    roles,
    selectedRoleIds,
    modelRoutes,
    estimatedCalls,
  };
  return {
    ...base,
    createdAt: new Date().toISOString(),
    planHash: teamPlanHash(base),
  };
}

export interface TeamRolePass {
  workflowId: string;
  roleId: TeamRoleId;
  status: TeamRoleStatus;
  sessionId: string;
  modelProvider?: string;
  modelId?: string;
  thinking?: TeamRoleProfile["thinking"];
  startedAt?: string;
  completedAt?: string;
  inputArtifactRefs: string[];
  outputArtifactRefs: string[];
  subagentRunId?: string;
  subagentAsyncDir?: string;
  subagentSpawnRequest?: TeamRoleSubagentSpawnRequest;
  usage?: {
    inputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
  contextManifestRef?: string;
  contextManifest?: TeamContextManifest;
  summary: string;
  transcriptRef: string;
}

export interface TeamContextManifest {
  includedArtifactIds: string[];
  omittedArtifactIds: string[];
  /** Optional on historical manifests written before estimate scoping. */
  estimateScope?: "compiled_business_prompt";
  tokenEstimate: number;
  hardConstraintsPreserved: boolean;
  truncationReason?: string;
  /** PromptCompiler replay metadata; optional for manifests written by v1 runs. */
  promptHash?: string;
  constitutionHash?: string;
  recipeHash?: string;
  contextHash?: string;
  policyHash?: string;
  tokenBudget?: number;
  overBudget?: boolean;
  referenceIncluded?: boolean;
  coverage?: {
    batchSegments: number;
    taskSegments: number;
    inlineSegments: number;
    requiresPaging: boolean;
  };
}

export interface TeamRoleFinding {
  id: string;
  workflowId?: string;
  roleId: TeamRoleId;
  segmentId?: string;
  severity: "blocker" | "major" | "minor" | "advisory";
  type: "accuracy" | "terminology" | "style" | "genre" | "omission" | "format" | "constraint" | "query";
  message: string;
  proposedTarget?: string;
  evidenceRefs: string[];
}

export interface TeamDecision {
  id: string;
  workflowId: string;
  segmentId?: string;
  decision: "accept" | "reject" | "query" | "accepted_risk";
  reason: string;
  findingIds: string[];
  evidenceRefs?: string[];
  decidedBy: "lead_linguist" | "user";
}

export interface TeamCandidateTarget {
  id: string;
  workflowId: string;
  segmentId: string;
  target: string;
  roleId: TeamRoleId;
  evidenceRefs: string[];
  function?: string;
  notes?: string;
}

export type TeamRoleOutputSignal =
  | "summary"
  | "brief"
  | "engineeringGate"
  | "strategy"
  | "preLqaRisks"
  | "findings"
  | "queries"
  | "candidateTargets"
  | "decisions"
  | "deliveryQa"
  | "noIssues";

export interface TeamRoleOutputContract {
  roleId: TeamRoleId;
  requiredAnyOf: TeamRoleOutputSignal[];
  outputSignals: TeamRoleOutputSignal[];
  rejectionReason: string;
}

export interface TeamRoleOutputPresence {
  objectKeys: string[];
  arrayKeys: string[];
  preLqaRiskCount?: number;
  hasSummary: boolean;
  findingCount: number;
  queryCount?: number;
  candidateCount: number;
  decisionCount: number;
  hasDeliveryQa: boolean;
  hasReviewedDeliveryQa: boolean;
  hasNoIssues: boolean;
}

const TEAM_ROLE_OUTPUT_CONTRACTS: Record<TeamRoleId, TeamRoleOutputContract> = {
  producer: {
    roleId: "producer",
    requiredAnyOf: ["brief", "findings", "queries"],
    outputSignals: ["summary", "brief", "findings", "queries"],
    rejectionReason: "producer output requires brief, findings, or queries",
  },
  loc_engineer_gate: {
    roleId: "loc_engineer_gate",
    requiredAnyOf: ["engineeringGate", "findings", "queries"],
    outputSignals: ["summary", "engineeringGate", "findings", "queries"],
    rejectionReason: "loc_engineer_gate output requires engineeringGate, findings, or queries",
  },
  lead_linguist_setup: {
    roleId: "lead_linguist_setup",
    requiredAnyOf: ["strategy", "findings", "queries"],
    outputSignals: ["summary", "strategy", "findings", "queries"],
    rejectionReason: "lead_linguist_setup output requires strategy, findings, or queries",
  },
  translator: {
    roleId: "translator",
    requiredAnyOf: ["candidateTargets", "queries"],
    outputSignals: ["summary", "candidateTargets", "findings", "queries"],
    rejectionReason: "translator output requires candidate translations or queries",
  },
  editor: {
    roleId: "editor",
    requiredAnyOf: ["findings", "queries", "candidateTargets", "noIssues"],
    outputSignals: ["summary", "findings", "queries", "candidateTargets", "noIssues"],
    rejectionReason: "editor output requires findings, queries, candidate edits, or explicit noIssues",
  },
  proofreader: {
    roleId: "proofreader",
    requiredAnyOf: ["findings", "queries", "candidateTargets", "noIssues"],
    outputSignals: ["summary", "findings", "queries", "candidateTargets", "noIssues"],
    rejectionReason: "proofreader output requires findings, queries, candidate edits, or explicit noIssues",
  },
  culturalization_reviewer: {
    roleId: "culturalization_reviewer",
    requiredAnyOf: ["findings", "queries", "candidateTargets", "noIssues"],
    outputSignals: ["summary", "findings", "queries", "candidateTargets", "noIssues"],
    rejectionReason: "culturalization_reviewer output requires findings, queries, candidate edits, or explicit noIssues",
  },
  pre_lqa_reviewer: {
    roleId: "pre_lqa_reviewer",
    requiredAnyOf: ["preLqaRisks", "findings", "queries", "noIssues"],
    outputSignals: ["summary", "preLqaRisks", "findings", "queries", "noIssues"],
    rejectionReason: "pre_lqa_reviewer output requires preLqaRisks, findings, queries, or explicit noIssues",
  },
  delivery_manager: {
    roleId: "delivery_manager",
    requiredAnyOf: ["findings", "queries", "noIssues"],
    outputSignals: ["summary", "findings", "queries", "noIssues"],
    rejectionReason: "delivery_manager output requires explanatory findings, queries, or explicit noIssues",
  },
  lead_linguist_final: {
    roleId: "lead_linguist_final",
    requiredAnyOf: ["decisions", "candidateTargets", "queries"],
    outputSignals: ["summary", "decisions", "candidateTargets", "findings", "queries"],
    rejectionReason: "lead_linguist_final output requires decisions, final candidates, or queries",
  },
};

export function isTeamRoleId(value: string): value is TeamRoleId {
  return (TEAM_ROLE_IDS as readonly string[]).includes(value);
}

export function teamRoleOutputContract(roleId: TeamRoleId): TeamRoleOutputContract {
  return TEAM_ROLE_OUTPUT_CONTRACTS[roleId];
}

function teamRoleOutputSignalPresent(signal: TeamRoleOutputSignal, presence: TeamRoleOutputPresence): boolean {
  switch (signal) {
    case "summary":
      return presence.hasSummary;
    case "brief":
    case "engineeringGate":
    case "strategy":
      return presence.objectKeys.includes(signal);
    case "preLqaRisks":
      return (presence.preLqaRiskCount ?? (presence.arrayKeys.includes("preLqaRisks") ? 1 : 0)) > 0;
    case "findings":
      return presence.findingCount > 0;
    case "queries":
      return (presence.queryCount ?? 0) > 0;
    case "candidateTargets":
      return presence.candidateCount > 0;
    case "decisions":
      return presence.decisionCount > 0;
    case "deliveryQa":
      return presence.hasDeliveryQa;
    case "noIssues":
      return presence.hasNoIssues;
  }
}

export function validateTeamRoleOutputPresence(roleId: TeamRoleId, presence: TeamRoleOutputPresence): { ok: true } | { ok: false; reason: string } {
  const contract = teamRoleOutputContract(roleId);
  return contract.requiredAnyOf.some((signal) => teamRoleOutputSignalPresent(signal, presence))
    ? { ok: true }
    : { ok: false, reason: contract.rejectionReason };
}

export function defaultTeamRoleProfiles(): TeamRoleProfile[] {
  return TEAM_ROLE_IDS.map((roleId) => ({
    roleId,
    enabled: true,
  }));
}

function teamRoleSettingsPath(workspaceRoot: string): string {
  return join(workspaceRoot, "data", "runtime", "team_role_settings.json");
}

export async function readTeamRoleSettings(workspaceRoot: string): Promise<TeamRoleSettings> {
  const stored = await readJsonFile<Partial<TeamRoleSettings>>(teamRoleSettingsPath(workspaceRoot), {});
  const byRole = new Map((stored.profiles ?? []).map((profile) => [profile.roleId, profile]));
  return {
    profiles: defaultTeamRoleProfiles().map((profile) => ({ ...profile, ...(byRole.get(profile.roleId) ?? {}) })),
  };
}

export async function writeTeamRoleSettings(workspaceRoot: string, settings: TeamRoleSettings): Promise<TeamRoleSettings> {
  const normalized: TeamRoleSettings = {
    profiles: defaultTeamRoleProfiles().map((profile) => ({ ...profile, ...(settings.profiles.find((row) => row.roleId === profile.roleId) ?? {}) })),
  };
  await writeJsonFile(teamRoleSettingsPath(workspaceRoot), normalized);
  return readTeamRoleSettings(workspaceRoot);
}

export function teamRoleSessionId(workflowId: string, roleId: TeamRoleId): string {
  const safe = `${workflowId}-${roleId}`.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
  return `la-team-${safe || "workflow"}`;
}
