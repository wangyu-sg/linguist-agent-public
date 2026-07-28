/**
 * Import report rendering (PB-091 + PB-092 + PB-093): text mode = `key: value`
 * summary lines plus one JSON object per line (assets, archives, signals,
 * refusal, chat sessions, dropped-fields, coercions, notes); --json mode =
 * the whole ImportReport as one document. Mirrors the PB-090 scan report
 * conventions (report.ts).
 */

import type { ImportReport } from './import'

/** Text rendering: deterministic line order, one JSON object per item line. */
export function renderImportText(report: ImportReport): string[] {
  const lines: string[] = []
  lines.push(`tool: ${report.tool}`)
  lines.push(`generated-at: ${report.generatedAt}`)
  lines.push(`dry-run: ${report.dryRun}`)
  lines.push(`disposition: ${report.disposition}`)
  if (report.refusal !== null) {
    lines.push(`refusal: ${report.refusal.reason}`)
    lines.push(JSON.stringify({ refusal: report.refusal }))
  }
  lines.push(`external-source: ${report.externalSource}`)
  lines.push(`legacy-root: ${report.legacyRoot}`)
  lines.push(`legacy-project: ${report.legacyProjectId}`)
  lines.push(`new-project: ${report.newProjectId}`)
  lines.push(`project-name: ${report.project.name}`)
  lines.push(`locales: ${report.project.sourceLocale} -> ${report.project.targetLocale}`)
  lines.push(`workspace-id: ${report.project.promaWorkspaceId}`)
  lines.push(`target-conflict: ${report.targetConflict}`)
  lines.push(`source-digest: ${report.sourceDigest}`)
  lines.push(`digest-files: ${report.digestFiles}`)
  lines.push(`domain-sources: manifest=${report.domains.manifest} tm=${report.domains.tm} termbase=${report.domains.termbase}`)
  lines.push(`signals: ${report.signals.length}`)
  for (const signal of report.signals) {
    lines.push(JSON.stringify({ signal }))
  }
  lines.push(
    `chat: present=${report.chat.present} entries=${report.chat.entries ?? 'n/a'} sessions=${report.chat.sessions.length} ` +
      `malformed-sessions=${report.chat.malformedChatSessions} agent-events=${report.chat.agentEventsPresent ? 'excluded' : 'absent'} archived=${report.chat.archived}`,
  )
  for (const session of report.chat.sessions) {
    lines.push(JSON.stringify({ chatSession: session }))
  }
  if (report.chat.transcript !== null) {
    const t = report.chat.transcript
    lines.push(
      `chat-transcript: ${t.path} sha256=${t.sha256} bytes=${t.bytes} sessions=${t.sessions} ` +
        `rows=${t.rows} malformed-rows=${t.malformedRows} unassigned-rows=${t.unassignedRows}`,
    )
  } else {
    lines.push('chat-transcript: none')
  }
  lines.push(`pi-sessions-archived: ${report.chat.piSessionsArchived}`)
  lines.push(`assets: ${report.totals.assets}`)
  lines.push(`assets-skipped: ${report.totals.assetsSkipped}`)
  for (const asset of report.assets) {
    lines.push(JSON.stringify({ asset }))
  }
  lines.push(`segments: ${report.totals.segments}`)
  lines.push(`segments-by-status: ${JSON.stringify(report.totals.segmentsByStatus)}`)
  lines.push(`locked-segments: ${report.totals.lockedSegments}`)
  lines.push(`tm: imported=${report.totals.tmImported} unchanged=${report.totals.tmUnchanged}`)
  lines.push(`terms: imported=${report.totals.termsImported} unchanged=${report.totals.termsUnchanged}`)
  lines.push(`qa: open=${report.totals.qaOpen} waived=${report.totals.qaWaived} dropped=${report.totals.qaDropped}`)
  lines.push(`proposals-archived: ${report.totals.proposalsArchived}`)
  lines.push(`exports-archived: ${report.totals.exportsArchived}`)
  lines.push(`ledger: present=${report.ledger.present} valid=${report.ledger.valid} events=${report.ledger.events} reviews-applied=${report.ledger.reviewsApplied}`)
  for (const archive of report.archives) {
    lines.push(JSON.stringify({ archive }))
  }
  lines.push(`dropped-fields: ${JSON.stringify(report.droppedFields)}`)
  lines.push(`coercions: ${JSON.stringify(report.coercions)}`)
  lines.push(`sidecar: ${report.sidecar.path} written=${report.sidecar.written}`)
  for (const note of report.notes) {
    lines.push(JSON.stringify({ note }))
  }
  for (const step of report.rollback) {
    lines.push(`rollback: ${step}`)
  }
  return lines
}

/** JSON rendering: the whole report as one document. */
export function renderImportJson(report: ImportReport): string {
  return JSON.stringify(report, null, 2)
}
