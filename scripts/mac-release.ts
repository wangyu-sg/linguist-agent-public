import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { syncVersions } from "./version-sync.js";

const execFileAsync = promisify(execFile);
const APP_NAME = "LinguistAgent";
const DISPLAY_NAME = "Linguist Agent";
const DESKTOP_APP = join("apps", "desktop");

export type MacReleaseChannel = "stable" | "beta";

export interface MacReleasePlan {
  version: string;
  buildNumber: string;
  channel: MacReleaseChannel;
  releaseTag: string;
  releaseDir: string;
  appPath: string;
  appNotaryZipPath: string;
  zipPath: string;
  dmgPath: string;
  runtimeArchivePath: string;
  missingEnv: string[];
}

export interface MacReleaseOptions {
  repoRoot: string;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
  publish?: boolean;
  allowDirty?: boolean;
  channel?: MacReleaseChannel;
  releaseTag?: string;
}

async function readPackageVersion(repoRoot: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as { version?: string };
  if (!packageJson.version) throw new Error("package.json has no version");
  return packageJson.version;
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: repoRoot });
  return String(result.stdout ?? "").trim();
}

async function buildNumber(repoRoot: string, env: Record<string, string | undefined>): Promise<string> {
  if (env.LA_BUILD_NUMBER?.trim()) return env.LA_BUILD_NUMBER.trim();
  return git(repoRoot, ["rev-list", "--count", "HEAD"]);
}

async function shortSha(repoRoot: string, env: Record<string, string | undefined>): Promise<string> {
  const sha = env.LA_RELEASE_SHA?.trim() || env.GITHUB_SHA?.trim();
  if (sha) return sha.slice(0, 7);
  try { return (await git(repoRoot, ["rev-parse", "--short=7", "HEAD"])) || "local"; } catch { return "local"; }
}

function validateReleaseTag(tag: string): string {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(tag)) throw new Error(`Invalid release tag: ${tag}`);
  return tag;
}

function missingEnv(env: Record<string, string | undefined>): string[] {
  const signing = env.LA_MAC_CODESIGN_IDENTITY?.trim() || env.LA_DEVELOPER_ID_APPLICATION?.trim();
  const missing = [
    ...(signing ? [] : ["LA_MAC_CODESIGN_IDENTITY or LA_DEVELOPER_ID_APPLICATION"]),
    ...(env.LA_NOTARY_KEYCHAIN_PROFILE?.trim() ? [] : ["LA_NOTARY_KEYCHAIN_PROFILE"]),
  ];
  return missing;
}

export async function createMacReleasePlan(options: MacReleaseOptions): Promise<MacReleasePlan> {
  const env = options.env ?? process.env;
  const version = await readPackageVersion(options.repoRoot);
  const build = await buildNumber(options.repoRoot, env);
  const channel = options.channel ?? "stable";
  if (channel !== "stable" && channel !== "beta") throw new Error(`Invalid release channel: ${channel}`);
  const releaseTag = validateReleaseTag(options.releaseTag?.trim() || (channel === "beta" ? `beta-${build}-${await shortSha(options.repoRoot, env)}` : `v${version}`));
  const releaseDir = join(options.repoRoot, "dist", "releases", releaseTag);
  return {
    version,
    buildNumber: build,
    channel,
    releaseTag,
    releaseDir,
    appPath: join(releaseDir, `${APP_NAME}.app`),
    appNotaryZipPath: join(releaseDir, `${APP_NAME}-${releaseTag}-notary.zip`),
    zipPath: join(releaseDir, `${APP_NAME}-${releaseTag}.zip`),
    dmgPath: join(releaseDir, `${APP_NAME}-${releaseTag}.dmg`),
    runtimeArchivePath: join(releaseDir, "runtime.tar.gz"),
    missingEnv: missingEnv(env),
  };
}

async function run(command: string, args: string[], options: { cwd?: string; dryRun?: boolean; env?: Record<string, string | undefined> } = {}): Promise<void> {
  console.log([command, ...args.map((arg) => JSON.stringify(arg))].join(" "));
  if (!options.dryRun) await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function ensureClean(repoRoot: string, allowDirty: boolean): Promise<void> {
  if (allowDirty) return;
  if (await git(repoRoot, ["status", "--porcelain"])) throw new Error("Release requires a clean worktree. Pass --allow-dirty only for local test builds.");
}

async function packageRuntime(repoRoot: string, archivePath: string, dryRun: boolean): Promise<void> {
  const excludes = ["--exclude=.git", "--exclude=data", "--exclude=node_modules", "--exclude=dist", "--exclude=.turbo", "--exclude=.cache"];
  await run("tar", [...excludes, "-czf", archivePath, "."], { cwd: repoRoot, dryRun });
}

async function stageApp(repoRoot: string, plan: MacReleasePlan, env: Record<string, string | undefined>, dryRun: boolean): Promise<void> {
  if (!dryRun) {
    await rm(plan.releaseDir, { recursive: true, force: true });
    await mkdir(plan.releaseDir, { recursive: true });
  }
  const packageArgs = ["--prefix", DESKTOP_APP, "run", "package", "--", `--build-version=${plan.buildNumber}`];
  await run("npm", packageArgs, { cwd: repoRoot, env, dryRun });
  const packagedApp = join(repoRoot, DESKTOP_APP, "out", "LinguistAgent-darwin-arm64", "LinguistAgent.app");
  await run("cp", ["-R", packagedApp, plan.appPath], { cwd: repoRoot, dryRun });
  await packageRuntime(repoRoot, plan.runtimeArchivePath, dryRun);
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeChecksums(paths: string[], outputPath: string, dryRun: boolean): Promise<void> {
  if (dryRun) { console.log(`write ${outputPath}`); return; }
  const rows = [];
  for (const path of paths) rows.push(`${await sha256(path)}  ${basename(path)}`);
  await writeFile(outputPath, `${rows.join("\n")}\n`, "utf8");
}

async function createDmg(plan: MacReleasePlan, dryRun: boolean): Promise<void> {
  const dmgRoot = join(plan.releaseDir, "dmg-root");
  if (!dryRun) {
    await rm(dmgRoot, { recursive: true, force: true });
    await mkdir(dmgRoot, { recursive: true });
  }
  await run("cp", ["-R", plan.appPath, dmgRoot], { dryRun });
  if (!dryRun) await symlink("/Applications", join(dmgRoot, "Applications")).catch(() => undefined);
  await run("hdiutil", ["create", "-volname", DISPLAY_NAME, "-srcfolder", dmgRoot, "-ov", "-format", "UDZO", plan.dmgPath], { dryRun });
}

async function publish(plan: MacReleasePlan, dryRun: boolean): Promise<void> {
  await run("gh", ["release", "create", plan.releaseTag, plan.zipPath, plan.dmgPath, join(plan.releaseDir, "SHA256SUMS"), "--title", plan.releaseTag, "--notes-file", join(plan.releaseDir, "RELEASE_NOTES.md")], { dryRun });
}

export async function runMacRelease(options: MacReleaseOptions): Promise<MacReleasePlan> {
  const env = { ...(options.env ?? process.env) };
  if (!env.LA_MAC_CODESIGN_IDENTITY && env.LA_DEVELOPER_ID_APPLICATION) env.LA_MAC_CODESIGN_IDENTITY = env.LA_DEVELOPER_ID_APPLICATION;
  const plan = await createMacReleasePlan({ ...options, env });
  if (plan.missingEnv.length) throw new Error(`Missing release env: ${plan.missingEnv.join(", ")}`);
  await syncVersions(options.repoRoot, plan.version, { check: true });
  await ensureClean(options.repoRoot, Boolean(options.allowDirty || options.dryRun));
  await stageApp(options.repoRoot, plan, env, Boolean(options.dryRun));
  await run("ditto", ["-c", "-k", "--keepParent", plan.appPath, plan.appNotaryZipPath], { dryRun: options.dryRun });
  await run("xcrun", ["notarytool", "submit", plan.appNotaryZipPath, "--keychain-profile", env.LA_NOTARY_KEYCHAIN_PROFILE ?? "", "--wait"], { dryRun: options.dryRun });
  await run("xcrun", ["stapler", "staple", plan.appPath], { dryRun: options.dryRun });
  await run("ditto", ["-c", "-k", "--keepParent", plan.appPath, plan.zipPath], { dryRun: options.dryRun });
  await createDmg(plan, Boolean(options.dryRun));
  await run("xcrun", ["notarytool", "submit", plan.dmgPath, "--keychain-profile", env.LA_NOTARY_KEYCHAIN_PROFILE ?? "", "--wait"], { dryRun: options.dryRun });
  await run("xcrun", ["stapler", "staple", plan.dmgPath], { dryRun: options.dryRun });
  await run("codesign", ["--verify", "--deep", "--strict", plan.appPath], { dryRun: options.dryRun });
  await run("spctl", ["--assess", "--type", "execute", "--verbose", plan.appPath], { dryRun: options.dryRun });
  if (!options.dryRun) await writeFile(join(plan.releaseDir, "RELEASE_NOTES.md"), `# Linguist Agent v${plan.version}\n\nSee CHANGELOG.md for release notes.\n`, "utf8");
  await writeChecksums([plan.zipPath, plan.dmgPath], join(plan.releaseDir, "SHA256SUMS"), Boolean(options.dryRun));
  if (options.publish) await publish(plan, Boolean(options.dryRun));
  return plan;
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv: string[]): { dryRun: boolean; publish: boolean; allowDirty: boolean; channel?: MacReleaseChannel; releaseTag?: string } {
  return {
    dryRun: argv.includes("--dry-run"),
    publish: argv.includes("--publish"),
    allowDirty: argv.includes("--allow-dirty"),
    channel: argValue(argv, "--channel") as MacReleaseChannel | undefined,
    releaseTag: argValue(argv, "--release-tag"),
  };
}

if (process.argv[1]?.endsWith("mac-release.ts")) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const plan = await runMacRelease({ repoRoot: resolve("."), ...args });
    console.log(`${args.dryRun ? "planned" : "released"} ${plan.version} -> ${plan.releaseDir}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
