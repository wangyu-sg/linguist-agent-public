import type { RuntimeStatus } from "../data/workspace-client.ts";

export function canInstallOrRepairRuntime(status: RuntimeStatus["status"]): boolean {
  return status === "offline" || status === "incompatible" || status === "error";
}
