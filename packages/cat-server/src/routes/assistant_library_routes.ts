import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AssistantMemoryConflictError,
  AssistantMemoryNotFoundError,
  confirmAssistantMemory,
  editAssistantMemory,
  importLibraryDocuments,
  inspectLocalEmbeddingPack,
  installLocalEmbeddingPack,
  listAssistantMemories,
  readLibraryCatalog,
  reindexLibrary,
  removeLibraryDocument,
  revokeAssistantMemory,
  searchLibrary,
  proposeAssistantMemory,
  type AssistantMemoryKind,
  type AssistantMemoryScope,
  type LibraryRetrievalMode,
  type LibraryScope,
  type LocalEmbeddingPackStatus,
} from "@linguist-agent/cat-data";

export interface AssistantLibraryRouteDeps {
  repoRoot: string;
  json: (res: ServerResponse, status: number, data: unknown) => void;
  readBody: (req: IncomingMessage) => Promise<unknown>;
  inspectEmbeddingPack?: (repoRoot: string) => Promise<LocalEmbeddingPackStatus>;
  installEmbeddingPack?: (repoRoot: string) => Promise<LocalEmbeddingPackStatus>;
  acquireCapabilityMutation?: () => (() => void) | undefined;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scopeFrom(value: { scope?: unknown; projectId?: unknown }): LibraryScope {
  if (value.scope === "personal") return { kind: "personal" };
  if (value.scope === "project") {
    const projectId = string(value.projectId);
    if (!projectId) throw new Error("projectId is required for Project Library or memory.");
    return { kind: "project", projectId };
  }
  throw new Error("scope must be personal or project.");
}

function queryScope(url: URL): LibraryScope {
  return scopeFrom({ scope: url.searchParams.get("scope"), projectId: url.searchParams.get("projectId") });
}

function memoryScope(scope: LibraryScope): AssistantMemoryScope {
  return scope;
}

function sourcePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
}

function retrievalMode(value: unknown): LibraryRetrievalMode {
  return value === "lexical" || value === "vector" || value === "hybrid" ? value : "hybrid";
}

function memoryKind(value: unknown): AssistantMemoryKind {
  if (value === "preference" || value === "fact" || value === "guidance") return value;
  throw new Error("Memory kind must be preference, fact, or guidance.");
}

function finiteInt(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function badRequest(deps: AssistantLibraryRouteDeps, res: ServerResponse, error: unknown): true {
  deps.json(res, 400, { error: { code: "assistant_library_invalid", message: error instanceof Error ? error.message : String(error) } });
  return true;
}

export async function handleAssistantLibraryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  parts: string[],
  deps: AssistantLibraryRouteDeps,
): Promise<boolean> {
  if (parts[0] !== "api") return false;

  try {
    if (parts[1] === "library") {
      if (parts.length === 2 && req.method === "GET") {
        deps.json(res, 200, await readLibraryCatalog(deps.repoRoot, queryScope(url)));
        return true;
      }
      if (parts[2] === "search" && parts.length === 3 && req.method === "GET") {
        const scope = queryScope(url);
        const query = string(url.searchParams.get("q"));
        if (!query) throw new Error("q is required for Library search.");
        deps.json(res, 200, await searchLibrary(deps.repoRoot, {
          scope,
          query,
          includePersonal: scope.kind === "project" ? url.searchParams.get("includePersonal") !== "false" : false,
          retrievalMode: retrievalMode(url.searchParams.get("retrievalMode")),
          limit: url.searchParams.has("limit") ? finiteInt(url.searchParams.get("limit"), "limit") : undefined,
        }));
        return true;
      }
      if (parts[2] === "import" && parts.length === 3 && req.method === "POST") {
        const body = object(await deps.readBody(req));
        if (!body) throw new Error("Library import body is required.");
        const paths = sourcePaths(body.sourcePaths);
        if (!paths.length) throw new Error("Choose at least one document to import into Library.");
        const result = await importLibraryDocuments(deps.repoRoot, {
          scope: scopeFrom(body),
          sourcePaths: paths,
          semantic: body.semantic === false ? false : true,
        });
        deps.json(res, 201, result);
        return true;
      }
      if (parts[2] === "reindex" && parts.length === 3 && req.method === "POST") {
        const body = object(await deps.readBody(req));
        if (!body) throw new Error("Library reindex body is required.");
        deps.json(res, 200, await reindexLibrary(deps.repoRoot, {
          scope: scopeFrom(body),
          semantic: body.semantic === false ? false : true,
        }));
        return true;
      }
      if (parts[2] === "documents" && parts.length === 4 && req.method === "DELETE") {
        const body = object(await deps.readBody(req)) ?? {};
        const scope = body.scope ? scopeFrom(body) : queryScope(url);
        deps.json(res, 200, await removeLibraryDocument(deps.repoRoot, { scope, documentId: decodeURIComponent(parts[3]!) }));
        return true;
      }
      deps.json(res, 405, { error: { code: "method_not_allowed", message: "Unsupported Library operation." } });
      return true;
    }

    if (parts[1] === "capabilities" && parts[2] === "embeddings" && parts[3] === "multilingual-e5") {
      if (parts.length === 4 && req.method === "GET") {
        deps.json(res, 200, await (deps.inspectEmbeddingPack ?? inspectLocalEmbeddingPack)(deps.repoRoot));
        return true;
      }
      if (parts.length === 5 && parts[4] === "install" && req.method === "POST") {
        const release = deps.acquireCapabilityMutation?.();
        if (deps.acquireCapabilityMutation && !release) {
          deps.json(res, 409, { error: { code: "capability_mutation_active_run", message: "Finish active Agent Runs before installing or repairing the embedding pack." } });
          return true;
        }
        try {
          deps.json(res, 200, await (deps.installEmbeddingPack ?? installLocalEmbeddingPack)(deps.repoRoot));
        } finally {
          release?.();
        }
        return true;
      }
      deps.json(res, 405, { error: { code: "method_not_allowed", message: "Unsupported embedding capability operation." } });
      return true;
    }

    if (parts[1] === "memories") {
      if (parts.length === 2 && req.method === "GET") {
        const scope = memoryScope(queryScope(url));
        deps.json(res, 200, { scope, memories: await listAssistantMemories(deps.repoRoot, scope) });
        return true;
      }
      if (parts.length === 2 && req.method === "POST") {
        const body = object(await deps.readBody(req));
        const source = object(body?.source);
        if (!body || !source) throw new Error("Memory proposal requires scope, kind, text, and source.");
        const taskId = string(source.taskId);
        const text = string(body.text);
        if (!taskId || !text) throw new Error("Memory proposal requires text and source.taskId.");
        const memory = await proposeAssistantMemory(deps.repoRoot, {
          scope: memoryScope(scopeFrom(body)),
          kind: memoryKind(body.kind),
          text,
          source: {
            taskId,
            activityId: string(source.activityId),
            artifactId: string(source.artifactId),
          },
        });
        deps.json(res, 201, { memory });
        return true;
      }
      const id = parts.length >= 3 ? decodeURIComponent(parts[2]!) : undefined;
      if (id && parts.length === 4 && parts[3] === "confirm" && req.method === "POST") {
        const body = object(await deps.readBody(req));
        if (!body) throw new Error("Memory confirmation requires scope.");
        deps.json(res, 200, { memory: await confirmAssistantMemory(deps.repoRoot, { scope: memoryScope(scopeFrom(body)), id, actor: "user" }) });
        return true;
      }
      if (id && parts.length === 3 && req.method === "PATCH") {
        const body = object(await deps.readBody(req));
        if (!body) throw new Error("Memory edit requires scope and expectedRevision.");
        deps.json(res, 200, { memory: await editAssistantMemory(deps.repoRoot, {
          scope: memoryScope(scopeFrom(body)),
          id,
          expectedRevision: finiteInt(body.expectedRevision, "expectedRevision"),
          text: body.text === undefined ? undefined : string(body.text),
          kind: body.kind === undefined ? undefined : memoryKind(body.kind),
          actor: "user",
        }) });
        return true;
      }
      if (id && parts.length === 3 && req.method === "DELETE") {
        const body = object(await deps.readBody(req));
        const scope = body?.scope ? scopeFrom(body) : queryScope(url);
        deps.json(res, 200, { memory: await revokeAssistantMemory(deps.repoRoot, { scope: memoryScope(scope), id, actor: "user" }) });
        return true;
      }
      deps.json(res, 405, { error: { code: "method_not_allowed", message: "Unsupported memory operation." } });
      return true;
    }
  } catch (error) {
    if (error instanceof AssistantMemoryNotFoundError) {
      deps.json(res, 404, { error: { code: "memory_not_found", message: error.message } });
      return true;
    }
    if (error instanceof AssistantMemoryConflictError) {
      deps.json(res, 409, { error: { code: "memory_conflict", message: error.message } });
      return true;
    }
    return badRequest(deps, res, error);
  }
  return false;
}
