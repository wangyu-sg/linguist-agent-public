# Real Alpha Harness

Historical/current utility note for the non-agent deterministic real-project harness.

`npm run alpha:real` exercises LA CAT data/tool primitives against ignored runtime project data. It is useful for proving onboarding, asset indexing, delivery checks, exports, and report generation without committing customer files.

Current product work has moved beyond the original alpha phase. Use this file only when running or maintaining the harness.

## Boundary

- Runtime project data stays under ignored `data/`.
- Reports are written under ignored `data/reports/`.
- The harness does not replace Pi sessions or the product UI.
- Delivery safety still depends on the same CAT data/tool code used by Pi tools.
- `rc:regression` creates two synthetic Phrase batches (`b1`, `b2`) so the full Delivery envelope can be exercised in an isolated checkout without reading customer source files.

## Related Current Gates

- `npm run rc:regression`
- `npm run rc:status`
- `npm run rc:gate`
- `npm run primary:readiness`
- `npm run completion:audit`

The primary-use and completion reports intentionally avoid source-string checks. Repository tests, Electron client tests, and shared TypeScript fixtures own behavior and decoding; these reports summarize real exports, audit records, risk state, runtime health, and tracked-data safety.
