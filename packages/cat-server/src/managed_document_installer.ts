import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import {
  MANAGED_CPYTHON_DISTRIBUTION,
  MANAGED_CPYTHON_SHA256,
  MANAGED_DOCUMENT_CAPABILITIES,
  PADDLE_OCR_PACK,
  inspectManagedDocumentCapabilities,
  managedDocumentCapabilityPath,
  managedPythonExecutable,
  type ManagedCapabilityLockV1,
  type ManagedDocumentCapabilityDescriptor,
  type ManagedDocumentCapabilityId,
  type ManagedDocumentCapabilityStatus,
  type ManagedLockedFile,
  type ManagedPackagePin,
} from "@linguist-agent/cat-data";

const CPYTHON_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/20260718/${encodeURIComponent(MANAGED_CPYTHON_DISTRIBUTION)}.tar.gz`;
const MODEL_FILES: Record<string, string[]> = {
  "PP-OCRv5_mobile_det": ["config.json", "inference.json", "inference.pdiparams", "inference.yml"],
  "PP-OCRv6_medium_rec": ["inference.json", "inference.pdiparams", "inference.yml"],
  "PP-LCNet_x0_25_textline_ori": ["config.json", "inference.json", "inference.pdiparams", "inference.yml"],
};
const NODE_OFFICE_PACKAGES = new Set(["pdf-lib"]);
const BINARY_OFFICE_PACKAGES = new Set(["bun-docx"]);
const DOCX_BINARY_URL = "https://github.com/kklimuk/docx-cli/releases/download/v0.21.0/docx-darwin-arm64";
const GITHUB_DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const HUGGING_FACE_DOWNLOAD_HOSTS = new Set(["huggingface.co", "cdn-lfs.huggingface.co", "cas-bridge.xethub.hf.co", "us.aws.cdn.hf.co"]);

export interface ManagedDocumentInstallPlan {
  schemaVersion: 1;
  capabilityId: ManagedDocumentCapabilityId;
  label: string;
  tier: "core" | "labs";
  targetPath: string;
  prerequisiteIds: ManagedDocumentCapabilityId[];
  runtime: { distribution: string; sha256: string; url: string };
  packages: ManagedPackagePin[];
  models: Array<{ name: string; revision: string; files: string[] }>;
  networkHosts: string[];
  sourceFilesRemainReadOnly: true;
  lifecycleScriptsDisabled: true;
  planHash: string;
}

export class ManagedDocumentInstallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ManagedDocumentInstallError";
  }
}

function descriptor(id: ManagedDocumentCapabilityId): ManagedDocumentCapabilityDescriptor {
  const value = MANAGED_DOCUMENT_CAPABILITIES.find((entry) => entry.id === id);
  if (!value) throw new ManagedDocumentInstallError("unknown_capability", `Unknown managed document capability ${id}.`);
  return value;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function planHash(value: Omit<ManagedDocumentInstallPlan, "planHash">): string {
  return hash(stable(value));
}

export function previewManagedDocumentCapabilityInstall(workspaceRoot: string, id: ManagedDocumentCapabilityId): ManagedDocumentInstallPlan {
  const value = descriptor(id);
  const unsigned: Omit<ManagedDocumentInstallPlan, "planHash"> = {
    schemaVersion: 1,
    capabilityId: id,
    label: value.label,
    tier: value.tier,
    targetPath: managedDocumentCapabilityPath(workspaceRoot, id),
    prerequisiteIds: id === "python" ? [] : ["python"],
    runtime: { distribution: value.runtime.distribution, sha256: value.runtime.sha256, url: CPYTHON_URL },
    packages: value.packages.map((entry) => ({ ...entry })),
    models: value.models.map((model) => ({ ...model, files: [...(MODEL_FILES[model.name] ?? [])] })),
    networkHosts: id === "python"
      ? [...GITHUB_DOWNLOAD_HOSTS]
      : id === "ocr"
        ? ["pypi.org", "files.pythonhosted.org", ...HUGGING_FACE_DOWNLOAD_HOSTS]
        : ["pypi.org", "files.pythonhosted.org", ...(id === "office" ? ["registry.npmjs.org", ...GITHUB_DOWNLOAD_HOSTS] : [])],
    sourceFilesRemainReadOnly: true,
    lifecycleScriptsDisabled: true,
  };
  return { ...unsigned, planHash: planHash(unsigned) };
}

async function sha256File(path: string): Promise<ManagedLockedFile> {
  const value = await readFile(path);
  return { path: "", sha256: hash(value), sizeBytes: value.byteLength };
}

async function download(url: string, target: string, allowedHosts: ReadonlySet<string>): Promise<ManagedLockedFile> {
  let current = new URL(url);
  let response: Response | undefined;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    if (current.protocol !== "https:" || !allowedHosts.has(current.hostname)) {
      throw new ManagedDocumentInstallError("download_host_denied", `Managed download refused undeclared host ${current.hostname}.`);
    }
    response = await fetch(current, { redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) throw new ManagedDocumentInstallError("download_failed", `Download redirect had no Location header: ${current}`);
    current = new URL(location, current);
  }
  if (!response || [301, 302, 303, 307, 308].includes(response.status)) throw new ManagedDocumentInstallError("download_failed", `Download exceeded the redirect limit: ${url}`);
  if (!response.ok || !response.body) throw new ManagedDocumentInstallError("download_failed", `Download failed with HTTP ${response.status}: ${url}`);
  await mkdir(dirname(target), { recursive: true });
  await streamPipeline(Readable.fromWeb(response.body as never), createWriteStream(target, { flags: "wx" }));
  return sha256File(target);
}

function run(executable: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    execFile(executable, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONNOUSERSITE: "1",
        ...options.env,
      },
      timeout: options.timeout ?? 15 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        rejectRun(new ManagedDocumentInstallError("command_failed", `${basename(executable)} failed: ${error.message}${stderr.trim() ? `\n${stderr.trim()}` : ""}`));
        return;
      }
      resolveRun({ stdout, stderr });
    });
  });
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const rows: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isDirectory()) rows.push(...await listFiles(root, path));
    else if (info.isFile() || info.isSymbolicLink()) rows.push(relative(root, path));
    else throw new ManagedDocumentInstallError("closure_invalid", `Managed capability contains an unsupported filesystem entry: ${relative(root, path)}`);
  }
  return rows;
}

async function lockFiles(root: string, relativePaths: string[]): Promise<ManagedLockedFile[]> {
  return Promise.all([...new Set(relativePaths)].sort().map(async (path) => {
    const target = join(root, path);
    const info = await lstat(target);
    if (info.isSymbolicLink()) {
      const linkTarget = await readlink(target);
      return {
        path,
        kind: "symlink" as const,
        linkTarget,
        sha256: hash(linkTarget),
        sizeBytes: Buffer.byteLength(linkTarget),
      };
    }
    if (!info.isFile()) throw new ManagedDocumentInstallError("closure_invalid", `Managed capability entry is not a file: ${path}`);
    return { ...await sha256File(target), path, kind: "file" as const };
  }));
}

async function lockAllFiles(root: string): Promise<ManagedLockedFile[]> {
  return lockFiles(root, (await listFiles(root)).filter((path) => path !== "capability-lock.json"));
}

async function writeLock(root: string, lock: ManagedCapabilityLockV1): Promise<void> {
  await writeFile(join(root, "capability-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

async function promote(quarantine: string, target: string): Promise<void> {
  const backup = `${target}.backup-${randomUUID()}`;
  await mkdir(dirname(target), { recursive: true });
  let backedUp = false;
  try {
    try {
      await rename(target, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(quarantine, target);
    if (backedUp) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (backedUp) {
      await rm(target, { recursive: true, force: true });
      await rename(backup, target).catch(() => undefined);
    }
    throw error;
  }
}

async function installPython(quarantine: string, progress?: (message: string) => void): Promise<void> {
  const archivePath = join(quarantine, "downloads", `${MANAGED_CPYTHON_DISTRIBUTION}.tar.gz`);
  progress?.("Downloading pinned CPython archive");
  const archive = await download(CPYTHON_URL, archivePath, GITHUB_DOWNLOAD_HOSTS);
  if (archive.sha256 !== MANAGED_CPYTHON_SHA256) throw new ManagedDocumentInstallError("integrity_mismatch", "Managed CPython archive failed SHA-256 verification.");
  const runtime = join(quarantine, "runtime");
  await mkdir(runtime, { recursive: true });
  progress?.("Extracting CPython into quarantine");
  await run("/usr/bin/tar", ["-xzf", archivePath, "-C", runtime]);
  const executable = join(runtime, "python", "bin", "python3.11");
  const info = await stat(executable);
  if (!info.isFile()) throw new ManagedDocumentInstallError("runtime_invalid", "Extracted CPython executable is missing.");
  await run(executable, ["-B", "-I", "-c", "import json,platform,sys; print(json.dumps({'version':sys.version_info[:3],'machine':platform.machine()}))"]);
  const files = await lockAllFiles(quarantine);
  await writeLock(quarantine, {
    schemaVersion: 1,
    capabilityId: "python",
    installedAt: new Date().toISOString(),
    runtime: { distribution: MANAGED_CPYTHON_DISTRIBUTION, sha256: MANAGED_CPYTHON_SHA256 },
    packages: [],
    models: [],
    files,
  });
}

function normalizedDistribution(value: string): string {
  return value.toLocaleLowerCase().replace(/[-_.]+/g, "-");
}

function wheelIdentity(filename: string): { name: string; version: string } | undefined {
  const match = filename.match(/^(.+?)-(\d[^-]*)-/);
  return match ? { name: normalizedDistribution(match[1]!), version: match[2]! } : undefined;
}

async function installPythonEnvironment(
  workspaceRoot: string,
  quarantine: string,
  value: ManagedDocumentCapabilityDescriptor,
  progress?: (message: string) => void,
): Promise<{ packages: ManagedPackagePin[]; lockedFiles: string[] }> {
  const python = managedPythonExecutable(workspaceRoot);
  const venv = join(quarantine, "venv");
  progress?.("Creating isolated Python environment");
  await run(python, ["-B", "-I", "-m", "venv", venv]);
  const venvPython = join(venv, "bin", "python3.11");
  const wheelhouse = join(quarantine, "wheelhouse");
  await mkdir(wheelhouse, { recursive: true });
  const pythonPins = value.packages.filter((entry) => !NODE_OFFICE_PACKAGES.has(entry.name) && !BINARY_OFFICE_PACKAGES.has(entry.name));
  if (pythonPins.length) {
    progress?.("Resolving an exact wheel closure in quarantine");
    await run(venvPython, ["-B", "-I", "-m", "pip", "download", "--disable-pip-version-check", "--only-binary=:all:", "--dest", wheelhouse, ...pythonPins.map((entry) => `${entry.name}==${entry.version}`)], {
      env: { PIP_NO_INPUT: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1" },
    });
    const wheels = (await readdir(wheelhouse)).filter((name) => name.endsWith(".whl")).sort();
    const wheelLocks = await Promise.all(wheels.map(async (name) => ({ name, ...await sha256File(join(wheelhouse, name)) })));
    for (const required of pythonPins.filter((entry) => entry.sha256)) {
      if (!wheelLocks.some((entry) => entry.sha256 === required.sha256)) throw new ManagedDocumentInstallError("integrity_mismatch", `Resolved wheel closure did not contain approved ${required.name}@${required.version} SHA-256.`);
    }
    progress?.("Installing only from the verified offline wheelhouse");
    await run(venvPython, ["-B", "-I", "-m", "pip", "install", "--disable-pip-version-check", "--no-index", "--find-links", wheelhouse, ...pythonPins.map((entry) => `${entry.name}==${entry.version}`)], {
      env: { PIP_NO_INPUT: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1" },
    });
    await run(venvPython, ["-B", "-I", "-m", "pip", "check"]);
    const packages: ManagedPackagePin[] = wheelLocks.flatMap((entry) => {
      const identity = wheelIdentity(entry.name);
      return identity ? [{ ...identity, sha256: entry.sha256 }] : [];
    });
    for (const required of pythonPins) {
      const match = packages.find((entry) => normalizedDistribution(entry.name) === normalizedDistribution(required.name) && entry.version === required.version);
      if (!match) throw new ManagedDocumentInstallError("closure_invalid", `Installed wheel closure is missing ${required.name}@${required.version}.`);
      if (required.sha256) match.sha256 = required.sha256;
    }
    return { packages, lockedFiles: wheels.map((name) => join("wheelhouse", name)) };
  }
  return { packages: [], lockedFiles: [] };
}

async function installOcrModels(quarantine: string, progress?: (message: string) => void): Promise<{ models: ManagedCapabilityLockV1["models"]; lockedFiles: string[] }> {
  const models: ManagedCapabilityLockV1["models"] = [];
  const lockedFiles: string[] = [];
  for (const model of PADDLE_OCR_PACK.models) {
    const modelRoot = join(quarantine, "models", model.name);
    const files: ManagedLockedFile[] = [];
    progress?.(`Downloading ${model.name}@${model.revision}`);
    for (const file of MODEL_FILES[model.name] ?? []) {
      const target = join(modelRoot, file);
      const result = await download(`https://huggingface.co/PaddlePaddle/${model.name}/resolve/${model.revision}/${file}`, target, HUGGING_FACE_DOWNLOAD_HOSTS);
      const path = join("models", model.name, file);
      files.push({ ...result, path });
      lockedFiles.push(path);
    }
    models.push({ ...model, files });
  }
  return { models, lockedFiles };
}

async function installNodeOfficeEnvironment(quarantine: string, value: ManagedDocumentCapabilityDescriptor, progress?: (message: string) => void): Promise<{ packages: ManagedPackagePin[]; lockedFiles: string[] }> {
  const pins = value.packages.filter((entry) => NODE_OFFICE_PACKAGES.has(entry.name));
  if (!pins.length) return { packages: [], lockedFiles: [] };
  const nodeRoot = join(quarantine, "node");
  await mkdir(nodeRoot, { recursive: true });
  await writeFile(join(nodeRoot, "package.json"), `${JSON.stringify({ private: true, dependencies: Object.fromEntries(pins.map((entry) => [entry.name, entry.version])) }, null, 2)}\n`, "utf8");
  progress?.("Resolving Office Node packages with lifecycle scripts disabled");
  await run("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact"], { cwd: nodeRoot });
  await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: nodeRoot });
  const packages = await Promise.all(pins.map(async (pin) => ({ ...pin, sha256: (await sha256File(join(nodeRoot, "node_modules", pin.name, "package.json"))).sha256 })));
  const files = (await listFiles(nodeRoot)).map((path) => join("node", path));
  return { packages, lockedFiles: files };
}

async function installDocxBinary(quarantine: string, value: ManagedDocumentCapabilityDescriptor, progress?: (message: string) => void): Promise<{ packages: ManagedPackagePin[]; lockedFiles: string[] }> {
  const pin = value.packages.find((entry) => entry.name === "bun-docx");
  if (!pin) return { packages: [], lockedFiles: [] };
  if (!pin.sha256) throw new ManagedDocumentInstallError("closure_invalid", "bun-docx requires an approved standalone binary SHA-256.");
  const target = join(quarantine, "bin", "docx");
  progress?.(`Downloading bun-docx@${pin.version} standalone binary`);
  const downloaded = await download(DOCX_BINARY_URL, target, GITHUB_DOWNLOAD_HOSTS);
  if (downloaded.sha256 !== pin.sha256) throw new ManagedDocumentInstallError("integrity_mismatch", `bun-docx@${pin.version} binary failed SHA-256 verification.`);
  await chmod(target, 0o755);
  await run(target, ["--version"], { timeout: 30_000 });
  return { packages: [{ ...pin }], lockedFiles: [join("bin", "docx")] };
}

async function installDocumentPack(
  workspaceRoot: string,
  quarantine: string,
  value: ManagedDocumentCapabilityDescriptor,
  progress?: (message: string) => void,
): Promise<void> {
  const statuses = await inspectManagedDocumentCapabilities(workspaceRoot);
  if (statuses.python.state !== "ready") throw new ManagedDocumentInstallError("missing_prerequisite", statuses.python.message ?? "Install LA Managed CPython first.");
  const python = await installPythonEnvironment(workspaceRoot, quarantine, value, progress);
  const node = value.id === "office" ? await installNodeOfficeEnvironment(quarantine, value, progress) : { packages: [], lockedFiles: [] };
  const binaries = value.id === "office" ? await installDocxBinary(quarantine, value, progress) : { packages: [], lockedFiles: [] };
  let models: ManagedCapabilityLockV1["models"] = [];
  if (value.id === "ocr") {
    const installed = await installOcrModels(quarantine, progress);
    models = installed.models;
  }
  const workerSource = value.id === "ocr"
    ? fileURLToPath(new URL("../../cat-data/workers/ocr_worker.py", import.meta.url))
    : value.id === "office"
      ? fileURLToPath(new URL("../../cat-data/workers/office_worker.py", import.meta.url))
      : fileURLToPath(new URL("../../cat-data/workers/mineru_worker.py", import.meta.url));
  const workerPath = join("worker", basename(workerSource));
  await mkdir(join(quarantine, "worker"), { recursive: true });
  await copyFile(workerSource, join(quarantine, workerPath));
  if (value.id === "office") {
    const nodeWorkerSource = fileURLToPath(new URL("../../cat-data/workers/office_node_worker.mjs", import.meta.url));
    await copyFile(nodeWorkerSource, join(quarantine, "worker", "office_node_worker.mjs"));
    const qualificationWorkerSource = fileURLToPath(new URL("../../cat-data/workers/office_qualification_worker.py", import.meta.url));
    await copyFile(qualificationWorkerSource, join(quarantine, "worker", "office_qualification_worker.py"));
  }
  // Use exact top-level identities in the lock while retaining resolved closure rows.
  const closure = [...python.packages, ...node.packages, ...binaries.packages];
  const packages: ManagedPackagePin[] = value.packages.map((required) => {
    const installed = closure.find((entry) => normalizedDistribution(entry.name) === normalizedDistribution(required.name) && entry.version === required.version);
    if (!installed?.sha256) throw new ManagedDocumentInstallError("closure_invalid", `Capability closure is missing a locked artifact for ${required.name}@${required.version}.`);
    return { ...required, sha256: required.sha256 ?? installed.sha256 };
  });
  for (const entry of closure) {
    if (!packages.some((existing) => normalizedDistribution(existing.name) === normalizedDistribution(entry.name) && existing.version === entry.version)) packages.push(entry);
  }
  const files = await lockAllFiles(quarantine);
  await writeLock(quarantine, {
    schemaVersion: 1,
    capabilityId: value.id,
    installedAt: new Date().toISOString(),
    runtime: { ...value.runtime },
    packages,
    models,
    files,
  });
}

export async function installManagedDocumentCapability(
  workspaceRoot: string,
  input: { capabilityId: ManagedDocumentCapabilityId; planHash: string; onProgress?: (message: string) => void },
): Promise<ManagedDocumentCapabilityStatus> {
  const plan = previewManagedDocumentCapabilityInstall(workspaceRoot, input.capabilityId);
  if (input.planHash !== plan.planHash) throw new ManagedDocumentInstallError("plan_hash_mismatch", "Document capability plan changed; preview it again before installing.");
  const target = plan.targetPath;
  const quarantine = `${target}.quarantine-${randomUUID()}`;
  await mkdir(dirname(target), { recursive: true });
  await rm(quarantine, { recursive: true, force: true });
  await mkdir(quarantine, { recursive: true });
  try {
    if (input.capabilityId === "python") await installPython(quarantine, input.onProgress);
    else await installDocumentPack(workspaceRoot, quarantine, descriptor(input.capabilityId), input.onProgress);
    await promote(quarantine, target);
  } catch (error) {
    await rm(quarantine, { recursive: true, force: true });
    throw error;
  }
  const status = (await inspectManagedDocumentCapabilities(workspaceRoot))[input.capabilityId];
  if (status.state !== "ready" && !(input.capabilityId === "mineru" && status.state === "unqualified")) {
    throw new ManagedDocumentInstallError("post_install_invalid", status.message ?? `Installed ${input.capabilityId} pack is ${status.state}.`);
  }
  return status;
}
