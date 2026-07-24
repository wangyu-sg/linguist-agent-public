import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createTaskWorkspace,
  FileCapabilityBroker,
  createDocumentRouterRichArtifact,
  createMineruRichArtifact,
  createOfficeRichArtifact,
  runManagedMineruExtraction,
  runManagedOfficeOperation,
  resolveStandaloneFileGrantAccess,
  standaloneTaskWorkspaceRoot,
  writeJsonFile,
  type FileGrantV1,
  type DocumentRouterRichArtifactInput,
} from "@linguist-agent/cat-data";

const parameters = Type.Object({
  sourcePath: Type.String({ description: "An image or PDF path covered by this Chat's explicit file grants." }),
  useOrientation: Type.Optional(Type.Boolean({ description: "Enable the separately locked text-line orientation model only when the scan needs it; defaults false." })),
});

const officeParameters = Type.Object({
  operation: Type.Union([
    Type.Literal("inspect"),
    Type.Literal("replace"),
    Type.Literal("comment"),
    Type.Literal("track_changes"),
    Type.Literal("create_docx"),
    Type.Literal("create_pptx"),
    Type.Literal("pdf_annotate"),
    Type.Literal("pdf_merge"),
    Type.Literal("pdf_extract_pages"),
    Type.Literal("pdf_rotate"),
    Type.Literal("pdf_watermark"),
    Type.Literal("pdf_fill_form"),
  ]),
  sourcePath: Type.Optional(Type.String({ description: "A granted DOCX, XLSX, PPTX, or PDF source path. Sources are always read-only." })),
  sourcePaths: Type.Optional(Type.Array(Type.String(), { description: "Granted PDF paths for pdf_merge." })),
  outputPath: Type.Optional(Type.String({ description: "A new output path for every mutation. It must not already exist and must be covered by a read-write grant or the private Chat workspace." })),
  replacements: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()), { description: "Typed replacements. DOCX uses locator/text or pattern/replacement; XLSX uses sheet/cell/value; PPTX uses slide/shape/find/text." })),
  locator: Type.Optional(Type.String({ description: "Stable DOCX locator for comment." })),
  text: Type.Optional(Type.String({ description: "DOCX comment text or PDF watermark text." })),
  enabled: Type.Optional(Type.Boolean({ description: "Enable or disable DOCX tracked changes." })),
  pages: Type.Optional(Type.Array(Type.Number(), { description: "1-based PDF pages for extraction or rotation." })),
  angle: Type.Optional(Type.Number({ description: "PDF rotation angle: a multiple of 90." })),
  fontSize: Type.Optional(Type.Number({ description: "PDF watermark size." })),
  opacity: Type.Optional(Type.Number({ description: "PDF watermark opacity." })),
  rotation: Type.Optional(Type.Number({ description: "PDF watermark text angle." })),
  fields: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()), { description: "PDF form updates with name and value." })),
  rect: Type.Optional(Type.Array(Type.Number(), { minItems: 4, maxItems: 4, description: "PDF annotation rectangle [x1, y1, x2, y2]." })),
  slides: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()), { description: "Basic PPTX creation slides with title and body." })),
});

const mineruParameters = Type.Object({
  sourcePath: Type.String({ description: "An explicitly granted complex-layout document." }),
  outputDirectory: Type.String({ description: "A new or empty managed output directory covered by a read-write grant or the private Chat workspace." }),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 30, maximum: 1800 })),
});

function inside(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function standaloneFileBroker(access: {
  workspaceRoot: string;
  workingDirectory: string;
  grants: FileGrantV1[];
}): Promise<FileCapabilityBroker> {
  return FileCapabilityBroker.create({
    cwd: access.workingDirectory,
    grants: [{
      id: "standalone-workspace",
      rootPath: access.workspaceRoot,
      kind: "directory",
      recursive: true,
      operations: ["read", "list", "search", "write"],
    }, ...access.grants.map((grant) => ({
      id: grant.id,
      rootPath: grant.realPath,
      kind: grant.kind,
      recursive: grant.recursive,
      operations: grant.access === "read_write"
        ? ["read", "list", "search", "write"] as const
        : ["read", "list", "search"] as const,
    }))],
  });
}

export function createStandaloneDocumentTools(options: {
  runtimeRoot: string;
  taskId: string;
  runId: string;
  agentThreadId: string;
  routeDocument?: (input: { sourcePath: string; useOrientation?: boolean }) => Promise<DocumentRouterRichArtifactInput & { blocks: unknown[] }>;
  runOffice?: typeof runManagedOfficeOperation;
  runMineru?: typeof runManagedMineruExtraction;
}) {
  return [defineTool<typeof parameters>({
    name: "document_extract_evidence",
    label: "Extract Local Document Evidence",
    description: "Run the verified local PaddleOCR pack and persist page geometry, text, confidence, model versions, digest, and overlay as a reviewable document_evidence Artifact.",
    promptSnippet: "Extract local OCR evidence from an explicitly granted image or PDF",
    promptGuidelines: [
      "Use parser-native text first. Use this tool only when the text layer is empty or insufficient, or when the user explicitly asks for OCR.",
      "Never discard low-confidence text. Cite the resulting Artifact and ask for visual review when confidence is low.",
      "This is local-only. Never substitute a cloud vision tool without a separate data-egress Decision.",
    ],
    parameters,
    async execute(_toolCallId, input) {
      const access = await resolveStandaloneFileGrantAccess(options.runtimeRoot, options.taskId);
      const authorization = await (await standaloneFileBroker(access)).authorizePath(input.sourcePath, "read");
      const path = authorization.path;
      const grant = access.grants.find((candidate) => candidate.id === authorization.grantId);
      if (!options.routeDocument) throw new Error("The server-owned Document Router is unavailable.");
      const routed = await options.routeDocument({ sourcePath: path, useOrientation: input.useOrientation });
      if (routed.status === "blocked") throw new Error(`Document Router blocked every page: ${routed.pages.map((page) => `page ${page.page}: ${page.reason}`).join("; ")}`);
      const workspace = createTaskWorkspace(options.runtimeRoot);
      const snapshot = await workspace.open({ kind: "standalone", taskId: options.taskId });
      const run = snapshot.runs.find((candidate) => candidate.id === options.runId);
      const thread = snapshot.agentThreads.find((candidate) => candidate.id === options.agentThreadId);
      if (!run || !thread || snapshot.activeRunId !== run.id) throw new Error("The document evidence Run is no longer active.");
      const now = new Date().toISOString();
      const suffix = randomUUID();
      const artifactId = `${options.runId}.document-evidence.${suffix}`;
      const activityId = `${options.runId}.document-evidence.${suffix}.created`;
      const artifactPath = join(standaloneTaskWorkspaceRoot(options.runtimeRoot, options.taskId), "artifacts", `${artifactId}.json`);
      await writeJsonFile(artifactPath, routed);
      const blockCount = routed.blocks.length;
      const document = createDocumentRouterRichArtifact(routed, { sourcePath: path, createdAt: now });
      await workspace.appendGenerated({
        kind: "standalone",
        taskId: options.taskId,
        runId: options.runId,
        events: [{
          type: "artifact_upsert",
          agentThreadId: options.agentThreadId,
          occurredAt: now,
          artifact: {
            id: artifactId,
            taskId: options.taskId,
            runId: options.runId,
            type: "document_evidence",
            status: "reviewable",
            title: `Document evidence · ${path.split("/").at(-1) ?? "document"}`,
            summary: `${blockCount} text regions across ${routed.pages.length} page(s); routing is ${routed.status} and every blocked page remains explicit.`,
            scope: { kind: "standalone", fileGrantIds: grant ? [grant.id] : [] },
            version: 1,
            provenance: { agentThreadId: options.agentThreadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
            availableDecisions: [],
            content: { router: routed, document, artifactPath },
            createdAt: now,
            updatedAt: now,
          },
        }, {
          type: "activity_append",
          agentThreadId: options.agentThreadId,
          occurredAt: now,
          activity: {
            id: activityId,
            taskId: options.taskId,
            runId: options.runId,
            agentThreadId: options.agentThreadId,
            seq: 1,
            type: "artifact_update",
            status: "done",
            actor: { kind: "agent", id: options.agentThreadId, displayName: thread.identity.displayName, agentThreadId: options.agentThreadId },
            title: "Document evidence ready for review",
            body: `${blockCount} text regions were routed locally; backend provenance remains attached to every region.`,
            tool: { name: "document_extract_evidence", effect: "read", target: path, outcome: `${artifactId} (${routed.status})` },
            refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: now,
            updatedAt: now,
          },
        }],
      });
      return {
        content: [{ type: "text" as const, text: `Created reviewable document evidence Artifact ${artifactId}: ${blockCount} regions across ${routed.pages.length} page(s), routing ${routed.status}.` }],
        details: { artifactId, artifactPath, sourceSha256: routed.source.sha256, pages: routed.pages.length, blocks: blockCount, status: routed.status },
      };
    },
  }), defineTool<typeof officeParameters>({
    name: "office_document_operate",
    label: "Inspect or Edit Office Document",
    description: "Inspect DOCX/XLSX/PPTX/PDF; create validated DOCX/XLSX/PPTX copies; or merge, extract, rotate, watermark, and fill PDF copies. Sources remain read-only and every result becomes a reviewable rich_document Artifact.",
    promptSnippet: "Inspect or copy-edit an explicitly granted Office/PDF document",
    promptGuidelines: [
      "Inspect structure before editing. Never write into the source path.",
      "Use stable DOCX locators, typed sheet/cell or slide/shape locators, and explicit 1-based PDF pages. Preserve formulas, links, and unrelated content.",
      "Treat the returned diff and reopen validation as the truth; never claim arbitrary PDF reflow fidelity.",
    ],
    parameters: officeParameters,
    async execute(_toolCallId, input) {
      const access = await resolveStandaloneFileGrantAccess(options.runtimeRoot, options.taskId);
      const broker = await standaloneFileBroker(access);
      const creation = input.operation === "create_docx" || input.operation === "create_pptx";
      const requestedSources = (input.operation === "pdf_merge" ? input.sourcePaths : input.sourcePath ? [input.sourcePath] : []) ?? [];
      if (!creation && !requestedSources.length) throw new Error(`${input.operation} requires ${input.operation === "pdf_merge" ? "sourcePaths" : "sourcePath"}.`);
      const sourceAuthorizations = await Promise.all(requestedSources.map((path) => broker.authorizePath(path, "read")));
      const sourcePaths = sourceAuthorizations.map((authorization) => authorization.path);
      const sourceGrantIds: string[] = [];
      for (const authorization of sourceAuthorizations) {
        if (authorization.grantId !== "standalone-workspace") sourceGrantIds.push(authorization.grantId);
      }
      let outputPath: string | undefined;
      let outputGrantId: string | undefined;
      const mutation = input.operation !== "inspect";
      if (mutation) {
        if (!input.outputPath?.trim()) throw new Error(`${input.operation} requires a new outputPath.`);
        const requested = resolve(input.outputPath);
        const outputAuthorization = await broker.authorizePath(requested, "write");
        outputPath = outputAuthorization.path;
        if (sourcePaths.includes(outputPath)) throw new Error("Office output must be a new file, not a source.");
        outputGrantId = outputAuthorization.grantId === "standalone-workspace" ? undefined : outputAuthorization.grantId;
      }
      const result = await (options.runOffice ?? runManagedOfficeOperation)(options.runtimeRoot, {
        operation: input.operation,
        sourcePath: sourcePaths.length === 1 ? sourcePaths[0] : undefined,
        sourcePaths: sourcePaths.length > 1 ? sourcePaths : undefined,
        outputPath,
        replacements: input.replacements,
        locator: input.locator,
        text: input.text,
        enabled: input.enabled,
        pages: input.pages,
        angle: input.angle,
        fontSize: input.fontSize,
        opacity: input.opacity,
        rotation: input.rotation,
        fields: input.fields,
        rect: input.rect,
        slides: input.slides,
      });
      const workspace = createTaskWorkspace(options.runtimeRoot);
      const snapshot = await workspace.open({ kind: "standalone", taskId: options.taskId });
      const thread = snapshot.agentThreads.find((candidate) => candidate.id === options.agentThreadId);
      if (!thread || snapshot.activeRunId !== options.runId) throw new Error("The Office document Run is no longer active.");
      const now = new Date().toISOString();
      const suffix = randomUUID();
      const artifactId = `${options.runId}.rich-document.${suffix}`;
      const activityId = `${artifactId}.created`;
      const artifactPath = join(standaloneTaskWorkspaceRoot(options.runtimeRoot, options.taskId), "artifacts", `${artifactId}.json`);
      await writeJsonFile(artifactPath, result);
      const grantIds = [...new Set([...sourceGrantIds, outputGrantId].filter((value): value is string => Boolean(value)))];
      const sourceLabel = creation ? outputPath!.split("/").at(-1) ?? "document" : sourcePaths.length === 1 ? sourcePaths[0]!.split("/").at(-1) ?? "document" : `${sourcePaths.length} PDFs`;
      const title = `${mutation ? "Validated document copy" : "Document inspection"} · ${sourceLabel}`;
      const document = createOfficeRichArtifact(input.operation, result, { title, createdAt: now });
      await workspace.appendGenerated({
        kind: "standalone",
        taskId: options.taskId,
        runId: options.runId,
        events: [{
          type: "artifact_upsert",
          agentThreadId: options.agentThreadId,
          occurredAt: now,
          artifact: {
            id: artifactId,
            taskId: options.taskId,
            runId: options.runId,
            type: "rich_document",
            status: "reviewable",
            title,
            summary: mutation ? "Created a new document copy with typed diff and reopen validation; every source digest remained unchanged." : "Inspected document structure without modifying the source.",
            scope: { kind: "standalone", fileGrantIds: grantIds },
            version: 1,
            provenance: { agentThreadId: options.agentThreadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
            availableDecisions: [],
            content: { operation: input.operation, artifactPath, document },
            createdAt: now,
            updatedAt: now,
          },
        }, {
          type: "activity_append",
          agentThreadId: options.agentThreadId,
          occurredAt: now,
          activity: {
            id: activityId,
            taskId: options.taskId,
            runId: options.runId,
            agentThreadId: options.agentThreadId,
            seq: 1,
            type: "artifact_update",
            status: "done",
            actor: { kind: "agent", id: options.agentThreadId, displayName: thread.identity.displayName, agentThreadId: options.agentThreadId },
            title: mutation ? "Validated document copy created" : "Document structure inspected",
            body: creation ? `Output: ${result.outputPath}; the new document reopened successfully.` : mutation ? `Output: ${result.outputPath}; ${sourcePaths.length} source file(s) remained digest-identical.` : `Source SHA-256: ${result.sourceSha256}.`,
            tool: {
              name: "office_document_operate",
              effect: mutation ? "write" : "read",
              target: creation ? outputPath! : sourcePaths.join(", "),
              outcome: artifactId,
            },
            refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: now,
            updatedAt: now,
          },
        }],
      });
      return {
        content: [{ type: "text" as const, text: `Created reviewable rich_document Artifact ${artifactId}.${result.outputPath ? ` Output: ${result.outputPath}` : ""}` }],
        details: { artifactId, artifactPath, sourceSha256: result.sourceSha256, outputPath: result.outputPath, outputSha256: result.outputSha256, diff: result.diff, validation: result.validation },
      };
    },
  }), defineTool<typeof mineruParameters>({
    name: "document_extract_layout",
    label: "Extract Complex Document Layout",
    description: "Run the qualified local MinerU Labs pack for complex tables, formulas, or layout only. The tool fails closed while the exact pack is missing or unqualified.",
    promptSnippet: "Extract complex local document structure with qualified MinerU",
    promptGuidelines: [
      "Use native Office/PDF text extraction first. Use MinerU only when layout, table, or formula structure cannot be recovered adequately.",
      "Never substitute an undeclared system MinerU command or cloud parser when this managed Labs pack is unavailable.",
      "Treat every generated file and source digest as review evidence; never overwrite the source.",
    ],
    parameters: mineruParameters,
    async execute(_toolCallId, input) {
      const access = await resolveStandaloneFileGrantAccess(options.runtimeRoot, options.taskId);
      const broker = await standaloneFileBroker(access);
      const sourceAuthorization = await broker.authorizePath(input.sourcePath, "read");
      const sourcePath = sourceAuthorization.path;
      const sourceGrant = access.grants.find((candidate) => candidate.id === sourceAuthorization.grantId);
      const requestedOutput = resolve(input.outputDirectory);
      const outputAuthorization = await broker.authorizePath(requestedOutput, "write");
      const outputDirectory = outputAuthorization.path;
      if (inside(sourcePath, outputDirectory)) throw new Error("MinerU output must not be inside the source path.");
      const outputGrant = access.grants.find((candidate) => candidate.id === outputAuthorization.grantId);
      const result = await (options.runMineru ?? runManagedMineruExtraction)(options.runtimeRoot, {
        sourcePath,
        outputDirectory,
        timeoutSeconds: input.timeoutSeconds,
      });
      const workspace = createTaskWorkspace(options.runtimeRoot);
      const snapshot = await workspace.open({ kind: "standalone", taskId: options.taskId });
      const thread = snapshot.agentThreads.find((candidate) => candidate.id === options.agentThreadId);
      if (!thread || snapshot.activeRunId !== options.runId) throw new Error("The document layout Run is no longer active.");
      const now = new Date().toISOString();
      const suffix = randomUUID();
      const artifactId = `${options.runId}.rich-document-layout.${suffix}`;
      const activityId = `${artifactId}.created`;
      const artifactPath = join(standaloneTaskWorkspaceRoot(options.runtimeRoot, options.taskId), "artifacts", `${artifactId}.json`);
      await writeJsonFile(artifactPath, result);
      const grantIds = [...new Set([sourceGrant?.id, outputGrant?.id].filter((value): value is string => Boolean(value)))];
      const document = createMineruRichArtifact(result, { createdAt: now });
      await workspace.appendGenerated({
        kind: "standalone",
        taskId: options.taskId,
        runId: options.runId,
        events: [{
          type: "artifact_upsert",
          agentThreadId: options.agentThreadId,
          occurredAt: now,
          artifact: {
            id: artifactId,
            taskId: options.taskId,
            runId: options.runId,
            type: "rich_document",
            status: "reviewable",
            title: `Complex layout extraction · ${sourcePath.split("/").at(-1) ?? "document"}`,
            summary: `Qualified local MinerU produced ${result.files.length} locked output file(s); the source digest remained unchanged.`,
            scope: { kind: "standalone", fileGrantIds: grantIds },
            version: 1,
            provenance: { agentThreadId: options.agentThreadId, activityId, evidenceRefs: [], parentArtifactIds: [] },
            availableDecisions: [],
            content: { operation: "mineru_extract", artifactPath, document },
            createdAt: now,
            updatedAt: now,
          },
        }, {
          type: "activity_append",
          agentThreadId: options.agentThreadId,
          occurredAt: now,
          activity: {
            id: activityId,
            taskId: options.taskId,
            runId: options.runId,
            agentThreadId: options.agentThreadId,
            seq: 1,
            type: "artifact_update",
            status: "done",
            actor: { kind: "agent", id: options.agentThreadId, displayName: thread.identity.displayName, agentThreadId: options.agentThreadId },
            title: "Complex document layout extracted",
            body: `${result.files.length} output file(s) were produced locally by the qualified managed MinerU pack.`,
            tool: { name: "document_extract_layout", effect: "write", target: outputDirectory, outcome: artifactId },
            refs: { artifactIds: [artifactId], evidenceRefs: [], decisionIds: [], segmentIds: [] },
            createdAt: now,
            updatedAt: now,
          },
        }],
      });
      return {
        content: [{ type: "text" as const, text: `Created reviewable rich_document Artifact ${artifactId} from ${result.files.length} MinerU output file(s).` }],
        details: { artifactId, artifactPath, sourceSha256: result.sourceSha256, outputDirectory: result.outputDirectory, files: result.files },
      };
    },
  })];
}
