import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  createBashToolDefinition,
  createLocalBashOperations,
  type BashOperations,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { FileGrantV1 } from "@linguist-agent/cat-data";
import {
  ensureSandboxInitialized,
  sandboxAllowedDomainsFromEnv,
  sanitizeBashEnv,
} from "./catSandbox.js";

export interface GeneralFilesystemAccess {
  workspaceRoot: string;
  workingDirectory: string;
  grants: FileGrantV1[];
}

export function buildGeneralSandboxRuntimeConfig(
  access: GeneralFilesystemAccess,
  env: NodeJS.ProcessEnv = process.env,
): SandboxRuntimeConfig {
  const readRoots = [access.workspaceRoot, ...access.grants.map((grant) => grant.realPath)];
  const writeRoots = [
    access.workspaceRoot,
    ...access.grants.filter((grant) => grant.access === "read_write").map((grant) => grant.realPath),
    tmpdir(),
  ];
  return {
    network: {
      allowedDomains: sandboxAllowedDomainsFromEnv(env),
      deniedDomains: [],
      allowLocalBinding: false,
    },
    filesystem: {
      denyRead: [dirname(homedir())],
      allowRead: readRoots,
      allowWrite: writeRoots,
      denyWrite: [],
      allowGitConfig: false,
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
    allowAppleEvents: false,
  };
}

let sandboxWrapQueue = Promise.resolve();

async function sandboxedCommand(command: string, config: SandboxRuntimeConfig, signal?: AbortSignal): Promise<string> {
  let wrapped = "";
  const next = sandboxWrapQueue.then(async () => {
    await ensureSandboxInitialized(config);
    wrapped = await SandboxManager.wrapWithSandbox(command, undefined, undefined, signal);
  });
  sandboxWrapQueue = next.catch(() => undefined);
  await next;
  return wrapped;
}

export function createGeneralSandboxedBashOperations(access: GeneralFilesystemAccess): BashOperations {
  const local = createLocalBashOperations();
  const config = buildGeneralSandboxRuntimeConfig(access);
  return {
    exec: async (command, cwd, options) => local.exec(
      await sandboxedCommand(command, config, options.signal),
      cwd,
      { ...options, env: sanitizeBashEnv({ ...process.env, ...options.env }) },
    ),
  };
}

export function createGeneralSandboxedBashTool(access: GeneralFilesystemAccess): ToolDefinition {
  const tool = createBashToolDefinition(resolve(access.workingDirectory), {
    operations: createGeneralSandboxedBashOperations(access),
  });
  return {
    ...tool,
    description: `${tool.description} Linguist Agent confines reads to the Chat workspace and active grants, writes to the workspace and read-write grants, scrubs secret environment variables, and uses an exact-host network allowlist.`,
    promptSnippet: `${tool.promptSnippet}; sandboxed by Linguist Agent for a standalone Chat`,
    promptGuidelines: [
      ...(tool.promptGuidelines ?? []),
      "Operate only inside the current Chat workspace and explicitly granted files or directories.",
      "Ask for a new file or directory grant instead of probing paths outside the authorized roots.",
    ],
  } as unknown as ToolDefinition;
}
