# Growth Engine Roadmap

## Phase 0 — Architecture and safety baseline (complete)

- [x] Keep Growth Engine in its own repository and development branch.
- [x] Document product boundaries, permitted data sources, tenant model, and draft-only outreach.
- [x] Establish reproducible frontend checks and dependency lockfiles.

## Phase 1 — Local demo MVP (implemented; interactive tests added)

- [x] React + TypeScript + Vite workspace and responsive dashboard.
- [x] Campaign setup, synthetic provider leads, filters, review statuses, notes, and activity history.
- [x] CSV import with mapping, validation, preview, selection/exclusion, deduplication, and export.
- [x] Draft-only outreach and a demo Do not contact control that blocks new drafts.
- [x] Interactive UI tests for campaign creation, CSV import confirmation, suppression, draft creation, and local persistence.

## Phase 2 — Backend and tenant-safe persistence (server scaffold; not production-ready)

- [x] Select Firebase Cloud Functions v2 callable endpoints as the initial trusted backend.
- [x] Add authenticated organisation creation, atomic owner membership creation, and membership-based organisation discovery.
- [x] Add owner/admin-only campaign creation/status changes and membership-checked campaign listing.
- [x] Add membership-checked lead listing and tenant-scoped lead creation/contact editing.
- [x] Add transactional lead status and notes updates with activity events.
- [x] Add transactional do-not-contact controls; members can suppress, but only owners/admins can remove a restriction.
- [x] Enforce the suppression gate transactionally when creating or editing draft-only outreach.
- [x] Add draft listing, editing, and deletion; no send endpoint exists.
- [x] Add deny-by-default Firestore rules, strict server input/role guards, and emulator configuration.
- [ ] Create/configure a dedicated Growth Engine Firebase project; do not reuse AnyTrader production.
- [x] Add email/password sign-in, account creation, sign-out, and a Firebase-config-gated cloud workspace UI.
- [ ] Run callable functions and Firestore rules against Firebase Emulator Suite.
- [ ] Add emulator-backed tests for unauthenticated requests, non-member access, role escalation, and cross-tenant isolation.
- [x] Scaffold environment-gated Firebase client setup and a typed callable API adapter with unit tests.
- [x] Connect core organisation, campaign, lead, suppression, and draft workflows through the typed API adapter; keep local demo mode separate.
- [ ] Complete App Check strategy/enforcement, durable audit-event policy, and safe error-handling review before external exposure; rate limiting is implemented with provisional quotas.

## Phase 3 — Complete persisted workflows

- [x] Implement server-side CSV batch import with validation, cross-identifier deduplication, and a 25-row batch limit (PR #10; CI passed on head `76a45ed6c4dc8f580433bc374475773dc1235101`; review still required).
- [x] Add cursor pagination for lead, campaign, outreach-draft, and organisation directories.
- [x] Add idempotency protection for CSV import retries; CI and emulator smoke tests passed on head `76a45ed6c4dc8f580433bc374475773dc1235101`.
- [ ] Add idempotency protection to other high-impact mutations after reviewing client retry semantics.
- [x] Document proposed audit-event retention and access policy (`docs/AUDIT_EVENT_RETENTION_POLICY.md`).
- [x] Add a minimal transactional audit event for successful CSV imports; CI passed on head `6b117e14a25dd734bc72dedd5576483da087995a`.
- [x] Add atomic, PII-minimised audit events for lead contact edits and contact-restriction changes (CI passed on `0c7821a82cb787dea5fa7c9a3fc63a516352a899`).
- [x] Extend transactional audit coverage to campaign creation/status changes, lead status/notes changes, and outreach-draft create/update/delete without logging note text or draft content (CI passed on `fbce1abe83385f0ced0ed06bd311e88cab45c4f0`).
- [x] Add a transactional, PII-minimised audit event for manual lead creation (CI passed on head `04b39a1de61cf9c04f7219ad83e08f324eb23f79`).
- [x] Add an atomic, metadata-minimised audit event when an organisation and its initial owner membership are created (CI verification pending after regression-test correction).
- [ ] Extend audit events to other sensitive mutations and complete access/retention controls after policy review.
- Keep provenance, import review, deduplication, and data minimisation.

## Phase 4 — Approved lead-source adapters

- Provider-neutral adapter interface and provenance for each record.
- Only APIs/providers whose terms permit the intended use.
- Document permissions, rate limits, lawful basis/review status, and retention for each source.

## Phase 5 — Server-side AI assistance

- Server-side Gemini classification and draft generation with schema validation.
- Prompt-injection protections, per-organisation usage limits, and human approval.
- No automated outreach sending in the MVP.

## Phase 6 — Attribution and SaaS controls

- Onboarding attribution, aggregate analytics, organisation settings, plans, and quotas.
- Billing only after core workflows and server-side entitlements are tested.

## Phase 7 — Production hardening and later agency features

- Privacy/export/deletion/retention workflows, monitoring, backups, recovery, incident response, security review.
- Later: agency workspaces, white-labeling, API access, and enterprise controls.

## Non-negotiable boundaries

- Work only in Saanwar2002/AnyTrader-Growth-Engine, on development/next-phase.
- Do not modify the original AnyTrader repository or either repository's main branch.
- No unauthorized scraping or access-control bypass.
- No secrets in the browser or committed configuration.
- No real lead data in localStorage demo mode and no automated outreach.
