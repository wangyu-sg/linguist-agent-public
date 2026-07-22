import type { IncomingMessage, ServerResponse } from "node:http";
import {
  LA_CORE_PACKAGES,
  PackageCenterError,
  filterCommunityPackageCatalog,
  getCommunityPackageCatalog,
  listManagedPackages,
  previewManagedPackageInstall,
  promoteManagedPackageInstall,
} from "../package_center.js";

export interface PackageCenterRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  acquireCapabilityMutation?: () => (() => void) | undefined;
  invalidateResourceCatalogs?: () => void;
  getCatalog?: typeof getCommunityPackageCatalog;
  listInstalled?: typeof listManagedPackages;
  previewInstall?: typeof previewManagedPackageInstall;
  promoteInstall?: typeof promoteManagedPackageInstall;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PackageCenterError(400, "invalid_request", "A JSON object body is required.");
  }
  return value as Record<string, unknown>;
}

function finiteInt(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new PackageCenterError(400, "invalid_request", "Pagination values must be non-negative integers.");
  return parsed;
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
      deps.json(res, 200, filterCommunityPackageCatalog(catalog, {
        query: url.searchParams.get("q") ?? undefined,
        cursor: finiteInt(url.searchParams.get("cursor"), 0),
        limit: finiteInt(url.searchParams.get("limit"), 50),
      }));
      return true;
    }
    if (parts[2] === "installed" && parts.length === 3 && req.method === "GET") {
      deps.json(res, 200, {
        docs: "https://pi.dev/docs/latest/packages",
        corePolicy: LA_CORE_PACKAGES,
        packages: await (deps.listInstalled ?? listManagedPackages)(deps.repoRoot),
      });
      return true;
    }
    if (parts[2] === "install" && parts[3] === "preview" && parts.length === 4 && req.method === "POST") {
      const body = object(await deps.readBody(req));
      const preview = await (deps.previewInstall ?? previewManagedPackageInstall)(deps.repoRoot, {
        name: body.name,
        version: body.version,
      });
      deps.json(res, 200, preview);
      return true;
    }
    if (parts[2] === "install" && parts.length === 3 && req.method === "POST") {
      const release = deps.acquireCapabilityMutation?.();
      if (deps.acquireCapabilityMutation && !release) {
        deps.json(res, 409, { error: { code: "package_center_active_run", message: "Finish active Agent Runs before promoting a managed package." } });
        return true;
      }
      try {
        const body = object(await deps.readBody(req));
        const installed = await (deps.promoteInstall ?? promoteManagedPackageInstall)(deps.repoRoot, {
          planHash: body.planHash,
          name: body.name,
          version: body.version,
          confirmedVersion: body.confirmedVersion,
          acceptedRiskIds: body.acceptedRiskIds,
        });
        deps.invalidateResourceCatalogs?.();
        deps.json(res, 201, { package: installed });
      } finally {
        release?.();
      }
      return true;
    }
    deps.json(res, 405, { error: { code: "method_not_allowed", message: "Unsupported Package Center operation." } });
    return true;
  } catch (error) {
    if (error instanceof PackageCenterError) {
      deps.json(res, error.status, { error: { code: error.code, message: error.message } });
      return true;
    }
    throw error;
  }
}
