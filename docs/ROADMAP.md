# Growth Engine Roadmap

## Phase 1 — Foundation (current)

- [x] Create project README and product guardrails.
- [x] Add initial React + TypeScript + Vite application shell.
- [x] Establish a demo-only dashboard with no live data.
- [ ] Install dependencies and run typecheck/build in a development environment.
- [ ] Add typed campaign and lead models plus synthetic fixtures.
- [ ] Add unit tests and a repeatable CI workflow.

## Phase 2 — Campaigns and demo leads

- Campaign configuration: brand, service category, geography, goal, and status.
- Synthetic lead fixtures, visibly labelled as fictional.
- Lead list, filters, review status, and record details.
- No external collection or messaging.

## Phase 3 — Qualification and source adapters

- Provider-independent interfaces for approved sources.
- Record data provenance for every lead.
- Normalization, deduplication, transparent scoring, and suppression rules.
- Document terms, permissions, rate limits, and retention for each source.

## Phase 4 — Outreach drafts and approval

- Brand-aware draft templates and preview.
- Human review and explicit approval before any use.
- Audit trail and opt-out/suppression handling.
- No automated sending in the initial release.

## Phase 5 — Attribution and analytics

- Campaign/source attribution for provider onboarding.
- Aggregate campaign reporting.
- Connect production services only after a separate integration and security review.

## Phase 6 — Hardening and deployment

- Authentication and role-based access where needed.
- Secret management, privacy controls, retention/deletion, logging, and error handling.
- Tests, accessibility checks, deployment runbook, and security review.

## Non-negotiable boundaries

- Work only in the standalone AnyTrader-Growth-Engine repository.
- Do not modify the original AnyTrader repository or its main branch.
- No unauthorized scraping or access-control bypass.
- No real lead data, credentials, or automated outreach in demo mode.
