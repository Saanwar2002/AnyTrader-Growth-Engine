# AnyTrader Growth Engine — Master Architecture & Implementation Plan

**Status:** Architecture baseline for the standalone project  
**Repository:** `Saanwar2002/AnyTrader-Growth-Engine`  
**Development workflow:** Google AI Studio / Gemini, with source controlled in this repository  
**Non-negotiable boundary:** Do not modify the original AnyTrader repository or its `main` branch as part of this project.

## 1. Product objective

Build a standalone lead discovery and relationship-management SaaS that AnyTrader can use internally to recruit service providers, and that can later be sold to other businesses. It must support multiple service categories and customers rather than being hard-coded for painters or for AnyTrader only.

The first pilot category may be painters/decorators, using synthetic or manually imported CSV data. Begin with human-reviewed lead research and outreach drafts; do not automatically send messages in the MVP.

## 2. Google AI Studio development constraints

Google AI Studio/Gemini is the coding assistant and development workflow, not the production application server or secure secret store.

- Keep the code in this standalone GitHub repository and ask Gemini to make small, task-scoped changes.
- Each implementation task must state exact files in scope, acceptance criteria, tests, and files that must not be changed.
- Gemini must inspect existing code before editing; it must not recreate the app wholesale or silently replace dependencies.
- Require a summary of changed files, security implications, commands run, test results, and any unverified claims after each task.
- Run type-check, lint (once configured), unit tests, emulator/integration tests, and production build before treating a phase as complete.
- Use a separate Firebase project for Growth Engine. Never reuse production AnyTrader credentials, database, or secrets.
- Never put Gemini API keys, Firebase Admin credentials, OAuth client secrets, billing secrets, or provider API keys in client-side Vite variables or committed files.
- Use environment examples containing placeholders only. Store real secrets in the hosting provider's secret manager / Google Secret Manager.
- Do not assume AI Studio has deployed, secured, or tested backend infrastructure merely because the frontend runs in preview.

## 3. Recommended initial technology architecture

Retain the existing React + TypeScript + Vite frontend starter unless a verified technical reason requires a change.

### Frontend
- React + TypeScript + Vite.
- Typed API client; UI must not access privileged provider credentials or make privileged database writes directly.
- Authentication-aware routes and clear loading, error, empty, and permission-denied states.
- Accessible lead tables, filters, campaign forms, review queue, and audit/history views.

### Identity and authentication
- Firebase Authentication in a dedicated Growth Engine Firebase project.
- Initial sign-in: email/password and/or Google sign-in; enable email verification and password recovery.
- Require authentication for all private app routes and backend endpoints.
- The backend must verify Firebase ID tokens and derive the caller identity from the verified token, never from a client-supplied `userId`, `tenantId`, role, or email field.
- Roles: `owner`, `admin`, `member`, and optionally read-only `viewer`. Enforce permissions on the server, not just by hiding UI controls.
- Consider MFA for owners/admins before production or when supported by the chosen identity configuration.
- Use secure session handling appropriate to the hosting architecture; do not invent custom authentication or store raw passwords.

### Database
- Firestore in the dedicated Growth Engine Firebase project is the proposed MVP database because it fits the existing Firebase-oriented development experience.
- Keep a repository interface/data-access layer so the app is not tightly coupled to Firestore implementation details.
- Use Firebase Emulator Suite for local and automated tests.
- Firestore Security Rules must deny by default. Client access should be limited to explicitly safe, tenant-scoped reads/writes; privileged mutations and integrations should go through trusted server code.
- All important writes must validate schema, permissions, tenant membership, and allowed state transitions.
- Add indexes only when justified by actual query patterns; document required indexes.
- If relational joins, complex reporting, or transactional billing later outgrow Firestore, reassess a relational database in a separately scoped architecture decision rather than silently migrating.

### Backend and deployment
- Use a trusted server-side API for lead-source adapters, AI calls, sensitive mutations, quotas, audit events, and future billing.
- **Decision:** use Cloud Functions for Firebase v2 callable functions for the initial trusted API. This matches Firebase Auth/Firestore and provides a consistent auth context for callable requests. Reassess Cloud Run only if later workloads require it.
- Initial server scaffold lives in functions/, targets Node.js 22, and currently implements createOrganisation, createCampaign, and listCampaigns. The UI is not connected yet.
- Keep provider integrations behind typed interfaces/adapters; do not make the UI dependent on one lead provider.
- Apply request validation, authentication, authorization, rate limiting, timeouts, bounded retries, and safe error responses.
- Add structured logs with correlation/request IDs while avoiding unnecessary personal data or secrets.
- Production hosting can be selected after the initial build is verified; do not treat local Vite preview as production hosting.

### AI
- Use Gemini through server-side code only for classification, lead summaries, scoring explanations, and outreach drafts.
- Treat source content and imported lead fields as untrusted input. Defend against prompt injection and never allow source text to instruct tools to expose secrets or perform actions.
- Validate model output against schemas; handle invalid or unavailable output gracefully.
- Keep human approval mandatory for outreach in the MVP.
- Track AI usage per tenant, set configurable quotas, and avoid sending unnecessary personal data to the model.

## 4. Multi-tenant data and authorization model

Design for multiple organisations from day one, even if commercial subscriptions are enabled later.

Core collections/entities (exact Firestore shape can be decided in the implementation task):
- `users`: identity profile and account status; no client-controlled role escalation.
- `organisations`: workspace/account settings and lifecycle status.
- `memberships`: user-to-organisation relationship and role.
- `campaigns`: organisation ID, name, service category, geography, goals, status, owner, timestamps.
- `leads`: organisation ID, source/provenance, business name, permitted contact/business details, location, category, deduplication keys, score/explanation, status, timestamps.
- `leadActivities`: organisation ID, lead ID, actor, event type, safe metadata, timestamp.
- `outreachDrafts`: organisation ID, lead ID, channel, draft text, approval status, approver and timestamps.
- `sourceConnections`: organisation ID, provider, connection state and secret reference (never raw secret values in readable documents).
- `usageRecords`: organisation ID, operation, units, period and timestamp.
- `auditEvents`: organisation ID where applicable, actor, action, target type/ID, outcome and timestamp.
- Future: `subscriptions`, `invoices`, `webhookEvents`, `onboardingAttributions`.

Security invariants:
1. Every tenant-owned record has a validated `organisationId` (or equivalent tenant key).
2. The server derives the active organisation from a verified identity plus a verified membership; it never trusts the tenant ID alone from the browser.
3. Every read, write, search, export, background job and provider callback is scoped to the authorised organisation.
4. Cross-tenant access tests must prove that a user in Organisation A cannot read or modify Organisation B's data by changing IDs.
5. Role changes, organisation ownership changes, source connections, exports, and destructive operations are audited.
6. Never expose provider tokens, model API keys, or billing secrets in browser responses or logs.
7. Use soft deletion/retention rules where appropriate, and make deletion/export workflows explicit before production.

## 5. Lead-source, privacy, and outreach rules

- Start with synthetic data and CSV import/export. CSV imports require validation, size limits, duplicate handling, and an import preview before committing.
- Add live sources only after checking their current terms, permissions, rate limits, and permitted purposes. Do not implement unauthorised scraping, access-control bypass, or collection that violates provider terms.
- Google Maps/Places and LinkedIn must not be treated as unrestricted scraping sources. Use approved APIs or compliant data providers where the intended use is permitted.
- Record source, collection/import time, source record reference where permitted, and the lawful/permission basis or review status needed for the use case.
- Minimise personal data; prioritise business contact information. Define retention, correction, deletion, opt-out, and suppression-list handling before real outreach.
- Do not automate bulk messaging in the MVP. Generate drafts only; require a person to review and approve them.
- Add rate limits, suppression checks, clear sender identity, and jurisdiction-specific compliance review before any sending feature is introduced.
- AnyTrader onboarding links should use attributable campaign/referral tokens that do not expose personal data. The marketplace integration should initially be isolated and read-only where feasible, with explicit approval before production connection.

## 6. Billing and commercial SaaS readiness

Do not implement payment processing in Phase 1. Prepare the domain model for plans and quotas without pretending that billing is live.

Later billing phase requirements:
- A provider such as Stripe may be evaluated when the core workflows are stable.
- Verify webhook signatures; make webhook handling idempotent; do not trust browser redirects as proof of payment.
- Enforce plan limits on the backend, not only in UI.
- Keep subscription state, usage accounting, and access entitlements separate from client-supplied values.
- Never store card details directly.
- Pricing and packaging remain hypotheses until validated with real users.

## 7. Phased implementation roadmap

### Phase 0 — Architecture and safety baseline
- Keep this document as the source of truth.
- Verify starter repository structure, scripts, dependency versions, type-check, and production build.
- Add lint/test scripts if missing; establish a baseline.
- Document Firebase project separation, environment variables, and local setup.
- Acceptance: reproducible install/build; no secrets; original AnyTrader repository untouched.

### Phase 1 — Usable local foundation
- Establish domain types, API/data-access boundaries, routing, error handling, and mock repository.
- Build dashboard, campaign shell, lead list, filters, lead details, and review queue using synthetic data.
- Add unit tests for core domain logic and UI states.
- Acceptance: all features work against mock data; type-check, tests, and production build pass.

### Phase 2 — Authentication and tenant-safe persistence
- [x] Scaffold Firebase Functions v2 callable endpoints with auth-context checks and organisation membership authorization.
- [x] Create organisation and owner membership atomically; restrict campaign creation to owner/admin; membership-check campaign listing.
- [x] Add deny-by-default Firestore rules and emulator port configuration.
- [ ] Create the separate Firebase project and configure Auth, Firestore, and emulators.
- [ ] Connect sign-in UI and a typed frontend API/repository adapter.
- [ ] Add emulator-backed tests for unauthenticated requests, non-members, role escalation, and cross-tenant access.
- Acceptance: unauthenticated requests fail; users cannot elevate roles or cross tenant boundaries; emulator tests pass.

### Phase 3 — Campaign and lead workflows
- Campaign create/edit/archive, CSV import preview, lead deduplication, filters, scoring explanation, statuses, notes, and activity history.
- Validate all imports and state transitions server-side.
- Acceptance: duplicate/import/error cases tested; tenant scoping proven.

### Phase 4 — Approved lead-source adapters
- Define a provider-neutral adapter contract.
- Add only sources whose current API terms permit the planned use; start with CSV and one approved source.
- Add per-tenant credentials via secret references, quotas, retries, rate limits, and provenance.
- Acceptance: source failures do not corrupt data; credentials never reach the browser or logs.

### Phase 5 — AI lead intelligence and draft outreach
- Server-side Gemini integration for classification, explanation, and draft generation.
- Schema validation, prompt-injection protections, usage tracking, and human approval.
- Acceptance: malformed model output and provider outages are handled; no messages are sent automatically.

### Phase 6 — Onboarding attribution and analytics
- Generate non-sensitive referral tokens and track visits/conversions only with an approved integration.
- Begin with a mocked integration; review data-sharing and marketplace permissions before live connection.
- Acceptance: attribution is testable and does not expose lead personal data.

### Phase 7 — Commercial SaaS controls
- Plans, quotas, subscription lifecycle, billing provider, webhook verification, invoices/usage views, account deletion/export.
- Acceptance: server-side entitlement enforcement, idempotent webhook tests, and billing failure handling.

### Phase 8 — Agency, white-label, and production hardening
- Optional agency workspaces, branding, custom domains, API access, enterprise roles, backups, monitoring, incident response, and deployment controls.
- Acceptance: threat model and security review completed; restore and incident procedures documented.

## 8. Required quality gates for every Gemini task

Every task prompt must instruct Gemini to:
1. Read this architecture and inspect relevant files before editing.
2. Work only in `Saanwar2002/AnyTrader-Growth-Engine`; do not modify the original AnyTrader repository.
3. State assumptions and ask before introducing major dependencies or changing architecture.
4. Implement the smallest complete vertical slice.
5. Add/update tests for success, invalid input, unauthenticated access, unauthorised role, and cross-tenant access when applicable.
6. Run the relevant scripts and report exact results; never claim tests passed unless actually run.
7. Review for secrets, insecure direct object references, tenant leaks, unsafe AI output, and unapproved data collection.
8. Summarise files changed, migrations/rules/configuration required, test results, limitations, and the next task.
9. Update this plan only through a deliberate architecture decision, not as a substitute for implementation.
10. Do not mark a task complete if required checks cannot run; state the blocker explicitly.

## 9. Definition of MVP complete

The MVP is not complete until:
- A user can sign in and access only an authorised organisation.
- A user can create a campaign, import synthetic/CSV leads, deduplicate, filter, score, and manage statuses.
- AI-assisted summaries/drafts are validated and require human approval.
- Tenant isolation is proven with automated tests.
- No provider or AI secrets are exposed client-side.
- Data source provenance, basic audit history, opt-out/suppression support, and deletion/retention decisions are documented.
- Type-check, tests, security rules/emulator tests, and production build pass in a reproducible environment.
- Deployment, backup, monitoring, and recovery decisions are documented before real customer data is used.

**Current stage (2026-10-19):** Phase 1 local demo workflows and interactive UI tests are implemented. The Phase 2 Firebase Functions v2 scaffold now provides listMyOrganisations, createOrganisation, createCampaign, updateCampaignStatus, listCampaigns, listLeads, createLead, updateLeadContact, updateLeadStatus, updateLeadNotes, setLeadSuppression, createOutreachDraft, listOutreachDrafts, updateOutreachDraft, and deleteOutreachDraft. Lead mutations and their activity entries are transactional; draft creation reads the lead and checks suppression inside the same transaction, and only owners/admins can remove a contact restriction. Firestore rules deny direct client access by default. The backend targets Node.js 22 and has not been deployed or connected to the frontend. Local verification passed frontend typecheck/build, 54 tests across 6 files, Functions TypeScript build, 12 server guard tests, and npm audits reporting zero vulnerabilities for the root and Functions packages after overriding the vulnerable transitive @grpc/grpc-js version. Firebase Emulator Suite integration tests, real Firebase project setup, sign-in UI, and cross-tenant integration tests remain outstanding. Do not use real customer data or jump to live source integrations, automated outreach, billing, or production AnyTrader integration before those gates are complete.
