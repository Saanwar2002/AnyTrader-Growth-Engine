# Growth Engine Roadmap

## Phase 1 — Usable local foundation (in progress)

- [x] Create project README and product guardrails.
- [x] Add React + TypeScript + Vite application shell.
- [x] Verify npm install, TypeScript type-check, and production build in an isolated Composio environment.
- [x] Add typed campaign, lead, draft, activity, and workspace models.
- [x] Add clearly fictional demo data and browser-local persistence.
- [x] Add campaign create/status workflows.
- [x] Add lead search, status filters, campaign filters, details, and status transitions.
- [x] Add CSV import validation, size limit, duplicate detection, and CSV export.
- [x] Add draft-only outreach workflow and activity history.
- [ ] Add automated unit tests and a repeatable CI workflow.
- [ ] Run a browser-level smoke test and accessibility review.

## Phase 2 — Authentication and tenant-safe persistence

- [ ] Create a separate Growth Engine Firebase project and configure Auth, Firestore, and emulators.
- [ ] Implement authenticated routes, organisations, memberships, and server-side role checks.
- [ ] Add deny-by-default Firestore rules and tenant-isolation tests.
- [ ] Add secure server-side API and verified identity handling.
- [ ] Add tenant-scoped repositories and audit-event persistence.

## Phase 3 — Campaign and lead workflows

- [x] Campaign create/status workflow in local demo mode.
- [x] Lead list, filters, details, statuses, notes display, and activity history in local demo mode.
- [x] CSV import validation, duplicate detection, and export in local demo mode.
- [ ] Add edit/archive campaign, lead notes editing, import preview, and bulk operations.
- [ ] Add suppression management and configurable scoring criteria.

## Phase 4 — Approved lead-source adapters

- [ ] Define provider-neutral adapter contract and provenance requirements.
- [ ] Integrate only approved APIs/data providers after terms and permissions review.
- [ ] Add server-side quotas, retries, rate limits, and secret references.
- [ ] Verify that provider failures cannot corrupt tenant data.

## Phase 5 — AI lead intelligence and draft outreach

- [ ] Server-side Gemini integration for classification, explanations, and draft generation.
- [ ] Schema validation, prompt-injection protections, usage tracking, and human approval.
- [x] Local template-based draft generation; no messages are sent.
- [ ] Automated checks proving the app cannot send messages in demo mode.

## Phase 6 — Onboarding attribution and analytics

- [ ] Generate non-sensitive referral tokens and track campaign/source attribution.
- [ ] Begin with a mocked integration; review permissions before a live marketplace connection.
- [ ] Add aggregate campaign reporting.

## Phase 7 — Commercial SaaS controls

- [ ] Plans, quotas, subscription lifecycle, billing provider, and webhook verification.
- [ ] Server-side entitlement enforcement, account export/deletion, and usage views.

## Phase 8 — Agency, white-label, and production hardening

- [ ] Agency workspaces, branding, custom domains, API access, enterprise roles.
- [ ] Backups, monitoring, incident response, deployment runbook, and security review.

## Non-negotiable boundaries

- Work only in the standalone AnyTrader-Growth-Engine repository.
- Do not modify the original AnyTrader repository or its main branch.
- No unauthorised scraping or access-control bypass.
- No automated outreach in the MVP.
- No secrets, production data, or real lead personal data in demo fixtures.
- Do not describe the prototype as secure, multi-tenant, or production-ready before the relevant implementation and tests are complete.
