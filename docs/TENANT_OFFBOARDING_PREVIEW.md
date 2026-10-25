# Tenant-scoped offboarding preview

## Status

Implemented as a **non-destructive, owner-only preview callable** named `previewOrganisationOffboarding`. It is not a deletion or account-closure workflow and does not activate retention or TTL settings.

## Access and bounds

- Requires an authenticated caller and a valid organisation ID.
- Revalidates the organisation and membership through the existing server-side membership check.
- Requires the authoritative membership role to be `owner`; admin/member/viewer roles are denied.
- Uses a server-side per-user, per-organisation read quota.
- Counts only the explicit tenant subcollection allow-list: members, campaigns, leads, lead activities, outreach drafts, security audit events, and the four organisation-scoped idempotency collections.
- Reads document IDs only, in bounded pages. No lead/contact fields or document IDs are returned.
- Each category is capped at 1,000 records. A category above the cap is marked `limit_reached` with no exact count; a read failure is marked `unavailable`. Either condition makes the overall preview incomplete.
- The callable performs no delete operation. It creates/updates only the ordinary rate-limit record used to protect the endpoint.

## Explicit limitations before any future deletion

This preview does **not** inventory root-level `rateLimits` or `organisationCreationIdempotency` records, legacy/manual collections, Auth accounts, exports, backups, logs, or third-party copies. These need separate authoritative reconciliation. The preview is not a legal-retention decision, backup/recovery proof, or confirmation that all organisation data has been discovered.

Do not implement deletion based solely on this preview. Any future destructive workflow requires a verified schema inventory, approved retention and legal-hold policy, recovery plan, an explicit confirmation bound to a fresh preview, idempotent bounded execution, and post-operation verification. No deployment or live data operation is part of this change.
