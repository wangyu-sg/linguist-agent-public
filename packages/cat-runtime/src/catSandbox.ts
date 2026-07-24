import { createBashToolDefinition, createLocalBashOperations, type BashOperations, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { CatWorkspace } from "@linguist-agent/cat-data";
import { normalizeNetworkCapabilityHost, ProcessCapabilityBroker } from "@linguist-agent/cat-data";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { CAT_PROTECTED_CREDENTIAL_PATHS } from "./catSafetyKernel.js";

export const CAT_BASH_DEFAULT_ALLOWED_DOMAINS = [
  "api.deepseek.com",
  "api.tavily.com",
  "api.openai.com",
  "api.anthropic.com",
  "api.groq.com",
  "api.x.ai",
  "generativelanguage.googleapis.com",
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "pi.dev",
  "www.pi.dev",
] as const;

export const CAT_BASH_SANDBOX_SEED_DOMAINS = ["api.deepseek.com", "api.tavily.com"] as const;

export type CatSandboxPhase = "off" | "observe" | "enforce";

export interface CatSandboxPhaseOptions {
  /** Explicit test/development capability. Stable product callers never set it. */
  allowUnsafePhase?: boolean;
}

export interface CatSandboxHealthReport {
  engine: "none" | "srt";
  phase: CatSandboxPhase;
  denyWrite: {
    data: boolean;
    paths: string[];
  };
  denyRead: {
    credentialPaths: string[];
    agentReach: boolean;
    ssh: boolean;
    aws: boolean;
    genericToolKernel: boolean;
  };
  egress: {
    mode: "off" | "observe" | "exact-host-allowlist";
    allowedDomains: string[];
    seedDomains: string[];
    allowedDomainCount: number;
  };
}

const DENY_READ_PATHS = ["~/.agent-reach", "~/.ssh", "~/.aws"] as const;
const SECRET_ENV_RE = /(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|CREDENTIAL|SESSION|AUTH|AWS_|OPENAI|ANTHROPIC|DEEPSEEK|TAVILY|GROQ|XAI|TDAI|KEYCHAIN|SSH_AUTH_SOCK)/i;

function splitHostList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
}

export function validateSandboxAllowedDomains(domains: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const domain of domains) {
    if (!domain.trim()) continue;
    let ascii: string;
    try {
      ascii = normalizeNetworkCapabilityHost(domain);
    } catch (error) {
      throw new Error(`Sandbox egress allowlist requires exact host entries: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!seen.has(ascii)) {
      seen.add(ascii);
      result.push(ascii);
    }
  }
  return result;
}

export function sandboxAllowedDomainsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return validateSandboxAllowedDomains([
    ...CAT_BASH_DEFAULT_ALLOWED_DOMAINS,
    ...splitHostList(env.LA_BASH_ALLOWED_DOMAINS),
    ...splitHostList(env.LA_BASH_ALLOWED_DOMAIN_APPEND),
  ]);
}

export function catSandboxPhaseFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: CatSandboxPhaseOptions = {},
): CatSandboxPhase {
  const raw = (env.LA_CAT_SANDBOX_PHASE ?? "enforce").trim().toLowerCase();
  if (raw === "enforce") return raw;
  if ((raw === "off" || raw === "observe") && options.allowUnsafePhase === true) return raw;
  if (raw === "off" || raw === "observe") {
    throw new Error(`Stable runtime requires LA_CAT_SANDBOX_PHASE=enforce; ${raw} needs an explicit test/development capability.`);
  }
  throw new Error(`Invalid LA_CAT_SANDBOX_PHASE: ${raw}`);
}

export function sanitizeBashEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SECRET_ENV_RE.test(key)) continue;
    scrubbed[key] = value;
  }
  return scrubbed;
}

export function buildCatSandboxRuntimeConfig(
  workspace: CatWorkspace,
  env: NodeJS.ProcessEnv = process.env,
): SandboxRuntimeConfig {
  const dataRoot = resolve(workspace.root, "data");
  return {
    network: {
      allowedDomains: sandboxAllowedDomainsFromEnv(env),
      deniedDomains: [],
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: [...DENY_READ_PATHS],
      allowWrite: [workspace.root, tmpdir()],
      denyWrite: [dataRoot],
      allowGitConfig: false,
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
  };
}

export function buildCatSandboxHealthReport(
  workspace: CatWorkspace,
  env: NodeJS.ProcessEnv = process.env,
  options: CatSandboxPhaseOptions = {},
): CatSandboxHealthReport {
  const phase = catSandboxPhaseFromEnv(env, options);
  const dataRoot = resolve(workspace.root, "data");
  const allowedDomains = phase === "off" ? [] : sandboxAllowedDomainsFromEnv(env);
  return {
    engine: phase === "off" ? "none" : "srt",
    phase,
    denyWrite: {
      data: phase === "enforce",
      paths: phase === "enforce" ? [dataRoot] : [],
    },
    denyRead: {
      credentialPaths: phase === "enforce" ? [...CAT_PROTECTED_CREDENTIAL_PATHS] : [],
      agentReach: phase === "enforce",
      ssh: phase === "enforce",
      aws: phase === "enforce",
      genericToolKernel: phase === "enforce",
    },
    egress: {
      mode: phase === "off" ? "off" : phase === "observe" ? "observe" : "exact-host-allowlist",
      allowedDomains,
      seedDomains: [...CAT_BASH_SANDBOX_SEED_DOMAINS],
      allowedDomainCount: allowedDomains.length,
    },
  };
}

type SandboxCommandRuntime = Pick<
  typeof SandboxManager,
  "getConfig" | "initialize" | "updateConfig" | "wrapWithSandbox"
>;

export function createSandboxCommandCoordinator(runtime: SandboxCommandRuntime = SandboxManager) {
  let activeConfigKey: string | undefined;
  let tail = Promise.resolve();
  return {
    async wrap(command: string, config: SandboxRuntimeConfig, signal?: AbortSignal): Promise<string> {
      const next = tail.then(async () => {
        const configKey = JSON.stringify(config);
        if (!runtime.getConfig()) await runtime.initialize(config);
        else if (activeConfigKey !== configKey) runtime.updateConfig(config);
        activeConfigKey = configKey;
        return runtime.wrapWithSandbox(command, undefined, undefined, signal);
      });
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
  };
}

export const sandboxCommandCoordinator = createSandboxCommandCoordinator();
const SANDBOX_PROCESS_BROKER = ProcessCapabilityBroker.create({
  grants: [{ id: "la-sandboxed-shell", toolName: "bash", templateIds: ["sandboxed-shell"] }],
});

export function createSandboxedBashOperations(workspace: CatWorkspace): BashOperations {
  const local = createLocalBashOperations();
  const config = buildCatSandboxRuntimeConfig(workspace);
  return {
    exec: async (command, cwd, options) => {
      SANDBOX_PROCESS_BROKER.authorize("bash", "sandboxed-shell");
      const phase = catSandboxPhaseFromEnv();
      if (phase !== "enforce") {
        return local.exec(command, cwd, {
          ...options,
          env: sanitizeBashEnv({ ...process.env, ...options.env }),
        });
      }
      const wrappedCommand = await sandboxCommandCoordinator.wrap(command, config, options.signal);
      return local.exec(wrappedCommand, cwd, {
        ...options,
        env: sanitizeBashEnv({ ...process.env, ...options.env }),
      });
    },
  };
}

export function createSandboxedBashTool(workspace: CatWorkspace): ToolDefinition {
  const tool = createBashToolDefinition(resolve(workspace.root), {
    operations: createSandboxedBashOperations(workspace),
  });
  return {
    ...tool,
    description: `${tool.description} Linguist Agent wraps this command with @anthropic-ai/sandbox-runtime, exact-host egress allowlist, denyRead for agent credential directories, denyWrite for the LA data store, and secret environment scrubbing.`,
    promptSnippet: `${tool.promptSnippet}; sandboxed by Linguist Agent for CAT project sessions`,
    promptGuidelines: [
      ...(tool.promptGuidelines ?? []),
      "Never use bash output as citable CAT evidence unless the relevant source excerpt is promoted through a CAT evidence/proposal tool.",
      "Do not attempt direct writes under data/**; use CAT apply/import/export tools for project state.",
    ],
  } as unknown as ToolDefinition;
}
