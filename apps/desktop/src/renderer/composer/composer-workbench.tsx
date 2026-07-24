import type { RefObject } from "react";
import type { TaskUsage } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";
import {
  ComposerAddDisclosure,
  ContextUsageDisclosure,
  ModelDisclosure,
  type ComposerData,
  type ComposerRouteSelection,
} from "./composer-controls.tsx";
import type { AgentSessionInfo, PiProviderCatalog } from "../data/workspace-client.ts";

/**
 * Shared composer control clusters. Both composer assemblies (Batch first
 * turn and Task conversation) used to hand-wire these disclosures; the
 * mapping now lives exactly once here. Action semantics (send/stop/create)
 * stay with each assembly — only the shared asset/model chrome is unified.
 */

export function ComposerAssetControls({ data, disabled = false }: {
  data: ComposerData;
  disabled?: boolean;
}) {
  return (
    <ComposerAddDisclosure
      assets={data.assetCatalog}
      assetError={data.assetError}
      assetState={data.assetState}
      capabilityCatalog={data.capabilityCatalog}
      capabilityState={data.capabilityState}
      disabled={disabled}
      isImportingAssets={data.isImportingAssets}
      onImportAssets={() => void data.importProjectAssets()}
      onToggleAsset={data.toggleAsset}
      onToggleCapability={data.toggleCapability}
      selectedAssetPaths={data.selectedAssetPaths}
      selectedCapabilityIds={data.selectedCapabilityIds}
    />
  );
}

export function ComposerModelControls({ session, taskUsage, providers, selection, onChange, disabled = false, onOpenSettings, detailsRef }: {
  session: AgentSessionInfo | null;
  taskUsage?: TaskUsage;
  providers: PiProviderCatalog | null;
  selection: ComposerRouteSelection;
  onChange: (selection: ComposerRouteSelection) => void;
  disabled?: boolean;
  onOpenSettings?: () => void;
  detailsRef?: RefObject<HTMLDetailsElement | null>;
}) {
  return (
    <>
      <ContextUsageDisclosure session={session} taskUsage={taskUsage} />
      <ModelDisclosure
        detailsRef={detailsRef}
        disabled={disabled}
        onChange={onChange}
        onOpenSettings={onOpenSettings}
        providers={providers}
        selection={selection}
      />
    </>
  );
}
