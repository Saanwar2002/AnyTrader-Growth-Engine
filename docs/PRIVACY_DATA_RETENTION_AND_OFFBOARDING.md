# Privacy, Data Retention, and Organisation Offboarding

**Status: implementation specification — not a production control or legal opinion.** The Growth Engine remains a local demo MVP until the dedicated Firebase project and production gates are completed. This policy does not authorise deleting live data and no deletion is performed by this document.

## Goals and non-negotiable safety rules

- Keep each operation scoped to one explicitly selected organisation and verify the caller's current server-side membership and owner/admin authority.
- Make a deletion preview (dry run) the default. A preview must be read-only, bounded, paginated, and return counts and opaque identifiers only; never return lead contact details in the preview.
- Require a separate, explicit confirmation step tied to the organisation ID and a short-lived preview/version token before any future destructive execution.
- Do not implement an unbounded recursive delete or trust a client-provided list of document paths.
- Do not silently delete security evidence subject to an incident investigation, legal hold, or an approved retention obligation.
- Do not treat Firebase Authentication account deletion as equivalent to organisation/data deletion.
- Never run deletion against the original AnyTrader Firebase project. Use synthetic emulator fixtures until the dedicated Growth Engine project is approved.

## Data inventory to verify before implementation

The current backend uses organisation-scoped Firestore records and server-generated security audit events. Before enabling any deletion workflow, maintain an inventory verified against the deployed schema:

| Data category | Proposed offboarding treatment | Safeguard |
| --- | --- | --- |
| Organisation profile and memberships | Remove only after owner transfer or a verified final-owner workflow | Block deletion while ownership is ambiguous; re-check membership at execution |
| Leads and contact/review/suppression fields | Delete or irreversibly anonymise according to the approved retention schedule | Scope to selected organisation; preserve no contact details in preview/logs |
| Campaigns and import/idempotency records | Delete with their owning organisation where no retention hold applies | Explicitly inventory nested and top-level collections; do not infer descendants |
| Outreach drafts | Delete; never send as part of offboarding | Draft-only remains in force; do not copy message bodies into audit events |
| Product activity history | Delete or minimise under the approved schedule | Separate from the security audit trail |
| Security audit events | Retain only for a documented purpose and finite approved period, subject to legal hold | Minimise personal data; apply restricted access and reviewed retention |
| Rate-limit/quota state | Expire/delete when no longer needed for abuse prevention or incident review | Use the actual schema and explicit expiry field; TTL is asynchronous |
| Authentication account | Delete only after determining whether the user belongs to other organisations | Do not remove shared user access or orphan other tenants' data |

This inventory is a checklist, not a claim that every category currently exists as a separate collection. The implementation must reconcile the table against actual code and Firestore data before using real data.

## Schema-backed inventory from the current server implementation

The following collection paths were verified in `functions/src/index.ts` on `main` during this review. This is a source-code inventory, not proof that production data exists or that no legacy/manual collections exist.

| Verified path | Data purpose / offboarding consideration |
| --- | --- |
| `organisations/{organisationId}` | Tenant profile; do not remove until ownership and membership handling are defined. |
| `organisations/{organisationId}/members/{uid}` | Tenant membership and role records; final-owner transfer/removal must be explicit. |
| `organisations/{organisationId}/campaigns/{campaignId}` | Campaign setup and state. |
| `organisations/{organisationId}/leads/{leadId}` | Lead records, potentially including business contact details, notes, suppression and review fields. |
| `organisations/{organisationId}/leadIdentifierReservations/{reservationId}` | Hashed identifier reservation IDs and owning lead IDs used to serialize duplicate-sensitive writes. Do not store raw contact identifiers in reservation documents; include this collection in offboarding inventory and retention review. |
| `organisations/{organisationId}/leadActivities/{activityId}` | Product activity history; may contain resource identifiers and must be inspected for user-entered or identifying fields before retention decisions. |
| `organisations/{organisationId}/outreachDrafts/{draftId}` | Unsent outreach drafts; draft bodies may contain personal/business data. Deletion must never send drafts. |
| `organisations/{organisationId}/securityAuditEvents/{eventId}` | Minimal server-generated security audit events; retention/legal-hold rules must be decided separately from tenant content deletion. |
| `organisations/{organisationId}/campaignCreationIdempotency/{key}` | Retry/idempotency records scoped to campaign creation. |
| `organisations/{organisationId}/memberAdditionIdempotency/{key}` | Retry/idempotency records for membership changes; include in the organisation-scoped offboarding inventory. |
| `organisations/{organisationId}/importIdempotency/{key}` | CSV-import retry records. |
| `organisations/{organisationId}/leadCreationIdempotency/{key}` | Manual lead-creation retry records. |
| `organisations/{organisationId}/outreachDraftCreationIdempotency/{key}` | Draft-creation retry records. |
| `organisationCreationIdempotency/{key}` | Root-level organisation-creation retry records keyed from caller and request key; cannot be blindly deleted with a single organisation. |
| `rateLimits/{key}` | Root-level rate-limit/quota state; cleanup needs its own expiry and abuse-investigation rules. |

Before implementation, inspect every field written to `leadActivities`, each idempotency record, and any additional collections created outside `functions/src/index.ts`. Do not assume Firestore parent-document deletion removes subcollections: any future job must explicitly enumerate each allow-listed path and verify completion. Root-level records must not be attributed to a tenant unless their schema proves the relationship.

## Required workflow before any destructive implementation

1. **Request:** authenticated owner/admin selects an organisation and a stated reason. Do not accept a client-supplied arbitrary path, collection name, or deletion count.
2. **Authorise:** verify Firebase identity, current organisation membership, role, organisation status, and owner-transfer rules on the server. Revalidate at execution, not only during preview.
3. **Preview:** enumerate a fixed allow-list of known collections in bounded pages. Return per-category counts, a continuation state if incomplete, and a snapshot/version marker. If any category cannot be fully enumerated, label the preview incomplete and refuse execution.
4. **Review:** show the exact organisation identifier and consequences; require a separate explicit confirmation. The preview token must be short-lived, bound to the caller, organisation, category inventory/version and counts, and protected against replay.
5. **Execute:** use a server-side job with a strict page/item/time budget, idempotent progress markers and retry-safe deletes. Do not run a huge recursive delete in a callable request. Pause/fail closed on permission errors, schema drift, or unexpected collection types.
6. **Verify:** re-scan each allow-listed category within bounded limits, report any remaining items, and mark completion only when verification succeeds. Preserve a minimal completion record that contains no lead contact details.
7. **Audit:** record request, preview, execution outcome and verification as bounded server-generated events. Do not log raw lead data, draft content, tokens or secrets. Any audit retention exception must be documented and approved.
8. **Recoverability:** define backup/export, restore testing, legal hold, and incident recovery before production. A backup is not an excuse for indefinite retention.

## Retention schedule: decision required before real data

The business owner and appropriate privacy/legal reviewer must set a purpose and finite period for each category before production. Do not invent a single blanket retention period for all data. The schedule must define:
- active lead and campaign data, including stale/unqualified records;
- import files or temporary processing artifacts, if any;
- product activity and security audit events;
- operational/debug logs and quota records;
- account deletion requests, backups, legal holds and restoration behaviour.

Where Firestore TTL is selected, use a server-generated expiry timestamp on only the intended collection. TTL is eventual cleanup, not an exact deadline, and must not replace access controls or a user-visible deletion status.

## Test and release acceptance criteria

- Cross-tenant tests prove an owner/admin of organisation A cannot preview, execute, or inspect organisation B's data.
- Non-owner roles, missing membership, malformed IDs, stale preview tokens, replayed confirmations, expired tokens, and changed organisation state all fail closed.
- Preview and execution are bounded; pagination cannot silently skip or double-count records; an incomplete preview cannot be executed.
- Retry tests prove idempotency after partial failure and that progress cannot be redirected to another tenant.
- Tests cover mixed collection contents, missing optional fields, malformed legacy documents, legal-hold blocks, and verification discovering remaining records.
- Audit output and logs contain no contact details, message bodies, access tokens, or secrets.
- Emulator tests use synthetic data and the demo project only. Production deployment remains blocked until the dedicated Growth Engine project, App Check, monitoring, budget alerts, access controls, retention schedule, and operational owner are verified.

## Current state

- Firestore client rules deny direct client reads/writes; server callables enforce organisation membership for supported operations.
- A bounded server-side audit writer exists for selected successful mutations, with allow-listed event types and metadata.
- Existing audit-retention guidance is in `docs/AUDIT_EVENT_RETENTION_POLICY.md`.
- **Not implemented by this specification:** account deletion, organisation offboarding/deletion, bulk data erasure, production TTL configuration, backups, legal-hold controls, or a production retention schedule.
