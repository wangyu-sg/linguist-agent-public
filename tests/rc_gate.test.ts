import assert from "node:assert/strict";
import { buildRcGateReport, openCriticalRisks, parseKnownRisksMarkdown, renderRcGateReport } from "@linguist-agent/cat-data";

const risks = parseKnownRisksMarkdown(`# Known Risks

| ID | Severity | Status | Area | Summary |
|---|---|---|---|---|
| KR-001 | P0 | open | Delivery | Tag corruption in export. |
| KR-002 | P2 | monitoring | UI | Polish issue. |
| KR-003 | P1 | closed | Evidence | Fixed evidence gate. |
`);

assert.equal(risks.length, 3);
assert.deepEqual(openCriticalRisks(risks).map((risk) => risk.id), ["KR-001"]);

const report = buildRcGateReport({
  checkedAt: "2026-05-29T00:00:00.000Z",
  reportPath: "/tmp/report.md",
  version: "0.89.0",
  commands: [
    { name: "typecheck", command: "npm run typecheck", status: "pass", exitCode: 0, durationMs: 10 },
  ],
  risks,
});

assert.equal(report.status, "fail");
assert.match(report.failures.join("\n"), /KR-001/);
assert.match(renderRcGateReport(report), /LA RC Gate Report/);

const pass = buildRcGateReport({
  checkedAt: "2026-05-29T00:00:00.000Z",
  reportPath: "/tmp/report.md",
  version: "0.89.0",
  commands: [{ name: "typecheck", command: "npm run typecheck", status: "pass", exitCode: 0 }],
  risks: risks.map((risk) => ({ ...risk, status: "closed" as const })),
});
assert.equal(pass.status, "pass");

console.log("rc_gate tests passed");
