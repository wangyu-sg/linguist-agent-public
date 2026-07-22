export { CatWorkspace, type CatWorkspaceProps } from "./CatWorkspace.tsx";
export {
  adjacentSegmentId,
  filterSegments,
  insertLiteralAt,
  nextEditableSegmentId,
  plainTextLength,
  relocateDetectedTags,
  segmentIssueCount,
  segmentNumber,
  tokensFromDetectedTags,
} from "./cat-model.ts";
export { ChipEditor, type ChipEditorHandle, type ChipEditorProps } from "./ChipEditor.tsx";
export { MatchDock, type MatchDockProps } from "./MatchDock.tsx";
export { SegmentDraftController, type SegmentDraftSnapshot } from "./segment-draft.ts";
