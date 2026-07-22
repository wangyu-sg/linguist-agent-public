# Expressive Quality Floor — Backend API Contract Spec

> Status: **Implemented backend/agent contract.** The routes and tools below are server-owned. Electron may consume their typed responses, but this document does not promise a dedicated renderer surface; route or field changes must update this spec in the same commit.
>
> Scope: **Voice Profile + Exemplar Store**, **Expressive Quality Audit**, and **Segment Constraint Pack**. The field and route claims below are checked against the current TypeScript owners and tests.
>
> Authority: this contract is the source of truth for field names, route paths, and response shapes. Frontend must not invent fields; backend must not ship a route that drifts from this spec without updating it here first.

## Design principles (bind both sides)

1. **Reuse, do not fork.** Expressive audit findings reuse the existing `QualityFinding` shape (new `code` values only). Exemplar/voice-profile are the only genuinely new data shapes. Constraint packs reuse the existing `SegmentEvidenceCard` presentation where possible.
2. **Thin client.** Electron consumes these types without parsing workbook/voice/exemplar semantics. All business logic is backend.
3. **Strings, not enums, for finding codes.** Like the existing `QualityFinding.code: string`, new expressive codes are strings so the frontend does not break when a new code is added.
4. **Exemplar ≠ TM.** TM is the consistency store (all tiers, mechanically enforced). Exemplar is the quality-ceiling store (curated clean high-quality rows only). They are separate endpoints and separate files; do not merge them.

---

## 1. Voice Profile

A batch-level, human-confirmable voice description. One profile per batch (project-scoped, batch-scoped). Establish before translating expressive content.

### `GET /api/projects/:projectId/batches/:batchId/voice-profile`

Response `200`:
```json
{
  "schemaVersion": 1,
  "projectId": "synthetic-game-project",
  "batchId": "synthetic-batch-001",
  "sourceLanguage": "zh-CN",
  "targetLanguage": "en-US",
  "status": "draft|confirmed|not_started",
  "updatedAt": "2026-07-01T00:00:00.000Z",
  "updatedBy": "model|user:alice|reviewer:bob",
  "entries": [
    {
      "id": "vp-001",
      "textType": "dialogue",
      "speaker": "虎威将军",
      "register": "elevated",
      "person": "first-person",
      "contractionLevel": "none",
      "toneMarkers": ["archaic", "commanding"],
      "taboos": ["modern slang"],
      "notes": "Speaks in short imperatives; avoids contractions."
    }
  ],
  "roster": [
    { "speaker": "虎威将军", "segmentIds": ["row-0002","row-0011"], "count": 2 },
    { "speaker": null, "segmentIds": ["row-0003"], "count": 1, "textTypes": ["ui","system"] }
  ]
}
```

Field rules:
- `status`: `not_started` (no profile yet), `draft` (model-generated, awaiting confirm), `confirmed` (human-approved; translation may proceed against it).
- `entries[].textType`: one of `dialogue | ui | skill_desc | system | lore | marketing` (matches `cat-classify` function axis).
- `entries[].speaker`: character/speaker name, or `null` for non-diegetic UI/system voice.
- `roster`: derived speaker/segment index so the frontend can show "who appears where" without re-deriving.

### `PUT /api/projects/:projectId/batches/:batchId/voice-profile`

Request body: the full `entries` array (replace strategy) OR a single entry upsert:
```json
{
  "status": "draft",
  "updatedBy": "model",
  "entries": [ { "id": "vp-001", "textType": "dialogue", "speaker": "虎威将军", "register": "elevated", "person": "first-person", "contractionLevel": "none", "toneMarkers": ["archaic","commanding"], "taboos": ["modern slang"], "notes": "..." } ]
}
```
Response `200`: the full updated voice-profile document (same shape as GET).

### `POST /api/projects/:projectId/batches/:batchId/voice-profile/confirm`

Request body: `{ "confirmedBy": "user:alice" }`
Response `200`: the voice-profile document with `status: "confirmed"`.

### `GET /api/projects/:projectId/batches/:batchId/voice-profile/roster`

Response `200`: `{ "schemaVersion": 1, "projectId": "...", "batchId": "...", "roster": [...] }`.

This is a convenience read for clients that only need the derived speaker/segment index. The full `GET /voice-profile` response also includes `roster`, so frontend flows should prefer the full profile when editing.

### Electron boundary

The current Electron renderer has no dedicated voice-profile editor. If one is
added, it must use these server routes and keep profile generation,
confirmation, and roster derivation on the backend; do not add a second local
voice state machine.

---

## 2. Voice Exemplar Store

A project-level (not batch-level) curated store of high-quality expert renderings, indexed by `(textType, speaker, register)`. Separate from TM. Used to activate the expert attractor at generation time.

### `GET /api/projects/:projectId/voice-exemplars`

Query params (all optional): `?textType=dialogue&speaker=虎威将军&limit=20`

Response `200`:
```json
{
  "schemaVersion": 1,
  "projectId": "synthetic-game-project",
  "count": 3,
  "exemplars": [
    {
      "id": "vex-001",
      "textType": "dialogue",
      "speaker": "虎威将军",
      "register": "elevated",
      "source": "尔等速退，否则军法处置。",
      "target": "Fall back at once, or face the military code.",
      "origin": "golden",
      "evidenceSource": "manual:alice:2026-07-01",
      "srcLang": "zh-CN",
      "tgtLang": "en-US",
      "createdAt": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

Field rules:
- `origin`: `golden` (manually curated) | `reviewed_tm_clean` (auto-promoted from reviewed TM rows with no L0–L1 findings) | `styleguide` (extracted from style guide examples) | `external_ref` (published expert reference, must carry URL in `evidenceSource`).
- **Exemplar entry invariant:** a row may only enter the store if it is `reviewed` AND clean (no L0–L1 defects). The backend enforces this; the frontend must surface rejected-promotion attempts as warnings, not silently drop them.

### `POST /api/projects/:projectId/voice-exemplars`

Add a single exemplar (manual golden-line entry). Request:
```json
{
  "textType": "dialogue",
  "speaker": "虎威将军",
  "register": "elevated",
  "source": "尔等速退，否则军法处置。",
  "target": "Fall back at once, or face the military code.",
  "origin": "golden",
  "evidenceSource": "manual:alice:2026-07-01"
}
```
Response `201`: the created exemplar (with assigned `id` and `createdAt`).

### `DELETE /api/projects/:projectId/voice-exemplars/:exemplarId`

Response `204`. (Curated golden lines can be removed; auto-promoted rows are re-derived.)

### `POST /api/projects/:projectId/voice-exemplars/promote-reviewed`

Promote clean reviewed-TM rows into the exemplar store. Request: `{ "batchId": "synthetic-batch-001", "maxDefectSeverity": "L1" }`
Response `200`:
```json
{
  "schemaVersion": 1,
  "projectId": "synthetic-game-project",
  "promoted": 12,
  "rejected": 3,
  "rejectedSamples": [
    { "segmentId": "row-0042", "reason": "L2 fluency finding not resolved" }
  ]
}
```
(`maxDefectSeverity` defines "clean": rows with findings at or above this severity are rejected. Default `L1`.)

### Electron boundary

The current Electron renderer has no dedicated exemplar-management panel.
Exemplar origin and promotion results remain server-owned data until a client
surface is explicitly implemented and accepted.

---

## 3. Expressive Quality Audit

Extends the existing `quality_audit` report with new finding `code` values. **No new report shape** — the existing `QualityAuditReport` gains findings with new codes. The frontend `QualityFindingRow` already renders any code string, so display is automatic.

### New `QualityFinding.code` values (string, added to the existing enum on the backend)

| code | category | default severity | authority | meaning |
|---|---|---|---|---|
| `TRANSLATIONESE_PATTERN` | style | warning | batch_consistency | A known translationese pattern was detected (literal calque, 的-overload, mechanical 进行/作出+noun, pronoun over-explicitness, source word order preserved). **Rule-based, not LLM-judged.** |
| `VOICE_INCONSISTENCY` | consistency | warning | batch_consistency | Same `(text_type, speaker)` segments diverge in voice markers (person, contraction level, sentence-length distribution) vs the confirmed voice profile. |
| `REGISTER_MISMATCH` | style | warning | batch_consistency | Segment register does not match the voice-profile register for its `(text_type, speaker)`. |

Severity threshold: these default to `warning` (advisory), not `blocker`, to avoid false-positive delivery blocks from rule-based literalness detection. The backend owns any future project-specific threshold; clients display the returned `severity` and do not reinterpret it.

### `GET /api/projects/:projectId/batches/:batchId/quality`

Unchanged route. The response `QualityAuditReport` now may contain findings with the new codes above. `finding.category` will be one of `terminology | consistency | accuracy | style | formatting` (the existing union — `style` already exists). No new field.

### `POST /api/projects/:projectId/batches/:batchId/quality/waivers`

Unchanged. Waiving a `TRANSLATIONESE_PATTERN` finding works identically to waiving a `TERM_PREFERRED_MISSING` finding (same `QualityFindingWaiver` shape, same `recordQualityFindingWaiver` validation). The frontend `acceptQualityFinding` flow needs **no change**.

### Electron boundary

`PipelineWorkspace` already renders arbitrary `QualityFinding.code` values and
the typed quality route; no separate expressive-quality renderer model is part
of the current client contract. The renderer must keep treating finding codes
and severities as server data.

---

## 4. Segment Constraint Pack

A per-segment, generation-time constraint summary. The backend assembles it from TM/TB/glossary/duplicate-group/tag/placeholder/number/project-tag-rule/voice evidence. It is **primarily consumed by the agent at generation time**, but is also exposed read-only so the user can see "what constraints govern this segment" and so QA findings can trace back to a constraint.

> **Tag-format scope:** baseline `tag_signature` and `placeholder` constraints reuse the same `phraseInlineTagSignature` / `phrasePlaceholderSignature` the delivery gate uses, so constraint packs and the export gate see the same structural tokens (Phrase `<color>`/`<bpt>`/`<g>`, `{0}`/`{N>}` runtime placeholders). Project-specific formats such as `[27CA28]...[-]#r` are not fabricated by the generic signature scan; once the user confirms them through project tag rules (`tag_rule_discovery`), `constraint_pack` adds them as `tag_signature` blockers with `authority: "project_tag_rule"`.

### `GET /api/projects/:projectId/batches/:batchId/segments/:segmentId/constraint-pack`

Response `200`:
```json
{
  "schemaVersion": 1,
  "projectId": "synthetic-game-project",
  "batchId": "synthetic-batch-001",
  "segmentId": "row-0002",
  "textType": "dialogue",
  "speaker": "虎威将军",
  "voiceProfileEntryId": "vp-001",
  "constraints": [
    { "kind": "terminology", "sourceTerm": "天关", "requiredTarget": "Celestial Gate", "evidenceSource": "termbase:tb-0042", "authority": "termbase", "severity": "blocker" },
    { "kind": "terminology", "sourceTerm": "帮派", "requiredTarget": "Guild", "evidenceSource": "glossary:glossary.csv:18", "authority": "glossary", "severity": "blocker" },
    { "kind": "exact_tm", "tmId": "tm-123", "requiredTarget": "The Celestial Gate opens at dawn.", "evidenceSource": "tm:tm-123", "authority": "reviewed_tm", "severity": "blocker" },
    { "kind": "duplicate_group", "duplicateKey": "dk-7", "siblingSegmentIds": ["row-0044","row-0088"], "severity": "warning" },
    { "kind": "tag_signature", "requiredSignature": ["<a^","^a>"], "severity": "blocker" },
    { "kind": "tag_signature", "requiredSignature": ["[27CA28]","[-]","#r"], "authority": "project_tag_rule", "severity": "blocker" },
    { "kind": "voice", "voiceProfileEntryId": "vp-001", "severity": "advisory" }
  ],
  "summary": {
    "blockerConstraints": 3,
    "warningConstraints": 1,
    "advisoryConstraints": 1
  }
}
```

Field rules:
- `constraints[].kind`: `terminology | exact_tm | fuzzy_tm | duplicate_group | tag_signature | placeholder | number | voice`.
- `constraints[].severity`: `blocker | warning | advisory`. `blocker` = a deterministic gate will reject a target that violates it; `advisory` = voice/register, not machine-gated.
- `constraints[].authority`: for `terminology`, currently `termbase` or `glossary`; for project-specific tag signatures, `project_tag_rule`.
- `voiceProfileEntryId`: links to the voice profile entry governing this segment (`null` if no confirmed profile or non-expressive text).

### Batch-level endpoint (agent convenience, reuses evidence_pack infrastructure)

### `GET /api/projects/:projectId/batches/:batchId/constraint-packs`

Returns an array of per-segment constraint packs (same per-segment shape, batched). Batch packs are for deterministic generation blockers: termbase, glossary, exact TM, duplicate groups, tags/placeholders, numbers, and confirmed voice. Fuzzy TM is intentionally not batch-expanded into hard constraints; it remains selected-segment advisory evidence and can appear in per-segment constraint snapshots. Query params: `?onlyFlagged=true` to restrict to term-sensitive/flagged rows.

Response `200`:
```json
{
  "schemaVersion": 1,
  "projectId": "...",
  "batchId": "...",
  "checkedAt": "...",
  "summary": { "totalSegments": 653, "segmentsWithConstraints": 412, "blockerConstraints": 38, "warningConstraints": 90, "advisoryConstraints": 120 },
  "segments": [ /* per-segment constraint pack objects */ ]
}
```

### Electron boundary

The current client has no dedicated batch constraint-pack browser. Generic
Inspector content may display persisted constraint data, but fetching,
aggregation, and authority remain server-owned; the renderer must not parse CAT
assets or rebuild TM/TB/glossary matching locally.

---

## 5. New CAT tools (backend registers; frontend unaffected)

These backend tools are consumed by the agent; they do not define a separate
client-side implementation. They are listed for contract completeness.

| tool | access | modes | purpose |
|---|---|---|---|
| `voice_profile_build` | write | translate, maintenance | Generate a draft voice profile (roster + entries) from batch source sampling. |
| `voice_profile_confirm` | write | translate, edit, maintenance | Flip voice profile status to confirmed. |
| `exemplar_lookup` | read | translate, edit, proof | Retrieve top-N exemplars for a `(textType, speaker, register)` for injection. |
| `exemplar_add` | write | translate, edit, maintenance | Add a manual golden-line exemplar. |
| `constraint_pack` | read | translate, edit, proof, delivery | Build the per-segment or batch constraint pack. |
| `expressive_audit` | read | translate, edit, proof, delivery | Run the expressive-layer audit (translationese + voice consistency + register mismatch), producing `QualityFinding` rows with the new codes. Allowed in `translate` so first-pass drafts can be checked immediately, mirroring `quality_audit`'s translate-mode exposure. |

These follow the existing `CAT_TOOL_METADATA` invariant (metadata == registered tools) enforced by `tests/tool_catalog.test.ts`.

---

## 6. Contract change protocol

- Field/route changes to this spec **require** updating this document in the same commit that ships the backend change.
- The frontend must not depend on a field not documented here.
- Additive changes (new optional fields, new finding codes) are non-breaking; the frontend ignores unknown string fields by default (Decodable).
- Breaking changes (renamed/removed fields, changed route paths) require a `schemaVersion` bump and a coordinated frontend update — surface in `CHANGELOG.md` under the version that breaks.

---

## 7. Verification

The current contract is exercised by the TypeScript owners and tests:
`tests/voice_route.test.ts`, `tests/constraint_pack.test.ts`,
`tests/expressive_audit.test.ts`, and `tests/tool_catalog.test.ts`. Electron
renderer acceptance is separate; this document must not be used to claim a
dedicated voice, exemplar, or constraint-pack UI exists.
