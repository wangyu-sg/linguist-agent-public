import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTeamEvidenceChildRuntime } from "../../packages/cat-runtime/src/teamEvidenceChildRuntime.js";

export default function teamEvidenceChild(pi: ExtensionAPI): void {
  registerTeamEvidenceChildRuntime(pi);
}
