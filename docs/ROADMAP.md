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
- [x] Expose owner/admin pause, activation, and completion controls in the cloud workspace using the existing server-enforced status endpoint.
- [x] Add membership-checked lead listing and tenant-scoped lead creation/contact editing.
- [x] Display heuristic lead completeness scores and bounded reason text, with loaded-page sorting by score, newest, or business name; explicitly distinguish completeness from quality, consent, and contactability.
- [x] Add transactional lead status, notes, and UTC-calendar follow-up date updates with tenant-scoped activity events; follow-up scheduling is internal-only and never sends outreach.
- [x] Add loaded-lead follow-up queue filters for overdue, due today, upcoming, unscheduled, and invalid legacy dates; UTC date-only classification, loaded-count labels, and filtered exports share the same criteria. This is a review aid only and never sends reminders or outreach.
- [x] Sort the loaded lead directory by follow-up date (earliest first), placing unscheduled and invalid legacy dates after valid dates and using business name as a deterministic tie-breaker; no additional data reads or mutations.
- [x] Add an on-demand, tenant-scoped lead activity timeline limited to the latest 20 events, excluding actor identifiers and contact values; emulator coverage verifies cross-tenant denial.
- [x] Add transactional do-not-contact controls; members can suppress, but only owners/admins can remove a restriction.
- [x] Add loaded-page contact-review queue counts and one-click filters for pending, cleared, and blocked leads; clearly disclose when additional lead pages remain.
- [x] Add an on-demand tenant-scoped server-side inventory of stored contact-review statuses, with a separate legacy/unclassified count rather than inferring status from incomplete legacy fields.
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
- [x] Extend transactional audit coverage to campaign creation/status changes, lead status/notes/follow-up-date changes, and outreach-draft create/update/delete without logging note text, contact data, or draft content.
- [x] Harden outreach-draft idempotency replay validation: require actor/request fingerprint and immutable response payload to match, and re-check that the original tenant-scoped draft still exists, belongs to the actor, and remains unsent.
- [x] Add bounded all-or-nothing bulk lead status updates for up to 25 selected records, with tenant/role rechecks, contact-restriction gates, stable idempotency, per-lead activity/audit events, and offboarding inventory coverage.
- [x] Validate bulk lead status idempotency replay responses against the original tenant/status/requested IDs, enforcing unique changed IDs and consistent updated/unchanged counts before returning saved results.
- [x] Add a transactional, PII-minimised audit event for manual lead creation (CI passed on head `04b39a1de61cf9c04f7219ad83e08f324eb23f79`).
- [x] Add an atomic, metadata-minimised audit event when an organisation and its initial owner membership are created (verified by CI on `c2e31b169e81ccd9fda1fd1cad0189b09669ba1c`; frontend/emulator and Functions jobs passed).
- [x] Add emulator assertions for audit metadata allowlists, scalar/bounded values, and rejection of content-bearing fields (CI run `40043306751` passed on head `05dfef69c19db738c048212bc97487cb1722b7e7`).
- [x] Add emulator coverage proving exact-value legacy email and website fallbacks prevent duplicate imports when canonical key fields are absent (CI run `40088188514` passed on head `82dfaaf085044a361903daea7f7a64d7c0ce6496`).
- [ ] Complete audit access/retention controls after privacy/legal policy review; do not configure production TTL or broaden audit reads before that review.
- Keep provenance, import review, deduplication, and data minimisation.

## Phase 4 — Approved lead-source adapters

- [x] Snapshot the approved manifest and allowed-field list at run-guard construction so caller mutation cannot expand per-run budgets or permissions mid-pagination.
- [x] Restrict provider candidate records to plain data objects; reject symbol keys, unknown/non-enumerable/accessor properties, and class/host objects without invoking getters, with regression coverage.
- [x] Restrict source manifests to plain data records with known own data properties; reject accessors, symbol/unknown keys, class instances, and unsafe allowedFields arrays without invoking getters.
- [x] Use detached validated manifest snapshots for source permission, allowlist, and record-budget decisions so caller mutation after descriptor inspection cannot alter the decision; cover with a regression test.
- [x] Normalize lead-source page request/result envelopes through own data descriptors, reject accessor/symbol/class/hidden shapes, and copy dense provider record arrays without invoking getters; safely discard unrelated ordinary data fields.
- [x] Copy candidate batches from dense indexed data descriptors before iteration; reject accessor indices, symbols/extra array properties, subclasses, and overridden iteration methods without invoking getters.
- [x] Enforce the approved manifest's rolling per-minute provider request budget in the per-run guard, with an injectable clock and backwards-clock rejection; adapters must record each request before issuing it.
- [x] Enforce a cumulative per-run request budget in the approved manifest to bound empty-page pagination across multiple rolling windows.
- [x] Revalidate the approved manifest immediately before each provider request so an approval that expires during a run is blocked before network access.
- [x] Require the per-run guard to associate each accepted page with exactly one recorded provider request and provide explicit resolution for failed calls.
- [x] Centralize guarded page fetch orchestration so request validation, pre-call budget accounting, failed-callback resolution, completion-time approval checks, and page attribution cannot be accidentally reordered by callers.
- [x] Add a stateful per-run guard that enforces the total record budget across pages and rejects repeated next cursors or duplicate provider record IDs across pages; rejected pages do not mutate accepted-run state.
- [x] Provide a single pure helper that validates each bounded adapter page and cursor, validates/maps every candidate against the approved manifest, and attaches provenance before returning the page; regression tests cover valid normalization and malformed/disallowed records.
- [x] Validate bounded page cursors as strict JSON-safe values and pass adapters detached normalized cursor values; regression tests reject lossy, cyclic, sparse, and non-plain cursor data. This contract does not approve or connect any provider.
- Provider-neutral adapter interface and provenance for each record.
- Only APIs/providers whose terms permit the intended use.
- Document permissions, rate limits, lawful basis/review status, and retention for each source.

## Phase 5 — Server-side AI assistance

- Server-side Gemini classification and draft generation with schema validation.
- Prompt-injection protections, per-organisation usage limits, and human approval.
- No automated outreach sending in the MVP.

## Phase 6 — Attribution and SaaS controls (in progress)

- [x] Loaded-record campaign funnel summary with qualified, contacted, onboarded counts, an accessible responsive funnel chart, and clearly labelled loaded-lead conversion rates; a separate bounded server-counted chart compares all stored leads across up to 20 campaigns, independent of loaded pages.
- [x] Self-declared lead-source performance summary with qualified/onboarded counts and rates, plus a responsive all-record source funnel chart; pagination and unverified source-label limitations are explicit.
- [x] Full server-counted lead-source funnel CSV export across all stored organisation leads, including the attribution caveat, formula-safe escaping, and an explicit empty-report row.
- [x] Shared spreadsheet-formula neutralisation across loaded campaign, full campaign, onboarding cohort, and full source analytics CSV exports; comma/quote/newline escaping remains covered by serializer tests.
- [x] Downloadable campaign performance CSV with a loaded-record-only scope column and escaped text fields.
- [x] Include bounded completeness scores and formula-safe score explanations in both filtered-loaded and full-tenant lead CSV exports so prioritisation can continue in spreadsheets; internal notes remain excluded.
- [x] Add a server-counted campaign readiness snapshot with per-campaign lead/draft counts, suppressed and pending/blocked review counts, missing source/setup indicators, a 20-campaign cap, and an explicit no-contact-authorisation caveat.
- [x] Downloadable full campaign funnel report using server-counted totals across all stored leads, with explicit scope labels, escaped campaign names, and a 20-campaign safety cap.
- [x] Read-only server-counted open-lead aging report across all stored pages, grouped by creation age with missing timestamps reconciled as unclassified; clearly distinguishes creation age from last activity and does not authorise contact.
- [x] Filter loaded leads by completeness score band (low 0–39, medium 40–69, high 70–100), combine with existing search/status/campaign/contact-review filters, and reset the band with Clear filters; this remains a completeness heuristic, not a quality or contactability guarantee.
- [x] Filter loaded leads by their declared source, using human-readable labels and the existing search/status/campaign/contact-review/completeness filters; source attribution remains user-declared and unverified.
- [x] Read-only campaign readiness preflight that flags missing setup, contact restrictions, draft review, source-attribution gaps, and incomplete pagination without authorising or sending outreach; formula-safe CSV export is explicitly scoped to loaded records.
- [x] Record first-onboarding timestamps on new onboarding transitions and provide on-demand server-side campaign/source aggregates. The 12-month onboarding cohort report counts first-onboarding timestamps and displays an accessible monthly trend chart; source values remain self-declared.
- [ ] Review and approve a bounded legacy backfill for records already marked onboarded without a first-onboarding timestamp. Until approved and verified, those legacy records remain excluded from cohort counts.
- [x] Add a read-only owner/admin onboarding timestamp coverage preview with a percentage/readiness meter, valid versus missing/invalid timestamp counts, and a 1,000-lead scan cap; no inferred dates, record details, or writes are returned.
- [x] Owner/admin organisation display-name settings with server-side role checks, transactional rate limiting, and PII-minimised audit events.
- [x] Owner/admin member removal with owner protection, role hierarchy, transactional member-usage decrement when authoritative counters exist, retry-safe missing-member behavior, and PII-minimised audit events.
- [x] Add tenant-scoped cursor pagination for the owner/admin member roster, with bounded 20-member pages and cross-tenant cursor rejection.
- [x] Add owner-only role changes for existing non-owner organisation members, with role hierarchy enforcement and PII-minimised audit events.
- [x] Owner/admin campaign detail editing with transactional tenant-role rechecks and PII-minimised audit events.
- [x] Enforce server-side campaign, lead, member, and monthly AI-suggestion entitlements for organisations with authoritative usage counters; the owner/admin usage dashboard exposes these counters without inventing zeroes for legacy organisations. Billing remains disabled.
- [ ] Review and reconcile legacy organisation usage counters before extending enforcement to those organisations or enabling billing.
- [x] Add a read-only owner/admin reconciliation preview comparing live campaign/lead/member counts to stored plan counters; never auto-repair counters or infer historical AI usage.
- [x] Downloadable owner/admin quota reconciliation CSV showing actual versus stored resource counts, limits, remaining usage, mismatches, and missing legacy values; historical AI usage remains explicitly review-required and formula-safe.
- [x] Show owner/admin quota utilization states (within limit, near limit at 20% remaining or less, and limit reached) beside authoritative usage counters; keep legacy organisations in reconciliation-required state without invented numbers.
- [ ] Billing only after core workflows and server-side entitlements are tested.

## Phase 7 — Production hardening and later agency features

- Privacy/export/deletion/retention workflows, monitoring, backups, recovery, incident response, security review.
- [x] Read-only owner/admin security audit log with tenant-scoped cursor pagination, bounded metadata validation, rate limiting, action/identifier and inclusive UTC date-range filters over loaded pages, no extra actor-email lookup, and formula-safe CSV export clearly scoped to loaded pages.
- [x] Require the exact event-specific security-audit metadata key set when writing and reading persisted events; reject missing required flags as well as unexpected keys and malformed containers.
- [x] Harden campaign-creation idempotency replay records: require the exact saved response shape, original actor/request fingerprint and payload, then re-check persisted tenant-contained campaign ownership and immutable creation fields.
- [x] Harden organisation-creation idempotency replay responses with an exact key set, original actor/request/name binding, and a re-check of persisted owner membership and organisation name.
- [x] Harden lead-creation idempotency replay responses with an exact key set and original actor/request/payload binding; compare persisted score, score reasons, contact-safety flags, and creation fields before replay.
- [x] Harden CSV-import idempotency replay with an exact bounded response shape, unique lead IDs, consistent import totals, and tenant/campaign/creator/contact-suppression checks against persisted imported leads.
- [x] Make repeated lead-status updates retry-safe no-ops after authorization, contact-restriction, campaign and status validation, preventing duplicate activity/audit events and unnecessary quota consumption.
- [x] Make identical lead-note and follow-up-date retries no-op after tenant/role/target validation, preventing duplicate activity/audit events and unnecessary quota consumption.
- Later: agency workspaces, white-labeling, API access, and enterprise controls.

## Non-negotiable boundaries

- Work only in Saanwar2002/AnyTrader-Growth-Engine, on development/next-phase.
- Do not modify the original AnyTrader repository or either repository's main branch.
- No unauthorized scraping or access-control bypass.
- No secrets in the browser or committed configuration.
- No real lead data in localStorage demo mode and no automated outreach.
