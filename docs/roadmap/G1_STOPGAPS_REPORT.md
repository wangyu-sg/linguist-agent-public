# G1 Stopgaps Gate Report

Date: 2026-07-22  
Baseline: `64bcb15bed78a5d71d91d791948b7652987267d5`  
Candidate before this report: `cfe41ec1e99c02c7563c6f3fcb11b1ce105ff04a`  
Scope: Phase 0 only; synthetic/temp fixtures only; public mirror untouched.

## Result

**PASS for continued private-repository implementation.** Public reuse, open-source claims, contribution intake, signing, notarization, merge, and release remain blocked.

All executable Phase 0 Tickets are complete. LA-059 remains a non-executable blocked Decision because no user/legal license choice was made. R-030 is contained for the campaign by the existing source-available statement, clean-room rule, ban on third-party/AGPL/reverse-engineered source copying, and the prohibition on touching the public mirror before final verification. It is not represented as a chosen license.

## P0 controls

| Risk | Gate evidence |
|---|---|
| R-001 invalid permission mode | LA-001 rejects unknown/invalid values. |
| R-002 mutable sandbox configuration | LA-002 serializes the single manager boundary; LA-007 forces Stable enforcement. Per-Run isolation remains the LA-017 Epic. |
| R-003 unbudgeted prompt launch | LA-003 blocks unknown/overflow budgets; LA-065/066 repaired full-suite fixtures without weakening the guard. |
| R-004 Package preview side effects | LA-004 removes npm/subprocess work from Stable preview and rejects install-time dependency forms. |
| R-005 Stable executable Extension | LA-005 blocks Stable General/Team loading; LA-063 aligns full-suite coverage. Capability isolation remains LA-019. |
| R-030 license/clean-room | Current state is source-available; no open-source claim or code-copy permission; LA-059 license choice remains BLOCKED. |

Stable Maintainer and Private Eval mutations are also blocked by LA-060/061 while canonical historical records remain readable.

## Full verification

- `npm test`: passed after Gate repair Tickets LA-063 through LA-066.
- `npm --prefix apps/desktop test`: passed, 149 Desktop tests plus 3 activity-producer tests.
- `npm run mac:test`: passed; includes Desktop tests and Desktop typecheck. This is source/headless evidence, not real-machine P3.
- `npm run typecheck`: passed.
- `npm --prefix apps/desktop run typecheck`: passed.
- `npm run roadmap:test`: passed.
- `npm run release:check`: passed.
- `git diff --check`: passed.

Known skip: `asset_rag_multilingual_eval` reported its existing managed-E5-pack skip. This Gate does not convert that skip into qualification evidence.

## Gate failures and repair Tickets

1. First `npm test` failed because `team_child_rpc_adapter.test.ts` still expected Stable executable Package Extensions. LA-063 migrated the test and preserved Skill/Prompt RPC coverage.
2. Second run failed because `runtime_hooks.test.ts` still constructed removed Stable `full` mode. LA-064 retained the rejection assertion and moved permissive-hook coverage to an explicit supported custom policy.
3. Third run failed because `subagent_task_activity_workflow.test.ts` omitted an explicit verified model budget. LA-065 added a synthetic supported-model fixture.
4. Fourth run failed because `workflow_plan.test.ts` expected unknown-budget startup. LA-066 now tests both blocked unknown budget and active verified budget.

No Gate failure was suppressed, skipped, or fixed by changing production behavior.

## Data-boundary incident

`npm run rc:status` was mistakenly invoked during the final command bundle even though the campaign forbids modifying real `data/**`. It generated exactly one report at `data/reports/la_rc_status_2026-07-22T16-39-11-072Z.md`. Its content was not read; the exact newly generated file was immediately removed. The command is excluded from Gate evidence and must not be repeated during this campaign. No other `data/**` path may be inspected to infer whether it changed.

## Migration, writer, and deletion checks

- No runtime schema or user-data migration was executed.
- No dual write was introduced.
- Canonical Task/workspace writers are unchanged.
- No deletion candidate was prematurely removed; LA-050/LA-017/LA-019 and later child Tickets retain their explicit deletion/parity gates.
- Public mirror and remote were not read, modified, or pushed.

## Open items not proven by G1

- LA-059 license/contribution-policy Decision.
- Per-Run process isolation and Extension capability isolation.
- Managed E5 and MinerU/Unlimited-OCR qualification.
- Human fixed-seed quality review.
- Real-machine P3, VoiceOver, signing, notarization, clean install, upgrade, rollback, and uninstall.

