import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type NativeCapabilityPatchId = "pi-ask-headless-v1" | "pi-web-access-headless-v1";

interface NativeCapabilityPatchSpec {
  id: NativeCapabilityPatchId;
  targets: ReadonlyArray<{
    targetPath: string;
    originalIntegrity: string | null;
    patchedIntegrity: string;
    overlayPath: string;
  }>;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const NATIVE_CAPABILITY_PATCHES: Readonly<Record<NativeCapabilityPatchId, NativeCapabilityPatchSpec>> = {
  "pi-ask-headless-v1": {
    id: "pi-ask-headless-v1",
    targets: [
      {
        targetPath: "src/index.ts",
        originalIntegrity: "sha256-4X2PrY8ISyxiDWri2WDq58fOLaRzbp4fD8aSsEuUUCw=",
        patchedIntegrity: "sha256-pfufXH3zjY1VeAZdr6mhgxWHc+cR59NpCeBCEioWZEg=",
        overlayPath: join(repoRoot, "patches", "pi-ask-headless-v1", "src", "index.ts"),
      },
      {
        targetPath: "src/ask-tool.ts",
        originalIntegrity: "sha256-ar8lzg9hL5bLuF7csOtKMGTW9KfYle3s8ovdAwmwe8o=",
        patchedIntegrity: "sha256-DEOx8wNkrCNSFa1m0DRl8uHm9MpdCXmo9q98C6xyJrU=",
        overlayPath: join(repoRoot, "patches", "pi-ask-headless-v1", "src", "ask-tool.ts"),
      },
    ],
  },
  "pi-web-access-headless-v1": {
    id: "pi-web-access-headless-v1",
    targets: [{
      targetPath: "la-headless.ts",
      originalIntegrity: null,
      patchedIntegrity: "sha256-qptKoKOkfvCdXIcnayPGbCGM8AttA8fJE7JlcF8u460=",
      overlayPath: join(repoRoot, "patches", "pi-web-access-headless-v1", "la-headless.ts"),
    }],
  },
};

function sha256(bytes: Buffer): string {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

function bundleIntegrity(spec: NativeCapabilityPatchSpec): string {
  return sha256(Buffer.from(JSON.stringify(spec.targets.map(({ targetPath, patchedIntegrity }) => ({
    targetPath,
    patchedIntegrity,
  })))));
}

export const NATIVE_CAPABILITY_PATCH_INTEGRITIES: Readonly<Record<NativeCapabilityPatchId, string>> = Object.freeze(
  Object.fromEntries(
    Object.values(NATIVE_CAPABILITY_PATCHES).map((spec) => [spec.id, bundleIntegrity(spec)]),
  ) as Record<NativeCapabilityPatchId, string>,
);

export async function verifyNativeCapabilityPatch(
  id: NativeCapabilityPatchId,
  packageRoot: string,
): Promise<{ integrity: string; targetPaths: string[] }> {
  const spec = NATIVE_CAPABILITY_PATCHES[id];
  for (const target of spec.targets) {
    const bytes = await readFile(resolve(packageRoot, target.targetPath));
    if (sha256(bytes) !== target.patchedIntegrity) {
      throw new Error(`Native capability patch target failed integrity validation: ${id}:${target.targetPath}`);
    }
  }
  return {
    integrity: bundleIntegrity(spec),
    targetPaths: spec.targets.map(({ targetPath }) => targetPath),
  };
}

export async function applyNativeCapabilityPatch(
  id: NativeCapabilityPatchId,
  packageRoot: string,
): Promise<{ changed: boolean; integrity: string; targetPaths: string[] }> {
  const spec = NATIVE_CAPABILITY_PATCHES[id];
  const pending: Array<{ overlay: Buffer; targetPath: string; expectedIntegrity: string }> = [];
  for (const target of spec.targets) {
    const targetPath = resolve(packageRoot, target.targetPath);
    const overlay = await readFile(target.overlayPath);
    if (sha256(overlay) !== target.patchedIntegrity) {
      throw new Error(`Tracked native capability patch payload failed integrity validation: ${id}:${target.targetPath}`);
    }
    let currentIntegrity: string | null;
    try {
      currentIntegrity = sha256(await readFile(targetPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      currentIntegrity = null;
    }
    if (currentIntegrity === target.patchedIntegrity) continue;
    if (currentIntegrity !== target.originalIntegrity) {
      throw new Error(`Native capability patch base is not the approved upstream file: ${id}:${target.targetPath}`);
    }
    pending.push({ overlay, targetPath, expectedIntegrity: target.patchedIntegrity });
  }

  for (const [index, target] of pending.entries()) {
    const temporaryPath = join(dirname(target.targetPath), `.${id}.${process.pid}.${index}.tmp`);
    await mkdir(dirname(target.targetPath), { recursive: true });
    try {
      await writeFile(temporaryPath, target.overlay, { flag: "wx", mode: 0o644 });
      await rename(temporaryPath, target.targetPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    if (sha256(await readFile(target.targetPath)) !== target.expectedIntegrity) {
      throw new Error(`Native capability patch write failed integrity validation: ${id}`);
    }
  }
  const verified = await verifyNativeCapabilityPatch(id, packageRoot);
  return { changed: pending.length > 0, ...verified };
}
