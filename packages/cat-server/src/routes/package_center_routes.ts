import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute } from "node:path";
import { packageArchiveApplicationPort, PackageArchiveApplicationError } from "../application/package_archive_application_port.js";
import {
  activateLapkg,
  LapkgActivationError,
  listActivatedLapkgPackages,
  type ActivateLapkgInput,
  type ActivatedLapkgResult,
  type LapkgRegistryV2,
} from "../lapkg_activation.js";
import { inventoryLegacyManagedPackages, type LegacyPackageInventoryReportV1 } from "../legacy_package_inventory.js";
import { LapkgFormatError } from "../lapkg_format.js";
import {
  LapkgPreviewError,
  previewLapkgInstall,
  type LapkgInstallPreviewV1,
  type LapkgPreviewInput,
} from "../lapkg_preview.js";
import { LapkgSignatureError, type LapkgTrustRootV1 } from "../lapkg_signature.js";
import {
  PackageCenterError,
  filterCommunityPackageCatalog,
  getCommunityPackageCatalog,
} from "../package_center.js";
import type { LapkgPackageStorage } from "../lapkg_package_storage.js";

class StablePackageRouteError extends Error {
  constructor(public readonly status: 400 | 409 | 413, public readonly code: string, message: string) {
    super(message);
    this.name = "StablePackageRouteError";
  }
}

export interface PackageCenterRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  acquireCapabilityMutation?: () => (() => void) | undefined;
  invalidateResourceCatalogs?: () => void;
  getCatalog?: typeof getCommunityPackageCatalog;
  listV2?: (repoRoot: string) => Promise<LapkgRegistryV2>;
  inventoryLegacy?: (repoRoot: string) => Promise<LegacyPackageInventoryReportV1>;
  readArchive?: (archivePath: string) => Promise<Buffer>;
  trustRoots?: readonly LapkgTrustRootV1[];
  previewLapkg?: (input: LapkgPreviewInput) => Promise<LapkgInstallPreviewV1>;
  activateLapkg?: (input: ActivateLapkgInput) => Promise<ActivatedLapkgResult>;
  packageStorage?: LapkgPackageStorage;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PackageCenterError(400, "invalid_request", "A JSON object body is required.");
  }
  return value as Record<string, unknown>;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = object(value);
  if (Object.keys(result).some((key) => !keys.includes(key))) {
    throw new PackageCenterError(400, "invalid_request", "The request contains unknown fields.");
  }
  return result;
}

function archivePath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || !value.endsWith(".lapkg") || value.includes("\0")) {
    throw new StablePackageRouteError(400, "invalid_lapkg_path", "archivePath must be an absolute .lapkg file path selected by the user.");
  }
  return value;
}

function finiteInt(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new PackageCenterError(400, "invalid_request", "Pagination values must be non-negative integers.");
  return parsed;
}

function retired(deps: PackageCenterRouteDeps, res: ServerResponse): true {
  deps.json(res, 410, {
    error: {
      code: "legacy_package_install_retired",
      message: "Stable Package Center no longer installs npm or executable legacy packages. Select a signed declarative .lapkg instead.",
    },
  });
  return true;
}

function mapLapkgError(error: unknown): PackageCenterError | StablePackageRouteError | PackageArchiveApplicationError | undefined {
  if (error instanceof PackageCenterError) return error;
  if (error instanceof StablePackageRouteError) return error;
  if (error instanceof PackageArchiveApplicationError) return error;
  if (error instanceof LapkgPreviewError || error instanceof LapkgActivationError || error instanceof LapkgFormatError || error instanceof LapkgSignatureError) {
    const code = "code" in error && typeof error.code === "string" ? error.code.toLowerCase() : "lapkg_rejected";
    const status = code.includes("expired") ? 409 : code.includes("busy") || code.includes("exists") || code.includes("recovery") ? 409 : 400;
    return new StablePackageRouteError(status, code, error.message);
  }
  return undefined;
}

export async function handlePackageCenterRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  parts: string[],
  deps: PackageCenterRouteDeps,
): Promise<boolean> {
  if (parts[0] !== "api" || parts[1] !== "package-center") return false;
  try {
    if (parts[2] === "catalog" && parts.length === 3 && req.method === "GET") {
      const catalog = await (deps.getCatalog ?? getCommunityPackageCatalog)(deps.repoRoot, {
        force: url.searchParams.get("refresh") === "true" || url.searchParams.get("refresh") === "1",
      });
      deps.json(res, 200, {
        ...filterCommunityPackageCatalog(catalog, {
          query: url.searchParams.get("q") ?? undefined,
          cursor: finiteInt(url.searchParams.get("cursor"), 0),
          limit: finiteInt(url.searchParams.get("limit"), 50),
        }),
        installMode: "discovery_only",
      });
      return true;
    }
    if (parts[2] === "installed" && parts.length === 3 && req.method === "GET") {
      const [registry, legacy] = await Promise.all([
        deps.listV2
          ? deps.listV2(deps.repoRoot)
          : listActivatedLapkgPackages(deps.repoRoot, { storage: deps.packageStorage }),
        (deps.inventoryLegacy ?? inventoryLegacyManagedPackages)(deps.repoRoot),
      ]);
      deps.json(res, 200, {
        schemaVersion: 2,
        installMode: "signed_lapkg_only",
        trustedPublisherCount: (deps.trustRoots ?? []).length,
        packages: registry.packages,
        registryRevision: registry.revision,
        legacy: {
          registryStatus: legacy.registryStatus,
          totalRecords: legacy.totalRecords,
          counts: legacy.counts,
          registryIssues: legacy.registryIssues,
          entries: legacy.entries.map((entry) => ({
            packageName: entry.packageName,
            version: entry.version,
            classification: entry.classification,
            reasons: entry.reasons,
            detectedRiskIds: entry.detectedRiskIds,
          })),
        },
      });
      return true;
    }
    if (parts[2] === "install" && (parts.length === 3 || (parts[3] === "preview" && parts.length === 4)) && req.method === "POST") {
      return retired(deps, res);
    }
    if (parts[2] === "lapkg" && parts[3] === "preview" && parts.length === 4 && req.method === "POST") {
      const body = exactObject(await deps.readBody(req), ["archivePath"]);
      const path = archivePath(body.archivePath);
      const bytes = await (deps.readArchive ?? packageArchiveApplicationPort.readLocalArchive)(path);
      const acquiredAt = new Date().toISOString();
      const digest = createHash("sha256").update(bytes).digest("hex");
      const preview = await (deps.previewLapkg ?? previewLapkgInstall)({
        archiveBytes: bytes,
        source: { schemaVersion: 1, kind: "local_file", sourceId: `picker:${digest.slice(0, 24)}`, acquiredAt, expectedArchiveSha256: digest },
        trustRoots: deps.trustRoots ?? [],
      });
      deps.json(res, 200, preview);
      return true;
    }
    if (parts[2] === "lapkg" && parts[3] === "activate" && parts.length === 4 && req.method === "POST") {
      const release = deps.acquireCapabilityMutation?.();
      if (deps.acquireCapabilityMutation && !release) {
        deps.json(res, 409, { error: { code: "package_center_active_run", message: "Finish active Agent Runs before activating a declarative package." } });
        return true;
      }
      try {
        const body = exactObject(await deps.readBody(req), ["archivePath", "expectedPlanHash", "preview"]);
        const path = archivePath(body.archivePath);
        if (typeof body.expectedPlanHash !== "string") throw new PackageCenterError(400, "invalid_request", "expectedPlanHash is required.");
        const bytes = await (deps.readArchive ?? packageArchiveApplicationPort.readLocalArchive)(path);
        const activated = await (deps.activateLapkg ?? activateLapkg)({
          runtimeRoot: deps.repoRoot,
          archiveBytes: bytes,
          preview: body.preview as LapkgInstallPreviewV1,
          expectedPlanHash: body.expectedPlanHash,
          trustRoots: deps.trustRoots ?? [],
          ...(deps.packageStorage && !deps.activateLapkg ? { storage: deps.packageStorage } : {}),
        });
        deps.invalidateResourceCatalogs?.();
        const { contentPath: _privateContentPath, ...record } = activated;
        deps.json(res, 201, { package: record });
      } finally {
        release?.();
      }
      return true;
    }
    deps.json(res, 405, { error: { code: "method_not_allowed", message: "Unsupported Package Center operation." } });
    return true;
  } catch (error) {
    const mapped = mapLapkgError(error);
    if (mapped) {
      deps.json(res, mapped.status, { error: { code: mapped.code, message: mapped.message } });
      return true;
    }
    throw error;
  }
}
