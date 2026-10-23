# Audit Event Retention and Access Policy

**Status: proposed development policy — not production approval.** This document defines controls to implement and verify before the Growth Engine handles real lead or customer data. It does not claim that a dedicated audit-event store, TTL policy, or production monitoring is already deployed.

## 1. Separate operational activity from security audit records

- **Lead activity history** is a product feature explaining changes to a lead (for example, creation, contact edits, status changes, and suppression review). It may contain business names or user-entered text and must not be treated as a complete security audit trail.
- **Security audit events** should be server-generated, append-only records of sensitive actions and security outcomes, including organisation membership/role changes, lead import and export, contact-restriction changes, draft creation/edit/deletion, useful authentication/authorisation denials, and administrative configuration changes.
- Do not copy full lead payloads, message bodies, authentication tokens, secrets, or unnecessary contact details into audit records. Prefer resource IDs, action/result codes, timestamps, and minimal metadata.

## 2. Proposed event schema

Each event should contain:
- `eventType`: a bounded allow-listed action name.
- `organisationId`: tenant scope, where applicable.
- `actorUid`: authenticated actor, or a documented system actor.
- `resourceType` and `resourceId`: identifiers only, not full resource contents.
- `outcome`: a bounded value such as `success`, `denied`, or `failed_precondition`.
- `createdAt`: a server-generated timestamp.
- `metadata`: a small allow-listed object with bounded values; never accept arbitrary client-supplied event bodies.
- `schemaVersion`: integer for future migration.

The trusted backend must construct events. Client code must not be allowed to write or alter audit records directly. Sensitive mutations and their success audit event should be committed atomically where they share a Firestore transaction. Failed requests that do not enter a transaction may be recorded through structured server logs, with care not to log raw identifiers or user-entered data.

## 3. Access and tamper resistance

- Keep Firestore client rules deny-by-default; audit records must not be client-writable.
- Restrict audit read access to a narrowly defined owner/admin or dedicated compliance role, subject to documented business need. Do not expose audit collections through broad list callables.
- Tenant-scoped reads must verify current membership and role on the server for every request.
- Prevent update/delete through application callables. Treat privileged Firebase project administrators as trusted operators and protect their access with least privilege and MFA.
- Do not use audit records as the only evidence for security monitoring; export suitable security signals to a controlled logging/monitoring destination when production operations are configured.

## 4. Retention and deletion

- Before production, select a documented retention period with privacy/legal review and a defined purpose for each event category. Do not choose indefinite retention by default.
- Separate short-lived operational/debug logs from security audit records. Define access, export, legal hold, and deletion procedures for each.
- If Firestore TTL is used, apply it only to an explicit server-generated expiry field and the intended collection. TTL is asynchronous cleanup, not an access-control mechanism or an exact deletion deadline.
- Do not expire records needed to investigate an active incident, satisfy a legal hold, or meet a documented regulatory obligation; define an approved exception process.
- User deletion/offboarding must reconcile account data, tenant-owned lead data, product activity history, audit obligations, backups, and any legal holds. Record the outcome without preserving unnecessary personal data.
- Test retention and deletion using synthetic records in the separate Growth Engine Firebase project before release.

## 5. Implementation and verification checklist

- [x] Define a code-enforced event catalogue, resource-type mapping, event-specific metadata allow-list, and bounded metadata validation; automated contract test guards the writer.
- [x] Implement a minimal trusted server-side audit writer for successful CSV imports, with an allow-listed event type and bounded metadata.
- [x] Extend the writer to contact-detail edits and contact-restriction changes with bounded, non-contact metadata.
- [x] Add the CSV-import success event in the same Firestore transaction as the import and idempotency record.
- [x] Add atomic success events for CSV import, contact-detail edits, and contact-restriction changes.
- [x] Add atomic, metadata-minimised success events for campaign creation/status changes, lead status/notes changes, outreach-draft create/update/delete, manual lead creation, and organisation creation; verify CI and emulator evidence before treating coverage as complete.
- [x] Add emulator smoke assertions proving clients cannot read or write `securityAuditEvents` directly under the deny-by-default Firestore rules.
- [ ] If tenant-scoped audit retrieval is introduced, add tests proving users cannot read another tenant's events before enabling that access.
- [x] Emulator smoke test asserts one event for a first import, no extra event for a replay, and one event for a distinct concurrent import key.
- [x] Add targeted emulator assertions that malformed/oversized lead creation emits no `lead.created` success event and rejected campaign status changes do not increment `campaign.status_changed`.
- [x] Add resource-scoped emulator assertions proving rejected lead-status transitions, malformed contact edits, invalid suppression flags, and stale suppression clearance emit no corresponding success audit event.
- [x] Add emulator assertions proving oversized lead notes, oversized draft updates, and deletion of a nonexistent draft do not emit success audit events for the affected resource.
- [ ] Add paginated, rate-limited, tenant-authorised audit access only if the product requires it.
- [ ] Decide retention periods with privacy/legal review and configure/test TTL or another deletion mechanism.
- [ ] Configure production log access, monitoring, backup/recovery, and incident-response procedures.
- [ ] Update the production-readiness checklist with evidence from the dedicated project.

## 6. Current boundary

The current project has a deny-all Firestore client rule set and product-level `leadActivities`; this does **not** mean the policy above is implemented. Until the checklist is verified, use synthetic data only, keep outreach draft-only, and do not deploy publicly.
