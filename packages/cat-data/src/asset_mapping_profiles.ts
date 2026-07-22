import { createHash } from "node:crypto";
import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";
import type { AssetMappingProfile, AssetMappingProfilesPayload } from "./asset_ingestion_contract.js";

function profilesPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "asset_mapping_profiles.json");
}

function profileId(profile: Pick<AssetMappingProfile, "projectId" | "assetPath" | "parseMode" | "confirmedMappings" | "confirmedAt">): string {
  const hash = createHash("sha1")
    .update(JSON.stringify({
      projectId: profile.projectId,
      assetPath: profile.assetPath,
      parseMode: profile.parseMode,
      confirmedMappings: profile.confirmedMappings,
      confirmedAt: profile.confirmedAt,
    }))
    .digest("hex")
    .slice(0, 12);
  return `mapping-${hash}`;
}

export async function readAssetMappingProfiles(workspaceRoot: string, projectId: string): Promise<AssetMappingProfilesPayload> {
  const profiles = await readJsonFile<AssetMappingProfile[]>(profilesPath(workspaceRoot, projectId), []);
  return {
    projectId,
    profiles,
  };
}

export async function saveAssetMappingProfile(
  workspaceRoot: string,
  input: Omit<AssetMappingProfile, "id" | "confirmedAt"> & { id?: string; confirmedAt?: string },
): Promise<{ profile: AssetMappingProfile; total: number; path: string }> {
  const confirmedAt = input.confirmedAt ?? new Date().toISOString();
  const profile: AssetMappingProfile = {
    ...input,
    id: input.id ?? profileId({ ...input, confirmedAt }),
    confirmedAt,
  };
  const path = profilesPath(workspaceRoot, input.projectId);
  const existing = await readJsonFile<AssetMappingProfile[]>(path, []);
  const next = [
    profile,
    ...existing.filter((candidate) => candidate.id !== profile.id),
  ].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
  await writeJsonFile(path, next);
  return {
    profile,
    total: next.length,
    path,
  };
}
