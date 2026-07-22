import { createWorkspace, readJsonFile, workspacePath, writeJsonFile } from "./workspace.js";
import type { BatchSegment, CatBatch } from "./batch_workspace.js";

export interface SourceContextRow {
  id: string;
  projectId: string;
  batchId: string;
  segmentId: string;
  segmentIndex: number;
  source: string;
  masterId?: string;
  resname?: string;
  contextNote?: string;
  tuId?: string;
  coordinate?: string;
}

export interface SourceContextIndex {
  schemaVersion: 1;
  projectId: string;
  updatedAt: string;
  rows: SourceContextRow[];
}

export function sourceContextIndexPath(workspaceRoot: string, projectId: string): string {
  return workspacePath(createWorkspace(workspaceRoot, projectId), "source_context_index.json");
}

function coordinateFromContextNote(contextNote?: string): string | undefined {
  if (!contextNote) return undefined;
  const match = /(?:sheet\s*:\s*)?([^!\n]+![A-Z]+\d+)/i.exec(contextNote);
  return match?.[1]?.trim();
}

export function sourceContextRowsFromBatch(batch: Pick<CatBatch, "projectId" | "batchId" | "segments">): SourceContextRow[] {
  return batch.segments.map((segment: BatchSegment) => ({
    id: `${batch.batchId}:${segment.id}`,
    projectId: batch.projectId,
    batchId: batch.batchId,
    segmentId: segment.id,
    segmentIndex: segment.index,
    source: segment.source,
    masterId: segment.masterId,
    resname: segment.resname,
    contextNote: segment.contextNote,
    tuId: segment.tuId,
    coordinate: coordinateFromContextNote(segment.contextNote),
  }));
}

export async function readSourceContextIndex(workspaceRoot: string, projectId: string): Promise<SourceContextIndex> {
  return readJsonFile<SourceContextIndex>(sourceContextIndexPath(workspaceRoot, projectId), {
    schemaVersion: 1,
    projectId,
    updatedAt: new Date(0).toISOString(),
    rows: [],
  });
}

export async function writeSourceContextRowsForBatch(workspaceRoot: string, batch: Pick<CatBatch, "projectId" | "batchId" | "segments">): Promise<SourceContextIndex> {
  const existing = await readSourceContextIndex(workspaceRoot, batch.projectId);
  const withoutBatch = existing.rows.filter((row) => row.batchId !== batch.batchId);
  const rows = [...withoutBatch, ...sourceContextRowsFromBatch(batch)]
    .sort((a, b) => a.batchId.localeCompare(b.batchId) || a.segmentIndex - b.segmentIndex);
  const index: SourceContextIndex = {
    schemaVersion: 1,
    projectId: batch.projectId,
    updatedAt: new Date().toISOString(),
    rows,
  };
  await writeJsonFile(sourceContextIndexPath(workspaceRoot, batch.projectId), index);
  return index;
}
