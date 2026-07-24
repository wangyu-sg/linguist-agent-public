# ADR 0001: SQLite storage boundary

- Decision: `LA-062`
- Status: Accepted
- Date: 2026-07-23
- Authority: user/architecture owner

## Context

LA currently stores canonical structured truth across JSON and JSONL files. LA-021 supplies one `dataRoot` writer lease and LA-022 makes selected critical file transactions durable, but those controls do not make multi-entity updates transactional. Source inventory confirms that Task events/snapshots, decisions, grants, settings, Package state, memory, Library metadata and CAT truth still have separate writers.

No real `data/**` was read for this decision. Real installation size, largest Task/Project, corruption distribution, backup duration and write amplification remain unknown. This limits migration and release claims, but it does not block a synthetic, non-production foundation.

## Decision

1. SQLite WAL will become the sole canonical writer for structured product truth after each domain passes its migration and cutover gate. The intended scope includes Task, Run, Event, Decision, Grant, Settings, Package registry, Confirmed Memory, Library metadata and structured CAT records.
2. Large or immutable payloads use a SHA-256 content-addressed blob store. Original customer/source assets remain files and are retained until their domain parity and rollback window close. Secrets and provider credentials never enter SQLite or blobs.
3. JSONL remains a generated audit/export format. It is not a second writer or alternate canonical store.
4. Backup is one consistent SQLite snapshot plus a verified blob manifest taken under the canonical writer authority. Copying a live database without its WAL is forbidden.
5. Migration is domain-by-domain: inventory, backup, import, replay/rebuild, parity comparison, single cutover, then old storage read-only. Permanent dual write is forbidden.
6. Rollback switches the whole affected domain to its verified pre-cutover backup/read-only implementation. Old readers remain for at least one stable compatibility window; old writers do not remain active beside SQLite.
7. Schema migrations are ordered and versioned, run transactionally where SQLite permits, require a preflight backup for production data, and fail closed before writes if validation or migration fails.

## Ticket boundaries

- `LA-023` may create only a synthetic SQLite WAL event/projection foundation. JSON/JSONL remains production canonical and no real data is read or migrated.
- `LA-024` must be split into executable child Tickets for Task/Run/Decision inventory, import, replay/parity, cutover and rollback.
- `LA-025` must be split by CAT, Library, Memory, Package and blob domains. Each domain proves parity before its single-writer cutover.
- G4 cannot pass without migration parity, backup/rollback evidence, JSONL export evidence and proof that no permanent dual write remains.

## Rejected alternatives

- Keeping JSON/JSONL as permanent canonical truth does not solve cross-entity transactions.
- Using SQLite only as a derived index leaves the existing multi-writer authority unchanged.
- Storing every large asset inside SQLite expands backup and write costs without improving structured transactions.

## Remaining evidence gates

Before any production cutover, use synthetic fixtures and explicitly authorized non-customer samples to measure database/blob size, import and backup duration, recovery time, WAL growth and export parity. Real `data/**` remains out of scope until separately authorized.
