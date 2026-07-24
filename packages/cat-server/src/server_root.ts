import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

interface RootOverrideInput {
  env: NodeJS.ProcessEnv;
  temporaryRoot?: string;
}

function assertTemporaryPath(path: string, label: string, temporaryRoot: string): string {
  const resolvedPath = resolve(path);
  const resolvedTemporaryRoot = resolve(temporaryRoot);
  const rel = relative(resolvedTemporaryRoot, resolvedPath);
  if (!rel || rel === "." || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error(`${label} must be inside a temporary directory when test mode is enabled.`);
  }
  return resolvedPath;
}

function requireTestMode(env: NodeJS.ProcessEnv): void {
  if (env.LA_TEST_MODE !== "1") {
    throw new Error("A server root override requires explicit test mode.");
  }
}

export function resolveServerRepoRoot(input: RootOverrideInput & { sourceRoot: string }): string {
  const override = input.env.LA_TEST_REPO_ROOT?.trim();
  if (!override) {
    if (input.env.LA_TEST_MODE === "1") {
      throw new Error("Explicit test mode requires LA_TEST_REPO_ROOT.");
    }
    return resolve(input.sourceRoot);
  }
  requireTestMode(input.env);
  return assertTemporaryPath(override, "LA_TEST_REPO_ROOT", input.temporaryRoot ?? tmpdir());
}

export function resolvePiAgentDir(input: RootOverrideInput): string | undefined {
  const override = input.env.LA_TEST_PI_AGENT_DIR?.trim();
  if (!override) {
    if (input.env.LA_TEST_MODE === "1") {
      throw new Error("Explicit test mode requires LA_TEST_PI_AGENT_DIR.");
    }
    return undefined;
  }
  requireTestMode(input.env);
  return assertTemporaryPath(override, "LA_TEST_PI_AGENT_DIR", input.temporaryRoot ?? tmpdir());
}
