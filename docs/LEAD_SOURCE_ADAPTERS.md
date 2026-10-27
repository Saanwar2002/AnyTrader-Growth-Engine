# Lead-source adapter contract

## Purpose and current scope

The roadmap calls for provider-neutral source adapters. This defines the initial contract only: it does not connect a provider, perform scraping, fetch leads, or claim any source is approved. Implementation is in `functions/src/lead-source-adapter.ts`; tests use synthetic manifests only.

## Required manifest

Every future adapter must declare a stable source ID and display name, the provider's HTTPS terms/policy URL, review status, and bounded request/record limits plus an allowlist of lead fields that includes `businessName`. Approval additionally requires an ISO-8601 review timestamp, human reviewer reference, an ISO-8601 `approvalExpiresAt` later than the review and current validation time, and explicit `business_provider_recruitment` purpose. Expired approval fails closed and must be renewed after a fresh human review.

Validation rejects insecure terms URLs, embedded URL credentials, missing review evidence, unsupported/duplicate fields, and limits outside documented bounds. The run gate fails closed unless review status is approved and the manifest is valid.

## Controls before connecting a provider

1. Review provider terms and API documentation for the exact intended use; do not bypass authentication, access controls, robots rules, or rate limits.
2. Record permission/lawful-basis and privacy review for purpose, fields, geography, retention, and contact channel. Technical approval is not legal advice or proof of lawful use.
3. Keep credentials server-side in a secret manager; never expose them to Vite/browser code or commit them.
4. Implement provider-specific rate limiting, bounded pagination, timeout/retry policy, provenance, and data minimisation.
5. Keep imported records suppressed and pending human review. No adapter may trigger outreach or bypass contact restrictions.
6. Test only provider-approved sandbox fixtures or synthetic data. Do not connect to live sources until a concrete provider integration is reviewed.

## Provenance and status

The contract defines provenance fields (source ID/name, terms URL, collection timestamp, optional provider record ID). Provider record IDs must be unique within each attributed result batch after trimming. Collection timestamps must be valid ISO-8601 UTC values and cannot be later than the validation clock. Persisting provenance to lead documents is a separate schema/API task and must be reviewed before it is wired into import flows.

- Contract and manifest validation: implemented with unit tests.
- Provider API clients and persisted provenance: not implemented.
- Real-source permission review: not performed.
- Live data access, production configuration, outreach sending: not enabled.


## Candidate output validation

The adapter contract also exposes a pure `attributeLeadSourceCandidates` boundary. It requires an approved manifest, checks the collection timestamp, enforces the configured maximum record count, rejects malformed candidates and fields outside the reviewed allowlist, applies field-length bounds, trims accepted strings, and attaches source provenance. This function is not a provider client and does not write to the database; import, deduplication, suppression, and human review remain separate gates.


## Bounded page request and result contract

The shared `lead-source-adapter.ts` module also provides `validateLeadSourcePageRequest` and `validateLeadSourcePageResult`. Both require a runnable, currently approved manifest. Requests trim and bound the discovery category and location, and constrain `limit` to `maxRecordsPerRun`; unrelated request properties are dropped. The adapter interface exposes `discoverPage` with an optional opaque cursor and returns a bounded page envelope rather than an unbounded candidate array. Results require an array bounded by the same configured maximum, copy the records array, and preserve only the optional `nextCursor`. These helpers validate the page envelope only. Provider record validation and `attributeLeadSourceCandidates` remain responsible for allowlisted fields and provenance; persistence, deduplication, suppression, and human review remain separate gates.


## Import-boundary source record IDs

The authenticated `importLeads` callable now accepts an optional `sourceRecordId` on each row, bounds it to 200 non-whitespace characters, and persists it with the imported lead. The ID is included in idempotency hashing and replay integrity checks when supplied. It is an externally reported record identifier, not proof that a provider was approved or that the data is lawful to use. The server continues to derive the actor and timestamps, use the closed source-label enum, deduplicate transactionally, and keep imported leads suppressed pending human review. Existing imports without a source record ID retain their legacy idempotency hash.


## Import record identifiers

The `importLeads` callable accepts an optional per-row `sourceRecordId` (1–200 non-whitespace characters). It is persisted on the lead and exposed by the bounded lead listing. When present, it participates in the idempotency hash, is included in the saved replay result, and must still match the persisted lead on replay. This is traceability metadata supplied by the importer; it is not independently verified provider evidence or an approval signal. Imports without the field retain their legacy request hash and replay shape.


The CSV preview recognises an optional `sourceRecordId`, `providerRecordId`, or `externalRecordId` column. It preserves a bounded value through explicit import confirmation and omits the field when blank. Multiple alias columns or values longer than 200 characters are rejected/skipped rather than guessed.


When present, a lead's source record ID is shown in the lead directory and included in its text search. It is displayed as traceability metadata alongside the self-declared source label; the UI does not imply independent verification.


Lead CSV exports include the optional source record ID as a separate column. Missing legacy values export as an empty cell. The value passes through the same spreadsheet-formula protection as other exported data; it remains traceability metadata and is not independently verified.


During CSV review, the preview table displays each row's optional source record ID before the user confirms the import. Blank values are shown as an em dash and remain absent from the submitted payload. This helps spot mapping errors but does not verify source authenticity.


Manual lead creation accepts the same optional `sourceRecordId` as CSV import, bounded to 200 non-whitespace characters. The ID participates in manual-create idempotency and replay-integrity checks only when supplied; older requests without it retain their legacy request hash. It is traceability metadata, not provider approval evidence.
