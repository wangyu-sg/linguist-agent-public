import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type RoadmapDocuments = {
  queue: string;
  risks: string;
  deletions: string;
};

export type ExecutionGateLedgerDocuments = {
  markdown: string;
  json: string;
  reportFiles: string[];
};

export function validateStorageAuthorityBoundaries(queue: string): string[] {
  const errors: string[] = [];
  const qualityLedgerCutoverOwners = [
    ...queue.matchAll(/<!--\s*PROJECT_QUALITY_LEDGER_CUTOVER_OWNER:\s*(LA-\d{3})\s*-->/g),
  ].map((match) => match[1]!);
  if (qualityLedgerCutoverOwners.length !== 1) {
    errors.push(`Project quality ledger must have exactly one production cutover owner; found ${qualityLedgerCutoverOwners.length}`);
  } else if (qualityLedgerCutoverOwners[0] !== "LA-098") {
    errors.push(`Project quality ledger production cutover owner must be LA-098, received ${qualityLedgerCutoverOwners[0]}`);
  }
  if (!queue.includes("<!-- TASK_AGGREGATE_EXCLUDES_PROJECT_QUALITY_LEDGER -->")) {
    errors.push("Task aggregate boundary must exclude the Project quality ledger");
  }
  return errors;
}

type Ticket = {
  id: string;
  kind: "ticket" | "epic" | "gate" | "decision";
  risks: string[];
  executable: "yes" | "no";
  dependencies: string[];
  phase: string;
};

type Risk = {
  id: string;
  severity: string;
  tickets: string[];
};

function markedSection(text: string, name: string): string {
  const begin = `<!-- ROADMAP_${name}_BEGIN -->`;
  const end = `<!-- ROADMAP_${name}_END -->`;
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if (start < 0 || finish < 0 || finish <= start) {
    throw new Error(`missing or invalid ${name} markers`);
  }
  return text.slice(start + begin.length, finish);
}

function tableRows(section: string): string[][] {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.includes("|---"))
    .slice(1)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

function ids(cell: string, prefix: "LA" | "R"): string[] {
  return cell.match(new RegExp(`${prefix}-\\d{3}|LA-BASE`, "g")) ?? [];
}

function parseTickets(queue: string): Ticket[] {
  return tableRows(markedSection(queue, "TICKETS")).map((row) => ({
    id: row[0] ?? "",
    kind: row[1] as Ticket["kind"],
    risks: ids(row[2] ?? "", "R"),
    executable: row[3] as Ticket["executable"],
    dependencies: ids(row[4] ?? "", "LA"),
    phase: row[5] ?? "",
  }));
}

function parseRisks(risks: string): Risk[] {
  return tableRows(markedSection(risks, "RISKS")).map((row) => ({
    id: row[0] ?? "",
    severity: row[1] ?? "",
    tickets: ids(row[6] ?? "", "LA"),
  }));
}

function parseDeletions(deletions: string): Array<{ candidate: string; tickets: string[] }> {
  return tableRows(markedSection(deletions, "DELETIONS")).map((row) => ({
    candidate: row[0] ?? "",
    tickets: ids(row[1] ?? "", "LA"),
  }));
}

export function validateRoadmapDocuments(documents: RoadmapDocuments): string[] {
  const errors: string[] = [];
  let tickets: Ticket[];
  let risks: Risk[];
  let deletions: Array<{ candidate: string; tickets: string[] }>;
  try {
    tickets = parseTickets(documents.queue);
    risks = parseRisks(documents.risks);
    deletions = parseDeletions(documents.deletions);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const ticketById = new Map<string, Ticket>();
  for (const ticket of tickets) {
    if (ticketById.has(ticket.id)) errors.push(`duplicate ticket: ${ticket.id}`);
    ticketById.set(ticket.id, ticket);
    if (!(["ticket", "epic", "gate", "decision"] as string[]).includes(ticket.kind)) {
      errors.push(`invalid ticket kind: ${ticket.id}=${ticket.kind}`);
    }
    if (!(["yes", "no"] as string[]).includes(ticket.executable)) {
      errors.push(`invalid executable value: ${ticket.id}=${ticket.executable}`);
    }
    if ((ticket.kind === "epic" || ticket.kind === "gate") && ticket.executable !== "no") {
      errors.push(`${ticket.kind} must not be executable: ${ticket.id}`);
    }
    if (ticket.kind !== "ticket" && ticket.executable === "yes") {
      errors.push(`only tickets may be executable: ${ticket.id}`);
    }
  }

  const numericIds = tickets
    .map((ticket) => /^LA-(\d{3})$/.exec(ticket.id))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));
  const maximum = Math.max(...numericIds);
  for (let value = 0; value <= maximum; value += 1) {
    const id = `LA-${String(value).padStart(3, "0")}`;
    if (!ticketById.has(id)) errors.push(`missing ticket: ${id}`);
  }

  const rangePattern = /LA-\d{3}\s*[-–—]\s*(?:LA-)?\d{3}/g;
  for (const match of documents.queue.matchAll(rangePattern)) {
    errors.push(`forbidden ticket range abbreviation: ${match[0]}`);
  }

  for (const ticket of tickets) {
    for (const dependency of ticket.dependencies) {
      if (!ticketById.has(dependency)) errors.push(`unknown dependency: ${ticket.id} -> ${dependency}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (visiting.has(id)) {
      errors.push(`dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of ticketById.get(id)?.dependencies ?? []) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const ticket of tickets) visit(ticket.id, []);

  const riskById = new Map<string, Risk>();
  for (const risk of risks) {
    if (riskById.has(risk.id)) errors.push(`duplicate risk: ${risk.id}`);
    riskById.set(risk.id, risk);
    if (risk.tickets.length === 0) errors.push(`risk has no ticket: ${risk.id}`);
    for (const ticketId of risk.tickets) {
      const ticket = ticketById.get(ticketId);
      if (!ticket) errors.push(`risk references unknown ticket: ${risk.id} -> ${ticketId}`);
      else if (!ticket.risks.includes(risk.id)) errors.push(`risk/ticket mismatch: ${risk.id} -> ${ticketId}`);
    }
    if (risk.severity.startsWith("P0")) {
      const hasPhaseZeroControl = risk.tickets.some((ticketId) => ticketById.get(ticketId)?.phase === "0");
      if (!hasPhaseZeroControl) errors.push(`P0 risk lacks Phase 0 stopgap or decision: ${risk.id}`);
    }
  }
  for (const ticket of tickets) {
    for (const riskId of ticket.risks) {
      const risk = riskById.get(riskId);
      if (!risk) errors.push(`ticket references unknown risk: ${ticket.id} -> ${riskId}`);
      else if (!risk.tickets.includes(ticket.id)) errors.push(`ticket/risk mismatch: ${ticket.id} -> ${riskId}`);
    }
  }

  for (const deletion of deletions) {
    if (!deletion.candidate) errors.push("deletion candidate has no key");
    if (deletion.tickets.length === 0) errors.push(`deletion candidate has no ticket: ${deletion.candidate}`);
    for (const ticketId of deletion.tickets) {
      if (!ticketById.has(ticketId)) errors.push(`deletion candidate references unknown ticket: ${deletion.candidate} -> ${ticketId}`);
    }
  }

  const requiredKinds: Record<string, Ticket["kind"]> = {
    "LA-017": "epic",
    "LA-020": "epic",
    "LA-024": "epic",
    "LA-025": "epic",
    "LA-030": "epic",
    "LA-050": "epic",
    "LA-051": "gate",
    "LA-055": "epic",
    "LA-056": "epic",
    "LA-058": "gate",
  };
  for (const [id, kind] of Object.entries(requiredKinds)) {
    const ticket = ticketById.get(id);
    if (!ticket || ticket.kind !== kind || ticket.executable !== "no") {
      errors.push(`required non-executable ${kind} is invalid: ${id}`);
    }
  }

  const requiredStorageEpicChildren: Record<string, string[]> = {
    "LA-024": ["LA-084", "LA-085", "LA-086", "LA-087", "LA-088", "LA-089", "LA-090", "LA-091", "LA-102", "LA-103", "LA-104", "LA-105"],
    "LA-025": ["LA-092", "LA-093", "LA-094", "LA-095", "LA-096", "LA-097", "LA-098", "LA-099", "LA-100", "LA-101"],
  };
  for (const [epicId, childIds] of Object.entries(requiredStorageEpicChildren)) {
    for (const childId of childIds) {
      const child = ticketById.get(childId);
      if (!child || child.kind !== "ticket" || child.executable !== "yes" || child.phase !== "3") {
        errors.push(`storage epic child is missing or non-executable: ${epicId} -> ${childId}`);
      }
    }
  }

  const taskAggregateCutoverOwners = [
    ...documents.queue.matchAll(/<!--\s*TASK_AGGREGATE_CUTOVER_OWNER:\s*(LA-\d{3})\s*-->/g),
  ].map((match) => match[1]!);
  if (taskAggregateCutoverOwners.length !== 1) {
    errors.push(`Task aggregate must have exactly one production cutover owner; found ${taskAggregateCutoverOwners.length}`);
  } else if (taskAggregateCutoverOwners[0] !== "LA-089") {
    errors.push(`Task aggregate production cutover owner must be LA-089, received ${taskAggregateCutoverOwners[0]}`);
  }
  const taskRepositoryReadiness = ticketById.get("LA-087");
  if (!taskRepositoryReadiness?.dependencies.includes("LA-102")) {
    errors.push("LA-087 must depend on LA-102 Task aggregate boundary repair");
  }
  const taskAggregateCutover = ticketById.get("LA-089");
  if (!taskAggregateCutover?.dependencies.includes("LA-087")
    || !taskAggregateCutover.dependencies.includes("LA-088")
    || !taskAggregateCutover.dependencies.includes("LA-103")
    || !taskAggregateCutover.dependencies.includes("LA-105")) {
    errors.push("LA-089 aggregate cutover must depend on LA-087, LA-088, LA-103, and LA-105");
  }

  return [...new Set([...errors, ...validateStorageAuthorityBoundaries(documents.queue)])];
}

export function validateExecutionGateLedgerDocuments(documents: ExecutionGateLedgerDocuments): string[] {
  const reportIds = new Set(
    documents.reportFiles
      .map((file) => /^(G\d+)_.*_REPORT\.md$/.exec(file)?.[1])
      .filter((id): id is string => Boolean(id)),
  );
  const markdownIds = new Set(
    [...documents.markdown.matchAll(/^## Stage Gate (G\d+)\b/gm)].map((match) => match[1] ?? ""),
  );
  let jsonIds: Set<string>;
  try {
    const parsed = JSON.parse(documents.json) as { stageGates?: Array<{ id?: unknown }> };
    jsonIds = new Set((parsed.stageGates ?? []).map((gate) => gate.id).filter((id): id is string => typeof id === "string"));
  } catch (error) {
    return [`invalid execution ledger JSON: ${error instanceof Error ? error.message : String(error)}`];
  }

  const errors: string[] = [];
  for (const id of reportIds) {
    if (!markdownIds.has(id)) errors.push(`Gate report missing Markdown ledger entry: ${id}`);
    if (!jsonIds.has(id)) errors.push(`Gate report missing JSON ledger entry: ${id}`);
  }
  for (const id of markdownIds) {
    if (!reportIds.has(id)) errors.push(`Markdown Gate missing report: ${id}`);
    if (!jsonIds.has(id)) errors.push(`Markdown Gate missing JSON ledger entry: ${id}`);
  }
  for (const id of jsonIds) {
    if (!reportIds.has(id)) errors.push(`JSON Gate missing report: ${id}`);
    if (!markdownIds.has(id)) errors.push(`JSON Gate missing Markdown ledger entry: ${id}`);
  }
  return [...new Set(errors)];
}

export function validateRoadmap(root = process.cwd()): string[] {
  const roadmapRoot = path.join(root, "docs/roadmap");
  const controlPlaneFiles = [
    "CURRENT_REALITY_REPORT.md",
    "MODULE_AND_DATA_INVENTORY.md",
    "RISK_REGISTER.md",
    "DELETION_CANDIDATES.md",
    "MIGRATION_MATRIX.md",
    "UI_GAP_MATRIX.md",
    "IMPLEMENTATION_QUEUE.md",
  ];
  try {
    for (const file of controlPlaneFiles) readFileSync(path.join(roadmapRoot, file), "utf8");
  } catch (error) {
    return [`missing roadmap control-plane document: ${error instanceof Error ? error.message : String(error)}`];
  }
  const storageDecisionPath = path.join(root, "docs/adr/0001-sqlite-storage-boundary.md");
  let storageDecision: string;
  try {
    storageDecision = readFileSync(storageDecisionPath, "utf8");
  } catch (error) {
    return [`missing accepted LA-062 storage decision: ${error instanceof Error ? error.message : String(error)}`];
  }
  const decisionErrors = [
    storageDecision.includes("- Decision: `LA-062`") ? null : "LA-062 ADR is missing its Decision identifier",
    storageDecision.includes("- Status: Accepted") ? null : "LA-062 ADR is not accepted",
    storageDecision.includes("Permanent dual write is forbidden") ? null : "LA-062 ADR is missing the no-dual-write boundary",
  ].filter((error): error is string => error !== null);
  return [
    ...decisionErrors,
    ...validateRoadmapDocuments({
    queue: readFileSync(path.join(roadmapRoot, "IMPLEMENTATION_QUEUE.md"), "utf8"),
    risks: readFileSync(path.join(roadmapRoot, "RISK_REGISTER.md"), "utf8"),
    deletions: readFileSync(path.join(roadmapRoot, "DELETION_CANDIDATES.md"), "utf8"),
    }),
    ...validateExecutionGateLedgerDocuments({
      markdown: readFileSync(path.join(roadmapRoot, "EXECUTION_LEDGER.md"), "utf8"),
      json: readFileSync(path.join(roadmapRoot, "execution-ledger.json"), "utf8"),
      reportFiles: readdirSync(roadmapRoot),
    }),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateRoadmap();
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`roadmap error: ${error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("roadmap validation passed: tickets, dependencies, risk mappings, P0 controls, deletion coverage, non-executable epics/gates, and Gate ledger parity\n");
  }
}
