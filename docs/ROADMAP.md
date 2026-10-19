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
- [x] Add authenticated organisation creation and atomic owner membership creation.
- [x] Add owner/admin-only campaign creation/status changes and membership-checked campaign listing.
- [x] Add membership-checked lead listing and tenant-scoped lead creation/contact editing.
- [x] Add transactional lead status and notes updates with activity events.
- [x] Add transactional do-not-contact controls; members can suppress, but only owners/admins can remove a restriction.
- [x] Enforce the suppression gate transactionally when creating or editing draft-only outreach.
- [x] Add draft listing, editing, and deletion; no send endpoint exists.
- [x] Add deny-by-default Firestore rules, strict server input/role guards, and emulator configuration.
- [ ] Create/configure a dedicated Growth Engine Firebase project; do not reuse AnyTrader production.
- [ ] Add sign-in and account lifecycle UI using Firebase Authentication.
- [ ] Run callable functions and Firestore rules against Firebase Emulator Suite.
- [ ] Add emulator-backed tests for unauthenticated requests, non-member access, role escalation, and cross-tenant isolation.
- [ ] Connect the frontend through a typed API/repository adapter; keep demo mode as a separate mode.
- [ ] Add rate limiting/App Check strategy, structured audit events, idempotency, and safe error handling before external exposure.

## Phase 3 — Complete persisted workflows

- Implement server-side CSV batch import with validation, deduplication, and bounded batch sizes.
- Add pagination/cursors for large lead and draft directories.
- Add idempotency protection for retried mutations and a durable audit-event policy.
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

- Work only in Saanwar2002/AnyTrader-Growth-Engine, on development/chatgpt-mvp.
- Do not modify the original AnyTrader repository or either repository's main branch.
- No unauthorized scraping or access-control bypass.
- No secrets in the browser or committed configuration.
- No real lead data in localStorage demo mode and no automated outreach.
