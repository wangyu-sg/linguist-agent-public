import { createHash } from "node:crypto";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";
import { compileTagRule, deriveDisabledBuiltinIds, deriveProjectTagRuleContext, resolveOnboardingStatus, tagRuleConsumesVariableBody, type ProjectTagRuleContext, type TagRule, type TagRuleClass, type TagRuleDocument } from "./tag_rules_core.js";

// The tag-rule model + compiler + context derivation now live in the pure,
// filesystem-free core so the browser bundle can import them. Re-export so the
// many `./tag_rules.js` importers keep their existing import paths.
export * from "./tag_rules_core.js";

function tagRulesPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "tag_rules.json");
}

function emptyDocument(projectId: string, now = new Date().toISOString()): TagRuleDocument {
  return {
    schemaVersion: 1,
    projectId,
    generatedAt: now,
    updatedAt: now,
    rulesDigest: "sha256:empty",
    rules: [],
    disabledBuiltinIds: [],
    onboarding: { status: "pending" },
    trace: [],
  };
}

function digestRules(input: Pick<TagRuleDocument, "rules" | "disabledBuiltinIds">): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ rules: input.rules, disabledBuiltinIds: input.disabledBuiltinIds }))
    .digest("hex")}`;
}

function normalizeDocument(projectId: string, value: TagRuleDocument): TagRuleDocument {
  if (value.schemaVersion !== 1) throw new Error(`Unsupported tag_rules.json schemaVersion ${String(value.schemaVersion)}.`);
  const now = new Date().toISOString();
  const trace = Array.isArray(value.trace) ? value.trace.filter((entry): entry is string => typeof entry === "string") : [];
  const rules = (Array.isArray(value.rules) ? value.rules : []).map((rule) => {
    if (rule.status !== "active" || !tagRuleConsumesVariableBody(rule)) return rule;
    const note = `Rule ${rule.id} disabled on read: pattern appears to include translatable body text`;
    if (!trace.includes(note)) trace.push(note);
    return { ...rule, status: "disabled" as const, lastSeen: rule.lastSeen ?? now };
  });
  const storedStatus = value.onboarding?.status;
  const onboardingStatus = resolveOnboardingStatus(storedStatus, rules);
  const doc: TagRuleDocument = {
    schemaVersion: 1,
    projectId: value.projectId || projectId,
    generatedAt: value.generatedAt || now,
    updatedAt: value.updatedAt || now,
    rulesDigest: value.rulesDigest || "sha256:empty",
    rules,
    // Always DERIVE from the active rule set so a disabled/removed superseding rule
    // restores its builtin safety net — and any stale on-disk value self-heals on read.
    disabledBuiltinIds: deriveDisabledBuiltinIds(rules.filter((rule) => rule.status === "active")),
    // Onboarding status is likewise derived/self-healed so it can never overstate
    // coverage; updatedAt only moves when the resolved status actually changes.
    onboarding: {
      status: onboardingStatus,
      updatedAt: onboardingStatus === storedStatus ? value.onboarding?.updatedAt ?? now : now,
    },
    trace,
  };
  return { ...doc, rulesDigest: digestRules(doc) };
}

async function writeProjectTagRules(workspaceRoot: string, projectId: string, doc: TagRuleDocument): Promise<TagRuleDocument> {
  const next = normalizeDocument(projectId, {
    ...doc,
    updatedAt: new Date().toISOString(),
  });
  await writeJsonFile(tagRulesPath(workspaceRoot, projectId), next);
  return next;
}

export async function readProjectTagRules(workspaceRoot: string, projectId: string): Promise<TagRuleDocument> {
  const doc = await readJsonFile<TagRuleDocument>(tagRulesPath(workspaceRoot, projectId), emptyDocument(projectId));
  return normalizeDocument(projectId, doc);
}

export async function readProjectTagRuleContext(workspaceRoot: string, projectId: string): Promise<ProjectTagRuleContext> {
  return deriveProjectTagRuleContext(await readProjectTagRules(workspaceRoot, projectId));
}

export async function writeProjectTagRuleCandidates(
  workspaceRoot: string,
  projectId: string,
  candidates: TagRule[],
): Promise<TagRuleDocument> {
  const current = await readProjectTagRules(workspaceRoot, projectId);
  const now = new Date().toISOString();
  const byId = new Map(current.rules.map((rule) => [rule.id, rule]));
  for (const candidate of candidates) {
    // `...candidate` already carries origin ("discovered" | "llm" | …); never coerce it.
    byId.set(candidate.id, {
      ...candidate,
      status: "candidate",
      firstSeen: candidate.firstSeen ?? now,
      lastSeen: now,
    });
  }
  return writeProjectTagRules(workspaceRoot, projectId, {
    ...current,
    rules: Array.from(byId.values()),
  });
}

export async function createManualProjectTagRuleCandidate(
  workspaceRoot: string,
  projectId: string,
  input: {
    id?: string;
    class?: TagRuleClass;
    pattern: string;
    flags?: string;
    note?: string;
  },
): Promise<TagRuleDocument> {
  const pattern = input.pattern.trim();
  if (!pattern) throw new Error("Tag rule pattern is required.");
  const className = input.class ?? "formatting";
  const ruleId = (input.id?.trim() || `manual-${createHash("sha1").update(pattern).digest("hex").slice(0, 10)}`)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!ruleId) throw new Error("Tag rule id is required.");
  if (tagRuleConsumesVariableBody({ class: className, pattern })) {
    throw new Error("Tag rule pattern appears to include translatable body text.");
  }
  const compiled = compileTagRule({ pattern, flags: input.flags ?? "g" });
  if (!compiled.regex) throw new Error(`regex rejected: ${compiled.error ?? "compile failed"}`);
  return writeProjectTagRuleCandidates(workspaceRoot, projectId, [{
    id: ruleId,
    class: className,
    pattern,
    flags: input.flags ?? "g",
    origin: "manual",
    status: "candidate",
    confidence: 1,
    occurrences: 0,
    segmentCoverage: 0,
    examples: [],
    note: input.note?.trim() || "Manually added project tag rule.",
  }]);
}

export async function confirmProjectTagRule(workspaceRoot: string, projectId: string, ruleId: string): Promise<TagRuleDocument> {
  const current = await readProjectTagRules(workspaceRoot, projectId);
  let found = false;
  const rules = current.rules.map((rule) => {
    if (rule.id !== ruleId) return rule;
    found = true;
    if (rule.status !== "candidate" && rule.status !== "active") {
      throw new Error(`Tag rule ${ruleId} is ${rule.status}; only candidate rules can be confirmed.`);
    }
    return { ...rule, status: "active" as const, lastSeen: new Date().toISOString() };
  });
  if (!found) throw new Error(`Tag rule ${ruleId} not found.`);
  // disabledBuiltinIds is derived from the active rule set in normalizeDocument, so
  // activating this rule supersedes its builtin automatically (and disabling restores it).
  return writeProjectTagRules(workspaceRoot, projectId, { ...current, rules });
}

export async function disableProjectTagRule(workspaceRoot: string, projectId: string, ruleId: string): Promise<TagRuleDocument> {
  const current = await readProjectTagRules(workspaceRoot, projectId);
  let found = false;
  const rules = current.rules.map((rule) => {
    if (rule.id !== ruleId) return rule;
    found = true;
    return { ...rule, status: "disabled" as const, lastSeen: new Date().toISOString() };
  });
  if (!found) throw new Error(`Tag rule ${ruleId} not found.`);
  return writeProjectTagRules(workspaceRoot, projectId, { ...current, rules });
}

/**
 * The second honest onboarding exit: the user reviewed discovery and declares this
 * project carries no extra tag rules beyond the builtin safety set. This only sets a
 * marker — it adds no rule and protects nothing. If active rules somehow exist, the
 * derived status self-heals to "confirmed" (you cannot truthfully declare "none"
 * while project rules are live), so the marker can never overstate or understate.
 */
export async function declareNoProjectTagRules(workspaceRoot: string, projectId: string): Promise<TagRuleDocument> {
  const current = await readProjectTagRules(workspaceRoot, projectId);
  return writeProjectTagRules(workspaceRoot, projectId, {
    ...current,
    onboarding: { status: "declared_none", updatedAt: new Date().toISOString() },
  });
}
