export { ContextInspector, type ContextInspectorProps } from "./ContextInspector.tsx";
export { InspectorPane, type InspectorPaneProps } from "./InspectorPane.tsx";
export {
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_KEYBOARD_STEP,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_MAIN_WIDTH,
  INSPECTOR_MIN_WIDTH,
  clampInspectorWidth,
  inspectorWidthBounds,
  inspectorWidthForKey,
} from "./inspector-layout.ts";
export {
  activityDetailBody,
  artifactEvidence,
  followUpTargetForSelection,
  inspectorFieldLabel,
  segmentLinkedItems,
  type InspectorFollowUpTarget,
  type InspectorLinkedSelection,
  type InspectorSelection,
  type SegmentTaskItems,
} from "./inspector-model.ts";
