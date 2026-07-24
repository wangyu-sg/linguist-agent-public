import { stat } from "node:fs/promises";
import { readJsonFile, workspacePath } from "./workspace.js";
import type { CatWorkspace } from "./workspace.js";
import type { AssetSemanticState } from "./asset_blocks.js";

interface LegacyTdaiMemoryConfigFile {
  enabled?: unknown;
  gatewayUrl?: unknown;
}

export interface LegacyTdaiMemoryConfigurationStatus {
  configurationDetected: boolean;
  legacyRecallWasConfigured: boolean;
}

export interface MemoryStatus {
  status: "confirmed_memory_only" | "legacy_migration_required";
  toolsAvailable: false;
  captureEnabled: false;
  storeEnabled: false;
  recallEnabled: false;
  legacyTdai: {
    configurationDetected: boolean;
    legacyRecallWasConfigured: boolean;
    migration: "explicit_read_only_candidate_review_required";
  };
  semantic: AssetSemanticState;
  nextAction: string;
}

function legacyConfigPath(workspace: CatWorkspace): string {
  return workspacePath(workspace, "cat-agent-memory.json");
}

/**
 * This is deliberately inventory-only.  It never returns a gateway URL and
 * cannot enable the retired TDAI capture/store/recall runtime.
 */
export async function inspectLegacyTdaiMemoryConfiguration(workspace: CatWorkspace): Promise<LegacyTdaiMemoryConfigurationStatus> {
  const path = legacyConfigPath(workspace);
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { configurationDetected: false, legacyRecallWasConfigured: false };
    }
    throw error;
  }
  const config = await readJsonFile<LegacyTdaiMemoryConfigFile>(path, {});
  return {
    configurationDetected: true,
    legacyRecallWasConfigured: config.enabled === true,
  };
}

function defaultSemanticState(): AssetSemanticState {
  return { state: "disabled", assetVectorIndex: "absent" };
}

export function buildMemoryStatus(
  legacyTdai: LegacyTdaiMemoryConfigurationStatus,
  semantic = defaultSemanticState(),
): MemoryStatus {
  const migrationRequired = legacyTdai.configurationDetected;
  return {
    status: migrationRequired ? "legacy_migration_required" : "confirmed_memory_only",
    toolsAvailable: false,
    captureEnabled: false,
    storeEnabled: false,
    recallEnabled: false,
    legacyTdai: {
      ...legacyTdai,
      migration: "explicit_read_only_candidate_review_required",
    },
    semantic,
    nextAction: migrationRequired
      ? "Legacy TDAI capture, store, and recall are disabled. Review an explicit read-only export as pending MemoryCandidate records before any user-confirmed import."
      : "Confirmed Memory is the only recall source. Legacy TDAI capture, store, and recall remain disabled.",
  };
}
