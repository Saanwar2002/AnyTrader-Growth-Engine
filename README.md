# AnyTrader Growth Engine

A standalone, multi-brand lead discovery and provider acquisition workspace for AnyTrader, HandyTrader, and future businesses. The current release is a **local demo MVP**, not a production SaaS service.

## What works now

- Responsive dashboard with overview metrics and recent activity.
- Create campaigns with a brand, service category, target location, and acquisition goal.
- View campaign cards and change campaign status.
- Lead directory with search and filters for status and campaign.
- Lead status workflow: new, in review, qualified, contacted, onboarded, and rejected.
- Transparent completeness score (0–100) with an explanation of which fields contributed.
- CSV import with a 2 MB file limit, basic quoted-field support, row validation, and per-campaign duplicate detection.
- Export currently visible leads to CSV.
- Create and edit outreach drafts; no send action exists.
- Local activity history and a demo reset action.
- Synthetic example data clearly labelled as fictional.
- Unit tests for lead normalization/scoring, CSV parsing, and demo persistence.

## Run locally

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite.

Quality checks:

```bash
npm run typecheck
npm test
npm run build
```

## CSV import format

A header row is required. The business name column may be named `businessName`, `business`, `company`, or `name`. Optional recognised columns include:

- `category` or `serviceCategory`
- `location`, `city`, or `area`
- `website` or `url`
- `email` or `emailAddress`
- `phone` or `telephone`

Import starts with a preview-like validation result, skips blank-name rows, and skips businesses already present in the selected campaign using case-insensitive whitespace-normalised names. Review every imported record before any outreach. This is a lightweight MVP CSV parser; it does not support quoted fields containing line breaks.

## Current pilot defaults

- **Provider category:** Painters and decorators.
- **Initial market:** United Kingdom; each campaign can specify another location.
- **Data mode:** Synthetic examples and user-supplied CSV only.
- **Outreach:** Draft-only; a human must review and personalise messages.
- **Repository boundary:** This project is independent of the AnyTrader application. Do not modify the original AnyTrader repository or its `main` branch as part of this project.

## Important limitations

This release is a browser-local demo, not a secure multi-user service:

- It uses browser localStorage, not a cloud database. Data is local to that browser profile and may be lost if browser storage is cleared.
- Authentication, organisation membership, tenant isolation, server APIs, cloud persistence, production audit logs, subscription billing, and live source-provider integrations are not implemented.
- Do not use it to store real customer data, sensitive personal data, or production credentials.
- The scoring model measures record completeness, not trustworthiness, service quality, or business legitimacy.
- CSV imports are not sent to an external service.
- No messages are sent automatically or manually by the app.
- Do not connect to production AnyTrader services or data without a separately reviewed integration plan.

## Roadmap

1. **Local demo MVP:** usable campaign and lead workflows, synthetic data, CSV import/export, drafts, and unit tests.
2. **Authentication and tenant-safe persistence:** dedicated Firebase project, verified identity, organisations/memberships, deny-by-default rules, and isolation tests.
3. **Workflow hardening:** richer import preview, lead details/notes, audit history, opt-out/suppression support, and stronger CSV edge-case tests.
4. **Approved source adapters:** only APIs/data providers whose terms permit the intended use.
5. **Server-side AI assistance:** validated classification and draft generation with usage limits and human review.
6. **Attribution and SaaS controls:** onboarding attribution, plans, quotas, and later billing.
7. **Production hardening:** privacy/retention workflows, monitoring, backups, recovery, and security review.

## Safety and privacy principles

- Do not use unauthorised scraping or bypass access controls.
- Respect data-source terms, rate limits, privacy law, and applicable marketing rules.
- Do not commit API keys, passwords, access tokens, or personal lead data.
- Keep synthetic fixtures clearly labelled as fictional.
- Use server-side permission checks for all privileged operations when the backend is introduced.
- Use a separate Firebase project for Growth Engine; never reuse production AnyTrader credentials or databases.
