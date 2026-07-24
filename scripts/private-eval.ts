import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPrivateEvalRun,
  createPrivateEvalSet,
  DEFAULT_PRIVATE_EVAL_THINKING_LEVEL,
  defaultSubagentAsyncRoot,
  evaluatePrivateEvalMechanicalQa,
  executePrivateEvalRun,
  ModelContextRegistry,
  renderPrivateEvalComparison,
  type PrivateEvalSegmentRunner,
  type ProjectTagRuleContext,
  type PromptRequestBudget,
  type TeamRoleId,
} from "@linguist-agent/cat-data";
import {
  runPrivateEvalCanonicalSingle,
  type PrivateEvalCanonicalSingleGenerationInput,
  type PrivateEvalCanonicalSingleGenerationResult,
} from "../packages/cat-server/src/private_eval_canonical_single.ts";
import {
  runPrivateEvalCanonicalTeam,
} from "../packages/cat-server/src/private_eval_canonical_team.ts";
import type { WorkflowRouteDeps } from "../packages/cat-server/src/routes/workflow_routes.ts";

/**
 * LA-130: Private Eval executes only through this explicit CI/developer harness
 * on an explicit synthetic root. The production route stays read-only (Stable
 * 403); this harness never opens the production data tree.
 */

export type PrivateEvalHarnessCommand = {
  command: "run";
  mode: "single" | "team";
  root: string;
  evalSetId: string;
  label: string;
  sourceRoot: string;
  adapter: "synthetic";
  sourceLocale: string;
  targetLocale: string;
  sampleSize?: number;
};

export type PrivateEvalHarnessResult = {
  command: "run";
  evalSetId: string;
  runId: string;
  mode: "single_agent" | "team_workflow";
  status: string;
  outputCount: number;
  usage?: unknown;
  reportPath: string;
};

export type PrivateEvalHarnessDeps = {
  createSet?: typeof createPrivateEvalSet;
  createRun?: typeof createPrivateEvalRun;
  execute?: typeof executePrivateEvalRun;
  compare?: typeof renderPrivateEvalComparison;
  single?: typeof runPrivateEvalCanonicalSingle;
  team?: typeof runPrivateEvalCanonicalTeam;
  singleGenerate?: (input: PrivateEvalCanonicalSingleGenerationInput) => Promise<PrivateEvalCanonicalSingleGenerationResult>;
  teamWorkflowDeps?: (root: string) => WorkflowRouteDeps;
};

const USAGE = "Usage: eval:private run --mode single|team --root <synthetic-root> --set-id <id> --label <label> --source-root <dir> --adapter synthetic --source-locale <locale> --target-locale <locale> [--sample-size <n>]";

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionsFor(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || options.has(name)) throw new Error("Options must be unique --name value pairs.");
    options.set(name, value);
  }
  return options;
}

function only(options: Map<string, string>, names: string[]): void {
  for (const name of options.keys()) if (!names.includes(name)) throw new Error(`Unsupported option: ${name}.`);
}

export function parsePrivateEvalHarnessArgs(args: string[]): PrivateEvalHarnessCommand {
  const [command, ...rest] = args;
  if (command !== "run") throw new Error(USAGE);
  const options = optionsFor(rest);
  only(options, ["--mode", "--root", "--set-id", "--label", "--source-root", "--adapter", "--source-locale", "--target-locale", "--sample-size"]);
  const mode = required(options, "--mode");
  if (mode !== "single" && mode !== "team") throw new Error("--mode must be single or team.");
  const root = required(options, "--root");
  const evalSetId = required(options, "--set-id");
  const label = required(options, "--label");
  const sourceRoot = required(options, "--source-root");
  const adapter = required(options, "--adapter");
  if (adapter !== "synthetic") throw new Error("--adapter must be synthetic; no production model adapter is registered in the harness.");
  const sourceLocale = required(options, "--source-locale");
  const targetLocale = required(options, "--target-locale");
  const sampleSizeText = options.get("--sample-size");
  const sampleSize = sampleSizeText === undefined ? undefined : Number.parseInt(sampleSizeText, 10);
  if (sampleSize !== undefined && (!Number.isInteger(sampleSize) || sampleSize <= 0)) throw new Error("--sample-size must be a positive integer.");
  return {
    command,
    mode,
    root,
    evalSetId,
    label,
    sourceRoot,
    adapter,
    sourceLocale,
    targetLocale,
    ...(sampleSize === undefined ? {} : { sampleSize }),
  };
}

/** The harness writes only to an explicit synthetic root; the production data tree is refused. */
export function assertSyntheticEvalRoot(root: string): string {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const productionData = resolve(repoRoot, "data");
  const resolved = resolve(root);
  if (resolved === productionData || resolved.startsWith(`${productionData}${sep}`)) {
    throw new Error("Private Eval harness root must be an explicit synthetic root outside the production data tree.");
  }
  return resolved;
}

function evalTermTargets(refs: readonly string[]): string[] {
  return refs.flatMap((ref) => {
    const target = ref.match(/=>\s*[^=]+=(.*)$/)?.[1]?.trim();
    return target ? [target] : [];
  });
}

const SYNTHETIC_TAG_RULE_CONTEXT: ProjectTagRuleContext = {
  mode: "legacy_builtin",
  rulesDigest: "private-eval-harness-synthetic",
  activeProjectRules: [],
  disabledBuiltinIds: [],
  candidateRuleCount: 0,
  disabledRuleCount: 0,
  trace: [],
};

/** Explicit synthetic model metadata so the prompt compiler can budget an otherwise-unknown model. */
function syntheticPromptRequestBudget(provider = "synthetic", modelId = "synthetic-eval"): PromptRequestBudget {
  return {
    registry: new ModelContextRegistry([{ provider, modelId, contextWindow: 200_000, outputReserveTokens: 64_000 }]),
    provider,
    modelId,
    toolSchemaTokens: 0,
    historyTokens: 0,
    providerFramingTokens: 8,
    safetyMarginTokens: 0,
    compactionReserveTokens: 0,
  };
}

/** Deterministic no-model generation: answers the canonical batch envelope with clearly-marked synthetic candidates. */
async function syntheticSingleGenerate(input: PrivateEvalCanonicalSingleGenerationInput): Promise<PrivateEvalCanonicalSingleGenerationResult> {
  const candidates = [...input.prompt.matchAll(/"segmentId":"(eval-\d{4})","source":"((?:[^"\\]|\\.)*?)"/g)]
    .map((match) => {
      let source = match[1]!;
      try {
        source = JSON.parse(`"${match[2]!}"`) as string;
      } catch {
        // Best-effort label only; the alias keeps the envelope truthful.
      }
      return { segmentId: match[1]!, target: `[synthetic] ${source}`, notes: "Synthetic harness candidate." };
    });
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.segmentId)) return false;
    seen.add(candidate.segmentId);
    return true;
  });
  return {
    text: JSON.stringify({ candidates: unique }),
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, modelCalls: 1 },
  };
}

function syntheticRoleOutput(roleId: TeamRoleId, aliases: string[]): Record<string, unknown> {
  if (roleId === "producer") return { roleId, summary: "Synthetic brief.", brief: { projectGoal: "Synthetic eval", scope: aliases, knownAssets: [], missingInputs: [], risks: [], handoffNotes: [] } };
  if (roleId === "lead_linguist_setup") return { roleId, summary: "Synthetic strategy.", strategy: { authorityOrder: [], voiceRules: [], genreRules: [], uiRules: [], termRules: [], queryRules: [], mustNotDo: [] } };
  if (roleId === "translator") return {
    roleId,
    summary: "Synthetic candidates.",
    candidates: aliases.map((segmentId) => ({ segmentId, target: `[synthetic] ${segmentId}`, evidenceRefs: [], function: "ui" })),
  };
  if (roleId === "lead_linguist_final") return {
    roleId,
    summary: "Synthetic final candidates.",
    candidateTargets: aliases.map((segmentId) => ({ segmentId, target: `[synthetic] ${segmentId}`, notes: "Synthetic harness candidate.", evidenceRefs: [] })),
  };
  return { roleId, summary: "No material issue.", noIssues: true, findings: [], queries: [] };
}

/** Deterministic pi-subagents-style child runner so the canonical Team adapter executes end to end without a model. */
function syntheticTeamWorkflowDeps(_root: string): WorkflowRouteDeps {
  return {
    repoRoot: _root,
    json: () => undefined,
    readBody: async () => ({}),
    requireString: (value, label) => {
      if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
      return value;
    },
    optionalString: (value) => typeof value === "string" && value ? value : undefined,
    optionalStringArray: (value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined,
    optionalBoolean: (value) => value === undefined ? undefined : Boolean(value),
    resolveModelPromptTokenBudget: async (provider, modelId) => syntheticPromptRequestBudget(provider ?? "synthetic", modelId ?? "synthetic-eval"),
    spawnSubagentRun: async (_projectId, _workflowId, roleId, request) => {
      const aliases = [...new Set([...request.params.task.matchAll(/\[(eval-\d{4})\]/g)].map((match) => match[1]!))];
      const runId = `private-eval-harness-${roleId}-${randomUUID()}`;
      const asyncDir = join(defaultSubagentAsyncRoot(), runId);
      await mkdir(asyncDir, { recursive: true });
      const outputFile = join(asyncDir, "output.log");
      await writeFile(outputFile, JSON.stringify(syntheticRoleOutput(roleId, aliases)), "utf8");
      await writeFile(join(asyncDir, "status.json"), JSON.stringify({
        lifecycleArtifactVersion: 1,
        runId,
        mode: "single",
        state: "complete",
        agent: `la-team-${roleId.replaceAll("_", "-")}`,
        startedAt: Date.now(),
        endedAt: Date.now() + 1,
        outputFile,
        totalTokens: { input: 0, output: 0, total: 0 },
        totalCost: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        steps: [{ agent: `la-team-${roleId.replaceAll("_", "-")}`, model: "synthetic/synthetic-eval" }],
      }), "utf8");
      return { details: { asyncDir } };
    },
  } as unknown as WorkflowRouteDeps;
}

export async function runPrivateEvalHarness(
  args: string[],
  dependencies: PrivateEvalHarnessDeps = {},
): Promise<PrivateEvalHarnessResult> {
  const command = parsePrivateEvalHarnessArgs(args);
  const root = assertSyntheticEvalRoot(command.root);
  const createSet = dependencies.createSet ?? createPrivateEvalSet;
  const createRun = dependencies.createRun ?? createPrivateEvalRun;
  const execute = dependencies.execute ?? executePrivateEvalRun;
  const compare = dependencies.compare ?? renderPrivateEvalComparison;
  const single = dependencies.single ?? runPrivateEvalCanonicalSingle;
  const team = dependencies.team ?? runPrivateEvalCanonicalTeam;
  const singleGenerate = dependencies.singleGenerate ?? syntheticSingleGenerate;
  const teamWorkflowDeps = dependencies.teamWorkflowDeps ?? syntheticTeamWorkflowDeps;

  const mode = command.mode === "team" ? "team_workflow" as const : "single_agent" as const;
  const modelRoutes = { default: "synthetic/synthetic-eval" };
  const setPayload = await createSet(root, {
    evalSetId: command.evalSetId,
    label: command.label,
    sourceRoot: command.sourceRoot,
    ...(command.sampleSize === undefined ? {} : { sampleSize: command.sampleSize }),
  });
  const run = await createRun(root, command.evalSetId, {
    mode,
    modelRoutes,
    segmentCount: setPayload.segments.length,
    thinkingLevel: DEFAULT_PRIVATE_EVAL_THINKING_LEVEL,
  });
  const batch = setPayload.segments.map((segment) => ({
    segmentId: segment.segmentId,
    source: segment.source,
    tags: [...segment.tags],
    riskTypes: [...segment.riskTypes],
    tmRefs: [...segment.tmRefs],
    termRefs: [...segment.termRefs],
  }));
  // Batch parity with the production route: one canonical call memoized across segments.
  let batchOutputs: Promise<Map<string, Awaited<ReturnType<typeof single>> extends Map<string, infer V> ? V : never>> | undefined;
  const segmentRunner: PrivateEvalSegmentRunner = async ({ segment }) => {
    batchOutputs ??= mode === "team_workflow"
      ? team({
        repoRoot: root,
        parentRunId: run.runId,
        evalSetId: command.evalSetId,
        segments: batch,
        sourceLocale: command.sourceLocale,
        targetLocale: command.targetLocale,
        modelRoutes,
        thinkingLevel: DEFAULT_PRIVATE_EVAL_THINKING_LEVEL,
        workflowDeps: teamWorkflowDeps(root),
      })
      : single({
        projectId: "private-eval-harness",
        parentRunId: run.runId,
        evalSetId: command.evalSetId,
        segments: batch,
        sourceLocale: command.sourceLocale,
        targetLocale: command.targetLocale,
        modelProvider: "synthetic",
        modelId: "synthetic-eval",
        requestBudget: syntheticPromptRequestBudget(),
        thinkingLevel: DEFAULT_PRIVATE_EVAL_THINKING_LEVEL,
        generate: singleGenerate,
      });
    const output = (await batchOutputs).get(segment.segmentId);
    if (!output) throw new Error(`Canonical ${mode} produced no output for ${segment.segmentId}.`);
    return {
      ...output,
      mechanicalQa: evaluatePrivateEvalMechanicalQa(segment.source, output.target, SYNTHETIC_TAG_RULE_CONTEXT, {
        targetLocale: command.targetLocale,
        allowedTerms: evalTermTargets(segment.termRefs),
      }),
    };
  };
  const result = await execute(root, command.evalSetId, run.runId, segmentRunner, {});
  const comparison = await compare(root, command.evalSetId, `harness-${run.runId}`);
  return {
    command: "run",
    evalSetId: command.evalSetId,
    runId: run.runId,
    mode,
    status: result.run.status,
    outputCount: result.outputs.length,
    ...(result.run.usage ? { usage: result.run.usage } : {}),
    reportPath: comparison.reportPath,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPrivateEvalHarness(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
