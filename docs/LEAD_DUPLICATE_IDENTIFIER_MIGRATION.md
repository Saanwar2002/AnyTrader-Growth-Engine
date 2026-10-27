# Lead duplicate identifiers: migration and rollout plan

## Current implementation

Lead writes normalize email addresses to lowercase, normalize website scheme/host while preserving URL path casing, and canonicalize the business-name/location pair. They persist `dedupeEmailKey`, `dedupeWebsiteKey`, and `dedupeBusinessLocationKey` alongside user-facing contact fields. Manual lead creation, CSV import, and contact edits all use `normaliseLeadFields`, so the keys are maintained by the shared normalization path.

CSV import uses tenant-scoped, bounded equality queries against canonical email, website, and business/location keys and exact-value fallbacks against legacy contact fields and the business-name/location pair. It does not scan the organisation's entire lead collection. Single-field Firestore indexes are expected to serve canonical-key equality queries; the legacy business-name/location fallback is a bounded compound equality query. Manual lead creation and contact edits now use the same shared guard: bounded, organisation-scoped canonical-key queries plus exact-value legacy fallbacks. Contact edits exclude the current lead from conflict results and reject conflicts before mutating contact fields, review state, activity, audit events, or quota.

## Important legacy limitation

The exact-value fallback protects records whose legacy values exactly match normalized incoming values. It cannot reliably find older records whose email casing, URL scheme/host casing, or business-name/location casing/spacing differs, and it cannot manufacture canonical keys for old documents. Therefore **duplicate protection across all pre-existing records is not complete until a backfill has run and been verified**.

Do not describe the new key fields as a complete legacy deduplication solution before that backfill. Imported leads must remain suppressed and pending human review.

## Canonicalization policy

- Email: trim and lowercase for matching, consistent with the application's current product policy.
- Business/location: trim each value and lowercase each independently, then serialize the pair as a JSON tuple so delimiter characters cannot alias distinct businesses or locations.
- Website: accept only the existing safe HTTP(S)/plain-domain forms; normalize scheme and host through URL parsing; remove the root `/` from the stored normalized form; preserve path, query, and fragment casing/content.
- Do not lowercase a complete URL. Path segments can be case-sensitive.
- Do not collapse a trailing slash on a non-root path: `/Directory` and `/Directory/` may be different resources.
- Duplicate checks remain scoped to one organisation.

## Safe backfill and rollout sequence

1. Deploy the code that writes canonical keys on every lead creation/contact-edit path and queries both canonical keys and legacy exact values.
2. Build a dry-run migration using paginated, bounded reads of each organisation's lead collection. Compute keys with the same normalization rules as the server. Report malformed records and collisions; do not silently merge or delete records.
3. Review collision reports with an operator. Keep existing records; mark ambiguous groups for human resolution. Do not trigger outreach during migration.
4. Backfill only missing/stale `dedupeEmailKey` and `dedupeWebsiteKey` fields in bounded batches, with progress checkpoints, retry safety, and per-organisation scoping. Use a separate migration identity with minimum required permissions.
5. Re-run the dry-run/collision report after backfill and verify counts, failed writes, and sample URL path-case distinctions.
6. Only after the backfill is verified should the team claim canonical duplicate detection covers legacy records. Retain exact-value fallback until there is evidence it can safely be removed.
7. Run the full CI suite and review the migration report before any production rollout. No production migration or outreach is authorized by this document.

## Read-only audit helper

`functions/src/lead-identifier-migration-audit.ts` provides a pure, read-only analyzer for a bounded set of records already fetched by a caller. It reports missing/stale email, website, and business/location key record IDs, malformed website record IDs, and duplicate groups for all three canonical identifier types. Collision identifiers are represented by SHA-256 fingerprints so reports do not expose raw emails, websites, business names, or locations. The helper does not connect to Firestore, paginate collections, write data, or run a migration; a future adapter must enforce per-organisation scoping and explicit page limits before passing records to it. Tests cover legacy gaps, collisions, URL path-case distinctions, deterministic output, and contact-data redaction.

## Bounded dry-run coordinator

`functions/src/bounded-lead-identifier-audit.ts` adds a generic read-only pagination coordinator for a caller-provided data adapter. It requires an explicit tenant ID and `dryRun: true`, limits page size to 500, enforces a global record budget, detects repeated cursors, rejects empty continuation pages and oversized pages, and reports whether the scan was truncated. It has no write adapter and does not itself access Firestore. A future adapter must apply the supplied tenant scope to every query and use a stable cursor; do not run it against a live database until the dedicated Growth Engine Firebase project and access controls have been reviewed. Automated tests cover scope, bounds, pagination, truncation, malformed adapters and repeated cursors.

## Regression coverage

The callable security contract test asserts that all write paths share normalization, canonical key lookups remain bounded, legacy exact-value fallbacks remain present, and URL path casing is explicitly preserved. The pure audit tests cover missing/stale business-location keys, canonical business/location collisions, and redaction of business names and locations in addition to email/website checks.


## Scan readiness contract

The bounded coordinator returns explicit `scanCompleteness` and `backfillDecision` fields in addition to the legacy `truncated` flag:

- `scanCompleteness: "truncated"` means the record budget was reached while a continuation cursor remained. The report is partial and cannot be used as a complete inventory.
- `scanCompleteness: "complete"` means the adapter reached the end within the configured budget; it does **not** mean the records are safe to backfill.
- `backfillDecision` remains blocked for both outcomes. Truncated scans return `blocked-incomplete-scan`; complete scans return `blocked-pending-operator-review`.
- The coordinator deliberately has no mechanism to approve, mutate, or backfill records. Collision groups, malformed records, tenant scope, source permissions, and the post-backfill verification plan still require review before any future write-enabled migration is designed.

This is a code-level guardrail, not production migration approval. No live database adapter or production backfill is included; the rehearsal below is emulator-only.


## Emulator-only backfill harness

`functions/scripts/backfill-lead-identifiers.mjs` implements the first write-capable rehearsal of the backfill sequence, but it is deliberately **local-emulator-only**. It refuses to start unless the project is `demo-growth-engine-test` and `FIRESTORE_EMULATOR_HOST` is localhost/127.0.0.1 on port 8080. It cannot be used to mutate a cloud project.

Run from the repository root after building Functions and starting the local Auth/Functions/Firestore emulators:

```bash
npm --prefix functions run build
node functions/scripts/backfill-lead-identifiers.mjs --organisation-id <organisationId> --page-size 100 --max-records 5000
```

The default is read-only. To rehearse writes against emulator data, add both `--apply --confirm-apply`. The tool pages through one organisation's leads ordered by document ID, caps page size at 200 and the scan at 20,000 records, and reports only record IDs and SHA-256 fingerprints—not raw emails, websites, business names, or locations. It updates only the three canonical key fields; it never merges/deletes leads, changes suppression state, sends outreach, or changes quotas.

Apply mode fails closed when the scan reaches its record budget, any malformed source identity is found, or any canonical email, website, or business/location collision exists. Resolve the report and rerun a complete dry run before rehearsing apply. A scan that reaches the exact record budget is conservatively marked truncated; increase the budget and rerun rather than assuming it was complete.

`functions/scripts/seed-emulator-legacy-lead.mjs` creates a synthetic mixed-case legacy record for the emulator smoke suite. CI seeds it, runs the backfill harness, and verifies a subsequent import skips it through canonical indexed lookups.

**This is not a production migration tool.** Legacy cloud records remain only partially covered until a separately reviewed, project-specific migration adapter is approved, run with least-privilege credentials, and verified against a complete pre/post audit. No live database migration or production rollout is authorized by this harness.
