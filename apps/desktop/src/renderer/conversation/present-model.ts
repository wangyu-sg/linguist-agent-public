import { parseRichArtifactDocument, type RichArtifactDocumentV1 } from "../../../../../packages/cat-data/src/rich_artifact.ts";
import type { TaskArtifact } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

/** agent_present artifact → 经 canonical schema 校验的声明式文档;非 present 类型或非法内容返回 null,Renderer 不伪造。 */
export function agentPresentDocument(artifact: TaskArtifact): RichArtifactDocumentV1 | null {
  if (artifact.type !== "agent_present") return null;
  try {
    return parseRichArtifactDocument(artifact.content.document);
  } catch {
    return null;
  }
}
