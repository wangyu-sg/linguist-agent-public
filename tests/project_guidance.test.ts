import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkspace,
  formatProjectGuidance,
  isProjectGuidanceDecision,
  readProjectGuidance,
  writeProjectGuidance,
  type ProjectGuidanceDecision,
} from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-project-guidance-"));
try {
  const workspace = createWorkspace(root, "project-guidance");
  const guidance: ProjectGuidanceDecision[] = [
    { id: "guide-1", scope: "style", text: "Keep character titles concise.", createdAt: "2026-07-14T00:00:00.000Z", source: "user" },
    { id: "guide-2", scope: "term", text: "Use Rift for 裂隙 in this project.", createdAt: "2026-07-14T00:01:00.000Z" },
    { id: "guide-3", scope: "dup", text: "Identical menu labels share one target.", createdAt: "2026-07-14T00:02:00.000Z" },
  ];

  assert.equal(guidance.every(isProjectGuidanceDecision), true);
  assert.equal(isProjectGuidanceDecision({ ...guidance[0], scope: "approval" }), false);
  assert.equal(isProjectGuidanceDecision({ ...guidance[0], text: "" }), false);
  assert.equal(isProjectGuidanceDecision({ ...guidance[0], createdAt: "not-a-date" }), false);

  assert.deepEqual(await writeProjectGuidance(workspace, guidance), guidance);
  assert.deepEqual(await readProjectGuidance(workspace), guidance);
  const durable = JSON.parse(await readFile(join(root, "data", "projects", "project-guidance", "agent_decisions.json"), "utf8"));
  assert.deepEqual(durable.decisions, guidance, "existing durable filename/schema must remain readable during the semantic rename");

  const prompt = formatProjectGuidance(guidance, 2);
  assert.match(prompt, /Project guidance \(latest 2 of 3/);
  assert.doesNotMatch(prompt, /Keep character titles concise/);
  assert.match(prompt, /Use Rift/);
  assert.match(prompt, /NOT citable evidence/);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("project_guidance tests passed");
