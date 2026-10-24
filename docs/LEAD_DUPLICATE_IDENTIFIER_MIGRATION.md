# Lead duplicate identifiers: migration and rollout plan

## Current implementation

Lead writes normalize email addresses to lowercase and normalize website scheme/host while preserving URL path casing. They now persist `dedupeEmailKey` and `dedupeWebsiteKey` alongside user-facing contact fields. Manual lead creation, CSV import, and contact edits all use `normaliseLeadFields`, so the keys are maintained by the shared normalization path.

CSV import uses tenant-scoped, bounded equality queries against canonical keys and also exact-value equality queries against legacy `email` and `website` fields. It does not scan the organisation's entire lead collection. Single-field Firestore indexes are expected to serve these equality queries.

## Important legacy limitation

The exact-value fallback protects records whose legacy values exactly match normalized incoming values. It cannot reliably find older records whose email casing or URL scheme/host casing differs, and it cannot manufacture canonical keys for old documents. Therefore **duplicate protection across all pre-existing records is not complete until a backfill has run and been verified**.

Do not describe the new key fields as a complete legacy deduplication solution before that backfill. Imported leads must remain suppressed and pending human review.

## Canonicalization policy

- Email: trim and lowercase for matching, consistent with the application's current product policy.
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

`functions/src/lead-identifier-migration-audit.ts` provides a pure, read-only analyzer for a bounded set of records already fetched by a caller. It reports missing/stale key record IDs, malformed website record IDs, and duplicate groups. Collision identifiers are represented by SHA-256 fingerprints so reports do not expose raw emails or websites. The helper does not connect to Firestore, paginate collections, write data, or run a migration; a future adapter must enforce per-organisation scoping and explicit page limits before passing records to it. Tests cover legacy gaps, collisions, URL path-case distinctions, deterministic output, and contact-data redaction.

## Regression coverage

The callable security contract test asserts that all write paths share normalization, canonical key lookups remain bounded, legacy exact-value fallbacks remain present, and URL path casing is explicitly preserved. Add behavioral emulator tests for mixed-case legacy records and URL edge cases when the migration/backfill harness is introduced.
