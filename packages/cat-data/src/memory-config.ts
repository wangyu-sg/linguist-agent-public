import { readJsonFile, writeJsonFile, workspacePath } from "./workspace.js";
import type { CatWorkspace } from "./workspace.js";
import type { MemoryAuditSummary } from "./memory-audit.js";
import type { AssetSemanticState } from "./asset_blocks.js";
import type { TdaiEmbeddingBridgeStatus } from "./tdai_embedding_bridge.js";

export interface MemoryConfig {
  enabled: boolean;
  gatewayUrl: string;
}

export interface MemoryStatus {
  status: "disabled" | "ready" | "gateway_unreachable";
  enabled: boolean;
  gatewayUrl: string;
  gatewayReachable?: boolean;
  toolsAvailable: boolean;
  captureEnabled: boolean;
  cacheSafety: "tool_tail_only";
  userIdStrategy: "project_id";
  semantic: AssetSemanticState;
  embeddingBridge?: TdaiEmbeddingBridgeStatus;
  audit?: MemoryAuditSummary;
  nextAction?: string;
}

const DEFAULTS: MemoryConfig = {
  enabled: false,
  gatewayUrl: "http://127.0.0.1:8420",
};

function configPath(workspace: CatWorkspace): string {
  return workspacePath(workspace, "cat-agent-memory.json");
}

export async function readMemoryConfig(workspace: CatWorkspace): Promise<MemoryConfig> {
  const stored = await readJsonFile<Partial<MemoryConfig>>(configPath(workspace), {});
  return { ...DEFAULTS, ...stored };
}

export async function writeMemoryConfig(workspace: CatWorkspace, config: MemoryConfig): Promise<void> {
  await writeJsonFile(configPath(workspace), config);
}

export async function isMemoryEnabled(workspace: CatWorkspace): Promise<boolean> {
  const config = await readMemoryConfig(workspace);
  return config.enabled;
}

function defaultSemanticState(): AssetSemanticState {
  return { state: "disabled", assetVectorIndex: "absent" };
}

export function buildMemoryStatus(
  config: MemoryConfig,
  gatewayReachable?: boolean,
  audit?: MemoryAuditSummary,
  semantic = defaultSemanticState(),
  embeddingBridge?: TdaiEmbeddingBridgeStatus,
): MemoryStatus {
  if (!config.enabled) {
    return {
      status: "disabled",
      enabled: false,
      gatewayUrl: config.gatewayUrl,
      gatewayReachable,
      toolsAvailable: false,
      captureEnabled: false,
      cacheSafety: "tool_tail_only",
      userIdStrategy: "project_id",
      semantic,
      embeddingBridge,
      audit,
      nextAction: "Optional legacy TDAI recall is disabled. Use Library for LA's local confirmed memory.",
    };
  }
  if (gatewayReachable !== true) {
    return {
      status: "gateway_unreachable",
      enabled: true,
      gatewayUrl: config.gatewayUrl,
      gatewayReachable,
      toolsAvailable: false,
      captureEnabled: false,
      cacheSafety: "tool_tail_only",
      userIdStrategy: "project_id",
      semantic,
      embeddingBridge,
      audit,
      nextAction: "Start the TencentDB-Agent-Memory Gateway with npm run tdai:start, then retry memory status.",
    };
  }
  return {
    status: "ready",
    enabled: true,
    gatewayUrl: config.gatewayUrl,
    gatewayReachable: true,
    toolsAvailable: true,
    captureEnabled: false,
    cacheSafety: "tool_tail_only",
    userIdStrategy: "project_id",
    semantic,
    embeddingBridge,
    audit,
    nextAction: "Legacy TDAI is available for read-only project recall. Long-term writes require confirmation in Library.",
  };
}
