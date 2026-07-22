import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  evaluateOfficeQualification,
  inspectManagedDocumentCapabilities,
  managedDocumentCapabilityPath,
  managedDocumentCapabilityPythonExecutable,
  runManagedJsonlWorker,
  type OfficeQualificationFixture,
  type OfficeQualificationReport,
} from "@linguist-agent/cat-data";

export interface ManagedOfficeQualificationResult extends OfficeQualificationReport {
  outputRoot: string;
  fixtureIds: string[];
}

export async function qualifyManagedOfficePack(
  workspaceRoot: string,
  outputRoot: string,
  options: {
    countPerFormat?: number;
    runWorker?: typeof runManagedJsonlWorker;
    inspectCapabilities?: typeof inspectManagedDocumentCapabilities;
  } = {},
): Promise<ManagedOfficeQualificationResult> {
  const statuses = await (options.inspectCapabilities ?? inspectManagedDocumentCapabilities)(workspaceRoot);
  if (statuses.python.state !== "ready") throw new Error(statuses.python.message ?? `Managed Python is ${statuses.python.state}.`);
  if (statuses.office.state !== "ready") throw new Error(statuses.office.message ?? `Office pack is ${statuses.office.state}.`);
  const requestedOutput = resolve(outputRoot);
  const canonicalParent = await realpath(dirname(requestedOutput));
  const canonicalOutput = join(canonicalParent, basename(requestedOutput) || "office-qualification");
  const packRoot = managedDocumentCapabilityPath(workspaceRoot, "office");
  const rows = await (options.runWorker ?? runManagedJsonlWorker)({
    executable: managedDocumentCapabilityPythonExecutable(workspaceRoot, "office"),
    workerPath: join(packRoot, "worker", "office_qualification_worker.py"),
    timeoutMs: 15 * 60_000,
    maxBufferBytes: 64 * 1024 * 1024,
    request: {
      outputRoot: canonicalOutput,
      count: options.countPerFormat ?? 20,
      docxExecutable: join(packRoot, "bin", "docx"),
    },
  });
  const response = rows.at(-1) as { ok?: unknown; error?: unknown; outputRoot?: unknown; fixtures?: unknown; outboundCustomerFileRequests?: unknown } | undefined;
  if (response?.ok !== true) throw new Error(typeof response?.error === "string" ? response.error : "Office qualification worker failed.");
  if (!Array.isArray(response.fixtures)) throw new Error("Office qualification worker did not return fixture observations.");
  const fixtures = response.fixtures as OfficeQualificationFixture[];
  const report = evaluateOfficeQualification(fixtures, Number(response.outboundCustomerFileRequests ?? 0));
  return {
    ...report,
    outputRoot: String(response.outputRoot ?? canonicalOutput),
    fixtureIds: fixtures.map((fixture) => fixture.id),
  };
}
