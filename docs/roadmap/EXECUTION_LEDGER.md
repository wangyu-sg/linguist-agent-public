# Linguist Agent Evolution Execution Ledger

Campaign branch: `evolution/la-3-candidate`

Baseline branch: `main`

Baseline commit: `64bcb15bed78a5d71d91d791948b7652987267d5`

Baseline upstream: `origin/main`

Public mirror: deferred until final verification.

`resultCommit: SELF` means the commit containing that ledger entry. A Git commit cannot embed its own final SHA without changing that SHA; the immutable commit containing the entry is the result reference.

## Stage Gate G1 — Stopgaps

- status: passed_for_private_campaign_continuation
- candidateCommit: `cfe41ec1e99c02c7563c6f3fcb11b1ce105ff04a` before the report commit
- report: `docs/roadmap/G1_STOPGAPS_REPORT.md`
- tests: full backend, full Desktop, mac:test, root/Desktop typecheck, roadmap validator, release check, diff check passed
- blockers: LA-059 future license/contribution-policy choice remains blocked; public reuse/release remains prohibited
- excludedEvidence: `rc:status` generated one forbidden data report; the exact new report was removed unread and the command is not Gate evidence
- realMachine: not proven

## Stage Gate G2 — Runtime Contract

- status: passed_for_private_campaign_continuation
- candidateCommit: `5c4e38c2`
- report: `docs/roadmap/G2_RUNTIME_CONTRACT_REPORT.md`
- tests: 174 root, 150 Desktop plus 3 activity, mac:test, 20 security, 8 recovery, root/Desktop typecheck, roadmap validator, release check and diff check passed after LA-067 repaired the first Gate attempt
- blockers: LA-059 license/contribution-policy Decision remains blocked; public reuse/release remains prohibited
- excludedEvidence: the first Desktop Gate attempt failed on Node strip-only-incompatible shared-contract syntax and remains recorded in the report; it was not counted as a pass
- realMachine: provider, packaged-app, accessibility, signing, notarization and customer-data evidence not proven

## Stage Gate G3 — Isolation

- status: passed_for_private_campaign_continuation
- candidateCommit: `6b16f174d07bfc60298e5c841cc93ef26c236a89` before the report commit
- report: `docs/roadmap/G3_ISOLATION_REPORT.md`
- tests: 193 root, 151 Desktop plus 3 activity, mac:test, 26 security, 9 recovery, root/Desktop typecheck, roadmap validator, release check and diff check passed
- blockers: LA-059 license/contribution-policy Decision and publisher trust-root governance remain blocked; public reuse/release remains prohibited
- excludedEvidence: managed E5 acceptance skipped because its pack is absent; no real provider, installed app, signing, notarization, accessibility, power-loss or customer-data evidence
- realMachine: not proven

## Stage Gate G4 — Storage

- status: passed_for_private_campaign_continuation
- candidateCommit: `86444f13` before this report commit
- report: `docs/roadmap/G4_STORAGE_REPORT.md`
- tests: full root suite (211 discovered; declared Managed E5 pack skip), security suite, recovery suite (18 tests), Desktop (151 Node plus 3 Electron activity tests), `npm run mac:test`, root/Desktop typecheck, roadmap tests/validation, release check, ledger JSON parse and `git diff --check` passed
- stopgap: LA-106 isolated both server-starting fixtures behind explicit synthetic repository and Pi-agent roots under guarded test mode; the full G4 recheck completed without reading checkout `data/**` or real home Pi trust
- historicalBlocker: the pre-LA-106 attempt was correctly blocked because those fixtures used the checkout root; see `G4_STORAGE_REPORT.md` Initial blocked attempt (preserved)
- unverifiedRealMachineItems: real data, real Pi trust, customer content, installed runtime, process kill, power loss, disk full, production rollback, signing/notarization, and public mirror remain unverified

## Stage Gate G5 — Product

- status: passed_for_private_campaign_continuation
- candidateCommit: `a3c426a0` before this report commit
- report: `docs/roadmap/G5_PRODUCT_REPORT.md`
- completedPhaseTickets: LA-038, LA-039, LA-040, LA-041, LA-042, LA-043, LA-117, LA-118, LA-119, LA-120, LA-121, LA-122
- passedEvidence: fresh direct `npm test` (231 discovered root tests; declared managed-E5-pack skip); `npm run test:security` (29 selected tests); `npm run test:recovery` (19 selected tests); Desktop build; 161 Desktop Node plus 3 Electron activity tests; `npm run mac:test`; root/Desktop typecheck; roadmap test/validation; release check; ledger JSON parse; diff check. The test suite used only the LA-118-121 authorized synthetic root/material view and did not access real `data/**`.
- initialBlocker: the requested `npm test` did not start because its root discovery process had not guaranteed a disposable synthetic repository and Pi-agent root for every child test; it could reach checkout `data/**`, which the campaign forbids
- repairTicket: LA-117 completed the per-child synthetic-root runner and direct literal server-launch inheritance guard; LA-118 completed the authorized actual-cwd source-view repair for the checkout-cwd data-read path; LA-119 completed the precise tracked project-Pi-material repair; LA-120 completed the one-file Dev-context repair; LA-121 completed the one-file Team-extension repair; LA-122 completed the canonical Electron lease-guard repair
- historicalBlocker: after LA-117, direct rechecks separately exposed checkout cwd access, three required tracked static materials, and a stale deleted `main.mjs` lease guard. LA-118 through LA-122 each repaired one invariant in its own commit; no data path was accessed. The fresh full execution above is the only G5 gate evidence.
- excludedEvidence: earlier G4 full-suite evidence predates Phase 5; focused ticket/Desktop evidence is not full-suite/security/recovery/macOS proof; the declared E5 pack skip is not E5 qualification evidence.
- tag: local annotated `la-g5-product` is created at this report commit
- blockedContinuation: final verification; public mirror work; release and merge remain blocked by later work and R-030 as applicable
- remainingRisks: source-level synthetic-root isolation is not an OS sandbox; managed E5 qualification, real-machine P3/accessibility/installed-app proof, signing/notarization, and R-030 legal/release Decision remain open
- realMachine: not proven

## LA-000 — Roadmap documentation consistency

- status: completed
- dependencies: LA-BASE
- baseCommit: `64bcb15bed78a5d71d91d791948b7652987267d5`
- resultCommit: `SELF`
- filesChanged: seven-document roadmap control plane, documentation governance, sanitized UI behavior contract, roadmap validator, validator test, npm scripts
- testsAdded: `tests/validate_roadmap.test.ts`
- commandsExecuted: `npm run roadmap:test`; `npm run roadmap:validate`; `npm run typecheck`; `npm run release:check`; `git diff --check`; `npm run rc:status`
- migration: none; no database or runtime schema created
- rollback: revert this commit; no data rollback required
- deletedEntries: none; original reports and research input retained but downgraded from execution authority
- remainingRisks: R-001 through R-031 remain owned by their mapped tickets; R-030 requires user/legal decision
- unverifiedRealMachineItems: MinerU qualification, human blind review, accessibility/P3, signing and notarization remain open

## LA-001 — Reject invalid permission modes

- status: completed
- dependencies: LA-000
- baseCommit: `a15e6fb6b1de7f5c8ebdab4f8b80ae5d25bd13fd`
- resultCommit: `SELF`
- filesChanged: shared permission normalization, safe missing-global default, permission behavior test, ledgers
- testsAdded: invalid normalize/patch/contract and API rejection assertions in `tests/agent_permissions.test.ts`
- commandsExecuted: focused agent permission test; permission decision test; typecheck; diff check
- migration: valid stored values remain unchanged; missing global mode becomes `ask`; invalid stored values remain intact and block instead of widening
- rollback: revert this commit; never restore unknown-to-auto behavior
- deletedEntries: none
- remainingRisks: R-008 Stable `full` preset remains for LA-006
- unverifiedRealMachineItems: existing invalid values in real user data were not read or inventoried

## LA-002 — Serialize sandbox configuration and command wrapping

- status: completed
- dependencies: LA-000
- baseCommit: `a479a640abf00f40ef1f7a8b87dc1e3e6c25ac8c`
- resultCommit: `SELF`
- filesChanged: shared sandbox coordinator, CAT/General callers, concurrency test, test registration, ledgers
- testsAdded: `tests/sandbox_coordinator.test.ts`
- commandsExecuted: sandbox coordinator test; CAT safety kernel test; concurrency test; typecheck; single-updateConfig grep; diff check
- migration: none; existing runtime configs are passed unchanged
- rollback: revert this commit; do not restore independent CAT/General queues
- deletedEntries: General-only sandbox queue and standalone initialization helper
- remainingRisks: per-Run process isolation remains LA-017 Epic
- unverifiedRealMachineItems: real sandbox-runtime process interleavings outside the deterministic adapter test

## LA-003 — Block unbudgeted prompt launches

- status: completed
- dependencies: LA-000
- baseCommit: `3936e6dcff62e28d6b82191283e9d4b6519aa8b5`
- resultCommit: `SELF`
- filesChanged: prompt launch guard, Team context preparation and workflow model-budget resolution, canonical Private Eval prompt preparation, supported-model runtime budget resolver, focused tests, ledgers
- testsAdded: unknown-budget and mandatory-overflow launch assertions; Team over-budget preparation assertion; explicit verified-budget fixtures in Team and Eval route tests
- commandsExecuted: prompt compiler test; Team context builder test; Team run plan test; Team workflow foundation test; canonical Private Eval Single test; canonical Private Eval Team test; Eval route test; typecheck; diff check
- migration: no schema or user-data change; currently resolvable Pi builtin/custom models use their explicit contextWindow minus maxTokens budget; models without valid metadata are blocked
- rollback: revert this commit only if the affected prompt launch paths remain fail-closed; never restore over-budget or unknown-budget launch
- deletedEntries: none
- remainingRisks: LA-032 must include tools, history, provider framing, output reserves, untrusted-source envelopes, and the durable minimal ModelContextRegistry
- unverifiedRealMachineItems: provider framing and live custom-model metadata were not measured against a real provider request

## LA-004 — Keep Stable Package preview inert

- status: completed
- dependencies: LA-000
- baseCommit: `15ec1649ee56c2be7c6f9865f2fe9b82cd87cbdd`
- resultCommit: `SELF`
- filesChanged: Stable Package preview implementation, Package Center tests, ledgers
- testsAdded: fake-npm subprocess sentinel; metadata/archive-only fetch counts; file, Git, HTTP tarball dependency fixtures; publisher shrinkwrap fixture
- commandsExecuted: Package Center test; Package Center route test; native capability package test; typecheck; diff check; source grep for retired installer
- migration: no registry or user-data rewrite; dependency-bearing legacy packages remain readable, while new Stable previews reject install-time dependency declarations and npm-shrinkwrap
- rollback: disable Stable managed install rather than restoring npm execution during Preview
- deletedEntries: `installDependenciesWithoutScripts`, child-process import/promisified executor, Preview dependency-installer injection
- remainingRisks: LA-020 owns the declarative signed package format and activation replacement; legacy installed executable packages remain governed by LA-005/LA-019
- unverifiedRealMachineItems: no public registry package was downloaded; tests use synthetic archives only

## LA-005 — Block third-party executable Extensions in Stable Runs

- status: completed
- dependencies: LA-000
- baseCommit: `079d648d8cb181207c6748c8a5083a50d3f25d73`
- resultCommit: `SELF`
- filesChanged: Stable General resource selection, Team Package execution preflight, General/Team tests, current-state resource documentation, ledgers
- testsAdded: General hostile top-level Extension remains unevaluated with no approval request; exact LA-owned inline factory inventory; Team Package Extension blocks before launch with package identity
- commandsExecuted: General Agent session test; General Run coordinator test; Task Package Team capability test; Team Package preflight test; Pi Extension trust regression; attempted nonexistent `tests/general_resource_snapshot.test.ts` (failed before test execution and replaced by the actual General Run test); typecheck; diff check
- migration: no trust or Package data rewrite; existing digest approvals remain readable legacy records but no longer authorize a new Stable Run
- rollback: keep external Extensions disabled; a rollback may restore non-executable Skills/Prompts only, never arbitrary executable paths
- deletedEntries: none; legacy trust approval storage is retained for later migration/deletion work
- remainingRisks: LA-018 exact-byte staging and LA-019 capability-isolated Extension Host remain required before third-party execution can return
- unverifiedRealMachineItems: packaged Stable UI visibility and a real malicious Extension process-access PoC remain outside this source-level stopgap

## LA-006 — Remove the Stable full permission preset

- status: completed
- dependencies: LA-001
- baseCommit: `85dacaa557741a6959f770e543dbcc0daea0989e`
- resultCommit: `SELF`
- filesChanged: permission mode/preset contract, Desktop permission DTO/icon/style, Stable resource policy, permission tests, ledgers
- testsAdded: `full` absent from presets; direct contract, patch, and API update reject `full`; Desktop permission/settings regressions
- commandsExecuted: agent permission test; root typecheck; Desktop typecheck; Desktop permission/settings tests; production-source forbidden-pattern scan; one exploratory scan accidentally used `|| true` and was rerun with an explicit Node assertion without suppression; diff check
- migration: no stored settings were read or rewritten; a legacy stored `full` value now blocks with an explicit repair instruction to choose ask, auto, or custom
- rollback: restore only a separately gated Developer-channel mode in a future Ticket; never expose `full` in Stable
- deletedEntries: `FULL_ACCESS_RULES`, Stable `full` preset, Desktop `full` DTO union/icon/style branch
- remainingRisks: LA-014/LA-015 still replace tool-name permission classification with capability and filesystem brokers
- unverifiedRealMachineItems: packaged Settings/Composer visual absence has not yet passed real-machine P3

## LA-007 — Require sandbox enforcement in Stable

- status: completed
- dependencies: LA-002
- baseCommit: `7bf1021c3ea4f438b00fbd12748e2c79f76e32ad`
- resultCommit: `SELF`
- filesChanged: CAT sandbox phase parser/health contract, safety tests, runtime policy, ledgers
- testsAdded: Stable `off` and `observe` denial; explicit test/development capability acceptance; enforce and invalid-value controls
- commandsExecuted: CAT safety kernel test; sandbox coordinator test; typecheck; roadmap validation; release check; diff check
- migration: no environment or user-data rewrite; unset/enforce remain valid, while existing Stable off/observe configuration now fails startup/health construction visibly
- rollback: temporarily hard-code enforce; never restore environment-only downgrade
- deletedEntries: environment-only authorization of off/observe phases
- remainingRisks: LA-017 still replaces process-global sandbox configuration with per-Run isolation
- unverifiedRealMachineItems: packaged runtime launch with hostile environment injection has not yet been exercised on a real app bundle

## LA-060 — Disable Stable Maintainer execution

- status: completed
- dependencies: LA-000
- baseCommit: `2cfae5dd2d733646326efff432649668435c62fa`
- resultCommit: `SELF`
- filesChanged: Maintainer route capability gate, route characterization tests, current-state documentation, ledgers
- testsAdded: Stable preview/build mutation denial; explicit development/test capability; canonical maintenance history remains readable
- commandsExecuted: Maintainer route test; Maintainer core test; Maintainer Agent session test; typecheck; roadmap validation; release check; diff check
- migration: no jobs, candidates, plans, artifacts, or user data were read or rewritten; Stable composition omits the execution capability
- rollback: retain the Stable mutation block; a future developer/CI tool may explicitly supply the capability
- deletedEntries: none; LA-050 child tickets own later production-code migration and deletion
- remainingRisks: LA-050 still must migrate Maintainer to developer/CI tooling and remove the retained production implementation
- unverifiedRealMachineItems: packaged Stable UI absence and read-only historical rendering have not yet passed real-machine P3

## LA-061 — Disable Stable Private Eval execution

- status: completed
- dependencies: LA-000
- baseCommit: `5063a7c8b1cf1dfdf14c7ea3d0c753cc470f1380`
- resultCommit: `SELF`
- filesChanged: Eval route capability/read-only gate, Stable product-surface navigation, backend/UI characterization tests, current-state documentation, ledgers
- testsAdded: Stable mutation denied before body parsing; Stable Run listing does not reconcile/write; Stable shell has no Eval surface
- commandsExecuted: Eval route test; canonical Private Eval single/team tests; Desktop Codex UI contract test; root/Desktop typecheck; roadmap validation; release check; diff check
- migration: no Eval set, Run, corpus, output, scorecard, comparison, Task, or Artifact was deleted or rewritten; Stable GET routes remain read-only
- rollback: retain Stable mutation/navigation block; only explicit developer/CI composition may execute the retained implementation
- deletedEntries: Stable Eval toolbar/product-surface entry; no Eval data or retained implementation
- remainingRisks: LA-050 still requires separate child tickets to migrate the harness and remove production execution code
- unverifiedRealMachineItems: packaged navigation absence and historical Eval browsing have not yet passed real-machine P3

## LA-059 — Licensing and clean-room decision

- status: blocked
- dependencies: LA-000
- baseCommit: `b9ecb32fce15bb715971996fc20b3b65f9434336`
- resultCommit: `SELF`
- filesChanged: execution ledgers only; current source-available and clean-room facts were already established by LA-000
- testsAdded: none; this is a non-executable Decision
- commandsExecuted: license-file presence check; source-available/clean-room documentation scan; roadmap validation; release check; diff check
- migration: none
- rollback: not applicable; no license or legal state was changed
- deletedEntries: none
- remainingRisks: current repository remains source-available without redistribution/modification/commercial-use grant. This legal Decision blocks only public-mirror push, external contribution/reuse claims and release; it does not block private-repository Tickets, tests, phase Gates or final private verification. No license choice was made by engineering.
- unverifiedRealMachineItems: none; the unresolved item is legal/product authority, not runtime behavior

## LA-063 — Align Team child adapter regression with Stable Extension block

- status: completed
- dependencies: LA-005
- baseCommit: `966186b5e70ee0bf3c5cb40337e89913ef7da9e4`
- resultCommit: `SELF`
- filesChanged: implementation queue/risk mapping, Team child RPC adapter regression test, ledgers
- testsAdded: executable Package Extension resolution and workflow launch remain blocked; non-executable Skill/Prompt resources still run through server-owned RPC with the evidence guard
- commandsExecuted: initial G1 `npm test` failed on stale pi_rpc_v1 expectation; focused Team child RPC adapter test; roadmap validation; typecheck; diff check
- migration: none; production behavior was not changed
- rollback: do not restore stale executable-Extension expectations; rollback blocks G1
- deletedEntries: obsolete test expectations that Stable loads executable Package Extensions
- remainingRisks: LA-019 still owns capability isolation before any executable Extension can return
- unverifiedRealMachineItems: raw Pi RPC transport remains synthetic; Stable blocking is source-tested

## LA-064 — Remove deleted Stable full mode from runtime hook regression

- status: completed
- dependencies: LA-006
- baseCommit: `fd2e7894d0a50eb63524b3d47a7f8e1f9e9eed3d`
- resultCommit: `SELF`
- filesChanged: implementation queue/risk mapping, runtime hook regression test, ledgers
- testsAdded: removed Stable full mode throws; supported custom bash-auto policy still cannot bypass CAT evidence, filesystem, credential, Keychain, or child-lifecycle hard rails
- commandsExecuted: second G1 `npm test` failed on stale full fixture; focused runtime hooks test; roadmap validation; typecheck; diff check
- migration: none; production behavior was not changed
- rollback: do not restore Stable full fixtures or behavior
- deletedEntries: obsolete full-mode runtime hook fixture and names
- remainingRisks: LA-014/LA-015 still replace tool-name classification and path guards with canonical capability brokers
- unverifiedRealMachineItems: hook behavior is synthetic/in-process, not packaged-app evidence

## LA-065 — Supply verified prompt budget in Team activity regression

- status: completed
- dependencies: LA-003
- baseCommit: `22614fa6c3ec21f071cb9357a7306c6563a7ffdd`
- resultCommit: `SELF`
- filesChanged: implementation queue/risk mapping, Team workflow activity regression fixture, ledgers
- testsAdded: existing context-preparation/activity assertions now execute only with an explicit verified 100k model budget
- commandsExecuted: third G1 `npm test` failed because unknown budget correctly blocked preparation; focused subagent Task activity workflow test; roadmap validation; typecheck; diff check
- migration: none; production behavior was not changed
- rollback: do not remove the explicit budget or bypass the Prompt launch guard
- deletedEntries: implicit unknown-budget launch assumption in the fixture
- remainingRisks: LA-032 still owns complete request budgeting and durable ModelContextRegistry
- unverifiedRealMachineItems: 100k is a synthetic supported-model fixture, not live provider metadata

## LA-066 — Characterize unknown and verified budgets in workflow plan

- status: completed
- dependencies: LA-003
- baseCommit: `62deb3ebf593c45dadf9b48606ff512c34a8f70e`
- resultCommit: `SELF`
- filesChanged: implementation queue/risk mapping, workflow plan regression fixture, ledgers
- testsAdded: unknown model budget remains awaiting_input; explicit verified 100k budget permits the prepared non-executing Team Run to become active
- commandsExecuted: fourth G1 `npm test` failed on stale active expectation; focused workflow plan test; roadmap validation; typecheck; diff check
- migration: none; production behavior was not changed
- rollback: retain both branches; never make unknown budget executable
- deletedEntries: unconditional active expectation for an unknown-budget Team start
- remainingRisks: LA-032 still owns final request budgeting and durable ModelContextRegistry
- unverifiedRealMachineItems: 100k is a synthetic fixture, not live provider capability evidence

## LA-053 — Discover and shard every root test

- status: completed
- dependencies: LA-000
- baseCommit: `0f7d0168e0a9b70cfc751a9b0bfe3c94d9200812`
- resultCommit: `SELF`
- filesChanged: root package test scripts, discovery/selection runner, runner characterization test, ledgers
- testsAdded: recursive test/spec discovery; old-chain parity and missing-file error; newly discovered test inclusion; named security suite; disjoint two-way shard coverage; legacy-order migration
- commandsExecuted: initial focused failure for missing runner module; focused runner test; roadmap suite; two-way roadmap shard execution; standalone runner TypeScript check; root typecheck; first full run exposed alphabetical-order incompatibility at asset API; sandboxed full run was blocked by the existing Team cache path; sandbox-exempt `npm test` passed all 168 discovered root tests; diff check
- migration: the prior 164-entry pre/test/post chain is retained verbatim under `test:legacy:*` as a one-version parity and ordering snapshot; the new runner executes those tests in their established order and appends four automatically discovered tests
- rollback: restore the legacy lifecycle entrypoints for one version while retaining the missing-test detector; do not return CI to an unverified hand-maintained set
- deletedEntries: npm lifecycle `pretest` and `posttest` entrypoints; their exact commands remain as non-executing legacy snapshots
- remainingRisks: LA-054 must split CI suites and retire the legacy snapshot only after shard parity; suite filename classification is an initial migration classifier, not final semantic ownership
- unverifiedRealMachineItems: managed E5 acceptance remained explicitly skipped because its pack is absent; no real provider, packaged app, or customer data was used

## LA-008 — Make the Task Run transition table canonical

- status: completed
- dependencies: LA-001, LA-003
- baseCommit: `c4923c2a809f607782dd9f497aa7dccfd7b92ff5`
- resultCommit: `SELF`
- filesChanged: canonical Task Run contract/projector, live Run registry adapter, transition property/integration test, ledgers
- testsAdded: exhaustive legal/illegal status pair matrix; invalid completed-Run reopen through the durable projector; retry/stop sequence; same-terminal idempotence; different-terminal rejection; explicit failed/stopped resume paths
- commandsExecuted: initial missing-state-machine failure; focused state-machine, Task contract, live registry, single projection, Eval projection, and workflow tests; first Eval projection exposed the supported failed-to-active resume contract; first workflow run exposed the supported stopped-to-awaiting_input preflight resume contract; root typecheck; automatic full `npm test` passed all 169 discovered tests; diff check
- migration: no status, event, runtime schema, or stored history was rewritten; desired statuses remain wire-compatible, while every newly projected canonical `run_upsert` is checked against the single transition table
- rollback: the projector check can be reverted only with the pure table and tests retained as an adapter guard; never restore route-specific silent transitions
- deletedEntries: duplicate private Run-status enum used by parsing; direct live-registry running/stopping/stopped assignments
- remainingRisks: LA-009 must version execution snapshots/epochs; LA-010/011 must move runtime-native lifecycle behind the adapter; retry terminal semantics remain LA-012
- unverifiedRealMachineItems: no live provider retry/resume or packaged-app stop was exercised; managed E5 acceptance remained skipped

## LA-009 — Version immutable execution snapshots

- status: completed
- dependencies: LA-008
- baseCommit: `bbb30d81fe559d889eadc3551e40eeae9445602e`
- resultCommit: `SELF`
- filesChanged: canonical Task Run contract/schema/projector, standalone and Team resource promotion paths, execution/resource/workspace regressions, ledgers
- testsAdded: immutable and append-only snapshot history; explicit compatible model switch; compaction-bound same epoch; runtime-restart new epoch; fork-required same-Run denial; legacy epoch write denial; resource manifest freeze and versioned Main-to-Team promotion; first General execution identity
- commandsExecuted: initial missing execution-timeline export failure; focused execution snapshot, single projection, General Run, Task workspace/contract/resource, and workflow tests; focused failures exposed invalid legacy fixture hashes, missing General timeline initialization, selected model identity, stale lifecycle arrays, and a TypeScript optional-array narrowing issue; root and Desktop typechecks; automatic full `npm test` passed all 170 discovered tests; diff check
- migration: new Runs initialize empty versioned timelines and record the first immutable snapshot when resources freeze; missing timeline fields remain legacy epoch 0 and are read-only; no stored Run or user data was rewritten or backfilled
- rollback: readers may continue accepting missing legacy fields, but newly recorded Runs must not lose append-only timeline validation or resume ambient configuration drift
- deletedEntries: parser type assertions for non-null permission/retrieval changes; unversioned Main-to-Team resource promotion for new Runs
- remainingRisks: LA-010/LA-011 must move Pi lifecycle and native events behind the runtime adapter; LA-013 owns durable compaction handoff; LA-033 owns full ExecutionProfile and quality routing
- unverifiedRealMachineItems: no live provider model switch, real compaction, packaged-app continuation, or customer data was used; managed E5 acceptance remained skipped

## LA-010 — Introduce the General Agent runtime port

- status: completed
- dependencies: LA-008
- baseCommit: `87a24291e027b2c0dd91cd9ed1fecc3be0fe6b17`
- resultCommit: `SELF`
- filesChanged: new cat-runtime port/Pi adapter, General coordinator and server composition, shared Task message queue session contract, adapter/coordinator/session regressions, ledgers
- testsAdded: source boundary rejects Pi imports/native session types in General coordinator; fake AgentRuntimePort completes start/stream/queue/delegation/compact/fork/stop lifecycle; real Pi adapter preserves access/resources/session identity/branch capability and model-input probing
- commandsExecuted: initial adapter test failed because the port export did not exist, then failed on the expected direct Pi coordinator import; focused port, General coordinator, General session, and Task message queue tests; root and Desktop typechecks; automatic full `npm test` passed all 171 discovered tests; diff check
- migration: no Task/runtime/user schema or data changed; production composition now injects `createPiAgentRuntimePort`, while the existing `createGeneralAgentSession` factory remains the Pi adapter implementation and direct parity fixture
- rollback: composition may temporarily inject a compatibility port wrapping the existing factory, but coordinators must not regain Pi imports or native session/model types
- deletedEntries: General coordinator `modelRuntime` and `createSession` dependencies; direct Pi session/runtime/event/image/version imports; Task message queue native AgentSession union
- remainingRisks: LA-011 must normalize the temporary compatibility event envelope; CAT/Eval/Team factories remain outside this General-first ticket; old General factory deletion remains gated by LA-056
- unverifiedRealMachineItems: no live provider call, OAuth refresh, real network model input, packaged-app session resume, or customer data was used; managed E5 acceptance remained skipped

## LA-011 — Normalize Pi events at the runtime adapter boundary

- status: completed
- dependencies: LA-010
- baseCommit: `8bfa0986315f5bbf55e117e66e33d58cf9741c52`
- resultCommit: `SELF`
- filesChanged: canonical runtime event normalizer and export, Pi adapter subscription, General Main/child consumers, Task diagnostic projection, mapping/coordinator regressions, ledgers
- testsAdded: ordered Pi-to-canonical mapping snapshot; unknown and malformed native event diagnostics; General coordinator persists unmapped-event diagnostics without exposing hidden reasoning
- commandsExecuted: initial normalizer import failure; focused normalizer, runtime port, General coordinator/session, and runtime hook tests; root and Desktop typechecks; automatic full `npm test` discovered and passed 172 root tests; roadmap validation/tests; diff check
- migration: no Task product event schema, persisted runtime schema, or user data changed; the Pi adapter now emits a strict LA-owned discriminated union and existing General consumers were migrated in place
- rollback: the adapter may temporarily translate canonical events through an old consumer mapper, but coordinators must not regain Pi-native event parsing and unknown native events must remain visible diagnostics
- deletedEntries: permissive compatibility event envelope; General coordinator runtime field validators and direct Pi event-name branches
- remainingRisks: LA-012 owns retry terminal gating and stream coalescing; CAT/Eval/Team factory migration remains outside this General-first ticket; LA-045 owns the renderer timeline protocol
- unverifiedRealMachineItems: no live provider event stream, real retry/compaction, packaged-app renderer, or customer data was used; managed E5 acceptance remained skipped

## LA-012 — Gate retry terminal state and coalesce streaming deltas

- status: completed
- dependencies: LA-011
- baseCommit: `3581b4c8dc981fb0ce5b6109db9e892aba4acff1`
- resultCommit: `SELF`
- filesChanged: runtime event pipeline and export, canonical terminal failure event, Pi adapter settlement/cancellation integration, General terminal projection, pipeline regressions, ledgers
- testsAdded: failure-before-retry-decision and decision-before-failure permutations; retry success; cancellation during retry; exactly-once terminal failure; 50ms/20fps delta window; final-before-pending-delta flush
- commandsExecuted: initial missing pipeline export failure; focused pipeline/normalizer/runtime-port/General/session/self-healing tests; root and Desktop typechecks; automatic full `npm test` discovered and passed 173 root tests; roadmap validation/tests; diff check
- migration: no persisted schema or user data changed; each Pi adapter subscription now uses an in-memory settlement pipeline and flushes on idle before the coordinator finalizes its Run
- rollback: coalescing may be disabled by immediate flush for diagnosis, but terminal attempt failures must continue waiting for Pi's explicit retry decision and must remain exactly once
- deletedEntries: direct per-token Pi adapter emission; implicit assumption that waitForIdle alone establishes canonical stream settlement
- remainingRisks: LA-013 owns durable compaction handoff; non-General runtime factories remain outside the current adapter; real-provider retry ordering remains unverified
- unverifiedRealMachineItems: no live provider retry, compaction overflow, rate-limit delay, packaged-app stream, or customer data was used; managed E5 acceptance remained skipped

## LA-013 — Persist a structured handoff before exact-session compaction

- status: completed
- dependencies: LA-009, LA-010, LA-011
- baseCommit: `7b080faca74ee8a694df650921f31839786cc4b4`
- resultCommit: `SELF`
- filesChanged: versioned runtime compaction contract/renderer, runtime port compact request, General durable handoff transaction and exact-session guard, handoff/coordinator regressions, ledgers
- testsAdded: deterministic version-1 handoff and hash validation; session ID/file mismatch denial; required Decision and reviewable Artifact preservation; execution/resource/policy hash preservation; proof that the artifact is durable before Pi compact is invoked
- commandsExecuted: initial missing handoff export failure; existing coordinator assertion failed on the intentionally removed free-string compact contract; focused handoff/General/runtime-port/execution-snapshot tests; root and Desktop typechecks; automatic full `npm test` discovered and passed 174 root tests; roadmap validation/tests; diff check
- migration: no stored history was rewritten; new compactions append a final context_handoff Artifact plus system Activity to the existing Task event log, while legacy threads without verified execution/resource snapshots remain read-only and cannot compact
- rollback: disable compaction and direct users to a new Run/fork; never call Pi compact without a durable v1 handoff or relax the exact session ID/file check
- deletedEntries: free-form-only runtime compact contract; compaction path that executed before Task durability; ambient selection of an unverified legacy execution/resource context
- remainingRisks: automatic handoff retention/checkpoint policy remains a later storage concern; non-General compaction paths remain outside the current General-first runtime port; real Pi compaction rehydration remains unverified
- unverifiedRealMachineItems: no live Pi compaction, overflow recovery, provider context inspection, packaged-app flow, or customer data was used; managed E5 acceptance remained skipped

## LA-067 — Preserve Desktop strip-only loading of the shared Task contract

- status: completed
- dependencies: LA-008
- baseCommit: `ff892f92d7b49ec663d70a2dc7eb9906fdcbc3f9`
- resultCommit: `SELF`
- filesChanged: shared Task workspace contract, Desktop strip-only import regression, ledgers
- testsAdded: direct Node strip-only import of the canonical Task Run transition contract, including legal and rejected transitions with the unchanged stable error code and endpoints
- commandsExecuted: direct Node test first reproduced `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` for the constructor parameter property and then passed; Desktop test suite passed 150 Desktop tests plus 3 activity-producer tests; root suite automatically discovered and passed 174 tests; root and Desktop typechecks; roadmap validation/tests; release check; diff check
- migration: none; no Task schema, stored data, event shape, transition rule, error code, or product behavior changed
- rollback: do not restore constructor parameter properties in shared contracts consumed by Node strip-only tests; reverting would restore the G2 Desktop Gate failure
- deletedEntries: the non-erasable constructor parameter-property syntax at the shared Desktop import boundary
- remainingRisks: future shared contracts can reintroduce unsupported TypeScript syntax unless the strip-only regression remains in the Desktop suite; LA-054 still owns broader CI suite separation
- unverifiedRealMachineItems: packaged Desktop loading of this shared contract remains unverified; no real Task data or customer data was read

## LA-014 — Require structured capabilities for every production tool

- status: completed
- dependencies: LA-001, LA-010
- baseCommit: `e4decdc1f76e3caf5664bfc696f1b58ba1d0a652`
- resultCommit: `SELF`
- filesChanged: schema-v1 tool capability inventory, permission resolver, General/CAT/Maintainer session registration gates, Agent tool catalog projection, current context, capability regressions, ledgers
- testsAdded: exact reviewed capability lookup; every CAT tool receives a structured manifest; case/name aliases remain undeclared; mixed declared/undeclared registration fails; unknown tools remain blocked even under bridge auto; catalog refuses undeclared active tools
- commandsExecuted: focused test first failed because the capability registry export did not exist; focused capability, permission, catalog, General, CAT, and Maintainer tests; root and Desktop typechecks; automatic root suite discovered and passed 175 tests; Desktop passed 150 tests plus 3 activity-producer tests; roadmap validation/tests; release check; diff check
- migration: no persisted schema or user data changed; existing reviewed tool names receive an in-memory schema-v1 manifest, and production session/catalog construction now fails before exposing any undeclared name
- rollback: a temporary compatibility inventory may enumerate another reviewed exact tool name, but unknown tools must remain blocked and production sessions must not return to tool-name heuristics
- deletedEntries: runtime permission classification by editable-domain name arrays; unknown-tool fallback to high-risk bridge approval
- remainingRisks: LA-015 must route declared filesystem operations through one FileCapabilityBroker; LA-016 must do the same for network/process/secrets; capability inventory review remains required when Pi or first-party tools change
- unverifiedRealMachineItems: no live provider, packaged app, third-party extension, external MCP, or customer data was used; managed E5 acceptance remained skipped

## LA-015 — Centralize filesystem capability authorization

- status: completed
- dependencies: LA-014
- baseCommit: `6f2ead6257de2bdaacd33af676aea86a55e1a78c`
- resultCommit: `SELF`
- filesChanged: FileCapabilityBroker and cat-data export; General/CAT runtime guards; document tool adapter; filesystem capability manifests; safety/runtime/capability regressions; current context; ledgers
- testsAdded: Project read/list/search allowlist; outside/home-equivalent and symlink escape denial; new-file parent realpath validation; generic CAT write denial; explicit output write grant; nested path extraction; current-grant revocation; General and CAT runtime integration; source assertions removing prior duplicate authorities
- commandsExecuted: focused broker test first failed because the broker export did not exist, then passed; focused runtime hook, CAT safety, General session, CAT prompt-isolation, document route/capability, and capability-manifest tests; root and Desktop typechecks; automatic root suite discovered and passed 176 tests; Desktop passed 150 tests plus 3 activity-producer tests; roadmap validation/tests; release check; diff check
- migration: no persistent schema or user data changed; existing `FileGrantV1` realpaths, access modes, recursion, and fingerprints remain canonical, and the broker consumes freshly resolved grants at each General tool call
- rollback: keep the broker default-deny and disable an unported Stable tool if necessary; never restore the removed parallel path/grant authorities
- deletedEntries: General runtime embedded path collector/canonicalizer/grant matcher; CAT safety-kernel document-root authority; document-tool-specific explicit-grant matching
- remainingRisks: LA-016 still owns network/process/secret brokers; authorization and the eventual filesystem open are not yet one OS-level no-follow operation, so per-Run isolation and host capability RPC remain required; direct Pi/tool inventory changes still require capability review
- unverifiedRealMachineItems: no live provider, packaged app, external filesystem grant, third-party document backend, customer data, or OS-level symlink-race exploit was used; managed E5 acceptance remained skipped

## LA-016 — Centralize network, process, and Secret capability authorization

- status: completed
- dependencies: LA-014
- baseCommit: `d25647189c270610dbc29db5c50f05da60d8f31f`
- resultCommit: `SELF`
- filesChanged: shared network/process/Secret brokers; General/CAT runtime capability guard; CAT/General sandbox spawn guards; legacy web bridge host/credential enforcement; capability manifests; focused and loopback regressions; runtime policy/current context; ledgers
- testsAdded: exact scheme/host/port grant; wildcard, subdomain, credential URL, private-network, consumer, and process-template denial; explicit test-only private-network grant; runtime web/bash/bridge guard; source assertions proving General, CAT, sandbox, and web paths use the brokers
- commandsExecuted: focused broker test first failed because the broker exports did not exist, then passed; focused file broker, runtime hook, permission, sandbox, web parity, and tool-catalog tests; tool-catalog loopback was rerun in the allowed local environment after sandbox bind EPERM; first full root run found non-default port incompatibility; exact ports were added to grants and focused tests passed; a full 177-test run passed; private-network default denial was then added with an explicit test-only loopback grant and the final full 177-test run passed; root and Desktop typechecks; diff check
- migration: no schema, stored permission, credential, Package, document, or user data changed; existing permission decisions remain the upper policy layer while execution now requires a separate in-memory exact capability grant
- rollback: disable the affected network/process/Secret capability or legacy web bridge; never restore direct plaintext credential return, unbrokered process spawn, wildcard host matching, or permission-only execution
- deletedEntries: direct sandbox domain validator independent of the network broker; direct unbrokered sandbox spawn; legacy web bridge direct credential and Keychain process access; bash's misleading generic filesystem manifest
- remainingRisks: DNS resolution can still change after hostname authorization and requires worker/OS egress enforcement; non-Agent host maintenance/package/provider process paths remain separately governed and require review when migrated; LA-017/LA-019 still own process isolation and capability RPC
- unverifiedRealMachineItems: no live provider/API credential, external public network, packaged app, private-network service outside a synthetic loopback, third-party Package/Extension, customer data, or DNS-rebinding exploit was used; managed E5 acceptance remained skipped

## LA-018 — Load executable Extensions only from approved content-addressed bytes

- status: completed
- dependencies: LA-005, LA-015
- baseCommit: `d4182beb9f7dce73f0803aaaf53c801960fba6ac`
- resultCommit: `SELF`
- filesChanged: v2 Extension trust document and read-only content store; staged-tree verifier; General resource snapshot staged-path replacement; server authorization return contract; Extension regressions; runtime policy/current context; ledgers
- testsAdded: approval re-reads the canonical source; content-addressed staged file and manifest; read-only mode; original-path replacement cannot alter loaded bytes; exact loader snapshot replacement; unexpected tree member denial; staged-byte tamper denial; dynamic import denial; legacy v1 approval cannot authorize staged execution
- commandsExecuted: focused trust test first failed on the missing staged verifier and then passed; focused General session and Run coordinator tests; root and Desktop typechecks; roadmap validation/tests and release check (tsx IPC first blocked by the managed sandbox, then passed in the allowed same-machine environment); automatic full `npm test` first hit the existing user-cache fixture sandbox restriction, then discovered and passed all 177 root tests in the allowed environment; final focused trust test and both typechecks; diff check
- migration: no real runtime data was read or written; new approvals use `pi_extension_trust.v2.json` and a content-addressed staged tree, while legacy v1 path/digest records remain untouched and are deliberately ignored as execution authority so they require explicit restaging and reapproval
- rollback: keep Stable external Extension execution disabled and retain v2 staged records as inert read-only evidence; never restore original-path loading or treat v1 approval as equivalent authority
- deletedEntries: path-plus-digest approval as current execution authority; post-approval loader use of the original Extension path; trust records without a verified staged tree
- remainingRisks: LA-019 capability-isolated Extension Host remains mandatory before Stable third-party execution can return; same-user filesystem mutation is detected but not prevented by an OS security boundary; the staged closure is intentionally single-file and blocks dynamic, require, and relative module dependencies
- unverifiedRealMachineItems: no real `data/**`, customer Extension, packaged app, live Pi Extension evaluation, cross-process staging race, code signing, or isolated Extension Host was used; Stable execution remains disabled and managed E5 acceptance remained skipped

## LA-068 — Establish the versioned Run Worker protocol and Supervisor lifecycle

- status: completed
- dependencies: LA-009, LA-010, LA-015, LA-016
- baseCommit: `288e5c2b6f3a8e2948e85cc60b7701ec155b8020`
- resultCommit: `SELF`
- filesChanged: strict v1 worker bootstrap/command/message contract; process adapter seam; sanitized Node JSONL process adapter; Supervisor ready/heartbeat/cancel/hard-kill/crash lifecycle; synthetic and fake-process regressions; current context; ledgers
- testsAdded: unknown/bootstrap schema denial; execution/run identity match; successful ready-heartbeat-complete; cancellation command followed by timeout SIGKILL; heartbeat timeout classification; exit-before-ready classification; actual sanitized Node child JSONL round trip
- commandsExecuted: focused supervisor test first failed because the module did not exist, then exposed an unref timer settlement bug and passed after correction; root typecheck; automatic full `npm test` discovered and passed all 178 root tests including the new test; Desktop typecheck and diff check
- migration: none; this is an unconnected foundation and no production route, Run registry, Task schema, runtime process, or stored data uses the worker protocol yet
- rollback: remove the unconnected protocol/Supervisor module and test; do not partially connect a production profile or introduce a second active Run authority
- deletedEntries: none; production host execution is deliberately retained until profile parity tickets LA-069 through LA-071 pass and LA-072 removes the fallback
- remainingRisks: every production profile still executes in the host until its dedicated migration ticket completes; worker capability RPC is not connected; process-level OS sandboxing and cross-root isolation remain unproven
- unverifiedRealMachineItems: only synthetic fake and local Node child workers were used; no Pi provider, real Run, real `data/**`, customer content, packaged app, OS sandbox profile, or crash-recovery persistence was exercised; managed E5 acceptance remained skipped

## LA-073 — Freeze General Session preparation before Pi construction

- status: completed
- dependencies: LA-068
- baseCommit: `51fc0f092e6869e240ab5e7f8bbbbe494377b2c3`
- resultCommit: `SELF`
- filesChanged: schema-v1 General preparation Plan and export; General Session Plan consumer/parity gates; focused regression; worker-epic queue contract; runtime/resource current-state documentation; ledgers
- testsAdded: deterministic JSON round trip; complete input hashes; Stable preflight excludes and never executes an external Extension; planned initial/registered tool parity; Plan/options mismatch denial; post-preflight Grant expansion denial; source mutation denial before Session construction
- commandsExecuted: focused test first failed because the Plan export did not exist, then exposed active-versus-registered document tool and builtin ordering differences; focused Plan/General Session/General coordinator tests; root typecheck; first full 179-test run exposed undefined fields lost at the process-boundary JSON round trip; resource snapshot normalization fixed it; focused regression and root typecheck passed; final full 179-test run passed in the allowed synthetic user-cache environment after the managed sandbox blocked its existing cache fixture; Desktop typecheck; roadmap validation/test and release check through local `node --import tsx` after the npm `tsx` CLI IPC socket was sandbox-blocked; diff check
- migration: no runtime schema, Task contract, stored Run, user setting, or user data changed; new General Session construction prepares an in-memory schema-v1 Plan when callers do not yet supply one, while LA-074 will make that Plan the worker wire input and attest the exact runtime output
- rollback: block new General worker migration and revert the unconnected Plan seam; never allow Session construction to rediscover resources or substitute model, permission, prompt, or tool inputs after accepting a frozen Plan
- deletedEntries: General Session runtime-time resource discovery; duplicate General builtin-tool name constants; live-option authority after a prepared Plan is accepted
- remainingRisks: LA-074 must add a strict hostile-wire parser, worker attestation, Host-persisted exact ExecutionSnapshot, and activation-before-prompt; LA-075 still owns production General cutover and parity; production execution remains in the host
- unverifiedRealMachineItems: no real Pi provider request, worker Session, packaged app, real `data/**`, customer content, or external Extension execution was used; managed E5 acceptance remained skipped

## LA-074 — Attest and activate General Worker Sessions over bidirectional RPC

- status: completed
- dependencies: LA-073
- baseCommit: `41041e8d95f3c4c6d33f0b0df3ae853d345d5ea1`
- resultCommit: `SELF`
- filesChanged: strict hostile-wire General Plan parser; versioned bidirectional General Worker RPC; Supervisor-multiplexed Worker entry and application transport; exact prompt/tool/resource/grant attestation; Host-persisted ExecutionSnapshot-before-activation gate; permission/delegation bridges; runtime event and queue proxy; JSONL bounds and error redaction; focused regressions; current runtime/resource documentation; ledgers
- testsAdded: strict Plan unknown-field denial; bounded JSONL framing; durable snapshot persistence before activation/Session return; attestation and activation hash mismatch denial; prompt-before-activation denial; permission and delegation round trips; concurrent command correlation; runtime event and queue forwarding; active-tool mismatch denial; timeout/disconnect cleanup; Secret redaction; Supervisor application-channel multiplexing
- commandsExecuted: focused General Worker RPC test first failed because the module did not exist, then exposed strict resource normalization and Supervisor-path ownership gaps; focused General Worker RPC, Supervisor, General Plan, General Session, and General coordinator tests; root and Desktop typechecks; first full automatic suite was blocked by the managed sandbox at the existing synthetic user-cache fixture; approved rerun discovered and passed all 180 root tests; roadmap validation/test, release check, and diff check
- migration: none; RPC schema v1 and the Worker entry are unconnected foundations, no production route/coordinator/active Run/Task schema/stored Run/user setting/user data changed, and production General execution remains Host-owned until LA-075
- rollback: remove the unconnected General Worker RPC/entry/application transport and revert the preparation-only Supervisor bootstrap alternative; retain Host execution as the single production authority and never leave both paths active
- deletedEntries: duplicate standalone Worker lifecycle path was removed during implementation; General RPC is multiplexed through the single LA-068 Supervisor channel; raw bootstrap/shutdown exception text no longer crosses the Worker boundary
- remainingRisks: LA-075 must atomically cut new General Runs over to Worker authority and prove start/retry/cancel/crash/reconnect, durable queue/delegation, fork/copy, resource and ExecutionSnapshot parity; CAT/Eval/Team remain Host-owned pending their profile tickets; process-level OS sandbox isolation remains unproven
- unverifiedRealMachineItems: no production coordinator, real Pi provider request, real Run, packaged app, OS sandbox profile, real `data/**`, customer content, or external Extension execution was used; managed E5 acceptance remained skipped because its pack is absent

## LA-075 — Cut new standalone General root Runs over to Worker authority

- status: completed
- dependencies: LA-074
- baseCommit: `07918c211038a6e49705a223316096c3b54a6cdb`
- resultCommit: `SELF`
- filesChanged: production General Worker authority and Supervisor composition; dev/compiled Worker entry resolution; exact ExecutionSnapshot projector entry; active worker/epoch registry identity; Coordinator cutover with no new-root-Run Host fallback; dynamic capability bridge; bounded Supervisor JSONL framing; packaged-runtime Worker-entry assertion and fixture; Coordinator, RPC, Supervisor and actual child-process regressions; current runtime/resource documentation; ledgers
- testsAdded: actual TS Worker process prepares, attests, activates and stops; exact attested Snapshot is durable before Session return; new root Run never invokes Host Session construction; active worker/epoch identity; native image, queue/steer/follow-up, delegation, permission, capability activation, Retry and resource-manifest parity; Stop projection; disconnect/failure projection; Worker entry packaging requirement
- commandsExecuted: General coordinator test initially timed out because Worker authority was not connected; focused root typecheck and General coordinator/RPC/runtime/Supervisor/projector/active-registry tests; actual local child-process Worker test; automatic full `npm test` discovered and passed all 181 root tests; Desktop typecheck; first Desktop suite exposed a stale packaging fixture missing the compiled Worker entry, then all 150 Desktop tests and all 3 acceptance-activity tests passed after the fixture matched the new archive contract; roadmap validation/test, release check, and diff check; `npm run desktop:package` was attempted but stopped before building because the required local signing identity was unavailable, so `desktop:verify` was not run
- migration: only newly started standalone General root Runs use Worker authority; active Host Runs are not hot-migrated or rewritten; no Task/runtime schema or user data migration; standalone compaction/fork maintenance and delegated children retain their existing paths pending their dedicated isolation/deletion gates
- rollback: a future explicit ticket may route only subsequent new root Runs back to the Host; never hot-migrate a current Run and never keep both authorities eligible for the same launch
- deletedEntries: new standalone General root Run Host Session construction and its approximate ExecutionSnapshot derivation; production General Worker foundation is no longer unconnected
- remainingRisks: standalone compaction/fork maintenance and delegated-child sessions still execute in the Host; CAT/Eval/Team remain Host-owned pending LA-070/LA-071; LA-072 must remove all remaining production Host execution after parity; OS sandbox profile isolation and real provider recovery remain unproven
- unverifiedRealMachineItems: no real provider request, existing active Host Run, packaged-app interactive Run, OS sandbox profile, real `data/**`, customer content, or external Extension execution was used; a signed packaged archive and archive-level Worker-entry proof remain unverified because the required local signing identity was unavailable; managed E5 acceptance remained skipped because its pack is absent

## LA-069 — Close the General Worker migration Epic

- status: completed
- dependencies: LA-068, LA-073, LA-074, LA-075
- baseCommit: `07918c211038a6e49705a223316096c3b54a6cdb`
- resultCommit: `SELF`
- filesChanged: no additional implementation beyond completed child Tickets LA-073 through LA-075; Epic closure recorded in the control plane and execution ledgers
- testsAdded: inherited from LA-073 deterministic preflight, LA-074 RPC attestation/activation, and LA-075 production cutover/parity evidence
- commandsExecuted: child Ticket verification sets plus LA-075 full automatically discovered root and Desktop suites; static packaging contract checks passed, while signed package creation was blocked by the unavailable local signing identity and archive verification was not run
- migration: the Epic closes only the new standalone General root-Run authority; it does not claim CAT/Eval/Team, delegated-child, compaction/fork, OS sandbox, provider, or real-machine release acceptance
- rollback: governed by LA-075; only a future explicit Ticket may change authority for subsequent new Runs
- deletedEntries: none beyond the child Tickets' recorded deletions
- remainingRisks: LA-070, LA-071 and LA-072 remain required before the process-isolation Epic and R-002 can close globally
- unverifiedRealMachineItems: same bounded synthetic/local-child evidence as LA-075; no real provider or packaged-app interactive acceptance; no signed packaged archive or archive-level verification

## LA-070 — Isolate new Project CAT root Runs and Private Eval single generation

- status: completed
- dependencies: LA-068
- baseCommit: `5733813a98c5103e31ceab68e2938494fc11af36`
- resultCommit: `SELF`
- filesChanged: CAT/Eval immutable Session Plan and Supervisor authority; strict bidirectional Worker RPC; CAT/Eval Worker entry; Project CAT and Private Eval production cutover; active worker/epoch binding; packaged-runtime entry contract; focused regressions; current runtime/resource documentation; ledgers
- testsAdded: actual child-process CAT and Private Eval preparation/activation/Stop; concurrent cross-root CAT Workers; Plan digest mutation denial; Host server-tool AbortSignal propagation; Project CAT and Private Eval source cutover contract; active-registry worker identity; packaged-runtime CAT/Eval entry requirement
- commandsExecuted: CAT Worker runtime test first failed because the Worker module did not exist; focused CAT Worker runtime/RPC/cutover, Supervisor, active registry, CAT safety/prompt isolation/runtime session, Private Eval and Eval route tests; root typecheck and diff check; automatic full root suite first hit the managed sandbox at the existing synthetic user-cache fixture, then the approved rerun discovered and passed all 184 tests; Desktop suite passed all 150 tests and all 3 acceptance-activity tests; Desktop typecheck, roadmap validation/test and release check; signed packaging was not retried because LA-075 already proved the required local signing identity is unavailable
- migration: only newly started Project CAT root Runs and Private Eval single generations use Worker authority; existing active Runs are not hot-migrated; no CAT, Task, runtime, Private Eval, or user-data schema changed; Private Eval retains its canonical execution manifest while Project CAT persists the exact attested Task ExecutionSnapshot before activation
- rollback: a future explicit Ticket may disable an unmigrated profile for subsequent new Runs only; never route a failed migrated launch to Host execution and never keep Host and Worker eligible for the same new Run
- deletedEntries: direct Host Pi Session construction for new Project CAT root Runs; direct Host Pi Session construction for Private Eval single generation; live SessionManager ownership for migrated Project CAT root Runs
- remainingRisks: Team specialist sessions remain Host-owned pending LA-071; standalone compaction/fork maintenance plus non-Run CAT prompt/catalog/compaction helpers remain Host-owned pending LA-072; Private Eval does not have a canonical Task locator for a Task ExecutionSnapshot and continues to use its existing canonical Eval execution manifest; OS sandbox profile isolation, real provider recovery, and full Package Extension UI execution remain unproven
- unverifiedRealMachineItems: no real provider request, existing active Host Run, packaged-app interactive Run, OS sandbox profile, real `data/**`, customer content, or external Extension execution was used; signed packaged archive and archive-level Worker-entry proof remain unavailable because the required local signing identity is missing; managed E5 acceptance remained skipped because its pack is absent

## LA-071 — Isolate new Team specialist transport Sessions

- status: completed
- dependencies: LA-068
- baseCommit: `3c000376292f823cea22d355dff7f58a967ccd6c`
- resultCommit: `SELF`
- filesChanged: Team profile support in the shared CAT/Eval Worker Plan/RPC/entry; Team launch cutover; pre-launch signed child-scope identity/subset validation; exact composite Team resource manifest and ExecutionSnapshot-before-activation persistence; active worker/epoch identity; focused regressions; current runtime/resource documentation; ledgers
- testsAdded: source cutover contract rejects Host Session construction and requires Team Worker identity; actual child-process `team` Worker preparation/activation/Stop; cross-Project/Workflow/Role scope-binding contract; existing evidence-scope, Pi child RPC, workflow, activity and active-registry parity suites
- commandsExecuted: Team cutover test first failed because `spawnWorkflowSubagent` still constructed the transport Session in the Host; focused Team Worker/CAT Worker tests; focused Team Pi child RPC and evidence tests first hit the managed sandbox at their existing synthetic cache fixture, then passed in the allowed test cache environment; Team workflow/activity/active registry suites; root typecheck and diff check; automatic full suite discovered and passed all 185 root tests; Desktop suite passed all 150 tests and all 3 acceptance-activity tests; Desktop typecheck, roadmap validation/test and release check
- migration: only newly started Team specialist transport Sessions use Worker authority; active Team children are not hot-migrated; the two existing verified Pi-native child transports remain nested execution details; no Team, Task, runtime, child-scope, Package, or user-data schema changed
- rollback: a future explicit Ticket may block subsequent Team specialist launches or route only a verified new child through a separately reviewed transport; never fall back to Host Pi Session execution and never keep Host/Worker authorities eligible for the same child
- deletedEntries: direct Host `createCatAgentSession` construction for new Team specialist transport Sessions; post-activation approximate Team ExecutionSnapshot promotion; redundant second Extension binding for the Team transport Session
- remainingRisks: standalone compaction/fork maintenance and non-Run CAT prompt/catalog/compaction helpers remain Host-owned pending LA-072; verified nested Pi child processes still use their established pi-subagents/Pi-RPC lifecycle beneath the Supervisor-owned Team transport; OS sandbox profile isolation and real provider/Package execution recovery remain unproven
- unverifiedRealMachineItems: no real provider request, existing active Team child, packaged-app interactive Team Run, OS sandbox profile, real `data/**`, customer content, or executable Package Extension was used; signed packaged archive remains unavailable because the required local signing identity is missing; managed E5 acceptance remained skipped because its pack is absent

## LA-072 — Remove production Host Agent execution fallback

- status: completed
- dependencies: LA-069, LA-070, LA-071
- baseCommit: `8bfad494f3d1ec06c6f8e3fb1f3e3e5aaf3e49a5`
- resultCommit: `SELF`
- filesChanged: CAT Worker tool-definition attestation; General Worker fork RPC; General coordinator compaction/fork/delegated-child cutover; non-Run CAT prompt/catalog/compaction support cutover; delegated Worker identity Activity; architecture and randomized cross-root regressions; current runtime/resource documentation; ledgers
- testsAdded: architecture guard rejects direct CAT Session construction in the Server and direct Host General Session construction in the coordinator; strict CAT Worker tool-definition wire validation; General Worker fork and branch identity; six randomized concurrent CAT roots retain unique Worker IDs plus exact Run/epoch identity; delegated child records Worker/epoch Activity before execution
- commandsExecuted: the architecture test first failed on direct Server CAT Session construction; the General coordinator test then exposed its Host-based child/compaction/fork fixture and passed after the fixture used Worker authority; focused General coordinator/Worker RPC/Worker runtime/architecture/compaction/active-registry tests; root typecheck; automatic full root suite discovered and passed all 186 tests; Desktop passed 150 tests plus 3 acceptance-activity tests; Desktop typecheck; roadmap validation/test; release check; `npm run mac:test`; diff check; signed packaging not retried because LA-075 already proved the required local signing identity is unavailable
- migration: only operations started after this commit use the completed boundary; no active Run is hot-migrated, no runtime/Task/user-data schema changes, and no stored data is rewritten; delegated child identity is recorded as canonical Activity, while compaction/fork and CAT support operations retain their existing durable domain result instead of inventing a second Task execution authority
- rollback: keep a failed profile or support operation Stable-blocked/read-only and repair it in a new Ticket; never restore Host Agent execution, hot-migrate a current Run, or make Host and Worker simultaneously eligible
- deletedEntries: direct Host CAT Session construction for Project prompt support, Main tool-catalog probing, and Project compaction; direct Host General Session construction for standalone compaction, fork, and delegated children; obsolete Host executable-Extension authorization path for these plans; active product Agent execution fallback outside the Worker authorities
- remainingRisks: the dormant Maintainer migration Agent remains Stable-disabled pending LA-050; verified nested Pi children retain their established pi-subagents/Pi-RPC lifecycle beneath the Supervisor-owned Team transport; delegated-child Task schema has no separate child ExecutionSnapshot and therefore records Worker binding as Activity; OS sandbox profile enforcement, real provider recovery, and isolated Extension Host execution remain unproven
- unverifiedRealMachineItems: no live provider, existing active Host Run, packaged-app interactive Run, OS sandbox profile, real `data/**`, customer content, third-party Extension, or signing credential was used; signed package/archive verification remains blocked by the missing local identity; managed E5 acceptance remained skipped because its pack is absent

## LA-017 — Close the per-Run Worker isolation Epic

- status: completed
- dependencies: LA-009, LA-010, LA-015, LA-016; accepted child Tickets LA-068 through LA-075
- baseCommit: `b5bfdd413ff901b91808c319f56d92a36a287e42`
- resultCommit: `SELF`
- filesChanged: no production implementation; Epic closure recorded in the execution ledgers after all Worker foundation, profile cutover, parity, and fallback-removal Tickets completed
- testsAdded: inherited from LA-068 Supervisor lifecycle, LA-073/074 immutable General plan/RPC, LA-075 General cutover, LA-070 CAT/Eval cutover, LA-071 Team cutover, and LA-072 architecture/randomized cross-root proof
- commandsExecuted: accepted the child Ticket verification evidence, including the final 186-test root suite, 150+3 Desktop suite, mac:test, root/Desktop typechecks, roadmap validation/tests, release check, and diff check
- migration: none beyond the child Tickets; existing active Host Runs were never hot-migrated and no persisted schema or user data was rewritten
- rollback: governed by the child Tickets; block a future failed profile and repair it in a new Ticket, never restore shared Host execution or dual authority
- deletedEntries: no additional entries beyond the child Tickets' recorded direct Host Session and fallback deletions
- remainingRisks: this closes R-002 for active product Agent execution, not OS-level sandbox enforcement, same-user native-process threats, verified nested Pi child lifecycle, or the separately Stable-disabled Maintainer migration Agent; LA-019 still owns capability-isolated Extension execution
- unverifiedRealMachineItems: no real provider, packaged-app interactive Run, OS sandbox attack, active legacy Run, customer data, signed archive, or external Extension execution was used

## LA-019 — Isolate executable Extensions behind a capability-denied Host

- status: completed
- dependencies: LA-017, LA-018
- baseCommit: `5d3b3895b34f3cdd83d3ad2a58b320c019a7f6ff`
- resultCommit: `SELF`
- filesChanged: versioned Extension Host plan/protocol and Pi pure-tool compatibility adapter; independent `srt` child entry with Node permissions; private exact-byte restaging; authenticated bounded JSONL; General/isolated-CAT in-process loader denial; runtime archive contract and packaging fixture; malicious capability/crash/timeout and architecture regressions; resource/risk/migration documentation; ledgers
- testsAdded: malformed Host plan fails before process launch; benign pure tool invocation; filesystem read, child process, inherited secret and loopback network denial; unsupported command/API rejection; request timeout kill; Host crash isolation; General and isolated CAT source guards prevent external paths entering the Pi loader; packaged runtime requires the compiled Host entry
- commandsExecuted: the new characterization test first failed because no isolated Host export existed; the architecture guard later failed while external paths still reached Pi loaders; focused Extension Host iterations exposed canonical temp-path, package-resolution and sandbox CLI boundary requirements and replaced an infeasible child-side tsx loader with parent-side TypeScript transpilation; `npm run typecheck`; focused `extension_host.test.ts`; automatic `npm test` discovered and passed all 187 root tests; `npm run test:security` ran and passed all 24 discovered security tests; `npm run mac:test` passed all 150 Desktop tests, all 3 acceptance-activity tests, and Desktop typecheck; roadmap validation/test, release check, and diff check passed
- migration: no persistent schema or user-data migration; approved source bytes are copied into an unpredictable, read-only, process-private temporary root and removed on dispose/failure; Stable external executable Extensions remain disabled and are not activated by this Ticket; active Runs are unchanged
- rollback: keep Stable external executable Extensions disabled and remove the unactivated Host foundation in a future explicit Ticket if required; never restore in-process external loading or make Host and Agent process simultaneously eligible
- deletedEntries: direct General resource-snapshot Extension paths into Pi's in-process loader; direct isolated CAT Extension paths into Pi's in-process loader; stale CAT regression that expected server-selected external code to execute inside the Agent process
- remainingRisks: LA-020 and its child Tickets still own signed declarative Package format and any explicit Stable activation Gate; Host v1 supports only pure registered tools and deliberately blocks event, command, flag, shortcut, UI/render and argument hooks; same-user native-process threats and sandbox-runtime beta behavior are not a proven OS security boundary; LA-owned inline runtime factories remain trusted product code inside their Run Workers
- unverifiedRealMachineItems: no real provider, customer data, real `data/**`, third-party production Extension, signed Package, installed packaged-app Host, notarization credential, or external network service was used; signed archive execution remains unverified because the required local signing identity is unavailable; managed E5 acceptance remained skipped because its pack is absent

## LA-076 — Define the strict declarative `.lapkg` v1 format

- status: completed
- dependencies: LA-004, LA-018
- baseCommit: `090fbde67b92a738a493ac04e15804404ddcda6e`
- resultCommit: `SELF`
- filesChanged: unconnected `.lapkg` v1 manifest/archive verifier; closed declarative resource-type and extension allowlists; exact archive/manifest/tree digest projection; bounded tar parsing from the same hashed bytes; portable path and executable-surface rejection; focused synthetic archive regressions; current package/resource/risk/migration documentation; ledgers
- testsAdded: valid self-contained Skill/Glossary archive; strict unknown manifest field; duplicate resource ID; unknown resource type; traversal; case-insensitive and Unicode-normalized collisions; digest mismatch; executable extension, shebang and tar permission bits; undeclared/missing file; symlink/hardlink; file-count and resource-byte limits
- commandsExecuted: the new characterization test first failed because the format module did not exist; focused iterations exposed an invalid duplicate-ID fixture and an uncaught tar callback error boundary before the final fail-closed parser passed; `npm run typecheck`; focused `lapkg_format.test.ts`; automatic `npm test` discovered and passed all 188 root tests including the new test; Desktop typecheck; roadmap validation/test; release check; diff check
- migration: no route, registry, activation, runtime schema, persistent state, or user-data migration; only synthetic archives were created under temporary test roots; Stable legacy Package installation remains governed by its existing stopgap
- rollback: the verifier is not connected to production and can be removed as one unit; keep Stable legacy install disabled rather than falling back to npm, executable Package content, or unsigned data
- deletedEntries: none; legacy catalog, registry and package trees remain unchanged and read-only/blocked according to existing controls
- remainingRisks: LA-077 must cryptographically verify the syntax-only Ed25519 envelope against explicit trust roots; resource-specific semantic schemas beyond valid UTF-8/JSON remain future format evolution; LA-078 through LA-082 still own preview, legacy inventory, activation, recovery and product cutover; `.lapkg` v1 intentionally supports no binary resources
- unverifiedRealMachineItems: no real `data/**`, customer content, publisher archive/key, production route, Package Center UI, installed runtime, signed app/archive, or network source was used; managed E5 acceptance remained skipped because its pack is absent

## LA-077 — Verify `.lapkg` signatures against explicit publisher roots

- status: completed
- dependencies: LA-076
- baseCommit: `70be517cc71dcf5c120524c61a6bf0c02616891e`
- resultCommit: `SELF`
- filesChanged: unconnected domain-separated Ed25519 signature payload/verifier; strict injected trust-root validation and publisher binding; validity/revocation handling; immutable verification attestation; cryptographic tamper/key/error regressions; current package/resource/migration documentation; ledgers
- testsAdded: valid publisher-bound signature; empty trust roots; revoked key; publisher mismatch; substituted key; duplicate key ID; RSA/non-Ed25519 key; unknown trust-root field; not-yet-valid and expired key; manifest and resource-tree tamper; noncanonical Base64 envelope; manifest field-order invariance; source guard against embedded production public keys
- commandsExecuted: the new characterization test first failed because no signature module existed; its first implementation run exposed a synchronous assertion-wrapper issue before the final test passed; `npm run typecheck`; focused `lapkg_signature_security.test.ts`; automatic security suite discovered 189 total root tests and ran/passed all 25 security tests including the new signature test; Desktop typecheck; roadmap validation/test; release check; diff check
- migration: no trust-root store, production key, route, registry, Package activation, runtime schema, or user-data migration; generated Ed25519/RSA keys and archives existed only in temporary test fixtures
- rollback: the verifier is unconnected and can be removed as one unit; with no verified trust path, `.lapkg` remains blocked rather than accepted by hash, manual checkbox, or unknown key
- deletedEntries: none; no legacy Package or trust record was rewritten, promoted, or deleted
- remainingRisks: production publisher enrollment, rotation, revocation distribution and legal governance remain undecided and must not be inferred; LA-078 through LA-082 still own preview, legacy inventory, activation, recovery and product cutover; current verification attests content, not tar byte-for-byte encoding metadata
- unverifiedRealMachineItems: no real publisher key, external archive, trust service, revocation feed, `data/**`, customer content, production route/UI, installed runtime, signed app/archive, or network source was used

## LA-078 — Make declarative Package Preview inert and approval-bound

- status: completed
- dependencies: LA-077
- baseCommit: `d5cd82ef0807ed51f844181f9bbd1c37017f642b`
- resultCommit: `SELF`
- filesChanged: byte-oriented `.lapkg` inspection entrypoint; unconnected in-memory Preview service; strict source descriptor and TTL; signature-error boundary; deterministic full-object `planHash`; risk projection; stale/mutated/expired approval guard; focused network/subprocess and tamper regressions; current package/resource/risk/migration documentation; ledgers
- testsAdded: initial missing-module characterization failure; zero `fetch` calls and fake-`npm` sentinel; deterministic identical preview; source digest and signature mutation rejection; full-plan mutation and supplied-hash mismatch rejection; exact expiry boundary; declarative risk projection
- commandsExecuted: focused Preview security test first failed because `lapkg_preview.ts` did not exist and then passed; `npm run typecheck`; automatic security suite discovered 190 total root tests and ran/passed all 26 security tests including Preview; Desktop typecheck; roadmap validation initially caught and corrected an over-broad bidirectional risk mapping, then validation/test passed; release check; JSON ledger parse; source guard; diff check
- migration: none; Preview accepts caller-owned in-memory bytes and trust roots, creates no registry, archive extraction, quarantine, activation, runtime schema or user-data state, and remains disconnected from production routes
- rollback: remove the unconnected Preview module and byte inspection entrypoint; Stable legacy dependency-bearing preview remains blocked and no npm/Git/shell fallback is permitted
- deletedEntries: none; no legacy Package, quarantine archive, registry, trust record or user data was read, rewritten, promoted or deleted
- remainingRisks: LA-079 must inventory legacy Package state without reading real `data/**`; LA-080/081 own v2 activation and recovery; LA-082 owns route/UI cutover and permanent old-API retirement; production publisher-root governance remains undecided
- unverifiedRealMachineItems: no real `data/**`, external source, network, publisher key/archive, Package route/UI, installed runtime, signed app/archive or customer content was used

## LA-079 — Inventory legacy Packages without mutation

- status: completed
- dependencies: LA-076
- baseCommit: `3c8ecc9b4b1970c0318d81975f372256a55950c9`
- resultCommit: `SELF`
- filesChanged: unconnected read-only legacy `installed-v1` inventory and report; strict record projection; managed-root containment and realpath check; bounded symlink-denying tree hash parity; declarative-candidate/manual-review reasons; corrupt/missing registry reporting; synthetic migration fixtures; current package/resource/migration documentation; ledgers
- testsAdded: initial missing-module characterization failure; one eligible declarative candidate; executable Extension/risk classification; missing tree; tree digest mismatch; outside-root path refusal; corrupt record accounting; corrupt registry JSON; original path/source/digest/risk preservation
- commandsExecuted: focused legacy inventory test first failed because the module did not exist and then passed; `npm run typecheck`; automatic `npm test` discovered and ran all 191 root tests including the new inventory test; Desktop typecheck; release check; roadmap validation/test and diff/source/JSON checks before commit
- migration: report-only and unconnected; tests use a synthetic temporary runtime root; no real `data/**`, registry, installed Package tree, route, runtime schema or user data was read or changed
- rollback: delete the unconnected inventory module/report test; legacy registry and trees remain disabled/read-only and no v2 activation may infer parity without the report
- deletedEntries: none; the Ticket explicitly does not execute, delete, resign, repack or activate legacy Packages
- remainingRisks: actual legacy Package count, corruption and repack eligibility remain unknown because real `data/**` was prohibited; LA-080/081 own v2 activation/recovery and LA-082 owns product cutover; production publisher trust remains undecided
- unverifiedRealMachineItems: no real registry/tree, Package archive, publisher key, customer content, Package route/UI, installed runtime, signed app/archive or network source was used; managed E5 acceptance skipped because its pack is absent

## LA-080 — Atomically activate approved declarative Packages into v2

- status: completed
- dependencies: LA-078, LA-079
- baseCommit: `eae91a233f456bc4feb2e7deaa55affbf1a89466`
- resultCommit: `SELF`
- filesChanged: unconnected v2 Package registry/content activation service; strict registry reader; approval/archive/signature revalidation; private same-root staging extraction; post-extraction resource digest checks; cross-process writer lock; read-only content publish; fsync-backed atomic registry writer; pure-resource resolver with no Extension surface; focused synthetic activation/concurrency/rollback regressions; current package/resource/migration documentation; ledgers
- testsAdded: initial missing-module characterization failure; successful exact activation and resource resolution; Package exists; archive tamper; expired approval; deterministic concurrent writer refusal; injected pre-registry failure rollback; no staging residue; no executable Extension result; registry/content parity
- commandsExecuted: focused activation test first failed because the module did not exist; first implementation exposed read-only staging rollback failure and then tampered-tar error normalization before passing; `npm run typecheck`; `npm run test:list` confirmed automatic discovery; Desktop typecheck; roadmap validation/test; release check; JSON ledger parse; source guard; diff check
- migration: synthetic v2 only; `installed-v1` and legacy trees remain untouched/read-only; the new writer owns only `packages-v2` and is not connected to routes, UI, runtime resource activation or real `data/**`
- rollback: before registry commit, restore removability and delete newly published content plus staging; because no production caller exists, the v2 module/root can be removed without restoring npm or legacy writes; after a committed atomic rename, content remains consistent with registry
- deletedEntries: none; no legacy registry/tree, Package, approval, route or user data was read, rewritten or deleted
- remainingRisks: LA-081 must add a durable activation journal and startup recovery for process/OS crashes between phases; lock staleness is not yet recovered; LA-082 owns production route/UI and runtime cutover; production publisher trust remains undecided
- unverifiedRealMachineItems: only synthetic temporary roots and generated keys/archives were used; no real `data/**`, customer Package, route/UI, installed runtime, signed app/archive, crash/power-loss injection or network was used

## LA-081 — Recover declarative Package activation by exact revision

- status: completed
- dependencies: LA-080
- baseCommit: `b971adb2ebb838037967a580f686c8614e700bb5`
- resultCommit: `SELF`
- filesChanged: durable versioned activation journal; exact previous/target registry revision+hash and record binding; five deterministic abrupt-termination fault points; exclusive-startup recovery; exact rollback/finalize decisions; orphan staging cleanup; persistent recovery-blocked marker and activation refusal; idempotent recovery; activation registry/content verification exports; focused recovery regressions; current package/resource/migration documentation; ledgers
- testsAdded: crash after journal prepared, staging verified, content published, registry rename and registry-committed journal; exact expected rollback/finalize for each; second-run idempotence; orphan staging cleanup; rollback failure -> persistent blocked; activation denied while blocked; previous-registry content changed without revision -> blocked; exclusive-startup requirement
- commandsExecuted: recovery implementation and deterministic fault matrix were developed together, so this Ticket lacks a pre-implementation missing-module failure and records that process deviation explicitly; focused recovery test passed; LA-080 activation regression passed; `npm run typecheck`; automatic recovery suite discovered 193 total root tests, ran 9 recovery tests and included the new suite; Desktop typecheck; roadmap validation/test; release check; JSON ledger parse; source guard; diff check
- migration: v2 synthetic state only; journal schema v1 and blocked marker live solely under `packages-v2`; no legacy registry/tree, runtime schema, route, UI or real user data was read or migrated
- rollback: before production cutover, remove the unconnected v2 activation/recovery modules and synthetic roots; never clear an ambiguous blocked marker automatically or fall back to legacy/npm writers
- deletedEntries: none; recovery removes only exact journal-owned synthetic staging/content proven uncommitted, while ambiguous evidence is retained blocked
- remainingRisks: real SIGKILL/power-loss/filesystem behavior is not yet proven; publisher-root governance remains undecided; LA-082 must call recovery under actual exclusive startup before enabling routes and must expose blocked diagnostics without bypass
- unverifiedRealMachineItems: no real `data/**`, Package, publisher key, customer content, route/UI, packaged runtime, signed app/archive, actual process kill, power loss or network was used

## LA-082 — Cut Stable Package Center over to signed declarative v2 resources

- status: completed
- dependencies: LA-019, LA-081
- baseCommit: `ae7b116056db77f360758394a40997d992a3d2dd`
- resultCommit: `SELF`
- filesChanged: Stable Package routes; v2 resource resolver and General Run manifest projection; fail-closed Package-root process lease and startup activation recovery; strict Desktop DTO/client; `.lapkg` native picker and Settings risk/signature surface; path-redacted legacy inventory DTO; route/Desktop/recovery security regressions; current Package policy, inventory, migration, risk and deletion control documents; ledgers
- testsAdded: old npm preview/install endpoints return 410 without invoking legacy writers; catalog is discovery-only; installed DTO is v2 and does not expose legacy absolute paths; unknown fields and non-`.lapkg` paths rejected; active Run lease blocks activation; exact preview/activation path invalidates future resource catalogs; live Package-root owner blocks and provably dead owner is replaceable; single-file `.lapkg` picker; Desktop source guard proves only new endpoints and no catalog install action; deterministic Preview hash mutation and General crash disposal waits replace two randomized full-suite assertions discovered during final validation
- commandsExecuted: focused route test first failed by reaching the legacy npm preview and then passed after cutover; activation and General Run regressions passed; Package-root lease regression and all 9 recovery suites passed; automatic security suite discovered 193 root tests and passed all 26 security tests; initial final-suite reruns exposed and corrected a random no-op Preview hash mutation plus a General crash projection/disposal race (including one temporary cleanup `ENOTEMPTY`); the final automatic root suite then passed all 193 tests with managed E5 explicitly skipped because its pack is absent; final Desktop suite passed 151 tests plus 3 acceptance activity tests; root and Desktop typechecks, roadmap validation/test, release check, JSON parse, source guard and diff check passed
- migration: no real legacy data was read or changed; `installed-v1` remains disabled and is returned only as a path-redacted read-only inventory; `packages-v2` is the sole new Package writer and General new Runs resolve only its declarative skill/prompt/theme paths; no dual write exists
- rollback: hide the new activation button and keep v2 read-only if product trust roots or recovery are unavailable; do not restore old npm endpoints, legacy executable resource resolution or a second writer
- deletedEntries: legacy npm Preview/install production callers and legacy managed-resource resolver callers; no registry, Package tree, user data or historical implementation file was deleted
- remainingRisks: production publisher enrollment/rotation/revocation storage is an unresolved Decision, so the current zero-root build visibly disables activation; Package-root lease is intentionally narrower than LA-021's full dataRoot authority and PID reuse can conservatively false-block; the old npm implementation remains dead code until its read-only catalog is separated and deletion gates pass; actual legacy inventory and real signed Package behavior remain unknown
- unverifiedRealMachineItems: no real `data/**`, customer Package, production publisher key, installed runtime, packaged app, signed archive, active live Run, actual process kill/power loss or network source was used; managed E5 acceptance remains outside this Ticket

## LA-020 — Close the declarative Stable Package Epic

- status: completed
- dependencies: LA-004, LA-018; accepted child Tickets LA-076 through LA-082
- baseCommit: `2b0c4117`
- resultCommit: `SELF`
- filesChanged: no production implementation; Epic closure recorded in the execution ledgers after format, signature, inert Preview, legacy inventory, v2 activation/recovery and product cutover Tickets completed
- testsAdded: inherited strict archive/manifest/resource validation, explicit publisher trust, zero-network/subprocess Preview, legacy read-only classification, atomic activation and crash recovery, Package-root lease, old-route 410, active-Run freeze, v2-only resolver and Desktop source/UI coverage
- commandsExecuted: accepted all child Ticket evidence; final child passed 193 root tests, 26 security tests, 9 recovery suites, 151 Desktop tests plus 3 acceptance activity tests, root/Desktop typechecks, roadmap validation/tests, release check and diff check
- migration: no real legacy Package data was read or migrated; `installed-v1` and original trees remain disabled/read-only while `packages-v2` is the only new Package writer and runtime resolver
- rollback: hide Stable activation and keep v2 read-only; never restore npm install/Preview endpoints, legacy executable resolution or dual writers
- deletedEntries: no additional files or user data; child Tickets removed the legacy production callers while retaining historical implementation until the read-only catalog is separated and deletion gates pass
- remainingRisks: production publisher enrollment/rotation/revocation and trust-root storage remain a blocked Decision; actual legacy inventory, real signed Package behavior, power-loss durability and full dataRoot single-writer authority remain unverified and are not falsely closed by this Epic
- unverifiedRealMachineItems: no real `data/**`, customer/third-party Package, production publisher key, packaged app, signed archive, active live Run, process kill, power loss or network source was used

## LA-083 — Keep Gate reports and execution ledgers in parity

- status: completed
- dependencies: LA-067
- baseCommit: `98d16a6068a73ab2837ac08183440fdfcad492fb`
- resultCommit: `SELF`
- filesChanged: roadmap Ticket registry; Gate-ledger validator and focused assertions; missing G2 records in the Markdown and JSON execution ledgers
- testsAdded: report-backed Gate IDs must exist in both ledgers; Markdown/JSON Gate IDs must each have the matching report and counterpart entry
- commandsExecuted: the first sandboxed roadmap test was blocked by the known tsx IPC EPERM and was not counted; the allowed failure run proved the new validator export was absent; roadmap test and validation passed after implementation; root/Desktop typechecks and diff check passed
- migration: none; the existing G2 report and tag remain authoritative evidence and were referenced without rewriting their history
- rollback: revert this Ticket as a unit; do not delete Gate reports/tags or leave only one ledger format updated
- deletedEntries: none
- remainingRisks: Gate evidence still records bounded automated/source verification and must not be upgraded to real-machine, signing, accessibility or customer-data proof
- unverifiedRealMachineItems: no provider, packaged app, signing identity, notarization, customer data, real `data/**` or public mirror was used

## LA-021 — Enforce one dataRoot writer lease

- status: completed
- dependencies: LA-000
- baseCommit: `18b7af1e0ee09963091162b1d840e35f1e4cc185`
- resultCommit: `SELF`
- filesChanged: dataRoot writer lease authority; server startup/request guard; Electron single-instance guard; removal of the superseded Package-root process lease; focused process fixture/test; storage/package/current-state/risk/migration documentation; ledgers
- testsAdded: initial missing-module characterization failure; two real process contention; live owner denial; provably dead PID takeover; malformed owner fail-closed; lost-owner assertion/release denial; data-directory swap preserves ownership; server acquisition-before-migration source guard; Electron single-instance source guard
- commandsExecuted: focused test first failed because `data_root_writer_lease.ts` was absent and then passed; runtime migration/storage and Package activation recovery regressions; full automatic root suite passed 194 tests; root/Desktop typechecks; full Desktop test suite passed 151 plus 3 activity tests; roadmap validation/tests; release check; source/JSON/diff guards
- migration: no real `data/**` was read or rewritten; the new owner file is runtime metadata at `.data-root-writer-lease`, outside the atomically exchanged `data/` directory; the obsolete Package-root lease has no production caller and is removed as a second authority
- rollback: stop the runtime or run it read-only; never restore best-effort multi-writer startup or the narrower Package-root process lease as canonical authority
- deletedEntries: `acquireLapkgRuntimeLease` and its duplicate owner schema/process-liveness tests; no Package registry, user data, journal, or activation state was deleted
- remainingRisks: LA-022 owns file/parent fsync and fault recovery; actual SIGKILL, PID reuse false-block behavior, same-UID lease deletion, and already-running background writes after external lease loss remain unverified
- unverifiedRealMachineItems: no real `data/**`, customer content, installed runtime, process kill, power loss, packaged-app second launch, signing, notarization, or public mirror was used

## LA-022 — Make security-critical file transactions durable

- status: completed
- dependencies: LA-021
- baseCommit: `050c40a0cac70fbe4e1f600a99f9bbf1b28ef499`
- resultCommit: `SELF`
- filesChanged: shared durable atomic-write/append primitive; workspace durability class; Task event/snapshot and first-directory publish; quality/readiness/project decisions; confirmed memory; grants/trust/settings; workflow/message queue; runtime migration; Package registry/journal consolidation; focused fault test; current storage/risk/migration documentation; ledgers
- testsAdded: initial missing-module characterization failure; ordered write/file-sync/rename/parent-sync checkpoints; before-write ENOSPC; failures before rename preserve old file and remove temp; failure after rename leaves a complete new file; durable append ordering
- commandsExecuted: focused durable test first failed because the module was absent and then passed; workspace/Task/decision/guidance/message queue/workflow/memory/grant/trust/settings/runtime migration/Package activation and recovery regressions; `npm test` passed all 195 automatically discovered root tests with only the absent managed-E5 qualification pack explicitly skipped; Desktop typecheck and 151 tests plus 3 activity acceptance tests passed; root typecheck, roadmap validation/tests, release check, JSON parse, test-discovery check and diff check passed; one workflow run was sandbox-blocked and rerun with its synthetic cache permission; one nonexistent quality checklist filename was not counted
- migration: no schema, database, dual write, user data, real `data/**`, or cache rewrite; callers opt into critical durability while rebuildable/normal files keep their prior path
- rollback: put affected critical surfaces read-only; do not revert them to unsynced writes while claiming durability; the shared primitive can be reverted only with all critical callers in the same commit
- deletedEntries: duplicate Package registry/journal fsync implementations; no Package state, decision, Task, user data, or audit record was deleted
- remainingRisks: synthetic fault injection is not actual process-kill/power-loss evidence; ordinary TM/memory audit, Private Eval and rebuildable index/cache writers are not covered by the critical guarantee; SQLite scope remains blocked on LA-062 Decision
- unverifiedRealMachineItems: no real `data/**`, disk-full filesystem, SIGKILL, power loss, customer content, installed runtime, packaged app, signing, notarization, or public mirror was used

## LA-026 — Authenticate a random Unix-domain runtime transport

- status: completed
- dependencies: LA-021
- baseCommit: `862e1bd96df53660380046f19e82d2d7c2a6272b`
- resultCommit: `SELF`
- filesChanged: signed runtime rendezvous/session credential protocol; Desktop Unix HTTP/SSE client and Keychain bootstrap use; server default Unix listener and authenticated health; LaunchAgent/dev/update/installer health migration; explicit non-simultaneous loopback transition mode; packaging allowlist; focused transport/resident/Desktop regressions; architecture/risk/inventory/migration/current-state docs; ledgers
- testsAdded: initial missing rendezvous module failure; signed record and identical session derivation; no credential on disk; clean first-install offline state; overlong Unix path, tamper/root/owner/mode denial; `0600` rendezvous and socket; synthetic fixed-port squatter receives zero requests; integrated Desktop request; restart publishes a new endpoint/credential and reconnect rereads it; Unix health requires authentication; LaunchAgent contains no fixed host/port; automatic security-suite discovery
- commandsExecuted: focused rendezvous test first failed because both protocol modules were absent, then the sandbox run was blocked from binding the synthetic squatter and the allowed run passed; the first 27-test security run exposed the macOS Unix-path limit and passed after fail-closed validation plus a short per-user `/tmp` root; focused Package tests passed after a concurrent full-suite attempt produced a non-reproducible `tar/minipass write after end`; one isolated rerun passed all 196 automatically discovered root tests with only the declared missing Managed E5 pack skip; 27 security tests, root/Desktop typechecks, Desktop 151+3 tests, `mac:test`, roadmap validation/tests, release check and `git diff --check` passed
- migration: existing Keychain token remains a bootstrap HMAC key and is not transmitted on the default path; Session credential is derived per runtime start and never persisted; default server and managed LaunchAgent use only one random Unix socket; explicit `LA_SERVER_PORT` or `LA_LOCAL_TRANSPORT_MODE=loopback` keeps a one-version/test compatibility path without simultaneous listeners
- rollback: stop or repair the runtime; retain authenticated signed rendezvous verification; the explicit authenticated loopback transition may be selected for one version but public-health-then-long-term-token behavior must not return
- deletedEntries: fixed-port defaults from the managed LaunchAgent, Desktop installer/update health checks and dev start/stop path; no Keychain item, user data, runtime data, credential or public repository object was read or deleted
- remainingRisks: same-UID native malware that can invoke the trusted Keychain client is not isolated by UDS; XPC/audit-token/code-signing requirement remains a future threat-model decision; real old-install upgrade, Keychain ACL prompts, launchd and packaged-app reconnect are unverified
- unverifiedRealMachineItems: no installed runtime, actual Keychain item, LaunchAgent mutation, packaged app, legacy installation, real `data/**`, customer data, signing, notarization or public mirror was used

## LA-027 — Route product logs through structured redaction

- status: completed
- dependencies: LA-010, LA-016
- baseCommit: `7d9d06dd1f9fc71dd6b023ab7f4d0d2742c7d114`
- resultCommit: `SELF`
- filesChanged: shared browser-safe structured logger/redactor and cat-data export; server/general/eval/memory/renderer product-log cutover; schema-v1 server diagnostics with diagnostic IDs, append/read redaction, serialized retention rotation; production console architecture guard and focused redaction/legacy/retention tests; Project diagnostic expectation; test security-suite discovery; architecture/runtime/current-reality/inventory/migration docs; ledgers
- testsAdded: initial missing shared module failure; unknown free-form customer text and explicit source/target fields; nested Error/code/cause/extra fields without message/stack disclosure; authorization/cookie/API key and URL query redaction; local Unix/Windows path redaction; bounded/circular contexts; schema-v1 JSON line and diagnostic ID; legacy diagnostic read projection redacted without rewriting old bytes; 5 MiB-default single-archive retention using a bounded synthetic threshold; repository-wide production `console.*` guard with one documented non-retained CLI exception; automatic security-suite discovery
- commandsExecuted: focused safe-logging test first failed because the module did not exist, then exposed customer-text leakage and direct production console callers before passing; Project diagnostics, General Run, Private Eval route and legacy memory-tool focused regressions passed; the final focused test also covered Windows paths, circular contexts, bounded arrays and active/archive size limits; 28 security tests and all 197 automatically discovered root tests passed with only the declared absent Managed E5 qualification pack skipped; 151 Desktop tests plus 3 activity acceptance tests, root/Desktop typechecks, Desktop production build, roadmap validation/tests, release check and diff check passed
- migration: no existing log file is rewritten; new product events emit schema-v1 JSON lines; legacy server diagnostic rows are sanitized only in their read projection; append rotates the active diagnostic file at 5 MiB and retains one `.1` archive; domain audit records remain owned by their domain and are not silently reclassified as product logs
- rollback: reduce or disable detailed logging while retaining the shared redactor and fixed event codes; never restore raw payload console fallbacks; server diagnostics may become read-only if rotation fails
- deletedEntries: direct production console payload calls in server, General coordinator, Private Eval background execution, legacy memory tools and renderer error boundary; no historical log, audit, user data, customer content or public repository object was read, rewritten or deleted
- remainingRisks: existing historical log bytes may still contain pre-LA-027 material and are intentionally not rewritten; real launchd stdout/stderr retention is not proven; domain audit schemas remain separate; aggressive unknown-string redaction reduces diagnostic detail by design; user-facing scripts outside product runtime retain their CLI output
- unverifiedRealMachineItems: no real `data/**`, historical logs, customer text, installed LaunchAgent, packaged-app crash, log-volume stress, signing, notarization or public mirror was used

## LA-062 — Decide the SQLite storage boundary

- status: completed
- dependencies: LA-000
- baseCommit: `fac579c29f1027872509558da98525fbb1718a0f`
- resultCommit: `SELF`
- filesChanged: accepted storage ADR; queue/current-reality/risk/migration documentation; docs index/maintenance owner; roadmap ADR validator; execution ledgers; no database, migration, production schema or writer was created
- testsAdded: none; this is a non-executable Decision
- commandsExecuted: source-only storage-boundary and migration-control scan without opening `data/**`; roadmap validation/tests; release check; JSON ledger parse; diff check
- migration: none; JSON/JSONL and the existing domain stores remain canonical under the LA-021 dataRoot lease and LA-022 durability classes
- rollback: revert the accepted ADR/control-plane commit before LA-023 starts; once migration Tickets exist, a new explicit Decision is required rather than silently restoring the old blocked state
- deletedEntries: none
- remainingRisks: real scale and recovery measurements remain unavailable because this campaign is forbidden from reading real `data/**`; LA-023 must remain synthetic and LA-024/025 domain child Tickets cannot cut over until their parity, backup, rollback and JSONL export gates pass
- unverifiedRealMachineItems: no real data size distribution, largest Task/Project, corrupt historical sample, backup restore, SQLite WAL behavior, JSONL export parity, schema migration, process kill, power loss, customer data or public mirror was inspected

## LA-023 — Establish a synthetic SQLite WAL event/projection foundation

- status: completed
- dependencies: LA-008, LA-021, LA-062
- baseCommit: `30aa7f8a9f456647d67b0e20d36302e19e92ee42`
- resultCommit: `SELF`
- filesChanged: private workspace package/lock entry; one concrete Node `node:sqlite` schema-v1 event/projection store; synthetic focused test and automatic discovery; architecture/current-reality/inventory/risk/migration docs; ledgers
- testsAdded: initial missing-module failure; WAL/FULL-sync schema migration; atomic stream/event/projection/idempotency commit; same-command retry and mismatched-command refusal; same/second-connection revision CAS; constraint failure rollback; non-JSON rejection; reopen/quick-check; future/incomplete schema refusal; production import guard
- commandsExecuted: focused test first failed because the package was absent and then passed; test discovery listed 198 root tests; recovery suite ran 10 tests including the new SQLite test; full root suite ran all 198 discovered tests; Desktop passed 151 Node tests plus 3 Electron acceptance tests; root and Desktop typechecks, roadmap validation/tests, release check and `git diff --check` passed (roadmap/release checks were rerun with local IPC permission after the restricted sandbox denied the `tsx` socket)
- migration: synthetic temp databases only; no real `data/**`, production writer, JSON/JSONL file, schema, Task, Project or customer content was read or changed; JSON/JSONL remains canonical
- rollback: delete the unconnected package, its lock entries and focused test; no production data or authority rollback is needed
- deletedEntries: none
- remainingRisks: Node 22 emits an experimental warning for `node:sqlite`; real scale, WAL growth, backup/restore, JSONL export, import parity, process kill, power loss and production cutover remain unproven and belong to LA-024/025 child Tickets and G4
- unverifiedRealMachineItems: no real data, largest Task/Project, corrupt historic sample, installed runtime, packaged app, backup, import, export, process kill, power loss, customer content or public mirror was used

## LA-084 — Establish authority-gated SQLite backup and restore

- status: completed
- dependencies: LA-022, LA-023
- baseCommit: `343c2d43dd7c962538e2afa175590200ccbc8d64`
- resultCommit: `SELF`
- filesChanged: `storage-sqlite` online backup/restore and manifest implementation; Node engine floor/lock metadata; synthetic recovery test; architecture/current-reality/inventory/migration docs; ledgers
- testsAdded: initial missing-export failure; WAL-consistent pre-mutation snapshot; exact manifest/schema/digest/size; optional immutable blob copy/restore; source mutation isolation; tampered DB denial without target; missing blob denial; authority loss before publish cleanup; existing canonical target overwrite refusal
- commandsExecuted: focused test first failed because backup exports were absent and then passed; automatic discovery listed 199 root tests; recovery suite ran 11 tests including both SQLite tests; all 199 discovered root tests passed with only the already-declared missing Managed E5 qualification pack skipped; Desktop passed 151 Node tests plus 3 Electron acceptance tests; root/Desktop typechecks, roadmap validation/tests, release check, ledger JSON parse and `git diff --check` passed
- migration: synthetic temporary DB/blob inputs and absent restore targets only; no production startup/caller, real `data/**`, Task, Project, user setting, JSON/JSONL writer or customer content was read or changed
- rollback: remove the unconnected backup/restore exports and focused test, restore the package engine floor if no remaining API needs it; JSON/JSONL remains canonical throughout
- deletedEntries: none
- remainingRisks: `node:sqlite` remains experimental on Node 22; no real size, duration, WAL growth, concurrent production mutation, process kill, power loss, full blob CAS, JSONL export, domain import/parity or cutover evidence exists
- unverifiedRealMachineItems: real data/backup duration/recovery time, installed runtime, packaged app, process kill, power loss, disk full, customer content and public mirror were not used

## LA-085 — Freeze the versioned legacy Task SQLite mapping contract

- status: completed
- dependencies: LA-023, LA-084
- baseCommit: `9a3e9b8b9c7aeea7f0555aed4fae668da7831150`
- resultCommit: `SELF`
- filesChanged: schema-v1 data-only legacy Task mapping contract; exact persisted field inventories for Task workspace/Run/event, quality decision ledger, message queue and Task Package profile; ordering/revision/cursor/blob-reference boundaries; strict unknown contract/legacy field guards; unconnected SQLite v1-to-v2 mapping-contract migration and hash verification; synthetic Project/standalone/migration tests; architecture/current-reality/inventory/risk/migration docs; ledgers
- testsAdded: initial missing mapping module failure; all five source contracts and entity field uniqueness; Project and standalone scope; unsupported mapping version; unknown mapping field; unknown legacy entity field; schema-v2 hash-bound stored contract; v1-to-v2 migration ledger and reopen
- commandsExecuted: focused test first failed because `task_mapping_contract.ts` did not exist and then passed; SQLite foundation and backup regressions passed after expected schema version updates; `npm run test:list` discovered 200 root tests and listed the new test; recovery suite was rerun after the filename was made discoverable and ran/passed 12 tests including all three SQLite tests; full root suite ran/passed all 200 discovered tests with only the declared absent Managed E5 qualification pack skipped; Desktop passed 151 Node tests plus 3 activity acceptance tests; root/Desktop typechecks, roadmap validation/tests, release check, JSON parse and diff check passed
- migration: only the unconnected synthetic SQLite schema migrated from v1 to v2; no importer, production writer/startup caller, JSON/JSONL authority, real `data/**`, Task, Project, queue, decision, Package profile, user schema or customer content was read or changed
- rollback: remove schema-v2 mapping table/contract/test and return the unconnected synthetic database to schema v1; JSON/JSONL remains the only production authority, so no user-data rollback or dual-write reconciliation is required
- deletedEntries: none; no legacy field, source file, Task event, decision, queue message, resource approval or user data was deleted
- remainingRisks: exact real legacy schema distribution and previously unknown fields remain unverified; LA-086/088 must block rather than guess on unmapped input and prove ordered import/replay parity before LA-087/089 cutover; artifact bytes remain legacy inline JSON until LA-092 defines the CAS boundary; `node:sqlite` remains experimental
- unverifiedRealMachineItems: no real `data/**`, historical corrupt/torn sample, largest Task/Project, production import, installed runtime, packaged app, process kill, power loss, disk full, customer content or public mirror was used

## LA-086 — Prove legacy Task import and replay parity on synthetic roots

- status: completed
- dependencies: LA-085
- baseCommit: `bce36bb8b09b5c8dd39594037d71c41907358467`
- resultCommit: `SELF`
- filesChanged: exact `cat-data` workspace dependency/lock entry; authority-gated legacy Task source reader, backup manifest, strict field validation, ordered event import and semantic reducer parity implementation; revision-zero projection initialization; synthetic Project/standalone importer recovery test; architecture/current-reality/inventory/risk/migration docs; ledgers
- testsAdded: initial missing importer/export failure; Project and standalone Task counts/sequence/cursor; exact JSON-semantic event payloads; replayed/stored projection equality and reopen; idempotent repeated import; zero-event revision-zero projection; supported torn-final-record classification; corrupt middle record refusal after durable source backup; source mutation after backup refusal; writer-authority loss immediately before commit refusal
- commandsExecuted: focused importer test first failed because the module/export did not exist and then passed; root typecheck and recovery suite passed with 201 automatically discovered root tests and 13 recovery tests; full root suite ran/passed all 201 tests with only the declared absent Managed E5 qualification pack skipped; Desktop passed 151 Node tests plus 3 Electron activity acceptance tests and typecheck; roadmap validation/tests, release check and diff/ledger checks passed
- migration: synthetic temporary Project and standalone Task roots only; each source was copied to a new hash-manifest backup before classification and imported into a separate temporary SQLite database; no production caller/startup, real `data/**`, canonical JSON/JSONL writer, user schema, Task, Project or customer content was read or changed
- rollback: remove the unconnected importer, revision-zero initialization API, exact `cat-data` package dependency and focused test; delete only synthetic temporary databases/backups; JSON/JSONL remains the sole production authority
- deletedEntries: none; no legacy Task directory, event, snapshot, user data or public repository object was deleted or rewritten
- remainingRisks: only repository-generated synthetic schema shapes were exercised; real historical field/version distribution, largest Task, prior corrupt records, production authority cutover, process-kill/power-loss and JSONL export remain unproven; LA-087 must not treat synthetic parity as permission to guess or silently repair real legacy input; `node:sqlite` remains experimental
- unverifiedRealMachineItems: no real `data/**`, historical Task, customer content, installed runtime, packaged app, production migration, process kill, power loss, disk full or public mirror was used

## LA-102 — Repair the Task aggregate cutover boundary

- status: completed
- dependencies: LA-086
- baseCommit: `16bf40f29cee99848e633c0d18857e31f5b1d3f8`
- resultCommit: `SELF`
- filesChanged: implementation queue ticket/dependency/cutover-owner contract; roadmap validator and characterization tests; architecture/current-reality/module inventory/risk/migration documents; ledgers
- testsAdded: initial validator failure for missing Task aggregate cutover owner and missing LA-087 boundary dependency; missing/duplicate owner refusal; wrong owner refusal; LA-087 bypass dependency refusal; existing dependency/risk/Epic validation retained
- commandsExecuted: focused roadmap test first failed with zero cutover owners and absent LA-102 dependency, then passed; roadmap validation passed; full roadmap suite, typecheck, release check, JSON ledger parse and diff check passed
- migration: none; this Ticket only corrects the execution control plane after source tracing proved Task events/snapshot embed Decisions
- rollback: do not restore the old split cutover plan; any replacement must still prove one Task aggregate and one production authority switch without a dependency cycle
- deletedEntries: the unsafe claim that LA-087 may switch only Task/Run/Event before Decision parity; no production code, schema, data, customer content or public repository object was changed
- remainingRisks: LA-087 repository parity and LA-088 remaining Task-side state parity are not implemented; LA-089 production cutover still cannot proceed without both; real historical data remains unverified by campaign constraint
- unverifiedRealMachineItems: no real `data/**`, runtime startup, installed app, production cutover, rollback, customer content or public mirror was used

## LA-087 — Establish the unconnected SQLite TaskWorkspace repository

- status: completed
- dependencies: LA-086, LA-102
- baseCommit: `6ae48b6087a111e16dc766c3fefccc26d12d3c33`
- resultCommit: `SELF`
- filesChanged: `TaskWorkspacePersistence` seam and unchanged file adapter; unconnected authority-gated SQLite TaskWorkspace repository/factory; revision-zero stream append repair; machine-readable unconnected/LA-089 readiness marker; synthetic repository test; architecture/current-reality/inventory/risk/migration docs; ledgers
- testsAdded: initial projection-only revision-zero first-append failure; Project/standalone shared repository; reopen/event replay; exact projection CAS with one stale contender rejected; authority-loss mutation refusal; imported legacy Task reopen and continued write; production-package import guard; automatic discovery
- commandsExecuted: focused repository test first reproduced the revision-zero stream uniqueness failure and then passed; TaskWorkspace contract/workspace/Project route/standalone route, SQLite foundation and importer regressions passed; all 202 automatically discovered root tests passed with only the declared missing Managed E5 pack skip; 13 recovery tests passed; Desktop passed 151 Node tests plus 3 Electron activity tests and typecheck; root typecheck, roadmap validation/tests, release check and diff check passed
- migration: synthetic temporary SQLite databases and repository-generated legacy Task roots only; the repository readiness marker remains `unconnected`; no production package imports the SQLite package, no startup composition changed, and JSON/JSONL remains the sole production authority
- rollback: remove the unconnected repository/factory/readiness marker and restore the file-only `TaskWorkspace` assembly; retain the revision-zero stream fix if projection initialization remains supported; no production data or writer rollback is required
- deletedEntries: none; no legacy writer, Task directory, event, snapshot, user data or public repository object was removed or rewritten
- remainingRisks: LA-088 must still prove Decision/queue/resource-profile parity; LA-089 alone may perform the complete Task aggregate production cutover; real historical shapes, largest Task, production startup crash, process-kill/power-loss and JSONL export remain unproven; `node:sqlite` remains experimental
- unverifiedRealMachineItems: no real `data/**`, historical Task, customer content, installed runtime, packaged app, production writer switch/rollback, process kill, power loss, disk full or public mirror was used

## LA-088 — Prove Task side-state import parity

- status: completed
- dependencies: LA-085, LA-086
- baseCommit: `ac57e209aa553d627ce3fa88324f489558519fde`
- resultCommit: `SELF`
- filesChanged: strict unconnected legacy Task side-state importer/export; synthetic Decision/quality ledger/message queue/resource-profile parity and refusal test; architecture/current-reality/inventory/risk/migration docs; ledgers
- testsAdded: initial missing-export failure; embedded Task Decision equality; Project quality ledger sequence/hash-chain/scope and Project-level stream identity; queue stored order/status; resource profile revision/canonical sort/production hash; idempotent repeat; orphan Task, unknown field and authority-loss refusal with raw source preserved
- commandsExecuted: focused importer test first failed because the export was absent and then passed; quality decision ledger, Task message queue, Task Package profile, Task importer and SQLite repository regressions passed; all 203 automatically discovered root tests passed with only the declared absent Managed E5 pack skip; 14 recovery tests passed; Desktop passed 151 Node tests plus 3 Electron activity tests and typecheck; root typecheck, roadmap validation/tests, release check, ledger JSON parse and diff check passed
- migration: synthetic temporary Project Task roots and SQLite databases only; the Task aggregate had to be imported first, all side inputs were copied to a hash-manifest backup, and the importer remained unconnected; no production caller/startup, real `data/**`, canonical writer, Project, Task or customer content was read or changed
- rollback: remove the unconnected side-state importer/export and focused test and delete only its synthetic import database/report; JSON/JSONL remains the sole production authority
- deletedEntries: none; no Task Decision, quality ledger row, queued message, resource selection/approval, legacy file, user data or public repository object was deleted or rewritten
- remainingRisks: the synthetic importer publishes quality, queue and profile streams in separate commits and is not a production atomic cutover; LA-089 must switch the Task/embedded-Decision/queue/profile aggregate atomically or leave its JSON/JSONL canonical, while Project quality remains JSONL until LA-098; real historical shapes, largest Project ledger, process-kill/power-loss and JSONL export remain unproven; `node:sqlite` remains experimental
- unverifiedRealMachineItems: no real `data/**`, historical Decision/queue/profile/quality ledger, customer content, installed runtime, packaged app, production cutover/rollback, process kill, power loss, disk full or public mirror was used

## LA-103 — Repair the Project quality-ledger cutover boundary

- status: completed
- dependencies: LA-088
- baseCommit: `08743c93194b737040312403ed3688c71911d9b9`
- resultCommit: `SELF`
- filesChanged: storage authority-boundary validator and characterization tests; implementation queue Ticket/dependency/owner markers; architecture/current-reality/inventory/risk/migration documents; ledgers
- testsAdded: initial missing validator export failure; missing Project quality-ledger owner refusal; missing Task-aggregate exclusion marker refusal; existing dependency/risk/Epic/cutover-owner validation retained
- commandsExecuted: focused roadmap test first failed because the authority-boundary validator export was absent and then passed; roadmap validation, root typecheck, release check and diff check passed
- migration: none; source tracing established that the Project-root quality ledger is shared across Tasks and CAT governance, so this Ticket only repairs the execution control plane
- rollback: do not restore two cutover owners; any replacement must keep Project quality ledger under exactly one Project-level production authority and outside LA-089
- deletedEntries: the unsafe control-plane claim that LA-089 owns Project quality-ledger cutover as part of a Task aggregate; no production code, schema, data or historical evidence was deleted
- remainingRisks: LA-089 still requires a production-safe Task/embedded-Decision/queue/profile composition seam and atomic authority marker; Project quality ledger remains JSONL until LA-098; real historical Project concurrency is unverified
- unverifiedRealMachineItems: no real `data/**`, Project quality ledger, runtime startup, production cutover/rollback, customer content, installed app or public mirror was used

## LA-104 — Add an install-once Task aggregate storage seam

- status: completed
- dependencies: LA-103
- baseCommit: `dc69d6e385e8020c9053dc2bb22a6784ef58b336`
- resultCommit: `SELF`
- filesChanged: cat-data install-once Task aggregate backend contract; Workspace and message-queue file persistence adapters/resolvers; cat-server Task Package profile persistence adapter/resolver; focused dispatch test; LA-105 dependency split; architecture/current-reality/inventory/risk/migration/queue docs; ledgers
- testsAdded: initial missing-export failure; synthetic alternate-root Workspace/queue/profile dispatch; default file bytes at the backend root; second backend installation refusal; another-root access refusal
- commandsExecuted: focused dispatch test first failed because the file queue persistence export was absent and then passed; TaskWorkspace, message queue, Task Package profile and profile-route regressions passed; all 204 automatically discovered root tests passed with only the declared absent Managed E5 pack skip; 15 recovery tests passed; Desktop passed 151 Node tests plus 3 Electron activity tests and typecheck; root typecheck, roadmap validation/tests, release check, ledger JSON parse and diff check passed
- migration: none; no backend is installed by production startup, so every current caller resolves to the existing file implementation and JSON/JSONL remains canonical
- rollback: remove both install-once resolvers and persistence interfaces together and restore direct file factories; do not leave Workspace, queue or profile on different authority paths
- deletedEntries: direct public Task queue/profile file selection inside their read/update/apply entrypoints; the same file behavior remains behind named adapters; no data, legacy reader/writer, Task or public repository object was deleted
- remainingRisks: LA-105 must implement unconnected SQLite queue/profile persistence and a complete backend; LA-089 must install it only after backup/import/parity and publish one authority marker; explicit low-level file factories remain callable until LA-089 old-writer guards them
- unverifiedRealMachineItems: no real `data/**`, production backend installation, runtime startup, Task migration, installed app, customer content or public mirror was used

## LA-105 — Compose the unconnected SQLite Task aggregate backend

- status: completed
- dependencies: LA-087, LA-088, LA-104
- baseCommit: `b59e03169e5de142141cac41f6c478e43663f1c4`
- resultCommit: `SELF`
- filesChanged: storage-sqlite queue/profile repositories and aggregate backend factory/export; focused recovery-classified backend test; current-reality/inventory/risk/migration control-plane docs; ledgers
- testsAdded: initial missing-export failure; install-once public dispatch over the complete backend; imported queue stored order/status and profile revision/production hash; queue/profile writes and reopen; concurrent exact-projection CAS with one winner; absent-stream initialization; queue/profile authority-loss refusal without projection change; unknown-field refusal; production factory import guard
- commandsExecuted: focused backend test first failed because the backend export was absent and then passed; SQLite foundation/import/side-state/repository, Task composition, message queue and Task Package profile regressions passed; all 205 automatically discovered root tests passed with only the declared absent Managed E5 pack skip; 16 recovery tests passed; Desktop passed 151 Node tests plus 3 Electron activity tests and typecheck; root typecheck, roadmap validation/tests, release check, ledger JSON parse and diff check passed
- migration: synthetic temporary SQLite databases only; the backend remains marked `unconnected`, production startup imports/installs nothing, and no authority marker was published
- rollback: remove the unconnected SQLite queue/profile adapters, factory/export and focused test; the LA-104 file-default seam and JSON/JSONL canonical writer remain unchanged
- deletedEntries: none; no file writer, legacy reader, Task state, queued message, resource profile, Project quality ledger, user data or public repository object was deleted or rewritten
- remainingRisks: LA-089 must inventory and backup real-shaped legacy roots without reading production data in tests, prove import parity under the writer lease, publish one Task-domain authority marker, install this backend once, and guard old Task writers; Project quality ledger remains JSONL until LA-098; `node:sqlite` remains experimental
- unverifiedRealMachineItems: no real `data/**`, historical Task/queue/profile, customer content, production startup/cutover/rollback, process kill, power loss, disk full, installed app or public mirror was used

## LA-089 — Cut Task aggregate production authority to SQLite

- status: completed
- dependencies: LA-087, LA-088, LA-103, LA-105
- baseCommit: `da6e6d521110e363cbb9af1b856659dff01f3c39`
- resultCommit: `SELF`
- filesChanged: startup-only Task aggregate inventory/backup/import/parity/marker/activation module; cat-server SQLite dependency and startup/shutdown wiring; Project-quality exclusion in the side importer; install-once legacy Task state-writer block across Workspace/queue/profile; canonical SQLite recovery enumeration; focused cutover/recovery test and updated pre-cutover source guards; architecture/current-reality/inventory/risk/migration docs; ledgers
- testsAdded: initial missing cutover module failure; Project Task workspace/embedded Decision/queue/profile cutover parity; no Project quality shadow projection; source bytes unchanged; durable marker reload; pending queue recovery; nonzero active-Run refusal before marker; partial pre-marker database idempotent recovery; corrupt source refusal without marker; complete backup manifest and exact backup-file hash/size required after marker; explicit old file-writer refusal; SQLite-only post-cutover Task creation/reload; SQLite-only active Run startup reconciliation; sole LA-089 production import guards
- commandsExecuted: focused test first failed because the cutover module did not exist and then passed; affected Task/queue/profile/import/repository/reconciliation tests passed; root typecheck passed; full root suite initially exposed two obsolete pre-LA-089 source guards, both were narrowed to the sole LA-089 owner, and the final automatic run passed all 206 discovered tests with only the declared missing Managed E5 qualification pack skipped; recovery suite passed all 17 tests; Desktop passed 151 Node tests plus 3 Electron activity tests and Desktop typecheck; roadmap/release/diff/ledger checks passed
- migration: production startup code is now wired to migrate the Task aggregate only under the data-root writer lease and before recovery/listen, but this campaign did not launch it against the repository or read/modify any real `data/**`; all executed cutovers, backups, partial-crash recovery and post-cutover writes used synthetic temporary roots
- rollback: before marker publication, discard the partial candidate database and retain the legacy writer; after marker publication, rollback must restore the entire Task/embedded-Decision/queue/profile domain from the exact marker-linked backup and switch one authority marker—never re-enable only one legacy sub-writer or touch the Project quality ledger; the synthetic executable rollback proof is provided by LA-091, while production rollback remains unverified
- deletedEntries: no Task, event, Decision, queue message, resource profile, Project quality ledger row, legacy state file, user data or public repository object was deleted or rewritten; obsolete tests claiming production wiring was forbidden before LA-089 were replaced by sole-owner guards
- remainingRisks: real historical schema distribution/size and startup duration are unverified because real `data/**` is prohibited; LA-091 synthetic whole-domain rollback/no-dual-authority proof is complete, but process-kill, power-loss, disk-full, production rollback and stable compatibility-window deletion remain unverified; deterministic JSONL audit export is complete under LA-090; `node:sqlite` remains experimental; Project quality ledger remains JSONL until LA-098
- unverifiedRealMachineItems: real `data/**`, historical corrupt/unknown Task shapes, installed runtime startup, packaged app, real cutover/rollback, process kill, power loss, disk full, customer content and public mirror were not used

## LA-090 — Generate deterministic read-only JSONL audit exports

- status: completed
- dependencies: LA-089
- baseCommit: `8a8573f947d20993cc85ed5ca1f80886920af652`
- resultCommit: `SELF`
- filesChanged: storage-sqlite read-only constructor option and audit export/verify service; strict local CLI and root script; deterministic export test; architecture/current-reality/inventory/risk/migration documents; ledgers
- testsAdded: initial missing audit-export API failure; repeated byte-identical export; stable stream/event sequence and record hash chain; canonical payload/projection digest without raw content, paths, credentials or original identifiers; whole-file digest/counts; read-only database byte preservation; strict export/verify CLI arguments; tamper refusal; absolute destination; real publish-race no-overwrite with competing bytes preserved and staging cleanup; source guard forbidding SQLite writer methods
- commandsExecuted: focused audit test first failed because the API export was absent and then passed; root typecheck passed; all 207 automatically discovered root tests passed with only the declared absent Managed E5 pack skip; 17 recovery tests passed; Desktop passed 151 Node tests plus 3 Electron activity tests and Desktop typecheck; roadmap/release/ledger/diff checks passed
- migration: none; the service and CLI only read an explicitly named SQLite database and write a new explicitly named audit file; all tests used synthetic temporary data and no production startup, real `data/**` or JSONL authority was changed
- rollback: remove the audit module/export, CLI/root script and focused test; canonical SQLite and the LA-089 authority marker remain unchanged because the audit format has no import or write path
- deletedEntries: none; no SQLite event/projection, legacy Task file, JSONL authority, user data or public repository object was deleted or rewritten
- remainingRisks: the exporter currently materializes canonical records in memory, so real maximum database/export size and latency remain unmeasured; LA-091 synthetic whole-domain rollback, compatibility-window read-only behavior and no-dual-authority proof is complete, but production rollback and real compatibility-window operation remain unverified; `node:sqlite` remains experimental; Project quality ledger remains JSONL until LA-098
- unverifiedRealMachineItems: real `data/**`, large historical SQLite snapshots, installed runtime CLI invocation, disk-full/power-loss during export, packaged app, customer content and public mirror were not used

## LA-091 — Prove whole-domain Task rollback and legacy compatibility

- status: completed
- dependencies: LA-084, LA-087, LA-089, LA-090
- baseCommit: `bdf08117`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/task_aggregate_sqlite_cutover.ts`; `packages/cat-server/src/task_aggregate_legacy_rollback.ts`; `tests/sqlite_storage_task_rollback.test.ts`; `tests/sqlite_storage.test.ts`; `tests/sqlite_task_workspace_repository.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/IMPLEMENTATION_QUEUE.md`; `docs/roadmap/MIGRATION_MATRIX.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: SQLite-only Task survives rollback; queued message survives rollback; legacy startup does not auto-re-cutover; legacy writes remain available only while legacy authority is active; fresh re-cutover imports Tasks created during rollback; restart/recovery; active-Run rollback/re-cutover refusal; old-writer AST guards remain present; audit JSONL verifies against the source SQLite database
- commandsExecuted: focused rollback test initially failed on missing rollback module; rerun exposed legacy importer event-page semantics and then passed after exporting one complete event page; two full-suite attempts exposed the architecture-owner allowlist and passed after both guards were updated; final `npm test` passed all 208 discovered root tests; `npm run test:recovery` passed 18 tests; `npm --prefix apps/desktop test` passed 151 Node plus 3 Electron activity tests; `npm run mac:test` passed Desktop tests and typecheck; focused cutover/audit/backend/rollback/repository tests passed; `npm run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; `npm run release:check`; `git diff --check`
- migration: synthetic temporary roots only; rollback reads the active SQLite aggregate read-only, exports all current Task/embedded-Decision/queue/profile projections, publishes legacy-compatible files, writes one legacy authority marker last, and never touches Project quality ledger or real `data/**`
- rollback: revert this commit before any production authority transition; after a real rollback, retain the source SQLite database and rollback report, and use only the explicit fresh-database re-cutover path—never restore an old SQLite file or enable JSONL and SQLite writers together
- deletedEntries: none; legacy readers and files remain, SQLite source remains, no Task/event/Decision/queue/profile/quality-ledger/user/customer/public-repository data was deleted
- remainingRisks: real production data shape, process-kill/power-loss during rollback publication, same-process operational invocation, and real maximum Task size remain unverified; LA-024 is closed as an Epic after its Task-aggregate child set completed, while G4 still requires its stage report and tag before LA-025 execution; Project quality ledger remains JSONL until LA-098; `node:sqlite` remains experimental
- unverifiedRealMachineItems: no real `data/**`, installed runtime, customer content, signing credential, public mirror, process kill, power loss, disk-full or production rollback was used

## LA-092 — Establish the unconnected SHA-256 content-addressed blob/ref foundation

- status: completed
- dependencies: LA-024, LA-084
- baseCommit: `87c0b40e`
- resultCommit: `SELF`
- filesChanged: `packages/storage-sqlite/src/blob_store.ts`; `packages/storage-sqlite/src/index.ts`; `tests/sqlite_blob_store.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/MIGRATION_MATRIX.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/IMPLEMENTATION_QUEUE.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: SHA-256 digest validation; immutable read-only CAS publication; byte-identical deduplication; transactional reference manifest revision CAS; concurrent reference publish with one winner; staging/blob/ref orphan inspection and staging prune; missing-blob reference detection; authority loss after blob publication; backup/restore of a CAS-shaped blob manifest
- commandsExecuted: focused blob test first failed because the new exports were absent and then passed; `npm exec --no -- tsx tests/sqlite_blob_store.test.ts`; focused SQLite backup/restore, foundation and audit-export regressions passed; `npm test` passed all 209 automatically discovered root tests with only the declared missing Managed E5 qualification pack skipped; `npm run test:recovery` passed 18 tests; `npm --prefix apps/desktop test` passed 151 Node tests plus 3 Electron activity tests; `npm run mac:test`; `npm run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; `npm run release:check`; execution-ledger JSON parse; `git diff --check`
- migration: none; the store accepts only an explicitly named temporary root and caller-owned authority, has no domain caller, no production startup wiring, no schema or user-data migration, and leaves existing JSON/JSONL/blob authorities unchanged
- rollback: remove the unconnected blob store module/export and focused test; no production authority, existing file, database, domain schema or user data requires rollback
- deletedEntries: none; no existing blob, reference, Task, event, Decision, Project, customer content, user data or public repository object was deleted or rewritten
- remainingRisks: real blob sizes and streaming behavior, cross-process stale lock recovery, concurrent filesystem/process failures, disk full, power loss, production backup/restore, and domain-level reference lifecycle remain unverified; `node:sqlite` remains experimental; LA-092 must not be treated as LA-094/096/097 cutover evidence
- unverifiedRealMachineItems: no real `data/**`, existing production blob root, customer content, installed runtime, packaged app, signing credential, public mirror, process kill, power loss or disk-full scenario was used

## LA-093 — Cut LA-owned settings, grants, and trust to the SQLite authority

- status: completed
- dependencies: LA-024
- baseCommit: `287527cc`
- resultCommit: `SELF`
- filesChanged: `packages/storage-sqlite/src/settings_grants_trust_repository.ts`; `packages/storage-sqlite/src/index.ts`; `packages/cat-data/src/structured_domain_storage.ts`; `packages/cat-data/src/index.ts`; `packages/cat-data/src/standalone_file_grants.ts`; `packages/cat-data/src/team_workflow.ts`; `packages/cat-server/src/settings_grants_trust_sqlite_cutover.ts`; `packages/cat-server/src/notification_preferences.ts`; `packages/cat-server/src/pi_trust.ts`; `packages/cat-server/src/pi_extension_trust.ts`; `packages/cat-server/src/server.ts`; `tests/sqlite_settings_grants_trust.test.ts`; `tests/sqlite_storage.test.ts`; `tests/sqlite_task_workspace_repository.test.ts`; `docs/AGENT_CONTEXT.md`; `docs/HANDOFF.md`; roadmap/current-state/inventory/risk/migration/ledger docs
- testsAdded: strict structured envelope and identity/digest checks; revision/CAS conflict; invalid raw preservation and marker absence; secret-value refusal; synthetic startup cutover/reopen; active-Run refusal; source collector invalid-JSON blocking; settings/notification, standalone grant, team-role, Pi trust and Extension trust compatibility regressions; domain-specific SQLite cutover-owner architecture guards
- commandsExecuted: sandboxed `npm run roadmap:test`, `npm run roadmap:validate`, and focused `npm exec --no -- tsx` attempts were blocked by the environment's local tsx IPC pipe policy (not test failures); rerun with permitted local IPC passed `npm run roadmap:test`, `npm run roadmap:validate`, `npm exec --no -- tsx tests/sqlite_settings_grants_trust.test.ts`, `npm exec --no -- tsx tests/notification_preferences.test.ts`, `npm exec --no -- tsx tests/pi_trust.test.ts`, `npm exec --no -- tsx tests/pi_extension_trust.test.ts`, `npm exec --no -- tsx tests/team_workflow_contract.test.ts`, `npm exec --no -- tsx tests/team_workflow_foundation.test.ts`, `npm exec --no -- tsx tests/document_capability_routes.test.ts`, `npm exec --no -- tsx tests/sqlite_storage.test.ts`, `npm exec --no -- tsx tests/sqlite_task_workspace_repository.test.ts`, and `npm exec --no -- tsx tests/sqlite_storage_task_aggregate_backend.test.ts`; `npm run typecheck`; `git diff --check`; execution-ledger JSON parse; the first parallel full-root attempt was blocked by the real-data server fixtures and the safe 208-test subset had one transient worker-heartbeat failure, after which the five worker regressions passed in isolation (the two real-data server fixtures remain unverified)
- migration: startup inventories only LA-owned settings/grants/trust sources under the data-root lease, copies exact raw bytes to a marker-linked backup, validates domain payloads without unknown-field or secret normalization, imports source/payload digests into SQLite with revision-zero parity, publishes one authority marker, then installs the process backend. Provider secrets remain Keychain/reference-only and Pi native settings remain Pi-owned; the campaign used synthetic temporary roots and a synthetic Pi agent directory only.
- rollback: before marker publication delete only the candidate SQLite files and retain the raw backup for repair; after publication restore the complete settings/grants/trust domain from the marker-linked backup and activate one legacy authority marker or a fresh SQLite cutover—never re-enable an individual JSON writer and never restore secrets into SQLite.
- deletedEntries: none; legacy files/readers remain for backup/read-only rollback, Pi native settings and Provider secret references were not migrated or rewritten, and no user/customer/public-mirror data was read or deleted
- remainingRisks: real configuration distributions, unknown legacy fields, invalid grants, stale Extension staging, Keychain/reference availability, process-kill/power-loss, production startup duration, real rollback and cross-process behavior remain unverified; LA-094/095/096/097/098/099 still own their domains; G4 stage report/tag remains required before continuing the LA-025 sequence
- unverifiedRealMachineItems: no real `data/**`, real `~/.pi/agent/trust.json`, customer content, installed runtime, packaged app, signing credential, public mirror, process kill, power loss, disk-full or production rollback was used

## LA-106 — Isolate server integration fixtures from checkout data

- status: completed
- dependencies: LA-093
- baseCommit: `ebd308b9`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/server_root.ts`; `packages/cat-server/src/server.ts`; `tests/server_root_override.test.ts`; `tests/helpers/synthetic_server_root.ts`; `tests/import_upload.test.ts`; `tests/asset_api.test.ts`; current storage reality/inventory/migration/handoff docs
- testsAdded: explicit test-mode root and Pi-agent-dir resolver contract; synthetic server-root fixture; runtime handshake instance-id assertion in both server-starting integration fixtures
- commandsExecuted: initial characterization test failed because `server_root.ts` was absent; `npm exec --no -- tsx tests/server_root_override.test.ts`; `npm exec --no -- tsx tests/import_upload.test.ts`; `npm exec --no -- tsx tests/asset_api.test.ts`; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; `git diff --check`
- migration: no production or user-data migration; production defaults continue to resolve the source checkout root; only `LA_TEST_MODE=1` with temporary-directory-contained `LA_TEST_REPO_ROOT` and `LA_TEST_PI_AGENT_DIR` can redirect the server fixture root; the two fixtures now clean only their disposable roots
- rollback: revert this commit and the preceding roadmap ticket registration; the test suite becomes unsafe for post-LA-093 full-root execution again, so G4 must remain blocked; never remove the explicit test-mode guard while retaining the environment variables
- deletedEntries: none; no checkout `data/**`, home trust, customer file, public mirror or runtime artifact was read, migrated or deleted
- remainingRisks: the server override is a test harness boundary, not proof of real data-shape, scale, process-kill, power-loss, disk-full or production rollback; G4 still needs a full synthetic-root recheck before LA-025 storage children
- unverifiedRealMachineItems: real `data/**`, real `~/.pi/agent/trust.json`, installed runtime, customer content, signing/notarization, process kill, power loss, disk full, production rollback and public mirror remain unverified

## LA-094 — Cut `.lapkg` v2 Package registry/journal/recovery to SQLite with CAS content refs

- status: completed
- dependencies: LA-024, LA-082, LA-092
- baseCommit: `46eeed4c`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/lapkg_package_storage.ts`; `packages/cat-server/src/lapkg_sqlite_cutover.ts`; `packages/cat-server/src/lapkg_activation.ts`; `packages/cat-server/src/lapkg_activation_recovery.ts`; `packages/cat-server/src/routes/package_center_routes.ts`; `packages/cat-server/src/general_agent_runs.ts`; `packages/cat-server/src/server.ts`; `tests/sqlite_lapkg_package_registry.test.ts`; `tests/sqlite_storage.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/MIGRATION_MATRIX.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/DELETION_CANDIDATES.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: initial missing SQLite Package cutover module failure; signed synthetic `.lapkg` activation through SQLite registry/journal/recovery; registry record `contentBlobRefId` validation; archive/resource CAS publication and verification; legacy v2 registry/resource-byte import; authority marker/reopen; old file-writer denial after cutover; registry-commit crash recovery; architecture guard for the single Package SQLite cutover owner
- commandsExecuted: initial `npm exec --no -- tsx tests/sqlite_lapkg_package_registry.test.ts` failed because the new cutover module did not exist; focused SQLite Package, activation, recovery, format, preview, signature, Package route and storage-owner tests passed after implementation; `npm run typecheck`; automatic `npm test` discovered 212 root tests and passed all 212 with only the declared missing Managed E5 pack skip; `npm run test:security`; `npm run test:recovery`; `npm --prefix apps/desktop test`; `npm --prefix apps/desktop run typecheck`; `npm run mac:test`; `npm run roadmap:test`; `npm run roadmap:validate`; `npm run release:check`; execution-ledger JSON parse; `git diff --check`
- migration: under the existing runtime-root writer lease and before recovery/listen, read the legacy v2 registry and verify every materialized resource byte; publish verified resource bytes to the content-addressed blob store; initialize SQLite registry, activation-journal and recovery-block projections; write a marker-linked legacy registry backup and publish the SQLite Package authority marker. New activations publish archive/resource bytes into the same CAS reference before the SQLite registry CAS commit. Legacy registry/journal/recovery files and materialized content remain read-only backup or derived verification evidence; migration never reads real `data/**`, never deletes user/customer content, and never invents archive bytes absent from the legacy tree.
- rollback: before marker publication close the candidate store and remove only the candidate SQLite/blob root while retaining legacy files; after marker publication restore the complete Package registry/journal/recovery/content authority from its marker-linked backup or enter an explicit blocked/read-only recovery state. Never re-enable npm installation, the pre-cutover file registry writer, or a second Package writer. Synthetic crash-after-registry-commit recovery is covered; real production rollback is not proven.
- deletedEntries: none; old `package_center.ts` and legacy v2 files remain for read-only compatibility/rollback evidence; no Package, blob, Task, user, customer, public-mirror, signing, or credential data was deleted or rewritten.
- remainingRisks: real legacy Package count/shape/scale and startup duration; legacy archive-byte provenance when only materialized resources exist; CAS streaming/size and disk-full behavior; process-kill/power-loss durability; real signed publisher packages/trust roots; production rollback and installed-runtime behavior; `node:sqlite` experimental status; other structured domains remain on their existing writers until their own tickets.
- unverifiedRealMachineItems: no real `data/**`, customer Package, installed runtime, real signed archive, provider, Keychain, signing/notarization material, process kill, power loss, disk full, public mirror, or production rollback was used.

## LA-095 — Cut Confirmed Memory to SQLite without changing recall authority

- status: completed
- dependencies: LA-024
- baseCommit: `b8fea746`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/assistant_memory.ts`; `packages/storage-sqlite/src/assistant_memory_repository.ts`; `packages/storage-sqlite/src/index.ts`; `packages/cat-server/src/assistant_memory_sqlite_cutover.ts`; `packages/cat-server/src/server.ts`; `packages/cat-server/src/general_agent_runs.ts`; `packages/cat-server/src/general_worker_runtime.ts`; `packages/cat-server/src/general_worker_rpc.ts`; `packages/cat-runtime/src/agentRuntimePort.ts`; `packages/cat-runtime/src/createGeneralAgentSession.ts`; `packages/cat-runtime/src/generalSessionPlan.ts`; `packages/cat-runtime/src/createCatAgentSession.ts`; `packages/cat-runtime/src/catRuntimeExtension.ts`; `packages/cat-server/src/cat_worker_runtime.ts`; `packages/cat-server/src/cat_worker_rpc.ts`; `packages/cat-server/src/routes/assistant_library_routes.ts`; `packages/cat-tools/src/assistant-memory-tools.ts`; `tests/sqlite_assistant_memory.test.ts`; `tests/sqlite_storage.test.ts`; `tests/sqlite_task_workspace_repository.test.ts`; current-reality/inventory/migration/risk/deletion docs; ledgers
- testsAdded: initial missing SQLite cutover failure; synthetic personal/project import and round-trip parity; proposed/active/revoked/history/source/revision preservation; scope isolation; CAS/old-writer denial; reopen/idempotent authority marker; strict General worker memory bridge payload/scope validation; CAT/General worker and prompt/runtime regressions; domain-specific SQLite cutover-owner guards
- commandsExecuted: initial `npx --no-install tsx tests/sqlite_assistant_memory.test.ts` failed because the cutover module did not exist; `npx --no-install tsx tests/sqlite_assistant_memory.test.ts`; `npx --no-install tsx tests/assistant_memory.test.ts`; `npx --no-install tsx tests/general_worker_rpc.test.ts`; `npx --no-install tsx tests/cat_worker_runtime.test.ts`; `npx --no-install tsx tests/runtime_hooks.test.ts`; `npx --no-install tsx tests/cat_prompt_isolation.test.ts`; `npx --no-install tsx tests/sqlite_storage.test.ts`; `npx --no-install tsx tests/sqlite_task_workspace_repository.test.ts`; `npx --no-install tsc --noEmit --pretty false`; `npm test` passed all 213 automatically discovered root tests with only the declared missing Managed E5 qualification pack skipped; `npm run test:security`; `npm run test:recovery`; `npm --prefix apps/desktop test`; `npm --prefix apps/desktop run typecheck`; `npm run mac:test`; `npm run release:check`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check`
- migration: under the existing data-root writer lease and before server listen, scan only legacy personal/project `memories.json` under synthetic or explicitly supplied runtime roots; copy exact raw bytes to an attempt backup, strictly parse and import the full Confirmed Memory file into per-scope SQLite projection/event streams, verify round-trip parity, publish one authority marker, then inject the SQLite persistence into routes, memory tools, General workers and CAT host-authored recall. TDAI capture/store/config and semantic index are explicitly excluded; recall remains non-Evidence and cannot authorize CAT writes.
- rollback: before marker publication close and remove only the candidate SQLite database/WAL/SHM while retaining the raw attempt backup and legacy files; after marker publication use the marker-linked whole-memory backup/read-only rollback path or a fresh explicit re-cutover, never re-enable legacy JSON and SQLite writers together and never auto-activate a proposed memory.
- deletedEntries: none; legacy memory JSON files, TDAI assets/tools/scripts, semantic indexes, user/customer data and public mirror were not deleted or rewritten.
- remainingRisks: real memory distribution/scale, semantic recall quality/index rebuild, TDAI migration and client/franchise scope, SQLite WAL growth, process-kill/power-loss/disk-full, real startup duration, production rollback and installed-runtime behavior remain unverified; `node:sqlite` remains experimental; LA-029 still owns semantic recall enhancement.
- unverifiedRealMachineItems: no real `data/**`, customer memory, TDAI gateway/data, installed runtime, provider/Keychain, process kill, power loss, disk full, signing/notarization material, public mirror or production rollback was used.

## LA-096 — Cut Library metadata to SQLite with CAS document bytes

- status: completed
- dependencies: LA-024, LA-092
- baseCommit: `d57c157ad3bcddfa1d5a8b56fd5315ad7a4cabf8`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/assistant_library.ts`; `packages/storage-sqlite/src/assistant_library_repository.ts`; `packages/storage-sqlite/src/index.ts`; `packages/cat-server/src/assistant_library_sqlite_cutover.ts`; `packages/cat-server/src/server.ts`; `packages/cat-server/src/general_agent_runs.ts`; `packages/cat-server/src/general_worker_runtime.ts`; `packages/cat-server/src/general_worker_rpc.ts`; `packages/cat-server/src/cat_worker_runtime.ts`; `packages/cat-server/src/cat_worker_rpc.ts`; `packages/cat-server/src/routes/assistant_library_routes.ts`; `packages/cat-runtime/src/agentRuntimePort.ts`; `packages/cat-runtime/src/createCatAgentSession.ts`; `packages/cat-runtime/src/createGeneralAgentSession.ts`; `packages/cat-tools/src/assistant-library-tools.ts`; `packages/cat-tools/src/index.ts`; `tests/sqlite_assistant_library.test.ts`; `tests/assistant_library.test.ts`; `tests/sqlite_storage.test.ts`; `tests/sqlite_task_workspace_repository.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/MIGRATION_MATRIX.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/DELETION_CANDIDATES.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: synthetic personal/project catalog import and round-trip parity; document/source digest and size verification; locator/block/count/parser parity; same-bytes CAS deduplication; lexical search parity; reindex and rebuildable-vector exclusion; orphan blob inspection; old legacy-writer denial; reopen/idempotent marker; read-only CAT/General worker bridge; route/runtime/library regression coverage; domain-specific SQLite cutover-owner architecture guards
- commandsExecuted: focused `npm exec --no -- tsx tests/sqlite_assistant_library.test.ts` first encountered the environment's local tsx IPC `listen EPERM` and passed when rerun with permitted local IPC; `npm exec --no -- tsx tests/sqlite_assistant_library.test.ts`; `npm exec --no -- tsx tests/assistant_library.test.ts`; `npm exec --no -- tsx tests/general_worker_rpc.test.ts`; `npm exec --no -- tsx tests/cat_worker_runtime.test.ts`; `npm exec --no -- tsx tests/assistant_library_routes.test.ts`; `npm exec --no -- tsx tests/sqlite_storage.test.ts`; `npm exec --no -- tsx tests/sqlite_task_workspace_repository.test.ts`; `npm exec --no -- tsc --noEmit --pretty false`; `npm run roadmap:test`; `npm run roadmap:validate`; `npm test` passed all 214 automatically discovered root tests with only the declared missing Managed E5 qualification pack skipped; `npm run test:security` passed 29 tests; `npm run test:recovery` passed 18 tests; `npm --prefix apps/desktop test` passed 151 Node tests plus 3 Electron activity tests; `npm --prefix apps/desktop run typecheck`; `npm run mac:test`; `npm run release:check`; `node` execution-ledger JSON parse; `git diff --check`
- migration: synthetic temporary roots only; under the existing data-root writer lease and before server listen, discover personal/project legacy catalog/block/source files, back up exact raw bytes, strictly parse and verify source digest/size, publish managed bytes into the LA-092 content-addressed blob store, import full metadata into per-scope SQLite projection/event streams, verify round-trip and lexical parity, publish one Library authority marker, and inject `LibraryPersistence` into routes, CAT/General tools, and worker bridges. `vectors.jsonl` is excluded from authority and remains rebuildable; legacy metadata/source writers are fail-closed after the marker; no real `data/**` or customer content was read.
- rollback: before marker publication close/remove only candidate SQLite/WAL/SHM and blob roots while retaining the marker-linked raw backup; after marker publication restore the complete Library domain through the explicit whole-domain backup or fresh re-cutover path, never re-enable JSON and SQLite writers together. Managed source cache remains read-only provenance/derived cache; unreferenced CAS blobs remain for authority-gated GC; semantic vectors/index are rebuildable.
- deletedEntries: none; no legacy catalog, blocks, source cache, vector index, Task, Project, customer, user, public-mirror, signing or credential data was deleted or rewritten.
- remainingRisks: real Library distribution/scale and large-file streaming; blob GC and orphan retention; SQLite WAL growth; process-kill/power-loss/disk-full; cross-process stale lease; semantic E5/index quality and rebuild cost; installed runtime startup duration; production rollback and public mirror remain unverified; `node:sqlite` remains experimental; LA-029 still owns semantic recall quality and LA-056 owns later legacy-entry deletion.
- unverifiedRealMachineItems: no real `data/**`, customer Library, installed runtime, provider/Keychain, process kill, power loss, disk full, signing/notarization material, public mirror, or production rollback was used.

## LA-097 — Cut CAT core manifest, Batch, TM and termbase facts to SQLite with source CAS refs

- status: completed
- dependencies: LA-024, LA-092
- baseCommit: `48a21acc`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/cat_core_storage.ts`; `packages/storage-sqlite/src/cat_core_repository.ts`; `packages/storage-sqlite/src/index.ts`; `packages/cat-server/src/cat_core_sqlite_cutover.ts`; `packages/cat-server/src/server.ts`; `packages/cat-data/src/batch_workspace.ts`; `packages/cat-data/src/project_manifest.ts`; `packages/cat-data/src/tm.ts`; `packages/cat-data/src/termbase.ts`; `packages/cat-data/src/asset_typed_index.ts`; `packages/cat-data/src/workbook_asset_plan.ts`; `packages/cat-data/src/project_health.ts`; `packages/cat-data/src/index.ts`; `tests/sqlite_cat_core.test.ts`; `tests/sqlite_storage.test.ts`; `tests/sqlite_task_workspace_repository.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/MIGRATION_MATRIX.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/DELETION_CANDIDATES.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: synthetic Project manifest/Batch/TM/termbase/source import and round-trip parity; source/master SHA-256 CAS publication and ref verification; row/locked/tag/revision/TM/TB query/override parity; active-run block; marker/reopen; CAS conflict; old JSON-writer denial; derived cross-process read-cache; CAT-core startup-owner architecture allowlists
- commandsExecuted: focused `npm exec --no -- tsx tests/sqlite_cat_core.test.ts`; `npm exec --no -- tsx tests/project_health.test.ts`; `npm exec --no -- tsx tests/qa_terminology.test.ts`; `npm exec --no -- tsx tests/constraint_pack.test.ts`; `npm exec --no -- tsx tests/segment_evidence.test.ts`; `npm exec --no -- tsx tests/evidence_tools.test.ts`; `npm exec --no -- tsx tests/asset_api.test.ts`; `npm exec --no -- tsx tests/asset_routes.test.ts`; `npm exec --no -- tsx tests/tm_reviewed_writeback.test.ts`; `npm exec --no -- tsx tests/tm_fuzzy_retrieval.test.ts`; `npm exec --no -- tsx tests/import_upload.test.ts`; `npm exec --no -- tsc --noEmit --pretty false`; `npm test` passed 215 automatically discovered root tests with only the declared missing Managed E5 qualification pack skipped; `npm run test:security` passed 29 tests; `npm run test:recovery` passed 18 tests; `npm --prefix apps/desktop test` passed 151 Node tests plus 3 Electron activity tests; `npm --prefix apps/desktop run typecheck`; `npm run mac:test`; `npm run release:check`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check`
- migration: under the existing data-root writer lease and before server listen, discover only synthetic/explicitly supplied Project roots, strictly parse manifest/Batch/TM/termbase files, back up exact workspace and referenced source bytes, publish source/master bytes to the LA-092 content-addressed blob store, import SQLite projection/event streams, verify round-trip parity, publish one CAT-core authority marker, and install the host persistence bridge. After the marker, legacy JSON writers fail closed; the read-cache is a derived cross-process projection only and is never a writer. CAT proposals, QA, delivery and quality-ledger authority remain for later tickets.
- rollback: before marker publication close and remove only candidate CAT-core SQLite/WAL/SHM/blob/read-cache roots while retaining the attempt backup; after marker publication restore the complete CAT-core domain from its marker-linked Project backup or perform an explicit fresh re-cutover. Never rollback only segments, never re-enable JSON and SQLite writers together, and never delete source evidence or derived indexes as a side effect.
- deletedEntries: none; no real `data/**`, customer/project source, legacy CAT-core file, runtime artifact, public mirror, signing material or credential was deleted or rewritten.
- remainingRisks: real Project format/distribution/scale and source-file layout; large source streaming; process-kill/power-loss/disk-full; cross-process stale lease; production rollback; CAT proposal/QA/delivery/quality-ledger cutover; `node:sqlite` experimental status; E5 qualification pack remains unavailable for the declared unrelated RAG test.
- unverifiedRealMachineItems: no real `data/**`, customer Project, installed runtime, provider/Keychain, process kill, power loss, disk full, signing/notarization material, public mirror or production rollback was used.

## LA-098 — Cut CAT proposal, evidence-reference, QA, waiver, delivery and Project quality-ledger governance to SQLite

- status: completed
- dependencies: LA-097
- baseCommit: `134ca44c`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/cat_governance_storage.ts`; `packages/cat-data/src/index.ts`; `packages/cat-data/src/delivery.ts`; `packages/cat-data/src/proposals.ts`; `packages/cat-data/src/quality_checklist.ts`; `packages/cat-data/src/quality_decision_ledger.ts`; `packages/storage-sqlite/src/cat_governance_repository.ts`; `packages/storage-sqlite/src/index.ts`; `packages/cat-server/src/cat_governance_sqlite_cutover.ts`; `packages/cat-server/src/server.ts`; `tests/sqlite_cat_governance.test.ts`; `tests/sqlite_storage.test.ts`; `tests/sqlite_task_workspace_repository.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/MIGRATION_MATRIX.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/DELETION_CANDIDATES.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: initial missing cutover-module characterization failure; synthetic ledger sequence/hash/idempotency and waiver append; proposal-set/checklist exact import and revision-CAS; locked/tag/placeholder and proposal evidence-reference preservation; QA/waiver/delivery export-audit parity; cross-task/team ledger compatibility; empty-project zero-row read-cache recovery; marker/reopen; active-run/authority boundary; legacy writer denial; SQLite cutover-owner architecture allowlists
- commandsExecuted: `npm exec --no -- tsc --noEmit --pretty false`; `npm exec --no -- tsx tests/sqlite_cat_governance.test.ts`; focused `npm exec --no -- tsx tests/delivery_qa.test.ts`; `npm exec --no -- tsx tests/delivery_readiness.test.ts`; `npm exec --no -- tsx tests/delivery_export.test.ts`; `npm exec --no -- tsx tests/proposals.test.ts`; `npm exec --no -- tsx tests/quality_decision_ledger.test.ts`; `npm exec --no -- tsx tests/quality_waiver_tool.test.ts`; `npm exec --no -- tsx tests/team_quality_decision_ledger.test.ts`; `npm exec --no -- tsx tests/quality_audit.test.ts`; `npm exec --no -- tsx tests/sqlite_storage.test.ts`; `npm exec --no -- tsx tests/sqlite_task_workspace_repository.test.ts`; `npm test` discovered 216 root tests and passed all after the architecture-owner allowlists were updated, with only the declared missing Managed E5 qualification pack skipped
- migration: under the existing data-root writer lease and before server listen, discover only synthetic/explicitly supplied Project roots, parse and back up exact legacy quality ledger/checklist/proposal/export-audit files, import them into project-scoped SQLite streams/projections, verify ledger hash-chain and proposal/checklist/audit parity, seed explicit zero-row derived read caches, publish one CAT-governance authority marker, and install the host persistence seam. Proposal evidence references remain in the proposal projection; evidence bytes, vectors and semantic/read caches are excluded from this domain cutover. After the marker, legacy governance writers fail closed; cross-process reads use only marker-linked derived caches and missing cache fails closed. No real `data/**`, user/customer content or public mirror was read.
- rollback: before marker publication close and remove only candidate CAT-governance SQLite/WAL/SHM/read-cache roots while retaining the attempt backup; after marker publication restore the complete CAT-governance domain from its marker-linked backup or perform an explicit fresh re-cutover. Never roll back only the ledger/proposal/checklist subset, never re-enable JSON/JSONL and SQLite writers together, and never treat evidence references as evidence bytes.
- deletedEntries: none; legacy governance files/readers remain as read-only backup/rollback evidence, no CAT source/evidence bytes, Task, Project, customer, user or public-mirror data was deleted or rewritten.
- remainingRisks: real largest Project governance shape/scale, evidence-byte distribution, cross-process concurrency, process-kill/power-loss/disk-full, production rollback, WAL growth and `node:sqlite` experimental behavior remain unverified; LA-099 still owns Workflow/Team/Private Eval structured-state migration and LA-100/101 own cross-domain restore and legacy-writer deletion gates.
- unverifiedRealMachineItems: no real `data/**`, customer Project, installed runtime, provider/Keychain, process kill, power loss, disk full, signing/notarization material, public mirror or production rollback was used.

## LA-099 — Cut Workflow/Team and Private Eval structured metadata to SQLite

- status: completed
- dependencies: LA-024
- baseCommit: `28a88358`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/workflow_eval_storage.ts`; `workflow_plan.ts`; `workflow_artifacts.ts`; `private_eval.ts`; `packages/storage-sqlite/src/workflow_eval_repository.ts`; `packages/cat-server/src/workflow_eval_sqlite_cutover.ts`; `server.ts`; storage exports/architecture tests; roadmap control plane and ledger.
- testsAdded: synthetic workflow/Team artifact and Eval set/run/output/scorecard/blind-review import parity; active-run refusal; marker/reopen; public Workflow and Eval API writes after authority installation; legacy writer denial; cutover-owner architecture allowlists.
- commandsExecuted: `npm exec --no -- tsc --noEmit --pretty false`; focused SQLite Workflow/Eval, workflow-plan, workflow-artifacts, private-eval, eval-route and Team foundation tests; storage architecture tests; `npm test` discovered 217 root tests and passed; `npm run test:security`; `npm run test:recovery`; Desktop typecheck/tests; `npm run mac:test`; `npm run release:check`; roadmap validation and diff check.
- migration: before listen and under the existing data-root writer lease, back up and import Workflow run/artifact and Private Eval metadata into one SQLite projection store, verify exact projection parity, publish one marker and install the host persistence seam. Eval corpus/reference/rubric bytes and generated reports remain excluded files; Stable Private Eval mutations remain blocked.
- rollback: before marker remove only candidate SQLite/WAL/SHM while keeping the backup; after marker restore the complete Workflow/Eval structured domain from its backup or fresh re-cutover. Never restore one legacy writer alongside SQLite, never delete Eval corpus, and never re-enable Stable Eval execution.
- deletedEntries: none; legacy structured files remain marker-linked backup/read-only evidence; no real data, customer files, corpus, credentials, public mirror or release material was read or modified.
- remainingRisks: real Workflow/Team/Eval history and scale, cross-process concurrency, process-kill/power-loss/disk-full, production rollback, WAL growth, and the eventual developer/CI Eval-harness migration remain unverified; LA-100/101 own cross-domain recovery and deletion gates.
- unverifiedRealMachineItems: no real `data/**`, customer Project/Eval corpus, installed runtime, provider/Keychain, process kill, power loss, disk full, signing/notarization, public mirror or production rollback was used.

## LA-100 — Verify one aggregate backup and isolated restore for every LA-025 domain

- status: completed
- dependencies: LA-093, LA-094, LA-095, LA-096, LA-097, LA-098, LA-099
- baseCommit: `857c507a`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/cross_domain_sqlite_backup.ts`; `packages/storage-sqlite/src/index.ts`; `tests/sqlite_cross_domain_backup.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/MIGRATION_MATRIX.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/DELETION_CANDIDATES.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: initial missing-module characterization; seven-domain synthetic marker/database/blob fixture; one aggregate manifest and fresh-root restore; marker/schema/event-replay parity; no-overwrite restore; missing blob; orphan blob; broken foreign-key; future/old schema refusal.
- commandsExecuted: `npm exec --no -- tsx tests/sqlite_cross_domain_backup.test.ts` (RED then green cycles); `npm exec --no -- tsc --noEmit --pretty false`; `npm run typecheck`; `npm test` discovered 218 root tests and passed; `npm run test:recovery`; `npm run test:security`; `git diff --check`.
- migration: no production migration or writer cutover. Under a supplied authority lease, discover the seven fixed LA-025 authority markers; verify each v2 SQLite snapshot, foreign keys and blob/reference closure; create nested verified SQLite/blob backups plus marker digests under one aggregate manifest; restore only through a fresh staged synthetic root, then re-open/replay/verify every domain before atomic publication. No real `data/**`, customer data, runtime state, public mirror or server startup was read or changed.
- rollback: delete only an unpublished aggregate staging directory or isolated synthetic restore target. A published manifest is whole-domain recovery evidence: restore all seven domains together to a new root, never overwrite a canonical root or roll back one domain while keeping cross-domain references live. This Ticket neither changes nor re-enables any legacy writer.
- deletedEntries: none; no legacy reader, writer, backup, database, blob, customer file or public-mirror object was deleted.
- remainingRisks: aggregate manifests are only exercised on synthetic roots; real historical volume, concurrent external writers/snapshot timing, process-kill/power-loss/disk-full, WAL growth, filesystem semantics, production rollback duration and `node:sqlite` experimental behavior remain unverified. LA-101 must still prove legacy writers have no permanent dual-write path before LA-025 can close.
- unverifiedRealMachineItems: real `data/**`, customer Project/Memory/Library/Package/Eval content, installed runtime, provider/Keychain, concurrent real writers, process kill, power loss, disk full, signing/notarization, public mirror and production rollback were not used.

## LA-101 — Prove legacy structured writers have no permanent dual-write path

- status: completed
- dependencies: LA-092, LA-100
- baseCommit: `626532d1`
- resultCommit: `SELF`
- filesChanged: `tests/sqlite_legacy_writer_gate.test.ts`; `docs/roadmap/IMPLEMENTATION_QUEUE.md`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/MIGRATION_MATRIX.md`; `docs/roadmap/DELETION_CANDIDATES.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: TypeScript AST production startup/import graph proof for all seven LA-025 prepare calls before `createServer`; source-level legacy writer guard ordering for Memory, Library, CAT core/governance, Workflow/Eval and Package; synthetic authority-marker write sentinels; Settings/Grant/Trust startup-backend assertion.
- commandsExecuted: sandboxed focused `npm exec --no -- tsx tests/sqlite_legacy_writer_gate.test.ts` first encountered the known local IPC `EPERM`; permitted rerun passed; all seven per-domain SQLite cutover tests plus `tests/sqlite_cross_domain_backup.test.ts` and the new Gate test passed; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm test` discovered and passed 219 root tests; `npm --prefix apps/desktop test` passed 151 Node tests plus 3 Electron activity tests; `npm run mac:test`; `npm run test:recovery`; `npm run test:security`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check` all passed.
- migration: no data migration or new writer. The test proves that all seven startup cutovers complete before server transport construction, Package without injected storage refuses a SQLite marker, and preserved legacy structured write branches call their marker/authority guard before file mutation. Settings/Grant/Trust uses the startup-installed SQLite backend. No real `data/**`, customer content, public mirror, installed runtime, signing material or credentials was read or modified.
- rollback: revert only this evidence/ledger Ticket; it never changes a domain authority. Existing complete-domain marker-linked rollback paths remain the only rollback route; never re-enable JSON and SQLite writers together.
- deletedEntries: none; legacy readers, backups, JSON/JSONL paths, SQLite data, blobs and public-mirror objects remain untouched.
- remainingRisks: source/marker proof and synthetic restart/rollback do not prove real historical shape/scale, concurrent external writers, process-kill/power-loss/disk-full, filesystem semantics, production rollback duration or `node:sqlite` production behavior. LA-056 still owns every actual old-entry deletion.
- unverifiedRealMachineItems: real `data/**`, customer Project/Memory/Library/Package/Eval content, installed runtime, provider/Keychain, concurrent real writers, process kill, power loss, disk full, signing/notarization, public mirror and production rollback were not used.

## LA-025 — Close the remaining structured storage Epic

- status: completed
- dependencies: LA-024; accepted child Tickets LA-092 through LA-101
- baseCommit: `626532d1`
- resultCommit: `SELF`
- filesChanged: no additional production implementation; Epic closure recorded with LA-101 evidence in the roadmap control plane and execution ledgers.
- testsAdded: inherited blob/ref dedupe and orphan recovery; seven per-domain strict import/parity/cutover/restart/rollback tests; LA-100 aggregate isolated restore; LA-101 AST/import-graph and runtime marker write sentinels.
- commandsExecuted: accepted child Ticket evidence and LA-101's full F validation: root/Desktop typechecks; 219 root tests; 151+3 Desktop tests; `mac:test`; recovery/security; roadmap test/validation; ledger JSON parse and diff check passed.
- migration: no data was rewritten for Epic closure. Each domain retains its one startup SQLite/CAS authority and its marker-linked legacy backup/read-only compatibility window; no dual writer is reintroduced.
- rollback: governed by the affected complete domain's existing rollback contract; never enable an individual legacy writer beside SQLite.
- deletedEntries: none beyond completed child Ticket records; actual legacy-entry deletion remains reserved for LA-056 sub-Tickets.
- remainingRisks: all evidence remains synthetic; real historical data, concurrency, process kill, power loss, disk full, blob GC and production rollback remain unverified.
- unverifiedRealMachineItems: real `data/**`, customer content, installed runtime, provider/Keychain, process kill, power loss, disk full, signing/notarization, public mirror and production rollback were not used.

## LA-028 — Migrate legacy TDAI only as inert MemoryCandidate records

- status: completed
- dependencies: LA-025
- baseCommit: `78f51568`
- resultCommit: `SELF`
- filesChanged: `.pi/extensions/memory.ts`; `scripts/tdai-setup.sh`; `scripts/tdai-start.sh`; `packages/cat-data/src/{tdai_memory_migration,memory-config,memory-audit,tdai_embedding_bridge,index}.ts`; `packages/cat-tools/src/{memory-tools,index,asset_block_tools}.ts`; `packages/cat-runtime/src/createCatAgentSession.ts`; `packages/cat-server/src/{server,cat_worker_runtime,cat_worker_rpc}.ts`; `packages/cat-data/src/context_readiness.ts`; `apps/desktop/src/renderer/{data/workspace-client.ts,settings/SettingsWorkspace.tsx}`; `tests/{tdai_memory_migration,memory_status,memory_tools,context_readiness,cat_worker_rpc,cat_worker_runtime,web_tool_parity}.test.ts`; `README.md`; `docs/HANDOFF.md`; roadmap control plane and ledgers.
- testsAdded: initial missing-export characterization; synthetic explicit snapshot with source/count/secret-or-PII/low-value/duplicate/conflict assertions; no secret in candidate plan/report; exact-byte non-overwrite backup receipt; mismatched plan-hash refusal; no active recall before confirmation and one active memory only after runtime-checked user confirmation; no legacy TDAI Tool/Pi extension/script/config/worker-plan surface; independent TDAI embedding asset-vector regressions.
- commandsExecuted: sandboxed `npm exec --no -- tsx tests/tdai_memory_migration.test.ts` hit the known local IPC `EPERM` and was not counted; permitted focused migration/status/tools/context/asset-embedding/CAT-worker tests passed; 220 root tests; 151+3 Desktop tests; 29 security tests; root and Desktop typechecks; roadmap test/validation; execution-ledger JSON parse; `git diff --check`; all passed. Ticket-level B validation is recorded below; later phase and final-campaign validation remain pending successor work.
- migration: no automatic scan, gateway call, TDAI write, or Confirmed Memory write. A caller supplies one explicit read-only snapshot. The pure plan records source digest/count and safe pending candidates only; excluded secret text never enters plan/report. A caller-selected non-overwrite exact-byte backup produces the receipt required alongside the exact `planHash` and `confirmedBy: "user"` before a single candidate reaches the existing Confirmed Memory writer. Pending candidates never recall. No real `data/**`, external TDAI directory, customer record, or public mirror was read.
- rollback: retain the entry-point quarantine unless a separately approved safe successor exists; never restore capture/store/recall, gateway toggles, or a second memory writer. The source remains untouched, backups are immutable, and a user-confirmed entry follows the existing Confirmed Memory revoke/rollback contract.
- deletedEntries: none; obsolete source files remain quarantined for compatibility evidence. The separate `tdai_embedding_bridge.ts` remains an explicit asset-vector compatibility adapter and is not memory migration evidence.
- remainingRisks: no qualified real TDAI export adapter, inventory, ownership/retention proof, scale sample, batch-confirmation UI, persisted review store, or expanded original-source provenance exists; LA-029 owns scope/conflict/expiry/semantic recall and product UI; LA-056 owns actual deletion after its gates.
- unverifiedRealMachineItems: real `data/**`/TDAI data, customer memory, installed TDAI runtime, packaged-app migration UI, provider/Keychain, process kill, power loss, disk full, production rollback, signing/notarization and public mirror were not used.

## LA-029 — Govern scoped Confirmed Memory recall

- status: completed
- dependencies: LA-025, LA-028
- baseCommit: `02d9fcd3`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/assistant_memory.ts`; `packages/storage-sqlite/src/assistant_memory_repository.ts`; `packages/cat-server/src/{assistant_memory_sqlite_cutover,general_agent_runs,server}.ts`; `packages/cat-server/src/routes/assistant_library_routes.ts`; `packages/cat-runtime/src/{catRuntimeExtension,createGeneralAgentSession,generalSessionPlan}.ts`; `packages/cat-tools/src/assistant-memory-tools.ts`; `apps/desktop/src/renderer/{data/workspace-client.ts,library/LibraryWorkspace.tsx,library/library.css}`; `tests/{assistant_memory,assistant_memory_evolution,assistant_library_routes,general_agent_session,general_session_plan,runtime_hooks,sqlite_assistant_memory}.test.ts`; `apps/desktop/tests/library-memory.test.ts`; `README.md`; `PRODUCT.md`; `docs/{AGENT_CONTEXT,HANDOFF}.md`; roadmap/UI control documents and ledgers.
- testsAdded: initial missing-export characterization for scoped lexical/local-semantic recall and Prompt snapshot formatting; synthetic personal/client/franchise/project/locale authority ordering, expiry exclusion, injected local-embedder semantic retrieval, missing-pack lexical-only state, explicit-conflict withholding, user supersede and revocation; CAT Worker no-live-Memory fallback; General Worker no-live-Personal-Memory fallback; host snapshot included in General plan hash; SQLite client-scope reopen parity; route and Desktop Memory Center scope/conflict/expiry/lexical-only visibility.
- commandsExecuted: permitted focused `npm exec --no -- tsx` runs for `assistant_memory_evolution`, `assistant_memory`, `sqlite_assistant_memory`, `assistant_library_routes`, `general_agent_session`, `general_session_plan`, and `runtime_hooks`; `node --test apps/desktop/tests/library-memory.test.ts`; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm --prefix apps/desktop test` passed 152 Node tests plus 3 Electron activity tests; `git diff --check`. A full `npm test` attempt discovered 221 tests, but was not counted because existing `tests/sqlite_storage.test.ts` incorrectly rejects unchanged read-only `cross_domain_sqlite_backup.ts` for importing storage primitives; the file is not modified by this Ticket and the repair is isolated as LA-107 before any final Gate.
- migration: no legacy mass rewrite, no new database, no second writer and no TDAI source read. The existing SQLite Memory authority stores additive scope/status/validity/conflict/supersede fields; V1 entries without `validFrom` retain their exact stored shape and are interpreted as valid from `createdAt`. The Host alone queries active/in-validity/non-conflicted records with Project -> Client/Franchise -> Locale -> Personal precedence, uses the managed local E5 pack when available and otherwise explicitly reports lexical-only, then freezes selected provenance/reason into the General/CAT plan. Client/Franchise are never inferred from a Project. Workers receive only that snapshot; Memory remains non-Evidence.
- rollback: revert this Ticket while retaining the existing SQLite single writer and raw legacy backup/rollback contract. A missing or broken managed embedding pack remains explicit lexical-only; never restore all-active Memory injection, worker-side live enumeration, TDAI capture/store/recall, inferred Client/Franchise mapping or dual write.
- deletedEntries: none; no legacy Memory, TDAI, customer, `data/**`, credential, runtime or public-mirror object was deleted or rewritten.
- remainingRisks: managed E5 cross-lingual quality/performance and index/rebuild cost are synthetic/unqualified; Client/Franchise need explicitly entered IDs because no authoritative mapping exists; no real TDAI export adapter/inventory/batch confirmation or expanded original provenance store exists; Desktop contract test is not packaged-app accessibility/P3 evidence; LA-034 still owns the unified Memory/Library/Project Truth graph; LA-107 must repair the pre-existing SQLite architecture-test allowlist before the next full root-suite evidence.
- unverifiedRealMachineItems: real `data/**`, customer Memory/TDAI export, actual managed E5 pack behavior, installed runtime, packaged-app/VoiceOver behavior, provider/Keychain, process kill/power loss/disk full, production rollback, signing/notarization and public mirror were not used.

## LA-107 — Permit only the LA-100 non-authoritative aggregate backup helper

- status: completed
- dependencies: LA-100, LA-101
- baseCommit: `dbfa99d3`
- resultCommit: `SELF`
- filesChanged: `tests/sqlite_storage.test.ts`; `tests/sqlite_task_workspace_repository.test.ts`; `docs/roadmap/IMPLEMENTATION_QUEUE.md`; `docs/roadmap/RISK_REGISTER.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: initial root-suite characterization of both false-positive import-graph guards; two exact one-path allowlist assertions; continued negative proof that every other production non-owner importing SQLite storage primitives fails; focused aggregate backup/recovery and Task repository guards.
- commandsExecuted: initial `npm test` reproduced the unchanged `cross_domain_sqlite_backup.ts` false positive in `sqlite_storage.test.ts`; focused SQLite storage/cross-domain recovery passed; the next root run exposed the matching `sqlite_task_workspace_repository.test.ts` guard; permitted focused storage/Task repository/cross-domain recovery passed after both exact allowlists; a final `npm test` passed all 221 discovered root tests with the declared missing-managed-E5 skip. Two earlier full-suite attempts were not counted because unrelated `maintainer_routes.test.ts` timing and `tar` `write after end` failures occurred; both focused tests then passed. `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; and `git diff --check` passed.
- migration: none. No production writer, cutover owner, authority marker, canonical storage data, backup manifest, or runtime behavior changed. Both static guards name exactly `packages/cat-server/src/cross_domain_sqlite_backup.ts`, the LA-100 non-authoritative aggregate backup/recovery helper. It can write only to a supplied fresh isolated recovery root; all other production imports remain subject to the existing single-owner rule. No real `data/**`, customer data, public mirror, runtime state, credentials, or release material was read or modified.
- rollback: revert only the two static-guard allowlists and this control-plane record. Do not broaden the exception to a directory, glob, additional helper, or business writer; no data rollback is involved.
- deletedEntries: none; no data, legacy entry, writer, backup, public-mirror object, or production source was deleted.
- remainingRisks: the protection remains a static import-graph policy and does not independently prove production backup behavior; LA-100 synthetic aggregate recovery remains the behavioral proof. Full-suite timing instability was observed in unrelated Maintainer/tar tests, although the final complete root run passed; real historical storage shape/scale, concurrent writers, process kill, power loss, disk full, production rollback duration, and `node:sqlite` behavior remain unverified.
- unverifiedRealMachineItems: real `data/**`, customer content, installed runtime, provider/Keychain, concurrent real writers, process kill, power loss, disk full, production rollback, signing/notarization, and public mirror were not used.

## LA-108 — Define the strict normalized Document Backend contract

- status: completed
- dependencies: LA-017, LA-025
- baseCommit: `8b87220c`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/document_router_contract.ts`; `packages/cat-data/src/index.ts`; `tests/document_router_contract.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: initial missing-module characterization; existing local OCR evidence -> normalized block parity with no source path; strict unknown-field denial; invalid bbox, non-positive reading order, cross-source digest and duplicate block ID denial.
- commandsExecuted: `npm exec --no -- tsx tests/document_router_contract.test.ts` first failed because the contract module did not exist, then passed through the public `@linguist-agent/cat-data` seam; `npm exec --no -- tsx tests/document_capabilities.test.ts`; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. The new pure contract has no writer and no route chooser. It strictly validates a normalized result and adapts existing `DocumentEvidenceV1` in memory only, omitting `source.path` while retaining source digest/mime type, page/bbox or future cell/slide locator, backend/version, OCR flag, confidence, correction flag and reading order. Existing direct native/Paddle callers and their Artifact shapes remain unchanged until LA-109 through LA-111 prove parity and delete the old route chooser. No real `data/**`, customer document, managed capability directory, provider/Keychain, public mirror or release material was read or modified.
- rollback: revert the unconsumed contract and adapter together; no stored artifact, backend, Worker, capability lock, route, authority or data needs rollback. Do not compensate by accepting unknown fields or malformed provenance in existing callers.
- deletedEntries: none; no legacy route, Artifact, backend, worker, capability, data or public-mirror object was deleted.
- remainingRisks: no registered native/light adapter, page probe, per-page Router, optional-backend blocked/partial projection, benchmark policy profile, Artifact migration parity, packaged-app UI or real document/capability behavior is proven. MinerU and Unlimited-OCR remain unqualified/blocked; real OCR quality/resource/worker isolation remain LA-109 through LA-112, LA-031 and release-gate work.
- unverifiedRealMachineItems: real `data/**`, customer documents, installed managed OCR/MinerU capability, actual Worker resource limits, provider/Keychain, packaged-app/VoiceOver, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-113 — Require a host-staged Document parse request

- status: completed
- dependencies: LA-108
- baseCommit: `b1e309b9`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/document_router_contract.ts`; `tests/document_router_contract.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: initial missing-export characterization; mismatched staged-input/source digest refusal; arbitrary input path and repeated page-scope refusal.
- commandsExecuted: `npm exec --no -- tsx tests/document_router_contract.test.ts` first failed because `parseDocumentParseRequest` was absent, then passed; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. `DocumentBackend.parse` now requires a pure strict `DocumentParseRequest`: source digest/mime, opaque `host-staged-file` ID and optional unique page scope. The contract never accepts or returns a raw path; an eventual backend adapter must resolve the opaque ID through a host-owned scoped staging mechanism. No route, Worker, capability lock, Artifact writer, data authority or real `data/**` changed.
- rollback: revert this interface correction with its tests and stop successor native/light adapter work; do not reintroduce `parse(DocumentProbe)`, arbitrary paths or a Worker-visible Project path.
- deletedEntries: none; no backend, Worker, document, artifact, capability, data or public-mirror object was deleted.
- remainingRisks: the contract does not yet prove a host staging resolver, native/light backend, page probe, Router, optional blocked/partial behavior, benchmark policy, Artifact parity, real capability behavior or packaged UI. MinerU and Unlimited-OCR remain unqualified/blocked.
- unverifiedRealMachineItems: real `data/**`, customer documents, installed capability/worker resource limits, provider/Keychain, packaged app/VoiceOver, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-114 — Require a host-staged Document probe

- status: completed
- dependencies: LA-113
- baseCommit: `341a36de`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/document_router_contract.ts`; `tests/document_router_contract.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: initial missing-export characterization; probe staged-input/source-digest mismatch refusal.
- commandsExecuted: `npm exec --no -- tsx tests/document_router_contract.test.ts` first failed because `parseDocumentProbe` was absent, then passed; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. `DocumentBackend.probe` now uses the same strict source + opaque host-staged input + optional unique page scope as `parse`; no route, Worker, capability, Artifact, writer or data authority changed, and no raw path crosses the contract.
- rollback: revert this interface correction with its test and stop successor adapter work; never restore a bare-path or metadata-only probe that forces an adapter around the seam.
- deletedEntries: none.
- remainingRisks: host staging resolver, native/light adapters, real page coverage, Router, optional backend blocked/partial behavior, benchmark policy, Artifact parity, real capability behavior and packaged UI remain unproven; MinerU/Unlimited-OCR remain blocked.
- unverifiedRealMachineItems: real `data/**`, customer documents, installed capability/worker limits, provider/Keychain, packaged app/VoiceOver, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-115 — Require page-level Document probe estimates

- status: completed
- dependencies: LA-114
- baseCommit: `fd7b16f3`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/document_router_contract.ts`; `tests/document_router_contract.test.ts`; `docs/roadmap/CURRENT_REALITY_REPORT.md`; `docs/roadmap/MODULE_AND_DATA_INVENTORY.md`; `docs/roadmap/EXECUTION_LEDGER.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: initial missing-export characterization; backend estimate refuses a missing page list.
- commandsExecuted: `npm exec --no -- tsx tests/document_router_contract.test.ts` first failed because `parseDocumentBackendEstimate` was absent, then passed; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. The pure estimate validator accepts only a boolean support state, reason, and unique page rows with bounded native text coverage, non-negative character count, reading-order state, and layout complexity. It creates no backend, route, worker, artifact, writer, or data authority.
- rollback: revert this unconsumed validator with its check and stop successor backend work; do not let a Router infer a page route from missing or unbounded estimate fields.
- deletedEntries: none.
- remainingRisks: no native/light adapter, real text-coverage probe, Router, optional blocked/partial behavior, benchmark policy, Artifact parity, real capability behavior, or packaged UI is proven; MinerU/Unlimited-OCR remain blocked.
- unverifiedRealMachineItems: real `data/**`, customer documents, installed capability/worker limits, provider/Keychain, packaged app/VoiceOver, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-109 — Add the native PDF/PPTX Document backend

- status: completed
- dependencies: LA-115
- baseCommit: `60d073cc`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/{document_native_backend,index}.ts`; `tests/document_native_backend.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing-export characterization; synthetic host-staged PDF digest match/mismatch refusal, probe, full-and-page-scoped stable block identity/provenance with `ocr:false`; synthetic built-in PPTX extractor slide-provenance parity.
- commandsExecuted: `npm exec --no -- tsx tests/document_native_backend.test.ts` first failed because `NativeTextDocumentBackend` was absent, then passed; `npm exec --no -- tsx tests/document_router_contract.test.ts`; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. The exported native backend resolves only an opaque host-staged ID through an injected Host resolver, streams the resolved bytes to verify the requested SHA-256, and emits normalized PDF page/PPTX slide blocks with `ocr:false`. DOCX/XLSX are explicitly partial/refused because the current extractors have no verified page/cell locator. No Router, Worker, managed OCR/MinerU capability, Artifact writer, data authority or direct caller changed; no real `data/**`, customer document, credential, public mirror or release material was read.
- rollback: revert the adapter/export/test together; existing direct extractors remain the unchanged pre-LA-111 path. Do not replace an unavailable native locator with fake provenance, a system/cloud OCR fallback, or a second route chooser.
- deletedEntries: none.
- remainingRisks: no production host-staging resolver, qualified native text coverage/reading-order measurement, DOCX/XLSX locator mapping, light-OCR backend, per-page Router, benchmark policy, Artifact parity, packaged UI or real document/capability behavior is proven; MinerU and Unlimited-OCR remain blocked.
- unverifiedRealMachineItems: real `data/**` and customer documents; installed capability/worker limits, provider/Keychain, packaged app/VoiceOver; process kill, power loss, disk full, signing/notarization and public mirror were not used.

## LA-110 — Add the managed local PaddleOCR backend

- status: completed
- dependencies: LA-115
- baseCommit: `674e2ecb`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/{document_capabilities,document_light_ocr_backend,index}.ts`; `tests/{document_capabilities,document_light_ocr_backend}.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing-export characterization; synthetic opaque staged input with managed-Paddle runtime/version, geometry/confidence/provenance parity and no output path; worker timeout/output bound propagation; missing/corrupt/unqualified pack, oversized input, over-page output, output byte and runtime-drift refusal; managed JSONL worker denies inherited and caller-supplied secret environment values.
- commandsExecuted: `npm exec --no -- tsx tests/document_light_ocr_backend.test.ts` first failed because `LightOcrDocumentBackend` was absent, then passed; `npm exec --no -- tsx tests/document_capabilities.test.ts`; `npm exec --no -- tsx tests/document_router_contract.test.ts`; `npm run test:security`; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. The adapter resolves only a Host staged ID, streams its bytes to verify digest and input cap, verifies managed Python/OCR status and the pinned runtime string, then reuses the existing local Paddle JSONL/evidence path under Host-supplied limits. The runner allows only path/language/timezone and declared offline keys, so it receives no inherited or supplied arbitrary secret. Missing/corrupt/unqualified packs, source/runtime drift and every tested limit fail closed. Existing direct Paddle Artifact callers, routing, Worker ownership, capability installation, MinerU/Unlimited-OCR/remote behavior and all data authority remain unchanged; no real `data/**`, customer document, installed capability, credential, public mirror or release material was read.
- rollback: revert this adapter and its managed-worker environment narrowing as one security change; existing direct Paddle evidence callers remain the pre-LA-111 path. Do not restore arbitrary worker environment inheritance, a raw worker-visible client path, a system/cloud fallback, unbounded execution or a second route chooser.
- deletedEntries: none.
- remainingRisks: no production host-staging resolver, installed managed pack, real Worker resource/timeout/cancellation behavior, real OCR quality/coverage, actual file-grant process isolation, per-page Router, benchmark profile, Artifact parity or packaged UI is proven; DOCX/XLSX native locator and MinerU/Unlimited-OCR remain blocked/unqualified.
- unverifiedRealMachineItems: real `data/**` and customer documents; installed managed Python/Paddle pack, worker process isolation/limits, provider/Keychain, packaged app/VoiceOver; process kill, power loss, disk full, signing/notarization and public mirror were not used.

## LA-116 — Require frozen Host-staged PDF Router inputs

- status: completed
- dependencies: LA-109, LA-110
- baseCommit: `123321f0`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/{document_staging,index}.ts`; `tests/document_staging.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing-export characterization; synthetic source mutation after staging preserves copied bytes/digest and no serialized source path; opaque unknown/disposed handle refusal; oversize input and page-inventory failure clean partial copies.
- commandsExecuted: `npm exec --no -- tsx tests/document_staging.test.ts` first failed because `stagePdfDocument` was absent, then passed; `npm run typecheck`; `npm --prefix apps/desktop run typecheck`; `npm run roadmap:test`; `npm run roadmap:validate`; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. A Host caller supplies an already-authorized PDF path, private staging root and maximum input bytes. The service streams an immutable `0700/0600` temporary copy, derives SHA-256 and an opaque handle from those copied bytes, queries `pdfinfo` only against the copy, and exposes a resolver closure plus idempotent dispose. There is no raw path in the staged DTO, no Artifact/Project writer, no Router/Worker activation and no fallback to form-feed/cloud/page guessing. No real `data/**`, customer document, managed capability, credential, public mirror or release material was read.
- rollback: revert the isolated staging helper and retain direct callers until LA-111 migrates them. Do not resolve opaque handles to original grant paths, retain staged copies after dispose, accept missing pages or substitute a cloud/heuristic page guess.
- deletedEntries: none; temporary test copies were disposed.
- remainingRisks: production caller integration, actual `pdfinfo`, cleanup across process crash, staging root capacity/permissions, real file grants, Router, Artifact parity, installed OCR capability and packaged UI remain unproven.
- unverifiedRealMachineItems: real `data/**` and customer documents; actual `pdfinfo`, production staging root/filesystem behavior, installed managed Python/Paddle pack, worker process isolation/limits, provider/Keychain, packaged app/VoiceOver; process kill, power loss, disk full, signing/notarization and public mirror were not used.

## LA-111 — Per-page Document Router and direct-choice migration

- status: completed
- dependencies: LA-109, LA-110, LA-116
- baseCommit: `ebe03b77`
- resultCommit: `SELF`
- filesChanged: `packages/cat-runtime/src/{documentRouter,createGeneralAgentSession,index}.ts`; `packages/cat-data/src/{document_staging,document_light_ocr_backend,document_capabilities,rich_artifact}.ts`; `packages/cat-server/src/{server,application/document_evidence_application_port}.ts`; `packages/cat-tools/src/document-capability-tools.ts`; `tests/{document_router,document_staging,document_capabilities,document_capability_routes,document_capability_tools}.test.ts`; roadmap facts/inventory/ledgers
- testsAdded: RED missing Router export; mixed three-page native/no-OCR + light-OCR + complex-blocked frozen result; missing light backend yields blocked rather than fallback; policy/default and legacy direct-Paddle/route-chooser import guards; 500-page cap and immediate/24h crash-stage cleanup characterization; migrated route and General-tool artifact contracts
- commandsExecuted: focused Router/staging/native/light/capability/route/tool tests; root and Desktop typechecks; full root and Desktop suites; roadmap test/validation; diff check
- migration: no canonical data migration. The sole Router composition uses a user-authorized temporary server/worker policy: 64MiB input, 500 pages, 20,000 blocks, 32MiB output, 5min worker timeout, 0.75 native coverage and 24h stale-stage TTL. It stages PDF and PNG/JPEG/TIFF bytes privately, freezes a per-page native/light/blocked plan, emits backend/version/OCR provenance and always disposes staging. HTTP evidence and General tool both call it; direct API/Tool Paddle choice and the unused `routeDocumentExtraction` chooser are deleted. Light's internal managed-worker bridge remains one backend implementation, not a second route authority. Partial Artifacts retain blocked reasons; all-blocked calls fail closed.
- rollback: revert this Ticket as one unit to restore the prior direct adapters only as an explicit rollback state. Do not retain Router and direct chooser concurrently, expose the original grant path to a backend, add system/cloud fallback, or turn blocked pages into success.
- deletedEntries: direct HTTP/General-tool Paddle selection; unused `routeDocumentExtraction` policy/type exports; old overlay-shaped route/tool artifact payload
- remainingRisks: LA-112 benchmark profile and LA-031 optional-backend qualification remain. Synthetic coverage does not prove real PDF complexity/coverage, installed Paddle/pdfinfo, live startup cleanup, resource isolation/limits, OCR quality, correction lifecycle or packaged UI.
- unverifiedRealMachineItems: real `data/**`/customer documents, production staging root/permissions/cleanup, actual `pdfinfo`, installed Paddle pack/worker cancellation and limits, provider/Keychain, packaged app/VoiceOver, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-112 — Auditable Document Router benchmark policy

- status: completed
- dependencies: LA-111
- baseCommit: `d4ac203a`
- resultCommit: `SELF`
- filesChanged: `packages/cat-runtime/src/{documentRouter,documentRouterBenchmarkPolicy,index}.ts`; `tests/document_router_benchmark.test.ts`; `tests/fixtures/document-router-benchmark/{profile-v1,synthetic-report-v1}.json`; `docs/roadmap/DOCUMENT_ROUTER_BENCHMARK_POLICY_REPORT.md`; roadmap facts/inventory/ledgers.
- testsAdded: RED missing policy-loader export; exact v1 profile/report digest, profile digest/version/unknown-field refusal, missing/expired fallback, threshold-driven light route and trace, and no optional-backend marketing guard.
- commandsExecuted: `npx tsx tests/document_router_benchmark.test.ts` first failed because the loader export was absent, then focused benchmark/Router tests; root and Desktop typechecks; roadmap test/validation; full root and Desktop suites; diff check.
- migration: none. The Router retains one server-owned conservative native/light/blocked policy. An optional v1 profile can change only `nativeTextCoverage` after exact schema, canonical SHA-256 evidence reference and expiry validation; valid output preserves profile/report digests and threshold reason in the Router result. Missing/expired profiles retain the 0.75 baseline; malformed/version-invalid/unknown-field profiles refuse. The checked-in profile/report are synthetic-only test fixtures, not canonical project data or an optional-backend qualification.
- rollback: remove the profile loader, fixtures, report and trace projection together; Router falls back to the existing conservative 0.75 policy. Do not retain a partially parsed profile, accept unknown fields, infer an evidence report, or mark optional backends ready.
- deletedEntries: none.
- remainingRisks: the synthetic fixture does not prove real OCR quality, corpus fit, hardware/memory/latency, installed capability behavior or optional backend qualification. LA-031/release qualification remains required for MinerU/Unlimited-OCR/remote backends.
- unverifiedRealMachineItems: real `data/**`/customer documents, real benchmark corpus and hardware matrix, installed Paddle/pdfinfo/optional backend behavior, production staging and packaged UI/accessibility, provider/Keychain, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-030 — Document Router Epic closure

- status: completed; Epic was never directly implemented
- dependencies: LA-017, LA-025
- baseCommit: `77d3f43d`
- resultCommit: `SELF`
- evidence: LA-108 established the strict normalized block/result contract; LA-113/114/115 fixed host-staged parse/probe and complete page estimates; LA-109/110 supplied native/light adapters; LA-116 supplied private immutable staging; LA-111 made Router the only HTTP/General route chooser and deleted direct choices; LA-112 added the auditable policy-profile seam. All listed child Tickets are completed and their dependency chain was rechecked before this closure.
- childTickets: LA-108 contract; LA-113 parse request; LA-114 probe request; LA-115 estimate; LA-109 native adapter; LA-110 light adapter; LA-116 staging; LA-111 Router migration; LA-112 benchmark policy.
- commandsExecuted: accepted child RED/green and regressions; LA-112 final root suite (242 discovered tests), Desktop suite, root/Desktop typechecks, roadmap test/validation, ledger JSON parse and diff check.
- migration: no new Epic-level data migration. There is one Router selection authority, one canonical existing Task Artifact writer and no permanent direct chooser/dual writer. Native/light/blocked output remains bounded and provenance-preserving; unavailable optional backends remain explicitly blocked.
- rollback: use the relevant child Ticket rollback in dependency-safe reverse order. Do not restore a direct route chooser beside Router, reintroduce an original grant path to a backend, claim optional-backend readiness, or add a system/cloud fallback.
- deletedEntries: direct HTTP/General Paddle selection and `routeDocumentExtraction`, as recorded by LA-111; no new Epic-level deletion.
- remainingRisks: synthetic evidence does not qualify OCR quality, real PDF/document corpus, hardware/resource matrix, installed backends, worker isolation or packaged UI. LA-031 owns optional-backend qualification; DOCX/XLSX verified locators remain absent.
- unverifiedRealMachineItems: real `data/**`/customer documents, installed managed capability and hardware benchmark, real staging/pdfinfo/Paddle behavior, provider/Keychain, packaged app/accessibility, process kill/power loss/disk full, signing/notarization and public mirror remain unverified.

## LA-031 — Fail closed optional document backends

- status: completed
- dependencies: LA-030
- baseCommit: `ebadaba0`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/{asset_parsing,asset_ingestion_contract,document_capabilities}.ts`; `packages/cat-server/src/{routes/asset_routes,strict_api_contract}.ts`; `tests/{runtime_storage,document_capabilities}.test.ts`; optional-backend report and roadmap facts/risk/ledgers.
- testsAdded: RED synthetic `LA_MINERU_COMMAND` executable must remain unstarted and return `unavailable`; complete MinerU qualification record rejects unknown fields, package-digest drift and absent crash evidence.
- commandsExecuted: `npx tsx tests/runtime_storage.test.ts` first failed because legacy parse invoked the fake backend; then `document_capabilities`/`runtime_storage` regressions and root/Desktop typechecks; roadmap validation, full root/Desktop suites and diff check.
- migration: no data migration or backend enablement. Asset parse no longer accepts command/timeout override and returns explicit unavailable state without a cache/output. A managed MinerU lock is `ready` only with the exact qualification record; standalone process/cache/output implementation is deleted. Router continues to block optional pages.
- rollback: restore only the prior disabled surface if necessary; never restore PATH/environment command lookup, raw Project-path execution, cache-success fallback, or an incomplete qualification record as ready.
- deletedEntries: Asset parse `mineruCommand`/`mineruTimeoutMs` route and contract inputs; runnable PATH/environment activation; standalone process/cache/output/XLSX-preprocessing implementation.
- remainingRisks: no actual qualified MinerU pack, hardware matrix, corpus, license assessment, crash/quality measurement, managed Worker staging integration or Unlimited-OCR implementation exists. Optional backends remain blocked.
- unverifiedRealMachineItems: real `data/**`/customer documents, managed pack install, hardware/corpus/quality/crash/license evidence, packaged UI/accessibility, provider/Keychain, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-032 — Complete Prompt Compiler request budgeting

- status: completed
- dependencies: LA-003, LA-009, LA-013, LA-014
- baseCommit: `0e8b1e2ccd9dca5a21022af82941c42a5c166fb2`
- resultCommit: `SELF`
- filesChanged: `prompt_compiler.ts`; Team context/manifest and Workflow/Eval/Private-Eval/server model-budget callers; focused synthetic budget fixture and affected Team/Eval/prompt tests; roadmap fact/risk documents and both execution ledgers.
- testsAdded: initial missing-`ModelContextRegistry` characterization; known/unknown model and incomplete legacy-budget launch denial; tool/history/output reserve overflow and `needs_compaction`; SHA-bound untrusted envelope with closing-tag, bidi and zero-width neutralization; actual Team tool-schema projection injection; updated Team/Eval route regression fixtures use explicit synthetic model metadata.
- commandsExecuted: `npm exec --no -- tsx tests/prompt_compiler.test.ts` first failed because `ModelContextRegistry` was absent, then passed; focused Team context, Private Eval Single/Team, Eval route, workflow plan, subagent activity and Team workflow foundation tests; root and Desktop typecheck; roadmap test/validation; execution-ledger JSON parse; `git diff --check` passed.
- migration: no canonical data migration. New Team/Eval Run preparation requires a v2 `requestBudget`: immutable registry context/output values plus explicit tool/history/provider/safety/compaction components. Existing prompt-only manifests remain readable with their old hashes, but an old bare `tokenBudget` cannot authorize a new Run. Team calculates active ToolDefinition name/description/parameters before preparation; untrusted context is rendered only inside digest-bound envelopes. No real `data/**`, customer content, credential, public mirror or release material was read.
- rollback: revert this ticket as one change; existing persisted v1 manifests remain readable. A rollback or partially supplied budget must block/new-Run rather than restore `overBudget -> ready`, unknown-model launch, raw untrusted interpolation or a second model-context authority.
- deletedEntries: implicit bare-`tokenBudget` launch authorization; unwrapped task/evidence/style/findings/reference/transcript prompt interpolation; numeric-only synthetic route budgets.
- remainingRisks: provider framing is a deterministic neutral-shape estimate, not a measured provider tokenizer/billing result; General/CAT have no current `PromptCompiler` caller and are not represented as migrated; native Pi system/tool serialization can change with Pi upgrades and requires requalification.
- unverifiedRealMachineItems: real provider request tokens/billing and custom-model metadata; installed runtime/Keychain and packaged UI; accessibility/VoiceOver; process kill, power loss, disk full, signing/notarization and public mirror were not used.

## LA-033 — Freeze explicit ExecutionProfile routing

- status: completed
- dependencies: LA-009, LA-032
- baseCommit: `98b816ef`
- resultCommit: `SELF`
- filesChanged: `cat-data` ExecutionProfile contract/export; General coordinator, Host-to-Worker plan and standalone transport/client contract; server General model resolver; focused profile/General/route tests; roadmap fact/risk documents and both execution ledgers.
- testsAdded: initial missing-export characterization for Fast/Balanced/Best/custom profile planning; profile budget/route mismatch and unconfigured-quality refusal; explicit model switch requires a new runtime epoch; General Worker receives the immutable profile plan and persists `custom`/`balanced`; standalone profile input/model conflict refusal.
- commandsExecuted: `npm exec --no -- tsx tests/execution_profile.test.ts` first failed because `executionProfileSwitchCompatibility` was absent, then passed; `npm exec --no -- tsx tests/general_agent_runs.test.ts` initially proved the snapshot was still null, then passed; focused standalone route and General plan tests; root/Desktop typechecks; roadmap test/validation; execution-ledger JSON parse; `git diff --check` passed.
- migration: no canonical data rewrite. New standalone General Runs resolve a server-owned, hash-bound `ExecutionProfilePlan` using the existing LA-032 `PromptRequestBudget`/`ModelContextRegistry`, carry it through the serialized Host-to-Worker plan and write its id into the new execution snapshot. Existing direct provider/model/effort choices become `custom`; the existing default compatibility route becomes `balanced`. Compact/fork re-resolve the exact stored provider/model/profile and reject legacy/no-profile or changed-profile routes rather than drift to current settings. No real `data/**`, customer content, provider credentials, public mirror or release material was read.
- rollback: revert this ticket as one change. Legacy snapshots remain readable, but a rollback must keep unknown Fast/Best routes and models without verified LA-032 context/output metadata blocked; never infer quality/tool capability, silently choose a different model, mutate a live Pi session in place, or dual-write a profile authority.
- deletedEntries: ambient General `executionProfile: null` for new main/delegated Runs; standalone transport ambiguity that combined a quality profile with explicit model/effort input.
- remainingRisks: Fast/Best have no standalone production configuration/UI yet and therefore fail closed; CAT/Team/Eval quality-profile routing is not introduced here; profile budgets are planning metadata, not a claim that General/CAT invokes PromptCompiler or that provider framing/billing is measured; real Pi in-place model rebinding remains unproven and intentionally requires a new runtime epoch.
- unverifiedRealMachineItems: real provider/custom-model metadata and token/billing behavior; installed runtime/Keychain; packaged UI/accessibility/VoiceOver; process kill, power loss, disk full, signing/notarization and public mirror were not used.

## LA-034 — Derive only provenance-bound Segment ContextGraph context

- status: completed
- dependencies: LA-025, LA-029, LA-033
- baseCommit: `fb70b4ec`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/{segment_context_graph,index}.ts`; `tests/segment_context_graph.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing-export characterization; immutable advisory-only graph/profile construction; node source SHA-256/revision provenance; targeted label/alias relevance selection; missing/hash/revision stale invalidation; empty provenance, invalid digest and invalid retrieval-limit refusal; no input mutation.
- commandsExecuted: `npm exec --no -- tsx tests/segment_context_graph.test.ts` first failed because `assessSegmentContextGraphFreshness` was absent, then passed; `segment_evidence`, `project_context`, and `team_context_builder` regressions; root/Desktop typechecks; roadmap test/validation; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. `buildSegmentContextGraph()` is a pure caller-hydrated contract with no filesystem, SQLite, model, tool, route, worker, snapshot, proposal, decision or target write. A caller must provide each source's canonical ID, SHA-256 and positive revision; graph/profile observations remain `advisory_context` with `canCommit: false`. Retrieval first invalidates every node/signal whose any provenance is missing or has changed hash/revision, then ranks remaining graph nodes. Existing CAT Evidence, `SegmentEvidenceSnapshot`, Memory, Library and Project Truth owners/readers remain unchanged; no real `data/**`, customer material, credential, public mirror or release material was read.
- rollback: revert this pure export/test together and continue using current evidence retrieval. Do not retain stale graph nodes, infer missing provenance, elevate graph observations into Evidence/authority, add a parallel writer, or silently reuse a changed source revision.
- deletedEntries: none; no legacy graph, CAT evidence, source, data, runtime record or public-mirror object was deleted or rewritten.
- remainingRisks: there is no server-side canonical provenance hydrator, CAT Tool/Run/UI integration, persisted graph snapshot, automatic entity extraction or proof that caller-supplied observations are true; graph remains deliberately non-authoritative and does not unify Memory/Library/Project Truth ownership.
- unverifiedRealMachineItems: real `data/**`, customer evidence/asset revisions, server hydration, live Run/UI behavior, installed runtime/Keychain, provider behavior, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-035 — Route only safe TM reuse before expensive generation

- status: completed
- dependencies: LA-033, LA-034
- baseCommit: `735b5b2a`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/{tm_candidate_pipeline,index}.ts`; `tests/tm_candidate_pipeline.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing-export characterization; reviewed exact TM/repetition skip path; advisory/conflicting/unknown safety rejection; high-fuzzy diff-repair-only candidate; complete source/context/constraint/asset/model/profile/prompt cache-key invalidation; proposal-input conversion only for ready candidates; immutable/no-input-mutation and invalid-digest refusal.
- commandsExecuted: `npm exec --no -- tsx tests/tm_candidate_pipeline.test.ts` first failed because `CandidatePipelineCache` was absent, then passed; TM fuzzy retrieval, constraint-pack and proposal regressions; root/Desktop typechecks; roadmap test/validation; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. The pure planner hashes every source/context/constraint/asset/model/profile/prompt/TM/repetition component, selects only reviewed exact TM or confirmed same-revision repetition when caller-provided canonical constraint state is `verified`, and stores immutable plans only in an injected in-memory cache. A safe high-fuzzy reviewed row is only a `requires_diff_repair` seed; unknown/advisory/conflicting cases route to full generation. No model executes, no cache persists, and no proposal/target/Decision is written: `proposalInputFromCandidatePlan()` merely constructs the existing input that must still pass `createProposalSet` and later apply gates. No real `data/**`, customer content, credential, public mirror or release material was read.
- rollback: revert this pure planner/export/test together and return to the current single-model proposal path. Do not cache a partial key, self-certify constraint safety, turn fuzzy seed text into a final proposal, promote advisory TM to safe reuse, persist a second cache authority, or bypass proposal/write gates.
- deletedEntries: none; no TM row, proposal, target, cache file, writer, data or public-mirror object was deleted or rewritten.
- remainingRisks: no server provenance/constraint hydration, semantic-continuity batching, model repair/full-generation executor, persistent cache, Run/Tool/router/UI integration, actual revision/quality evidence or real cache cost/latency measurement; the caller must not assert `reuseSafety: verified` without canonical constraint proof.
- unverifiedRealMachineItems: real `data/**`, customer TM/asset/constraint revisions, server/Run/UI and provider execution, installed runtime/Keychain, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-036 — Emit only independent Critic findings

- status: completed
- dependencies: LA-035
- baseCommit: `1beabc16`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/{independent_critic,index}.ts`; `tests/independent_critic.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing-export characterization; strict versioned/hash-bound advisory artifact round-trip; unknown/tampered JSON refusal; high-risk-only planning; separate actor/execution enforcement; citable evidence requirement; no-commit identity and finding-scoped targeted-repair boundary.
- commandsExecuted: `npm exec --no -- tsx tests/independent_critic.test.ts` first failed because `createIndependentCriticArtifact` was absent, then passed; quality-audit, Team quality-ledger and Team workflow regressions; root/Desktop typechecks; roadmap test/validation; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. The pure contract accepts only high-risk candidate subjects, verifies critic actor and execution differ from the candidate producer, creates a strict immutable `advisory_finding` artifact with `canCommit:false`, and rejects audit-only/empty evidence. It neither starts a model nor writes a Quality/Team ledger, proposal, target or Decision. The only repair projection is the exact artifact finding IDs and its single segment ID. No real `data/**`, customer material, credential, public mirror or release material was read.
- rollback: revert this pure artifact/export/test together and return to deterministic QA plus human review. Do not allow a critic to reuse the producer execution/actor, self-authorize a repair, create a broad batch scope, accept trace-only evidence, or write a proposal/target/Decision directly.
- deletedEntries: none; no quality finding, proposal, target, ledger event, writer, data or public-mirror object was deleted or rewritten.
- remainingRisks: no live Critic launch, calibrated high-risk policy, finding merge/review-priority logic, actual repair executor, ledger/proposal/Run/Tool/UI integration, or real provider/identity isolation proof.
- unverifiedRealMachineItems: real `data/**`, customer evidence, actual high-risk work and provider execution, installed runtime/Keychain, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-037 — Restrict consistency repair to hit segments

- status: completed
- dependencies: LA-036
- baseCommit: `bb3f97e9`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/{batch_consistency_repair,index}.ts`; `tests/batch_consistency_repair.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing-export characterization; existing open QA terminology/repetition/voice finding projection; ignored-finding exclusion; exact finding/segment causation; evidence-preserving terminology input; unrelated and locked-row repair refusal; no-repair default.
- commandsExecuted: `npm exec --no -- tsx tests/batch_consistency_repair.test.ts` first failed because `buildBatchConsistencyPass` was absent, then passed; quality-audit/proposal/delivery-QA regressions; root/Desktop typechecks; roadmap test/validation; execution-ledger JSON parse; `git diff --check` passed.
- migration: none. The pure adapter consumes existing open `QualityAuditReport` findings instead of creating a second consistency engine. It projects only the named terminology/duplicate-target/voice/register codes, binds a repair to the exact finding and segment, carries original evidence into `SegmentProposalInput`, and refuses locked rows. It neither invokes QA/model work nor creates/applies a proposal or target; no real `data/**`, customer material, credential, public mirror or release material was read.
- rollback: revert this pure adapter/export/test together and retain current findings-only QA. Do not broaden repair to non-hit or locked rows, regenerate a Batch, drop finding evidence, or bypass existing proposal/write gates.
- deletedEntries: none; no QA finding, proposal, target, writer, data or public-mirror object was deleted or rewritten.
- remainingRisks: no automatic repair, proposal persistence, cross-batch consistency policy, actual audit/runtime/UI integration or real model/quality/cost measurements.
- unverifiedRealMachineItems: real `data/**`, customer QA findings, production proposal/review UI, provider execution, installed runtime/Keychain, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-038 — Validate all API external input through shared strict schemas

- status: completed
- dependencies: LA-008
- baseCommit: `d8e6f893`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/{strict_api_contract,server}.ts`; route adapters for agent permission, standalone/Project Task, Task queue, batch, asset, Library, upload and Voice inputs; focused route fixtures; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,RISK_REGISTER,MIGRATION_MATRIX,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing shared-contract export characterization; JSON content type, bounded body, object-only body, unknown/prototype field, strict boolean/string/array and no-filter refusal; declared-field vocabulary acceptance/rejection; source field-use scan proving every `body.<field>` used by server routes is declared; standalone and permission unknown-field regressions.
- commandsExecuted: `npm exec --no -- tsx tests/strict_api_contract.test.ts` first failed because `strict_api_contract` was absent, then passed; local transport, permission, standalone/Project Task, Task queue, batch/delivery QA, Voice/upload, asset/Library/workflow artifact/Team route regressions; root and Desktop typechecks; roadmap test/validation; `release:check`; execution-ledger JSON parse; `git diff --check` passed. `rc:status` was not run because it writes a timestamped report under forbidden `data/reports`; no workaround was used. One initial desktop command used a nonexistent relative test path and was rerun successfully with `node --test apps/desktop/tests/security.test.mjs`.
- migration: no data migration and no writer change. Every production server `readBody` now calls one strict JSON parser: supplied content type must be `application/json`, byte limits remain route-aware, root input must be a JSON object, and every top-level field must belong to the canonical vocabulary. The test scans server/route body-property consumers so a new undeclared field fails CI. Permission, standalone Task, Project Task and queue add exact schemas; shared helpers and CAT route callers reject malformed boolean/string/array input rather than coercing or filtering it. Legacy `segmentSource` remains accepted only for wire compatibility and is ignored before source authority is derived. No real `data/**`, customer material, credentials, public mirror or release material was read.
- rollback: revert the parser/vocabulary, route adapters and tests together. Do not restore `Boolean(value)`, silent array filtering, prototype-key acceptance, unknown-to-allow behavior, a separate route parser, or client-authored source authority.
- deletedEntries: direct `server.ts` use of loose `readLocalJsonBody`; string-to-boolean coercions in batch/upload/Voice request paths; silent filtering of malformed request arrays in migrated helpers.
- remainingRisks: the shared request vocabulary is not response DTO generation; many legacy route groups still rely on existing domain validators for endpoint-specific value constraints; `workspace-client.ts` still owns hand-written response types and generic Electron `api.request` remains until LA-039/LA-040.
- unverifiedRealMachineItems: real `data/**`, customer requests, installed runtime/Keychain, packaged Electron/XSS behavior, provider execution, process kill/power loss/disk full, signing/notarization and public mirror were not used.

## LA-039 — Compile Electron main/preload through one IPC contract

- status: completed
- dependencies: LA-038
- baseCommit: `d4e8c56f`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/{main.ts,preload.cts,ipc-contract.cts,desktop-security.mjs,renderer/desktop.d.ts}`; `apps/desktop/tsconfig.electron.json` and manifest/build/package staging allowlist; Electron security/command-palette/packaging/local-update tests plus new IPC contract test; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,RISK_REGISTER,MIGRATION_MATRIX,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing shared IPC contract characterization; shared source/import/channel/compiled-allowlist assertion. Existing security, command palette, packaging and updater tests now assert the TypeScript/contract entry rather than retired JS/CJS source paths.
- commandsExecuted: `node --test apps/desktop/tests/ipc-contract.test.mjs` first failed because `ipc-contract.cts` was absent, then passed; Electron TypeScript compile initially exposed widened legacy helper literals and implicit preload callback parameters, then passed after explicit boundary types; `npm --prefix apps/desktop run build`; IPC/security/packaging/local-update tests; complete `npm --prefix apps/desktop test` (153 tests plus 3 activity tests); desktop and root typechecks; the first `npm run roadmap:test` rejected a missing LA-039 -> R-020 risk mapping, then passed after the mapping was restored; roadmap validation, release check, execution-ledger JSON parse and `git diff --check` passed. `rc:status` was not run because it writes a timestamped report under forbidden `data/reports`; no workaround was used.
- migration: no data migration, server writer or API capability change. `main.mjs` moved to `main.ts`, `preload.cjs` to `preload.cts`, and both use the single CommonJS-emitted `ipc-contract.cts` for channels, stream update shape and fixed App commands. The renderer derives its App command type from that contract. The desktop build compiles the executable boundary to `dist/electron`; package metadata/staging points at the compiled `main.js` and includes every compiled sibling module its relative imports resolve. The generic `api.request` bridge remains unchanged for LA-040.
- rollback: revert the manifest, TypeScript entry sources, shared contract, build config, staging allowlist and tests together to the prior two source entries. Do not leave dual main/preload entrypoints, a mixed JS/TS authority boundary, a stale asar allowlist, or a compiled main whose sibling imports are absent.
- deletedEntries: `apps/desktop/src/main.mjs`; `apps/desktop/src/preload.cjs`; duplicate hard-coded IPC channel/App-command declarations in those entrypoints.
- remainingRisks: generic `api.request` still permits any existing local API path; response DTO/client generation and fixed capability IPC remain LA-040; `revealPath` still accepts renderer path text until LA-041; source build and packaging tests are not a signed/installed macOS package proof.
- unverifiedRealMachineItems: real `data/**`, customer material, installed runtime/Keychain, packaged Electron/XSS behavior, real macOS signing/notarization/VoiceOver, process kill/power loss/disk full, provider execution and public mirror were not used.

## LA-040 — Restrict renderer workspace transport to fixed capabilities

- status: completed
- dependencies: LA-039
- baseCommit: `c089213d`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/{ipc-contract.cts,workspace-capabilities.cjs,workspace-capabilities.d.cts,main.ts,preload.cts,renderer/data/workspace-client.ts,renderer/desktop.d.ts}`; `apps/desktop/scripts/packaging-config.mjs`; capability-aware desktop workspace-client/security/IPC/packaging tests; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,RISK_REGISTER,MIGRATION_MATRIX,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: capability lookup and resolution characterization; unknown method/path, capability/path mismatch and extra-field refusal; static bridge-removal assertions; package-allowlist coverage for the compiled capability authority. Existing route tests migrate their mocks to the fixed invocation and retain their canonical HTTP route assertions through the same resolver.
- commandsExecuted: `node --test apps/desktop/tests/workspace-capability-contract.test.mjs` first failed because `workspaceCapabilityFor` did not exist, then passed; source build/typecheck and a focused CAT workspace-client test initially failed because the renderer referenced only an emitted `.cjs` contract, then passed after the single source-loadable capability authority was introduced; migrated workspace-client regressions; final `npm --prefix apps/desktop run build && npm --prefix apps/desktop test` passed (156 desktop tests plus 3 activity tests); package allowlist test first failed because `workspace-capabilities.cjs` was absent, then passed after the allowlist update; focused IPC/security/packaging tests, root/Desktop typechecks, roadmap test first rejected an invalid R-014 -> LA-040 owner mapping and then passed after the mapping was restored, roadmap validation, release check, execution-ledger JSON parse and `git diff --check` passed. `rc:status` was not run because it writes a timestamped report under forbidden `data/reports`; no workaround was used.
- migration: no data migration and no server writer change. `workspace-capabilities.cjs` is the one normal workspace capability authority, mapping a fixed capability to one HTTP method and pathname template. `workspace-client.ts` first maps its local method/path intent to that capability; the renderer crosses the boundary only with `{ capability, path, body? }`. Preload validates the exact envelope and main repeats the validation, derives the method itself, and only then calls `requestRuntime`. The generic `api.request` preload surface, `api:request` channel and main handler are deleted; no temporary or permanent dual bridge remains. Stream APIs remain distinct fixed IPC operations. The compiled capability module is included in the ASAR source allowlist. No real `data/**`, customer material, credential, public mirror or release material was read.
- rollback: revert the capability authority, IPC channel/surfaces, renderer adapter, compiled allowlist and tests as one unit. Do not restore a permanent generic request bridge, renderer-chosen HTTP method, unregistered pathname, permissive unknown field, or a second capability registry.
- deletedEntries: `IPC_CHANNELS.apiRequest`; `api:request`; preload `api.request(input)`; main generic `requestRuntime(input)` handler.
- remainingRisks: endpoint-specific query/value schemas and response DTO/client generation remain incomplete; every new normal workspace endpoint must be registered and tested before renderer exposure; `revealPath` and native file handles still accept renderer path authority until LA-041; source/build evidence is not an installed signed macOS/XSS proof.
- unverifiedRealMachineItems: real `data/**`, customer material, installed runtime/Keychain, packaged Electron/XSS and same-user native-process behavior, real signing/notarization/VoiceOver, provider execution, process kill/power loss/disk full and public mirror were not used.

## LA-041 — Resolve renderer native operations through opaque handles only

- status: completed
- dependencies: LA-039, LA-040
- baseCommit: `4f2e610d`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/{main.ts,preload.cts,ipc-contract.cts,native-file-handles.mjs,renderer/desktop.d.ts,renderer/data/workspace-client.ts,renderer/{onboarding,assets,conversation,library,settings,workspace,inspector}/*}`; `apps/desktop/scripts/packaging-config.mjs`; native-handle, security, onboarding, asset and packaging tests; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,RISK_REGISTER,MIGRATION_MATRIX,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: missing native-handle registry characterization; forged extra field, unknown ID, type mismatch, selected-file replacement through symlink/inode change, canonical Project-root escape and picker cancellation tests; source guards that reject renderer raw native-path IPC and assert the compiled package allowlist.
- commandsExecuted: `node --test tests/native-file-handles.test.mjs` first failed because `native-file-handles.mjs` was absent, then passed; focused assets/onboarding/security/native-handle/Rich Artifact tests passed; desktop typecheck passed; Electron build initially exposed one implicit picker callback type and then passed; full `npm --prefix apps/desktop test` initially exposed outdated asset/onboarding/security/packaging contracts, then passed with 159 desktop tests plus 3 activity tests; root typecheck, roadmap test, roadmap validation, release check, execution-ledger JSON parse and `git diff --check` passed. `rc:status` was not run because it writes a timestamped report under forbidden `data/reports`; no workaround was used.
- migration: no data migration and no writer change. `native-file-handles.mjs` is the sole ephemeral main-process native-path authority: picker output is `{id,name}` only; main binds an ID to canonical realpath, inode/device, use kind and TTL, and rechecks it before use. Project creation, batch import, Library import, `.lapkg` preview/activation, Chat file grants and document evidence accept only handles at the renderer boundary and main maps them to the unchanged strict server wire. Project asset refresh uses a canonical server Project manifest plus in-root relative paths; Project reveal uses canonical Project ID; maintenance candidate and Rich Artifact export outputs are redacted to opaque handles. The old `revealPath(path)` channel and renderer API are deleted; there is no legacy raw-path fallback or dual write. No real `data/**`, customer material, credential, public mirror or release material was read.
- rollback: revert the native-handle registry, IPC/preload/main resolver, renderer adapters, compiled allowlist, tests and this migration documentation together. Do not restore `revealPath`, raw `rootPath`/`filePath`/`sourcePath`/`sourcePaths`/`archivePath` renderer fields, a cached path in renderer state, or a permanent legacy fallback.
- deletedEntries: `IPC_CHANNELS.revealPath`; preload `system.revealPath(path)`; main `system:reveal-path` handler; renderer raw picker/path payloads for Project, Batch/Asset/Library/Package, Chat grant, document evidence, maintenance activation and Rich Artifact export display.
- remainingRisks: endpoint-specific query/value schemas and response DTO/client generation remain incomplete; newly added native operations must be handle/ID-registered and covered before renderer exposure; source/build evidence does not prove a signed/installed Electron package, XSS/same-user native process or long-lived handle expiry behavior.
- unverifiedRealMachineItems: real `data/**`, customer material, installed runtime/Keychain, packaged Electron/XSS and same-user native-process behavior, real signing/notarization/VoiceOver, provider execution, process kill/power loss/disk full, long-lived handle expiry and public mirror were not used.

## LA-042 — Rebuild selected Task facts through snapshot plus ordered events

- status: completed
- dependencies: LA-008, LA-038
- baseCommit: `595253fe`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/data/{task-events,workspace-store}.ts`; `apps/desktop/tests/task-events.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,MIGRATION_MATRIX,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing `TaskProjectionStore` export characterization; one-projection snapshot replacement and ordered event application; duplicate cursor no-op; gap preserves last projection; late lower-cursor snapshot refusal and canonical reload replacement.
- commandsExecuted: `node --import tsx --test tests/task-events.test.ts` first failed because `TaskProjectionStore` was absent, then passed; the stale-snapshot assertion first failed because `replace` regressed cursor `task-one:3` to `task-one:2`, then passed after the cursor guard; focused Task projection/Decision/permission/standalone Chat regressions passed; desktop typecheck and production build passed; full desktop test passed with 160 tests plus 3 activity tests; root typecheck, roadmap test, roadmap validation, release check, execution-ledger JSON parse and `git diff --check` passed. `rc:status` remains skipped because it writes a timestamped report under forbidden `data/reports`; no workaround was used.
- migration: no data migration, server writer or schema change. `TaskProjectionStore` is the sole selected-Task renderer product-fact owner: it receives only a server-parsed snapshot or one ordered canonical event. `WorkspaceStore` subscribes and publishes that projection into its existing state facade, while local selection/request/UI state remains outside the projection. Selected Task open/create/rename/archive/restore/Decision responses use `replace`; SSE uses `apply`; duplicate events are ignored, gaps trigger canonical reload without mutation, and an older cursor snapshot cannot regress confirmed facts. No second Task/Run store, dual write or real `data/**` access was introduced.
- rollback: revert the projection class, WorkspaceStore adapter, tests and this documentation together. Do not restore direct selected-Task snapshot/event writes in action callbacks, a local Run/Decision/Artifact fact model, or a permanent second projection store.
- deletedEntries: direct selected-Task `WorkspaceState.task` mutation paths for action snapshots and SSE events; the old `applyTaskEvent`-to-facade event path.
- remainingRisks: `WorkspaceStore` still combines projection publication with non-Task UI/request concerns; background streams currently notify/reconcile rather than retaining complete background Task projections; bounded stream coalescing and app-level event-provider extraction remain LA-043; source tests do not prove real Electron reload/XSS/long-session behavior.
- unverifiedRealMachineItems: real `data/**`, customer material, installed runtime/Keychain, packaged Electron/XSS and same-user native-process behavior, provider execution, real macOS signing/notarization/VoiceOver, long-lived event streams, process kill/power loss/disk full and public mirror were not used.

## LA-043 — Bound live stream updates while preserving ordered terminal events

- status: completed
- dependencies: LA-012, LA-042
- baseCommit: `5df03d21`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/conversation/{TaskConversation,stream-event-coalescer}.ts`; `apps/desktop/src/renderer/conversation/stream-event-coalescer.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,MIGRATION_MATRIX,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`.
- testsAdded: initial missing coalescer-module characterization; 20fps 50ms delta bound with lossless text merge; flush-before-tool/Decision/final ordering; hidden-window explicit flush and Task-switch clear.
- commandsExecuted: `node --import tsx --test src/renderer/conversation/stream-event-coalescer.test.ts` first failed because the module was absent, then passed; focused coalescer/live-reply/TaskProjection regressions passed. The first desktop typecheck rejected Node-specific test imports in the renderer test tsconfig; the test was converted to the existing local harness and typecheck passed. Desktop production build, full desktop test (161 tests plus 3 activity tests), root typecheck, roadmap test, roadmap validation, release check, execution-ledger JSON parse and `git diff --check` passed. `rc:status` was not run because it writes a timestamped report under forbidden `data/reports`; no workaround was used.
- migration: no data migration, schema or writer change. `StreamEventCoalescer` is the sole ephemeral live-text batching authority for `TaskConversation`: it batches only non-empty `assistant_delta` payloads at a 50ms minimum interval and preserves the first payload identity while concatenating text. Any other stream payload flushes pending text then dispatches immediately, so final, permission/Decision, tool and queue events cannot be delayed or reordered behind a delta. Hidden-window transition flushes; Task switches and unmount clear obsolete ephemeral text. Canonical Task snapshot/event projection remains immediate and unchanged; no dual event model was added.
- rollback: revert the coalescer, TaskConversation adapter, tests and this documentation together. Immediate delta delivery is acceptable for diagnosis, but do not defer or drop canonical events, reintroduce animation-frame-only unbounded update behavior, or let terminal/Decision/tool/queue pass a pending delta.
- deletedEntries: direct `requestAnimationFrame`/`cancelAnimationFrame` delta path and its parallel pending text/frame refs in `TaskConversation`.
- remainingRisks: no separate Global Event Provider yet; background Task streams only notify/reconcile; real Electron visibility throttling, long conversations, CPU/memory and accessibility behavior remain unverified.
- unverifiedRealMachineItems: real `data/**`, customer material, installed runtime/Keychain, packaged Electron/XSS and same-user native-process behavior, provider execution, real macOS backgrounding/VoiceOver/signing/notarization, long-lived streams, process kill/power loss/disk full and public mirror were not used.

## LA-117 — Isolate every root test child from checkout data

- status: completed
- dependencies: LA-106, LA-043
- baseCommit: `f386bd61`
- resultCommit: SELF
- filesChanged: `scripts/test-discovery.ts`; `tests/test_discovery.test.ts`; `docs/roadmap/{G5_PRODUCT_REPORT,CURRENT_REALITY_REPORT,MODULE_AND_DATA_INVENTORY,MIGRATION_MATRIX,EXECUTION_LEDGER,IMPLEMENTATION_QUEUE}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: inherited synthetic-root override; per-child distinct synthetic repo/Pi-agent root and `finally` cleanup; direct literal `npm run server` launcher inheritance refusal
- commandsExecuted: focused `test_discovery` initially failed because the child-environment export was absent, then because the runner seam was absent, then because two children shared a root, and finally because the direct-launch guard export was absent; it passed after each required boundary was implemented. `tests/server_root_override.test.ts` and root typecheck passed. Roadmap test/validation, release check, execution-ledger JSON parse and `git diff --check` passed. `npm test` was deliberately not reissued: G5 requires a fresh safe-full-suite approval, and no wrapper/filter/environment-only substitute was used.
- migration: none. The test-only root runner now creates a distinct temporary synthetic repository and Pi-agent directory for each selected root-test child, overwrites inherited root variables, and removes that root in `finally`. It refuses a direct literal `spawn`/`spawnSync("npm", ["run", "server"])` test launcher unless its source inherits `process.env`. Production server-root resolution, data writers, schemas, package roots, and runtime behavior remain unchanged; no real `data/**`, home Pi trust, customer content, public mirror, credential, or signing material was read or changed.
- rollback: revert the runner/helper/test/documentation change together and retain the G5 block. Do not reintroduce a root suite that inherits checkout data, use a shell wrapper or filtered suite as Gate evidence, or silently fall back to production root resolution under test mode.
- deletedEntries: no persistent entry; every LA-117 synthetic root is cleaned after its child process returns.
- remainingRisks: the direct-launch check is source-level and covers literal `npm run server` launchers only; dynamically constructed or deliberately environment-stripping subprocesses are not OS-sandboxed. A fresh complete root/security/recovery/Desktop/macOS G5 execution remains required before Stage continuation.
- unverifiedRealMachineItems: full root-suite behavior under the fresh guard, real `data/**`, real home Pi trust, customer content, installed runtime, signing/notarization, process kill, power loss, disk full, production rollback, and public mirror were not used.

## LA-118 — Run root-test children from a no-data synthetic cwd

- status: completed
- dependencies: LA-117
- baseCommit: `17bb944e`
- resultCommit: `SELF`
- filesChanged: `scripts/test-discovery.ts`; `tests/test_discovery.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,EXECUTION_LEDGER,G5_PRODUCT_REPORT,IMPLEMENTATION_QUEUE,MIGRATION_MATRIX,MODULE_AND_DATA_INVENTORY,RISK_REGISTER}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: RED missing-allowlisted-source-view characterization; no-`data/**`/no-`.git` synthetic cwd assertion; allowlisted source-view links; absolute checkout test-module path and synthetic child cwd assertion
- commandsExecuted: `npm exec --no -- tsx tests/test_discovery.test.ts` first failed because the synthetic child cwd did not expose the required allowlisted `apps` source view, then passed after the view/runner seam was implemented. `npm run test:roadmap` passed through the actual root runner (231 discovered tests; 2 roadmap children). Root and Desktop typechecks passed; `git diff --check` passed. Full root/security/recovery/Desktop/macOS G5 commands remain pending and are not inferred from this focused evidence.
- migration: none. The test-only runner now creates every child cwd under a fresh temporary root, copies only root `package.json`, `package-lock.json` and `tsconfig.json`, links only `apps`/`contracts`/`docs`/`node_modules`/`packages`/`patches`/`scripts`/`tests`, creates an empty synthetic `.pi` configuration and a dedicated Pi-agent directory, and invokes the test module by absolute checkout path. `data/**`, `.git`, home paths and every unlisted checkout entry are absent from the child cwd. Production root resolution, data writers, test selection and server behavior remain unchanged; no real `data/**`, customer content, public mirror, credential or signing material was read or changed.
- rollback: revert the source-view helper, child-cwd/absolute-file runner seam, characterization and documentation together; retain the G5 block. Do not restore checkout cwd, link `data`/`.git`/home, replace the view with a shell wrapper or test filter, silently fall back to a production root, or claim source-level containment is an OS sandbox.
- deletedEntries: no persistent entry; each source-view root, `.pi` configuration and Pi-agent directory is removed in `finally` after its child exits.
- remainingRisks: linked source entries remain source-level exposure rather than an OS-enforced read-only snapshot; dynamically constructed or environment-stripping subprocesses are not comprehensively contained. A fresh direct full root/security/recovery/Desktop/macOS G5 execution remains mandatory before Phase 6.
- unverifiedRealMachineItems: full root-suite behavior under the no-data cwd guard, real `data/**`, real home Pi trust, customer content, installed runtime, signing/notarization, process kill, power loss, disk full, production rollback and public mirror were not used.

## LA-119 — Whitelist only tracked Pi materials required by root tests

- status: completed
- dependencies: LA-118
- baseCommit: `fc3b40ad`
- resultCommit: `SELF`
- filesChanged: `scripts/test-discovery.ts`; `tests/test_discovery.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,EXECUTION_LEDGER,G5_PRODUCT_REPORT,IMPLEMENTATION_QUEUE,MIGRATION_MATRIX,MODULE_AND_DATA_INVENTORY,RISK_REGISTER}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: RED missing synthetic constitution characterization; exact synthetic `.pi` entry allowlist; Team-agent-link presence; memory-extension byte parity; explicit absence of `.pi/npm` and unrelated `cat-tools.ts`
- commandsExecuted: the prior direct `npm test` passed two root children then failed at `cat_prompt_isolation` with `ENOENT .pi/APPEND_SYSTEM.md`; no data path was accessed. `npm exec --no -- tsx tests/test_discovery.test.ts` then reproduced that missing-file failure and passed after the precise allowlist was implemented. Focused `cat_prompt_isolation`, `team_role_agents` and `memory_tools` tests passed. The actual `npm run test:roadmap` runner subset, root/Desktop typechecks, roadmap validation, release check and `git diff --check` passed. A fresh direct full root/security/recovery/Desktop/macOS G5 execution remains pending and is not inferred from focused evidence.
- migration: none. The test-only synthetic `.pi` retains empty synthetic settings, skills and prompts plus the dedicated temporary Pi-agent directory. It copies exactly `.pi/APPEND_SYSTEM.md` and `.pi/extensions/memory.ts`, and links exactly the tracked `.pi/agents` directory. It does not link or load source `.pi/settings.json`, `.pi/npm`, project skills, other extensions, user Pi trust, `data/**`, `.git` or home content. Production Pi resource policy, runtime loading, server root resolution, data writers and test selection remain unchanged; no real `data/**`, customer content, credential, public mirror or signing material was read or changed.
- rollback: revert the three Pi-material source-view entries, characterization and documentation together; retain the G5 block. Do not substitute the entire `.pi`, project settings, `npm` package tree, other executable extensions, user trust, a shell wrapper, a test filter or a production-root fallback.
- deletedEntries: no persistent entry; every synthetic `.pi` and Pi-agent directory remains inside the per-child temporary root and is removed in `finally`.
- remainingRisks: the linked Team profile directory remains source-level exposure rather than an OS-enforced read-only snapshot; future cwd-sensitive tests may require separately reviewed static materials. Dynamically constructed or environment-stripping subprocesses are not comprehensively contained. A fresh direct full root/security/recovery/Desktop/macOS G5 execution remains mandatory before Phase 6.
- unverifiedRealMachineItems: full root-suite behavior under the no-data synthetic cwd/Pi-material guard, real `data/**`, real home Pi trust, customer content, installed runtime, signing/notarization, process kill, power loss, disk full, production rollback and public mirror were not used.

## LA-120 — Preserve only the tracked Dev project context in test cwd

- status: completed
- dependencies: LA-119
- baseCommit: `5bd60d4f`
- resultCommit: `SELF`
- filesChanged: `scripts/test-discovery.ts`; `tests/test_discovery.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,EXECUTION_LEDGER,G5_PRODUCT_REPORT,IMPLEMENTATION_QUEUE,MIGRATION_MATRIX,MODULE_AND_DATA_INVENTORY,RISK_REGISTER}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: RED missing synthetic `AGENTS.md` characterization; exact copied-byte check; synthetic root-entry allowlist includes the lone Dev context file
- commandsExecuted: the prior direct `npm test` passed two root children and the CAT preset checks, then failed at the Dev preset assertion because Pi could not discover root `AGENTS.md` from synthetic cwd; no data path was accessed. `npm exec --no -- tsx tests/test_discovery.test.ts` then reproduced that missing-file failure and passed after the single-file allowlist was implemented. Focused `cat_prompt_isolation` passed. The actual `npm run test:roadmap` runner subset, root/Desktop typechecks, roadmap validation, release check and `git diff --check` passed. A fresh direct full root/security/recovery/Desktop/macOS G5 execution remains pending and is not inferred from focused evidence.
- migration: none. The test-only child root now copies exactly one additional tracked root file, `AGENTS.md`, because Pi's Dev preset calls `loadProjectContextFiles` with the child cwd. No other root prose, docs, parent directory, `.git`, home path, `.pi` setting/package/trust, `data/**`, production root, runtime prompt policy, data writer or test selection changes. No real `data/**`, customer content, credential, public mirror or signing material was read or changed.
- rollback: revert the one copied `AGENTS.md` allowlist entry, characterization and documentation together; retain the G5 block. Do not disable Dev project context, copy README/all docs, link a checkout ancestor, or use a shell wrapper, test filter or production-root fallback.
- deletedEntries: no persistent entry; the copied Dev context remains in the per-child temporary root and is removed in `finally`.
- remainingRisks: the copied `AGENTS.md` is a source snapshot only at child creation and future cwd-sensitive tests may require separately reviewed static materials. Dynamically constructed or environment-stripping subprocesses are not comprehensively contained. A fresh direct full root/security/recovery/Desktop/macOS G5 execution remains mandatory before Phase 6.
- unverifiedRealMachineItems: full root-suite behavior under the no-data synthetic cwd/Pi-material/Dev-context guard, real `data/**`, real home Pi trust, customer content, installed runtime, signing/notarization, process kill, power loss, disk full, production rollback and public mirror were not used.

## LA-121 — Whitelist the Team child extension only for root tests

- status: completed
- dependencies: LA-120
- baseCommit: `56a7a8bd`
- resultCommit: `SELF`
- filesChanged: `scripts/test-discovery.ts`; `tests/test_discovery.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,EXECUTION_LEDGER,G5_PRODUCT_REPORT,IMPLEMENTATION_QUEUE,MIGRATION_MATRIX,MODULE_AND_DATA_INVENTORY,RISK_REGISTER}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: RED missing synthetic Team-child-extension characterization; exact copied-byte check for `team-evidence-child.ts` while retaining unrelated-extension absence
- commandsExecuted: the prior direct `npm test` passed six root children and failed at `team_evidence_child_runtime` because the production Pi loader could not find `.pi/extensions/team-evidence-child.ts` in synthetic cwd; no data path was accessed. `npm exec --no -- tsx tests/test_discovery.test.ts` then reproduced that missing-file failure and passed after the single-file allowlist was implemented. Focused `team_evidence_child_runtime` passed. The actual `npm run test:roadmap` runner subset, root/Desktop typechecks, roadmap validation, release check and `git diff --check` passed. A fresh direct full root/security/recovery/Desktop/macOS G5 execution remains pending and is not inferred from focused evidence.
- migration: none. The test-only synthetic `.pi/extensions` now copies exactly `.pi/extensions/team-evidence-child.ts` in addition to earlier explicitly required static files. Empty synthetic settings still do not automatically load project extensions; `.pi/npm`, all other extensions, project settings, skills, home trust, `data/**`, `.git`, production root, Team runtime and Pi resource policy remain unchanged. No real `data/**`, customer content, credential, public mirror or signing material was read or changed.
- rollback: revert the one copied Team extension, characterization and documentation together; retain the G5 block. Do not replace the allowlist with all `.pi/extensions`, the package tree, a user trust directory, shell wrapper, test filter or production-root fallback.
- deletedEntries: no persistent entry; the copied Team extension remains inside each per-child temporary root and is removed in `finally`.
- remainingRisks: this explicit extension copy is source-level exposure rather than an OS-enforced immutable snapshot; future cwd-sensitive tests may require separately reviewed static materials. Dynamically constructed or environment-stripping subprocesses are not comprehensively contained. A fresh direct full root/security/recovery/Desktop/macOS G5 execution remains mandatory before Phase 6.
- unverifiedRealMachineItems: full root-suite behavior under the no-data synthetic cwd/Pi-material/Dev-context/Team-extension guard, real `data/**`, real home Pi trust, customer content, installed runtime, signing/notarization, process kill, power loss, disk full, production rollback and public mirror were not used.

## LA-122 — Point the writer-lease guard at canonical Electron source

- status: completed
- dependencies: LA-121
- baseCommit: `e8144775`
- resultCommit: `SELF`
- filesChanged: `tests/data_root_writer_lease.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,EXECUTION_LEDGER,G5_PRODUCT_REPORT,IMPLEMENTATION_QUEUE,MIGRATION_MATRIX,RISK_REGISTER}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: the existing full-root failure characterizes the obsolete deleted `main.mjs` source path; the guard now reads canonical `main.ts` and retains the exact `requestSingleInstanceLock` assertion
- commandsExecuted: direct full `npm test` ran more than 200 root tests (with only the declared missing Managed E5 pack skip) then failed because `data_root_writer_lease` tried to read deleted `apps/desktop/src/main.mjs`. Focused `npm exec --no -- tsx tests/data_root_writer_lease.test.ts` passed after the one-path test update. Root roadmap subset, root/Desktop typechecks, roadmap validation, release check and `git diff --check` passed. A fresh direct full root/security/recovery/Desktop/macOS G5 execution remains pending and is not inferred from focused evidence.
- migration: none. This is a test-contract migration only: LA-039 previously removed `main.mjs` and established `main.ts` as the single Electron entry; the writer-lease source guard now observes that canonical entry. Data-root lease acquisition, server startup ordering, Electron runtime, source entry ownership, data writers, schemas and `data/**` remain unchanged; no real data, customer content, credential, public mirror or signing material was read or changed.
- rollback: revert the test guard and documentation together; retain the G5 block. Do not restore a `main.mjs` compatibility entry, create a dual entrypoint, weaken the single-instance assertion or bypass the full root recheck.
- deletedEntries: none; no source, data, lease or public object was deleted or changed by this test-only repair.
- remainingRisks: the fourth G5 root execution failed after broad progress and all full root/security/recovery/Desktop/macOS evidence must be freshly rerun. Installed Electron, process kill/power loss/disk full, real data and public mirror remain unverified.
- unverifiedRealMachineItems: full root-suite behavior after the canonical-entry guard, real `data/**`, customer content, installed runtime, signing/notarization, process kill, power loss, disk full, production rollback and public mirror were not used.

## LA-044 — Composer actions follow only the canonical active Run

- status: completed
- dependencies: LA-042, LA-043
- baseCommit: `8376687f`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/{composer/composer-model.ts,composer/index.ts,composer/composer-model.test.ts,conversation/TaskConversation.tsx}`; `apps/desktop/tests/codex-ui-contract.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: RED characterization for an absent or dangling `activeRunId` with historical stoppable Runs; Desktop UI contract that forbids the historical `findLast(stopAvailable)` and last-Run fallbacks
- commandsExecuted: focused `composer-model` test first failed because `selectCanonicalActiveRun` did not exist, then passed after implementation. The first complete Desktop suite passed (161 Node plus 3 Electron activity tests), while Desktop typecheck correctly failed because the new selector was not exported through the Composer barrel; adding that sole export fixed the integration. Focused UI-contract test passed; complete Desktop suite then passed again (161+3). Root and Desktop typecheck passed; `git diff --check` passed.
- migration: none. Composer action state now resolves only `snapshot.activeRunId` against the server-projected Run list. A missing or dangling pointer yields no active Run, so the Renderer cannot locally resurrect historical `stopAvailable` metadata or the most recent Run as stop/steer/follow-up authority. Queue mutations and Decision state remain server-owned; local request in-flight indicators are not Run, queue, or Decision facts. No schema, storage, runtime writer, data root, or public mirror changed.
- rollback: revert the selector, consumer, tests, and documentation together. Do not restore `findLast(stopAvailable)`, latest-Run fallback, local queue snapshot, hidden Run, or any other Renderer lifecycle authority.
- deletedEntries: the local historical active-Run fallback only; no persistent data or public object was deleted.
- remainingRisks: this proves source/contract behavior, not a live reconnect race or installed-app accessibility path. The UI Gate still requires real keyboard, 200% zoom, VoiceOver, long-thread, and screenshot evidence.
- unverifiedRealMachineItems: live server reload while an active Run transitions, real keyboard and assistive-technology operation, installed Electron, provider execution, customer data, signing/notarization, and public mirror were not used.

## LA-045 — Model resumable Team work as a canonical recovery timeline item

- status: completed
- dependencies: LA-011, LA-042
- baseCommit: `db8d2416`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/conversation/{conversation-model.ts,conversation-model.test.ts,ConversationItems.tsx}`; `docs/roadmap/{CURRENT_REALITY_REPORT,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: RED canonical snapshot with a stopped, `resumeAvailable` Team Run requires exactly one `recovery` item and no duplicate terminal `run` status item
- commandsExecuted: focused conversation-model test first failed with missing recovery item, then passed. Complete Desktop test passed (162 Node plus 3 Electron activity tests); Desktop typecheck, root typecheck, ledger JSON parse, roadmap test/validation and `git diff --check` passed.
- migration: none. Only a server-projected Team Run with `resumeAvailable` is emitted as `ConversationItem.kind = recovery`; it keeps the existing canonical timestamp/order and renders through the existing server-owned resume action. Other terminal Runs retain their existing status item. No Task, Run, Activity, Artifact, Decision, queue, persistence, or runtime writer changed.
- rollback: revert the recovery variant, renderer adapter, test and docs together; retain the existing generic Run status row. Do not synthesize recovery from local errors or restore a second recovery state machine.
- deletedEntries: the generic terminal-Run representation for a resumable Team Run only; no persistent entry deleted.
- remainingRisks: source/contract coverage does not prove real long-thread virtualization, installed-app keyboard discovery, or VoiceOver.
- unverifiedRealMachineItems: real Team recovery after restart, long-thread/10k-item behavior, installed Electron, accessibility, provider execution, customer data, signing/notarization and public mirror.

## LA-046 — Bind pending Decisions to the server contract

- status: completed
- dependencies: LA-014, LA-038, LA-042
- baseCommit: `0838dae7`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/task_workspace_contract.ts`; `packages/cat-server/src/{task_decision_binding,task_decision_executor,task_decision_interactions,task_extension_interactions,task_pipeline_projection}.ts`; `packages/cat-server/src/routes/workflow_routes.ts`; `apps/desktop/src/renderer/conversation/{DecisionInteraction.tsx,conversation-items.css}`; `apps/desktop/src/renderer/inspector/ContextInspector.tsx`; `tests/{task_decision_binding,task_workspace_routes}.test.ts`; `apps/desktop/tests/codex-ui-contract.test.ts`; roadmap facts and ledgers
- testsAdded: RED server binding contract for missing/schema/content/plan/expiry mismatches; existing Task decision route fixtures now carry server bindings; Desktop contract proves cards show only server-issued facts without `Date`-based inference
- commandsExecuted: focused binding, Task-route and extension-interaction tests; Desktop UI contract; full root and Desktop suites; root/Desktop typecheck; roadmap test/validation; diff check
- migration: no persistent data migration. `TaskDecision.decisionBinding` is an optional DTO field solely for snapshot readability, but missing legacy binding is non-executable. The sole creator/validator is `cat-server/task_decision_binding.ts`; schema v1 binds canonical Decision content, effective Run plan hash and an expiry. Temporary server policy is a 30-day lifetime from `createdAt`; any future tuning requires a versioned server contract, never Renderer derivation. Every current producer writes once, and execution/group interaction routes reject mismatch or expiry with 409; cancellation can clear stale requests.
- rollback: revert the binding creation, validation, read-only UI, contracts and docs together. Do not restore execution of unbound legacy decisions, derive facts in the Renderer, or introduce a second client writer.
- deletedEntries: obsolete assumption that an unbound pending Decision can execute; no persistent record deleted
- remainingRisks: synthetic tests do not prove installed Electron, real clock skew/timezone behavior, long-lived production snapshots or customer workflows. Unknown Decision kinds remain non-executable unless an existing server contract authorizes them.
- unverifiedRealMachineItems: installed Electron decision flow, real server clock/expiry behavior and real customer workflow evidence; `data/**` was not read

## LA-047 — Keep 10k-row CAT editing independent from whole-batch status aggregation

- status: completed
- dependencies: LA-025, LA-034, LA-042
- baseCommit: `270f50c6`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/cat/CatWorkspace.tsx`; `apps/desktop/tests/{cat-editor,codex-ui-contract}.test.ts`; `docs/roadmap/{CURRENT_REALITY_REPORT,EXECUTION_LEDGER}.md`; `docs/roadmap/execution-ledger.json`
- testsAdded: RED CAT-status aggregation contract proving a selected unsaved draft buffer cannot re-trigger whole-batch aggregation; 10k filter/navigation nearest-rank p95 under 50ms; CAT keyboard, VoiceOver grid, 200%-zoom reflow, and QA/Delivery discoverability contracts
- commandsExecuted: focused `node --test tests/cat-editor.test.ts` first failed because `batchStats` depended on `draft.buffer`, then passed after the canonical-only dependency change; focused `node --test tests/codex-ui-contract.test.ts` passed; complete `npm test` in `apps/desktop` passed (164 Node tests plus 3 Electron activity tests); Desktop and root `npm run typecheck` passed.
- migration: none. The full-batch status aggregate now depends only on the selected segment's canonical target/status, so keystrokes retain the selected-row counter/editor path without rescanning 10k batch rows. Existing server CAS (`expectedSegmentUpdatedAt`), 409 conflict UX, locked-row refusal, server-owned tag contracts, virtualizer, QA and Delivery server routes remain unchanged. No data format, writer, Task projection, storage authority, `data/**`, customer content, public mirror, credential, or signing material was read or changed.
- rollback: revert the CAT dependency change, its characterization/performance/a11y contracts, and documentation together. Do not replace canonical CAS/conflict/lock/tag/QA/Delivery behavior with local caches, last-write-wins, inferred tags, or a dual writer.
- deletedEntries: the unnecessary unsaved-draft dependency of the whole-batch status aggregate only; no persistent entry was deleted.
- remainingRisks: the p95 evidence is a synthetic Node model benchmark, while keyboard/VoiceOver/zoom evidence is a source/DOM contract. Installed-Electron rendering, real 10k source distributions, screen-reader operation, long editing sessions, GPU/memory behavior, and real project QA/Delivery operations remain unproven.
- unverifiedRealMachineItems: real 10k-row Batch, 200% zoom and VoiceOver in an installed Electron app; live server conflict under load; provider execution; customer data; signing/notarization; public mirror.

## LA-048 — Project canonical Document Router facts and correction artifacts

- status: completed
- dependencies: LA-029, LA-030, LA-042
- baseCommit: `814dcd3c`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/{application/document_evidence_application_port.ts,routes/document_capability_routes.ts,strict_api_contract.ts}`; `apps/desktop/src/renderer/{data/workspace-client.ts,inspector/{ContextInspector.tsx,document-artifact-model.ts,inspector.css}}`; focused route/Inspector tests; roadmap reality/ledger records.
- testsAdded: RED correction-route test proving a correction is a new parent-linked Artifact whose Router block has `userCorrected:true` while the original stays unchanged; RED Desktop projection test proving the Inspector displays only canonical Router page/backend/reason facts and offers only textual blocks as correction targets.
- commandsExecuted: focused synthetic route and Desktop Inspector tests failed before their implementations and passed after; the first full root suite found the missing strict external `blockId` vocabulary entry, which was added; final `npm test` passed 242 discovered root tests (managed E5 declared skip), `npm --prefix apps/desktop test` passed 166 Node plus 3 Electron activity tests, root/Desktop typecheck and `git diff --check` passed.
- migration: existing document Artifacts remain readable. A correction is an append-only server-owned Artifact/Activity on the existing canonical Run: server hydrates artifact/scope/thread/source and validates the existing Router text block; the client only supplies task/artifact/block IDs and replacement text. It copies immutable Router provenance, marks exactly the replacement block `userCorrected:true`, attaches parent/source digest/locator/before/after facts, and never rewrites the source or original Artifact. The Inspector hides internal artifact paths, projects only server Router facts, and makes canonical blocked pages explicitly unavailable. No capability fallback, second writer, data migration, `data/**`, customer content, public mirror, credential, signing material or managed pack was read or changed.
- rollback: revert this Ticket as one unit. Do not retain a renderer-only correction form, client-authored scope/backend/path, an in-place original Artifact edit, a source-file write, or system/cloud fallback after rollback.
- deletedEntries: Inspector's generic raw Router/internal artifact-path dump for document evidence; job facts now have a typed server projection.
- remainingRisks: optional backends remain unqualified; correction persistence is synthetic-only and does not prove package/UI/VoiceOver or real document scale.
- unverifiedRealMachineItems: installed managed document capabilities, real Document jobs/provenance/correction, package UI, VoiceOver, customer documents, signing/notarization and public mirror.

## LA-049 — Consolidate canonical top-level navigation

- status: completed
- dependencies: LA-046, LA-047, LA-048
- baseCommit: `6074a1db`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/tests/codex-ui-contract.test.ts`; roadmap reality/ledger records.
- testsAdded: characterization that the maintained shell keeps Chats, Projects (localized “项目”), Library and Settings reachable; Library remains scoped to canonical Task/Project selection, Packages live in Settings, the native Settings command aliases that surface, and Stable does not restore Eval or Maintainer execution navigation.
- commandsExecuted: focused Desktop navigation contract first exposed that the localized Project destination is labelled “项目”, then passed with that canonical label; `npm --prefix apps/desktop test` passed 167 Node plus 3 Electron activity tests; `npm run mac:test` passed the same 167+3 suite; root/Desktop typecheck, roadmap validation/test, ledger JSON parse and `git diff --check` passed.
- migration: none. The existing server-backed scope/selection, native command aliases, 480px sidebar dismissal and Settings return-to-prior-scope path are already the one maintained navigation implementation. No URL/deep-link router exists or is introduced, no data/route/writer moves, dual UI state, `data/**`, customer content, public mirror, credential, signing material or managed runtime changed.
- rollback: revert the characterization and records together. Do not create a second Renderer navigation state, revive a production Eval/Maintainer entry, or move Packages back to a duplicate top-level surface.
- deletedEntries: none; retained Eval/Maintainer implementation is owned by the later LA-050 migration/deletion Epic, not this navigation Ticket.
- remainingRisks: installed Electron discoverability, 480px/200%/VoiceOver behavior and retained Eval/Maintainer migration to CI/tools remain unproven.
- unverifiedRealMachineItems: installed-app navigation, keyboard/VoiceOver discoverability, screenshot matrix, remote CI and public mirror.

## LA-050 — Product-exit Epic child-ticket plan

- status: children_planned
- dependencies: LA-017, LA-049, LA-060, LA-061
- baseCommit: `3e516cb3`
- resultCommit: `SELF`
- childTickets: LA-129 Maintainer developer/CI parity; LA-130 Private Eval harness parity; LA-131 shared historical export; LA-132 Maintainer production consumer removal; LA-133 Private Eval production consumer removal.
- scope: planning only. Each child has one writer/surface invariant, explicit dependency, migration limit, test command family and rollback; the Epic itself remains non-executable.
- migration: none. Stable Maintainer/Eval routes remain disabled for mutation; no tool, harness, export, route, UI, history, `data/**`, customer content, public mirror, credential, signing material or managed runtime changed by this planning record.
- rollback: revert the child-ticket definition and risk/deletion coverage together; do not execute the Epic directly or reopen Stable mutation as a substitute for a child implementation.
- deletedEntries: none.
- remainingRisks: R-023 remains until all five child Tickets complete and the Epic is explicitly closed; installed/real history and external CI behavior are unverified.

## LA-052 — Make npm the sole workspace, lockfile, and install authority

- status: completed
- dependencies: LA-000
- baseCommit: `e1a449b8`
- resultCommit: `SELF`
- filesChanged: root `package.json`/`package-lock.json`; deleted `pnpm-workspace.yaml` and `apps/desktop/package-lock.json`; CI cache/install; root desktop scripts and local updater; installation docs; deletion/current-reality records; workspace and updater tests.
- testsAdded: RED `tests/npm_workspace.test.ts` contract for root `packages/*` plus `apps/*`, root lock workspace link, no desktop/pnpm workspace lock, retained Native Capability closure, root workspace scripts, and one CI lock/install path; updater contract that rejects a second desktop `npm install`.
- commandsExecuted: `npm exec --no -- tsx tests/npm_workspace.test.ts` first failed because root workspaces omitted `apps/*`, then passed; `node --test apps/desktop/tests/local-update.test.mjs` first failed because the updater still separately installed desktop, then passed; `npm ci --offline --ignore-scripts` correctly failed only because the local cache lacked lock-pinned `postcss-8.5.20`; approved `npm ci --ignore-scripts` then completed clean installation (443 packages); root typecheck; `npm run mac:test` (164 Desktop Node plus 3 isolated Electron activity tests); `npm run mac:build`; fresh `npm test` (232 root tests); security, recovery, release, roadmap test/validation, and diff checks passed; deletion-before/after desktop direct-lock hash parity passed for 14 dependencies (`2e8faf1ece4f5638534d58fc7cc4db7c88ddcec49be2afcaa5bcef0c7392d9a5`); `rc:status` was not run because it unconditionally writes forbidden `data/reports`.
- migration: root workspaces now cover `packages/*` and `apps/*`; the root lock contains the desktop workspace payload/link and is the sole product workspace install authority. CI and the local updater no longer invoke an independent desktop install. The desktop Native Capability `package-lock.json` and `.pi/npm` remain isolated non-workspace source closures. No runtime/data schema, authority/writer, customer content, `data/**`, public mirror, credential, signing material, or managed runtime was read or changed.
- rollback: revert this Ticket as one unit to restore the exact prior manifests, locks, CI, updater, tests and docs. Do not retain a second desktop installer or lockfile alongside the root workspace after a revert-forward; select one canonical install authority.
- deletedEntries: `pnpm-workspace.yaml`; `apps/desktop/package-lock.json`; CI cache/independent `npm --prefix apps/desktop ci`; local updater's second desktop install.
- remainingRisks: the clean install reported 12 npm audit findings (8 moderate, 4 high), intentionally not remediated by this lock-authority Ticket; direct dependency hash parity and packaging-contract tests do not prove byte-for-byte signed/notarized artifacts; `rc:status` remains forbidden under the no-`data/**` campaign rule.
- unverifiedRealMachineItems: signed/notarized/installed package artifact parity, update/rollback on a managed installation, external developer pnpm habits, provider execution, customer data, and public mirror.

## LA-054 — Split and pin CI without lowering the macOS gate

- status: completed_for_local_campaign
- dependencies: LA-053
- baseCommit: `b40e13fc`
- resultCommit: `SELF`
- filesChanged: `.github/workflows/{ci,mac-beta,mac-stable-release}.yml`; `tests/ci_workflow.test.ts`; roadmap reality/ledger records.
- testsAdded: RED workflow contract for the six required jobs, suite commands, root test-inventory artifact, SHA-only Actions, no `rc:status`, and temporary full `legacy-verify` rollback job.
- commandsExecuted: `npm exec --no -- tsx tests/ci_workflow.test.ts` first failed because the monolithic `verify` job had no `validate` job, then passed after the split; it failed a second time because the old job had been removed before remote parity existed, then passed with `legacy-verify`; Ruby YAML parse passed for all three workflows (with a host PATH permission warning only); local unit/security/recovery/roadmap suite commands, root typecheck, mac build/test, release check, fresh full `npm test` (233 tests), `git diff --check`, and static no-floating-action/no-`rc:status` guards passed.
- migration: CI now has separately visible validate/unit/security/recovery/macos/release results, each with a clean root install. `validate` uploads only the discovered test-path inventory; `macos` retains production desktop build and mac test. `legacy-verify` retains the prior full local-equivalent gate without the unsafe `rc:status` write until remote suite parity is observed. Checkout, setup-node and artifact actions in all workflows use full verified commit SHA pins. No product runtime, schema, `data/**`, customer content, public mirror, credentials, signing material, release, or managed runtime changed.
- rollback: retain or revert to `legacy-verify` if any remote split job fails; remove that temporary job only in a separately recorded deletion after the private candidate branch has all six remote jobs green. Do not re-add `rc:status`, a floating Action tag, or an unpinned dependency as a fallback.
- deletedEntries: monolithic primary `verify` job; floating `actions/checkout@v4` and `actions/setup-node@v4` references in release workflows; unsafe CI `rc:status` execution.
- remainingRisks: remote GitHub Actions execution, artifact retention/download behavior, hosted-macOS dependency setup and the split-suite classifier have not been observed on this candidate branch; the temporary legacy job is intentionally duplicated test execution, not a second product writer, and must be removed after remote parity evidence.
- unverifiedRealMachineItems: remote CI, artifact download, signed/notarized package, installed-app/update/rollback, provider execution, customer data and public mirror.

## LA-055 — Composition-root Epic decomposition and closure

- status: completed; Epic was never directly implemented
- dependencies: LA-008, LA-010, LA-014, LA-023, LA-038
- baseCommit: `a46b2d4c`
- resultCommit: `SELF`
- evidence: the original 5,217-line `server.ts` mixed HTTP, filesystem, Pi/runtime, domain persistence, worker/coordinator and route modules. LA-123 froze the five port boundaries; LA-124 removed its route-local direct FS/Pi debt; LA-125 moved Project Task Run orchestration into one injected coordinator; LA-126 added the CI AST graph; LA-127 removed its only Settings Pi-route exception. The final graph has no route direct FS/Pi edge except the exact LA-050-owned Maintainer filesystem deletion candidate.
- childTickets: LA-123 application-port inventory/contract (`113527ce`); LA-124 route transport-only migration (`ffc924c2`); LA-125 composition (`c91af8b2`); LA-126 import-boundary guard (`595991df`); LA-127 Settings permission edge (`a60504f4`).
- commandsExecuted: child RED/green and specified regressions; final `npm run architecture:check`; authorized no-`data/**` root `npm test` (239 discovered tests); root/Desktop typecheck; `npm run mac:test` (164 Desktop plus 3 isolated Electron activity tests); roadmap validation and diff checks.
- migration: no schema/data migration, dual writer, second session lifecycle, global service locator or Electron lifecycle was introduced. Existing canonical writers, active Run/worker/lease instances, transport DTOs and CAT gates remain singular. `data/**`, customer content, credentials, signing material, managed runtime, public mirror and release were not read or changed.
- rollback: revert individual child Tickets in dependency-safe reverse order. Do not restore a route-local duplicate operation, an inline Project Task Run implementation, an unowned broad architecture exception, a global lookup or a second lifecycle/state authority.
- deletedEntries: route-local FS/Pi operations recorded by LA-124; server-local Project Task Run/compaction helpers recorded by LA-125; LA-127 route-local permission contract helpers and its exact temporary architecture exception.
- remainingRisks: constraints are synthetic/source/application-boundary evidence. The LA-050 Maintainer filesystem deletion candidate remains; broader server startup/General/Eval composition, remote CI, installed runtime, real providers/packages/documents, accessibility and signing are not proven.
- unverifiedRealMachineItems: all remote/installed/runtime/provider/customer-data/signing/public-mirror evidence remains unverified.

## LA-123 — Freeze application route-port authority inventory

- status: completed
- dependencies: LA-008, LA-010, LA-014, LA-023, LA-038
- baseCommit: `a46b2d4c`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/application_port_inventory.ts`; `tests/application_port_inventory.test.ts`; roadmap reality/ledger records.
- testsAdded: RED missing-inventory contract; exact five-port IDs; validated-route input/canonical-output/authority fields; every recorded direct FS/Pi route import remains present only as an LA-124-owned debt.
- commandsExecuted: `npm exec --no -- tsx tests/application_port_inventory.test.ts` first failed with missing module, then passed; root typecheck, roadmap test/validation, root discovery execution, ledger JSON parse and diff check.
- migration: none. The inventory is non-dispatch metadata used only as a characterization contract; no HTTP route, Task/Run/Package/Document writer, Pi Session, filesystem operation, schema, `data/**`, customer content, public mirror, credential, signing material or managed runtime changed.
- rollback: revert the inventory, test and records together. Do not replace it with a global service locator, inferred authority, an unowned broad exception, or a route-level compatibility writer.
- deletedEntries: none.
- remainingRisks: inventory proves only the listed direct route dependencies; it neither removes them nor proves all business/state decisions have moved. LA-124 must migrate the recorded operations behind typed application ports before a direct-import guard can become a denial.
- unverifiedRealMachineItems: route behavior under installed runtime/provider/real Package/Document inputs, customer data, signing/notarization, remote CI and public mirror.

## LA-124 — Delegate route-local filesystem and Pi boundaries through application ports

- status: completed
- dependencies: LA-123
- baseCommit: `113527ce`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/application/{task_run_application_port,workflow_application_port,package_archive_application_port,document_evidence_application_port}.ts`; four migrated route modules; application-port inventory; route/port regression tests; roadmap reality/ledger records.
- testsAdded: RED inventory denial for the four recorded FS/Pi imports plus named port delegation; synthetic `.lapkg` archive-port regular-file/symlink characterization; existing Document evidence and Team route regressions now execute their application ports.
- commandsExecuted: inventory test first failed because LA-123 debt remained; focused route/port suite initially exposed a missing `await` in migrated Team output fallback, then passed after the parity repair; `npm run typecheck`; focused inventory/package/document/Team suite; authorized synthetic-root `npm test` (235 discovered root tests); `npm run roadmap:test`; `npm run roadmap:validate`; ledger JSON parse; `git diff --check`.
- migration: Task capability policy, Team filesystem/Pi child preparation/activity/output handling, Package local archive inspection, and Document grant/OCR/canonical evidence append now each have one typed application port. Routes retain transport DTO parsing/mapping and call the port; the canonical Task/Run/Package/Document writers and server-owned Team active-Run authority remain the same. No schema, data migration, dual writer, `data/**`, customer content, credential, signing material, public mirror, release, or managed runtime changed.
- rollback: revert this Ticket as one unit to restore the prior route-local operations. Do not leave an application port and route-local implementation both active, introduce a global service locator, or substitute an allow-all archive/grant/Pi fallback.
- deletedEntries: route-local Task capability allowlist; route-local Workflow FS/Pi child preparation/output/activity/rollback helpers; route-local `.lapkg` filesystem reader; route-local Document grant/OCR/evidence persistence helpers.
- remainingRisks: this Ticket denies only LA-123’s recorded direct route FS/Pi debt. Endpoint/domain orchestration is not claimed to be wholly decomposed; LA-125 must isolate composition wiring and LA-126 must make broader import-direction regressions CI-visible. Existing route tests do not prove installed runtime, arbitrary large archives, real Package/Document inputs, Provider calls, or remote CI behavior.
- unverifiedRealMachineItems: installed Electron/runtime, real Package/Document inputs, provider/Team child execution, remote CI/artifact behavior, customer data, signing/notarization, release and public mirror.

## LA-125 — Move Project Task Run orchestration out of the server composition root

- status: completed
- dependencies: LA-123, LA-124
- baseCommit: `ffc924c2`
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/application/project_task_run_coordinator.ts`; `packages/cat-server/src/server.ts`; `tests/composition_root_boundary.test.ts`; `tests/cat_worker_cutover.test.ts`; roadmap reality/ledger records.
- testsAdded: RED composition-root characterization rejecting inline `runAgentStreamingUnlocked` and `compactProjectAgentSession`; worker-cutover characterization now proves the application coordinator creates the CAT worker session, binds the same worker identity, and persists the same execution snapshot.
- commandsExecuted: composition characterization first failed while `server.ts` still owned the Run implementation; `npm run typecheck`; focused composition/worker/Task-route/projection/queue/stop/worker-boundary suite; authorized no-`data/**` synthetic-root `npm test` (236 discovered root tests); `npm run desktop:test` and `npm run mac:test` (164 Desktop tests plus 3 isolated Electron activity tests plus Desktop typecheck); `npm run roadmap:test`; `npm run roadmap:validate`; JSON parse; `git diff --check`.
- migration: `ProjectTaskRunCoordinator` now owns Project Task Run state decisions and Pi session business orchestration, including compaction activity. `server.ts` only composes the existing keyed queue, `ActiveAgentRunRegistry`, `TaskMessageQueueCoordinator`, CAT worker supervisor, permission/Team adapters, stores and route runtime adapter. No schema/data migration, dual writer, second session lifecycle, global service locator, Electron behavior, `data/**`, customer content, credential, signing material, public mirror, release or managed runtime changed.
- rollback: revert this Ticket as one unit to restore the former inline Project Task coordinator. Do not retain an inline and an application Run implementation together, recreate a second worker/registry/queue, or replace injected authority with a global lookup or fallback.
- deletedEntries: inline `runAgentStreamingUnlocked`, inline Project Task compaction/activity implementation, and its server-local Run helper surface; the old `cat_worker_cutover` server-location assertion.
- remainingRisks: the composition/worker tests are synthetic and source/application-boundary evidence; `server.ts` still owns broader startup, migration, general/Eval and transport concerns. LA-126 must enforce the complete dependency graph in CI rather than rely on this Ticket's focused guard.
- unverifiedRealMachineItems: installed Electron/managed runtime, real Provider/Team child/Package/Document execution, remote CI/artifacts, accessibility/VoiceOver, customer data, signing/notarization, release and public mirror.

## LA-126 — Enforce audited architecture import direction in CI

- status: completed
- dependencies: LA-124, LA-125
- baseCommit: `c91af8b2`
- resultCommit: `SELF`
- filesChanged: `scripts/architecture-import-guard.ts`; root `package.json`; `.github/workflows/ci.yml`; architecture/CI contract tests; implementation queue/risk/deletion coverage; roadmap reality/ledger records.
- testsAdded: RED missing architecture-guard module; forbidden route-FS fixture; forbidden application-to-route fixture; RED CI assertion that `validate` runs `architecture:check`; exception owner/reason plus queue/deletion-coverage characterization.
- commandsExecuted: focused architecture/CI tests first failed for missing guard, missing CI command, and missing LA-127 risk mapping respectively; then passed with `npm run architecture:check`; `npm run typecheck`; roadmap contract validation; full synthetic-root and Desktop/mac regressions recorded after the documentation update; `git diff --check`.
- migration: none. The guard reads source only. CI `validate` now invokes the same local `architecture:check` command. It uses AST import declarations to prohibit application -> route/server and route -> direct FS/Pi edges, while preserving the existing canonical writers, active Run/worker/lease objects, route DTOs and Electron lifecycle. The exact Maintainer FS exception is owned by LA-050 deletion; the exact Settings permission Pi exception is owned by newly registered LA-127 and is machine-checked for queue/deletion coverage. No schema/data migration, dual writer, runtime fallback, `data/**`, customer content, credential, signing material, public mirror, release or managed runtime changed.
- rollback: revert the script, CI command, tests and exception inventory together. Do not remove the guard, replace an exact exception with a glob/directory allowlist, suppress a violation in test discovery, or retain an ownerless exception.
- deletedEntries: no production entry. The previously unguarded architecture import edge policy is replaced by the audited graph contract; no behavior or canonical authority was deleted.
- remainingRisks: two exact temporary edges remain and are visible: `agent_permission_routes.ts -> @linguist-agent/cat-runtime` until LA-127, and the blocked production Maintainer filesystem route until LA-050 removal. The current graph does not yet prove all server startup/General/Eval domain orchestration is decomposed, installed runtime behavior, remote CI or actual production usage.
- unverifiedRealMachineItems: remote CI execution/artifact behavior, installed Electron/runtime, Provider/Team child/Package/Document inputs, accessibility/VoiceOver, customer data, signing/notarization, release and public mirror.

## LA-128 — Serialize legacy Project quality-ledger appends before the first await

- status: completed
- dependencies: LA-098
- baseCommit: `595991df`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/quality_decision_ledger.ts`; `tests/quality_decision_ledger_concurrency.test.ts`; implementation queue/risk/reality/ledger records.
- testsAdded: the existing full-suite concurrent finding/waiver characterization first failed with `openFindings=1`; a new 32-root concurrent append regression asserts ordered sequence and a resolved finding after each same-Project append race.
- commandsExecuted: focused original and new ledger concurrency tests; root and Desktop typechecks; architecture graph; authorized no-`data/**` full synthetic-root `npm test` (239 discovered tests); `npm run mac:test` (164 Desktop plus 3 isolated Electron activity tests); roadmap and diff checks recorded after this documentation update. The full suite also contained pending LA-127 source changes, but the two Tickets share no modified runtime module.
- migration: the legacy per-process queue now becomes visible before `assertCatGovernanceLegacyAllowed()` can yield. Each queued operation then verifies marker authority, reads, validates, hashes and appends in order. SQLite persistence remains the first and sole authority when installed; marker-after-start behavior still rejects the legacy writer. No schema/data migration, dual writer, fallback, route, Electron or cross-process locking claim changed; `data/**`, customer content, credentials, signing material, managed runtime, public mirror and release were not read or changed.
- rollback: revert the queue-establishment move, regression, and records together. Do not sort events on read, suppress an append error, relax hash/waiver assertions, create a second writer or claim cross-process serialization.
- deletedEntries: none; the correction removes the asynchronous gap before the existing per-path queue, not a product entry.
- remainingRisks: cross-process ledger contention, process-kill/power-loss, real historical Project sizes and production rollback remain unproven R-011 work; the pending LA-127 route migration is unrelated and must independently complete its full verification.
- unverifiedRealMachineItems: remote CI/artifacts, installed Electron/runtime, Provider/Team child/Package/Document inputs, accessibility/VoiceOver, customer data, signing/notarization, release and public mirror.

## LA-127 — Delegate permission contracts through the Settings application port

- status: completed
- dependencies: LA-126
- baseCommit: `595991df`; intervening independent repair: `1b8e68b8` (LA-128)
- resultCommit: `SELF`
- filesChanged: `packages/cat-server/src/application/settings_permission_application_port.ts`; `agent_permission_routes.ts`; `server.ts`; permission/application-port tests; architecture exception/deletion candidate; roadmap reality/ledger records.
- testsAdded: RED import of the missing Settings permission port; application behavior for strict custom rules, invalid `full`, locked CAT-domain rejection and built contract; route inventory now rejects the direct Pi runtime import and requires the named Settings port.
- commandsExecuted: the new application-port test first failed with `ERR_MODULE_NOT_FOUND`, then passed; focused permission/application-port/import-graph suite passed (4 tests); `npm run architecture:check` first hit the local sandbox's `tsx` IPC `EPERM` and then passed in the authorized no-data execution environment; root and Desktop typechecks passed; authorized no-`data/**` full synthetic-root `npm test` passed with 239 discovered tests; `npm run mac:test` passed (164 Desktop plus 3 isolated Electron activity tests); roadmap and diff checks recorded after this documentation update.
- migration: strict permission patch normalization and contract construction now have one Settings application port. Both global and Project HTTP routes only parse transport input, call that port, then hand its patch to the existing canonical server-owned writer. The pending-decision registry and persistence remain route dependencies; no mode/rule defaults, writer, schema, Pi session, Electron behavior, data migration, dual write or fallback changed. `data/**`, customer content, credentials, signing material, managed runtime, public mirror and release were not read or changed.
- rollback: revert the Settings port, route delegation, type import, tests, exception removal and records together. Do not retain a route-local normalization copy beside the port, recreate a direct Pi import as a broad exception, or change invalid/unknown input into allow.
- deletedEntries: route-local permission patch schema/rule validator/contract helper; `agent_permission_routes.ts -> @linguist-agent/cat-runtime` architecture exception; `agent-permission-route-direct-runtime-import` deletion candidate.
- remainingRisks: the blocked production Maintainer filesystem edge remains until LA-050; import/source contracts do not prove all server startup/General/Eval orchestration, installed runtime behavior, remote CI or production usage.
- unverifiedRealMachineItems: remote CI/artifacts, installed Electron/runtime, Provider/Team child/Package/Document inputs, accessibility/VoiceOver, customer data, signing/notarization, release and public mirror.

## LA-129 — Move Maintainer candidate build to an explicit developer/CI tool

- status: completed
- dependencies: LA-017, LA-049, LA-060
- baseCommit: `3d1c67c2`
- resultCommit: `SELF`
- filesChanged: `scripts/maintainer-candidate.ts`; `tests/maintainer_candidate_tool.test.ts`; root `package.json`; roadmap reality/risk/ledger records.
- testsAdded: RED tool contract (module missing before implementation): preview requires explicit `--repo`/`--target-pi`/`--candidate-root` and rejects unknown/duplicate options; build reads the explicit `--plan` file, rejects a `--plan-hash` mismatch before invoking the core, and hands the exact plan plus approved hash into the existing isolated build without a second preview.
- commandsExecuted: focused `npm exec --no -- tsx tests/maintainer_candidate_tool.test.ts` (2/2), `tests/maintainer_routes.test.ts` (Stable 403 `maintainer_disabled_in_stable` retained), `tests/maintainer.test.ts`; root and Desktop typechecks; authorized no-`data/**` full synthetic-root `npm test` (243 discovered tests, new tool test discovered and executed); `npm --prefix apps/desktop test` (167 Node plus 3 isolated Electron activity tests); `npm run mac:test`; roadmap validation/test and diff checks recorded after this documentation update.
- migration: the Maintainer candidate build now runs only through the explicit `maintainer:candidate` developer/CI entry. Preview requires explicit repo/target-pi/candidate-root inputs; build requires an explicit plan file and its exact plan hash, verifies the hash before calling the retained `maintainer.ts` core, and never starts a product Agent, writes the current runtime, or reads real `data/**`. Stable Maintainer routes/UI remain disabled (403); no server route, writer, schema, Electron behavior, candidate data, dual execution path or fallback changed. `data/**`, customer content, credentials, signing material, managed runtime, public mirror and release were not read or changed.
- rollback: delete the new tool entry, its test and the `maintainer:candidate` script together. Do not let the server execute candidate builds, restore production mutation routes, or infer repo/target/output from ambient state.
- deletedEntries: none; the retained Maintainer core stays unchanged for LA-131 history export and LA-132 removal.
- remainingRisks: R-023 stays open until LA-130/131/132/133 complete; the tool contract is synthetic-only and does not prove a real isolated worktree build, remote CI execution, or the production-surface removal.
- unverifiedRealMachineItems: real developer/CI candidate build on a managed installation, remote CI/artifacts, installed Electron/runtime, customer data, signing/notarization, release and public mirror.

## UI Replication Series Registration (LA-134 through LA-142)

- status: children_planned
- dependencies: LA-042, LA-043
- baseCommit: `d3f01a9d`
- resultCommit: `SELF`
- authorization: on 2026-07-24 the user explicitly directed a bold frontend replication against `docs/ui/codex-ui-spec-full.md`, confirmed the document is acceptable for use inside this private repository, and confirmed it will be removed by the existing public-mirror sanitization before any public push. Recorded in `IMPLEMENTATION_QUEUE.md` §10.5 and `RISK_REGISTER.md` R-032; `docs/ui/LA_UI_BEHAVIOR_SPEC.md` remains the only public UI behavior contract; backend truth, CAT hard rails and permission policy still outrank the visual spec; no brand assets, logos, proprietary source or full internal copy may be replicated; the `CODEX_UI_CONTRACT.md` stack constraint (no Tailwind/Framer Motion/Radix migration) remains in force.
- childTickets: LA-134 design-token single source; LA-135 unified 46px title bar and shell chrome; LA-136 sidebar and command palette; LA-137 composer chrome and single composer assembly; LA-138 queued-message tray; LA-139 thread feed anatomy; LA-140 decision/plan/tool cards; LA-141 power slider completion; LA-142 motion library.
- gapEvidence: renderer inventory 2026-07-24 — title-bar 28px/46px mismatch, duplicated dark token block, duplicated composer assembly (BatchReady vs TaskConversation), Workspace fallback toolbar, double `product-workspace.css` import, no plan/tool/auto-review semantic cards, minimal motion set, no superellipse radius engine.
- migration: none. This planning record changes no runtime, route, writer, schema, Electron behavior, `data/**`, customer content, credential, signing material, public mirror or managed runtime.
- rollback: revert the queue/risk/gap-matrix registration together; do not execute the series as one bulk PR or weaken the per-ticket RED-first rule.
- deletedEntries: none.
- remainingRisks: R-032 stays open until all nine child tickets complete; visual evidence remains source/DOM contract until the LA-051 screenshot matrix and real-machine P3 run.
- unverifiedRealMachineItems: installed Electron visuals, real screenshot matrix, VoiceOver, 10k rows, long thread, signing/notarization, public mirror.

## LA-134 — Complete the design-token layer as the single source

- status: completed
- dependencies: LA-042, LA-043
- baseCommit: `96ee5cd5`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/styles/tokens.css`; `apps/desktop/src/renderer/theme-choice.ts`; `apps/desktop/tests/design-tokens.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `design-tokens.test.ts` — dark declarations single-sourced (exactly one `:root[data-theme="dark"]`, no `prefers-color-scheme` duplicate, theme-choice resolves and follows OS changes); superellipse engine (`@supports` scale 1.25 + shape, computed radii, pill); semantic button four-state fills for primary/secondary/tertiary with dark primary text evidence; spec elevations, icon scale, shell metrics (46/36/40 toolbar, sidebar clamp, nav row 29px, settings row 64px, composer 28px/22px), container scale, z tiers; canonical-token guard. All five failed before implementation (one regex was then corrected to the optional-call matchMedia syntax) and passed after.
- commandsExecuted: focused `node --test tests/design-tokens.test.ts` RED then green; `tests/codex-ui-contract.test.ts` regression (12/12); root and Desktop typechecks; full `npm --prefix apps/desktop test` (172 Node plus 3 isolated Electron activity tests); diff check.
- migration: `tokens.css` keeps every existing `--la-*` name and value while adding the semantic button/elevation/icon/shell/container/z vocabulary and converting radii to the scaled engine; the duplicated `@media (prefers-color-scheme: dark)` block is deleted, and `theme-choice.ts` now always resolves the effective theme (system via `matchMedia`, with an OS-change listener) into `data-theme`, so dark declarations exist exactly once. The spec's dark `--color-background-button-primary: gray-1000` row conflicts with its own send-button evidence (foreground fill + near-black text); LA resolved primary toward the component evidence in both themes. No component restyle, runtime, route, writer, schema, Electron behavior, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the token completion, theme resolution, test and records together. Do not restore the duplicated dark block, a second palette, or per-component hard-coded radii scales.
- deletedEntries: duplicated `@media (prefers-color-scheme: dark)` token block (~65 lines).
- remainingRisks: R-032 stays open for LA-135 through LA-142; superellipse rendering depends on engine support and is source-contract evidence only until the LA-051 screenshot matrix; 1.25× radii on supporting engines is an intentional spec-faithful visual change not yet screenshot-verified.
- unverifiedRealMachineItems: installed Electron light/dark rendering, superellipse engine behavior, real screenshot matrix, VoiceOver, signing/notarization, public mirror.

## LA-135 — Unify the 46px title bar and shell chrome

- status: completed
- dependencies: LA-134
- baseCommit: `637e75dc`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/{main.tsx,styles.css,styles/tokens.css}`; `apps/desktop/src/renderer/shell/product-workspace.css`; `apps/desktop/src/renderer/workspace/{Workspace.tsx,workspace.css}`; `apps/desktop/tests/shell-chrome.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `shell-chrome.test.ts` — single draggable 46px title bar with tokenized height and traffic-light inset (28px strip absent from root and stylesheet, drag/no-drag regions intact, `--la-safe-header-left` drives the show-sidebar button); single `product-workspace.css` import site; Workspace fallback toolbar absent with `renderToolbar` required. All three failed before implementation and passed after.
- commandsExecuted: focused `node --test tests/shell-chrome.test.ts` RED then green; `tests/codex-ui-contract.test.ts` regression (12/12); Desktop typecheck; full `npm --prefix apps/desktop test` (175 Node plus 3 isolated Electron activity tests); `npm run mac:test`; roadmap validation/test and diff checks recorded after this documentation update.
- migration: the existing 46px `.product-toolbar` is now the only draggable title bar (its height consumes `--la-height-toolbar`; interactive chrome stays no-drag); the redundant 28px `.desktop-drag-region` element and rule are deleted; the traffic-light inset moves from a hard-coded 74px to the `--la-safe-header-left: 78px` token (x:16 + ~54px buttons + breathing room); the dead `.workspace-toolbar` fallback (sole consumer always passed `renderToolbar`) and its styles are deleted and `renderToolbar` is now a required shell input; `product-workspace.css` is imported once by `ProductWorkspace.tsx` instead of both globally and per-component. Drag semantics, window options security parameters, sidebar chrome drag row, and all toolbar behaviors unchanged. No runtime, route, writer, schema, Electron security option, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the chrome merge, required toolbar input, single import, token inset and records together. Do not restore a second drag strip, a duplicate toolbar, or a hard-coded traffic-light margin.
- deletedEntries: `.desktop-drag-region` element and CSS rule; `.workspace-toolbar` fallback markup and styles; global `product-workspace.css` import in `styles.css`.
- remainingRisks: R-032 stays open for LA-136 through LA-142; drag-region and safe-inset behavior are source-contract evidence until installed-app and screenshot verification.
- unverifiedRealMachineItems: installed Electron dragging/traffic-light interplay at all window sizes and zoom, real screenshot matrix, VoiceOver, signing/notarization, public mirror.

## LA-136 — Replicate the sidebar and command palette anatomy

- status: completed
- dependencies: LA-134
- baseCommit: `90532de1`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/workspace/workspace.css`; `apps/desktop/src/renderer/command/{CommandPalette.tsx,command-model.ts,command-palette.css}`; `apps/desktop/tests/sidebar-palette.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `sidebar-palette.test.ts` — shared sidebar width token + 72px footer + collapsed entrance offset; cmdk dialog anatomy (520px cap, takeover radius, 440px/90vh-64px list, group-heading style); typed groups with stable flat indices (`groupCommandResults` export, heading render, flat `command-result-${index}` ids, unchanged `aria-activedescendant`). All three failed before implementation and passed after.
- commandsExecuted: focused `node --test tests/sidebar-palette.test.ts` RED then green; `tests/{codex-ui-contract,command-palette,workspace-sidebar}.test.ts` regressions (23 tests); Desktop typecheck; full `npm --prefix apps/desktop test` (178 Node plus 3 isolated Electron activity tests); roadmap validation/test and diff checks recorded after this documentation update.
- migration: sidebar width consolidates to the shared `--la-sidebar-width` clamp token and the footer reaches the spec 72px height; the command palette adopts the cmdk dialog anatomy (520px cap, 16px-base radius, 440px list with viewport headroom, hidden scrollbar, contained overscroll) and now renders results as typed groups （命令→Chat→项目→Batch→Task) via a new pure `groupCommandResults` helper while keeping flat option indices for `aria-activedescendant`. LA's richer two-line result rows are deliberately retained over the spec's single-line 24px rows; pin/hover is a persisted-preference feature intentionally not replicated (attention buckets cover ordering); the collapsed-sidebar translateX(-8px) entrance and mobile overlay remain. Navigation state stays canonical-scope-backed; no new frontend state machine, runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the token consolidation, palette anatomy, grouping and records together. Do not regress result rows to single-line, introduce renderer-owned pin state, or duplicate the width clamp outside the token.
- deletedEntries: local `--workspace-sidebar-width` literal clamp (now the shared token); 640px/600px dialog widths; 448px list cap.
- remainingRisks: R-032 stays open for LA-137 through LA-142; grouped palette interaction and sidebar metrics are source-contract evidence until installed-app and screenshot verification.
- unverifiedRealMachineItems: installed Electron palette grouping/keyboard flow, real screenshot matrix, VoiceOver group semantics, signing/notarization, public mirror.

## LA-137 — Replicate composer chrome and unify the composer assembly

- status: completed
- dependencies: LA-134
- baseCommit: `40ee4051`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/composer/{AgentComposer.tsx,composer.css,composer-workbench.tsx,index.ts}`; `apps/desktop/src/renderer/workspace/Workspace.tsx`; `apps/desktop/src/renderer/conversation/TaskConversation.tsx`; `apps/desktop/tests/composer-chrome.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `composer-chrome.test.ts` — surface shadow is the elevation token with backdrop blur and squircle retained; slash menu consumes the radius token; attachment area keeps spec 8px/6px padding and 12px chips; placeholder pseudo-element mechanism (label `data-placeholder`, `:placeholder-shown` `::after` absolute/nowrap/ellipsis/0.5/no-pointer, native placeholder transparent); single asset/model control assembly shared by BatchReady and TaskConversation. All three failed before implementation (placeholder assertions were then rewritten to per-declaration block matching) and passed after.
- commandsExecuted: focused `node --test tests/composer-chrome.test.ts` RED then green; `tests/{codex-ui-contract,task-composer}.test.ts` regressions; Desktop typecheck; full `npm --prefix apps/desktop test` (181 Node plus 3 isolated Electron activity tests); `npm run mac:test`; roadmap validation/test and diff checks recorded after this documentation update.
- migration: composer surface shadow moves to `--la-elevation-prominent` (LA's stronger focus-within state, backdrop blur and squircle engine retained); slash menu radius consumes `--la-radius-takeover`; attachment area adopts the spec 8px/6px padding and the 12px composer-radius-minus-8 chip geometry (replacing pills); the placeholder now renders through the spec pseudo-element mechanism with the native placeholder kept accessible but visually transparent across single-line and multiline layouts. The duplicated composer assembly is unified in `composer/composer-workbench.tsx` (`ComposerAssetControls`/`ComposerModelControls`); send/stop/create semantics stay with each assembly. Drag-to-drop files and blocked/inert composer states are not existing LA features and were not faked. Canonical Run/queue state sources, send/queue/steer semantics, runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime unchanged.
- rollback: revert the chrome token moves, placeholder mechanism, assembly unification and records together. Do not restore per-assembly disclosure wiring copies or a second placeholder mechanism.
- deletedEntries: hand-wired `ComposerAddDisclosure` blocks in BatchReady and TaskConversation; hand-wired `ContextUsageDisclosure`/`ModelDisclosure` pairs; 999px attachment pill radius; custom three-layer surface shadow (now the token); native-only placeholder rendering.
- remainingRisks: R-032 stays open for LA-138 through LA-142; placeholder pseudo-element interaction with IME composition and long CJK placeholders is source-contract evidence until installed-app verification.
- unverifiedRealMachineItems: installed Electron composer rendering at all layouts/zooms/themes, real screenshot matrix, VoiceOver placeholder announcement, signing/notarization, public mirror.

## LA-138 — Complete the queued-message tray row motion and editing state

- status: completed
- dependencies: LA-137
- baseCommit: `528ef0f5`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/composer/{QueuedMessageList.tsx,composer.css}`; `apps/desktop/tests/queued-tray.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `queued-tray.test.ts` — `queued-row-enter` keyframes (opacity + translateY cue on the micro duration token, applied to rows); `data-editing` row state with handle/actions dimmed to 0.6 and non-interactive while the editor stays usable; actions group carries the spec `Queued message actions` label. All three failed before implementation and passed after.
- commandsExecuted: focused `node --test tests/queued-tray.test.ts` RED then green; `tests/codex-ui-contract.test.ts` regression (12/12); Desktop typecheck; full `npm --prefix apps/desktop test` (184 Node plus 3 isolated Electron activity tests); roadmap validation/test and diff checks recorded after this documentation update.
- migration: queued rows now enter with the spec 0.18s-class opacity/spatial transition (measured-height wrappers deliberately replaced by a translate cue; reduced motion is handled by the global rule); the editing row exposes `data-editing` and dims its handle/actions to 0.6 with pointer input removed (the dim rules sit after the hover rules so hover cannot resurrect the actions); the actions group is labelled. The existing tray contract stays intact: 30dvh cap, 1px rhythm, hover-revealed handle/actions, Retry/Steer/Edit/Delete/Pause/Resume, paused remedy copy, interrupted/delivery-failed reasons, the alertdialog clear confirmation, and the server-owned queue as the only truth. No runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the row animation, editing state, action label and records together. Do not introduce per-row measured-height wrappers or renderer-owned queue state.
- deletedEntries: none; the tray was already functionally complete and this ticket added the missing motion/editing/label layer.
- remainingRisks: R-032 stays open for LA-139 through LA-142; row animation timing and editing dim are source-contract evidence until installed-app verification.
- unverifiedRealMachineItems: installed Electron queue tray animation/editing, real screenshot matrix, VoiceOver group announcement, signing/notarization, public mirror.

## LA-139 — Apply the spec density rules to the thread feed

- status: completed
- dependencies: LA-134
- baseCommit: `8656ee13`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/conversation/{ConversationItems.tsx,conversation-items.css}`; `apps/desktop/tests/thread-anatomy.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `thread-anatomy.test.ts` — conversation timestamps (activity/document/process/artifact `<time>`) default to `opacity: 0` and reveal on hover/focus-within while run-boundary status stays visible; the user bubble carries a hover/focus-revealed copy action with the spec `Copy message`/`Copied` aria pair and a clipboard write. Both failed before implementation and passed after.
- commandsExecuted: focused `node --test tests/thread-anatomy.test.ts` RED then green; `tests/codex-ui-contract.test.ts` regression (12/12); Desktop typecheck; full `npm --prefix apps/desktop test` (186 Node plus 3 isolated Electron activity tests); roadmap validation/test and diff checks recorded after this documentation update.
- migration: the thread feed now follows the two spec-confirmed information-density rules — ambient timestamps hide until hover or keyboard focus (status elements such as the run boundary, thinking elapsed and specialist duration stay visible, keeping the same information available to keyboard and assistive technology), and the user bubble gains a hover-revealed inline copy action (1.6s copied reset, ghost 24px circle). Process group two-tone hover brightening, the `· N 次` trailing, the Worked divider, and the 32px jump-to-latest with working dots were already compliant and are now locked by regression; the spec reasoning 140px cap does not apply because LA reasoning is content-free. Canonical item protocol, virtualization and coalescing untouched; no runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the timestamp reveal, copy action and records together. Do not hide status-bearing time elements or reintroduce always-on ambient timestamps.
- deletedEntries: none.
- remainingRisks: R-032 stays open for LA-140 through LA-142; hover-reveal discoverability and copy interaction are source-contract evidence until installed-app verification.
- unverifiedRealMachineItems: installed Electron timestamp/copy discoverability, real screenshot matrix, VoiceOver focus order, signing/notarization, public mirror.

## LA-140 — Align decision cards and derive the model-change divider

- status: completed
- dependencies: LA-139
- baseCommit: `85147695`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/conversation/{PermissionRequestSurface.tsx,ConversationItems.tsx,conversation-model.ts,conversation-items.css,conversation-model.test.ts}`; `apps/desktop/tests/decision-cards.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `decision-cards.test.ts` — approval shell 20px + elevation token; Enter/Esc kbd chips with the spec kbd geometry; model-change items derived from canonical execution snapshots and rendered as the inline divider with flanking hairlines and a reveal tooltip. Plus a pure behavior test in `conversation-model.test.ts`: exactly one divider for gpt-a→gpt-b, none for the same model or missing snapshots, positioned before the run-started boundary. All failed before implementation and passed after.
- commandsExecuted: focused `node --test tests/decision-cards.test.ts` RED then green; `tests/{codex-ui-contract,decisions,permissions}.test.ts` regressions; `src/renderer/conversation/conversation-model.test.ts`; Desktop typecheck; full `npm --prefix apps/desktop test` (188 Node plus 3 isolated Electron activity tests); roadmap validation/test and diff checks recorded after this documentation update.
- migration: the approval surface now keeps the spec rounded-3xl 20px shell with `--la-elevation-prominent`, and its primary/deny buttons carry the spec kbd hints (16px, 6px radius, currentColor 10%, aria-hidden) — keyboard behavior already existed via approval-keys. Model changes now appear in the timeline: the conversation model derives `(providerId, modelId)` transitions between consecutive Runs from canonical `executionSnapshots` (legacy epochs and missing snapshots yield nothing), inserts them at order -1 before the run-started boundary, and renders the spec inline divider with an ⓘ warning tooltip; `itemSearchText`, `itemMatchesKind` and the size estimator cover the new kind. Plan cards/Step pills are deliberately not fabricated (no canonical structured todo data — needs a backend ticket); the auto-review card and 200px file-preview list are likewise out of scope for missing features/data. Decision binding, approval semantics, runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime unchanged.
- rollback: revert the shell alignment, kbd hints, model-change derivation and records together. Do not derive model changes from renderer preference state or fabricate plan progress.
- deletedEntries: none.
- remainingRisks: R-032 stays open for LA-141 and LA-142; model-change derivation depends on server-populated execution snapshots and is synthetic/source evidence until installed-app verification.
- unverifiedRealMachineItems: installed Electron approval card and model-change divider, real screenshot matrix, VoiceOver tooltip/kbd announcement, signing/notarization, public mirror.

## LA-141 — Complete the power slider endpoint labels

- status: completed
- dependencies: LA-134
- baseCommit: `4a7cc03f`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/composer/{ComposerPowerSlider.tsx,composer.css}`; `apps/desktop/tests/power-slider.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `power-slider.test.ts` — endpoint labels (更快↔更强) render with aria-hidden, `holding` tracks pointer drag and keyboard focus via `data-holding`, endpoints reveal under the holding state with the micro opacity transition and stay pointer-transparent; geometry/keyboard/value-text/reset regression lock. The endpoint test failed before implementation and passed after; the regression lock passed throughout.
- commandsExecuted: focused `node --test tests/power-slider.test.ts` RED then green; `tests/codex-ui-contract.test.ts` and `src/renderer/composer/composer-power.test.ts` regressions; Desktop typecheck; full `npm --prefix apps/desktop test` (190 Node plus 3 isolated Electron activity tests); roadmap validation/test and diff checks recorded after this documentation update.
- migration: while the thumb is held or keyboard-focused, the track now reveals the spec endpoint labels (aria-hidden, micro-duration fade, pointer-events none). The 24px track/28px thumb/4px ticks, 0.3s spring, keyboard map, `{value}, {n} of 7.` value text and reset button were already compliant and are locked by regression. Advanced view (model+effort bundles), Fast mode (no production route under LA-033) and the Ultra usage warning (no usage-metering concept) are server-side features that do not exist and were not faked; they await real feature tickets. ExecutionProfile routing, thinking-level persistence, runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime unchanged.
- rollback: revert the endpoint labels and records together. Do not introduce fake Fast/Ultra/Advanced controls.
- deletedEntries: none.
- remainingRisks: R-032 stays open for LA-142; endpoint reveal interaction is source-contract evidence until installed-app verification.
- unverifiedRealMachineItems: installed Electron slider endpoint interaction, real screenshot matrix, VoiceOver value announcement, signing/notarization, public mirror.

## LA-142 — Land the motion library (series finale)

- status: completed
- dependencies: LA-134
- baseCommit: `22804d7e`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/styles/{tokens.css,base.css}`; `apps/desktop/src/renderer/workspace/workspace.css`; `apps/desktop/src/renderer/conversation/conversation-items.css`; `apps/desktop/src/renderer/composer/QueuedMessageList.tsx`; `apps/desktop/tests/motion-library.test.ts`; roadmap reality/risk/ledger records.
- testsAdded: RED `motion-library.test.ts` — shimmer `steps(48, end)` cadence; token-owned pulse (`--la-animate-pulse` + `la-pulse` keyframes) consumed by the pending-permission badge; @property-driven scroll edge-fade system (`--la-top-fade`/`--la-bottom-fade`, `la-edge-fade`, `.la-scroll-fade-y` with `scroll(self block)`) consumed by the queue tray. All three failed before implementation (the la-pulse regex was then corrected for the 0.5 literal) and passed after.
- commandsExecuted: focused `node --test tests/motion-library.test.ts` RED then green; `tests/{codex-ui-contract,queued-tray,workspace-sidebar}.test.ts` regressions; Desktop typecheck; full `npm --prefix apps/desktop test` (193 Node plus 3 isolated Electron activity tests); `npm run mac:test`; roadmap validation/test and diff checks recorded after this documentation update.
- migration: the loading shimmer now sweeps with the spec steps(48) cadence; the pending-permission badge pulses via the new token-owned `--la-animate-pulse`; the queue tray scrolls with the spec edge fade through a new @property-driven scroll-fade system (graceful degradation to the declared default when scroll-driven animations are unsupported, never hiding content). Codex-only keyframes (browser-sidebar, sync-dot, snake, startup blossom) have no LA surfaces and were not copied; tokens without consumers (`--la-ease-in`, `--la-cubic-enter`) were not created per the repository PR rule. Reduced motion remains handled by the global rule. R-032 turns mitigated by source evidence with the series complete; visual evidence still awaits the LA-051 screenshot matrix and real-machine P3. No runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the cadence change, pulse token, scroll-fade system and records together. Do not copy Codex-only animations onto surfaces that do not exist or create consumerless motion tokens.
- deletedEntries: none.
- remainingRisks: scroll-driven animation support is engine-dependent (degradation is safe by construction); all nine series tickets are complete, and remaining evidence is source/DOM contract until the LA-051 screenshot matrix, installed-app verification and real-machine P3.
- unverifiedRealMachineItems: installed Electron motion rendering, scroll-fade behavior, reduced-motion parity on real macOS, real screenshot matrix, VoiceOver, signing/notarization, public mirror.

## LA-143 — Differentiate power slider motion per gear

- status: completed
- dependencies: LA-141
- baseCommit: `7b6d25af`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/composer/{ComposerPowerSlider.tsx,composer.css}`; `apps/desktop/tests/power-slider-motion.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `power-slider-motion.test.ts` — gear-graded fill follows the thumb geometry (`data-index`, fill width formula, 12px radius, accent gradient, 0.3s spring width transition); commit fires a deterministic 12-particle burst (30° spacing, 6ms stagger, `--particle-x/y` offsets, `la-particle-burst .62s cubic-bezier(.25,1,.5,1)` with a 22% 1.28 overshoot); ambient 3px glowing track particles stream only at the max gear. All three failed before implementation and passed after.
- commandsExecuted: focused `node --test tests/power-slider-motion.test.ts` RED then green; `tests/{power-slider,codex-ui-contract}.test.ts` and `src/renderer/composer/composer-power.test.ts` regressions; Desktop typecheck; full `npm --prefix apps/desktop test` (196 Node plus 3 isolated Electron activity tests); roadmap validation/test and diff checks recorded after this documentation update.
- migration: the slider gains three presentation-only motion layers requested by the user on 2026-07-24 (prettier, per-gear differentiation): a gear-graded fill following the thumb, a 12-particle burst on every commit (pointer and keyboard alike, cleaned up after 700ms), and an ambient particle stream at the max gear only. Gear semantics, persistence, value announcement, endpoint labels and reduced-motion handling are unchanged (the global rule disables all three layers under reduced motion). No fake Fast mode, no runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the motion layers and records together. Do not alter gear semantics or reintroduce a fake Fast mode for these effects.
- deletedEntries: none.
- remainingRisks: burst/particle rendering and fill transition are source-contract evidence until installed-app verification; continuous particles at max add a minor animation cost, bounded to three 3px dots and disabled under reduced motion.
- unverifiedRealMachineItems: installed Electron slider motion, real screenshot matrix, reduced-motion parity on real macOS, VoiceOver, signing/notarization, public mirror.

## LA-144 — Add the strictly validated todo_list rich artifact block

- status: completed
- dependencies: LA-042
- baseCommit: `88fc04e1`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/rich_artifact.ts`; `apps/desktop/src/renderer/inspector/{RichArtifactPreview.tsx,inspector.css}`; `tests/rich_artifact_todo_block.test.ts`; `apps/desktop/tests/rich-artifact-todo.test.ts`; roadmap reality/ledger records.
- testsAdded: RED root `rich_artifact_todo_block.test.ts` — strict status enum, caption, round-trip; unknown status/duplicate ids/empty items rejected; inert HTML export renders completed todos with strikethrough. RED desktop `rich-artifact-todo.test.ts` — preview renders the block with per-item status and inspector strikethrough/in-progress styles. All four failed before implementation and passed after.
- commandsExecuted: focused root and desktop block tests RED then green; `tests/rich_artifact.test.ts` regression; root and Desktop typechecks; full root `npm test` (tool capability manifest, roadmap validator and worker boundary suites pass) and `npm --prefix apps/desktop test` (197 Node plus 3 isolated Electron activity tests); roadmap validation/test and diff checks recorded after this documentation update.
- migration: rich artifact schema v1 gains the `todo_list` block — items carry a stable identifier, ≤2,000-character text and a strict `pending | in_progress | completed` status (≤500 items, unique ids, non-empty); the inert HTML export renders status markers and completed strikethrough with the same CSP; the Electron preview renders the block with ✓/◐/○ markers, completed strikethrough and an in-progress accent. All seven existing block types and the executable-markup ban are unchanged; no artifact type, runtime, route, writer, schema migration, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the block schema, preview, export and records together. Do not loosen the executable-markup ban or add the block without the strict status enum.
- deletedEntries: none.
- remainingRisks: the block is schema/renderer-only until LA-145 gives it a canonical writer; export/preview rendering is source-contract evidence until installed-app verification.
- unverifiedRealMachineItems: installed Electron todo block rendering, real screenshot matrix, VoiceOver list semantics, signing/notarization, public mirror.

## LA-145 — Add the agent_plan artifact type and host-owned update tool

- status: completed
- dependencies: LA-014, LA-144
- baseCommit: `f226363e`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/task_workspace_contract.ts`; `contracts/schemas/task-workspace-common.v2.schema.json`; `packages/cat-runtime/src/{toolCapabilities.ts,generalSessionPlan.ts,createGeneralAgentSession.ts,agentRuntimePort.ts}`; `packages/cat-tools/src/{update-plan-tool.ts,index.ts}`; `packages/cat-server/src/{general_worker_rpc.ts,general_worker_runtime.ts,general_agent_runs.ts}`; `apps/desktop/src/renderer/{conversation/ConversationItems.tsx,inspector/ContextInspector.tsx}`; `tests/{agent_plan_tool.test.ts,general_session_plan.test.ts}`; roadmap reality/ledger records.
- testsAdded: RED `agent_plan_tool.test.ts` (6) — `agent_plan` accepted while unknown types stay rejected; strict payload validation (empty/unknown status/duplicate ids/NUL/unexpected fields); version increments 1→2 with a `plan` activity referencing the artifact inside the active run; stale run rejected; `assertProductionToolCapabilities` covers `agent_plan_update`; `parseServerToolRequest` envelope strictness. Plus `general_session_plan.test.ts` assertions: registered (not initial-active) for Run-backed sessions.
- commandsExecuted: focused `tests/agent_plan_tool.test.ts` RED (missing exports) then green; `tests/{tool_capability_manifest,general_session_plan,general_agent_session,worker_execution_boundary,task_workspace_contract,rich_artifact,rich_artifact_todo_block}.test.ts` regressions; root and Desktop typechecks; full root `npm test` (capability manifest, roadmap validator, worker boundary pass) and `npm --prefix apps/desktop test` (198 Node plus 3 isolated Electron activity tests, including the in-flight LA-146 plan-model unit test); `npm run mac:test`; roadmap validation/test and diff checks recorded after this documentation update.
- migration: the canonical contract gains the `agent_plan` artifact type (union, ARTIFACT_TYPES, v2 schema enum, two exhaustive renderer label maps). The General Worker gains a `server_tool` bridge kind: the worker stub only sends `bridge_request`; the Host validates the envelope (`parseServerToolRequest`) and dispatches to `updateAgentPlanArtifact`, which strictly validates the full todo payload and, guarded by the task's still-active run (snapshot pre-check plus `expectedActiveRun`), appends the next writer-versioned `agent-plan:<taskId>` artifact and a `plan` activity via one `appendGenerated` call. The main-Run, compaction and fork call sites inject the handler; delegated read-only children do not register the tool. The tool is registered through `toolSurface` (document-context gate, not initial-active — the model activates it via capability_search), carries a new `task-plan` capability kind with a cat-governance/non-picker manifest, and is built by `createUpdatePlanTool` (defineTool + Typebox) with a system-prompt hint. The Worker never opens the workspace for this tool. Bridge cancellation is not implemented (remaining risk). No schema migration, runtime fallback, second writer, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the artifact type, bridge kind, tool, handler and records together. Do not let the Worker write canonical Task truth, register the tool without capability metadata, or accept client-supplied artifact versions.
- deletedEntries: none.
- remainingRisks: the bridge has no cancellation (a hung host handler is bounded by the RPC timeout); CAT Project runs are not wired (standalone only by design of this ticket); evidence is synthetic/source-level until an installed-app Run exercises the tool end to end.
- unverifiedRealMachineItems: installed Electron end-to-end plan tool execution, real screenshot matrix, VoiceOver, signing/notarization, public mirror.

## LA-146 — Render the Plan card and Step pill from the canonical plan

- status: completed
- dependencies: LA-139, LA-145
- baseCommit: `e4bad218`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/conversation/{plan-model.ts,plan-model.test.ts,ConversationItems.tsx,TaskConversation.tsx,conversation-items.css}`; `apps/desktop/tests/plan-card.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `plan-card.test.ts` (2) — agent_plan artifacts bypass the generic artifact card; summary sentences, aria-expanded toggle, todo status/strikethrough, 7rem/20rem height states, chevron rotation; the pill derives from the canonical snapshot with ring/dashoffset, Step n/N, all-complete dot and a reveal popover. Plus `plan-model.test.ts` pure behavior (3): newest version parsing, spec step order, ring geometry. All failed before implementation and passed after.
- commandsExecuted: focused `node --test tests/plan-card.test.ts` RED then green; `src/renderer/conversation/{plan-model,conversation-model}.test.ts`; Desktop typecheck; full `npm --prefix apps/desktop test` (200 Node plus 3 isolated Electron activity tests); roadmap validation/test and diff checks recorded after this documentation update.
- migration: the agent_plan artifact now renders as the spec Plan card in the timeline (progress summary header, chevron toggle, index + status-icon todo rows with completed strikethrough, 7rem preview / 20rem expanded heights), and a Step pill sits above the composer (hidden while a permission surface replaces it): progress ring with spring dashoffset or the spec all-complete dot, `Step n / N`, and a hover/focus popover carrying the full plan. Tasks without a plan artifact render nothing; progress derives only from the canonical projection — the Renderer fabricates nothing. No runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the card, pill, model and records together. Do not derive plan progress from renderer-local state or render a plan from markdown parsing.
- deletedEntries: none.
- remainingRisks: card/pill rendering is source-contract evidence until an installed-app Run produces a real plan; the pill derives from the single per-task plan artifact, so very old plans stay visible until updated (by design of LA-145's per-task id).
- unverifiedRealMachineItems: installed Electron Plan card and pill rendering, real screenshot matrix, VoiceOver expanded-state announcement, signing/notarization, public mirror.

## LA-147 — Add the agent_present artifact type and host-owned present tool

- status: completed
- dependencies: LA-145
- baseCommit: `64f43ce2`
- resultCommit: `SELF`
- filesChanged: `packages/cat-data/src/task_workspace_contract.ts`; `contracts/schemas/task-workspace-common.v2.schema.json`; `packages/cat-runtime/src/{toolCapabilities.ts,generalSessionPlan.ts,createGeneralAgentSession.ts,agentRuntimePort.ts}`; `packages/cat-tools/src/{present-answer-tool.ts,index.ts}`; `packages/cat-server/src/{general_worker_rpc.ts,general_worker_runtime.ts,general_agent_runs.ts}`; `apps/desktop/src/renderer/{conversation/ConversationItems.tsx,inspector/ContextInspector.tsx}`; `tests/agent_present_tool.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `agent_present_tool.test.ts` (8) — `agent_present` accepted while unknown types stay rejected; strict payload validation (empty/missing blocks, unexpected fields, executable HTML, unknown table columns rejected; `todo_list`/`image`/`page_overlay` not presentable); every present call writes a brand-new version-1 artifact plus an `artifact_update` activity inside the active run; stale run rejected; `assertProductionToolCapabilities` covers `agent_present`; `parseServerToolRequest` accepts the new envelope and still rejects unregistered tools; `routeGeneralServerTool` dispatches by tool name and rejects loudly when a handler is missing; registered (not initial-active) for Run-backed sessions. All failed before implementation and passed after.
- commandsExecuted: focused `tests/agent_present_tool.test.ts` RED (missing exports) then green; `tests/{agent_plan_tool,general_session_plan,rich_artifact,rich_artifact_todo_block,tool_capability_manifest,task_workspace_contract,strict_api_contract}.test.ts` regressions; root and Desktop typechecks; full root `npm test` (EXIT=0) and `npm --prefix apps/desktop test` (200 Node plus 3 isolated Electron activity tests, EXIT=0); roadmap validation/test and diff checks recorded after this documentation update.
- migration: the canonical contract gains the `agent_present` artifact type (union, ARTIFACT_TYPES, v2 schema enum, two exhaustive renderer label maps). The model-facing `agent_present` tool (defineTool + Typebox, `createPresentAnswerTool`) accepts a declarative block document — markdown, table, chart, diff and file_reference blocks only; todo stays exclusive to `agent_plan_update` and evidence blocks are not model-presentable. The worker stub sends the same `server_tool` bridge kind with the tool name; the Host validates the envelope (`parseServerToolRequest` allowlist), routes by name (`routeGeneralServerTool`, no silent fallback when a handler is absent) and dispatches to `presentAgentAnswerArtifact`, which strictly validates via the shared rich-artifact parser, server-stamps title/generator/createdAt, and — guarded by the still-active run — appends a brand-new `agent-present:<taskId>:<uuid>` artifact plus an `artifact_update` activity in one `appendGenerated` call. The three Run call sites inject the handler; delegated read-only children do not register the tool. Registered through `toolSurface` (document-context gate, not initial-active — the model activates via capability_search), carrying a new `task-present` capability kind with a cat-governance/non-picker manifest, plus a system-prompt hint. The Worker never opens the workspace for this tool. No schema migration, runtime fallback, second writer, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the artifact type, bridge entry, routing, tool, handler and records together. Do not let the Worker write canonical Task truth, open todo_list/image/page_overlay to the model, or route server tools without a named handler.
- deletedEntries: none.
- remainingRisks: the bridge has no cancellation (bounded by the RPC timeout, same as LA-145); CAT Project runs are not wired (standalone only by design); the timeline card lands in LA-148 — until then the artifact is visible via the generic artifact card and Inspector; evidence is synthetic/source-level until an installed-app Run exercises the tool end to end.
- unverifiedRealMachineItems: installed Electron end-to-end present tool execution, real screenshot matrix, VoiceOver, signing/notarization, public mirror.

## LA-148 — Render agent_present artifacts as timeline Answer cards

- status: completed
- dependencies: LA-146, LA-147
- baseCommit: `43284785`
- resultCommit: `SELF`
- filesChanged: `apps/desktop/src/renderer/conversation/{present-model.ts,present-model.test.ts,ConversationItems.tsx,conversation-items.css}`; `apps/desktop/src/renderer/inspector/RichArtifactPreview.tsx`; `apps/desktop/tests/present-card.test.ts`; roadmap reality/ledger records.
- testsAdded: RED `present-card.test.ts` (1) — agent_present artifacts bypass the generic artifact card; PresentCard parses through the pure model; invalid documents render nothing; blocks pass untouched to the shared `RichArtifactBlockView`; expanded default, aria-expanded toggle, preview cap, expanded scroll, chevron rotation, inspect affordance. Plus colocated `present-model.test.ts` pure behavior (2): block order/title fidelity; non-present type, schema mismatch, executable HTML and missing documents all return null. All failed before implementation and passed after.
- commandsExecuted: focused `node --test tests/present-card.test.ts` RED then green; `src/renderer/conversation/{present-model,plan-model,conversation-model}.test.ts`; `tests/plan-card.test.ts` regression; Desktop typecheck; full `npm --prefix apps/desktop test` (202 Node plus 3 isolated Electron activity tests, EXIT=0); roadmap validation/test and diff checks recorded after this documentation update.
- migration: agent_present artifacts now render as Answer cards in the conversation timeline (title header with block count, chevron toggle, 9rem preview / 32rem scrolling expanded body, inspect-and-export affordance opening the canonical artifact). The canonical block renderer is exported once (`RichArtifactBlockView`) and shared between Inspector and timeline — no duplicated block truth; blocks pass through unmodified, invalid payloads render nothing, and multiple present artifacts appear independently in chronological order. Tasks without present artifacts render nothing. No runtime, route, writer, schema, `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: revert the card, model, shared export and records together. Do not duplicate the block renderer in conversation code or render present content from markdown guessing.
- deletedEntries: none.
- remainingRisks: card rendering is source-contract evidence until an installed-app Run produces a real present artifact; very large tables/charts stay inside the 32rem scrolling body by design.
- unverifiedRealMachineItems: installed Electron Answer card rendering, real screenshot matrix, VoiceOver toggle announcement, signing/notarization, public mirror.

## LA-130 — Private Eval executes only via the explicit synthetic-root harness

- status: completed
- dependencies: LA-017, LA-049, LA-061
- baseCommit: `e347fdd2`
- resultCommit: `SELF`
- filesChanged: `scripts/private-eval.ts`; `tests/private_eval_harness.test.ts`; `package.json`; roadmap reality/ledger records.
- testsAdded: RED `private_eval_harness.test.ts` (6) — strict args (missing `--root`/`--adapter`, unknown option, illegal mode, usage error); production `data/` root refused (the test locates the production tree via `import.meta.url`, independent of the synthetic-root suite cwd); single parity (completed status, 2 outputs, `canonical_single_batch` manifest, `referenceIncluded:false`/`writeMode:"none"`, per-segment mechanicalQa, comparison report on disk); team parity (`canonical_team_workflow` manifest, isolated `private-eval-*` project cleaned up); generation failure fails the run with the error preserved instead of fabricating success; Stable route still 403s `private_eval_disabled_in_stable` before reading the body. All failed before implementation (module missing) and passed after; the first full-suite run caught the cwd-dependent assertion and the hardened test now passes standalone and under test-discovery.
- commandsExecuted: focused `tests/private_eval_harness.test.ts` RED then green; `tests/{eval_routes,private_eval,private_eval_canonical_single,private_eval_team_adapter,private_eval_session,eval_task_run_projection,sqlite_workflow_eval,maintainer_candidate_tool,harness_eval_smoke}.test.ts` regressions; root and Desktop typechecks; `npm run mac:test` (EXIT=0); CLI smoke `npm run eval:private run --mode single` on a throwaway synthetic root (completed, 2 outputs, report written); full root `npm test` (recorded below); roadmap validation/test and diff checks recorded after this documentation update.
- migration: Private Eval gains the explicit CI/developer entry point `npm run eval:private run --mode single|team --root <synthetic-root> --set-id <id> --label <label> --source-root <dir> --adapter synthetic --source-locale <locale> --target-locale <locale>`. The harness strictly parses arguments, refuses any root inside the production `data/` tree, and drives only canonical modules — `createPrivateEvalSet`/`createPrivateEvalRun`/`executePrivateEvalRun`/`renderPrivateEvalComparison` plus the same batch runners the production route uses (`runPrivateEvalCanonicalSingle`/`runPrivateEvalCanonicalTeam`) with the same per-segment mechanical QA, memoized single batch call, and isolated-team project lifecycle. The only synthetic boundary is the model: a deterministic no-model generate (single) and a deterministic pi-subagents-style child runner (team), both clearly marked `[synthetic]` with an explicit synthetic prompt budget. No production route/UI was reopened (Stable still 403s mutations before body parsing), no Eval history/set/run/output/scorecard/comparison was read or rewritten, and no `data/**`, customer content, credential, signing material, public mirror or managed runtime changed.
- rollback: delete the harness, its tests and the npm script together. Do not wire harness execution back into the production route/UI or point it at the production data tree.
- deletedEntries: none.
- remainingRisks: the synthetic adapter proves the canonical run/output/status contract without a model; real-model CI execution needs a future reviewed adapter (LA-131 export parity and LA-133 route removal are separate tickets); the harness does not yet support checkpoint resume.
- unverifiedRealMachineItems: real-model Eval execution, installed-app behavior, signing/notarization, public mirror.
