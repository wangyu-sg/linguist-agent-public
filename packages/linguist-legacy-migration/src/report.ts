/**
 * Scan report rendering (PB-090): text mode = `key: value` summary lines
 * plus one JSON object per line (projects, health signals); --json mode =
 * the whole ScanReport as one pretty-printed JSON document.
 */

import type { ProjectScan, ScanReport } from './scan'

function projectLine(project: ProjectScan): Record<string, unknown> {
  return {
    project: project.projectId,
    manifestSource: project.manifest.source,
    manifestReadable: project.manifest.readable,
    sourceRoot: project.sourceRoot.path,
    sourceRootExists: project.sourceRoot.exists,
    assets: project.assets.count,
    uploads: project.uploads.files,
    batches: project.batches.length,
    segments: project.batches.reduce((n, b) => n + b.segmentCount, 0),
    lockedSegments: project.batches.reduce((n, b) => n + b.lockedCount, 0),
    tmEntries: project.tm.entries,
    termbaseEntries: project.termbase.entries,
    proposalSets: project.batches.reduce((n, b) => n + b.proposals, 0),
    chatPresent: project.chat.present,
    chatEntries: project.chat.entries,
    unsupportedFields: project.unsupportedFields.length,
    health: project.health.map((s) => s.code),
    digest: project.digest,
  }
}

/** Text rendering: deterministic line order, one JSON object per item line. */
export function renderText(report: ScanReport): string[] {
  const lines: string[] = []
  lines.push(`tool: ${report.tool}`)
  lines.push(`generated-at: ${report.generatedAt}`)
  lines.push(`root: ${report.root}`)
  lines.push(`schema-version: ${report.schemaVersion}`)
  lines.push(`sqlite-authority: ${report.sqlite.authority ? 'active' : 'absent'}`)
  if (report.sqlite.authority) {
    lines.push(`sqlite-db: ${report.sqlite.dbPresent ? (report.sqlite.opened ? 'opened-read-only' : 'unreadable') : 'missing'}`)
    if (report.sqlite.dbSha256) lines.push(`sqlite-db-sha256: ${report.sqlite.dbSha256}`)
    lines.push(`sqlite-projects: ${report.sqlite.projectIds.length}`)
    lines.push(
      `blob-store: ${report.sqlite.blobStore.present ? `${report.sqlite.blobStore.blobs} blobs, ${report.sqlite.blobStore.bytes} bytes` : 'absent'}`,
    )
  }
  lines.push(`projects: ${report.projects.length}`)
  for (const project of report.projects) {
    lines.push(JSON.stringify(projectLine(project)))
  }
  if (report.sqliteOnlyProjects.length > 0) {
    lines.push(`sqlite-only-projects: ${report.sqliteOnlyProjects.join(', ')}`)
  }
  for (const signal of report.health) {
    lines.push(
      JSON.stringify({
        health: signal.code,
        severity: signal.severity,
        project: signal.projectId,
        message: signal.message,
      }),
    )
  }
  lines.push(`batches: ${report.totals.batches}`)
  lines.push(`segments: ${report.totals.segments}`)
  lines.push(`locked-segments: ${report.totals.lockedSegments}`)
  lines.push(`tm-entries: ${report.totals.tmEntries}`)
  lines.push(`termbase-entries: ${report.totals.termbaseEntries}`)
  lines.push(`uploads: ${report.totals.uploads}`)
  lines.push(`unsupported-fields: ${report.totals.unsupportedFields}`)
  lines.push(`health-signals: ${report.health.length}`)
  return lines
}

/** JSON rendering: the whole report as one document. */
export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2)
}
