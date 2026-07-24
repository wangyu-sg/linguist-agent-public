import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type TestSuite = "all" | "unit" | "security" | "recovery" | "roadmap";

export interface TestSelection {
  suite: TestSuite;
  shard?: string;
}

export interface RootTestChildEnvironment {
  root: string;
  piAgentDir: string;
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const LEGACY_SCRIPT_NAMES = ["test:legacy:pre", "test:legacy", "test:legacy:post"] as const;
const SYNTHETIC_ROOT_LINKED_ENTRIES = [
  "apps",
  "contracts",
  "docs",
  "node_modules",
  "packages",
  "patches",
  "scripts",
  "tests",
] as const;
const SYNTHETIC_ROOT_COPIED_FILES = ["AGENTS.md", "package.json", "package-lock.json", "tsconfig.json"] as const;
const SYNTHETIC_PI_LINKED_ENTRIES = ["agents"] as const;
const SYNTHETIC_PI_COPIED_FILES = ["APPEND_SYSTEM.md", "extensions/memory.ts", "extensions/team-evidence-child.ts"] as const;

const SECURITY_PATTERN = /(auth|authority|capabilit|credential|extension|keychain|logging|permission|policy|redact|sandbox|security|transport|trust)/i;
const RECOVERY_PATTERN = /(backfill|install|migration|recovery|resident|storage|workspace_io)/i;
const ROADMAP_PATTERN = /(test_discovery|validate_roadmap)/i;
const ROOT_SERVER_LAUNCH_PATTERN = /\bspawn(?:Sync)?\(\s*["']npm["']\s*,\s*\[\s*["']run["']\s*,\s*["']server["']\s*\]/;

function toRepositoryPath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function walk(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(target, files);
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(target);
    }
  }
}

export function discoverRootTests(root: string): string[] {
  const testsRoot = path.join(root, "tests");
  const files: string[] = [];
  walk(testsRoot, files);
  return files.map((file) => toRepositoryPath(root, file)).sort();
}

export function extractLegacyTestFiles(scripts: Record<string, string | undefined>): string[] {
  const files = new Set<string>();
  for (const name of LEGACY_SCRIPT_NAMES) {
    const script = scripts[name] ?? "";
    for (const match of script.matchAll(/(?:^|\s)tsx\s+(tests\/[^\s]+\.(?:test|spec)\.(?:[cm]?[jt]sx?))/g)) {
      files.add(match[1]);
    }
  }
  return [...files];
}

export function validateLegacyParity(
  discovered: readonly string[],
  legacy: readonly string[],
): { additions: string[]; errors: string[] } {
  const discoveredSet = new Set(discovered);
  const legacySet = new Set(legacy);
  return {
    additions: discovered.filter((file) => !legacySet.has(file)),
    errors: legacy
      .filter((file) => !discoveredSet.has(file))
      .map((file) => `legacy test is no longer discovered: ${file}`),
  };
}

export function validateServerLaunchEnvironment(root: string, files: readonly string[]): string[] {
  const errors: string[] = [];
  for (const file of files) {
    const source = readFileSync(path.join(root, file), "utf8");
    if (ROOT_SERVER_LAUNCH_PATTERN.test(source) && !/\.\.\.\s*process\.env\b/.test(source)) {
      errors.push(`server-starting root test does not inherit the runner synthetic environment: ${file}`);
    }
  }
  return errors;
}

export function orderTestsForMigration(discovered: readonly string[], legacy: readonly string[]): string[] {
  const discoveredSet = new Set(discovered);
  const legacySet = new Set(legacy);
  return [
    ...legacy.filter((file) => discoveredSet.has(file)),
    ...discovered.filter((file) => !legacySet.has(file)),
  ];
}

function belongsToSuite(file: string, suite: TestSuite): boolean {
  if (suite === "all") return true;
  if (suite === "security") return SECURITY_PATTERN.test(file);
  if (suite === "recovery") return RECOVERY_PATTERN.test(file);
  if (suite === "roadmap") return ROADMAP_PATTERN.test(file);
  return !SECURITY_PATTERN.test(file) && !RECOVERY_PATTERN.test(file) && !ROADMAP_PATTERN.test(file);
}

function parseShard(shard: string): { index: number; count: number } {
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  if (!match) throw new Error(`invalid shard ${shard}; expected INDEX/COUNT`);
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count < 1 || index < 1 || index > count) {
    throw new Error(`invalid shard ${shard}; expected 1 <= INDEX <= COUNT`);
  }
  return { index, count };
}

export function selectDiscoveredTests(files: readonly string[], selection: TestSelection): string[] {
  const selected = files.filter((file) => belongsToSuite(file, selection.suite));
  if (!selection.shard) return selected;
  const { index, count } = parseShard(selection.shard);
  return selected.filter((_file, fileIndex) => fileIndex % count === index - 1);
}

function populateSyntheticRootSourceView(root: string, sourceRoot: string): void {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  for (const entry of SYNTHETIC_ROOT_LINKED_ENTRIES) {
    symlinkSync(path.join(resolvedSourceRoot, entry), path.join(root, entry), "dir");
  }
  for (const file of SYNTHETIC_ROOT_COPIED_FILES) {
    copyFileSync(path.join(resolvedSourceRoot, file), path.join(root, file));
  }
}

function populateSyntheticPiSourceView(piRoot: string, sourceRoot: string): void {
  const sourcePiRoot = path.join(path.resolve(sourceRoot), ".pi");
  for (const entry of SYNTHETIC_PI_LINKED_ENTRIES) {
    symlinkSync(path.join(sourcePiRoot, entry), path.join(piRoot, entry), "dir");
  }
  for (const file of SYNTHETIC_PI_COPIED_FILES) {
    const target = path.join(piRoot, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(sourcePiRoot, file), target);
  }
}

export function createRootTestChildEnvironment(
  sourceRoot: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): RootTestChildEnvironment {
  const root = mkdtempSync(path.join(tmpdir(), "la-root-test-discovery-"));
  const piRoot = path.join(root, ".pi");
  const piAgentDir = path.join(root, "pi-agent");
  try {
    populateSyntheticRootSourceView(root, sourceRoot);
    mkdirSync(path.join(piRoot, "skills"), { recursive: true });
    mkdirSync(path.join(piRoot, "prompts"), { recursive: true });
    populateSyntheticPiSourceView(piRoot, sourceRoot);
    mkdirSync(piAgentDir, { recursive: true });
    writeFileSync(path.join(piRoot, "settings.json"), "{}\n", "utf8");
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    root,
    piAgentDir,
    env: {
      ...baseEnv,
      LA_TEST_MODE: "1",
      LA_TEST_REPO_ROOT: root,
      LA_TEST_PI_AGENT_DIR: piAgentDir,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface RootTestFileResult {
  error?: Error;
  status?: number | null;
}

export type RootTestFileRunner = (file: string, cwd: string, env: NodeJS.ProcessEnv) => RootTestFileResult;

export function runRootTestFiles(
  root: string,
  files: readonly string[],
  runFile: RootTestFileRunner = (file, cwd, env) => spawnSync(process.execPath, ["--import", "tsx", file], {
    cwd,
    env,
    stdio: "inherit",
  }),
  sourceRoot = root,
): number {
  for (const file of files) {
    const childEnvironment = createRootTestChildEnvironment(sourceRoot, process.env);
    try {
      const result = runFile(path.resolve(root, file), childEnvironment.root, childEnvironment.env);
      if (result.error) throw result.error;
      if (result.status !== 0) return result.status ?? 1;
    } finally {
      childEnvironment.cleanup();
    }
  }
  return 0;
}

interface CliOptions extends TestSelection {
  list: boolean;
}

function parseCli(argv: readonly string[]): CliOptions {
  let suite: TestSuite = "all";
  let shard: string | undefined;
  let list = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") {
      list = true;
    } else if (argument === "--suite") {
      const value = argv[index + 1];
      if (!value || !["all", "unit", "security", "recovery", "roadmap"].includes(value)) {
        throw new Error(`unknown test suite: ${value ?? "<missing>"}`);
      }
      suite = value as TestSuite;
      index += 1;
    } else if (argument === "--shard") {
      shard = argv[index + 1];
      if (!shard) throw new Error("--shard requires INDEX/COUNT");
      parseShard(shard);
      index += 1;
    } else {
      throw new Error(`unknown test-runner argument: ${argument}`);
    }
  }
  return { suite, shard, list };
}

function runCli(): void {
  const root = process.cwd();
  const options = parseCli(process.argv.slice(2));
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const discovered = discoverRootTests(root);
  const legacy = extractLegacyTestFiles(packageJson.scripts ?? {});
  const parity = validateLegacyParity(discovered, legacy);
  if (legacy.length === 0) parity.errors.push("legacy test chain snapshot is missing");
  if (parity.errors.length > 0) throw new Error(parity.errors.join("\n"));

  const ordered = orderTestsForMigration(discovered, legacy);
  const selected = selectDiscoveredTests(ordered, options);
  if (options.list) {
    process.stdout.write(`${selected.join("\n")}\n`);
    return;
  }
  if (selected.length === 0) throw new Error(`suite ${options.suite} selected no tests`);
  const serverLaunchErrors = validateServerLaunchEnvironment(root, selected);
  if (serverLaunchErrors.length > 0) throw new Error(serverLaunchErrors.join("\n"));

  process.stdout.write(
    `discovered ${discovered.length} root tests; legacy ${legacy.length}; new ${parity.additions.length}; running ${selected.length}\n`,
  );
  const exitCode = runRootTestFiles(root, selected);
  if (exitCode !== 0) process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
