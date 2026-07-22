import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmVoiceProfile, createProjectManifest, createWorkspace, importCsvBatch, runQualityAudit, upsertVoiceProfile } from "@linguist-agent/cat-data";
import { buildCatTools } from "@linguist-agent/cat-tools";

const root = await mkdtemp(join(tmpdir(), "la-expressive-audit-"));
const customerRoot = join(root, "customer");
await mkdir(customerRoot, { recursive: true });
const csvPath = join(customerRoot, "batch.csv");
await writeFile(
  csvPath,
  [
    "SegmentID,Source,Target,Status",
    // nested "of ... of ... of" calque -> TRANSLATIONESE_PATTERN (nested_of_chain)
    "s1,东方天界的守护之门,The gate of the heaven of the east of the realm,draft",
    // mechanical light-verb for 作出 -> TRANSLATIONESE_PATTERN (mechanical_light_verb)
    "s2,作出决定,Make a decision,draft",
    // clean idiomatic line -> no expressive finding
    "s3,天关开启,Celestial Gate opens,draft",
    // confirmed voice profile should catch this casual register
    "s4,请立即开始,Okay, start now.,draft",
    // source-script leakage -> TRANSLATIONESE_PATTERN (residual_cjk_script)
    "s5,领取奖励,领取 rewards,draft",
    // CJK/fullwidth punctuation -> TRANSLATIONESE_PATTERN (cjk_punctuation)
    "s6,开始挑战,Start challenge，now,draft",
  ].join("\n"),
  "utf8",
);

await createProjectManifest(root, customerRoot, {
  projectId: "exa",
  sourceLanguage: "zh-CN",
  targetLanguage: "en-US",
});
await importCsvBatch(root, { projectId: "exa", csvPath, batchId: "b1" });
await upsertVoiceProfile(root, "exa", "b1", {
  status: "draft",
  updatedBy: "test",
  entries: [
    { id: "vp-ui", textType: "ui", speaker: null, register: "formal", taboos: ["okay"] },
  ],
});
await confirmVoiceProfile(root, "exa", "b1", "test");

const workspace = createWorkspace(root, "exa");
const tools = buildCatTools(workspace);
const expressiveAuditTool = tools.find((tool) => tool.name === "expressive_audit");
const qualityAuditTool = tools.find((tool) => tool.name === "quality_audit");
assert.ok(expressiveAuditTool, "expressive_audit tool must be registered");
assert.ok(qualityAuditTool, "quality_audit tool must be registered");

// --- quality_audit now surfaces expressive findings in its report ---
const report = await runQualityAudit(root, "exa", "b1");
const translationese = report.findings.filter((finding) => finding.code === "TRANSLATIONESE_PATTERN");
assert.equal(translationese.length, 4, "expected four translationese findings (nested_of_chain + mechanical_light_verb + source-script leakage + CJK punctuation)");
assert.ok(
  translationese.some((finding) => finding.segmentId === "s1" && finding.message.includes("Nested 'of' chain")),
  "s1 should flag the nested-of-chain calque",
);
assert.ok(
  translationese.some((finding) => finding.segmentId === "s2" && finding.message.includes("light-verb")),
  "s2 should flag the mechanical light-verb calque",
);
assert.ok(
  translationese.some((finding) => finding.segmentId === "s5" && finding.message.includes("CJK script")),
  "s5 should flag source-script leakage in an English target",
);
assert.ok(
  translationese.some((finding) => finding.segmentId === "s6" && finding.message.includes("punctuation")),
  "s6 should flag CJK/fullwidth punctuation in an English target",
);
assert.equal(report.findings.some((finding) => finding.segmentId === "s3" && finding.code === "TRANSLATIONESE_PATTERN"), false, "s3 is clean and must not be flagged");
assert.ok(report.summary.translationesePatterns >= 4, "summary must count translationese findings");
assert.equal(report.summary.voiceInconsistencies, 1, "confirmed voice taboo should be counted");
assert.equal(report.summary.registerMismatches, 1, "confirmed register mismatch should be counted");
// Expressive findings are advisory warnings, never blockers.
assert.equal(
  report.findings.filter((finding) => ["TRANSLATIONESE_PATTERN", "VOICE_INCONSISTENCY", "REGISTER_MISMATCH"].includes(finding.code)).every((finding) => finding.severity === "warning"),
  true,
  "expressive findings must be warnings, not blockers",
);

// --- expressive_audit tool filters to expressive findings only ---
const expressiveResult = await expressiveAuditTool.execute("tool-call", { batchId: "b1" });
assert.match(expressiveResult.content[0].text, /Expressive audit/);
assert.match(expressiveResult.content[0].text, /TRANSLATIONESE_PATTERN/);
assert.match(expressiveResult.content[0].text, /VOICE_INCONSISTENCY/);
assert.match(expressiveResult.content[0].text, /REGISTER_MISMATCH/);
assert.equal(expressiveResult.details.openExpressive, 6, "expressive_audit should report translationese plus confirmed voice/register findings");
assert.equal(expressiveResult.details.translationesePatterns, 4);
assert.equal(expressiveResult.details.voiceInconsistencies, 1);
assert.equal(expressiveResult.details.registerMismatches, 1);
// It must NOT include term/TM findings in its filtered output details.
assert.equal(expressiveResult.details.findings, 6, "filtered expressive findings count");
const expressivePage = await expressiveAuditTool.execute("tool-page", { batchId: "b1", start: 1, limit: 2 });
assert.equal(expressivePage.details.returned, 2);
assert.equal(expressivePage.details.nextStart, 3);
assert.match(expressivePage.content[0].text, /Showing 2\/6 open expressive finding/);

// --- quality_audit tool still works and includes expressive findings in full report ---
const qualityResult = await qualityAuditTool.execute("tool-call", { batchId: "b1" });
assert.match(qualityResult.content[0].text, /Quality audit/);
// The expressive findings appear in the full quality_audit output too (same engine).
assert.equal(qualityResult.details.findings, report.findings.length);
const qualityPage = await qualityAuditTool.execute("tool-page", { batchId: "b1", start: 1, limit: 2 });
assert.equal(qualityPage.details.returned, 2);
assert.equal(qualityPage.details.nextStart, 3);
assert.match(qualityPage.content[0].text, /Next start: 3/);

// --- expressive_audit is visible in the translate workflow mode ---
const { renderCatToolCatalog } = await import("@linguist-agent/cat-tools");
const translateCatalog = renderCatToolCatalog({ mode: "translate", includeWriteTools: true });
assert.match(translateCatalog, /expressive_audit/, "expressive_audit must be selectable in translate mode");
assert.match(translateCatalog, /quality_audit/);

console.log("expressive audit tests passed");
