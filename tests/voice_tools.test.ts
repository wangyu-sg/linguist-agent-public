import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCatTools, renderCatToolCatalog } from "@linguist-agent/cat-tools";
import { createProjectManifest, createWorkspace, importCsvBatch, readVoiceProfile } from "@linguist-agent/cat-data";

const root = await mkdtemp(join(tmpdir(), "la-voice-tools-"));
const customerRoot = join(root, "customer");
await mkdir(customerRoot, { recursive: true });
const csvPath = join(customerRoot, "batch.csv");
await writeFile(
  csvPath,
  ["SegmentID,Source,Target,Status", "s1,巅峰对决,The Pinnacle,draft", "s2,帮派联赛,Guild League,draft"].join("\n"),
  "utf8",
);
await createProjectManifest(root, customerRoot, { projectId: "voice-tools", sourceLanguage: "zh-CN", targetLanguage: "en-US" });
await importCsvBatch(root, { projectId: "voice-tools", csvPath, batchId: "b1" });

const workspace = createWorkspace(root, "voice-tools");
const tools = buildCatTools(workspace);
const tool = (name: string) => {
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found, `${name} should be registered`);
  return found;
};

const build = await tool("voice_profile_build").execute("call", { batchId: "b1" });
assert.match(build.content[0].text, /Voice profile draft/);
let profile = await readVoiceProfile(root, "voice-tools", "b1");
assert.equal(profile.status, "draft");
assert.ok(profile.entries.length >= 1, "voice_profile_build should create draft entries");

const confirm = await tool("voice_profile_confirm").execute("call", { batchId: "b1", confirmedBy: "test" });
assert.match(confirm.content[0].text, /confirmed/);
profile = await readVoiceProfile(root, "voice-tools", "b1");
assert.equal(profile.status, "confirmed");

const add = await tool("exemplar_add").execute("call", {
  textType: "ui",
  source: "巅峰对决",
  target: "The Pinnacle",
  register: "polished game UI",
  evidenceSource: "test:golden",
});
assert.match(add.content[0].text, /Voice exemplar added/);

const lookup = await tool("exemplar_lookup").execute("call", { textType: "ui", limit: 5 });
assert.match(lookup.content[0].text, /The Pinnacle/);

const translateCatalog = renderCatToolCatalog({ mode: "translate", includeWriteTools: true });
assert.match(translateCatalog, /voice_profile_build/);
assert.match(translateCatalog, /voice_profile_confirm/);
assert.match(translateCatalog, /exemplar_lookup/);
assert.match(translateCatalog, /exemplar_add/);

console.log("voice tools tests passed");
