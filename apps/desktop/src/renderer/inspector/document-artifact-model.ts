import type { TaskArtifact } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

export interface DocumentArtifactView {
  status: "complete" | "partial" | "blocked";
  source: { sha256: string; mimeType: string };
  pages: Array<{ page: number; status: "complete" | "blocked"; backend: string | null; reason: string; blockCount: number }>;
  textBlocks: Array<{ id: string; text: string; locator: string; userCorrected: boolean }>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function locatorLabel(value: unknown): string | null {
  const locator = record(value);
  if (!locator || typeof locator.kind !== "string") return null;
  if (locator.kind === "page" && Number.isSafeInteger(locator.page) && Number(locator.page) > 0) return `Page ${locator.page}`;
  if (locator.kind === "slide" && Number.isSafeInteger(locator.slide) && Number(locator.slide) > 0) return `Slide ${locator.slide}`;
  if (locator.kind === "cell" && text(locator.sheet) && text(locator.cell)) return `${locator.sheet}!${locator.cell}`;
  return null;
}

export function documentArtifactView(artifact: TaskArtifact): DocumentArtifactView | null {
  if (artifact.type !== "document_evidence") return null;
  const router = record(artifact.content.router);
  const source = router ? record(router.source) : null;
  if (!router || router.schemaVersion !== 1 || !source || !text(source.sha256) || !text(source.mimeType)
    || !["complete", "partial", "blocked"].includes(String(router.status))
    || !Array.isArray(router.pages) || !Array.isArray(router.blocks)) return null;
  const pages = router.pages.map((value) => {
    const page = record(value);
    const backend = page ? record(page.backend) : null;
    if (!page || !Number.isSafeInteger(page.page) || Number(page.page) < 1 || !["complete", "blocked"].includes(String(page.status))
      || !text(page.reason) || !Number.isSafeInteger(page.blockCount) || Number(page.blockCount) < 0
      || (backend && (!text(backend.id) || !text(backend.version) || typeof backend.ocr !== "boolean"))) return null;
    return {
      page: Number(page.page),
      status: page.status as "complete" | "blocked",
      backend: backend ? `${backend.id}@${backend.version}` : null,
      reason: page.reason as string,
      blockCount: Number(page.blockCount),
    };
  });
  if (pages.some((page) => page === null)) return null;
  const textBlocks = router.blocks.flatMap((value) => {
    const block = record(value);
    const provenance = block ? record(block.provenance) : null;
    const id = block ? text(block.id) : null;
    const content = block ? text(block.text) : null;
    const locator = block ? locatorLabel(block.locator) : null;
    if (!id || !content || !locator || !provenance || typeof provenance.userCorrected !== "boolean") return [];
    return [{ id, text: content, locator, userCorrected: provenance.userCorrected }];
  });
  return {
    status: router.status as DocumentArtifactView["status"],
    source: { sha256: source.sha256 as string, mimeType: source.mimeType as string },
    pages: pages as DocumentArtifactView["pages"],
    textBlocks,
  };
}
