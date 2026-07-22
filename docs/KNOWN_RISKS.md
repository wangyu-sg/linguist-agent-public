# Known Risks

P0/P1 risks must be `closed` before a release candidate can pass. `accepted` does not pass for P0/P1; it is only a marker for lower-priority follow-up.

| ID | Severity | Status | Area | Summary |
|---|---|---|---|---|
| KR-001 | P2 | monitoring | Platform Backfill bridge | Production Chrome/Phrase execution adapters and structured QA ignore verification are not implemented as callable web bridges; Browser automation remains policy-blocked until adapter safeguards exist. |
| KR-002 | P1 | closed | CAT data store | Closed by Phase A offline harness eval: `tests/harness_eval_smoke.test.ts` + `packages/cat-runtime/eval/fixtures/harness/security-smoke.json` exercise `guardNonCatToolCall` as a name-independent default-deny guard for non-CAT, non-exempt tools targeting `data/**`, including novel write verbs (`multi_edit` / `apply_patch`), allowed non-data writes, read-exempt access, and the srt `denyWrite data` config path; `rc:status` now gates on `harness_security_eval`. |
| KR-003 | P1 | closed | Cross-tool exfiltration | Closed by Phase A offline harness eval coverage plus floor① harness controls: synthetic fixture exercises advisory `citable:false` tagging, exact-host egress allowlist rejection for wildcard/null-byte hosts, credential `denyRead ~/.agent-reach ~/.ssh ~/.aws`, and secret env scrub. Tool trace remains audit data, not CAT evidence. |
| KR-004 | P1 | closed | General Pi resources | General startup resolves resources before Extension evaluation, requires canonical path-plus-SHA trust for unknown user/global executable code, freezes one immutable per-Run snapshot, fails on changed/missing bytes, and records winner/shadowed conflicts. Covered by `pi_extension_trust`, `general_agent_session`, and `general_agent_runs` tests. |
| KR-005 | P2 | open | MinerU Labs | The worker/tool boundary exists but the exact managed MinerU pack is unqualified on this machine. It fails closed and has no undeclared system/cloud fallback. Complete the fixture, network, source-digest, output-reopen, performance, and recovery gate before changing its state to ready. |
