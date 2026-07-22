import { isAbsolute } from "node:path";

export const PI_SUBAGENT_PI_BINARY_ENV = "PI_SUBAGENT_PI_BINARY";

/**
 * pi-subagents 0.35.1 reads this environment variable before choosing its
 * child command. The caller must pass the runtime-only path returned by
 * resolveTaskRunResources("team"); that resolver derives the path from the
 * same verified graph as the Team manifest. Always overwrite inherited state
 * so PATH or a stale launchd value cannot select another Pi host.
 */
export function bindVerifiedPiSubagentBinary(
  verifiedPiBinaryPath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isAbsolute(verifiedPiBinaryPath)) {
    throw new Error("Verified Pi child binary path must be absolute.");
  }
  env[PI_SUBAGENT_PI_BINARY_ENV] = verifiedPiBinaryPath;
}
