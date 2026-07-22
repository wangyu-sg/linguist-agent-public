import type { SegmentEvidenceSnapshot } from "../data/workspace-client.ts";

export type SegmentEvidenceGroup =
  | { kind: "tm"; label: "TM"; matches: SegmentEvidenceSnapshot["tmMatches"] }
  | { kind: "termbase"; label: "Termbase"; matches: SegmentEvidenceSnapshot["termbaseMatches"] }
  | { kind: "glossary"; label: "Glossary"; matches: SegmentEvidenceSnapshot["glossaryMatches"] };

export function segmentEvidenceGroups(snapshot: SegmentEvidenceSnapshot): SegmentEvidenceGroup[] {
  return [
    { kind: "tm", label: "TM", matches: snapshot.tmMatches },
    { kind: "termbase", label: "Termbase", matches: snapshot.termbaseMatches },
    { kind: "glossary", label: "Glossary", matches: snapshot.glossaryMatches },
  ];
}

export function segmentEvidenceSummaryRows(snapshot: SegmentEvidenceSnapshot): Array<{ label: string; value: number }> {
  return [
    { label: "TM", value: snapshot.summary.tm },
    { label: "精确", value: snapshot.summary.tmExact },
    { label: "模糊", value: snapshot.summary.tmFuzzy },
    { label: "Termbase", value: snapshot.summary.termbase },
    { label: "Glossary", value: snapshot.summary.glossary },
  ];
}
