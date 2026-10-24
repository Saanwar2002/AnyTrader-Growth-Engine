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

## 6. Offboarding and tenant-data lifecycle (required design before implementation)

Offboarding must be an explicit, authorised workflow; removing a user's login or membership alone is not proof that tenant data has been handled correctly. No tenant-wide deletion or audit-export callable is currently approved by this policy.

### Required sequence

1. **Authenticate and authorise:** require a recent authenticated session where supported; verify the actor is an active organisation owner/admin using authoritative membership data inside the same transaction as any membership-state mutation. A client-supplied role or organisation ID is never authoritative.
2. **Freeze access first:** mark the organisation as offboarding or disable active memberships before any destructive work. All tenant-scoped callables must fail closed for an offboarding organisation. Do not rely on UI hiding.
3. **Inventory owned data:** enumerate tenant-owned campaigns, leads, lead activity, outreach drafts, import-idempotency records, and any future exports/integrations. Record counts and a versioned inventory, not the underlying contact/message content.
4. **Separate retention classes:** apply approved retention rules to operational/product records, security audit events, abuse/security logs, backups, and legally held records. Do not silently cascade-delete audit evidence merely because a tenant is closing.
5. **Execute bounded deletion:** use a resumable server-side job with pagination, an idempotent job ID, progress checkpoints, retry handling, and per-batch limits. Avoid a single unbounded Firestore transaction or a client-driven recursive delete.
6. **Verify completion:** re-query each known data class, confirm tenant access remains blocked, and record counts plus a completion outcome. Treat TTL as eventual cleanup only, not proof that deletion completed.
7. **Handle exceptions:** document legal holds, unresolved incidents, failed batches, backup expiry, and restoration procedures. A restore must not silently reactivate a closed tenant or resurrect deleted access.
8. **Minimise the final record:** preserve only a minimal offboarding outcome and job reference for the approved period. Never copy lead contact fields, notes, or draft bodies into the offboarding audit event.

### Implementation and test gates

- [ ] Define owner/admin authority and any second-person approval requirement for tenant-wide deletion/export.
- [ ] Define tenant lifecycle states and prove every callable rejects offboarding tenants.
- [ ] Add a dry-run inventory mode that exposes counts only to authorised operators.
- [ ] Add resumable, idempotent deletion jobs with explicit per-data-class policies.
- [ ] Test interruption/retry, duplicate job requests, partial failure, concurrent writes, legal holds, and restore behavior using synthetic emulator data.
- [ ] Verify closed tenants cannot recreate access through stale memberships, old tokens, or replayed requests.
- [ ] Define the minimal completion audit schema and retention period after privacy/legal review.
- [ ] Document support escalation and a manual recovery path before production.

### Current implementation boundary

The existing backend has organisation creation and membership/tenant checks, but this policy does not establish that tenant offboarding, tenant-wide deletion, audit retrieval, TTL cleanup, or backup deletion are implemented. Do not expose new deletion/export endpoints until the authority model, retention rules, and emulator tests above are approved.

## 7. Current boundary

The current project has a deny-all Firestore client rule set and product-level `leadActivities`; this does **not** mean the policy above is implemented. Until the checklist is verified, use synthetic data only, keep outreach draft-only, and do not deploy publicly.
