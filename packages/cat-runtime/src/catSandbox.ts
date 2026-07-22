import { createBashToolDefinition, createLocalBashOperations, type BashOperations, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { CatWorkspace } from "@linguist-agent/cat-data";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { domainToASCII } from "node:url";
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
    const trimmed = domain.trim().toLowerCase();
    if (!trimmed) continue;
    if (trimmed.includes("*")) throw new Error(`Sandbox egress allowlist requires exact host entries; wildcard rejected: ${domain}`);
    if (trimmed.includes("\0") || trimmed.includes("%00")) throw new Error(`Sandbox egress allowlist rejected null byte host: ${domain}`);
    if (/[\s\r\n/:]/.test(trimmed) || trimmed.endsWith(".") || trimmed.startsWith(".")) {
      throw new Error(`Sandbox egress allowlist requires exact host entries; invalid host: ${domain}`);
    }
    const ascii = domainToASCII(trimmed);
    if (!ascii || ascii !== trimmed || ascii.includes("*") || ascii.includes("\0") || ascii.includes("%00")) {
      throw new Error(`Sandbox egress allowlist requires exact host entries; invalid host: ${domain}`);
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

export function catSandboxPhaseFromEnv(env: NodeJS.ProcessEnv = process.env): CatSandboxPhase {
  const raw = (env.LA_CAT_SANDBOX_PHASE ?? "enforce").trim().toLowerCase();
  if (raw === "off" || raw === "observe" || raw === "enforce") return raw;
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
): CatSandboxHealthReport {
  const phase = catSandboxPhaseFromEnv(env);
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

let activeSandboxConfigKey: string | undefined;

export async function ensureSandboxInitialized(config: SandboxRuntimeConfig): Promise<void> {
  const nextKey = JSON.stringify(config);
  if (SandboxManager.getConfig()) {
    if (activeSandboxConfigKey !== nextKey) {
      SandboxManager.updateConfig(config);
      activeSandboxConfigKey = nextKey;
    }
    return;
  }
  await SandboxManager.initialize(config);
  activeSandboxConfigKey = nextKey;
}

export function createSandboxedBashOperations(workspace: CatWorkspace): BashOperations {
  const local = createLocalBashOperations();
  const config = buildCatSandboxRuntimeConfig(workspace);
  return {
    exec: async (command, cwd, options) => {
      const phase = catSandboxPhaseFromEnv();
      if (phase !== "enforce") {
        return local.exec(command, cwd, {
          ...options,
          env: sanitizeBashEnv({ ...process.env, ...options.env }),
        });
      }
      await ensureSandboxInitialized(config);
      const wrappedCommand = await SandboxManager.wrapWithSandbox(command, undefined, undefined, options.signal);
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
