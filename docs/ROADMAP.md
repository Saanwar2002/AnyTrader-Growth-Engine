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
- [x] Run callable functions and Firestore rules against Firebase Emulator Suite in CI using the local Firebase Emulator Suite; the dedicated project is still not configured.
- [x] Add emulator-backed tests for unauthenticated requests, non-member access, role escalation, and cross-tenant isolation; continue adding targeted regressions as new workflows are introduced.
- [x] Scaffold environment-gated Firebase client setup and a typed callable API adapter with unit tests.
- [x] Connect core organisation, campaign, lead, suppression, and draft workflows through the typed API adapter; keep local demo mode separate.
- [x] Add deployed-runtime App Check enforcement to callable exports and require frontend App Check configuration before cloud mode; live token validation in the dedicated Firebase project remains blocked on project setup.
- [x] Document the proposed audit-event retention/access policy and privacy/offboarding safeguards; production TTL and deletion remain blocked pending legal/privacy review.
- [ ] Complete live App Check token validation, operational monitoring/budget alerts, and safe error-handling review before external exposure; rate limits remain provisional.

## Phase 3 — Complete persisted workflows

- [x] Implement server-side CSV batch import with validation, cross-identifier deduplication, and a 25-row batch limit (PR #10; CI passed on head `76a45ed6c4dc8f580433bc374475773dc1235101`; review still required).
- [x] Add cursor pagination for lead, campaign, outreach-draft, and organisation directories.
- [x] Add idempotency protection for CSV import retries; CI and emulator smoke tests passed on head `76a45ed6c4dc8f580433bc374475773dc1235101`.
- [x] Add idempotency protection to manual lead, campaign, and organisation creation with stable client retry keys, server-side payload binding, and atomic replay; review other mutations individually before broadening.
- [x] Add retry-safe idempotency to outreach-draft creation with normalized-payload fingerprinting, suppression/contact-review rechecks on replay, stable client retry keys, and emulator/UI/API coverage; CI run 40042942633 passed on head `e593c87624685e04116292bccd7c08242b16993d`.
- [x] Document proposed audit-event retention and access policy (`docs/AUDIT_EVENT_RETENTION_POLICY.md`).
- [x] Add a minimal transactional audit event for successful CSV imports; CI passed on head `6b117e14a25dd734bc72dedd5576483da087995a`.
- [x] Add atomic, PII-minimised audit events for lead contact edits and contact-restriction changes (CI passed on `0c7821a82cb787dea5fa7c9a3fc63a516352a899`).
- [x] Extend transactional audit coverage to campaign creation/status changes, lead status/notes changes, and outreach-draft create/update/delete without logging note text or draft content (CI passed on `fbce1abe83385f0ced0ed06bd311e88cab45c4f0`).
- [x] Add a transactional, PII-minimised audit event for manual lead creation (CI passed on head `04b39a1de61cf9c04f7219ad83e08f324eb23f79`).
- [x] Add an atomic, metadata-minimised audit event when an organisation and its initial owner membership are created (verified by CI on `c2e31b169e81ccd9fda1fd1cad0189b09669ba1c`; frontend/emulator and Functions jobs passed).
- [x] Add emulator assertions for audit metadata allowlists, scalar/bounded values, and rejection of content-bearing fields (CI run `40043306751` passed on head `05dfef69c19db738c048212bc97487cb1722b7e7`).
- [x] Add emulator coverage proving exact-value legacy email and website fallbacks prevent duplicate imports when canonical key fields are absent (CI run `40088188514` passed on head `82dfaaf085044a361903daea7f7a64d7c0ce6496`).
- [ ] Complete audit access/retention controls after privacy/legal policy review; do not configure production TTL or broaden audit reads before that review.
- Keep provenance, import review, deduplication, and data minimisation.

## Phase 4 — Approved lead-source adapters

- Provider-neutral adapter interface and provenance for each record.
- Only APIs/providers whose terms permit the intended use.
- Document permissions, rate limits, lawful basis/review status, and retention for each source.

## Phase 5 — Server-side AI assistance

- Server-side Gemini classification and draft generation with schema validation.
- Prompt-injection protections, per-organisation usage limits, and human approval.
- No automated outreach sending in the MVP.

## Phase 6 — Attribution and SaaS controls (in progress)

- [x] Loaded-record campaign funnel summary with qualified, contacted, onboarded counts and clearly labelled loaded-lead conversion rates; partial pagination is disclosed in the UI.
- [x] Self-declared lead-source performance summary with qualified/onboarded counts and rates; pagination and unverified source-label limitations are explicit.
- [ ] Onboarding attribution and durable, server-side aggregate analytics across all pages.
- [ ] Organisation settings, plans, and server-side entitlements/quotas.
- [ ] Billing only after core workflows and server-side entitlements are tested.

## Phase 7 — Production hardening and later agency features

- Privacy/export/deletion/retention workflows, monitoring, backups, recovery, incident response, security review.
- Later: agency workspaces, white-labeling, API access, and enterprise controls.

## Non-negotiable boundaries

- Work only in Saanwar2002/AnyTrader-Growth-Engine, on development/next-phase.
- Do not modify the original AnyTrader repository or either repository's main branch.
- No unauthorized scraping or access-control bypass.
- No secrets in the browser or committed configuration.
- No real lead data in localStorage demo mode and no automated outreach.
