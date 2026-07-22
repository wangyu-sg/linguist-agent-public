import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const LA_API_PROTOCOL_VERSION = 2;

export interface RuntimeHandshake {
  ok: true;
  productVersion: string;
  apiProtocolVersion: number;
  runtimeInstanceId: string;
  pi: string;
  dataSchemaVersion: number;
  capabilities: string[];
  authRequired: true;
}

export type RuntimeCompatibility =
  | { compatible: true; missingCapabilities: [] }
  | { compatible: false; reason: "protocol_mismatch" | "missing_capabilities" | "schema_mismatch" | "authentication_not_required" | "instance_missing"; missingCapabilities: string[] };

export function runtimeInstanceId(repoRoot: string): string {
  return createHash("sha256").update(resolve(repoRoot)).digest("hex").slice(0, 24);
}

export function buildRuntimeHandshake(input: {
  repoRoot: string;
  productVersion: string;
  piVersion: string;
  dataSchemaVersion: number;
  capabilities: string[];
}): RuntimeHandshake {
  return {
    ok: true,
    productVersion: input.productVersion,
    apiProtocolVersion: LA_API_PROTOCOL_VERSION,
    runtimeInstanceId: runtimeInstanceId(input.repoRoot),
    pi: input.piVersion,
    dataSchemaVersion: input.dataSchemaVersion,
    capabilities: [...new Set(input.capabilities)].sort(),
    authRequired: true,
  };
}

export function evaluateRuntimeCompatibility(
  handshake: RuntimeHandshake,
  requirement: { protocolVersion: number; requiredCapabilities?: string[]; dataSchemaVersion?: number; requireAuth?: boolean; requireInstanceId?: boolean },
): RuntimeCompatibility {
  if (handshake.apiProtocolVersion !== requirement.protocolVersion) {
    return { compatible: false, reason: "protocol_mismatch", missingCapabilities: [] };
  }
  if (requirement.requireAuth !== false && handshake.authRequired !== true) {
    return { compatible: false, reason: "authentication_not_required", missingCapabilities: [] };
  }
  if (requirement.dataSchemaVersion !== undefined && handshake.dataSchemaVersion !== requirement.dataSchemaVersion) {
    return { compatible: false, reason: "schema_mismatch", missingCapabilities: [] };
  }
  if (requirement.requireInstanceId !== false && !handshake.runtimeInstanceId.trim()) {
    return { compatible: false, reason: "instance_missing", missingCapabilities: [] };
  }
  const available = new Set(handshake.capabilities);
  const missingCapabilities = (requirement.requiredCapabilities ?? []).filter((capability) => !available.has(capability)).sort();
  return missingCapabilities.length
    ? { compatible: false, reason: "missing_capabilities", missingCapabilities }
    : { compatible: true, missingCapabilities: [] };
}
