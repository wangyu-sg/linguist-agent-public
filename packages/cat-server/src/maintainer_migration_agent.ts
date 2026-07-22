import { join } from "node:path";
import type { AgentSessionEvent, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createMaintainerAgentSession } from "@linguist-agent/cat-runtime";
import type { MaintenanceMigrationReport, MaintenancePlan } from "./maintainer.js";

export async function runMaintainerMigrationAgent(input: {
  repoRoot: string;
  candidateRoot: string;
  plan: MaintenancePlan;
  modelRuntime: ModelRuntime;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<MaintenanceMigrationReport> {
  if (!input.modelProvider || !input.modelId) {
    throw new Error("Maintainer migration requires a configured Pi model provider and model.");
  }
  const created = await createMaintainerAgentSession({
    candidateRoot: input.candidateRoot,
    sessionRoot: join(input.repoRoot, "data", "assistant", "maintainer", "sessions", input.plan.planHash),
    planHash: input.plan.planHash,
    currentPiVersion: input.plan.current.piVersion,
    targetPiVersion: input.plan.target.piVersion,
    modelRuntime: input.modelRuntime,
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
  });
  let summary = "";
  const unsubscribe = created.session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      summary += event.assistantMessageEvent.delta;
    }
  });
  try {
    await created.session.prompt([
      `Inspect this isolated candidate for the approved Pi ${input.plan.current.piVersion} to ${input.plan.target.piVersion} transition.`,
      "The host already updated exact dependency pins and installed dependencies without lifecycle scripts.",
      "Read the candidate diff, updated Pi package source/types, LA runtime adapters, and focused tests.",
      "If compatibility edits are required, make the smallest complete source/test changes inside this candidate. If none are required, leave files unchanged and explain why.",
      "Do not change product scope or weaken permission, CAT, evidence, QA, delivery, Package, or runtime protocol gates.",
      "Return a concise migration summary; deterministic validation runs after your session ends.",
    ].join("\n"));
    await created.session.waitForIdle();
    return {
      status: "completed",
      summary: summary.trim() || "Maintainer Agent completed compatibility inspection without a text summary.",
      sessionId: created.session.sessionId,
    };
  } finally {
    unsubscribe();
    created.session.dispose();
  }
}
