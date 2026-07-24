# G2 Runtime Contract Gate Report

Date: 2026-07-22

Baseline: `64bcb15bed78a5d71d91d791948b7652987267d5`

Candidate at first Gate attempt: `39074d3f`

Candidate after repair: `5c4e38c2`

Scope: Phase 1 runtime contracts only; synthetic/temp fixtures only; public mirror untouched.

## Current result

**PASS — Phase 2 may begin.**

LA-067 removed the Node strip-only-incompatible constructor parameter property without changing the Task schema, transition rules, error code, stored data, or product behavior. A direct Desktop regression now imports and exercises the canonical Task contract under Node's strip-only loader.

The first failed attempt remains recorded below. It was not reclassified as a pass and no test was disabled or moved to a more permissive loader.

## Successful Gate evidence

- `npm test`: passed; 174 root tests automatically discovered and executed.
- `npm --prefix apps/desktop test`: passed; 150 Desktop tests plus 3 activity-producer tests.
- `npm run mac:test`: passed, including the Desktop suite and Desktop typecheck.
- `npm run test:security`: passed; 20 selected security tests.
- `npm run test:recovery`: passed; 8 selected recovery tests.
- `npm run typecheck`: passed.
- `npm --prefix apps/desktop run typecheck`: passed.
- `npm run roadmap:validate`: passed.
- `npm run roadmap:test`: passed.
- `npm run release:check`: passed.
- `git diff --check`: passed.

Managed E5 acceptance remained explicitly skipped because its pack is absent. This Gate does not claim real-provider, packaged-app, accessibility, signing, notarization, or customer-data evidence.

## First Gate attempt and retained failure evidence

The root suite passed all 174 automatically discovered tests, but the first Desktop Gate command failed. Nine Desktop tests import the canonical Task contract through Node's strip-only TypeScript loader. LA-008 introduced a constructor parameter property in `TaskRunTransitionError`; Node 22 rejects that syntax before the tests can run:

```text
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:
TypeScript parameter property is not supported in strip-only mode
```

The failure is a shared-contract compatibility regression, not evidence that those nine product assertions failed. It is also not safe to ignore: Desktop is a maintained consumer of the canonical backend contract.

### Evidence before the repair

- `npm test`: passed; 174 root tests discovered and executed.
- `npm --prefix apps/desktop test`: failed; 89 passed and 9 failed to load because of the shared parameter property.
- Focused LA-008 through LA-013 tests and root/Desktop typechecks had passed before the Gate.
- Managed E5 acceptance remained explicitly skipped because its pack is absent.

Commands after the failing Desktop command were not used to claim a Gate pass. No `la-g2-runtime-contract` tag was created.

### Repair ticket outcome

LA-067 completed in commit `5c4e38c2`. It:

1. preserve the LA-008 transition table and error fields;
2. replace only Node strip-only-incompatible syntax at the shared contract boundary;
3. added a direct strip-only import regression;
4. passed root, Desktop, mac, roadmap, release, typecheck, and diff checks before this report became PASS.

The repair must not disable tests, switch Desktop tests to a different loader merely to hide the incompatibility, or alter Task schema/product behavior.

## Boundaries

- No runtime schema or user-data migration ran.
- No dual write was introduced.
- No `data/**` path was read or modified.
- The public mirror and remote were not read, modified, or pushed.
- LA-059 remains a blocked license Decision.
- No uncontained Phase 0/1 P0 was introduced. R-002 remains explicitly contained by the LA-002 process-wide coordinator and must not be considered closed until the LA-017 per-Run isolation Epic is decomposed and completed before G3.
- The old runtime/session factories remain migration inputs; their deletion gates are not yet satisfied.
