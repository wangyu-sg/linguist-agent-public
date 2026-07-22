import { mkdir, realpath } from "node:fs/promises";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { normalizePiRuntimeModel } from "./modelCompat.js";
import { applySharedPiRuntimeOverrides } from "./piRuntimeOverrides.js";

const MAINTAINER_TOOLS = ["edit", "find", "grep", "ls", "read", "write"] as const;
const modelCatalog = builtinModels();

export interface CreateMaintainerAgentSessionOptions {
  candidateRoot: string;
  sessionRoot: string;
  planHash: string;
  currentPiVersion: string;
  targetPiVersion: string;
  modelRuntime: ModelRuntime;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  agentDir?: string;
}

export async function createMaintainerAgentSession(options: CreateMaintainerAgentSessionOptions) {
  const candidateRoot = await realpath(options.candidateRoot);
  const agentDir = options.agentDir ?? getAgentDir();
  await mkdir(options.sessionRoot, { recursive: true });
  const sessionManager = SessionManager.create(candidateRoot, options.sessionRoot, {
    id: `la-maintainer-${options.planHash.slice(0, 24)}`,
  });
  const settingsManager = SettingsManager.create(candidateRoot, agentDir, { projectTrusted: true });
  applySharedPiRuntimeOverrides(settingsManager);
  const resourceLoader = new DefaultResourceLoader({
    cwd: candidateRoot,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: false,
    noPromptTemplates: false,
    noThemes: true,
    noContextFiles: false,
    appendSystemPromptOverride: (base) => [
      ...base,
      [
        "Linguist Agent isolated Maintainer candidate:",
        `- Candidate root: ${candidateRoot}`,
        `- Approved dependency transition: Pi ${options.currentPiVersion} to ${options.targetPiVersion}.`,
        "- Inspect the updated Pi package source, types, release notes available inside the candidate, and LA call sites.",
        "- Make only compatibility edits required for this exact transition. Preserve product behavior, CAT safety, evidence, permission, and delivery gates.",
        "- Work only in the candidate root. The running repository, current runtime, installed app, remotes, and user data are outside your authority.",
        "- No shell, network, bridge, UI, delegation, release, push, or activation capability is available.",
        "- Do not rewrite dependency locks, generated output, customer data, or credentials. The host owns dependency preparation and all validation commands.",
        "- Finish with a concise summary of files changed and compatibility reasoning. Do not claim tests passed; the deterministic host validates after you stop.",
      ].join("\n"),
    ],
  });
  await resourceLoader.reload();
  const extensionResult = resourceLoader.getExtensions();
  if (extensionResult.errors.length || extensionResult.extensions.length) {
    throw new Error("Maintainer must start without executable Pi Extensions.");
  }
  const model = normalizePiRuntimeModel(
    options.modelProvider && options.modelId
      ? options.modelRuntime.getModel(options.modelProvider, options.modelId)
        ?? modelCatalog.getModel(options.modelProvider, options.modelId)
      : undefined,
  );
  const { session } = await createAgentSession({
    cwd: candidateRoot,
    modelRuntime: options.modelRuntime,
    model,
    thinkingLevel: options.thinkingLevel,
    sessionManager,
    settingsManager,
    resourceLoader,
    customTools: [],
  });
  session.setActiveToolsByName([...MAINTAINER_TOOLS]);
  return {
    session,
    activeToolNames: session.getActiveToolNames().sort(),
    contextFiles: resourceLoader.getAgentsFiles().agentsFiles.map(({ path }) => path),
    skills: resourceLoader.getSkills().skills.map(({ name, filePath }) => ({ name, filePath })),
    prompts: resourceLoader.getPrompts().prompts.map(({ name, filePath }) => ({ name, filePath })),
  };
}
