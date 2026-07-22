import type { IncomingMessage, ServerResponse } from "node:http";
import type { MechanicalTextQaOptions, QualityChecklistEntry } from "@linguist-agent/cat-data";

export interface QualityChecklistRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  readQualityChecklist: (workspaceRoot: string, projectId: string) => Promise<unknown>;
  parseQualityChecklistEntries: (value: unknown) => QualityChecklistEntry[];
  parseMechanicalTextQaOptions: (value: unknown) => MechanicalTextQaOptions | undefined;
  writeQualityChecklist: (workspaceRoot: string, projectId: string, entries: QualityChecklistEntry[], mechanicalOptions?: MechanicalTextQaOptions) => Promise<unknown>;
}

export async function handleQualityChecklistRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  projectId: string,
  deps: QualityChecklistRouteDeps,
): Promise<boolean> {
  if (parts[3] !== "quality-checklist" || parts.length !== 4) return false;
  if (req.method === "GET") {
    deps.json(res, 200, await deps.readQualityChecklist(deps.repoRoot, projectId));
    return true;
  }
  if (req.method === "PUT") {
    try {
      const body = await deps.readBody(req) as Record<string, unknown>;
      const entries = deps.parseQualityChecklistEntries(body.entries);
      const mechanicalOptions = deps.parseMechanicalTextQaOptions(body.mechanicalOptions);
      deps.json(res, 200, await deps.writeQualityChecklist(deps.repoRoot, projectId, entries, mechanicalOptions));
    } catch (error) {
      deps.json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }
  return false;
}
