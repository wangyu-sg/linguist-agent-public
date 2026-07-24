import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MANAGED_CPYTHON_DISTRIBUTION = "cpython-3.11.15+20260718-aarch64-apple-darwin-install_only_stripped";
export const MANAGED_CPYTHON_SHA256 = "b21dbc3f3e01932fcc3f0f4c51e5a7ef61888cb454d23eee6e8207c6f52d0b04";

export type ManagedDocumentCapabilityId = "python" | "ocr" | "mineru" | "office";

export interface ManagedPackagePin {
  name: string;
  version: string;
  sha256?: string;
}

export interface ManagedModelPin {
  name: string;
  revision: string;
  role?: "detection" | "recognition" | "textline-orientation";
}

export interface ManagedDocumentCapabilityDescriptor {
  id: ManagedDocumentCapabilityId;
  label: string;
  tier: "core" | "labs";
  runtime: { distribution: string; sha256: string };
  packages: ManagedPackagePin[];
  models: ManagedModelPin[];
}

const runtimePin = { distribution: MANAGED_CPYTHON_DISTRIBUTION, sha256: MANAGED_CPYTHON_SHA256 } as const;

export const PYTHON_RUNTIME_PACK: ManagedDocumentCapabilityDescriptor = {
  id: "python",
  label: "LA Managed CPython",
  tier: "core",
  runtime: runtimePin,
  packages: [],
  models: [],
};

export const PADDLE_OCR_PACK: ManagedDocumentCapabilityDescriptor = {
  id: "ocr",
  label: "PaddleOCR",
  tier: "core",
  runtime: runtimePin,
  packages: [
    { name: "paddleocr", version: "3.7.0", sha256: "c0f0a81ad4112727f30c6fcf986ac0ef6a120d31ee0991a01fae0357ee32d338" },
    { name: "paddlepaddle", version: "3.3.1", sha256: "55df22b0bc6bfc0b97093a538eda3c774ef27050ad19e0ee5aa17e468b0de714" },
  ],
  models: [
    { name: "PP-OCRv5_mobile_det", revision: "0d63e78e2b680928f6b1747d76a08db6e645efb7", role: "detection" },
    { name: "PP-OCRv6_medium_rec", revision: "e5a92bcbc5cc1b494628e458d267778f0704fd7c", role: "recognition" },
    { name: "PP-LCNet_x0_25_textline_ori", revision: "4c2929737c2f1f426581709b824209c08af063a9", role: "textline-orientation" },
  ],
};

export const MANAGED_PADDLE_OCR_RUNTIME_VERSION = `${MANAGED_CPYTHON_DISTRIBUTION} / PaddleOCR 3.7.0 / PaddlePaddle 3.3.1`;

export const MINERU_PACK: ManagedDocumentCapabilityDescriptor = {
  id: "mineru",
  label: "MinerU",
  tier: "labs",
  runtime: runtimePin,
  packages: [
    { name: "mineru", version: "3.4.4", sha256: "d4d678539782a7683d998e2914a52d96b5720676ce65658b29666b1f4d9dfd13" },
  ],
  models: [],
};

export const OFFICE_PACK: ManagedDocumentCapabilityDescriptor = {
  id: "office",
  label: "Office document tools",
  tier: "labs",
  runtime: runtimePin,
  packages: [
    { name: "openpyxl", version: "3.1.5" },
    { name: "formualizer", version: "0.7.1" },
    { name: "python-pptx", version: "1.0.2" },
    { name: "pypdf", version: "6.14.2" },
    { name: "bun-docx", version: "0.21.0", sha256: "fb3040fc28d317898a18ffa6fb23cdc6f37ac126b734f275220485bfb3e3a57f" },
    { name: "pdf-lib", version: "1.17.1" },
  ],
  models: [],
};

export const MANAGED_DOCUMENT_CAPABILITIES = [PYTHON_RUNTIME_PACK, PADDLE_OCR_PACK, MINERU_PACK, OFFICE_PACK] as const;

export interface ManagedLockedFile {
  path: string;
  sha256: string;
  sizeBytes: number;
  kind?: "file" | "symlink";
  linkTarget?: string;
}

export interface ManagedMineruQualificationV1 {
  schemaVersion: 1;
  status: "passed";
  fixtureSetSha256: string;
  evidenceSha256: string;
  passedAt: string;
  backend: { runtimeSha256: string; packageSha256: string; modelsSha256: string };
  machine: { platform: "darwin"; architecture: "arm64"; memoryGiB: number };
  measurements: { cjkCer: number; readingOrderScore: number; tableCellF1: number; peakMemoryMiB: number; crashFreeRuns: number };
  licenseEvidenceSha256: string;
}

export interface ManagedCapabilityLockV1 {
  schemaVersion: 1;
  capabilityId: ManagedDocumentCapabilityId;
  installedAt: string;
  runtime: { distribution: string; sha256: string };
  packages: ManagedPackagePin[];
  models: Array<ManagedModelPin & { files: ManagedLockedFile[] }>;
  files: ManagedLockedFile[];
  qualification?: ManagedMineruQualificationV1;
}

export interface ManagedDocumentCapabilityStatus {
  id: ManagedDocumentCapabilityId;
  label: string;
  tier: "core" | "labs";
  state: "missing" | "corrupt" | "unqualified" | "ready" | "unsupported";
  path: string;
  message?: string;
  lock?: ManagedCapabilityLockV1;
}

export type ManagedDocumentCapabilityStatuses = Record<ManagedDocumentCapabilityId, ManagedDocumentCapabilityStatus>;

export function managedDocumentCapabilityPath(workspaceRoot: string, id: ManagedDocumentCapabilityId): string {
  return join(workspaceRoot, "data", "assistant", "capabilities", "documents", id);
}

export function managedPythonExecutable(workspaceRoot: string): string {
  return join(managedDocumentCapabilityPath(workspaceRoot, "python"), "runtime", "python", "bin", "python3.11");
}

export function managedDocumentCapabilityPythonExecutable(workspaceRoot: string, id: Exclude<ManagedDocumentCapabilityId, "python">): string {
  return join(managedDocumentCapabilityPath(workspaceRoot, id), "venv", "bin", "python3.11");
}

const SHA256 = /^[a-f0-9]{64}$/u;

function qualificationRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function qualificationTimestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Returns a reason instead of trusting a self-declared `passed` status. */
export function validateMineruQualification(value: unknown): string | undefined {
  const qualification = qualificationRecord(value);
  if (!qualification) return "MinerU qualification record is missing or invalid.";
  const expected = ["schemaVersion", "status", "fixtureSetSha256", "evidenceSha256", "passedAt", "backend", "machine", "measurements", "licenseEvidenceSha256"];
  const unknown = Object.keys(qualification).find((key) => !expected.includes(key));
  if (unknown) return `MinerU qualification has unknown field ${unknown}.`;
  if (expected.some((key) => !(key in qualification))) return "MinerU qualification is missing required fields.";
  if (qualification.schemaVersion !== 1 || qualification.status !== "passed") return "MinerU qualification has an unsupported schema or status.";
  if (![qualification.fixtureSetSha256, qualification.evidenceSha256, qualification.licenseEvidenceSha256].every((digest) => typeof digest === "string" && SHA256.test(digest))) return "MinerU qualification evidence digests must be lowercase SHA-256 values.";
  if (!qualificationTimestamp(qualification.passedAt)) return "MinerU qualification passedAt must be a canonical ISO timestamp.";
  const backend = qualificationRecord(qualification.backend);
  const expectedBackend = ["runtimeSha256", "packageSha256", "modelsSha256"];
  if (!backend || Object.keys(backend).some((key) => !expectedBackend.includes(key)) || expectedBackend.some((key) => !(key in backend))) return "MinerU qualification backend record is invalid.";
  if (backend.runtimeSha256 !== MINERU_PACK.runtime.sha256) return "MinerU qualification runtime digest does not match the pinned runtime.";
  if (backend.packageSha256 !== MINERU_PACK.packages[0]?.sha256) return "MinerU qualification package digest does not match the pinned package.";
  if (typeof backend.modelsSha256 !== "string" || !SHA256.test(backend.modelsSha256)) return "MinerU qualification model digest is invalid.";
  const machine = qualificationRecord(qualification.machine);
  if (!machine || Object.keys(machine).some((key) => !["platform", "architecture", "memoryGiB"].includes(key)) || machine.platform !== "darwin" || machine.architecture !== "arm64" || !Number.isSafeInteger(machine.memoryGiB) || Number(machine.memoryGiB) < 8) return "MinerU qualification hardware record is invalid.";
  const measurements = qualificationRecord(qualification.measurements);
  const expectedMeasurements = ["cjkCer", "readingOrderScore", "tableCellF1", "peakMemoryMiB", "crashFreeRuns"];
  if (!measurements || Object.keys(measurements).some((key) => !expectedMeasurements.includes(key)) || expectedMeasurements.some((key) => !(key in measurements))) return "MinerU qualification measurement record is invalid.";
  if (typeof measurements.cjkCer !== "number" || measurements.cjkCer < 0 || measurements.cjkCer > 1 || typeof measurements.readingOrderScore !== "number" || measurements.readingOrderScore < 0 || measurements.readingOrderScore > 1 || typeof measurements.tableCellF1 !== "number" || measurements.tableCellF1 < 0 || measurements.tableCellF1 > 1 || !Number.isSafeInteger(measurements.peakMemoryMiB) || Number(measurements.peakMemoryMiB) < 1 || !Number.isSafeInteger(measurements.crashFreeRuns) || Number(measurements.crashFreeRuns) < 1) return "MinerU qualification metrics or crash record is invalid.";
  return undefined;
}

function stablePins(pins: ManagedPackagePin[]): string[] {
  return pins.map((pin) => `${pin.name}@${pin.version}:${pin.sha256 ?? "lock"}`).sort();
}

function stableModels(models: ManagedModelPin[]): string[] {
  return models.map((model) => `${model.name}@${model.revision}`).sort();
}

function safeRelativePath(value: string): boolean {
  if (!value || isAbsolute(value) || value.includes("\0")) return false;
  const normalized = relative(".", resolve(".", value));
  return normalized !== ".." && !normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

async function sha256File(path: string): Promise<{ sha256: string; sizeBytes: number }> {
  const value = await readFile(path);
  return { sha256: createHash("sha256").update(value).digest("hex"), sizeBytes: value.byteLength };
}

async function listCapabilityFiles(root: string, directory = root): Promise<string[]> {
  const rows: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isDirectory()) rows.push(...await listCapabilityFiles(root, path));
    else if ((info.isFile() || info.isSymbolicLink()) && relative(root, path) !== "capability-lock.json") rows.push(relative(root, path));
    else if (!info.isFile()) throw new Error(`Managed capability contains an unsupported entry: ${relative(root, path)}`);
  }
  return rows;
}

async function inspectCapability(workspaceRoot: string, descriptor: ManagedDocumentCapabilityDescriptor): Promise<ManagedDocumentCapabilityStatus> {
  const path = managedDocumentCapabilityPath(workspaceRoot, descriptor.id);
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    return { id: descriptor.id, label: descriptor.label, tier: descriptor.tier, state: "unsupported", path, message: "This managed document runtime is pinned for Apple Silicon macOS." };
  }
  let lock: ManagedCapabilityLockV1;
  try {
    lock = JSON.parse(await readFile(join(path, "capability-lock.json"), "utf8")) as ManagedCapabilityLockV1;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { id: descriptor.id, label: descriptor.label, tier: descriptor.tier, state: "missing", path, message: `${descriptor.label} is not installed in the LA managed capability directory.` };
    }
    return { id: descriptor.id, label: descriptor.label, tier: descriptor.tier, state: "corrupt", path, message: error instanceof Error ? error.message : String(error) };
  }
  const corrupt = (message: string): ManagedDocumentCapabilityStatus => ({ id: descriptor.id, label: descriptor.label, tier: descriptor.tier, state: "corrupt", path, message, lock });
  if (lock.schemaVersion !== 1 || lock.capabilityId !== descriptor.id) return corrupt("Capability lock identity is invalid.");
  if (lock.runtime.distribution !== descriptor.runtime.distribution || lock.runtime.sha256 !== descriptor.runtime.sha256) {
    return corrupt("Capability lock does not match LA's pinned CPython runtime.");
  }
  const packages = stablePins(lock.packages);
  for (const required of descriptor.packages) {
    const expected = `${required.name}@${required.version}:${required.sha256 ?? "lock"}`;
    if (required.sha256) {
      if (!packages.includes(expected)) return corrupt(`Capability lock does not contain exact package ${required.name}@${required.version} with its approved SHA-256.`);
    } else if (!lock.packages.some((entry) => entry.name === required.name && entry.version === required.version && /^[a-f0-9]{64}$/.test(entry.sha256 ?? ""))) {
      return corrupt(`Capability lock does not contain an exact wheel hash for ${required.name}@${required.version}.`);
    }
  }
  const models = stableModels(lock.models);
  for (const required of descriptor.models) {
    if (!models.includes(`${required.name}@${required.revision}`)) return corrupt(`Capability lock does not contain model ${required.name}@${required.revision}.`);
    if (!lock.models.find((model) => model.name === required.name)?.files.length) return corrupt(`Model ${required.name} has no locked files.`);
  }
  try {
    const actualPaths = (await listCapabilityFiles(path)).sort();
    const lockedPaths = lock.files.map((file) => file.path).sort();
    if (new Set(lockedPaths).size !== lockedPaths.length) return corrupt("Capability lock contains duplicate file entries.");
    if (actualPaths.length !== lockedPaths.length || actualPaths.some((entry, index) => entry !== lockedPaths[index])) {
      return corrupt("Managed capability files do not exactly match the capability lock closure.");
    }
    for (const file of lock.files) {
      if (!safeRelativePath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
        return corrupt(`Capability lock contains an invalid file entry: ${file.path}`);
      }
      const target = join(path, file.path);
      const info = await lstat(target);
      if ((file.kind ?? "file") === "symlink") {
        if (!info.isSymbolicLink() || typeof file.linkTarget !== "string") return corrupt(`Managed capability link is invalid: ${file.path}`);
        const linkTarget = await readlink(target);
        const digest = createHash("sha256").update(linkTarget).digest("hex");
        if (linkTarget !== file.linkTarget || digest !== file.sha256 || Buffer.byteLength(linkTarget) !== file.sizeBytes) {
          return corrupt(`SHA-256, target, or size mismatch for managed capability link ${file.path}.`);
        }
        const resolvedTarget = await realpath(target);
        const documentRoot = join(workspaceRoot, "data", "assistant", "capabilities", "documents");
        const targetRelative = relative(documentRoot, resolvedTarget);
        if (targetRelative === ".." || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
          return corrupt(`Managed capability link escapes the managed document runtime: ${file.path}`);
        }
      } else {
        if (!info.isFile() || info.isSymbolicLink()) return corrupt(`Managed capability file is not a regular file: ${file.path}`);
        const actual = await sha256File(target);
        if (actual.sha256 !== file.sha256 || actual.sizeBytes !== file.sizeBytes) return corrupt(`SHA-256 or size mismatch for managed capability file ${file.path}.`);
      }
    }
  } catch (error) {
    return corrupt(error instanceof Error ? error.message : String(error));
  }
  const requiredPaths = descriptor.id === "python"
    ? ["runtime/python/bin/python3.11"]
    : descriptor.id === "ocr"
      ? [
          "venv/bin/python3.11",
          "worker/ocr_worker.py",
          ...descriptor.models.flatMap((model) => model.name === "PP-OCRv6_medium_rec"
            ? [`models/${model.name}/inference.json`, `models/${model.name}/inference.pdiparams`, `models/${model.name}/inference.yml`]
            : [`models/${model.name}/config.json`, `models/${model.name}/inference.json`, `models/${model.name}/inference.pdiparams`, `models/${model.name}/inference.yml`]),
        ]
      : descriptor.id === "office"
        ? ["venv/bin/python3.11", "bin/docx", "node/node_modules/pdf-lib/package.json", "worker/office_worker.py", "worker/office_node_worker.mjs", "worker/office_qualification_worker.py"]
        : ["venv/bin/python3.11", "venv/bin/mineru", "worker/mineru_worker.py"];
  for (const requiredPath of requiredPaths) {
    if (!lock.files.some((file) => file.path === requiredPath)) return corrupt(`Capability lock is missing executable or runtime file ${requiredPath}.`);
  }
  const qualificationError = descriptor.id === "mineru" ? validateMineruQualification(lock.qualification) : undefined;
  if (qualificationError) {
    return {
      id: descriptor.id,
      label: descriptor.label,
      tier: descriptor.tier,
      state: "unqualified",
      path,
      message: qualificationError,
      lock,
    };
  }
  return { id: descriptor.id, label: descriptor.label, tier: descriptor.tier, state: "ready", path, lock };
}

export async function inspectManagedDocumentCapabilities(workspaceRoot: string): Promise<ManagedDocumentCapabilityStatuses> {
  const rows = await Promise.all(MANAGED_DOCUMENT_CAPABILITIES.map((descriptor) => inspectCapability(workspaceRoot, descriptor)));
  return Object.fromEntries(rows.map((row) => [row.id, row])) as ManagedDocumentCapabilityStatuses;
}

export interface RunManagedJsonlWorkerOptions {
  executable: string;
  workerPath: string;
  request: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

const MANAGED_WORKER_ENVIRONMENT_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "HF_HUB_OFFLINE",
  "TRANSFORMERS_OFFLINE",
  "PIP_NO_INDEX",
  "NO_PROXY",
  "no_proxy",
] as const;

function managedWorkerEnvironment(overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  };
  for (const key of MANAGED_WORKER_ENVIRONMENT_KEYS) {
    const value = overrides?.[key] ?? process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function runManagedJsonlWorker(options: RunManagedJsonlWorkerOptions): Promise<Record<string, unknown>[]> {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = execFile(
      options.executable,
      [options.workerPath],
      {
        env: managedWorkerEnvironment(options.env),
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: options.maxBufferBytes ?? 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectWorker(new Error(`Managed document worker failed: ${error.message}${stderr.trim() ? `\n${stderr.trim()}` : ""}`));
          return;
        }
        try {
          const rows = stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
            const value = JSON.parse(line) as unknown;
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker response line must be a JSON object.");
            return value as Record<string, unknown>;
          });
          resolveWorker(rows);
        } catch (cause) {
          rejectWorker(new Error(`Managed document worker returned invalid JSONL: ${cause instanceof Error ? cause.message : String(cause)}`));
        }
      },
    );
    child.stdin?.end(`${JSON.stringify(options.request)}\n`, "utf8");
  });
}

export type EvidencePoint = [number, number];

export interface DocumentEvidenceBlockV1 {
  polygon: EvidencePoint[];
  bbox: { x: number; y: number; width: number; height: number };
  text: string;
  confidence: number;
  orientation: number;
}

export interface DocumentEvidenceV1 {
  schemaVersion: 1;
  source: { path: string; sha256: string; mimeType: string };
  extraction: {
    route: "text-layer" | "paddleocr" | "mineru";
    runtimeVersion: string;
    modelVersions: Record<string, string>;
    createdAt: string;
  };
  pages: Array<{ page: number; width: number; height: number; orientation: number; blocks: DocumentEvidenceBlockV1[] }>;
  overlay: { pages: Array<{ page: number; width: number; height: number; polygons: Array<{ polygon: EvidencePoint[]; confidence: number; text: string }> }> };
}

function mimeType(path: string): string {
  switch (extname(path).toLocaleLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".tif":
    case ".tiff": return "image/tiff";
    case ".pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

function bbox(polygon: EvidencePoint[]): { x: number; y: number; width: number; height: number } {
  if (!polygon.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export async function buildDocumentEvidence(input: {
  sourcePath: string;
  route: DocumentEvidenceV1["extraction"]["route"];
  runtimeVersion: string;
  modelVersions: Record<string, string>;
  pages: Array<{ page: number; width: number; height: number; orientation: number; blocks: Array<{ polygon: EvidencePoint[]; text: string; confidence: number; orientation: number }> }>;
}): Promise<DocumentEvidenceV1> {
  const source = await sha256File(input.sourcePath);
  const pages = input.pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => ({
      polygon: block.polygon.map(([x, y]) => [Number(x), Number(y)] as EvidencePoint),
      bbox: bbox(block.polygon),
      text: block.text,
      confidence: Number.isFinite(block.confidence) ? Math.max(0, Math.min(1, block.confidence)) : 0,
      orientation: Number.isFinite(block.orientation) ? block.orientation : page.orientation,
    })),
  }));
  return {
    schemaVersion: 1,
    source: { path: input.sourcePath, sha256: source.sha256, mimeType: mimeType(input.sourcePath) },
    extraction: { route: input.route, runtimeVersion: input.runtimeVersion, modelVersions: { ...input.modelVersions }, createdAt: new Date().toISOString() },
    pages,
    overlay: {
      pages: pages.map((page) => ({
        page: page.page,
        width: page.width,
        height: page.height,
        polygons: page.blocks.map((block) => ({ polygon: block.polygon, confidence: block.confidence, text: block.text })),
      })),
    },
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite.`);
  return parsed;
}

function evidencePages(value: unknown): Array<{
  page: number;
  width: number;
  height: number;
  orientation: number;
  blocks: Array<{ polygon: EvidencePoint[]; text: string; confidence: number; orientation: number }>;
}> {
  if (!Array.isArray(value)) throw new Error("OCR worker pages must be an array.");
  return value.map((pageValue, pageIndex) => {
    const page = record(pageValue, `pages[${pageIndex}]`);
    if (!Array.isArray(page.blocks)) throw new Error(`pages[${pageIndex}].blocks must be an array.`);
    return {
      page: finite(page.page, `pages[${pageIndex}].page`),
      width: finite(page.width, `pages[${pageIndex}].width`),
      height: finite(page.height, `pages[${pageIndex}].height`),
      orientation: finite(page.orientation, `pages[${pageIndex}].orientation`),
      blocks: page.blocks.map((blockValue, blockIndex) => {
        const block = record(blockValue, `pages[${pageIndex}].blocks[${blockIndex}]`);
        if (!Array.isArray(block.polygon)) throw new Error(`pages[${pageIndex}].blocks[${blockIndex}].polygon must be an array.`);
        const polygon = block.polygon.map((pointValue, pointIndex) => {
          if (!Array.isArray(pointValue) || pointValue.length < 2) throw new Error(`OCR polygon point ${pointIndex} is invalid.`);
          return [finite(pointValue[0], "polygon.x"), finite(pointValue[1], "polygon.y")] as EvidencePoint;
        });
        return {
          polygon,
          text: typeof block.text === "string" ? block.text : String(block.text ?? ""),
          confidence: finite(block.confidence, "block.confidence"),
          orientation: finite(block.orientation, "block.orientation"),
        };
      }),
    };
  });
}

export async function extractPaddleOcrEvidence(
  workspaceRoot: string,
  sourcePath: string,
  options: {
    useOrientation?: boolean;
    runWorker?: typeof runManagedJsonlWorker;
  } = {},
): Promise<DocumentEvidenceV1> {
  const statuses = await inspectManagedDocumentCapabilities(workspaceRoot);
  if (statuses.python.state !== "ready") throw new Error(statuses.python.message ?? `Managed Python is ${statuses.python.state}.`);
  if (statuses.ocr.state !== "ready") throw new Error(statuses.ocr.message ?? `PaddleOCR is ${statuses.ocr.state}.`);
  const canonicalSource = await realpath(sourcePath);
  const packPath = managedDocumentCapabilityPath(workspaceRoot, "ocr");
  const rows = await (options.runWorker ?? runManagedJsonlWorker)({
    executable: managedDocumentCapabilityPythonExecutable(workspaceRoot, "ocr"),
    workerPath: join(packPath, "worker", "ocr_worker.py"),
    env: {
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      PIP_NO_INDEX: "1",
      NO_PROXY: "*",
      no_proxy: "*",
    },
    request: {
      sourcePath: canonicalSource,
      modelRoot: join(packPath, "models"),
      useOrientation: options.useOrientation === true,
    },
  });
  const response = record(rows.at(-1), "OCR worker response");
  if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error : "PaddleOCR worker failed without an error message.");
  return buildDocumentEvidence({
    sourcePath: canonicalSource,
    route: "paddleocr",
    runtimeVersion: MANAGED_PADDLE_OCR_RUNTIME_VERSION,
    modelVersions: Object.fromEntries(PADDLE_OCR_PACK.models.map((model) => [model.role ?? model.name, `${model.name}@${model.revision}`])),
    pages: evidencePages(response.pages),
  });
}

export interface ManagedOfficeOperationResult {
  ok: true;
  sourcePath?: string;
  sourcePaths?: string[];
  sourceSha256?: string;
  sourceDigests?: Array<{ path: string; sha256: string }>;
  outputPath?: string;
  outputSha256?: string;
  result?: unknown;
  diff?: unknown;
  validation?: unknown;
}

export async function runManagedOfficeOperation(
  workspaceRoot: string,
  request: {
    sourcePath?: string;
    sourcePaths?: string[];
    operation?: "inspect" | "replace" | "comment" | "track_changes" | "create_docx" | "create_pptx" | "pdf_annotate" | "pdf_merge" | "pdf_extract_pages" | "pdf_rotate" | "pdf_watermark" | "pdf_fill_form";
    outputPath?: string;
    replacements?: unknown[];
    locator?: string;
    text?: string;
    enabled?: boolean;
    pages?: number[];
    angle?: number;
    fontSize?: number;
    opacity?: number;
    rotation?: number;
    fields?: unknown[];
    rect?: number[];
    slides?: unknown[];
  },
  options: { runWorker?: typeof runManagedJsonlWorker } = {},
): Promise<ManagedOfficeOperationResult> {
  const statuses = await inspectManagedDocumentCapabilities(workspaceRoot);
  if (statuses.python.state !== "ready") throw new Error(statuses.python.message ?? `Managed Python is ${statuses.python.state}.`);
  if (statuses.office.state !== "ready") throw new Error(statuses.office.message ?? `Office pack is ${statuses.office.state}.`);
  const operation = request.operation ?? "inspect";
  const creation = operation === "create_docx" || operation === "create_pptx";
  const requestedSources = request.sourcePaths?.length ? request.sourcePaths : request.sourcePath ? [request.sourcePath] : [];
  if (!creation && !requestedSources.length) throw new Error(`${operation} requires at least one source document.`);
  const canonicalSources = await Promise.all(requestedSources.map((path) => realpath(path)));
  const sourceDigests = await Promise.all(canonicalSources.map(async (path) => ({ path, ...(await sha256File(path)) })));
  const packPath = managedDocumentCapabilityPath(workspaceRoot, "office");
  const pdfOperation = operation.startsWith("pdf_") && operation !== "pdf_annotate";
  const rows = await (options.runWorker ?? runManagedJsonlWorker)({
    executable: pdfOperation ? process.execPath : managedDocumentCapabilityPythonExecutable(workspaceRoot, "office"),
    workerPath: join(packPath, "worker", pdfOperation ? "office_node_worker.mjs" : "office_worker.py"),
    env: pdfOperation ? { ELECTRON_RUN_AS_NODE: "1" } : undefined,
    request: pdfOperation
      ? {
          ...request,
          operation: operation.slice(4),
          sourcePath: canonicalSources.length === 1 ? canonicalSources[0] : undefined,
          sourcePaths: canonicalSources,
          nodeModulesRoot: join(packPath, "node", "node_modules"),
        }
      : {
          ...request,
          sourcePath: canonicalSources[0],
          docxExecutable: join(packPath, "bin", "docx"),
        },
  });
  const response = record(rows.at(-1), "Office worker response");
  if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error : "Office worker failed without an error message.");
  for (const before of sourceDigests) {
    const after = await sha256File(before.path);
    if (after.sha256 !== before.sha256 || after.sizeBytes !== before.sizeBytes) throw new Error(`Managed Office operation modified its source file: ${before.path}`);
  }
  return response as unknown as ManagedOfficeOperationResult;
}

export interface ManagedMineruExtractionResult {
  ok: true;
  sourcePath: string;
  sourceSha256: string;
  outputDirectory: string;
  files: ManagedLockedFile[];
  stdout: string;
  stderr: string;
}

export async function runManagedMineruExtraction(
  workspaceRoot: string,
  request: { sourcePath: string; outputDirectory: string; timeoutSeconds?: number },
  options: { runWorker?: typeof runManagedJsonlWorker } = {},
): Promise<ManagedMineruExtractionResult> {
  const statuses = await inspectManagedDocumentCapabilities(workspaceRoot);
  if (statuses.python.state !== "ready") throw new Error(statuses.python.message ?? `Managed Python is ${statuses.python.state}.`);
  if (statuses.mineru.state !== "ready") throw new Error(statuses.mineru.message ?? `MinerU is ${statuses.mineru.state}.`);
  const canonicalSource = await realpath(request.sourcePath);
  const before = await sha256File(canonicalSource);
  const packPath = managedDocumentCapabilityPath(workspaceRoot, "mineru");
  const rows = await (options.runWorker ?? runManagedJsonlWorker)({
    executable: managedDocumentCapabilityPythonExecutable(workspaceRoot, "mineru"),
    workerPath: join(packPath, "worker", "mineru_worker.py"),
    env: { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PIP_NO_INDEX: "1" },
    timeoutMs: Math.max(30_000, Math.min(30 * 60_000, (request.timeoutSeconds ?? 900) * 1_000 + 5_000)),
    request: { ...request, sourcePath: canonicalSource },
  });
  const response = record(rows.at(-1), "MinerU worker response");
  if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error : "MinerU worker failed without an error message.");
  const after = await sha256File(canonicalSource);
  if (after.sha256 !== before.sha256 || after.sizeBytes !== before.sizeBytes) throw new Error("MinerU modified its source document.");
  return response as unknown as ManagedMineruExtractionResult;
}
