# Release Candidate

The RC gate is the delivery-safety track for the current `2.x` product.

## What It Proves

`npm run rc:gate` verifies the repository contracts and, when given an isolated or real customer-like project with at least two batches, exercises the production Delivery envelope.

The gate includes:

- typecheck
- the complete root TypeScript test suite
- Electron client tests and packaged-ASAR verification through the `mac:test`
  and `mac:verify` commands
- runtime health
- version/document synchronization
- a sanitized two-batch RC regression
- RC status
- known P0/P1 risk gate
- RC readiness, beta export, primary-use readiness, and completion audit when `--project` and two `--batch` arguments are supplied

Primary-use and completion reports consume real reports, export audits, risk state, and runtime behavior. They do not search frontend source for labels or symbol names to claim that a feature exists. The full TypeScript/backend suite, Electron client tests, and contract fixtures own those behavior checks.

## Current Rule

Green RC claims require explicit two-batch delivery evidence. Running `rc:gate` without `--project` and two `--batch` values intentionally fails, so a clean checkout cannot self-certify production readiness without exercising export and audit paths.

`npm run rc:regression -- --project <isolated-id>` prepares a fully synthetic project with batches `b1` and `b2`. It writes only below that checkout's ignored `tmp/` and `data/` roots. For final verification, run it in an isolated worktree or data copy, then pass that project to `rc:gate`. Never point the gate at an original customer source directory merely to obtain release evidence.

```bash
npm run rc:regression -- --project rc-isolated-final
npm run rc:gate -- --project rc-isolated-final --batch b1 --batch b2
```

## Risk Register

`docs/KNOWN_RISKS.md` is the risk source consumed by RC scripts.

- Open P0/P1 risks fail RC.
- Closed P0/P1 risks pass.
- P2/P3 monitoring items do not fail RC, but they must remain visible.
- The register must not be empty; an empty register is treated by completion audit as unverified.

## Reports

RC reports are written under ignored runtime `data/reports/`. Do not commit customer runtime reports. A durable report may be committed only after it has been generated from the synthetic fixture and reviewed for path/content disclosure.
