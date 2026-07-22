import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  buildReleaseCandidateStatus,
  createWorkspace,
  parseKnownRisksMarkdown,
  requiredFrontendSurfaceFiles,
  type PiDependencyManifest,
  renderReleaseCandidateStatusMarkdown,
} from "@linguist-agent/cat-data";
import { evaluateHarnessSecurityEvalFixture, type HarnessSecurityEvalFixture } from "@linguist-agent/cat-runtime";

const piDependencyNames = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"] as const;
const piDependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

interface PackageManifest {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function piDependenciesFromManifest(manifest: PackageManifest): Record<string, string | undefined> {
  const dependencies: Record<string, string | undefined> = {};
  for (const name of piDependencyNames) {
    for (const section of piDependencySections) {
      const value = manifest[section]?.[name];
      if (typeof value === "string") {
        dependencies[name] = value;
        break;
      }
    }
  }
  return dependencies;
}

function hasPiDependency(dependencies: Record<string, string | undefined>): boolean {
  return piDependencyNames.some((name) => typeof dependencies[name] === "string");
}

function missingPiDependenciesFor(dependencies: Record<string, string | undefined>): Record<string, string | undefined> {
  const missing: Record<string, string | undefined> = {};
  for (const name of piDependencyNames) {
    if (Object.prototype.hasOwnProperty.call(dependencies, name)) missing[name] = undefined;
  }
  return missing;
}

async function readPackageManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
}

async function workspacePackageManifestPaths(cwd: string): Promise<string[]> {
  const manifestPaths = ["package.json"];
  const packagesRoot = join(cwd, "packages");
  let packageDirs: Awaited<ReturnType<typeof readdir>>;
  try {
    packageDirs = await readdir(packagesRoot, { withFileTypes: true });
  } catch {
    return manifestPaths;
  }
  for (const entry of packageDirs.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const manifestPath = join("packages", entry.name, "package.json");
    try {
      await readFile(join(cwd, manifestPath), "utf8");
      manifestPaths.push(manifestPath);
    } catch {
      // Missing package manifests are not Pi pin evidence.
    }
  }
  return manifestPaths;
}

async function readPiDependencyManifests(cwd: string): Promise<PiDependencyManifest[]> {
  const manifestPaths = await workspacePackageManifestPaths(cwd);
  const manifests: PiDependencyManifest[] = [];
  const packageManifests: PiDependencyManifest[] = [];
  for (const manifestPath of manifestPaths) {
    const dependencies = piDependenciesFromManifest(await readPackageManifest(join(cwd, manifestPath)));
    if (hasPiDependency(dependencies)) {
      const manifest = { manifestPath, dependencies };
      packageManifests.push(manifest);
      manifests.push(manifest);
    }
  }
  try {
    const lockfile = JSON.parse(await readFile(join(cwd, "package-lock.json"), "utf8")) as {
      packages?: Record<string, PackageManifest>;
    };
    for (const { manifestPath, dependencies: packageDependencies } of packageManifests) {
      const lockPackagePath = manifestPath === "package.json" ? "" : manifestPath.replace(/\/package\.json$/, "");
      const lockPackage = lockfile.packages?.[lockPackagePath];
      const dependencies = lockPackage ? piDependenciesFromManifest(lockPackage) : missingPiDependenciesFor(packageDependencies);
      manifests.push({
        manifestPath: `package-lock.json#packages["${lockPackagePath || "."}"]`,
        dependencies,
      });
    }
  } catch {
    for (const { manifestPath, dependencies } of packageManifests) {
      manifests.push({
        manifestPath: `package-lock.json#missing:${manifestPath}`,
        dependencies: missingPiDependenciesFor(dependencies),
      });
    }
  }
  return manifests;
}

const cwd = process.cwd();
const checkedAt = new Date().toISOString();
const harnessFixturePath = join(cwd, "packages", "cat-runtime", "eval", "fixtures", "harness", "security-smoke.json");
const harnessFixture = JSON.parse(await readFile(harnessFixturePath, "utf8")) as HarnessSecurityEvalFixture;
const harnessResult = evaluateHarnessSecurityEvalFixture(
  harnessFixture,
  createWorkspace(cwd, harnessFixture.projectId),
);
const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
  version: string;
  dependencies?: Record<string, string>;
};
const piDependencyManifests = await readPiDependencyManifests(cwd);
const piSettings = JSON.parse(await readFile(join(cwd, ".pi", "settings.json"), "utf8"));
const risks = parseKnownRisksMarkdown(await readFile(join(cwd, "docs", "KNOWN_RISKS.md"), "utf8"));
const frontendSurfaceFiles = (
  await Promise.all(
    requiredFrontendSurfaceFiles.map(async (file) => {
      try {
        await access(join(cwd, file));
        return file;
      } catch {
        return undefined;
      }
    }),
  )
).filter((file): file is string => typeof file === "string");
const [changelog, readme, projectOverview, runtimePatterns, todo] = await Promise.all([
  readFile(join(cwd, "CHANGELOG.md"), "utf8"),
  readFile(join(cwd, "README.md"), "utf8"),
  readFile(join(cwd, "docs", "PROJECT_OVERVIEW.md"), "utf8"),
  readFile(join(cwd, "docs", "RUNTIME_BORROWED_PATTERNS.md"), "utf8"),
  readFile(join(cwd, "TODO.md"), "utf8"),
]);
const docs = {
  changelogHasVersion: changelog.includes(`[${packageJson.version}]`),
  readmeHasVersion: readme.includes(`v${packageJson.version}`),
  projectOverviewHasVersion: projectOverview.includes(`v${packageJson.version}`),
  runtimeBorrowedPatternsCurrent:
    runtimePatterns.includes(`current product version is \`${packageJson.version}\``) &&
    runtimePatterns.includes("Reuse Pi instead of rebuilding it"),
  todoHasRcFreeze: todo.includes("release candidate, feature freeze"),
};
const status = buildReleaseCandidateStatus({
  checkedAt,
  version: packageJson.version,
  piDependencies: {
    "@earendil-works/pi-ai": packageJson.dependencies?.["@earendil-works/pi-ai"],
    "@earendil-works/pi-coding-agent": packageJson.dependencies?.["@earendil-works/pi-coding-agent"],
  },
  piDependencyManifests,
  piSettings,
  risks,
  harnessSecurityEval: {
    status: harnessResult.status,
    fixturePath: relative(cwd, harnessFixturePath),
    caseCount: harnessResult.summary.total,
    failed: harnessResult.summary.failed,
  },
  frontendSurfaceFiles,
  docs,
});
const reportDir = join(cwd, "data", "reports");
await mkdir(reportDir, { recursive: true });
const reportPath = join(reportDir, `la_rc_status_${checkedAt.replace(/[:.]/g, "-")}.md`);
await writeFile(reportPath, renderReleaseCandidateStatusMarkdown(status), "utf8");

console.log(`LA RC status ${status.status}`);
console.log(`Report: ${reportPath}`);
console.log(`Checks: ${status.checks.map((check) => `${check.id}:${check.status}`).join(", ")}`);
if (status.failures.length) {
  console.log("RC status failures:");
  for (const failure of status.failures) console.log(`- ${failure}`);
  process.exitCode = 1;
}
