import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface VersionSyncResult {
  version: string;
  changed: string[];
  checked: string[];
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function packageJsonPaths(root: string): Promise<string[]> {
  const packagesRoot = join(root, "packages");
  const dirs = await readdir(packagesRoot, { withFileTypes: true });
  const desktopPackage = join(root, "apps", "desktop", "package.json");
  const hasDesktopPackage = await access(desktopPackage).then(() => true, () => false);
  return [
    join(root, "package.json"),
    ...dirs.filter((entry) => entry.isDirectory()).map((entry) => join(packagesRoot, entry.name, "package.json")).sort(),
    ...(hasDesktopPackage ? [desktopPackage] : []),
  ];
}

function internalPackageNames(packages: Array<Record<string, unknown>>): Set<string> {
  return new Set(packages.map((pkg) => String(pkg.name ?? "")).filter((name) => name.startsWith("@linguist-agent/")));
}

function syncInternalDeps(pkg: Record<string, unknown>, names: Set<string>, version: string): boolean {
  let changed = false;
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = pkg[key] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (names.has(name) && deps[name] !== version) {
        deps[name] = version;
        changed = true;
      }
    }
  }
  return changed;
}

export async function syncVersions(root: string, version: string, options: { check?: boolean } = {}): Promise<VersionSyncResult> {
  if (!VERSION_RE.test(version)) throw new Error(`Invalid version: ${version}`);
  const paths = await packageJsonPaths(root);
  const packages = await Promise.all(paths.map((path) => readJson<Record<string, unknown>>(path)));
  const names = internalPackageNames(packages);
  const changed: string[] = [];

  for (let index = 0; index < paths.length; index += 1) {
    const pkg = packages[index];
    let didChange = false;
    if (pkg.version !== version) {
      pkg.version = version;
      didChange = true;
    }
    didChange = syncInternalDeps(pkg, names, version) || didChange;
    if (didChange) {
      changed.push(paths[index]);
      if (!options.check) await writeJson(paths[index], pkg);
    }
  }

  const rootLockPath = join(root, "package-lock.json");
  const desktopLockPath = join(root, "apps", "desktop", "package-lock.json");
  const lockPaths = [
    rootLockPath,
    ...(await access(desktopLockPath).then(() => true, () => false) ? [desktopLockPath] : []),
  ];
  for (const lockPath of lockPaths) {
    const lock = await readJson<Record<string, any>>(lockPath);
    let lockChanged = false;
    if (lock.version !== version) {
      lock.version = version;
      lockChanged = true;
    }
    const lockPackages = lock.packages as Record<string, any> | undefined;
    if (lockPackages) {
      for (const [key, pkg] of Object.entries(lockPackages)) {
        const ownedPackage = lockPath === rootLockPath ? key === "" || /^packages\/[^/]+$/.test(key) : key === "";
        if (ownedPackage) {
          if (pkg.version !== version) {
            pkg.version = version;
            lockChanged = true;
          }
          if (syncInternalDeps(pkg, names, version)) lockChanged = true;
        }
      }
    }
    const lockDeps = lock.dependencies as Record<string, any> | undefined;
    if (lockDeps) {
      for (const name of names) {
        if (lockDeps[name]?.version && lockDeps[name].version !== version) {
          lockDeps[name].version = version;
          lockChanged = true;
        }
      }
    }
    if (lockChanged) {
      changed.push(lockPath);
      if (!options.check) await writeJson(lockPath, lock);
    }
  }

  if (options.check && changed.length) {
    throw new Error(`Version mismatch for ${version}: ${changed.map((path) => path.replace(`${root}/`, "")).join(", ")}`);
  }
  return { version, changed, checked: [...paths, ...lockPaths] };
}

function parseCli(argv: string[]): { version?: string; check: boolean } {
  return {
    version: argv.find((arg) => !arg.startsWith("-")),
    check: argv.includes("--check"),
  };
}

if (process.argv[1]?.endsWith("version-sync.ts")) {
  const { version, check } = parseCli(process.argv.slice(2));
  if (!version) {
    console.error("Usage: npm run version:sync -- <version> [--check]");
    process.exitCode = 2;
  } else {
    try {
      const result = await syncVersions(process.cwd(), version, { check });
      console.log(`${check ? "checked" : "synced"} ${result.version}; changed=${result.changed.length}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
