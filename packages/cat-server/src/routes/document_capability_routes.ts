import type { IncomingMessage, ServerResponse } from "node:http";
import {
  TaskWorkspaceConflictError,
  inspectManagedDocumentCapabilities,
  type ManagedDocumentCapabilityStatuses,
} from "@linguist-agent/cat-data";
import { documentEvidenceApplicationPort, type DocumentEvidenceApplicationPort } from "../application/document_evidence_application_port.js";
import {
  ManagedDocumentInstallError,
  installManagedDocumentCapability,
  previewManagedDocumentCapabilityInstall,
  type ManagedDocumentInstallPlan,
} from "../managed_document_installer.js";

export interface DocumentCapabilityRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  inspectCapabilities?: (repoRoot: string) => Promise<ManagedDocumentCapabilityStatuses>;
  documentEvidence?: DocumentEvidenceApplicationPort;
  previewInstall?: (repoRoot: string, id: "python" | "ocr" | "mineru" | "office") => ManagedDocumentInstallPlan;
  installCapability?: (repoRoot: string, input: { capabilityId: "python" | "ocr" | "mineru" | "office"; planHash: string }) => Promise<unknown>;
  acquireCapabilityMutation?: () => (() => void) | undefined;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export async function handleDocumentCapabilityRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  deps: DocumentCapabilityRouteDeps,
): Promise<boolean> {
  if (parts[0] !== "api") return false;
  try {
    if (parts.length === 3 && parts[1] === "capabilities" && parts[2] === "documents") {
      if (req.method !== "GET") {
        deps.json(res, 405, { error: { code: "method_not_allowed", message: "Document capability status is read-only." } });
        return true;
      }
      deps.json(res, 200, await (deps.inspectCapabilities ?? inspectManagedDocumentCapabilities)(deps.repoRoot));
      return true;
    }
    if (parts.length === 5 && parts[1] === "capabilities" && parts[2] === "documents") {
      const id = parts[3];
      if (id !== "python" && id !== "ocr" && id !== "mineru" && id !== "office") throw new Error(`Unknown document capability ${id}.`);
      if (parts[4] === "preview" && req.method === "POST") {
        deps.json(res, 200, (deps.previewInstall ?? previewManagedDocumentCapabilityInstall)(deps.repoRoot, id));
        return true;
      }
      if (parts[4] === "install" && req.method === "POST") {
        const body = object(await deps.readBody(req));
        if (!body) throw new Error("Document capability install body is required.");
        const release = deps.acquireCapabilityMutation?.();
        if (deps.acquireCapabilityMutation && !release) {
          deps.json(res, 409, { error: { code: "document_capability_active_run", message: "Finish active Agent Runs before installing or repairing document capabilities." } });
          return true;
        }
        try {
          deps.json(res, 200, await (deps.installCapability ?? installManagedDocumentCapability)(deps.repoRoot, {
            capabilityId: id,
            planHash: string(body.planHash, "planHash"),
          }));
        } finally {
          release?.();
        }
        return true;
      }
      deps.json(res, 405, { error: { code: "method_not_allowed", message: "Unsupported document capability install operation." } });
      return true;
    }
    if (parts.length === 3 && parts[1] === "documents" && parts[2] === "evidence") {
      if (req.method !== "POST") {
        deps.json(res, 405, { error: { code: "method_not_allowed", message: "Document evidence requires POST." } });
        return true;
      }
      const body = object(await deps.readBody(req));
      if (!body) throw new Error("Document evidence request body is required.");
      deps.json(res, 201, await (deps.documentEvidence ?? documentEvidenceApplicationPort).createEvidence({
        repoRoot: deps.repoRoot,
        taskId: string(body.taskId, "taskId"),
        sourcePath: string(body.sourcePath, "sourcePath"),
        useOrientation: body.useOrientation === true,
      }));
      return true;
    }
    if (parts.length === 4 && parts[1] === "documents" && parts[2] === "evidence" && parts[3] === "corrections") {
      if (req.method !== "POST") {
        deps.json(res, 405, { error: { code: "method_not_allowed", message: "Document correction requires POST." } });
        return true;
      }
      const body = object(await deps.readBody(req));
      if (!body) throw new Error("Document correction body is required.");
      deps.json(res, 201, await (deps.documentEvidence ?? documentEvidenceApplicationPort).correctEvidence({
        repoRoot: deps.repoRoot,
        taskId: string(body.taskId, "taskId"),
        artifactId: string(body.artifactId, "artifactId"),
        blockId: string(body.blockId, "blockId"),
        text: string(body.text, "text"),
      }));
      return true;
    }
  } catch (error) {
    if (error instanceof ManagedDocumentInstallError) {
      deps.json(res, error.code === "plan_hash_mismatch" ? 409 : 400, { error: { code: error.code, message: error.message } });
      return true;
    }
    if (error instanceof TaskWorkspaceConflictError) {
      deps.json(res, 409, { error: { code: "document_evidence_conflict", message: error.message } });
      return true;
    }
    deps.json(res, 400, { error: { code: "document_capability_invalid", message: error instanceof Error ? error.message : String(error) } });
    return true;
  }
  return false;
}
